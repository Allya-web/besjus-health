/* =============================================================
 * 年度总结报告生成器 annual-report.js
 * 依据《年度健康总结报告》模板渲染：
 * 封面 → 目录 → 01 年度健康回顾 / 02 健康问题年度追踪
 * → 03 生活方式年度总结 → 04 下一年度健康规划 → 05 健康寄语
 * 数据来源：客户档案（quarters{} 季度小结 + checkins{} 12个月打卡
 *          + core_issues 核心健康问题 + input.metrics 基线指标）
 * 支持浏览器打印（PDF）与导出 Word(.doc 纵向 A4)
 * ============================================================= */
(function (global) {
  'use strict';
  var RG = global.ReportGen;

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  var CN_NO = ['一', '二', '三', '四', '五', '六', '七', '八'];

  /* ---------- 工具 ---------- */
  function num(x) { var n = Number(x); return (x !== '' && x != null && !isNaN(n)) ? n : null; }
  function avg(a) { return a && a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function r1(x) { return x == null ? '—' : (Math.round(x * 10) / 10); }
  function sleepHoursOf(ck) {
    if (ck.sleepHours != null) return num(ck.sleepHours);
    var m = { '好': 7.5, '一般': 6.5, '差': 5 };
    return ck.sleep != null && m[ck.sleep] != null ? m[ck.sleep] : null;
  }
  function sec(no, cn, en) {
    return '<div class="rp-sec"><span class="rp-sec-no">' + no + '</span><div class="rp-sec-tt"><b>' + esc(cn) + '</b><i>' + esc(en) + '</i></div></div>';
  }
  function pageHead() { return '<div class="rp-ph"><span>健康无忧 · 未来可控</span></div>'; }
  function pageFoot() { return '<div class="rp-pf">倍佐健康 · 心脑血管健康数字化服务商</div>'; }

  /* 核心健康问题 → 系统分组（关键词映射） */
  var SYS_MAP = [
    [/颈动脉|主动脉|冠脉|冠心|血压|心 |心律|瓣膜/, '心脑血管'],
    [/血脂|胆固醇|LDL|HDL|甘油三酯|载脂蛋白/, '血脂代谢'],
    [/血糖|糖化|胰岛素|甲状腺|结节|TIRADS|TI-RADS|尿酸/, '内分泌'],
    [/骨|维D|维生素D|钙 /, '骨骼'],
    [/肺|呼吸|CYFRA|支气管/, '呼吸'],
    [/肝|胃|肠|Hp|幽门|胆囊|胰腺|反流/, '消化'],
    [/肾|尿|前列腺|膀胱/, '泌尿'],
    [/眼|白内障|视网膜|视力/, '眼科'],
    [/牙|口腔|龋|牙周/, '口腔']
  ];
  function systemOf(issue) {
    for (var i = 0; i < SYS_MAP.length; i++) if (SYS_MAP[i][0].test(issue)) return SYS_MAP[i][1];
    return '其他';
  }

  /* =============================================================
   * v53 基础指标年度追踪表
   * 数据来源：客户档案 retests{}（按 "Q*_YYYY" 存储的当季复查检查单）
   * 行级门控：仅显示"入组异常 ∪ 核心健康问题 ∪ 当季复查覆盖"的行；否则整表不渲染。
   * ============================================================= */
  var ANNUAL_SNAP = [
    { code: 'bp',      label: '血压',          unit: 'mmHg' },
    { code: 'weight',  label: '体重',          unit: 'kg' },
    { code: 'hr',      label: '心率',          unit: '次/分' },
    { code: 'fpg',     label: '空腹血糖',      unit: 'mmol/L' },
    { code: 'tc',      label: '总胆固醇',      unit: 'mmol/L' },
    { code: 'ldl',     label: '低密度脂蛋白',  unit: 'mmol/L' },
    { code: 'tg',      label: '甘油三酯',      unit: 'mmol/L' },
    { code: 'waist',   label: '腰围',          unit: 'cm' },
    { code: 'ua',      label: '血尿酸',        unit: 'μmol/L' },
    { code: 'vitd',    label: '25 羟维生素 D', unit: 'ng/mL' },
    { code: 'bmd',     label: '骨密度 T 值',   unit: 'T' },
    { code: 'cyfra21', label: 'CYFRA21-1',     unit: 'ng/mL' },
    { code: 'ggt',     label: '谷氨酰转肽酶',  unit: 'U/L' },
    { code: 'egfr',    label: '肾小球滤过率',  unit: 'mL/min' }
  ];
  var RETEST_FIELD_TO_CODE = {
    weight: 'weight', hr: 'hr', fpg: 'fpg', tc: 'tc', ldl: 'ldl', tg: 'tg',
    waist: 'waist', ua: 'ua', vitd: 'vitd', bmd: 'bmd',
    cyfra21: 'cyfra21', ggt: 'ggt', egfr: 'egfr'
  };
  function retestValueOf(retest, code) {
    if (!retest || !retest.metrics) return null;
    var m = retest.metrics;
    if (code === 'bp') {
      return (m.sbp != null && m.dbp != null) ? (m.sbp + '/' + m.dbp) : null;
    }
    var field = null;
    Object.keys(RETEST_FIELD_TO_CODE).forEach(function (k) { if (RETEST_FIELD_TO_CODE[k] === code) field = k; });
    if (!field) return null;
    return m[field] != null ? m[field] : null;
  }
  function basicMetricsYearTable(r) {
    var issues = (r.baseline && r.baseline.coreIssues) || [];
    var anomalyCodes = (global.KB && global.KB.snapCodesForTags) ? global.KB.snapCodesForTags(issues) : [];
    var year = Number(r.customer && r.customer.year) || new Date().getFullYear();
    var qs = ['Q1', 'Q2', 'Q3', 'Q4'];
    var quarters = qs.map(function (q) {
      var key = q + '_' + year;
      return { key: q, retest: (r.retests || {})[key] || null };
    });
    var rows = ANNUAL_SNAP.map(function (sp) {
      var cells = quarters.map(function (q) {
        if (!q.retest) return { text: '—', covered: false };
        var v = retestValueOf(q.retest, sp.code);
        if (v == null) return { text: '—', covered: false };
        return { text: v + (sp.unit ? ' ' + sp.unit : ''), covered: true };
      });
      return { code: sp.code, label: sp.label, anomaly: anomalyCodes.indexOf(sp.code) >= 0, cells: cells };
    });
    /* 行级门控：必须 ① 该指标之前异常 ② 至少一个季度当季复查覆盖了该指标 */
    rows = rows.filter(function (row) { return row.anomaly && row.cells.some(function (c) { return c.covered; }); });
    if (!rows.length) return '';
    var html = '<div class="ar-sub">3. 基础指标年度追踪</div>';
    html += '<p class="ar-lead">基于本年度客户上传的复查检查单，按"入组异常 + 当季复查覆盖"原则呈现；未上传复查的指标整体不显示，避免展示无依据的空壳行。</p>';
    html += '<table class="rp-tb ar-tb"><thead><tr><th style="width:18%">指 标</th>' +
      quarters.map(function (q) { return '<th>' + esc(q.key) + ' 复查值</th>'; }).join('') +
      '<th style="width:18%">复查日期</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var dateCell = quarters.map(function (q) { return q.retest && q.retest.date ? esc(q.key + '：' + q.retest.date) : ''; }).filter(Boolean).join('<br>');
      html += '<tr><th>' + esc(row.label) + '</th>' +
        row.cells.map(function (c) { return '<td>' + esc(c.text) + '</td>'; }).join('') +
        '<td>' + (dateCell || '—') + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /* 复查监测计划（按核心问题生成） */
  function recheckPlanOf(issues, nextExamDate) {
    var plan = [];
    var has = function (re) { return issues.some(function (s) { return re.test(s); }); };
    if (has(/甲状腺|结节/)) plan.push(['甲状腺超声', nextExamDate + '（6 个月后）', '监测结节变化（TI-RADS 分级）']);
    if (has(/颈动脉|主动脉|冠脉|冠心/)) plan.push(['颈动脉超声', nextExamDate + '（12 个月后）', '监测内膜与斑块变化']);
    if (has(/血脂|胆固醇|LDL/)) plan.push(['血脂四项', nextExamDate + '（年度体检）', '评估血脂趋势与干预效果']);
    if (has(/肺|结节|CYFRA/)) plan.push(['胸部 CT', nextExamDate + '（年度）', '肺结节年度随访']);
    if (has(/骨|维D|维生素D/)) plan.push(['骨密度 + 维生素D', nextExamDate + '（年度）', '评估骨质疏松干预效果']);
    if (has(/血糖|糖化/)) plan.push(['空腹血糖 + 糖化血红蛋白', nextExamDate + '（3 个月后）', '评估血糖控制情况']);
    if (has(/Hp|幽门/)) plan.push(['C13/C14 呼气试验', nextExamDate + '（6 个月后）', '确认 Hp 根除效果']);
    if (has(/血压|心/)) plan.push(['血压监测 + 心电图', nextExamDate + '（3 个月后）', '评估血压控制与心律情况']);
    if (has(/肝|囊肿/)) plan.push(['腹部超声 + 肝功能', nextExamDate + '（年度）', '监测肝囊肿与肝酶变化']);
    if (has(/肾|尿/)) plan.push(['尿常规 + 肾功能', nextExamDate + '（年度）', '监测泌尿系统变化']);
    if (has(/眼|白内障/)) plan.push(['眼科检查', nextExamDate + '（年度）', '白内障进展评估']);
    if (has(/牙|口腔/)) plan.push(['口腔洁牙 + 检查', nextExamDate + '（6 个月后）', '牙周维护']);
    if (!plan.length) plan.push(['年度全面体检', nextExamDate + '（年度）', '全面评估健康状态']);
    plan.push(['血压 / 体重居家监测', '每月', '月度打卡跟踪']);
    return plan;
  }

  /* ---------- 滚动季度区间（v3.0：按入组日每 3 个月为一季度） ---------- */
  function rollingQuarterRanges(enrollDate, year) {
    var y = Number(year) || new Date().getFullYear();
    var base = enrollDate ? new Date(enrollDate) : null;
    var hasEnroll = !!(base && !isNaN(base.getTime()));
    var ranges = [];
    for (var i = 0; i < 4; i++) {
      var s, e, label;
      if (hasEnroll) {
        var anchor = new Date(y, base.getMonth(), Math.min(base.getDate(), 28));
        s = new Date(anchor); s.setMonth(s.getMonth() + 3 * i);
        e = new Date(anchor); e.setMonth(e.getMonth() + 3 * (i + 1)); e.setDate(e.getDate() - 1);
        label = 'Q' + (i + 1) + '（' + (s.getMonth() + 1) + '月' + s.getDate() + '日-' + (e.getMonth() + 1) + '月' + e.getDate() + '日）';
      } else {
        s = new Date(y, 3 * i, 1);
        e = new Date(y, 3 * (i + 1), 0);
        label = 'Q' + (i + 1) + '（M' + (3 * i + 1) + '-M' + (3 * (i + 1)) + '）';
      }
      ranges.push({ key: 'Q' + (i + 1), label: label, start: s, end: e });
    }
    return ranges;
  }

  /* ---------- 生活方式：12 个月打卡按滚动季度聚合（无入组日时退回固定日历季度） ---------- */
  function lifestyleRows(checkins, year, enrollDate) {
    var ranges = rollingQuarterRanges(enrollDate, year);
    var qs = { Q1: [], Q2: [], Q3: [], Q4: [] };
    var used = 0;
    Object.keys(checkins || {}).forEach(function (k) {
      var ck = checkins[k]; if (!ck) return;
      var m = /^(\d{4})-(\d{2})$/.exec(k || ck.month || '');
      if (!m) return;
      var dt = new Date(Number(m[1]), Number(m[2]) - 1, 15);
      for (var i = 0; i < ranges.length; i++) {
        if (dt >= ranges[i].start && dt <= ranges[i].end) {
          qs[ranges[i].key].push(ck);
          used++;
          break;
        }
      }
    });
    function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
    function pick(q, fn, agg) {
      var arr = qs[q]; if (!arr || !arr.length) return '—';
      if (agg === 'avg') { var vs = arr.map(fn).filter(function (x) { return x != null; }); return vs.length ? r1(avg(vs)) : '—'; }
      if (agg === 'last') { for (var i = arr.length - 1; i >= 0; i--) { var v = fn(arr[i]); if (v != null && v !== '') return v; } return '—'; }
      return '—';
    }
    function nOf(f) { return function (ck) { return num(f(ck)); }; }
    var rows = [
      ['饮食结构', function (q) { return pick(q, function (ck) { return ck.diet || ''; }, 'last'); }],
      ['油炸/高脂', function (q) { return pick(q, function (ck) { return ck.fried || ''; }, 'last'); }],
      ['运动次数（次/周）', function (q) { return pick(q, nOf(function (ck) { return ck.exFreq; }), 'avg'); }],
      ['体重（kg）', function (q) { return pick(q, nOf(function (ck) { return ck.weight; }), 'avg'); }],
      ['睡眠（h/晚）', function (q) { return pick(q, function (ck) { return sleepHoursOf(ck); }, 'avg'); }],
      ['规律服药', function (q) { return pick(q, function (ck) { return (ck.medDays === '是' || ck.medDays === '否') ? ck.medDays : (ck.medDays != null && ck.medDays !== '' ? String(ck.medDays) + ' 天/月' : ''); }, 'last'); }],
      ['吸烟（支/天）', function (q) { return pick(q, nOf(function (ck) { return ck.smoke; }), 'avg'); }],
      ['饮酒频次', function (q) { return pick(q, function (ck) { return ck.drink || ''; }, 'last'); }]
    ];
    return {
      labels: ranges.map(function (r) { return r.label; }),
      months: used,
      rows: rows.map(function (row) {
        var label = row[0], fn = row[1];
        var vals = ['Q1', 'Q2', 'Q3', 'Q4'].map(function (q) { return fn(q); });
        return { dim: label, vals: vals, trend: trendOf(label, vals) };
      })
    };
  }
  function trendOf(dim, vals) {
    var nums = vals.map(function (v) { return typeof v === 'number' ? v : null; });
    var first = null, lastV = null;
    for (var i = 0; i < nums.length; i++) if (nums[i] != null) { first = nums[i]; break; }
    for (var j = nums.length - 1; j >= 0; j--) if (nums[j] != null) { lastV = nums[j]; break; }
    if (first == null || lastV == null) return '➡️ 数据待积累';
    var d = lastV - first;
    var up = /运动|睡眠|服药/.test(dim), down = /吸烟|油炸/.test(dim);
    if (Math.abs(d) < 0.15) return '➡️ 稳定';
    if ((d > 0) === up && !down) return '📈 ' + (d > 0 ? '改善' : '维持');
    if (down && d < 0) return '📈 显著改善';
    if (down && d > 0) return '⚠️ 有所回升，需关注';
    if ((d > 0) === up) return '📈 改善';
    return d > 0 ? '⚠️ 有所上升，需关注' : '📉 有所下降，需关注';
  }

  /* ---------- 健康问题年度追踪表 ---------- */
  function issueTrackRows(r) {
    var issues = r.baseline.coreIssues || [];
    if (!issues.length) issues = ['暂未录入核心健康问题'];
    var m = r.baseline.metrics || {};
    var lastAgg = r.quarters && r.quarters.length ? r.quarters[r.quarters.length - 1].agg : {};
    var metricPair = [
      [/血脂|胆固醇|LDL|HDL/, function () { return pair('TC ' + (m.tc || '—'), (lastAgg.tc != null ? 'TC ' + lastAgg.tc : null)); }],
      [/血糖/, function () { return pair('空腹 ' + (m.fpg || '—'), (lastAgg.fpg != null ? '空腹 ' + lastAgg.fpg : null)); }],
      [/血压/, function () { return pair((m.sbp || '—') + '/' + (m.dbp || '—'), (lastAgg.sbp != null ? lastAgg.sbp + '/' + lastAgg.dbp : null)); }],
      [/体重|肥胖/, function () { return pair((m.weight || '—') + 'kg', (lastAgg.weight != null ? lastAgg.weight + 'kg' : null)); }]
    ];
    function pair(a, b) { return b ? a + ' → ' + b : a; }
    return issues.map(function (iss) {
      var base = '同基线', cur = null;
      for (var i = 0; i < metricPair.length; i++) {
        if (metricPair[i][0].test(iss)) { cur = metricPair[i][1](); break; }
      }
      var val = cur || base;
      var assess = /稳定/.test(val) ? '✅ 稳定' : (cur ? '➡️ 需关注' : '➡️ 按计划复查');
      return { sys: systemOf(iss), issue: iss, val: val, assess: assess };
    });
  }

  /* ---------- 正文 ---------- */
  function reportBody(r) {
    var c = r.customer || {};
    var b = (global.KB && global.KB.BRAND) || { name: '倍佐健康', desc: '心脑血管健康数字化服务', slogan: '健康无忧 · 未来可控' };
    var honor = (c.gender === '女') ? '女士' : '先生';
    var year = Number(c.year || new Date().getFullYear());
    var dateText = c.reportDate || new Date().toISOString().slice(0, 10);

    var chapters = [
      '01 年度健康回顾', '02 健康问题年度追踪', '03 生活方式年度总结',
      '04 下一年度健康规划', '05 健康寄语'
    ];
    var html = '';

    /* ===== 封面（统一模板，仅标题与 AB 报告不同：年度健康总结报告） ===== */
    html += RG.coverHtml({ title: '年度健康总结报告', customer: c, date: dateText });

    /* ===== 目录 ===== */
    html += '<div class="rp-page">' + pageHead() + '<div class="rp-contents"><h2>目 录 · CONTENTS</h2><ul>';
    chapters.forEach(function (ch, i) { html += '<li><span>' + esc(ch) + '</span><span class="dot"></span><span>' + (i + 3) + '</span></li>'; });
    html += '</ul></div>' + pageFoot() + '</div>';

    /* ===== PART 01 年度健康回顾 + PART 02 健康问题年度追踪 ===== */
    html += '<div class="rp-page">' + pageHead();
    html += sec('01', '一、年度健康回顾', 'PART 01 · ANNUAL HEALTH REVIEW');
    html += annualBasicInfo(r);
    html += '<div class="ar-note">数据来源说明：本报告数据来源于客户入组时的基线评估（' + esc(r.baseline.source || '体检报告') +
      '）、各季度随访报告、月度打卡数据及年度复查结果。</div>';
    html += '<div class="ar-note">本年度共完成 <b>' + (r.summary.checkinMonths || 0) + '</b> 个月度打卡（' +
      (r.summary.checkinMonths ? Math.round(r.summary.checkinMonths / 12 * 100) : 0) + '%），生成 <b>' +
      (r.summary.quarterReports || 0) + '</b> 份季度小结' +
      (r.summary.abReports ? '，归档《体检报告解读汇总及健康规划》' + r.summary.abReports + ' 份' : '') + '。</div>';

    html += sec('02', '二、健康问题年度追踪', 'PART 02 · ANNUAL ISSUE TRACKING');
    html += '<p class="ar-lead">首份报告识别的健康问题，按系统分组展示年度变化。</p>';
    var tracks = issueTrackRows(r);
    html += '<table class="rp-tb ar-tb"><thead><tr><th style="width:12%">系 统</th><th style="width:34%">健 康 问 题</th><th style="width:28%">基线 → 当前</th><th>年 度 评 估</th></tr></thead><tbody>';
    tracks.forEach(function (t) {
      html += '<tr><th>' + esc(t.sys) + '</th><td>' + esc(t.issue) + '</td><td>' + esc(t.val) + '</td><td>' + esc(t.assess) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="ar-note">评估标记说明：✅ 稳定/改善 = 继续当前管理；➡️ 需关注 = 按计划复查或持续关注；⚠️ 需干预 = 需调整方案或转诊。</div>';
    /* v53 基础指标年度追踪表：放在 PART 02 健康问题追踪之后，复查覆盖门控；空表时整块不显示 */
    var basicMetricsHtml = basicMetricsYearTable(r);
    if (basicMetricsHtml) {
      html += basicMetricsHtml;
      html += '<div class="ar-note">数据来源说明：本表数据来源于客户当季上传的复查检查单（Q1/Q2/Q3/Q4），按报告生成年份聚合。仅显示"入组异常 + 当季复查覆盖"指标；其他指标需复查后归档。</div>';
    }
    html += pageFoot() + '</div>';

    /* ===== PART 03 生活方式年度总结 ===== */
    html += '<div class="rp-page">' + pageHead();
    html += sec('03', '三、生活方式年度总结', 'PART 03 · ANNUAL LIFESTYLE SUMMARY');
    html += '<p class="ar-lead">基于全年 12 次月度打卡数据，以滚动季度（入组日起每 3 个月）汇总展示各维度变化趋势。</p>';
    var qLabels = (r.lifestyle && r.lifestyle.labels) || ['Q1（M1-M3）', 'Q2（M4-M6）', 'Q3（M7-M9）', 'Q4（M10-M12）'];
    html += '<table class="rp-tb ar-tb"><thead><tr><th style="width:20%">维 度</th>' +
      qLabels.map(function (l) { return '<th>' + esc(l) + '</th>'; }).join('') +
      '<th style="width:22%">年度趋势</th></tr></thead><tbody>';
    (r.lifestyle && r.lifestyle.rows ? r.lifestyle.rows : r.lifestyle).forEach(function (row) {
      html += '<tr><th>' + esc(row.dim) + '</th>' + row.vals.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '<td>' + esc(row.trend) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="ar-note">注：数值型维度为该季度各月均值；选项型维度取季度末水平。"—"表示该季度无打卡数据。</div>';
    html += pageFoot() + '</div>';

    /* ===== PART 04 下一年度健康规划 ===== */
    html += '<div class="rp-page">' + pageHead();
    html += sec('04', '四、下一年度健康规划', 'PART 04 · NEXT YEAR HEALTH PLAN');
    html += '<p class="ar-lead">基于本年度评估结果，制定下一年度健康管理目标和复查计划。</p>';
    html += '<div class="ar-sub">1. 年度健康目标</div>';
    html += '<table class="rp-tb ar-tb"><thead><tr><th style="width:18%">目标维度</th><th style="width:38%">目 标</th><th>策 略</th></tr></thead><tbody>';
    r.plan.goals.forEach(function (g) {
      html += '<tr><th>' + esc(g.dim) + '</th><td>' + esc(g.goal) + '</td><td>' + esc(g.strategy) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="ar-sub">2. 复查监测计划</div>';
    html += '<table class="rp-tb ar-tb"><thead><tr><th style="width:26%">检 查 项 目</th><th style="width:30%">建 议 时 间</th><th>目 的</th></tr></thead><tbody>';
    r.plan.rechecks.forEach(function (x) {
      html += '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td><td>' + esc(x[2]) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += pageFoot() + '</div>';

    /* ===== PART 05 健康寄语 ===== */
    html += '<div class="rp-page">' + pageHead();
    html += sec('05', '五、健康寄语', 'PART 05 · HEALTH MESSAGE');
    html += '<div class="ar-msg">' +
      '尊敬的 ' + esc(c.name || '') + honor + '：<br><br>' +
      '回顾这一年，您用 ' + (r.summary.checkinMonths || 0) + ' 次月度打卡记录了自己的坚持，用每一份季度小结见证了改变。健康不是一场冲刺，而是日复一日的温柔积累。<br><br>' +
      '新的一年，愿您继续与我们一起，把每一个好习惯延续下去——血压平稳、血脂向好、睡眠安稳、心情舒畅。<br><br>' +
      '<b>健康无忧，未来可控。</b><br><br>' + esc(b.name) + ' · ' + esc(b.desc) +
      '</div>';
    html += pageFoot() + '</div>';

    return html;
  }

  function annualBasicInfo(r) {
    var c = r.customer || {};
    var rows = [
      ['年 龄', (c.age != null && c.age !== '' ? c.age + ' 岁' : '—'), '性 别', esc(c.gender || '—')],
      ['服务周期', esc(r.service.period), '服务时长', esc(r.service.months)],
      ['报告类型', '年度总结报告', '报告日期', esc(c.reportDate || '—')]
    ];
    var t = '<div class="rp-basic"><div class="rp-basic-h">基 本 信 息 · BASIC INFORMATION</div><table class="rp-tb"><tbody>';
    rows.forEach(function (x) { t += '<tr><th>' + x[0] + '</th><td>' + x[1] + '</td><th>' + x[2] + '</th><td>' + x[3] + '</td></tr>'; });
    t += '</tbody></table></div>';
    return t;
  }

  /* ---------- 组装数据 ---------- */
  function build(customer, year) {
    year = Number(year || new Date().getFullYear());
    var quarters = [];
    var qKeys = Object.keys(customer.quarters || {}).sort();
    qKeys.forEach(function (k) {
      var q = customer.quarters[k];
      if (q && q.qin && q.qin.customer && Number(q.qin.customer.quarterYear) === year) {
        quarters.push({ key: k, q: q.qin.customer.quarter, agg: q.qin.agg || {}, at: q.at, html: q.html });
      }
    });
    if (!quarters.length) {
      qKeys.forEach(function (k) {
        var q = customer.quarters[k];
        if (q && q.qin) quarters.push({ key: k, q: q.qin.customer.quarter, agg: q.qin.agg || {}, at: q.at, html: q.html });
      });
    }
    var checkinMonths = Object.keys(customer.checkins || {}).filter(function (k) { return /^(\d{4})-(\d{2})$/.test(k) && Number(k.slice(0, 4)) === year; });

    var life = lifestyleRows(customer.checkins || {}, year, customer.enroll_date);
    var r = {
      customer: {
        name: customer.name, gender: customer.gender, age: customer.age,
        year: year, reportDate: new Date().toISOString().slice(0, 10)
      },
      service: {
        period: (customer.enroll_date || (year + '-01')) + ' - ' + (year + 1) + '-03',
        months: (checkinMonths.length || 12) + ' 个月'
      },
      baseline: {
        source: '体检报告',
        coreIssues: customer.core_issues || [],
        metrics: (customer.input && customer.input.metrics) || {}
      },
      quarters: quarters,
      lifestyle: life,
      /* v53 客户档案按季度键（Q*_YYYY）存储的复查检查单，供基础指标年度追踪表读取 */
      retests: customer.retests || {},
      summary: {
        checkinMonths: life.months || checkinMonths.length,
        quarterReports: quarters.length,
        abReports: (customer.reports || []).length
      }
    };
    /* 下一年度健康目标 */
    var issues = r.baseline.coreIssues;
    var goals = [];
    if (issues.length) {
      issues.slice(0, 4).forEach(function (iss) {
        goals.push({ dim: systemOf(iss), goal: iss + '：维持稳定或改善', strategy: '继续当前干预方案，按复查计划监测' });
      });
    } else {
      goals.push({ dim: '心脑血管', goal: '维持血压血脂稳定', strategy: '保持饮食运动方案，控油限盐' });
    }
    goals.push({ dim: '生活方式', goal: '运动/饮食/睡眠保持当前水平', strategy: '维持现有习惯，运动 ≥12 次/月，睡眠 ≥7h' });
    var nextExam = (year + 1) + ' 年 ' + (new Date().getMonth() + 1) + ' 月';
    r.plan = { goals: goals, rechecks: recheckPlanOf(issues, nextExam) };
    return r;
  }

  /* ---------- 预览 / 导出 ---------- */
  function buildPreview(r) {
    return '<style>' + RG.commonCSS() + ANNUAL_CSS() + '</style><div class="rp-root">' + reportBody(r) + '</div>';
  }
  function exportWord(r, filename) {
    var doc = RG.wrapWord('年度健康总结报告', '<style>' + RG.commonCSS() + ANNUAL_CSS() + '</style>', reportBody(r));
    var blob = new Blob(['\ufeff', doc], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (filename || ('年度健康总结报告_' + (r.customer.name || '') + '_' + r.customer.year)).replace(/[\\/:*?"<>|]/g, '') + '.doc';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportHtmlDoc(r, filename) {
    var full = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>年度健康总结报告</title>' +
      '<style>' + RG.commonCSS() + ANNUAL_CSS() + '</style></head><body><div class="rp-root">' + reportBody(r) + '</div></body></html>';
    var blob = new Blob(['\ufeff', full], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = (filename || ('年度健康总结报告_' + (r.customer.name || ''))).replace(/[\\/:*?"<>|]/g, '') + '.html';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function ANNUAL_CSS() {
    return '' +
    '.ar-note{background:#faf5f5;border-left:4px solid #E60012;padding:8px 12px;margin:10px 0;font-size:13px;color:#555;line-height:1.8;}' +
    '.ar-lead{color:#666;font-size:13.5px;margin:6px 0 10px;}' +
    '.ar-tb th{background:#faf3f3;}' +
    '.ar-tb thead th{background:#E60012;color:#fff;}' +
    '.ar-sub{font-weight:700;color:#E60012;margin:16px 0 6px;font-size:15px;}' +
    '.ar-msg{background:#fffdf8;border:1px solid #f0e3c8;border-radius:10px;padding:22px 26px;line-height:2.1;font-size:14.5px;color:#444;margin-top:14px;}' +
    '.rp-pf{margin-top:18px;text-align:center;color:#999;font-size:12px;letter-spacing:1px;border-top:1px solid #eee;padding-top:8px;}' +
    '.rp-ph{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#bbb;letter-spacing:2px;border-bottom:1px solid #f0e3e3;padding-bottom:6px;margin-bottom:14px;}';
  }

  global.AnnualReport = {
    build: build,
    reportBody: reportBody,
    buildPreview: buildPreview,
    exportWord: exportWord,
    exportHtml: exportHtmlDoc
  };
})(window);
