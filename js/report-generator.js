/* =============================================================
 * 报告生成器 report-generator.js  v2 — 模板样式版
 * 将规则引擎结果渲染为《体检报告解读汇总及健康规划》A版/B版
 * 样式对齐倍佐健康 A 版模板 PDF（封面/章节/附录/页脚）
 * 同时支持：浏览器打印（PDF）与导出 Word(.doc)
 * ============================================================= */
(function (global) {
  'use strict';
  var KB = global.KB, RE = global.RulesEngine;

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
  function lvlColor(level) { return level ? level.color : '#333'; }

  /* 按系统分组判定结果 */
  function groupBySystem(results) {
    var g = {};
    results.forEach(function (r) {
      (g[r.system] = g[r.system] || []).push(r);
    });
    return g;
  }
  var SYSTEM_ORDER = ['心脑血管', '内分泌代谢', '呼吸', '消化泌尿', '其他专科'];

  /* 自动草稿：分系统叙述 */
  function draftNarrative(result) {
    var g = groupBySystem(result.results);
    var out = {};
    SYSTEM_ORDER.forEach(function (sys) {
      var items = g[sys] || [];
      if (!items.length) { out[sysKey(sys)] = ''; return; }
      var lines = items.map(function (r) {
        return r.label + '：' + (r.text || '—') + '，' + r.phrase + '。';
      });
      out[sysKey(sys)] = lines.join('\n');
    });
    return out;
  }
  function sysKey(s) {
    return { '心脑血管': 'cardio', '内分泌代谢': 'endocrine', '呼吸': 'respiratory', '消化泌尿': 'digest', '其他专科': 'other' }[s] || s;
  }

  /* 系统内置附录标题（A/B 版基础三篇一致）；「高嘌呤食物示例」为条件附录，
     仅客户出现高尿酸情况时追加为附录 4，并参与自定义附录去重 */
  var BUILTIN_APPENDIX_A = ['饮食原则', '食谱示例', '生活方式干预建议'];
  var BUILTIN_APPENDIX_B = ['饮食原则', '食谱示例', '生活方式干预建议'];

  /* 清洗自定义附录标题：去掉「附录N:」等前缀（必须带编号分隔符，如「附录1:饮食原则」→「饮食原则」），
     避免渲染成「附录 1：附录1:饮食原则」；「附录甲」这类无分隔符标题原样保留 */
  function cleanAppTitle(t) {
    if (t == null) return '';
    return String(t).replace(/^附\s*录?\s*([\d一二三四五六七八九十]+)?\s*(?:[：:、.．\-·]|\s+)\s*/, '').trim();
  }

  /* 自定义附录标题与内置附录标题语义重复（任一包含）判定 */
  function isDupBuiltin(title, builtin) {
    var ct = cleanAppTitle(title).replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '');
    if (!ct) return false;
    return (builtin || []).some(function (b) {
      var cb = String(b).replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '');
      return ct.indexOf(cb) >= 0 || cb.indexOf(ct) >= 0;
    });
  }

  /* 在 builtin 标题列表中定位与自定义标题重复的具体内置篇目（完全相等优先，其次任一包含）。
     返回内置标题原文；无匹配返回 null。用于「上传同名附录替换内置渲染」：
     上传了私人医生的附录（标题与系统内置一致）→ 生成报告时用医生正文替换对应内置篇。 */
  function matchBuiltinTitle(title, builtin) {
    var ct = cleanAppTitle(title).replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '');
    if (!ct) return null;
    var exact = null, contain = null;
    (builtin || []).forEach(function (b) {
      var cb = String(b).replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '');
      if (!cb) return;
      if (cb === ct) exact = b;
      else if (!contain && (ct.indexOf(cb) >= 0 || cb.indexOf(ct) >= 0)) contain = b;
    });
    return exact || contain;
  }

  /* 上传正文（纯文本，可能来自 Word/PDF 提取）渲染为报告 HTML：
   * 连续且列数一致的含制表符行识别为表格（首行作表头），输出报告样式 .rp-tb 表格；
   * 普通行输出为段落，保留原文分节，避免把整段内容挤成一行。 */
  function richTextHtml(body) {
    if (body == null) return '';
    var lines = String(body).replace(/\r\n/g, '\n').split('\n');
    /* 行清洗：只去首尾空格与行尾制表符，保留行首制表符（= 表格首列为空，
       Word 纵向合并单元格续行），否则空分类行会脱离表格散成独立段落 */
    var clean = function (s) { return String(s == null ? '' : s).replace(/^[ ]+/, '').replace(/[ \t]+$/, ''); };
    var html = '', i = 0;
    var prevWasTable = false, prevTableCols = 0;
    while (i < lines.length) {
      var raw = lines[i];
      var ln = clean(raw);
      if (!ln.replace(/\t/g, '')) { i++; continue; }
      if (ln.indexOf('\t') >= 0) {
        var cols = ln.split('\t').length;
        var rows = [ln], j = i + 1;
        while (j < lines.length) {
          var nxt = clean(lines[j]);
          if (!nxt.replace(/\t/g, '') || nxt.indexOf('\t') < 0 || nxt.split('\t').length !== cols) break;
          rows.push(nxt); j++;
        }
        if (rows.length >= 2) {
          html += '<table class="rp-tb"><thead><tr>';
          rows[0].split('\t').forEach(function (c) { html += '<th>' + esc(c).replace(/\v/g,'<br>') + '</th>'; });
          html += '</tr></thead><tbody>';
          var bodyRows = rows.slice(1).map(function (r) { return r.split('\t'); });
          /* 分类列（首列）为空 → 继承上一行取值（Word 纵向合并单元格语义，
             兼容旧版解析残留的空分类行）；随后连续相同分类合并为一个 rowspan 单元格 */
          var prevCat = '';
          bodyRows.forEach(function (cs) {
            if (!String(cs[0] || '').trim() && prevCat) cs[0] = prevCat;
            if (String(cs[0] || '').trim()) prevCat = String(cs[0]).trim();
          });
          var spans = bodyRows.map(function () { return 1; });
          for (var k = bodyRows.length - 2; k >= 0; k--) {
            var a0 = String(bodyRows[k][0] || '').trim(), a1 = String(bodyRows[k + 1][0] || '').trim();
            if (a0 && a0 === a1) { spans[k] = spans[k + 1] + 1; spans[k + 1] = 0; }
          }
          bodyRows.forEach(function (cs, ri) {
            html += '<tr>';
            if (spans[ri] > 0) html += '<th' + (spans[ri] > 1 ? ' rowspan="' + spans[ri] + '"' : '') + '>' + esc(cs[0]) + '</th>';
            cs.slice(1).forEach(function (c) { html += '<td>' + esc(c).replace(/\v/g,'<br>') + '</td>'; });
            html += '</tr>';
          });
          html += '</tbody></table>';
          prevWasTable = true; prevTableCols = cols;
        } else {
          html += '<p class="rp-txt">' + esc(rows[0].replace(/^\t+/, '').split('\t').join('　')) + '</p>';
          prevWasTable = false; prevTableCols = 0;
        }
        i = j;
      } else {
        if (prevWasTable && prevTableCols >= 2 && /^\(\d{1,2}\)/.test(ln)) {
          html += '<table class="rp-tb"><tbody><tr><th></th><td>' + esc(ln) + '</td></tr></tbody></table>';
        } else {
          html += '<p class="rp-txt">' + esc(ln) + '</p>';
        }
        prevWasTable = false; prevTableCols = 0;
        i++;
      }
    }
    return html;
  }

  /* ---------------- 报告正文 HTML ---------------- */
  function reportBody(result, input) {
    input = input || {};
    var c = result.customer || {};
    var type = c.type || 'A';
    var isA = type === 'A';
    var honor = (c.gender === '女') ? '女士' : '先生';
    var b = KB.BRAND;

    var narrative = input.narrative || {};
    var consultation = input.consultation || [];
    /* 专家会诊板块：A/B 版默认均包含，可在报告设置中取消勾选删除该板块 */
    var showConsultation = input.showConsultation !== false;

    /* 上传叙述块按报告章节分组：文档自带「健康管理建议/健康建议」容器时，
       其子节渲染到 02 章（而非全部堆在 01 章内）；无容器时维持旧行为（全部 01，02 用内置建议模板） */
    var grouped = (input.narrativeBlocks && input.narrativeBlocks.length) ? splitNarrativeBlocks(input.narrativeBlocks) : null;
    var ovBlocks = grouped ? grouped.overview : null;
    var advBlocks = (grouped && grouped.advice.length) ? grouped.advice : null;

    /* 章节目录（对齐模板：连续编号；默认含「专家会诊建议」，取消勾选或无会诊内容则无此章节） */
    var chapters = [['01', '体检结果概况'], ['02', '健康管理建议']];
    var nextNo = 3;
    var hasConsult = showConsultation && consultation.length > 0;
    if (hasConsult) { chapters.push(['03', '专家会诊建议']); nextNo = 4; }
    var builtinAppendix = isA ? BUILTIN_APPENDIX_A.slice() : BUILTIN_APPENDIX_B.slice();
    /* 高尿酸判定：任一指标触发「高尿酸」标签（如血尿酸 ua 超标）时追加条件附录「高嘌呤食物示例」 */
    var hasHighUric = (result.tags || []).indexOf('高尿酸') >= 0;
    if (hasHighUric && builtinAppendix.indexOf('高嘌呤食物示例') < 0) builtinAppendix.push('高嘌呤食物示例');
    /* 上传同名附录 → 替换内置渲染；未命中内置的医生独有附录 → 作为额外 CUSTOM APPENDIX 追加。
       （此前与内置同名的上传章节被整篇过滤，报告只渲染系统内置模板，用户上传的私人医生附录内容
        全部丢失 → 表现为「附录用的是 A 类模板」。现在语义翻转：医生内容优先。） */
    var replaceMap = {};
    var customApp = [];
    if (input.customAppendix && input.customAppendix.length) {
      input.customAppendix.forEach(function (a) {
        if (!a || a.title == null) return;
        var bt = matchBuiltinTitle(a.title, builtinAppendix);
        if (bt && !replaceMap[bt]) replaceMap[bt] = a;
        else if (!bt) customApp.push(a);
      });
    }
    var appendixTitles = builtinAppendix.map(function (t) { return [t]; });
    customApp.forEach(function (a) { appendixTitles.push([cleanAppTitle(a.title) || '附录']); });
    appendixTitles.forEach(function (t, i) {
      chapters.push([(nextNo < 10 ? '0' + nextNo : nextNo), '附录 ' + (i + 1) + '·' + t[0]]);
      nextNo++;
    });
    chapters.push([(nextNo < 10 ? '0' + nextNo : nextNo), '健康寄语']);

    var html = '';

    /* ===== 封面（统一模板：logo + 品牌滚带 + 大标题 + 心电横幅 + 信息卡） ===== */
    html += coverHtml({ title: '体检报告解读汇总与健康规划', customer: c, date: input.reportDate });

    /* ===== 目录（对齐模板：CONTENTS 大字 + 金色编号 + 右侧页码 + 分隔线） ===== */
    html += '<div class="rp-page">';
    html += pageHeader();
    html += '<div class="rp-contents"><div class="rp-contents-en">CONTENTS</div><div class="rp-contents-tt">目 录</div><ul>';
    chapters.forEach(function (ch, i) {
      html += '<li><span class="rp-c-no">' + ch[0] + '</span><span class="rp-c-tt">' + esc(ch[1]) + '</span><span class="rp-c-pg">' + (i + 3) + '</span></li>';
    });
    html += '</ul></div>';
    html += pageFooter();
    html += '</div>';

    /* ===== 01 体检结果概况（PART XX 格式） ===== */
    html += '<div class="rp-page">';
    html += pageHeader();
    html += sectionTitle('01', '体检结果概况', 'PHYSICAL EXAMINATION OVERVIEW', '一');
    html += basicInfoTable(result, input);
    /* 对齐模板：FFR-CT 评估位于「冠脉与全身血管」叙述块下方 */
    html += overviewNarrative(narrative, result, input, (isA && result.ffr) ? ffrBlock(result.ffr) : '', ovBlocks);
    html += pageFooter();
    html += '</div>';

    /* ===== 02 健康管理建议 ===== */
    html += '<div class="rp-page">';
    html += pageHeader();
    html += sectionTitle('02', '健康管理建议', 'HEALTH MANAGEMENT ADVICE', '二');
    /* 上传文档自带「健康管理建议/健康建议」容器时：优先按文档子节渲染（医生内容），无则用内置建议模板 */
    if (advBlocks) html += renderNarrativeBlocks(advBlocks, null);
    else html += adviceBlock(result);
    html += pageFooter();
    html += '</div>';

    /* ===== 03 专家会诊（默认 A/B 版均含；取消勾选或无会诊意见时自动跳过） ===== */
    if (hasConsult) {
      html += '<div class="rp-page">';
      html += pageHeader();
      html += sectionTitle('03', '专家会诊建议', 'EXPERT CONSULTATION ADVICE', '三');
      html += consultationBlock(consultation);
      html += pageFooter();
      html += '</div>';
    }

    /* ===== 附录（系统内置三篇 + 高尿酸条件篇；上传同名附录时用医生正文替换该篇内容） =====
       渲染顺序 = builtinAppendix 数组顺序：附录 1 饮食原则 / 附录 2 食谱示例 /
       附录 3 生活方式干预建议，高尿酸客户追加高嘌呤食物示例。 */
    var APP_EN = { '饮食原则': 'DIETARY PRINCIPLES', '食谱示例': 'SAMPLE MENU', '生活方式干预建议': 'LIFESTYLE INTERVENTION', '高嘌呤食物示例': 'HIGH-PURINE FOODS' };
    var APP_FN = { '饮食原则': dietBlock, '食谱示例': menuBlock, '生活方式干预建议': lifestyleBlock, '高嘌呤食物示例': highPurineBlock };
    builtinAppendix.forEach(function (bt, bi) {
      html += '<div class="rp-page">';
      html += pageHeader();
      html += appendixTitle('附录 ' + (bi + 1), bt, APP_EN[bt] || 'APPENDIX');
      var rep = replaceMap[bt];
      if (rep && rep.body && rep.body.trim()) {
        /* 上传了私人医生同名附录：保留系统附录编号/标题版式，正文采用医生内容（含表格保真）。
           饮食原则若带「健康画像」表则提取画像标签，替换内置「健康画像内容 · 通用」为实际画像。 */
        if (bt === '饮食原则') {
          var hp = extractDietHealthPortrait(rep.body);
          if (hp) html += '<div class="rp-ov"><div class="rp-ov-b">' + dietPortraitHtml(hp) + '</div></div>';
          else html += '<div class="rp-ov"><div class="rp-ov-b">' + richTextHtml(rep.body) + '</div></div>';
        } else {
          html += '<div class="rp-ov"><div class="rp-ov-b">' + richTextHtml(rep.body) + '</div></div>';
        }
      } else if (APP_FN[bt]) {
        html += APP_FN[bt](result, input);
      }
      html += pageFooter();
      html += '</div>';
    });

    /* ===== 客户独有附录（标题与内置不重复，来自上传文档或手动添加；编号接续内置之后） ===== */
    if (customApp.length) {
      var appBase = builtinAppendix.length;
      customApp.forEach(function (a, i) {
        html += '<div class="rp-page">';
        html += pageHeader();
        html += appendixTitle('附录 ' + (appBase + i + 1), cleanAppTitle(a.title) || '附录', 'CUSTOM APPENDIX');
        html += '<div class="rp-ov"><div class="rp-ov-b">' + richTextHtml(a.body) + '</div></div>';
        html += pageFooter();
        html += '</div>';
      });
    }

    /* ===== 健康寄语（对齐模板：左对齐标题 + 红色称呼 + 首行缩进信件体） ===== */
    html += '<div class="rp-page">';
    html += pageHeader();
    html += '<div class="rp-msg-h">健康寄语</div>';
    html += '<div class="rp-message"><p class="rp-message-greet">尊敬的' + esc(c.name || '') + (c.gender === '女' ? '女士' : '先生') + '：</p>';
    String(result.message || '').split(/\n+/).forEach(function (p) {
      if (p.trim()) html += '<p class="rp-message-p">' + esc(p.trim()) + '</p>';
    });
    html += '</div>';
    html += pageFooter();
    html += '</div>';

    /* ===== 页脚页码（对齐模板：左品牌 + 右「第 N 页 · 共 M 页」；封面为第 1 页） ===== */
    var totalPages = html.split('<div class="rp-page">').length; // 正文页数（不含封面）
    var pageNo = 1;
    html = html.replace(/<div class="rp-pf">([\s\S]*?)<\/div>/g, function (m, t) {
      pageNo++;
      return '<div class="rp-pf">' + t + '<span class="rp-pf-pg">第 ' + pageNo + ' 页 · 共 ' + (totalPages + 1) + ' 页</span></div>';
    });

    return html;
  }

  /* ---- 区块构件（对齐模板样式） ---- */
  function pageHeader() {
    return '<div class="rp-ph"><span class="rp-ph-logo"><span class="rp-logo-icon">♥</span><b>BES JUS</b> 倍佐健康</span><span class="rp-ph-slogan">健康无忧 · 未来可控</span></div>';
  }
  function pageFooter() {
    return '<div class="rp-pf"><span class="rp-pf-brand">倍佐健康 · 心脑血管健康数字化服务商</span></div>';
  }
  function fmtDateCn(d) {
    if (!d) d = new Date().toISOString().slice(0, 10);
    var m = String(d).match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
    if (!m) return d;
    return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }
  /* 统一封面（对齐 A 版模板：logo + 品牌滚带 + 大标题 + 心电横幅 + 信息卡 + 页脚）。
   * A/B 报告、季度报告、年度报告共用，仅 title 不同：
   *   AB     = 体检报告解读汇总与健康规划
   *   季度   = 第N个服务季度小结汇总 / X季度小结汇总
   *   年度   = 年度健康总结报告
   * band（滚带）固定「心脑血管健康数字化服务」，footer 固定「健康无忧 · 未来可控」。 */
  function coverHtml(opts) {
    opts = opts || {};
    var c = opts.customer || {};
    var title = opts.title || '体检报告解读汇总与健康规划';
    var band = opts.band || '心脑血管健康数字化服务';
    var d = opts.date || c.reportDate;
    return '<div class="rp-cover">' +
      '<div class="rp-cover-logo"><span class="rp-logo-icon">&#9829;</span>' +
      '<span class="rp-logo-text">BES JUS <b>倍佐健康</b></span></div>' +
      '<div class="rp-cover-band">' + esc(band) + '</div>' +
      '<div class="rp-cover-title">' + esc(title) + '</div>' +
      '<div class="rp-cover-banner"><span class="rp-banner-heart">&#9829;</span>' +
      '<span class="rp-banner-ecg"></span></div>' +
      '<div class="rp-cover-card">' +
        '<div><span>姓 名</span><b class="rp-cv-nm">' + esc(c.name || '—') + '</b></div>' +
        '<div><span>性 别</span><b>' + esc(c.gender === '女' ? '女' : '男') + '</b></div>' +
        '<div><span>日 期</span><b>' + esc(fmtDateCn(d)) + '</b></div>' +
      '</div>' +
      '<div class="rp-cover-footer">健康无忧 · 未来可控</div>' +
      '</div>';
  }
  function sectionTitle(no, cn, en, order) {
    var orderStr = order ? order + '、' : '';
    return '<div class="rp-sec">' +
      '<div class="rp-sec-part">PART ' + no + ' · ' + en + '</div>' +
      '<div class="rp-sec-main"><b class="rp-sec-tt">' + orderStr + cn + '</b><b class="rp-sec-bg">' + no + '</b></div>' +
      '<div class="rp-sec-line"></div></div>';
  }
  function appendixTitle(no, cn, en) {
    return '<div class="rp-sec rp-sec-app">' +
      '<div class="rp-sec-main"><b class="rp-sec-cn">' + no + '：' + cn + '</b>' +
      '<i class="rp-sec-en">' + en + '</i></div>' +
      '<div class="rp-sec-line"></div></div>';
  }
  function basicInfoTable(result, input) {
    var c = result.customer, m = input.metrics || {};
    /* 身高/体重/腰围：优先体检指标（metrics），缺省时回退客户档案字段（档案录入的基线数据），
       保证识别未命中或未在指标表单重复录入时报告基本信息仍能显示。 */
    var height = (m.height != null && m.height !== '') ? m.height : (c.height != null && c.height !== '' ? c.height : null);
    var weight = (m.weight != null && m.weight !== '') ? m.weight : (c.baseline_weight != null && c.baseline_weight !== '' ? c.baseline_weight : null);
    var waist  = (m.waist != null && m.waist !== '')  ? m.waist  : (c.waist != null && c.waist !== '' ? c.waist : null);
    var bmi = (weight && height) ? (Number(weight) / Math.pow(Number(height)/100, 2)).toFixed(2) : '—';
    /* 对齐模板：4 列 × 2 行斑马格，每格标签在上、数值在下 */
    var cells = [
      ['年 龄', (c.age != null ? c.age + ' 岁' : '—')],
      ['心 率', (m.hr != null && m.hr !== '' ? m.hr + ' 次/分' : '—')],
      ['身 高', (height ? height + ' cm' : '—')],
      ['体 重', (weight ? weight + ' Kg' : '—')],
      ['腰 围', (waist != null && waist !== '' ? waist + ' cm' : '—')],
      ['BMI', (bmi + ' kg/m²')],
      ['收缩压', (m.sbp != null && m.sbp !== '' ? m.sbp + ' mmHg' : '—')],
      ['舒张压', (m.dbp != null && m.dbp !== '' ? m.dbp + ' mmHg' : '—')]
    ];
    var t = '<div class="rp-basic"><div class="rp-basic-h"><b>基本信息</b><i>BASIC INFORMATION</i></div><table class="rp-tb rp-bi-tb"><tbody>';
    for (var r = 0; r < 2; r++) {
      t += '<tr>';
      for (var k = 0; k < 4; k++) {
        var cell = cells[r * 4 + k];
        t += '<td><div class="rp-bi-l">' + cell[0] + '</div><div class="rp-bi-v">' + cell[1] + '</div></td>';
      }
      t += '</tr>';
    }
    t += '</tbody></table>' +
      '<div class="rp-basic-note">本总结以 ' + esc(fmtDateCn(input.reportDate)) + ' 体检报告为基准，结合问卷信息与历史健康数据综合评估生成。</div></div>';
    return t;
  }
  function ffrBlock(ffr) {
    var ok = ffr.allOk;
    var cols = '';
    KB.FFR.vessels.forEach(function (v) {
      var d = ffr.vessels[v.code];
      cols += '<div class="rp-ffr-col"><div class="rp-ffr-l">' + esc(d.label) + '</div>' +
        '<div class="rp-ffr-v" style="color:' + (d.ok ? '#8C0C10' : KB.LEVEL.ABNORMAL.color) + '">' + esc(d.value) + '</div></div>';
    });
    return '<div class="rp-ffr"><div class="rp-ffr-h"><b>FFR-CT 评估</b><i>CORONARY FUNCTION</i></div>' +
      '<div class="rp-ffr-cols">' + cols + '</div>' +
      '<div class="rp-ffr-note">' + (ok ? '三支血管数值均 ＞ 0.8 · 不存在心肌缺血 · 血流功能状态良好' : '存在血管数值 ≤ 0.8 · 需关注心肌缺血风险') + '</div></div>';
  }
  /* ---- 上传叙述块按报告章节分组 ----
   * 上传的《健康总结》常自带层级：容器大节（一、体检结果概况 / 二、健康管理建议）下挂多个小标题。
   * 报告中这些容器与固定章节（01 体检结果概况 / 02 健康管理建议）同名，应让小标题归入对应章节，
   * 而不是把「健康管理建议」的正文全部挤进「01 体检结果概况」页。
   * stripNumPrefix：去掉 Word 自动编号前缀（「3.一般查体」→「一般查体」）做语义判断。 */
  function stripNumPrefix(t) {
    return String(t || '').trim().replace(/^\s*[一二三四五六七八九十百\d]+[、．.、.]?\s*/, '').trim();
  }
  function narrativeContainerKind(t) {
    var c = stripNumPrefix(t);
    if (c === '体检结果概况' || c === '体检概况' || c === '检查结果概况') return 'overview';
    if (c === '健康管理建议' || c === '健康建议' || c === '健康管理') return 'advice';
    return null;
  }
  function splitNarrativeBlocks(blocks) {
    var overview = [], advice = [], cur = 'overview';
    (blocks || []).forEach(function (b) {
      var t = String((b && b.title) || '').trim();
      var kind = narrativeContainerKind(t);
      if (kind === 'advice') { cur = 'advice'; return; }  // 容器标题本身不渲染（报告章节标题已承载）
      if (kind === 'overview') { cur = 'overview'; return; }
      (cur === 'advice' ? advice : overview).push(b);
    });
    return { overview: overview, advice: advice };
  }
  /* 渲染一组叙述块（跳过空正文块）；afterCardioHtml 插在冠脉/血管叙述块之后（对齐模板 FFR 位置） */
  function renderNarrativeBlocks(blocks, afterCardioHtml) {
    var h = '', injected = false;
    function isCardio(title) { return /冠脉|心脑血管|血管/.test(title || ''); }
    (blocks || []).forEach(function (b) {
      var t = (b.title || '').trim(), body = (b.body || '').trim();
      if (!body) return;  // 跳过空正文块
      h += '<div class="rp-ov"><div class="rp-ov-h">' + esc(t || '体检结果叙述') + '</div><div class="rp-ov-b">' + richTextHtml(body) + '</div></div>';
      if (afterCardioHtml && !injected && isCardio(t)) { h += afterCardioHtml; injected = true; }
    });
    if (!h && afterCardioHtml) return afterCardioHtml;
    if (h && afterCardioHtml && !injected) h += afterCardioHtml;
    return h;
  }
  function overviewNarrative(narrative, result, input, afterCardioHtml, ovBlocks) {
    /* afterCardioHtml：插在「冠脉/心脑血管」叙述块之后的内容（如 FFR 区块），对齐模板位置 */
    if (ovBlocks) return renderNarrativeBlocks(ovBlocks, afterCardioHtml);
    // 兼容旧调用：无显式分组时沿用整份 narrativeBlocks / 指标对象叙述
    var blocks = (input && input.narrativeBlocks && input.narrativeBlocks.length) ? input.narrativeBlocks : null;
    if (blocks) return renderNarrativeBlocks(blocks, afterCardioHtml);
    // 回退：固定五系统（兼容旧数据）
    var map = [
      ['心脑血管', '一、心脑血管系统', 'cardio'],
      ['内分泌代谢', '二、内分泌与代谢系统', 'endocrine'],
      ['呼吸', '三、呼吸系统', 'respiratory'],
      ['消化泌尿', '四、消化与泌尿系统', 'digest'],
      ['其他专科', '五、其他专科异常', 'other']
    ];
    var html = '';
    var injected = false;
    map.forEach(function (m) {
      var txt = narrative[m[2]] || '';
      if (!txt.trim()) return;
      html += '<div class="rp-ov"><div class="rp-ov-h">' + esc(m[1]) + '</div><div class="rp-ov-b">' + esc(txt).replace(/\n/g, '<br>') + '</div></div>';
      if (afterCardioHtml && !injected && m[2] === 'cardio') { html += afterCardioHtml; injected = true; }
    });
    if (afterCardioHtml && !injected) html += afterCardioHtml;
    if (!html) html = '<div class="rp-ov"><div class="rp-ov-b" style="color:#999">（未填写分系统体检结果叙述，可在左侧表单补充，或由指标自动判定生成草稿，或上传 Word/PDF 自动提取。）</div></div>';
    return html;
  }
  function adviceBlock(result) {
    var html = '';
    /* 1. 核心指标管控 */
    html += '<div class="rp-ad"><div class="rp-ad-h"><span class="rp-ad-h-ic"></span>1. 核心指标管控</div>';
    if (result.advices.length) {
      result.advices.forEach(function (a, i) {
        html += '<div class="rp-ad-item"><span class="rp-ad-no">' + (i + 1) + '</span><div><b>' + esc(a.title) + '</b><p>' + esc(a.text) + '</p></div></div>';
      });
    } else {
      html += '<p class="rp-ad-empty">各项核心指标基本正常，建议继续保持健康生活方式并年度复查。</p>';
    }
    html += '</div>';

    /* 2. 重点随访事项（对齐模板：由异常结果 tags 驱动） */
    html += '<div class="rp-ad"><div class="rp-ad-h"><span class="rp-ad-h-ic"></span>2. 重点随访事项</div>';
    var keyFollow = [];
    if (result.tags.indexOf('颈动脉斑块') >= 0) keyFollow.push(['全身动脉斑块随访', '多部位动脉斑块为全身动脉粥样硬化的早期信号，目前无明显血管狭窄，核心干预手段为：强化降脂＋管控危险因素。建议每年复查颈动脉（含头臂干）＋下肢动脉超声，监测斑块大小、数量与性质变化；冠脉无胸闷、胸痛等特殊不适无需每年常规复查 CTA，出现相关症状及时就诊。']);
    if (result.tags.indexOf('泌尿系异常') >= 0 || result.tags.indexOf('肾囊肿') >= 0) keyFollow.push(['肾囊肿随访', '肾囊肿/肾占位多为良性病变，建议每年复查泌尿系超声，跟踪囊肿大小与形态变化；若囊肿持续增大或出现腰痛、血尿等不适，需至泌尿外科就诊评估。']);
    if (result.tags.indexOf('肺结节') >= 0) keyFollow.push(['肺结节随访', '肺结节建议按指南定期复查胸部低剂量 CT，随访结节大小、形态变化；如出现咳嗽加重、胸痛咯血等异常及时就诊。']);
    if (!keyFollow.length) keyFollow.push(['暂无重点随访事项', '各项检查未见需要重点随访的异常，维持年度常规体检即可。']);
    keyFollow.forEach(function (k, i) {
      html += '<div class="rp-ad-item"><span class="rp-ad-no">' + (i + 1) + '</span><div><b>' + esc(k[0]) + '</b><p>' + esc(k[1]) + '</p></div></div>';
    });
    html += '</div>';

    /* 3. 基础生活方式调整（对齐模板：2×2 卡片网格） */
    html += '<div class="rp-ad"><div class="rp-ad-h"><span class="rp-ad-h-ic"></span>3. 基础生活方式调整</div><div class="rp-life-grid">';
    var life = [
      ['（1）饮食', result.lifestyle.diet],
      ['（2）饮酒管控', result.lifestyle.alcohol],
      ['（3）运动', result.lifestyle.exercise],
      ['（4）作息', result.lifestyle.sleep]
    ];
    life.forEach(function (l) {
      html += '<div class="rp-life-card"><b>' + esc(l[0]) + '</b><p>' + esc(l[1]) + '</p></div>';
    });
    html += '</div></div>';

    /* 4. 随访就诊建议（对齐模板：纵向时间线） */
    html += '<div class="rp-ad"><div class="rp-ad-h"><span class="rp-ad-h-ic"></span>4. 随访就诊建议</div><div class="rp-timeline">';
    var follow = [];
    /* 针对性复查：按触发标签动态生成复查项目，正常指标不再被建议复查（如肾功能正常则不出现"肾功能"） */
    var recheckMap = {
      '血脂异常': '血脂全套 + 肝功能',
      'LDL-C严重超标': '血脂全套 + 肝功能',
      'LDL-C未达标': '血脂全套 + 肝功能',
      '血脂边缘升高': '血脂全套',
      '肝酶异常': '肝功能',
      '高尿酸': '血尿酸',
      '肾功能下降': '肾功能 + 尿常规',
      '血糖异常': '空腹血糖 + 糖化血红蛋白',
      '糖耐量受损': '空腹血糖 + 糖化血红蛋白',
      '高同型半胱氨酸': '同型半胱氨酸',
      '维生素D不足': '25 羟维生素 D',
      '肿瘤标志物升高': '肿瘤标志物',
      '心电图异常': '心电图'
    };
    var recheckItems = [];
    Object.keys(recheckMap).forEach(function (t) {
      if (result.tags.indexOf(t) >= 0 && recheckItems.indexOf(recheckMap[t]) < 0) recheckItems.push(recheckMap[t]);
    });
    if (recheckItems.length) follow.push(['针对性复查', '3 个月左右', '复查 ' + recheckItems.join('、') + '，全面评估各项指标控制效果。']);
    if (result.tags.indexOf('颈动脉斑块') >= 0) follow.push(['血管专科随访', '每年', '复查颈动脉（含头臂干）超声＋下肢动脉超声，监测动脉斑块进展情况。']);
    if (result.tags.indexOf('泌尿系异常') >= 0 || result.tags.indexOf('肾囊肿') >= 0) follow.push(['泌尿系随访', '每年', '复查泌尿系超声，跟踪囊肿/占位大小与形态变化。']);
    if (result.tags.indexOf('肺结节') >= 0) follow.push(['胸部随访', '每年', '低剂量 CT 随访肺结节变化。']);
    follow.push(['年度全面体检', '每年一次', '重点覆盖血脂、肝肾功能、血管超声、心脏超声、腹部超声（肝胆胰脾肾及泌尿系）、心电图、糖代谢、心脑影像学等相关指标。']);
    follow.forEach(function (f, i) {
      html += '<div class="rp-tl-item">' +
        '<div class="rp-tl-num">' + (i + 1) + '</div>' +
        '<div class="rp-tl-body">' +
          '<div class="rp-tl-top"><b>' + esc(f[0]) + '</b><span class="rp-tl-tag">' + esc(f[1]) + '</span></div>' +
          '<div class="rp-tl-text">' + esc(f[2]) + '</div>' +
        '</div></div>';
    });
    html += '</div></div>';

    /* 5. 医学指南知识库参考（依据临床指南 / 共识整理，供健管师参考） */
    if (result.litNotes && result.litNotes.length) {
      html += '<div class="rp-ad"><div class="rp-ad-h"><span class="rp-ad-h-ic"></span>5. 医学指南知识库参考</div>';
      result.litNotes.forEach(function (lit) {
        html += '<div class="rp-lit"><div class="rp-lit-head"><b>' + esc(lit.title) + '</b><span>依据：' + esc(lit.source) + '</span></div>';
        if (lit.targets && lit.targets.length) {
          html += '<div class="rp-lit-sec">管理目标</div><ul>';
          lit.targets.forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
          html += '</ul>';
        }
        if (lit.lifestyle && lit.lifestyle.length) {
          html += '<div class="rp-lit-sec">生活方式干预要点</div><ul>';
          lit.lifestyle.slice(0, 6).forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
          html += '</ul>';
        }
        if (lit.drug) html += '<div class="rp-lit-sec">用药要点</div><p class="rp-lit-drug">' + esc(lit.drug) + '</p>';
        if (lit.special && lit.special.length) {
          html += '<div class="rp-lit-sec">专项提示</div><ul>';
          lit.special.slice(0, 3).forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
    return html;
  }
  function consultationBlock(consultation) {
    if (!consultation.length) return ''; /* 无会诊意见：不生成空章节（reportBody 已按 hasConsult 跳过） */
    var html = '';
    consultation.forEach(function (c, i) {
      html += '<div class="rp-con"><div class="rp-con-h">' + (i + 1) + ' ' + esc(c.dept || '专科') + '</div>' +
        '<div class="rp-con-row"><b>诊断：</b>' + esc(c.diagnosis || '—') + '</div>' +
        '<div class="rp-con-row"><b>建议：</b>' + esc(c.advice || '—').replace(/\n/g, '<br>') + '</div></div>';
    });
    return html;
  }
  function dietBlock(result) {
    // 对齐模板：左侧「健康画像内容」标题，健康画像（高尿酸/骨质疏松等）作为标签，下接分项建议与注记
    var html = '<div class="rp-diet"><div class="rp-diet-h">健康画像内容 · ' + (result.healthPortraits.length ? esc(result.healthPortraits.join('、')) : '通用') + '</div><ul>';
    result.diet.forEach(function (d, i) { html += '<li><b>（' + (i + 1) + '）</b>' + esc(d) + '</li>'; });
    html += '</ul>';
    if (result.healthPortraits.indexOf('高尿酸') >= 0) {
      html += '<p class="rp-diet-note">注：食物中的嘌呤可经过人体代谢生成尿酸。过高的嘌呤摄入增加尿酸产生，易引起高尿酸血症。限制高嘌呤食物摄入，有助于控制血尿酸的水平及减少痛风的发生。不同食材嘌呤含量和吸收利用率不同，科学选择食材，以低嘌呤膳食为主，严格控制膳食中嘌呤含量。</p>';
    } else {
      html += '<p class="rp-diet-note">注：饮食原则根据客户健康画像个性化制定，实际执行中请结合个人口味、过敏史及专科建议适当调整。</p>';
    }
    html += '</div>';
    return html;
  }
  /* 从上传的「饮食原则」正文中识别健康画像表（形如 表头「健康画像 | 内容」、数据行「胆红素偏高 | …」），
     提取画像标签（如胆红素偏高）替换内置模板的「健康画像内容 · 通用」标题。 */
  function extractDietHealthPortrait(body) {
    if (body == null) return null;
    var lines = String(body).replace(/\r\n/g, '\n').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length; });
    for (var i = 0; i < lines.length; i++) {
      var head = lines[i].split('\t');
      if (head.length < 2) continue;
      var h0 = head[0].replace(/\s+/g, ''), h1 = head[1].replace(/\s+/g, '');
      if (h0.indexOf('健康画像') < 0 || (h1 && h1.indexOf('内容') < 0)) continue;
      var labels = [], texts = [], tail = [], j = i + 1;
      for (; j < lines.length && lines[j].indexOf('\t') >= 0; j++) {
        var d = lines[j].split('\t');
        labels.push(d[0]);
        texts.push(d.slice(1).join('\t'));
      }
      for (; j < lines.length; j++) tail.push(lines[j]);
      if (!labels.length) return null;
      return { labels: labels, texts: texts, tail: tail };
    }
    return null;
  }
  function dietPortraitHtml(hp) {
    var html = '<div class="rp-diet"><div class="rp-diet-h">健康画像内容 · ' + esc(hp.labels.join('、')) + '</div>';
    hp.texts.forEach(function (tx) {
      String(tx).split('\x0B').forEach(function (seg) {
        seg = seg.trim();
        if (!seg) return;
        /* 医生内容若按 (1)(2)…编号分条，渲染为报告同款列表；否则整段输出 */
        var m = seg.match(/^\(\d{1,2}\)/);
        if (m && seg.length > 20) {
          html += '<ul>';
          String(seg).split(/(?=\s*\(\d{1,2}\)\s*)/).forEach(function (sub) {
            sub = sub.trim();
            if (!sub) return;
            var nm = sub.match(/^\((\d{1,2})\)\s*/);
            html += '<li>' + (nm ? '<b>(' + nm[1] + ')</b> ' : '') + esc(nm ? sub.slice(nm[0].length) : sub) + '</li>';
          });
          html += '</ul>';
        } else {
          html += '<p class="rp-txt">' + esc(seg) + '</p>';
        }
      });
    });
    hp.tail.forEach(function (p) { if (p.trim()) html += '<p class="rp-txt">' + esc(p.trim()) + '</p>'; });
    html += '<p class="rp-diet-note">注：饮食原则根据客户健康画像个性化制定，实际执行中请结合个人口味、过敏史及专科建议适当调整。</p></div>';
    return html;
  }
  function menuBlock(result, input) {
    var tip = RE.energyText(input);
    var html = '<div class="rp-menu"><p class="rp-menu-tip">' + esc(tip) + '</p><table class="rp-tb"><thead><tr><th>餐次</th><th>参考食材种类</th><th>参考食物量</th></tr></thead><tbody>';
    result.sampleMenu.meals.forEach(function (m) {
      html += '<tr><th>' + esc(m.name) + '</th><td>' + esc(m.food) + '</td><td>' + esc(m.amount) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }
  function highPurineBlock(result) {
    var html = '<table class="rp-tb"><thead><tr><th>分类</th><th>食物名称</th></tr></thead><tbody>';
    (result.highPurine || []).forEach(function (r) {
      html += '<tr><th>' + esc(r.cat) + '</th><td>' + esc(r.items) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  function lifestyleBlock(result) {
    var html = '';
    result.lifestyleIntervention.forEach(function (g) {
      html += '<div class="rp-life-g"><b>' + esc(g.cat) + '</b><ul>';
      g.items.forEach(function (it) { html += '<li>' + esc(it) + '</li>'; });
      html += '</ul></div>';
    });
    return html;
  }

  /* ---------------- 预览包装（含打印样式） ---------------- */
  function buildPreview(result, input) {
    return REPORT_CSS() + '<div class="rp-root">' + reportBody(result, input) + '</div>';
  }

  /* ---------------- 导出 Word(.docx) 原生格式 ---------------- */
  // 用 JSZip 构建真正的 .docx（OOXML），中文以 UTF-8 XML 存储，杜绝乱码；
  // 分页、页边距、表格、字体均显式声明，Word/WPS 打开不再走"HTML 伪装"兼容模式。
  /* ---- 极简 HTML 解析器（把报告 HTML 转成树） ---- */
  function parseHtml(html) {
    var root = { tag: '#root', cls: '', children: [] };
    var stack = [], cur = root;
    var re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g, m;
    var VOID = { br: 1, hr: 1, img: 1, input: 1 };
    while ((m = re.exec(html))) {
      if (m[0].charAt(0) === '<') {
        if (m[0].charAt(1) === '/') {
          var t0 = m[1].toLowerCase(), k = stack.length - 1;
          while (k >= 0 && stack[k].tag !== t0) k--;
          if (k >= 0) { cur = k > 0 ? stack[k - 1] : root; stack.length = k; }
        } else {
          var t1 = m[1].toLowerCase();
          var el = { tag: t1, cls: classOfAttr(m[2] || ''), attrs: m[2] || '', children: [] };
          el.p = cur;
          cur.children.push(el);
          if (!VOID[t1]) { stack.push(el); cur = el; }
        }
      } else {
        cur.children.push({ tag: '#text', text: m[3] });
      }
    }
    return root;
  }
  function classOfAttr(attr) {
    var mm = /class\s*=\s*"([^"]*)"/.exec(attr);
    return mm ? mm[1] : '';
  }
  function colorOfAttr(attr) {
    var mm = /color\s*:\s*#([0-9a-fA-F]{3,6})/.exec(attr || '');
    if (!mm) return '';
    var c = mm[1];
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return c.toUpperCase();
  }
  function textOf(el) {
    var s = '';
    (function w(n) {
      if (n.tag === '#text') { s += n.text; return; }
      (n.children || []).forEach(w);
    })(el);
    return s;
  }
  function oxEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* ---- OOXML 片段构建 ---- */
  function run(text, opt) {
    opt = opt || {};
    var p = [];
    if (opt.b) p.push('<w:b/><w:bCs/>');
    if (opt.i) p.push('<w:i/>');
    if (opt.color) p.push('<w:color w:val="' + opt.color + '"/>');
    if (opt.sz) { var h = Math.round(opt.sz * 2); p.push('<w:sz w:val="' + h + '"/><w:szCs w:val="' + h + '"/>'); }
    var rpr = p.length ? '<w:rPr>' + p.join('') + '</w:rPr>' : '';
    var t = String(text == null ? '' : text);
    if (t.indexOf('\n') >= 0 || t.indexOf('\t') >= 0) {
      var rs = [];
      String(t).split('\n').forEach(function (part, i) {
        if (i > 0) rs.push('<w:r>' + rpr + '<w:br/></w:r>');
        part.split('\t').forEach(function (seg, j) {
          if (j > 0) rs.push('<w:r>' + rpr + '<w:tab/></w:r>');
          if (seg !== '') rs.push('<w:r>' + rpr + '<w:t xml:space="preserve">' + oxEsc(seg) + '</w:t></w:r>');
        });
      });
      return rs.join('');
    }
    return '<w:r>' + rpr + '<w:t xml:space="preserve">' + oxEsc(t) + '</w:t></w:r>';
  }
  function para(runs, opts) {
    opts = opts || {};
    var ppr = [];
    if (opts.jc) ppr.push('<w:jc w:val="' + opts.jc + '"/>');
    if (opts.pbr) ppr.push('<w:pageBreakBefore/>');
    if (opts.spacing) ppr.push('<w:spacing ' + opts.spacing + '/>');
    if (opts.ind) ppr.push('<w:ind ' + opts.ind + '/>');
    if (opts.tabs) ppr.push('<w:tabs><w:tab w:val="right" w:pos="' + opts.tabs + '"/></w:tabs>');
    if (opts.border) ppr.push('<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="E0E0E0"/></w:pBdr>');
    var r = Array.isArray(runs) ? runs.join('') : (runs || '');
    return '<w:p>' + (ppr.length ? '<w:pPr>' + ppr.join('') + '</w:pPr>' : '') + r + '</w:p>';
  }
  /* ---- 语义块收集：把树扁平化为一组段落/表格 ---- */
  function flatten(el, out) {
    if (el.tag === '#text') return;
    var cls = el.cls || '';
    if (cls.indexOf('rp-ph') >= 0 || cls.indexOf('rp-pf') >= 0) return; /* 页眉页脚在页面级处理 */
    if (el.tag === 'table') { out.push({ t: 'table', el: el }); return; }
    if (cls.indexOf('rp-contents') >= 0) { flattenContents(el, out); return; }
    if (cls.indexOf('rp-sec') >= 0) { out.push({ t: 'para', runs: secRuns(el), opts: { spacing: 'w:before="160" w:after="120"' } }); return; }
    if (cls.indexOf('rp-ov-h') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { b: 1, sz: 15, color: '8C0C10' })], opts: { spacing: 'w:before="140" w:after="40"' } }); return; }
    if (cls.indexOf('rp-ov-b') >= 0) { out.push({ t: 'para', runs: collectRuns(el), opts: {} }); return; }
    if (cls.indexOf('rp-ffr-note') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { color: '8B7368', sz: 11 })], opts: { spacing: 'w:before="40"' } }); return; }
    if (cls.indexOf('rp-ffr-col') >= 0) { out.push({ t: 'para', runs: ffrColRuns(el), opts: { jc: 'center', spacing: 'w:before="40" w:after="40"' } }); return; }
    if (cls.indexOf('rp-ffr-cols') >= 0) { flattenChildren(el, out); return; }
    if (cls.indexOf('rp-bi-l') >= 0 || cls.indexOf('rp-bi-v') >= 0) { return; /* 基本信息格由表格整体处理 */ }
    if (cls.indexOf('rp-basic-note') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { color: '8B7368', sz: 11 })], opts: { spacing: 'w:before="80"' } }); return; }
    if (cls.indexOf('rp-basic-h') >= 0 || cls.indexOf('rp-snap-h') >= 0 || cls.indexOf('rp-ffr-h') >= 0 || cls.indexOf('rp-diet-h') >= 0 || cls.indexOf('rp-ad-h') >= 0) {
      out.push({ t: 'para', runs: [run(textOf(el), { b: 1, color: '8C0C10', sz: 14 })], opts: { spacing: 'w:before="140" w:after="40"' } });
      return;
    }
    if (cls.indexOf('rp-menu-tip') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { b: 1, color: 'B01116' })], opts: { spacing: 'w:after="60"' } }); return; }
    if (cls.indexOf('rp-diet-note') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { color: '8B7368', sz: 11 })], opts: { spacing: 'w:before="80"' } }); return; }
    if (cls.indexOf('rp-ad-item') >= 0) { out.push({ t: 'para', runs: cardRuns(el, false), opts: { spacing: 'w:before="40" w:after="40"' } }); return; }
    if (cls.indexOf('rp-life-card') >= 0) { out.push({ t: 'para', runs: cardRuns(el, true), opts: { spacing: 'w:before="40" w:after="40"' } }); return; }
    if (cls.indexOf('rp-tl-item') >= 0) { out.push({ t: 'para', runs: tlRuns(el), opts: { spacing: 'w:before="40" w:after="40"' } }); return; }
    if (cls.indexOf('rp-con') >= 0) { out.push({ t: 'para', runs: conRuns(el), opts: { spacing: 'w:before="80" w:after="40"' } }); return; }
    if (cls.indexOf('rp-msg-h') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { b: 1, sz: 18, color: 'A20E12' })], opts: { spacing: 'w:before="160" w:after="120"' } }); return; }
    if (cls.indexOf('rp-message-greet') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { b: 1, color: 'A20E12' })], opts: { spacing: 'w:after="80"' } }); return; }
    if (cls.indexOf('rp-message-p') >= 0) { out.push({ t: 'para', runs: collectRuns(el), opts: { ind: 'w:firstLine="480"', spacing: 'w:after="80"' } }); return; }
    if (cls.indexOf('rp-message') >= 0) { flattenChildren(el, out); return; }
    if (cls.indexOf('rp-ad-empty') >= 0) { out.push({ t: 'para', runs: [run(textOf(el), { color: '999999' })], opts: {} }); return; }
    if (cls.indexOf('rp-snap-stat') >= 0) { out.push({ t: 'para', runs: collectRuns(el), opts: { sz: 11 } }); return; }
    if (cls.indexOf('rp-ov') >= 0 || cls.indexOf('rp-ad') >= 0 || cls.indexOf('rp-diet') >= 0 || cls.indexOf('rp-life-g') >= 0 ||
        cls.indexOf('rp-basic') >= 0 || cls.indexOf('rp-menu') >= 0 || cls.indexOf('rp-ffr') >= 0 || cls.indexOf('rp-life-grid') >= 0 ||
        cls.indexOf('rp-timeline') >= 0 || cls.indexOf('rp-snap') >= 0) { flattenChildren(el, out); return; }
    if (el.tag === 'p') { out.push({ t: 'para', runs: collectRuns(el), opts: {} }); return; }
    if (el.tag === 'h1' || el.tag === 'h2' || el.tag === 'h3' || el.tag === 'h4') {
      var hs = el.tag === 'h1' ? 20 : (el.tag === 'h2' ? 18 : 16);
      out.push({ t: 'para', runs: collectRuns(el), opts: { b: 1, sz: hs } }); return;
    }
    if (el.tag === 'ul' || el.tag === 'ol') { el.children.forEach(function (li) { flatten(li, out); }); return; }
    if (el.tag === 'li') { out.push({ t: 'para', runs: [run('•  ', {})].concat(collectRuns(el)), opts: { ind: 'w:left="340"' } }); return; }
    if (el.tag === 'div' || el.tag === 'section' || el.tag === 'span' || el.tag === 'header') { flattenChildren(el, out); return; }
    out.push({ t: 'para', runs: collectRuns(el), opts: {} });
  }
  function flattenChildren(el, out) {
    (el.children || []).forEach(function (c) { flatten(c, out); });
  }
  function collectRuns(el) {
    var out = [];
    (function w(n) {
      if (n.tag === '#text') { out.push(run(n.text, {})); return; }
      if (n.tag === 'br') { out.push('<w:r><w:br/></w:r>'); return; }
      if (n.tag === 'b' || n.tag === 'strong') { out.push(run(textOf(n), { b: 1, color: colorOfAttr(n.attrs) })); return; }
      if (n.tag === 'i' || n.tag === 'em') { out.push(run(textOf(n), { i: 1 })); return; }
      (n.children || []).forEach(w);
    })(el);
    return out;
  }
  function secRuns(el) {
    var app = el.cls.indexOf('rp-sec-app') >= 0;
    if (app) {
      var a = [];
      (function w(n) {
        var c = n.cls || '';
        if (c.indexOf('rp-sec-cn') >= 0) { a.push(run(textOf(n), { b: 1, sz: 17, color: '8C0C10' })); return; }
        if (c.indexOf('rp-sec-en') >= 0) { a.push(run('  ' + textOf(n), { sz: 9, color: 'C9A05E' })); return; }
        (n.children || []).forEach(w);
      })(el);
      return a;
    }
    var part = '', cn = '', no = '';
    (function w(n) {
      var c = n.cls || '';
      if (c.indexOf('rp-sec-part') >= 0) { part = textOf(n); return; }
      if (c.indexOf('rp-sec-tt') >= 0) { cn = textOf(n); return; }
      if (c.indexOf('rp-sec-bg') >= 0) { no = textOf(n); return; }
      (n.children || []).forEach(w);
    })(el);
    return [run(part, { b: 1, color: 'C9A05E', sz: 9 }), run('\n' + no + '  ', { b: 1, sz: 26, color: 'B01116' }), run(cn, { b: 1, sz: 21, color: '8C0C10' })];
  }
  function cardRuns(el, life) {
    var runs = [];
    el.children.forEach(function (n) {
      var c = n.cls || '';
      if (c.indexOf('rp-ad-no') >= 0) runs.push(run(textOf(n), { b: 1, color: 'B01116', sz: 13 }));
      else if (n.tag === 'b' || n.tag === 'strong') runs.push(run(textOf(n), { b: 1, color: colorOfAttr(n.attrs) || (life ? '8C0C10' : '3E3330') }));
      else if (n.tag === 'div' || n.tag === 'p' || n.tag === 'span') {
        if (c.indexOf('rp-life') >= 0 && life) { runs.push(run(textOf(n), {})); return; }
        (n.children || []).forEach(function (inner) {
          if (inner.tag === 'b' || inner.tag === 'strong') runs.push(run(textOf(inner), { b: 1, color: colorOfAttr(inner.attrs) || '3E3330' }));
          else if (inner.tag === 'p') runs.push(run('\n' + textOf(inner), { sz: 12, color: '57463F' }));
          else if (inner.tag === '#text') runs.push(run(inner.text, {}));
        });
      }
    });
    return runs;
  }
  function tlRuns(el) {
    var runs = [];
    el.children.forEach(function (n) {
      var c = n.cls || '';
      if (c.indexOf('rp-tl-num') >= 0) runs.push(run(textOf(n), { b: 1, color: '8C0C10' }));
      else if (c.indexOf('rp-tl-body') >= 0) {
        (n.children || []).forEach(function (m) {
          var mc = m.cls || '';
          if (mc.indexOf('rp-tl-top') >= 0) {
            (m.children || []).forEach(function (k) {
              if (k.tag === 'b') runs.push(run(textOf(k), { b: 1, sz: 14, color: '8C0C10' }));
              else if ((k.cls || '').indexOf('rp-tl-tag') >= 0) runs.push(run('  [' + textOf(k) + ']', { b: 1, color: '8C0C10', sz: 11 }));
            });
          } else if (mc.indexOf('rp-tl-text') >= 0) runs.push(run('\n' + textOf(m), { sz: 12, color: '57463F' }));
        });
      }
    });
    return runs;
  }
  function conRuns(el) {
    var runs = [];
    el.children.forEach(function (n) {
      var c = n.cls || '';
      if (c.indexOf('rp-con-h') >= 0) runs.push(run(textOf(n), { b: 1, sz: 14, color: '8C0C10' }));
      else if (c.indexOf('rp-con-row') >= 0) runs.push(run('\n' + textOf(n), { sz: 12, color: '3E3330' }));
    });
    return runs;
  }
  function ffrColRuns(el) {
    var runs = [];
    el.children.forEach(function (n) {
      var c = n.cls || '';
      if (c.indexOf('rp-ffr-l') >= 0) runs.push(run(textOf(n), { sz: 11, color: '8B7368' }));
      else if (c.indexOf('rp-ffr-v') >= 0) runs.push(run('\n' + textOf(n), { b: 1, sz: 22, color: colorOfAttr(n.attrs) || '8C0C10' }));
    });
    return runs;
  }
  function flattenContents(el, out) {
    out.push({ t: 'para', runs: [run('CONTENTS', { b: 1, color: 'B01116', sz: 30 })], opts: { spacing: 'w:before="160" w:after="40"' } });
    out.push({ t: 'para', runs: [run('目 录', { b: 1, color: '8C0C10', sz: 18 })], opts: { spacing: 'w:after="160"' } });
    (el.children || []).forEach(function (n) {
      if (n.tag !== 'ul') return;
      (n.children || []).forEach(function (li) {
        var no = '', tt = '', pg = '';
        (li.children || []).forEach(function (sn) {
          var c = sn.cls || '';
          if (c.indexOf('rp-c-no') >= 0) no = textOf(sn);
          else if (c.indexOf('rp-c-tt') >= 0) tt = textOf(sn);
          else if (c.indexOf('rp-c-pg') >= 0) pg = textOf(sn);
        });
        out.push({ t: 'para', runs: [run(no + '  ', { color: 'C9A05E', sz: 13 }), run(tt, { sz: 14, color: '3E3330' }), run('\t' + pg, { color: '8C0C10', sz: 13 })], opts: { tabs: '9800', spacing: 'w:before="80"' } });
      });
    });
  }
  function tableToXml(el) {
    var rows = [], colCount = 0;
    /* 穿透 thead/tbody/tfoot：表格 HTML 通常为 <table><thead><tr>…</thead><tbody><tr>…</tbody></table> */
    var trs = [];
    (el.children || []).forEach(function (c) {
      if (c.tag === 'tr') trs.push({ tr: c, head: false });
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') {
        var h = c.tag === 'thead';
        (c.children || []).forEach(function (tr) { if (tr.tag === 'tr') trs.push({ tr: tr, head: h }); });
      }
    });
    trs.forEach(function (item) {
      var tr = item.tr, isHead = item.head;
      var cells = [];
      (tr.children || []).forEach(function (tc) {
        if (tc.tag !== 'th' && tc.tag !== 'td') return;
        cells.push({ text: textOf(tc), th: tc.tag === 'th', head: isHead });
      });
      if (cells.length > colCount) colCount = cells.length;
      rows.push({ cells: cells, head: isHead });
    });
    if (!colCount) colCount = 2;
    var cw = Math.floor(9866 / colCount);
    var xml = '<w:tbl><w:tblPr><w:tblW w:w="9866" w:type="dxa"/><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:color="E7D5C7"/><w:left w:val="single" w:sz="4" w:color="E7D5C7"/>' +
      '<w:bottom w:val="single" w:sz="4" w:color="E7D5C7"/><w:right w:val="single" w:sz="4" w:color="E7D5C7"/>' +
      '<w:insideH w:val="single" w:sz="4" w:color="E7D5C7"/><w:insideV w:val="single" w:sz="4" w:color="E7D5C7"/>' +
      '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>';
    var bodyRowIdx = 0;
    rows.forEach(function (r) {
      xml += '<w:tr>';
      var zebra = (!r.head) ? (bodyRowIdx++ % 2 === 0 ? 'FAF5EC' : 'FFFDFA') : null;
      r.cells.forEach(function (c) {
        var shd = c.head ? '<w:shd w:val="clear" w:color="auto" w:fill="94090D"/>' : '<w:shd w:val="clear" w:color="auto" w:fill="' + zebra + '"/>';
        var col = c.head ? 'FBF2E2' : (c.th ? '8C0C10' : '3E3330');
        var rpr = '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>' + (c.head || c.th ? '<w:b/>' : '') + '<w:color w:val="' + col + '"/><w:sz w:val="21"/></w:rPr>';
        xml += '<w:tc><w:tcPr><w:tcW w:w="' + cw + '" w:type="dxa"/>' + shd + '<w:vAlign w:val="center"/></w:tcPr>' +
          '<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>' +
          '<w:r>' + rpr + '<w:t xml:space="preserve">' + oxEsc(c.text) + '</w:t></w:r></w:p></w:tc>';
      });
      xml += '</w:tr>';
    });
    return xml + '</w:tbl>';
  }
  function renderBlocks(out) {
    return out.map(function (b) {
      if (typeof b === 'string') return b;
      if (b.t === 'table') return tableToXml(b.el);
      return para(b.runs, b.opts || {});
    }).join('');
  }
  function coverXml(el) {
    var meta = { '姓 名': '—', '性 别': '—', '日 期': '—' };
    (function w(n) {
      var c = n.cls || '';
      if (c.indexOf('rp-cover-card') >= 0) {
        (n.children || []).forEach(function (row) {
          var t = textOf(row);
          if (t.indexOf('姓 名') >= 0) meta['姓 名'] = t.replace(/姓\s*名\s*/, '').trim();
          else if (t.indexOf('性 别') >= 0) meta['性 别'] = t.replace(/性\s*别\s*/, '').trim();
          else if (t.indexOf('日 期') >= 0) meta['日 期'] = t.replace(/日\s*期\s*/, '').trim();
        });
        return;
      }
      (n.children || []).forEach(w);
    })(el);
    var out = [];
    out.push(para('', { spacing: 'w:before="560" w:after="200"' }));
    out.push(para([run('♥ ', { color: 'A20E12', sz: 22 }), run('BES JUS ', { b: 1, sz: 22, color: '3E3330' }), run('倍佐健康', { b: 1, sz: 22, color: 'A20E12' })], { jc: 'center' }));
    out.push(para(run('心 脑 血 管 数 字 化 服 务', { b: 1, sz: 12, color: 'B01116' }), { jc: 'center', spacing: 'w:before="120" w:after="360"' }));
    out.push(para(run('体检报告解读汇总与健康规划', { b: 1, sz: 34, color: 'A20E12' }), { jc: 'center', spacing: 'w:before="200" w:after="480"' }));
    [['姓 名', meta['姓 名'], 'A20E12'], ['性 别', meta['性 别'], '473A35'], ['日 期', meta['日 期'], '473A35']].forEach(function (kv) {
      out.push(para([run(kv[0], { color: '8B7368', sz: 13 }), run('    ', {}), run(kv[1], { b: 1, sz: 16, color: kv[2] })], { jc: 'center', spacing: 'w:before="160"' }));
    });
    out.push(para(run('健康无忧 · 未来可控', { color: '8B7368', sz: 12 }), { jc: 'center', spacing: 'w:before="900"' }));
    return out.join('');
  }
  function pageXml(el, no, total) {
    if (el.cls.indexOf('rp-cover') >= 0) return coverXml(el);
    var out = [];
    out.push(para([
      run('♥ ', { color: 'B01116', b: 1, sz: 10 }),
      run('BES JUS', { b: 1, sz: 10, color: '8C0C10' }),
      run(' 倍佐健康', { sz: 10, color: '8C0C10' }),
      run('\t', { sz: 10 }),
      run('健康无忧 · 未来可控', { sz: 10, color: '8C0C10' })
    ], { jc: 'both', tabs: '9866', border: 1, spacing: 'w:after="120"' }));
    flattenChildren(el, out);
    out.push(para([
      run('倍佐健康 · 心脑血管健康数字化服务商', { sz: 9, color: 'B39A8C' }),
      run('\t', { sz: 9 }),
      run('第 ' + no + ' 页 · 共 ' + total + ' 页', { sz: 9, color: 'B39A8C' })
    ], { jc: 'both', tabs: '9866', spacing: 'w:before="240"' }));
    return renderBlocks(out);
  }
  /* 报告 HTML -> docx body XML */
  function htmlToDocxXml(html) {
    var root = parseHtml(html);
    var pages = root.children.filter(function (c) {
      return c.tag === 'div' && (c.cls.indexOf('rp-page') >= 0 || c.cls.indexOf('rp-cover') >= 0);
    });
    var out = [];
    for (var i = 0; i < pages.length; i++) {
      if (i > 0) out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      out.push(pageXml(pages[i], i + 1, pages.length));
    }
    out.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>');
    return out.join('');
  }
  function loadJSZipForDocx() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (_zipD) return _zipD;
    _zipD = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'js/lib/jszip.min.js';
      s.onload = function () { window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip 未加载')); };
      s.onerror = function () {
        var c = document.createElement('script');
        c.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
        c.onload = function () { window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip 未加载')); };
        c.onerror = function () { reject(new Error('加载 JSZip 失败')); };
        document.head.appendChild(c);
      };
      document.head.appendChild(s);
    });
    return _zipD;
  }
  var _zipD = null;
  var CT_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';
  var RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  var DOC_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults></w:styles>';
  function exportDocx(result, input, filename) {
    var html = reportBody(result, input);
    var bodyXml = htmlToDocxXml(html);
    var c = result.customer || {};
    var base = '体检报告解读汇总及健康规划_' + (c.name || '') + '_' + (c.type || 'A') + '版';
    var fname = (filename || base).replace(/[\\/:*?"<>|]/g, '') + '.docx';
    return loadJSZipForDocx().then(function (JSZip) {
      var zip = new JSZip();
      zip.file('[Content_Types].xml', CT_XML);
      zip.file('_rels/.rels', RELS_XML);
      zip.file('word/document.xml', DOC_XML_HEAD + bodyXml + DOC_XML_TAIL);
      zip.file('word/styles.xml', STYLES_XML);
      zip.file('word/_rels/document.xml.rels', DOC_RELS_XML);
      return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }
  var DOC_XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>';
  var DOC_XML_TAIL = '</w:body></w:document>';

  /* ---------------- 导出 Word(.doc) 降级方案 ---------------- */
  // 用 HTML 伪装成 .doc：必须显式声明 A4 纵向 + 去掉屏幕预览那套像素"页高"，
  // 否则 Word 打开时会按"内容实际宽高"判定，因快照表多列+min-height 导致宽>高而误判为横向。
  function wrapWord(title, css, bodyHtml) {
    var mso =
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom>' +
      '<w:Sections><w:Section><w:WpPr>' +
      '<w:Orient>portrait</w:Orient>' +
      '<w:PgSz w:w="11906" w:h="16838"/>' +
      '<w:PgMar w:top="1134" w:bottom="1134" w:left="1134" w:right="1134" w:header="720" w:footer="720" w:gutter="0"/>' +
      '</w:WpPr></w:Section></w:Sections></w:WordDocument></xml><![endif]-->';
    var style =
      '<style>' +
      '@page Section1{size:21cm 29.7cm;margin:1.8cm 1.8cm 1.8cm 1.8cm;mso-page-orientation:portrait;}' +
      'div.Section1{page:Section1;}' +
      '.rp-page,.rp-cover{min-height:auto!important;height:auto!important;}' +
      '</style>';
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta charset="utf-8"><title>' + title + '</title>' + mso + style + '</head>' +
      '<body><div class="Section1">' + css + '<div class="rp-root">' + bodyHtml + '</div></div></body></html>';
  }

  function exportWord(result, input, filename) {
    var body = reportBody(result, input);
    var doc = wrapWord('体检报告解读汇总及健康规划', WORD_CSS(), body);
    var blob = new Blob(['﻿', doc], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (filename || ('体检报告解读汇总及健康规划_' + (result.customer.name || '') + '_' + (result.customer.type || 'A') + '版')).replace(/[\\/:*?"<>|]/g, '') + '.doc';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------- 样式 ---------------- */
  function REPORT_CSS() {
    return '<style>' + COMMON_CSS() + PRINT_CSS() + '</style>';
  }
  function WORD_CSS() {
    return '<style>' + COMMON_CSS() +
      '.rp-cover{page-break-after:always;}' +
      '.rp-page{page-break-before:always;}' +
      /* Word 打开时封面后重复分页会产生空白页，紧跟封面的目录页不再另起一页 */
      '.rp-cover + .rp-page{page-break-before:auto;}' +
      '</style>';
  }
  function COMMON_CSS() {
    /* 色板对齐模板 PDF：深红 #8C0C10 / 亮红 #B01116 / 封面红 #A20E12 / 表头红 #94090D /
       金 #C9A05E / 米白字 #FBF2E2 / 正文 #3E3330 / 卡片文 #57463F / 标签 #8B7368 / 页脚 #B39A8C /
       边框 #E7D5C7·#EBD3C7 / 斑马 #FFFDFA·#FAF5EC / 标签底 #F5E7DF */
    return '' +
    /* 根 */
    '.rp-root{font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;color:#3E3330;font-size:13px;line-height:1.9;}' +
    /* 封面（字号按模板 pt×1.33 换算：标题 30pt→40px、标语 10pt→13px、姓名 13pt→17px、卡 335pt→446px） */
    '.rp-cover{height:1030px;display:flex;flex-direction:column;align-items:center;background:#fff;position:relative;}' +
    '.rp-cover-logo{margin-top:56px;text-align:center;}' +
    '.rp-logo-icon{color:#A20E12;font-size:24px;margin-right:6px;}' +
    '.rp-logo-text{font-size:22px;letter-spacing:2px;color:#3E3330;}' +
    '.rp-logo-text b{color:#A20E12;}' +
    '.rp-cover-band{margin-top:20px;background:#B01116;color:#FBF2E2;font-size:13px;letter-spacing:7px;padding:6px 22px 6px 29px;}' +
    '.rp-cover-title{font-size:40px;font-weight:800;margin:40px 0 34px;letter-spacing:5px;color:#A20E12;text-align:center;}' +
    '.rp-cover-banner{width:100%;height:200px;background:linear-gradient(90deg,#8C0C10,#B01116 60%,#d43a2f);display:flex;align-items:center;padding:0 40px;box-sizing:border-box;}' +
    '.rp-banner-heart{color:#FBF2E2;font-size:46px;margin-right:16px;}' +
    '.rp-banner-ecg{flex:1;height:64px;background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'40\'%3E%3Cpolyline points=\'0,20 100,20 130,20 150,5 165,35 180,20 260,20 290,20 310,8 325,32 340,20 600,20\' fill=\'none\' stroke=\'%23FBF2E2\' stroke-width=\'2.5\'/%3E%3C/svg%3E") repeat-x center;background-size:auto 64px;}' +
    '.rp-cover-card{margin-top:26px;width:430px;background:#fff;border:1px solid #E4D3C7;border-top:3px solid #B01116;padding:14px 36px;box-sizing:border-box;}' +
    '.rp-cover-card>div{display:flex;align-items:baseline;gap:18px;padding:13px 0;border-bottom:1px solid #F1D9D1;}' +
    '.rp-cover-card>div:last-child{border-bottom:none;}' +
    '.rp-cover-card span{color:#8B7368;letter-spacing:2px;font-size:14px;width:60px;flex:none;}' +
    '.rp-cover-card b{color:#473A35;font-size:15px;letter-spacing:1px;}' +
    '.rp-cover-card b.rp-cv-nm{color:#A20E12;font-size:17px;}' +
    '.rp-cover-footer{margin-top:auto;margin-bottom:58px;color:#8B7368;letter-spacing:6px;font-size:12px;}' +
    /* 页面 + 页眉页脚 */
    '.rp-page{position:relative;min-height:1030px;padding:64px 56px 78px;box-sizing:border-box;}' +
    '.rp-ph{position:absolute;top:22px;left:56px;right:56px;display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;border-bottom:1.5px solid #B01116;}' +
    '.rp-ph-logo{display:flex;align-items:center;gap:6px;color:#8C0C10;font-size:12px;}' +
    '.rp-ph-logo .rp-logo-icon{color:#B01116;font-size:14px;}' +
    '.rp-ph-logo b{color:#8C0C10;font-weight:700;}' +
    '.rp-ph-slogan{color:#8C0C10;font-size:11px;letter-spacing:2px;}' +
    '.rp-pf{position:absolute;bottom:26px;left:56px;right:56px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #E7D5C7;padding-top:8px;color:#B39A8C;font-size:10px;letter-spacing:1px;}' +
    /* 目录（CONTENTS 44pt→54px、目录 19pt→25px、条目 12pt→16px、编号/页码 11pt→15px） */
    '.rp-contents{margin:56px 0 0;}' +
    '.rp-contents-en{font-size:54px;font-weight:800;color:#B01116;letter-spacing:3px;line-height:1.1;}' +
    '.rp-contents-tt{font-size:25px;font-weight:700;color:#8C0C10;letter-spacing:6px;margin:8px 0 4px;}' +
    '.rp-contents-tt::after{content:"";display:block;width:96px;height:3px;background:#C9A05E;margin-top:12px;}' +
    '.rp-contents ul{list-style:none;padding:0;margin:40px 0 0;}' +
    '.rp-contents li{display:flex;align-items:baseline;padding:19px 2px;border-bottom:1px solid #E7D5C7;font-size:16px;}' +
    '.rp-contents li .rp-c-no{color:#C9A05E;font-size:15px;width:52px;flex:none;letter-spacing:1px;}' +
    '.rp-contents li .rp-c-tt{color:#3E3330;flex:1;}' +
    '.rp-contents li .rp-c-pg{color:#8C0C10;font-size:15px;}' +
    /* 章节标题 PART XX */
    '.rp-sec{margin:26px 0 22px;}' +
    '.rp-sec-part{font-size:11px;color:#C9A05E;font-weight:700;letter-spacing:2px;margin-bottom:8px;}' +
    '.rp-sec-main{display:flex;justify-content:space-between;align-items:flex-end;}' +
    '.rp-sec-tt{font-size:27px;color:#8C0C10;font-weight:800;}' +
    '.rp-sec-bg{font-size:62px;font-weight:800;color:#B01116;line-height:.9;}' +
    '.rp-sec-line{height:2px;background:#B01116;margin-top:12px;}' +
    /* 附录标题（14pt→19px） */
    '.rp-sec-app .rp-sec-cn{font-size:19px;color:#8C0C10;font-weight:800;}' +
    '.rp-sec-app .rp-sec-en{font-size:10px;color:#C9A05E;letter-spacing:2px;font-style:normal;margin-left:12px;font-weight:400;}' +
    '.rp-sec-app .rp-sec-line{height:1px;background:#EBD3C7;margin-top:12px;}' +
    /* 小节标题（12.5pt→17px；红方块图标 + 左红右米下划线） */
    '.rp-ad-h,.rp-ov-h{font-weight:700;color:#8C0C10;margin:22px 0 12px;font-size:17px;display:flex;align-items:center;gap:9px;padding-bottom:9px;background:linear-gradient(90deg,#B01116 0,#B01116 96px,#EBD3C7 96px,#EBD3C7 100%) bottom no-repeat;background-size:100% 1px;}' +
    '.rp-ad-h-ic{flex:none;width:11px;height:11px;background:#B01116;}' +
    /* 基本信息（4×2 等宽斑马格；标签 8pt→11px、值 11.5pt→15px） */
    '.rp-basic-h,.rp-ffr-h{display:flex;justify-content:space-between;align-items:baseline;margin:16px 0 10px;}' +
    '.rp-basic-h b{color:#8C0C10;font-size:17px;font-weight:700;}' +
    '.rp-ffr-h b{color:#8C0C10;font-size:14px;font-weight:700;}' +
    '.rp-basic-h i,.rp-ffr-h i{color:#C9A05E;font-size:10px;letter-spacing:2px;font-style:normal;}' +
    '.rp-bi-tb{table-layout:fixed;}' +
    '.rp-bi-tb td{width:25%;padding:11px 6px !important;text-align:center !important;}' +
    '.rp-bi-tb td:nth-child(odd){background:#FAF5EC;}' +
    '.rp-bi-tb td:nth-child(even){background:#FFFDFA;}' +
    '.rp-bi-l{font-size:11px;color:#8B7368;letter-spacing:1px;margin-bottom:4px;}' +
    '.rp-bi-v{font-size:15px;color:#3E3330;font-weight:600;}' +
    '.rp-basic-note{margin-top:12px;background:#FAF5EC;border:1px solid #E7D5C7;border-left:3px solid #C9A05E;padding:9px 14px;color:#8B7368;font-size:12px;line-height:1.8;}' +
    /* 表格（深红表头 + 斑马纹 + 米色边框；表头 10.5pt→14px、正文 9.8pt→13px） */
    '.rp-tb{width:100%;border-collapse:collapse;margin:8px 0;}' +
    '.rp-tb th,.rp-tb td{border:1px solid #E7D5C7;padding:8px 10px;text-align:left;vertical-align:top;font-size:13px;}' +
    '.rp-tb thead th{background:#94090D;color:#FBF2E2;font-weight:600;border-color:#94090D;font-size:14px;}' +
    '.rp-tb tbody th{color:#8C0C10;font-weight:700;background:#FFFDFA;width:15%;}' +
    '.rp-tb tbody tr:nth-child(odd) td{background:#FAF5EC;}' +
    '.rp-tb tbody tr:nth-child(even) td{background:#FFFDFA;}' +
    /* 区块 */
    '.rp-basic,.rp-snap,.rp-ov,.rp-ad,.rp-con,.rp-diet,.rp-menu,.rp-ffr{margin:14px 0;}' +
    '.rp-ov-b{margin:0;color:#3E3330;}' +
    /* 上传正文富文本渲染（richTextHtml）：段落间距统一，表格复用 .rp-tb */
    '.rp-txt{margin:6px 0;color:#3E3330;line-height:1.9;}' +
    '.rp-ov-b table{margin:6px 0 10px;}' +
    '.rp-ov-b b{color:#8C0C10;}' +
    /* FFR 三列大数值（值 21pt→28px、标签 8.5pt→11px） */
    '.rp-ffr{border-top:1px solid #EBD3C7;border-bottom:1px solid #EBD3C7;padding:12px 0 14px;}' +
    '.rp-ffr-h{margin-top:0;}' +
    '.rp-ffr-cols{display:flex;}' +
    '.rp-ffr-col{flex:1;text-align:center;padding:6px 0;}' +
    '.rp-ffr-col+.rp-ffr-col{border-left:1px solid #EBD3C7;}' +
    '.rp-ffr-l{font-size:11px;color:#8B7368;letter-spacing:1px;margin-bottom:4px;}' +
    '.rp-ffr-v{font-size:28px;font-weight:800;color:#8C0C10;}' +
    '.rp-ffr-note{margin-top:10px;color:#8B7368;font-size:12px;text-align:center;}' +
    /* 建议编号项（红方块 + 深色标题；标题 11pt→15px、正文 10.5pt→14px） */
    '.rp-ad-item{display:flex;gap:12px;margin:14px 0;}' +
    '.rp-ad-no{flex:none;width:22px;height:20px;background:#B01116;color:#FBF2E2;text-align:center;line-height:20px;font-size:12px;margin-top:2px;}' +
    '.rp-ad-item b{color:#3E3330;font-size:15px;}' +
    '.rp-ad-item p{margin:4px 0 0;color:#3E3330;font-size:13px;}' +
    '.rp-ad-empty{color:#8B7368;}' +
    /* 随访时间线（标题 11pt→15px、正文 9.8pt→13px） */
    '.rp-timeline{display:flex;flex-direction:column;gap:18px;margin-top:12px;}' +
    '.rp-tl-item{display:flex;gap:14px;position:relative;padding-bottom:8px;}' +
    '.rp-tl-item:not(:last-child)::before{content:"";position:absolute;left:12px;top:28px;bottom:0;width:1px;background:#EBD3C7;}' +
    '.rp-tl-num{flex:none;width:24px;height:24px;border-radius:50%;border:1.5px solid #B01116;color:#8C0C10;text-align:center;line-height:24px;font-size:12px;background:#fff;}' +
    '.rp-tl-body{flex:1;}' +
    '.rp-tl-top{display:flex;align-items:center;gap:10px;margin-bottom:4px;}' +
    '.rp-tl-top b{font-size:15px;color:#8C0C10;}' +
    '.rp-tl-tag{background:#F5E7DF;color:#8C0C10;font-size:10px;padding:2px 10px;border-radius:9px;}' +
    '.rp-tl-text{color:#57463F;font-size:13px;line-height:1.8;}' +
    /* 5. 医学指南知识库参考（lit 卡片） */
    '.rp-lit{background:#FFFDFA;border:1px solid #E7D5C7;border-left:3px solid #B01116;padding:12px 16px;margin:10px 0;}' +
    '.rp-lit-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}' +
    '.rp-lit-head b{font-size:15px;color:#8C0C10;}' +
    '.rp-lit-head span{font-size:10px;color:#8B7368;}' +
    '.rp-lit-sec{font-weight:700;color:#57463F;font-size:12px;margin:8px 0 4px;}' +
    '.rp-lit ul{margin:0;padding-left:18px;}' +
    '.rp-lit li{color:#57463F;font-size:12px;line-height:1.9;}' +
    '.rp-lit-drug{color:#57463F;font-size:12px;line-height:1.9;margin:4px 0;}' +
    /* 生活方式 2×2 卡片（标题 10.8pt→14px、正文 9.6pt→13px） */
    '.rp-life-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;}' +
    '.rp-life-card{background:#FFFDFA;border:1px solid #E7D5C7;border-top:2px solid #B01116;padding:12px 16px;}' +
    '.rp-life-card b{font-size:14px;color:#8C0C10;}' +
    '.rp-life-card p{margin:6px 0 0;color:#57463F;font-size:13px;line-height:1.9;}' +
    /* 专家会诊卡片 */
    '.rp-con{background:#FFFDFA;border:1px solid #E7D5C7;border-top:2px solid #B01116;padding:12px 16px;margin:12px 0;}' +
    '.rp-con-h{font-weight:700;color:#8C0C10;font-size:14px;}' +
    '.rp-con-row{margin:5px 0;color:#3E3330;font-size:13px;}' +
    '.rp-con-row b{color:#8B7368;}' +
    /* 饮食原则 */
    '.rp-diet-h{color:#8C0C10;font-weight:700;margin-bottom:8px;letter-spacing:1px;font-size:14px;}' +
    '.rp-diet ul,.rp-life-g ul{margin:6px 0;padding-left:20px;}' +
    '.rp-diet li{margin:5px 0;color:#3E3330;font-size:13px;}' +
    '.rp-diet li b{color:#B01116;}' +
    '.rp-diet-note{margin-top:12px;padding:10px 14px;background:#FAF5EC;border:1px solid #C9A05E;border-left:3px solid #C9A05E;color:#8B7368;font-size:12px;line-height:1.9;}' +
    '.rp-menu-tip{color:#3E3330;font-size:13px;line-height:1.9;margin:0 0 10px;}' +
    '.rp-menu-tip b{color:#B01116;}' +
    '.rp-life-g b{color:#8C0C10;}' +
    '.rp-life-g li{color:#3E3330;font-size:13px;margin:4px 0;}' +
    /* 健康寄语（标题 14pt→19px、称呼/正文 10.8pt→14px） */
    '.rp-msg-h{font-size:19px;font-weight:800;color:#A20E12;letter-spacing:4px;margin:24px 0 6px;}' +
    '.rp-msg-h::after{content:"";display:block;width:64px;height:2px;background:#C9A05E;margin-top:10px;}' +
    '.rp-message{margin-top:18px;}' +
    '.rp-message-greet{margin:0 0 14px;font-weight:700;color:#A20E12;font-size:14px;}' +
    '.rp-message-p{margin:0 0 12px;color:#473A35;font-size:14px;line-height:2.1;text-indent:2em;}';
  }
  function PRINT_CSS() {
    return '@media print{' +
      'body{margin:0;}' +
      '.rp-root *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      '.rp-page{page-break-before:always;}' +
      '.rp-cover{page-break-after:always;}' +
      /* 空白页修复：屏幕预览用固定页高(1030px)一页一屏，打印时取消固定高，
         内容自然流动，避免每页溢出 13px 导致连续空白页 */
      '.rp-page{min-height:auto!important;height:auto!important;}' +
      '.rp-cover{height:auto!important;min-height:0!important;}' +
      /* 分页片段各自复制 padding：跨物理页的续页也保留上/下/左右留白，
         配合 @page margin:0 时中间页不贴边 */
      '.rp-page{box-decoration-break:clone;-webkit-box-decoration-break:clone;}' +
      /* 封面后紧跟的目录页不再重复分页（封面已 break-after），消除封面后空白页 */
      '.rp-cover + .rp-page{page-break-before:auto!important;}' +
      /* 去除浏览器打印页眉页脚（URL、页码、日期）：margin 0 使 Chromium 无空间渲染 */
      '.rp-cover{box-sizing:border-box;padding:14mm 14mm 0;}' +
      '@page{size:A4;margin:0;}' +
    '}';
  }

  global.ReportGen = {
    reportBody: reportBody,
    buildPreview: buildPreview,
    exportDocx: exportDocx,
    htmlToDocxXml: htmlToDocxXml,
    parseHtml: parseHtml,
    coverXml: coverXml,
    pageXml: pageXml,
    exportWord: exportWord,
    wrapWord: wrapWord,
    draftNarrative: draftNarrative,
    commonCSS: COMMON_CSS,
    printCSS: PRINT_CSS,
    coverHtml: coverHtml,
    cleanAppTitle: cleanAppTitle,
    isDupBuiltin: isDupBuiltin,
    matchBuiltinTitle: matchBuiltinTitle,
    richTextHtml: richTextHtml,
    builtinAppendixA: BUILTIN_APPENDIX_A,
    builtinAppendixB: BUILTIN_APPENDIX_B
  };
})(window);
