/* =============================================================
 * 体检报告自动提取引擎 report-extract.js
 * 纯前端、可离线：PDF(文本) -> pdf.js；图片 / 扫描版PDF -> tesseract.js(chi_sim) OCR；
 * 纯文本/复制粘贴 -> 直接解析。
 * 输出统一映射到 KB.INDICATORS 的指标 code，供入组建档表单复用。
 *
 * v2 修复：
 *   - 正则允许跨行匹配（医院报告标签与数值常在不同行）
 *   - docx 解析过滤 XML 垃圾标签 + 数字字符实体解码
 *   - pdf.js 增加 cMapUrl 支持中文 CID 字体
 *   - 移除易误匹配的短别名（如 TC 的裸"胆固醇"）
 * ============================================================= */
(function () {
  'use strict';

  var KB = window.KB;

  /* ---------- 指标别名 -> code 字典 ---------- */
  // 数字型：报告名 + 英文/缩写；选择型：附带 map 文本->值
  // 别名尽量覆盖医院报告常见写法（含括号、空格、大小写变体），长别名优先匹配
  var DICT = {
    sbp:    { t: 'num', aliases: ['收缩压', '收缩期血压', '收缩压(SBP)', 'SBP', '高压'] },
    dbp:    { t: 'num', aliases: ['舒张压', '舒张期血压', '舒张压(DBP)', 'DBP', '低压'] },
    hr:     { t: 'num', aliases: ['心率', '脉搏', '心跳', '脉率', 'HR'] },
    ldl:    { t: 'num', aliases: ['低密度脂蛋白胆固醇', '低密度脂蛋白(LDL-C)', '低密度脂蛋白', 'LDL-C', 'LDL'] },
    hdl:    { t: 'num', aliases: ['高密度脂蛋白胆固醇', '高密度脂蛋白(HDL-C)', '高密度脂蛋白', 'HDL-C', 'HDL'] },
    tc:     { t: 'num', aliases: ['总胆固醇', '总胆固醇(TC)', 'TC', 'CHOL'] },
    tg:     { t: 'num', aliases: ['甘油三酯', '三酰甘油', '甘油三酯(TG)', 'TG'] },
    fpg:    { t: 'num', aliases: ['空腹血糖', '空腹静脉血糖', '空肚血糖', '血糖(GLU)', '葡萄糖(GLU)', 'GLU', '血糖', 'FPG'] },
    hba1c:  { t: 'num', aliases: ['糖化血红蛋白', '糖化血红蛋白(HbA1c)', 'HbA1c', 'GHb', '糖化'] },
    ua:     { t: 'num', aliases: ['血尿酸', '尿酸(UA)', '血尿酸(UA)', '尿酸', 'UA'] },
    waist:  { t: 'num', aliases: ['腰围', '腰围(cm)', '腹围'] },
    ggt:    { t: 'num', aliases: ['谷氨酰转肽酶', '谷氨酰转移酶', 'γ-谷氨酰转肽酶', 'γ谷氨酰转肽酶', 'γ-谷氨酰转移酶', 'γ-GT', 'GGT', '谷氨酰'] },
    egfr:   { t: 'num', aliases: ['估算肾小球滤过率', '肾小球滤过率', 'eGFR', 'GFR', '肾小球'] },
    homocysteine: { t: 'num', aliases: ['同型半胱氨酸', '同型半胱氨酸(Hcy)', 'Hcy', 'HCY'] },
    /* v55 复查检查单补齐：25羟维生素D / 骨密度T值 / CYFRA21-1（SNAP_SPEC 复查可覆盖但 DICT 原缺失导致 OCR/文本无法识别） */
    vitd:   { t: 'num', aliases: ['25羟维生素D', '25羟基维生素D', '25-羟维生素D', '25-羟基维生素D', '25羟基维生素D3', '25-(OH)D', '25(OH)D', '25-OH-D', '维生素D(25)', 'VitD', '维生素D'] },
    bmd:    { t: 'num', aliases: ['骨密度T值', '骨密度T', '骨密度(T值)', 'T值'] },
    cyfra21:{ t: 'num', aliases: ['细胞角蛋白19片段', 'CYFRA21-1', 'CYFRA21', 'Cyfra21-1', '细胞角蛋白19', 'CYFRA'] },
    height: { t: 'num', aliases: ['身高', '身高(cm)', 'Height'] },
    weight: { t: 'num', aliases: ['体重', '体重(kg)', 'Weight'] },
    /* --- 选择型：捕获文本后 map --- */
    carotidPlaque: { t: 'sel', aliases: ['颈动脉斑块', '颈动脉', '颈动脉超声'],
      map: function (s) { return /多发|混合|不稳定|易损/.test(s) ? 'multi' : /斑块/.test(s) ? 'stable' : 'none'; } },
    ecg:    { t: 'sel', aliases: ['心电图', 'ECG'],
      map: function (s) { return /异常|不齐|ST[-若]?段|改变|早搏/.test(s) ? 'abn' : 'normal'; } },
    lungNodule: { t: 'sel', aliases: ['肺结节', '肺部结节', '肺部小结节'],
      map: function (s) { return /(>|大于|超过)\s*8|8\s*mm\s*以上|大于8/.test(s) ? 'large' : /微小|<6|小于6|磨玻璃/.test(s) ? 'micro' : /[6-8]\s*mm|6-8|小结节/.test(s) ? 'small' : 'none'; } },
    hpylori:{ t: 'sel', aliases: ['幽门螺杆菌', '幽门螺旋杆菌', '幽门', 'Hp'],
      map: function (s) { return /阳/.test(s) ? 'pos' : 'neg'; } },
    renalCyst: { t: 'sel', aliases: ['肾囊肿', '肾脏占位', '肾占位'],
      map: function (s) { return /待定|性质不|不清|可疑/.test(s) ? 'unclear' : /良性|囊肿/.test(s) ? 'benign' : 'none'; } }
  };

  /* ---------- 工具 ---------- */
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /* 文本归一化（关键修复）：
   * 1) NFKC：把 PDF 常见的康熙部首/兼容码位转成标准汉字（⼼→心、⻚→页），全角数字/符号转半角；
   * 2) 消除汉字之间的空格（医院 PDF 逐字排版常见 "收 缩 压 119"）；
   * 3) 合并被空格拆开的数字（"1 3 8"→"138"）。
   * 归一化后 "收   缩   压  119 mmHg" → "收缩压119 mmHg"，正则即可命中。 */
  var CJK = '[\\u3400-\\u9fff\\uf900-\\ufaff]';
  function normalizeText(s) {
    if (!s) return s;
    try { s = s.normalize('NFKC'); } catch (e) { /* 旧浏览器忽略 */ }
    // 仅合并行内空白（保留 \n 换行，章节结构依赖它）
    // 注意：不折叠 \t —— 表格行以制表符作列分隔（docxToText 的 w:tab/单元格边界），
    // 若把「CJK\tCJK」折叠会毁掉列结构，richTextHtml 将无法把上传表格还原为表格。
    s = s.replace(new RegExp('(' + CJK + ')[ \\u00a0]+(?=' + CJK + ')', 'g'), '$1');
    s = s.replace(/(\d)[ \u00a0]+(?=\d)/g, '$1');
    return s;
  }
  /* 剔除「参考值/参考范围/正常范围」后的数值区间（如 "参考范围 3.9-6.1"、"正常值：(0-15)"），
     避免提取时把参考区间的边界值误当成实测值。 */
  function stripReferenceRanges(s) {
    if (!s) return s;
    // 形如：参考值[：:（）(]?3.9-6.1  /  正常范围 0~15  /  参考区间(0.4-0.8)
    s = s.replace(/(参考值|参考范围|参考区间|正常范围|正常参考值|正常值|单位)[：:：]?[（(]?[-+]?\d+(?:\.\d+)?\s*[-—–~～至到]\s*\d+(?:\.\d+)?[)）]?/g, '');
    return s;
  }
  function labelOf(code) {
    if (KB && KB.INDICATORS) {
      for (var i = 0; i < KB.INDICATORS.length; i++) if (KB.INDICATORS[i].code === code) return KB.INDICATORS[i];
    }
    var fb = { height: { label: '身高', unit: 'cm' }, weight: { label: '体重', unit: 'kg' },
      sbp: { label: '收缩压', unit: 'mmHg' }, dbp: { label: '舒张压', unit: 'mmHg' }, hr: { label: '心率', unit: '次/分' },
      ldl: { label: '低密度脂蛋白', unit: 'mmol/L' }, hdl: { label: '高密度脂蛋白', unit: 'mmol/L' },
      tc: { label: '总胆固醇', unit: 'mmol/L' }, tg: { label: '甘油三酯', unit: 'mmol/L' },
      fpg: { label: '空腹血糖', unit: 'mmol/L' }, ua: { label: '血尿酸', unit: 'μmol/L' }, waist: { label: '腰围', unit: 'cm' },
      /* v55：复查指标中文显示回退（KB.INDICATORS 不收录时避免落成裸 code） */
      vitd: { label: '25羟维生素D', unit: 'ng/mL' }, bmd: { label: '骨密度T值', unit: '' }, cyfra21: { label: 'CYFRA21-1', unit: 'ng/mL' },
      ggt: { label: 'γ-谷氨酰转肽酶', unit: 'U/L' }, egfr: { label: '估算肾小球滤过率', unit: 'mL/min' }, homocysteine: { label: '同型半胱氨酸', unit: 'μmol/L' },
      hba1c: { label: '糖化血红蛋白', unit: '%' } };
    return fb[code] || { label: code, unit: '' };
  }
  // 区间/参考范围分隔符：若数值紧接这些符号，通常是"参考下限"，跳过取下一个
  var RANGE_AFTER = { '-': 1, '–': 1, '—': 1, '~': 1, '至': 1, '到': 1 };

  /* ---------- 核心：文本 -> 指标 ---------- */
  function extract(text) {
    if (!text) return { results: [], meta: {} };
    text = normalizeText(text);
    text = stripReferenceRanges(text);
    var results = [], seen = {};
    Object.keys(DICT).forEach(function (code) {
      var d = DICT[code];
      var names = d.aliases.slice().sort(function (a, b) { return b.length - a.length; });
      var alt = names.map(esc).join('|');
      if (d.t === 'num') {
        // 标签后最多 30 个非数字字符内取首个数值（允许跨行，兼容医院报告表格换行）
        // 兼容：收缩压：138 / 收缩压(mmHg)\n139 / 收缩压≥140 / 收缩压 138 mmHg / SBP 138
        var re = new RegExp('(?:' + alt + ')[^0-9]{0,30}?([-+]?\\d+(?:\\.\\d+)?)', 'g');
        var m, allNum = [];
        while ((m = re.exec(text)) !== null) {
          var after = text[m.index + m[0].length];
          allNum.push({ num: m[1], after: after });
        }
        var hit = null;
        for (var i = 0; i < allNum.length; i++) {
          if (!RANGE_AFTER[allNum[i].after]) { hit = allNum[i].num; break; }
        }
        if (!hit && allNum.length) hit = allNum[0].num;
        if (hit !== null) {
          var numVal = Number(hit);
          /* 基本合理性过滤：排除明显异常值（如体检号、电话号码误匹配） */
          var sane = true;
          if (code === 'weight' && (numVal < 20 || numVal > 300)) sane = false;
          if (code === 'height' && (numVal < 80 || numVal > 250)) sane = false;
          if (code === 'sbp' && (numVal < 60 || numVal > 280)) sane = false;
          if (code === 'dbp' && (numVal < 40 || numVal > 180)) sane = false;
          if (code === 'hr' && (numVal < 30 || numVal > 220)) sane = false;
          if (code === 'fpg' && (numVal < 2 || numVal > 30)) sane = false;
          if (code === 'hba1c' && (numVal < 3 || numVal > 15)) sane = false;
          if (code === 'waist' && (numVal < 30 || numVal > 250)) sane = false; // 腰围 cm；防误取 BMI 等邻近值
          if (code === 'ua' && (numVal < 60 || numVal > 1500)) sane = false;   // 尿酸 µmol/L
          if (code === 'ldl' && (numVal < 0.3 || numVal > 15)) sane = false;
          if (code === 'hdl' && (numVal < 0.1 || numVal > 5)) sane = false;
          if (code === 'tg' && (numVal < 0.1 || numVal > 30)) sane = false;
          if (code === 'tc' && (numVal < 1 || numVal > 20)) sane = false;
          if (code === 'vitd' && (numVal < 0 || numVal > 300)) sane = false;      // 25羟维生素D（ng/mL 常见 5~100；nmol/L 数值更大，放宽上限）
          if (code === 'bmd' && (numVal < -5.5 || numVal > 5.5)) sane = false;    // 骨密度 T 值（负数表示骨量降低，排除 DXA 绝对值 g/cm² 误取）
          if (code === 'cyfra21' && (numVal < 0 || numVal > 500)) sane = false;   // CYFRA21-1 ng/mL
          if (!sane && allNum.length > 1) { /* 尝试取下一个合理值 */
            for (var j = 0; j < allNum.length; j++) {
              var altV = Number(allNum[j].num);
              if (code === 'weight' && altV >= 20 && altV <= 300) { hit = allNum[j].num; numVal = altV; sane = true; break; }
              if (code === 'height' && altV >= 80 && altV <= 250) { hit = allNum[j].num; numVal = altV; sane = true; break; }
              if (code === 'sbp' && altV >= 60 && altV <= 280) { hit = allNum[j].num; numVal = altV; sane = true; break; }
              if (code === 'dbp' && altV >= 40 && altV <= 180) { hit = allNum[j].num; numVal = altV; sane = true; break; }
              if (code === 'hr' && altV >= 30 && altV <= 220) { hit = allNum[j].num; numVal = altV; sane = true; break; }
              if (code === 'hba1c' && altV >= 3 && altV <= 15) { hit = allNum[j].num; numVal = altV; sane = true; break; }
            }
          }
          if (sane) {
            results.push({ code: code, value: numVal, raw: hit, type: 'number',
              label: labelOf(code).label, unit: labelOf(code).unit, needsReview: false, confidence: 'auto' });
            seen[code] = true;
          }
        }
      } else {
        var rs = new RegExp('(?:' + alt + ')[\\s：:=]{0,4}([^\\n;；,，。]{1,20})', 'g');
        var ms, rawText = null;
        while ((ms = rs.exec(text)) !== null) { if (rawText === null) rawText = ms[1].trim(); }
        if (rawText !== null) {
          var val = d.map(rawText);
          results.push({ code: code, value: val, raw: rawText, type: 'select',
            label: labelOf(code).label, unit: labelOf(code).unit, needsReview: true, confidence: 'ocr' });
          seen[code] = true;
        }
      }
    });

    /* 血压 "138/86" 组合 */
    var bp = /血压\s*[:：]?\s*(\d{2,3})\s*[\/／]\s*(\d{2,3})/g, bm;
    while ((bm = bp.exec(text)) !== null) {
      if (!seen.sbp) results.push({ code: 'sbp', value: Number(bm[1]), raw: bm[1], type: 'number', label: labelOf('sbp').label, unit: 'mmHg', needsReview: false, confidence: 'auto' });
      if (!seen.dbp) results.push({ code: 'dbp', value: Number(bm[2]), raw: bm[2], type: 'number', label: labelOf('dbp').label, unit: 'mmHg', needsReview: false, confidence: 'auto' });
    }

    /* 轻量元信息建议（供人工确认） */
    var meta = {};
    var g = /性别\s*[:：]?\s*(男|女)/.exec(text); if (g) meta.gender = g[1];
    var a = /年龄\s*[:：]?\s*(\d{1,3})\s*岁/.exec(text) || /(\d{1,3})\s*岁/.exec(text); if (a) meta.age = Number(a[1]);
    var dt = /(体检|检查|报告)?\s*日期\s*[:：]?\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(text);
    if (dt) meta.examDate = dt[2] + '-' + (dt[3].length < 2 ? '0' + dt[3] : dt[3]) + '-' + (dt[4].length < 2 ? '0' + dt[4] : dt[4]);

    return { results: results, meta: meta };
  }

  /* ---------- 渲染提取结果核对表 ---------- */
  function renderReview(host, payload) {
    if (!host) return;
    var html = '';
    var rs = payload.results || [];
    html += '<div class="ext-summary">共识别 <b>' + rs.length + '</b> 项指标' +
      (payload.meta && Object.keys(payload.meta).length ? '，并推测体检基本信息若干' : '') + '。请核对后点击「应用到建档」。</div>';
    if (rs.length) {
      html += '<table class="ext-table"><thead><tr><th>指标</th><th>提取值</th><th>状态</th></tr></thead><tbody>';
      rs.forEach(function (r) {
        var st = r.needsReview ? '<span class="ext-flag review">需核对</span>' : '<span class="ext-flag ok">自动匹配</span>';
        html += '<tr><td>' + r.label + '</td><td>' + (r.raw != null ? r.raw : r.value) + (r.unit ? ' ' + r.unit : '') +
          '</td><td>' + st + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    if (payload.meta && Object.keys(payload.meta).length) {
      html += '<div class="ext-meta">推测基本信息：' +
        (payload.meta.gender ? '性别 ' + payload.meta.gender + '；' : '') +
        (payload.meta.age != null ? '年龄 ' + payload.meta.age + '；' : '') +
        (payload.meta.examDate ? '体检日期 ' + payload.meta.examDate : '') + '（如需采用请手动填入）</div>';
    }
    if (!rs.length && (!payload.meta || !Object.keys(payload.meta).length)) {
      html += '<div class="ext-empty">未能从内容中识别到已知指标。可能是图片清晰度不足（OCR）或报告格式特殊，建议切换为「粘贴文字」或手动录入。</div>';
    }
    host.innerHTML = html;
  }

  /* ---------- 本地库按需加载（离线优先，失败回退 CDN） ---------- */
  function loadScript(src, cdn) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src; s.setAttribute('data-src', src);
      s.onload = function () { resolve(); };
      s.onerror = function () {
        if (cdn) { var c = document.createElement('script'); c.src = cdn; c.setAttribute('data-src', src);
          c.onload = resolve; c.onerror = function () { reject(new Error('加载解析库失败: ' + src)); }; document.head.appendChild(c); }
        else reject(new Error('加载解析库失败: ' + src));
      };
      document.head.appendChild(s);
    });
  }
  var _pdf = null, _ocr = null;
  function loadPdf() {
    if (_pdf) return _pdf;
    _pdf = loadScript('js/lib/pdf.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js')
      .then(function () {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/lib/pdf.worker.min.js';
          // 中文 CID 字体支持：cMap + 标准字体数据（离线优先，CDN 回退）
          try { window.pdfjsLib.GlobalWorkerOptions.cMapUrl = 'js/lib/cmaps/'; } catch(e) {}
          try { window.pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = 'js/lib/standard_fonts/'; } catch(e) {}
        }
      });
    return _pdf;
  }
  function loadOCR() {
    // 图片 OCR 经 tesseract.js 从 CDN 加载识别引擎与语言包，故需联网。
    // PDF 文本提取与「粘贴文字」则完全离线（pdf.js 已本地打包）。
    if (_ocr) return _ocr;
    _ocr = loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      'https://registry.npmmirror.com/tesseract.js/5.1.1/files/dist/tesseract.min.js');
    return _ocr;
  }
  var _zip = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (_zip) return _zip;
    _zip = loadScript('js/lib/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js')
      .then(function () { if (!window.JSZip) throw new Error('JSZip 未加载'); return window.JSZip; });
    return _zip;
  }
  function decodeEnt(s) {
    if (!s) return '';
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    // 数字字符实体：&#xNNNN; (十六进制) 和 &#NNNN; (十进制)
    s = s.replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
      var cp = parseInt(hex, 16); return cp > 0xffff ? String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)) : String.fromCharCode(cp);
    });
    s = s.replace(/&#(\d+);/g, function (_, dec) {
      var cp = parseInt(dec, 10); return cp > 0xffff ? String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)) : String.fromCharCode(cp);
    });
    return s;
  }
  /* 提取一段 Word XML 中的可读文本（docxToText 专用）：
   * - <w:br/> 段落内软换行 → \n（保留同段分行，如「附录 2：食谱示例 <br> 能量摄入建议…」）
   * - <w:tab/> → \t（保留同段分栏 / 制表位）
   * - </w:p> 单元格内段落边界 → \n
   * - 其余标签整体剔除（文本只存在于 <w:t>，标签删净后剩余即正文）
   * 返回字符串仍可能含 \n / \t，由调用方按需切分，不再统一压成空格。 */
  function extractText(x) {
    if (!x) return '';
    return decodeEnt(
      String(x)
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]*>/g, '')
    ).replace(/\u00a0/g, ' ');
  }
  /* 过滤 Word XML 垃圾：去除以 <w: 开头的标签残留 */
  function isXmlGarbage(s) { return /^\s*</.test(s) || /^<w:/.test(s); }

  /* ---- Word 自动编号还原（numbering.xml）----
   * 文档小标题常为自动编号列表（如「3.一般查体」「二、健康管理建议」），
   * 文本层不含编号，仅靠 <w:numPr> 引用 numbering.xml 渲染。提取时若不还原，
   * 标题会丢失「3.」「二、」等序号。docxToText 逐段遇到带编号的正文段落时，
   * 按其 numId 的计数与格式补出编号前缀。 */
  function _cnNum(n) {
    var D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (n <= 10) return n === 10 ? '十' : D[n];
    if (n < 20) return '十' + D[n % 10];
    if (n < 100) return D[(n / 10) | 0] + '十' + (n % 10 ? D[n % 10] : '');
    return String(n);
  }
  function _fmtListNum(n, fmt) {
    fmt = fmt || 'decimal';
    if (fmt === 'chineseCounting' || fmt === 'chineseLegalSimplified') return _cnNum(n);
    if (fmt === 'chineseLegal' || fmt === 'chineseCapital') { /* 壹贰…，项目文档未用到，退化为中文数字 */
      return _cnNum(n);
    }
    if (fmt === 'decimalZero') return n < 10 ? '0' + n : String(n);
    if (fmt === 'upperLetter') return String.fromCharCode(64 + n);
    if (fmt === 'lowerLetter') return String.fromCharCode(96 + n);
    return String(n);
  }
  /* 解析 numbering.xml → { numId: { levels:{ilvl:{fmt,tpl,start}}, startOverride } } */
  function parseNumberingXML(nx) {
    var abs = {};
    (String(nx) || '').replace(/<w:abstractNum w:abstractNumId="([^"]+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g, function (_, aid, a) {
      var levels = {};
      a.replace(/<w:lvl w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g, function (_, ilvl, b) {
        var fmt = (b.match(/<w:numFmt w:val="([^"]*)"/) || [])[1] || 'decimal';
        var tpl = (b.match(/<w:lvlText w:val="([^"]*)"/) || [])[1] || '%1.';
        var start = parseInt((b.match(/<w:start w:val="(\d+)"/) || [])[1] || '1', 10);
        levels[ilvl] = { fmt: fmt, tpl: tpl, start: start };
      });
      abs[aid] = levels;
    });
    var map = {};
    (String(nx) || '').replace(/<w:num w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g, function (_, numId, n) {
      var abstractId = (n.match(/<w:abstractNumId w:val="(\d+)"/) || [])[1];
      var so = n.match(/<w:lvlOverride w:ilvl="0"[\s\S]*?<w:startOverride w:val="(\d+)"[\s\S]*?<\/w:lvlOverride>/);
      map[numId] = {
        levels: (abstractId != null && abs[abstractId]) || {},
        startOverride: so ? parseInt(so[1], 10) : null
      };
    });
    return map;
  }
  /* 从段落 XML 中读取 numId / ilvl（无编号返回 null） */
  function _paraNumInfo(p) {
    var pr = (p.match(/<w:pPr[^>]*>([\s\S]*?)<\/w:pPr>/) || [])[1] || '';
    var numId = (pr.match(/<w:numId w:val="(\d+)"/) || [])[1];
    var ilvl = (pr.match(/<w:ilvl w:val="(\d+)"/) || [])[1];
    if (numId === undefined || numId === null || numId === '0') return null;
    return { numId: numId, ilvl: ilvl === undefined ? '0' : ilvl };
  }
  /* 把 Word 自动编号加回正文行首（如「一般查体」→「3.一般查体」） */
  function applyNumbering(xml, numberingMap) {
    var counters = {};
    function escXml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    return xml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, function (m, inner) {
      var info = _paraNumInfo(m);
      if (!info) return m;
      var nl = numberingMap[info.numId];
      if (!nl) return m;
      var lvl = nl.levels[info.ilvl];
      if (!lvl) return m;
      var key = info.numId + ':' + info.ilvl;
      if (counters[key] === undefined) {
        counters[key] = (info.ilvl === '0' && nl.startOverride != null) ? nl.startOverride - 1 : lvl.start - 1;
      }
      counters[key]++;
      var val = _fmtListNum(counters[key], lvl.fmt);
      var prefix = String(lvl.tpl || '%1.').replace(/%(\d+)/g, function (_, k) { return String(k) === '1' ? val : val; });
      /* 首个文本 run 已带同编号（正文把编号写死在文本里）则不重复添加 */
      var firstText = (inner.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/) || [])[1] || '';
      if (prefix && firstText.indexOf(prefix) !== 0) {
        var pprEnd = inner.indexOf('</w:pPr>');
        var insertAt = pprEnd >= 0 ? pprEnd + 8 : 0;
        var run = '<w:r><w:t xml:space="preserve">' + escXml(prefix) + '</w:t></w:r>';
        inner = inner.slice(0, insertAt) + run + inner.slice(insertAt);
      }
      return m.slice(0, m.indexOf('>') + 1) + inner + '</w:p>';
    });
  }
  /* Word(.docx) -> 纯文本（离线，JSZip 已本地打包） */
  function docxToText(file, onProg) {
    if (onProg) onProg('解析 Word 文档中…');
    return loadJSZip().then(function (JSZip) {
      return readAsArrayBuffer(file).then(function (buf) { return JSZip.loadAsync(buf); });
    }).then(function (zip) {
      var entry = zip.file('word/document.xml') || zip.file('word/Document.xml');
      if (!entry) throw new Error('无法在 Word 文档中找到正文内容');
      var numEntry = zip.file('word/numbering.xml');
      var numP = numEntry ? numEntry.async('string') : Promise.resolve('');
      return Promise.all([entry.async('string'), numP]);
    }).then(function (res) {
      var xml = res[0];
      var numberingMap = parseNumberingXML(res[1] || '');
      /* 自动编号列表标题（如「3.一般查体」「二、健康管理建议」）补回编号，
         否则文本提取丢失序号；仅作用于正文直接段落（表格内容已先行抽离） */
      if (Object.keys(numberingMap).length) xml = applyNumbering(xml, numberingMap);
      // 表格保真提取：单元格 \t 分隔、行 \n 分隔（不再塌缩为一行）。
      // 此前 <w:tbl> 行与单元格虽以 \n/制表符拼接，但段落级 \s+→' ' 会把它们全部抹成空格，
      // 导致「附录2 食谱示例」表格内容整体并入上一章正文。现以段落占位符替换表格，行结构保留到最终文本。
      var tblCache = [];
      xml = xml.replace(/<w:tbl[^>]*>([\s\S]*?)<\/w:tbl>/g, function (_, tbl) {
        var rows = [], prevCells = [];
        tbl.replace(/<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g, function (_, tr) {
          var cells = [], col = 0;
          tr.replace(/<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g, function (_, tc) {
            var txt = extractText(tc).replace(/[ \t]*\n[ \t]*/g, '\x0B').trim();
            /* 纵向合并单元格（vMerge）续行：首个/中间合并单元格通常为空，
               回填合并起始行的同列文字，使每行保留类别标签（如「运动建议」），
               下游才能还原为完整的 分类|干预建议 两列表，而非把后续条目散成段落 */
            var vmRestart = /<w:vMerge\b[^>]*w:val="restart"/.test(tc);
            var vmCont = /<w:vMerge\b/.test(tc) && !vmRestart;
            if (vmCont && !txt && prevCells[col] !== undefined) txt = prevCells[col];
            cells.push(txt);
            prevCells[col] = txt;
            col++;
          });
          if (cells.length) rows.push(cells.join('\t'));
        });
        var placeholder = '__TBL_' + tblCache.length + '__';
        tblCache.push(rows.join('\n'));
        return '<w:p><w:t>' + placeholder + '</w:t></w:p>';
      });
      var paras = xml.split('</w:p>');
      var lines = [];
      paras.forEach(function (p) {
        var line = extractText(p);
        line = line.replace(/__TBL_(\d+)__/g, function (_, idx) { return tblCache[idx] || ''; });
        /* 保留段落内 <w:br/> 与表格行产生的换行，逐行 trim 后输出 */
        String(line).split('\n').forEach(function (seg) {
          seg = seg.trim();
          if (seg && !isXmlGarbage(seg)) lines.push(seg);
        });
      });
      return lines.join('\n');
    });
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); });
  }
  function readAsText(file) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file, 'utf-8'); });
  }

  /* 单页渲染为 canvas（扫描版 PDF 用） */
  function pageToCanvas(page) {
    var viewport = page.getViewport({ scale: 2 });
    var canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    var ctx = canvas.getContext('2d');
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () { return canvas; });
  }
  function ocrCanvas(canvas, onProg) {
    return loadOCR().then(function () {
      if (!window.Tesseract) throw new Error('tesseract.js 未加载（图片识别需联网加载引擎）');
      return window.Tesseract.recognize(canvas, 'chi_sim', {
        logger: function (m) { if (onProg && m.status) onProg('OCR ' + m.status + (m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : '')); }
      });
    }).then(function (out) { return (out && out.data && out.data.text) || ''; });
  }

  /* PDF -> 文本。优先文本层；某页文本层为空（扫描件）则渲染该页 OCR。
     返回 Promise<{text, method}> */
  function pdfToText(buf, onProg) {
    return loadPdf().then(function () {
      if (!window.pdfjsLib) throw new Error('pdf.js 未加载');
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (pdf) {
      var pages = [];
      for (var i = 1; i <= pdf.numPages; i++) pages.push(i);
      return Promise.all(pages.map(function (n) {
        return pdf.getPage(n).then(function (page) {
          return page.getTextContent().then(function (tc) {
            // 按 pdf.js 的 hasEOL 保留换行：既利于正则匹配，也保留章节行结构
            var t = tc.items.map(function (it) { return (it.str || '') + (it.hasEOL ? '\n' : ''); }).join('').trim();
            if (!t) t = tc.items.map(function (it) { return it.str; }).join(' ').trim();
            if (t.length > 4 && /\d/.test(t)) return { text: t, ocr: false };
            // 文本层为空 -> 尝试渲染并 OCR（需联网）
            if (onProg) onProg('第 ' + n + ' 页为图片，启动 OCR…');
            return pageToCanvas(page).then(function (canvas) {
              return ocrCanvas(canvas, onProg).then(function (ot) { return { text: ot, ocr: true }; });
            }).catch(function () { return { text: '', ocr: true }; });
          });
        });
      })).then(function (arr) {
        var textParts = arr.map(function (x) { return x.text; }).filter(Boolean);
        var usedOcr = arr.some(function (x) { return x.ocr && x.text; });
        var method = usedOcr ? 'pdf-ocr' : 'pdf-text';
        return { text: normalizeText(textParts.join('\n')), method: method };
      });
    });
  }

  function imageToText(file, onProg) {
    if (onProg) onProg('OCR 识别中…（首次需联网加载引擎）');
    return ocrCanvas(file, onProg).then(function (txt) { return { text: txt, method: 'image-ocr' }; });
  }

  /* 文件 -> {text, method}。返回 Promise */
  function fileToText(file, onProg) {
    if (!file) return Promise.reject(new Error('未选择文件'));
    var name = (file.name || '').toLowerCase();
    var type = file.type || '';
    if (type.indexOf('pdf') >= 0 || name.endsWith('.pdf')) {
      if (onProg) onProg('解析 PDF 中…');
      return readAsArrayBuffer(file).then(function (buf) { return pdfToText(buf, onProg); });
    }
    if (type.indexOf('word') >= 0 || /\.(docx|docm|dotx)$/.test(name)) {
      return docxToText(file, onProg).then(function (txt) { return { text: txt, method: 'docx' }; });
    }
    if (name.endsWith('.doc')) {
      return Promise.reject(new Error('旧版 .doc 格式不支持，请在 Word 中「另存为 .docx 或 PDF」后再上传'));
    }
    if (type.indexOf('image/') >= 0 || /\.(png|jpe?g|bmp|gif|webp)$/.test(name)) {
      return imageToText(file, onProg);
    }
    // 文本/Markdown/CSV/JSON：直接读取
    if (onProg) onProg('读取文本中…');
    return readAsText(file).then(function (txt) { return { text: txt, method: 'text' }; });
  }

  /* ---------- 文档结构化：拆为「叙述章节」与「附录章节」 ----------
   * 标题不固定，以文档本身的标题行为准（兼容 一、xxx / （1）xxx / 第X章 / 附录X：xxx）。
   * 含 附录/饮食原则/食谱/生活方式干预/高嘌呤 等 → 归入 appendix；其余 → narrative。 */
  var APPENDIX_HINT = /附录|饮食原则|食谱示例|食谱|生活方式干预|高嘌呤|膳食原则|营养建议|运动建议/;
  // 仅取「明显是章节标题」的词，避免把正文短句误判为标题
  var SEC_KEYWORDS = ['概况', '情况', '系统', '血管', '结构', '节律', '代谢', '实验室', '腹部', '泌尿系', '症状', '检查', '评估', '史', '总结', '饮食', '运动', '作息', '管控', '复查', '管理', '随访', '建议', '调整', '查体', '维持'];
  function classifyHeading(s, idx, curKind) {
    if (s.length === 0) return { is: false };
    if (/[。！？.!?]$/.test(s)) return { is: false };
    // 附录标题优先识别（附录2 / 附录二 / 附 2 / ■ 附录 2：…），不受长度限制
    if (/^(附录|附\s*\d|■\s*附)/.test(s)) return { is: true, kind: 'appendix' };
    if (/^第.?[章节目]/.test(s)) return { is: true, kind: 'narrative' };
    // 目录行（"05 附录 2·食谱示例 7"：章节编号+附录+页码）不是附录标题，排除
    if (/^\d{1,2}\s+附/.test(s)) return { is: false };
    if (s.length > 18) return { is: false };
    if (idx === 0 && !/[：:]/.test(s)) return { is: true, kind: 'narrative' }; // 文档标题
    if (/^[一二三四五六七八九十\d]+[、．.](?!\d)/.test(s)) return { is: true, kind: 'narrative' }; // (?!\d) 排除小数行
    if (/^\d{1,2}\s+[\u4e00-\u9fff]{2,12}$/.test(s)) return { is: true, kind: 'narrative' }; // "01 体检结果概况" 编号式标题（编号后须为纯中文，排除数值行）
    if (curKind !== 'appendix' && /^（[一二三四五六七八九十\d]+）/.test(s) && s.length <= 14) return { is: true, kind: 'narrative' };
    if (/^附\s*\d/.test(s)) return { is: true, kind: 'appendix' };
    if (APPENDIX_HINT.test(s)) return { is: true, kind: 'appendix' };
    // 关键词型标题：仅在非附录块内、且足够短（不像一句话），避免正文短句被提为标题
    if (curKind !== 'appendix' && s.length <= 12 && SEC_KEYWORDS.some(function (k) { return s.indexOf(k) >= 0; })) return { is: true, kind: 'narrative' };
    return { is: false };
  }
  function structureDoc(text) {
    text = normalizeText(text || '');
    /* 仅去除行首尾空白，不清除行内 \t（docxToText 用制表符保留表格列结构，供富文本渲染识别为表格） */
    var lines = (text || '').split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length; });
    var narrative = [], appendix = [], cur = null, curKind = 'narrative';
    function pushCur() {
      if (!cur) return;
      // 保留被识别出的标题（即使正文为空，仅丢弃无内容的默认回退块）
      var isFallback = (cur.title === '体检结果叙述' && !cur.body.trim());
      if (cur.title.trim() && !isFallback) (curKind === 'appendix' ? appendix : narrative).push(cur);
    }
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i];
      var info = classifyHeading(s, i, curKind);
      if (info.is) {
        pushCur();
        cur = { title: s, body: '' };
        curKind = info.kind;
      } else {
        if (!cur) cur = { title: '体检结果叙述', body: '' };
        cur.body += (cur.body ? '\n' : '') + s;
      }
    }
    pushCur();
    return { narrative: narrative, appendix: appendix };
  }

  var METHOD_LABEL = { 'pdf-text': 'PDF 文本', 'pdf-ocr': 'PDF 图片OCR', 'image-ocr': '图片 OCR', 'text': '粘贴/文本', 'paste': '粘贴/文本', 'docx': 'Word 文档' };

  window.ExtractEngine = {
    extract: extract,
    normalizeText: normalizeText,
    renderReview: renderReview,
    fileToText: fileToText,
    structureDoc: structureDoc,
    labelOf: labelOf,
    methodLabel: function (m) { return METHOD_LABEL[m] || '文字'; }
  };
})();
