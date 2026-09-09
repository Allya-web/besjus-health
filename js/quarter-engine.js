/* =============================================================
 * 季度规则引擎 quarter-engine.js
 * 3 个月月度打卡数据聚合 → 复用 RulesEngine 体检基线判定
 * → 叠加打卡依从性判定 → 季度快照 / 洞察建议 / 季节提示 / 行动清单 / 随访安排
 * ============================================================= */
(function (global) {
  'use strict';
  var KB = global.KB, RE = global.RulesEngine;

  /* ---------------- 工具 ---------------- */
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return isNaN(n) ? null : n; }
  function avg(arr) {
    var xs = arr.filter(function (x) { return x != null && !isNaN(x); });
    if (!xs.length) return null;
    var s = 0; xs.forEach(function (x) { s += Number(x); });
    return s / xs.length;
  }
  function lastOf(arr) {
    for (var i = arr.length - 1; i >= 0; i--) if (arr[i] != null && arr[i] !== '') return arr[i];
    return null;
  }
  function mode(arr) {
    var c = {}, best = null, bn = 0;
    arr.forEach(function (x) { if (!x) return; c[x] = (c[x] || 0) + 1; if (c[x] > bn) { bn = c[x]; best = x; } });
    return best;
  }
  /* 取「最差」选项（用于油炸频次 / 饮酒频次） */
  function worst(arr, orderList) {
    var best = null, bi = -1;
    arr.forEach(function (x) {
      if (!x) return;
      var i = -1;
      for (var k = 0; k < orderList.length; k++) if (x.indexOf(orderList[k]) >= 0) { i = k; break; }
      if (i > bi) { bi = i; best = x; }
    });
    return best;
  }
  /* 加权最差值（v3）：最差值出现 ≥2 次才取该等级，否则降级为「偶发」（避免单次偏差放大） */
  function weightedWorst(arr, orderList) {
    var base = worst(arr, orderList);
    if (base == null) return null;
    var worstIdx = -1;
    for (var k = 0; k < orderList.length; k++) if (base.indexOf(orderList[k]) >= 0) { worstIdx = k; break; }
    if (worstIdx <= 0) return base;               // 最差值本就是最好等级（几乎不吃/不饮）
    var cnt = 0;
    arr.forEach(function (x) {
      if (!x) return;
      var i = -1;
      for (var k = 0; k < orderList.length; k++) if (x.indexOf(orderList[k]) >= 0) { i = k; break; }
      if (i === worstIdx) cnt++;
    });
    return cnt >= 2 ? base : '偶发';
  }
  /* 身高解析（v3）：体检/PlanB 报告 > 客户档案 > 首次打卡；来源差 >2cm 标冲突 */
  function resolveHeight(bm, customer, checkins) {
    var candidates = [];
    var bh = inRange('height', bm && bm.height) ? num(bm && bm.height) : null;
    var ch = inRange('height', customer && customer.height) ? num(customer && customer.height) : null;
    var fh = null;
    for (var i = 0; i < checkins.length; i++) {
      var h = num(checkins[i].height);
      if (h != null && inRange('height', h)) { fh = h; break; }
    }
    if (bh != null) candidates.push({ h: bh, src: '体检报告' });
    if (ch != null) candidates.push({ h: ch, src: '客户档案' });
    if (fh != null) candidates.push({ h: fh, src: '首次打卡' });
    if (!candidates.length) return { height: null, source: null, conflict: false };
    var primary = candidates[0];
    var conflict = candidates.some(function (c) { return Math.abs(c.h - primary.h) > 2; });
    return { height: primary.h, source: primary.src, conflict: conflict };
  }
  /* BMI 派生（v3）：weight ÷ (height/100)²，保留 1 位小数 */
  function deriveBMI(weight, height) {
    if (weight == null || height == null) return null;
    if (Number(weight) <= 0 || Number(height) <= 0) return null;
    return Math.round((Number(weight) / Math.pow(Number(height) / 100, 2)) * 10) / 10;
  }
  /* v3 数据质量校验：合理值范围（超出标「数据待核实」，不参与聚合） */
  var VALID_RANGES = {
    weight: [30, 200], height: [100, 220],
    sbp: [70, 260], dbp: [40, 160],
    fpg: [1.0, 33.3], hr: [30, 220], bmi: [10, 60]
  };
  function inRange(code, v) {
    var r = VALID_RANGES[code];
    if (!r || v == null) return true;
    var n = Number(v);
    if (isNaN(n)) return false;
    return n >= r[0] && n <= r[1];
  }
  function addMonths(dateStr, n) {
    var d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var m = d.getMonth() + n;
    return new Date(d.getFullYear(), m, d.getDate());
  }
  /* 提取 'YYYY-MM' 形式的年月（兼容 '2026-06-15' / '2026年6月' / '2026.06'），无法识别返回 null */
  function ym(s) {
    if (s == null) return null;
    var x = String(s).trim(), m = x.match(/^(\d{4})\D{0,1}(\d{1,2})/);
    if (!m) return null;
    var mo = Number(m[2]);
    return m[1] + '-' + (mo < 10 ? '0' + mo : '' + mo);
  }
  /* 两份年月字符串是否同一月份（YYYY-MM 比较） */
  function sameMonth(s1, s2) {
    var a = ym(s1), b = ym(s2);
    return !!(a && b && a === b);
  }
  function fmtYM(d) { return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月'; }
  function monthNum(s) {
    if (!s) return null;
    var m = String(s).match(/(\d{1,2})\s*月/);
    return m ? Number(m[1]) : null;
  }
  /* 服务季度所覆盖的中间月份（用于季节匹配兜底）
   * 按最近打卡月份推断区间中值（v3.0 起不再使用固定日历季度映射） */
  function quarterMiddleMonth(agg, c) {
    var nums = (agg.months || []).map(function (m) { return monthNum(m.month); })
      .filter(function (n) { return n; });
    if (nums.length) {
      var mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums);
      return Math.round((mn + mx) / 2);
    }
    return null;
  }
  function sleepHoursOf(ck) {
    var h = num(ck.sleepHours);
    if (h != null) return h;
    var q = ck.sleep || '';
    if (q.indexOf('好') >= 0) return 7.5;
    if (q.indexOf('一般') >= 0) return 6.5;
    if (q.indexOf('差') >= 0) return 5.5;
    return null;
  }

  /* =============================================================
   * 一、月度打卡聚合
   * ============================================================= */
  function aggregate(checkins, baselineMetrics, customer) {
    checkins = (checkins || []).filter(function (c) { return c && (c.month || c.date); });
    var bm = baselineMetrics || {};
    var agg = { filled: checkins.length, months: [], dataIssues: [] };

    var medDone = 0, medNeed = 0, hasMed = false;
    var weekMins = [], exFreqs = [], exMins = [], sleeps = [], weights = [];
    var sbps = [], dbps = [], fpgs = [], hrs = [], smokes = [];
    var diets = [], frieds = [], drinks = [];
    var symptomMonths = 0, symptomScore = 0, symptomCount = {}, questions = [], newSymptoms = [];
    /* 首月基线：记录本季度首个有该维度打卡数据的月份值（按打卡时间顺序） */
    var first = {};

    checkins.forEach(function (ck) {
      /* 服药依从性三档（v3）：规律服用=100 / 偶尔吃=70 / 几乎不吃=0；
       * 旧版「是」=100 /「否」=50 兼容；历史天数字段按 md/30×100 折算 */
      var md = num(ck.medDays), mn = num(ck.medNeed);
      var mdScore = null;
      if (ck.medDays === '规律服用') mdScore = 100;
      else if (ck.medDays === '偶尔吃') mdScore = 70;
      else if (ck.medDays === '几乎不吃') mdScore = 0;
      else if (ck.medDays === '是') mdScore = 100;
      else if (ck.medDays === '否') mdScore = 50;
      else if (md != null) mdScore = Math.round(md / (mn != null ? mn : 30) * 100);
      if (mdScore != null) { hasMed = true; medDone += mdScore; medNeed += 100; }
      if (first.medAdherence == null && mdScore != null) first.medAdherence = mdScore;
      var f = num(ck.exFreq), mi = num(ck.exMin);
      if (f != null) exFreqs.push(f);
      if (mi != null) exMins.push(mi);
      if (f != null && mi != null) {
        weekMins.push(f * mi);
        if (first.weeklyExercise == null) { first.weeklyExercise = f * mi; first.exFreq = f; first.exMin = mi; }
      }
      var sh = sleepHoursOf(ck); if (sh != null) { sleeps.push(sh); if (first.sleepHours == null) first.sleepHours = sh; }
      var w = num(ck.weight);
      if (w != null) { if (inRange('weight', w)) { weights.push(w); if (first.weight == null) first.weight = w; } else agg.dataIssues.push({ code: 'weight', value: w, month: ck.month || ck.date }); }
      var s = num(ck.sbp);
      if (s != null) { if (inRange('sbp', s)) sbps.push(s); else agg.dataIssues.push({ code: 'sbp', value: s, month: ck.month || ck.date }); }
      var d = num(ck.dbp);
      if (d != null) { if (inRange('dbp', d)) dbps.push(d); else agg.dataIssues.push({ code: 'dbp', value: d, month: ck.month || ck.date }); }
      var g = num(ck.fpg);
      if (g != null) { if (inRange('fpg', g)) fpgs.push(g); else agg.dataIssues.push({ code: 'fpg', value: g, month: ck.month || ck.date }); }
      var h = num(ck.hr);
      if (h != null) { if (inRange('hr', h)) hrs.push(h); else agg.dataIssues.push({ code: 'hr', value: h, month: ck.month || ck.date }); }
      var sm = num(ck.smoke); if (sm != null) smokes.push(sm);
      if (ck.diet) diets.push(ck.diet);
      if (ck.fried) frieds.push(ck.fried);
      if (ck.drink) drinks.push(ck.drink);

      var syms = ck.symptoms || [];
      var hasNew = ck.newSymptom && String(ck.newSymptom).trim();
      if (syms.length || hasNew) symptomMonths++;
      /* v3 症状风险加权：高危症状（胸闷/心悸/麻木/视物模糊）1 月=2 分，一般=1 分 */
      var HIGH_RISK = ['胸闷', '心悸', '麻木', '视物模糊'];
      var highRisk = syms.some(function (x) { return HIGH_RISK.some(function (k) { return x.indexOf(k) >= 0; }); });
      if (highRisk) symptomScore += 2;
      else if (syms.length || hasNew) symptomScore += 1;
      syms.forEach(function (x) { symptomCount[x] = (symptomCount[x] || 0) + 1; });
      if (hasNew) newSymptoms.push({ month: ck.month || ck.date, text: String(ck.newSymptom).trim() });
      if (ck.question && String(ck.question).trim()) questions.push({ month: ck.month || ck.date, text: String(ck.question).trim() });

      agg.months.push({
        month: ck.month || ck.date,
        weekMin: (f != null && mi != null) ? f * mi : null,
        sleep: sh, weight: w,
        bp: (s != null && d != null) ? (s + '/' + d) : null,
        symptoms: syms.slice(), medDays: md
      });
    });

    agg.medAdherence = hasMed && medNeed > 0 ? Math.round(medDone / medNeed * 100) : null;
    agg.firstMedAdherence = first.medAdherence;
    agg.weeklyExercise = avg(weekMins);
    agg.firstWeeklyExercise = first.weeklyExercise;
    agg.firstExFreq = first.exFreq;
    agg.firstExMin = first.exMin;
    agg.exFreq = avg(exFreqs);
    agg.exMin = avg(exMins);
    agg.sleepHours = avg(sleeps);
    agg.firstSleepHours = first.sleepHours;
    agg.weight = lastOf(weights);
    agg.weightAvg = avg(weights);
    var bw = num(bm.weight);
    if (bw == null && customer) bw = num(customer.baseline_weight);   // 体检无体重时回退档案体重
    agg.weightDelta = (agg.weight != null && bw != null) ? Number((agg.weight - bw).toFixed(1)) : null;
    agg.weightDeltaPct = (agg.weight != null && bw != null) ? Number(((agg.weight - bw) / bw * 100).toFixed(1)) : null;
    /* v3 身高解析 + BMI 派生（体重/BMI 绝对状态与趋势双轨的数据底座） */
    var ht = resolveHeight(bm, customer, checkins);
    agg.height = ht.height;
    agg.heightSource = ht.source;
    agg.heightConflict = ht.conflict;
    agg.bmi = deriveBMI(agg.weight, ht.height);
    agg.bmiFirst = deriveBMI(first.weight, ht.height);
    agg.bmiDelta = (agg.bmi != null && agg.bmiFirst != null) ? Number((agg.bmi - agg.bmiFirst).toFixed(1)) : null;
    agg.sbp = sbps.length ? Math.round(avg(sbps)) : null;
    agg.dbp = dbps.length ? Math.round(avg(dbps)) : null;
    agg.fpg = fpgs.length ? Number(avg(fpgs).toFixed(1)) : null;
    agg.hr = hrs.length ? Math.round(avg(hrs)) : null;
    agg.smoke = smokes.length ? Math.round(avg(smokes)) : null;
    agg.dietPattern = mode(diets);
    agg.friedFreq = weightedWorst(frieds, ['几乎不', '偶尔', '1-2', '3 次', '3次', '总是']);
    agg.drink = weightedWorst(drinks, ['不饮', '偶尔', '经常']);
    agg.symptomMonths = checkins.length ? symptomMonths : null;
    agg.symptomScore = checkins.length ? symptomScore : null;
    agg.symptomTop = Object.keys(symptomCount).sort(function (a, b) { return symptomCount[b] - symptomCount[a]; })
      .map(function (k) { return { name: k, times: symptomCount[k] }; });
    agg.newSymptoms = newSymptoms;
    agg.questions = questions;
    return agg;
  }

  /* =============================================================
   * 二、打卡维度判定
   * ============================================================= */
  function evaluateCheckin(agg) {
    var out = [];
    KB.CHECKIN_DIM.forEach(function (dim) {
      var v = agg[dim.code];
      if (dim.code === 'weightStatus') {
        /* v3 体重/BMI 双轨：判定需要 bmiCurrent + weightDeltaPct + height 三输入 */
        var r = dim.evaluate(agg);
        if (r) out.push({
          code: dim.code, label: dim.label, unit: dim.unit, dim: dim.dim,
          standard: dim.standard, value: agg.bmi != null ? agg.bmi : agg.weightDeltaPct,
          level: r.level, phrase: r.phrase, tags: r.tags || [], text: r.text
        });
        return;
      }
      if (v == null || v === '') return;
      var r = dim.evaluate(v);
      if (!r) return;
      out.push({
        code: dim.code, label: dim.label, unit: dim.unit, dim: dim.dim,
        standard: dim.standard, value: v,
        level: r.level, phrase: r.phrase, tags: r.tags || [], text: r.text
      });
    });
    return out;
  }

  /* =============================================================
   * 三、季度快照表（基线 vs 本季度 vs 变化趋势）
   * ============================================================= */
  var SNAP_SPEC = [
    { code: 'bp',       label: '血压',          unit: 'mmHg',    dir: 'lower',  tol: 5,   from: 'homeBP' },
    { code: 'weight',   label: '体重 / BMI',    unit: '',        dir: 'lower',  tol: 1,   from: 'weight' },
    { code: 'hr',       label: '心率',          unit: '次/分',   dir: 'none',   tol: 6,   from: 'hr' },
    { code: 'fpg',      label: '空腹血糖',      unit: 'mmol/L',  dir: 'lower',  tol: 0.4, from: 'fpg' },
    { code: 'tc',       label: '总胆固醇',      unit: 'mmol/L',  dir: 'lower',  tol: 0.3, from: null },
    { code: 'ldl',      label: '低密度脂蛋白',  unit: 'mmol/L',  dir: 'lower',  tol: 0.3, from: null },
    { code: 'tg',       label: '甘油三酯',      unit: 'mmol/L',  dir: 'lower',  tol: 0.3, from: null },
    { code: 'waist',    label: '腰围',          unit: 'cm',      dir: 'lower',  tol: 2,   from: null },
    { code: 'ua',       label: '血尿酸',        unit: 'μmol/L',  dir: 'lower',  tol: 30,  from: null },
    { code: 'vitd',     label: '25 羟维生素 D', unit: 'ng/mL',   dir: 'higher', tol: 3,   from: null },
    { code: 'bmd',      label: '骨密度 T 值',   unit: 'T',       dir: 'higher', tol: 0.3, from: null },
    { code: 'cyfra21',  label: 'CYFRA21-1',     unit: 'ng/mL',   dir: 'lower',  tol: 0.5, from: null },
    { code: 'ggt',      label: '谷氨酰转肽酶',  unit: 'U/L',     dir: 'lower',  tol: 8,   from: null },
    { code: 'egfr',     label: '肾小球滤过率',  unit: 'mL/min',  dir: 'higher', tol: 8,   from: null }
  ];

  function findRes(base, code) {
    for (var i = 0; i < base.results.length; i++) if (base.results[i].code === code) return base.results[i];
    return null;
  }
  function trendOf(b, q, dir, tol) {
    if (b == null || q == null) return { text: '—', level: null };
    var d = q - b;
    if (Math.abs(d) <= tol) return { text: '稳定', level: KB.LEVEL.NORMAL };
    var worseUp = (dir === 'lower');
    if (dir === 'none') return { text: (d > 0 ? '↑ 上升' : '↓ 下降'), level: KB.LEVEL.ATTENTION };
    if ((d > 0 && !worseUp) || (d < 0 && worseUp)) return { text: (d > 0 ? '↑ 改善' : '↓ 改善'), level: KB.LEVEL.NORMAL };
    return { text: (d > 0 ? '↑ 需关注' : '↓ 需关注'), level: KB.LEVEL.ATTENTION };
  }

  /* =============================================================
   * v53 复查覆盖 + 异常代码集合
   *   - quarterRetestCoverage(retest): 当季复查检查单覆盖的 SNAP_SPEC code 集合
   *   - calcQKeyByReportDate(c): 客户报告日期 → 公历季度键（如 "Q3_2026"）
   *   - collectAnomalyTags(base, cRes, coreIssues): 拼接"入组异常 + 当季打卡异常 + 入组核心问题"标签集
   * ============================================================= */
  function quarterRetestCoverage(retest) {
    var out = {};
    if (!retest) return out;
    var m = retest.metrics || {};
    /* 血压需 sbp+dbp 同时存在才算复查覆盖 */
    if (m.sbp != null && m.dbp != null) out.bp = true;
    var fieldToCode = {
      weight: 'weight', hr: 'hr', fpg: 'fpg',
      tc: 'tc', ldl: 'ldl', tg: 'tg',
      waist: 'waist', ua: 'ua',
      vitd: 'vitd', bmd: 'bmd',
      cyfra21: 'cyfra21', ggt: 'ggt', egfr: 'egfr'
    };
    Object.keys(m).forEach(function (k) {
      if (m[k] != null && fieldToCode[k]) out[fieldToCode[k]] = true;
    });
    return out;
  }
  function calcQKeyByReportDate(c) {
    var rd = c && c.reportDate ? new Date(c.reportDate) : null;
    if (!rd || isNaN(rd.getTime())) return '';
    return 'Q' + Math.floor(rd.getMonth() / 3 + 1) + '_' + rd.getFullYear();
  }
  function collectAnomalyTags(base, cRes, coreIssues) {
    var tags = [];
    function add(t) { if (t && tags.indexOf(t) < 0) tags.push(t); }
    (base && base.tags ? base.tags : []).forEach(add);
    (cRes || []).forEach(function (r) { (r.tags || []).forEach(add); });
    (coreIssues || []).forEach(add);
    return tags;
  }

  function buildSnapshot(base, agg, qin) {
    var bm = (qin.baseline && qin.baseline.metrics) || {};
    var src = (qin.baseline && qin.baseline.source) || '基线体检';
    var cust = qin.customer || {};
    var rows = [];

    /* 当季是否上传过新体检报告：体检日期(examDate)落在本服务季度月份内。
     * 优先用 app.js 显式注入的 quarterMonths（服务季度推算），无则回退本季打卡月份 */
    var qMonths = (qin && qin.quarterMonths) || [];
    if (!qMonths.length && agg.months) qMonths = agg.months.map(function (m) { return (m && m.month) || m; });
    var examUploaded = qMonths.some(function (m) { return sameMonth(m, qin && qin.examDate); });

    /* v53 行级门控入参：把复查覆盖 / 异常代码集合提到 SNAP_SPEC 循环外，供 sp.from != null（居家打卡）与 sp.from == null（体检类）两侧共享 */
    var anomalyCodes = (qin && qin._anomalyCodes) || [];
    var retestCodes = (qin && qin._retestCodes) || {};
    var hasRetest = !!(qin && qin._retest);

    SNAP_SPEC.forEach(function (sp) {
      var res, bText, bVal, qVal = null, qText, source = src, trend, standard;

      if (sp.code === 'bp') {
        var bs = num(bm.sbp), bd = num(bm.dbp);
        if (bs == null && bd == null) return;
        res = findRes(base, 'bp');
        bText = (bs != null ? bs : '—') + '/' + (bd != null ? bd : '—');
        bVal = bs;
        if (agg.sbp != null && agg.dbp != null) {
          qVal = agg.sbp; qText = agg.sbp + '/' + agg.dbp; source = src + ' + 居家打卡';
        } else { qText = '—'; }
      } else if (sp.code === 'weight') {
        var bw = num(bm.weight), bh = num(bm.height);
        if (bw == null) return;
        res = findRes(base, 'bmi');
        var bbmi = bh ? (bw / Math.pow(bh / 100, 2)).toFixed(2) : null;
        bText = bw + 'kg' + (bbmi ? ' / ' + bbmi : '');
        bVal = bw;
        if (agg.weight != null) {
          qVal = agg.weight;
          var qbmi = agg.bmi != null ? agg.bmi : (bh ? (agg.weight / Math.pow(bh / 100, 2)).toFixed(2) : null);
          qText = agg.weight + 'kg' + (qbmi != null ? ' / ' + qbmi : '');
          source = src + ' + 月度打卡表';
          /* v3 绝对状态优先趋势：BMI ≥24/≥28 恒超重/肥胖，不被「稳定」覆盖 */
          var qbmiNum = num(qbmi);
          if (qbmiNum != null && qbmiNum >= 28) trend = { text: '肥胖（需减重）', level: KB.LEVEL.ABNORMAL };
          else if (qbmiNum != null && qbmiNum >= 24) trend = { text: '超重（需减重）', level: KB.LEVEL.ATTENTION };
          else if (qbmiNum != null && qbmiNum < 18.5) trend = { text: '偏瘦（需关注）', level: KB.LEVEL.ATTENTION };
          else {
            var wd2 = agg.weight - bVal;
            var wdPct2 = bVal !== 0 ? (wd2 / bVal * 100) : 0;
            if (Math.abs(wdPct2) <= 2) trend = { text: '稳定', level: KB.LEVEL.NORMAL };
            else trend = { text: (wd2 > 0 ? '↑ 上升' : '↓ 下降') + '（' + (wd2 > 0 ? '+' : '') + wd2.toFixed(1) + ' kg，' + (wdPct2 > 0 ? '+' : '') + wdPct2.toFixed(1) + '%）', level: KB.LEVEL.ATTENTION };
          }
        } else { qText = '—'; }
      } else {
        bVal = num(bm[sp.code]);
        if (bVal == null) return;
        res = findRes(base, sp.code);
        bText = bVal + (sp.unit ? ' ' + sp.unit : '');
        if (sp.from && agg[sp.from] != null) {
          qVal = num(agg[sp.from]);
          qText = qVal + (sp.unit ? ' ' + sp.unit : '');
          source = src + ' + 居家打卡';
        } else if (qin._retest && qin._retest.metrics && qin._retest.metrics[sp.code] != null && retestCodes[sp.code]) {
          /* v53：体检类指标被当季复查覆盖时，本季度值取复查值 */
          qVal = num(qin._retest.metrics[sp.code]);
          qText = qVal + (sp.unit ? ' ' + sp.unit : '');
          source = '复查检查单（' + (qin._qKey || '') + '）';
        } else {
          qText = '—';
        }
      }

      if (sp.code !== 'weight') trend = trendOf(bVal, qVal, sp.dir, sp.tol);
      if (qVal == null) trend = { text: '—', level: null };
      standard = res ? res.phrase : '—';
      /* v53 行级门控：
       *   - 居家打卡类（sp.from）：保留 v52 行为——当季打卡值即可显示；
       *   - 体检类（sp.from 为空）：必须满足 ① 当季有复查 ② 该指标被当季复查覆盖 ③ 该指标之前异常（入组/打卡/核心问题）。
       *   - 三者缺一则 hasQ=false，渲染层隐藏该行；整组基础指标全无则整块不显示。 */
      var hasQ = sp.from
        ? (qVal != null)
        : (hasRetest && retestCodes[sp.code] && (anomalyCodes.indexOf(sp.code) >= 0));

      rows.push({
        group: '基础指标', label: sp.label, unit: sp.unit,
        baseline: bText, quarter: qText, trend: trend.text, trendLevel: trend.level,
        standard: standard, source: source, level: res ? res.level : null, hasQ: hasQ
      });
    });

    /* 打卡维度行（生活方式 · 数据来源：客户档案基线 / 月度打卡表）
     * 基线值优先级：客户档案（入组评估）> 本季度首次打卡月值；体重基线：体检报告 > 客户档案 */
    /* 档案生活方式基线（入组评估录入） */
    function archiveBaseline(code) {
      if (code === 'weeklyExercise') {
        var f = num(cust.ex_freq), mi = num(cust.ex_min);
        if (f != null && mi != null) return { val: f * mi, text: (f * mi) + ' 分钟/周', extra: '（约 ' + f.toFixed(1) + ' 次/周 × ' + Math.round(mi) + ' 分钟）', src: '客户档案 + 月度打卡表' };
      } else if (code === 'sleepHours') {
        var s = num(cust.sleep_hours);
        if (s != null) return { val: s, text: s + ' 小时', extra: '', src: '客户档案 + 月度打卡表' };
      } else if (code === 'medAdherence') {
        if (cust.med_regular === '是') return { val: 100, text: '100%', extra: '', src: '客户档案 + 月度打卡表' };
        /* 档案记录「未规律服药」：折半计 50%，避免基线直接记为 0%（未规律 ≠ 未服药） */
        if (cust.med_regular === '否') return { val: 50, text: '50%', extra: '（档案记录未规律服药，折半计）', src: '客户档案 + 月度打卡表' };
      }
      return null;
    }
    /* 体重基线：优先体检报告，其次客户档案 baseline_weight */
    function archiveWeight() {
      var bw = num(bm.weight);
      if (bw != null) return { val: bw, text: bw + ' kg', src: '体检报告 + 月度打卡表' };
      bw = num(cust.baseline_weight);
      if (bw != null) return { val: bw, text: bw + ' kg', src: '客户档案 + 月度打卡表' };
      return null;
    }
    var cRes = evaluateCheckin(agg);
    var DIM_IN_SNAP = ['weeklyExercise', 'sleepHours', 'medAdherence', 'weightStatus', 'symptomScore'];
    var FIRST_KEY = { weeklyExercise: 'firstWeeklyExercise', sleepHours: 'firstSleepHours', medAdherence: 'firstMedAdherence' };
    var LIFE_TREND = {
      weeklyExercise: { dir: 'higher', tol: 15, unit: ' 分钟/周', dec: 0 },
      sleepHours:     { dir: 'higher', tol: 0.5, unit: ' 小时', dec: 1 },
      medAdherence:   { dir: 'higher', tol: 5, unit: '%', dec: 0 }
    };
    DIM_IN_SNAP.forEach(function (code) {
      var r = null;
      for (var i = 0; i < cRes.length; i++) if (cRes[i].code === code) r = cRes[i];
      var dim = KB.checkinLookup(code);
      if (!dim) return;
      if (!r) {
        /* 无季度数据：仍可引用档案/体检基线，季度值显示待填写 */
        var nb = '—', ns = '月度打卡表';
        var ab0 = archiveBaseline(code);
        if (ab0) { nb = ab0.text + ab0.extra; ns = ab0.src; }
        else if (code === 'weightStatus') { var aw0 = archiveWeight(); if (aw0) { nb = aw0.text; ns = aw0.src; } }
        rows.push({ group: '生活方式', label: dim.label, unit: dim.unit, baseline: nb, quarter: '待填写',
          trend: '—', trendLevel: null, standard: dim.standard, source: ns, level: null });
        return;
      }
      var extra = '';
      if (code === 'weeklyExercise' && agg.exFreq != null) extra = '（约 ' + agg.exFreq.toFixed(1) + ' 次/周 × ' + Math.round(agg.exMin || 0) + ' 分钟）';

      /* 基线值：体重优先体检报告、回退档案；其余维度档案基线 > 首月打卡 */
      var bText = '—', bExtra = '', bVal = null, trend = { text: '—', level: null }, lifeSource = '月度打卡表';
      if (code === 'weightStatus') {
        var aw = archiveWeight();
        if (aw) {
          bVal = aw.val; bText = aw.text; lifeSource = aw.src;
          /* v3：基线体重旁附 BMI（有身高时），趋势用 ±2% 容差 */
          if (agg.height != null && bVal != null) {
            var bbmi = deriveBMI(bVal, agg.height);
            if (bbmi != null) bText = aw.text + ' / BMI ' + bbmi;
          }
          if (agg.weight != null && bVal != null) {
            var wd = agg.weight - bVal;
            var wdPct = bVal !== 0 ? (wd / bVal * 100) : 0;
            if (Math.abs(wdPct) <= 2) trend = { text: '稳定', level: KB.LEVEL.NORMAL };
            else trend = { text: (wd > 0 ? '↑ 上升' : '↓ 下降') + '（' + (wd > 0 ? '+' : '') + wd.toFixed(1) + ' kg，' + (wdPct > 0 ? '+' : '') + wdPct.toFixed(1) + '%）', level: KB.LEVEL.ATTENTION };
          }
        }
      } else {
        var ab = archiveBaseline(code);
        if (ab) { bVal = ab.val; bText = ab.text; bExtra = ab.extra; lifeSource = ab.src; }
        else if (FIRST_KEY[code]) bVal = agg[FIRST_KEY[code]];
        if (bVal != null) {
          var br = dim.evaluate(bVal);
          if (br) {
            if (!ab) bText = br.text;
            if (!ab && code === 'weeklyExercise' && agg.firstExFreq != null)
              bExtra = '（约 ' + agg.firstExFreq.toFixed(1) + ' 次/周 × ' + Math.round(agg.firstExMin || 0) + ' 分钟）';
          }
          var cfg = LIFE_TREND[code];
          if (cfg && r.value != null) {
            var t = trendOf(bVal, r.value, cfg.dir, cfg.tol);
            var d = r.value - bVal;
            if (t.text === '稳定') trend = { text: '稳定', level: t.level };
            else trend = { text: t.text + '（' + (d > 0 ? '+' : '') + d.toFixed(cfg.dec) + cfg.unit + '）', level: t.level };
          }
        }
      }

      rows.push({
        group: '生活方式', label: dim.label, unit: dim.unit,
        baseline: bText + bExtra, quarter: r.text + extra, trend: trend.text, trendLevel: trend.level,
        standard: r.phrase, source: lifeSource, level: r.level
      });
    });

    return rows;
  }

  /* =============================================================
   * 四、健康洞察与改善建议
   * ============================================================= */
  var INSIGHT_ORDER = ['exercise', 'diet', 'sleep', 'adherence'];
  function buildInsights(tags, season, agg) {
    var out = [];
    INSIGHT_ORDER.forEach(function (key) {
      var lib = KB.QUARTER_INSIGHT[key];
      if (!lib) return;

      /* 是否需要输出该维度：运动/饮食始终输出；睡眠与依从性按触发或有数据输出 */
      var condTags = Object.keys(lib.cond).filter(function (t) { return tags.indexOf(t) >= 0; });
      var always = (key === 'exercise' || key === 'diet');
      var hasData = (key === 'sleep') ? (agg.sleepHours != null)
        : (key === 'adherence') ? (agg.medAdherence != null || agg.smoke != null || agg.drink != null) : true;
      if (!always && !condTags.length && !hasData) return;

      /* 引言：按标签优先匹配 */
      var lead = lib.lead['_default'];
      for (var i = 0; i < condTags.length; i++) { if (lib.lead[condTags[i]]) { lead = lib.lead[condTags[i]]; break; } }
      if (lead === lib.lead['_default']) {
        for (var t in lib.lead) { if (t !== '_default' && tags.indexOf(t) >= 0) { lead = lib.lead[t]; break; } }
      }

      /* 条目：通用 + 条件（去重） */
      var items = [], seen = {};
      function push(it) { if (!seen[it.t]) { seen[it.t] = 1; items.push(it); } }
      condTags.forEach(function (t) { lib.cond[t].forEach(push); });
      lib.base.forEach(push);

      /* 季节补充（运动 / 饮食） */
      if (season && season.data) {
        if (key === 'exercise') push({ t: '当季运动调整', d: season.data.exercise });
        if (key === 'diet') push({ t: '当季饮食搭配', d: season.data.diet });
      }

      out.push({ key: key, title: lib.title, lead: lead, items: items, triggers: condTags });
    });
    return out;
  }

  /* =============================================================
   * 五、本季度行动清单 + 随访安排
   * ============================================================= */
  function buildActions(tags, reportDate) {
    var list = [];
    tags.forEach(function (t) {
      var a = KB.actionFor(t);
      if (!a) return;
      if (list.some(function (x) { return x.action === a.action; })) return;
      list.push({ tag: t, priority: a.priority, action: a.action, goal: a.goal, when: a.when });
    });
    list.sort(function (a, b) { return a.priority - b.priority; });
    list = list.slice(0, 8);
    return list.map(function (a, i) {
      var whenText;
      if (a.when === '持续') whenText = '本季度持续执行';
      else {
        var n = parseInt(String(a.when).replace(/[^0-9]/g, ''), 10) || 1;
        whenText = fmtYM(addMonths(reportDate, n)) + '底前';
      }
      return { no: i + 1, action: a.action, goal: a.goal, when: whenText, status: '待开始', tag: a.tag };
    });
  }

  function buildFollowups(tags, reportDate, quarterInfo) {
    var rows = [];
    var next = addMonths(reportDate, 3);
    rows.push({ item: '下季度随访时间', arrange: fmtYM(next) + '（' + (quarterInfo.nextQuarter || '下一季度') + '）' });

    var near = [], far = [];
    tags.forEach(function (t) {
      var f = KB.followupFor(t);
      if (!f) return;
      if (f.months <= 3) { if (near.indexOf(f.item) < 0) near.push(f.item); }
      else far.push({ item: f.item, months: f.months });
    });
    if (near.length) {
      rows.push({ item: '下次复查（近期）', arrange: fmtYM(addMonths(reportDate, 3)) + '前：复查 ' + near.join('、') });
    } else {
      rows.push({ item: '下次复查（近期）', arrange: '本季度无强制近期复查项目，按年度体检计划执行' });
    }
    far.sort(function (a, b) { return a.months - b.months; });
    var seen = {};
    far.forEach(function (f) {
      if (seen[f.item]) return; seen[f.item] = 1;
      rows.push({ item: f.item, arrange: '建议 ' + f.months + ' 个月后（' + fmtYM(addMonths(reportDate, f.months)) + '）复查' });
    });
    rows.push({ item: '检查预约协助', arrange: '如需协助预约专科门诊或复查项目，请随时联系健康管理团队' });
    return rows;
  }

  /* 需重点跟进事项（取优先级最高的 3 项） */
  function buildKeyFocus(actions, agg) {
    var out = actions.slice(0, 3).map(function (a) { return a.action; });
    if (agg.symptomTop && agg.symptomTop.length) out.push(agg.symptomTop[0].name + '（打卡出现 ' + agg.symptomTop[0].times + ' 次）持续观察');
    return out.slice(0, 4);
  }

  /* 客户提问 → 解答（健管师可覆写，未填写时给出知识库草稿） */
  function buildQnA(agg, tags, answers) {
    answers = answers || [];
    var out = [];
    (agg.questions || []).forEach(function (q, i) {
      var manual = answers[i] && String(answers[i]).trim();
      out.push({ month: q.month, q: q.text, a: manual || draftAnswer(q.text, tags), auto: !manual });
    });
    return out;
  }
  function draftAnswer(q, tags) {
    var hits = [];
    Object.keys(KB.ADVICE).forEach(function (t) {
      if (tags.indexOf(t) < 0) return;
      var a = KB.ADVICE[t];
      if (q.indexOf(a.title.replace(/管理|管控|干预|随访|复查|保护/g, '')) >= 0) hits.push(a);
    });
    if (!hits.length) {
      tags.forEach(function (t) { if (KB.ADVICE[t] && hits.length < 2) hits.push(KB.ADVICE[t]); });
    }
    if (!hits.length) return '（请健管师/私人医生在此填写针对性解答。）';
    return hits.slice(0, 2).map(function (a) { return a.title + '：' + a.text; }).join(' ');
  }

  /* 季度寄语上下文 */
  function messageCtx(base, agg, qin, season, actions) {
    var c = qin.customer || {};
    var bp = (agg.sbp != null && agg.dbp != null) ? (agg.sbp + '/' + agg.dbp + ' mmHg')
      : ((qin.baseline && qin.baseline.metrics && qin.baseline.metrics.sbp) ? (qin.baseline.metrics.sbp + '/' + qin.baseline.metrics.dbp + ' mmHg') : '');
    var concerns = base.results.filter(function (r) {
      return r.level === KB.LEVEL.ATTENTION || r.level === KB.LEVEL.ABNORMAL;
    }).slice(0, 2).map(function (r) { return r.label + r.phrase; });
    var reassure = [];
    if (base.tags.indexOf('甲状腺结节') >= 0) reassure.push('甲状腺结节形态规则');
    if (base.tags.indexOf('肺结节') >= 0) reassure.push('肺结节体积微小、恶性风险低');
    if (base.tags.indexOf('泌尿系异常') >= 0) reassure.push('肾脏病变以良性可能性大');
    return {
      name: c.name, gender: c.gender,
      bpText: bp,
      concernText: concerns.join('、'),
      coreTask: actions.length ? actions[0].action.replace(/^启动|^执行/, '') + '，同时保持既有指标稳定' : '',
      seasonLabel: season ? KB.seasonShortLabel(season.name) : '',
      reassureText: reassure.length ? (reassure.join('、') + '，') : ''
    };
  }

  /* =============================================================
   * 主入口
   * ============================================================= */
  function evaluate(qin) {
    qin = qin || {};
    var c = qin.customer || {};
    var bm = (qin.baseline && qin.baseline.metrics) || {};

    /* 1. 复用同一规则引擎完成体检基线判定 */
    var base = RE.evaluate({
      customer: { name: c.name, gender: c.gender, age: c.age, type: c.type, reportMonth: c.reportMonth, ascvd_risk: c.ascvd_risk || '', ldl_baseline: c.ldl_baseline },
      metrics: bm, ffr: {}, narrative: {}, consultation: []
    });

    /* 2. 打卡聚合与判定 */
    var agg = aggregate(qin.checkins, bm, c);
    var cRes = evaluateCheckin(agg);

    /* 3. 标签合并（体检 + 打卡） */
    var tags = base.tags.slice();
    cRes.forEach(function (r) {
      (r.tags || []).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
    });

    /* 3.5 v53 复查覆盖 + 异常代码集合
     *   qKey：报告日期所在公历季度（"Q3_2026"）
     *   retest：客户档案 retests[qKey] 当季复查数据
     *   retestCodes：本次复查覆盖的 SNAP_SPEC code 集合
     *   anomalyCodes：入组异常 + 当季打卡异常 + 入组核心问题 映射的 SNAP_SPEC code 集合
     *   注入到 qin 供 buildSnapshot 行级门控使用 */
    var qKey = qin.qKey || calcQKeyByReportDate(c);
    var retest = (c.retests || {})[qKey] || null;
    var retestCodes = quarterRetestCoverage(retest);
    var anomalyCodes = KB.snapCodesForTags(collectAnomalyTags(base, cRes, c.core_issues));
    qin.qKey = qKey;
    qin._qKey = qKey;
    qin._retest = retest;
    qin._retestCodes = retestCodes;
    qin._anomalyCodes = anomalyCodes;

    /* 4. 季节（v3.0）：报告生成月份优先 → 最近打卡月份中值 → 入组月份 → 当前月 */
    var month = null;
    if (c.reportMonth) month = Number(c.reportMonth);
    else if (c.reportDate) { var rd = new Date(c.reportDate); if (!isNaN(rd.getTime())) month = rd.getMonth() + 1; }
    if (month == null) month = quarterMiddleMonth(agg, c);
    if (month == null && c.enroll_date) { var ed = new Date(c.enroll_date); if (!isNaN(ed.getTime())) month = ed.getMonth() + 1; }
    if (month == null) month = new Date().getMonth() + 1;
    var season = KB.seasonOfMonth(month);
    var quarterInfo = {
      quarter: c.quarter || 'Q1',
      nextQuarter: nextQuarter(c.quarter),
      range: KB.seasonMonthRange(season.name),
      label: KB.seasonShortLabel(season.name)
    };

    /* 5. 生成各区块 */
    var snapshot = buildSnapshot(base, agg, qin);
    var insights = buildInsights(tags, season, agg);
    var actions = buildActions(tags, c.reportDate);
    var followups = buildFollowups(tags, c.reportDate, quarterInfo);
    var keyFocus = buildKeyFocus(actions, agg);
    var qna = buildQnA(agg, tags, qin.answers);

    /* 6. 状态统计（体检 + 打卡） */
    var stat = { normal: 0, attention: 0, abnormal: 0, critical: 0, review: 0 };
    base.results.concat(cRes).forEach(function (r) {
      var k = r.level && r.level.key;
      if (stat[k] != null) stat[k]++;
    });

    var message = KB.quarterMessage(messageCtx(base, agg, qin, season, actions));

    return {
      customer: c,
      baseline: qin.baseline || {},
      base: base,
      agg: agg,
      checkinResults: cRes,
      tags: tags,
      snapshot: snapshot,
      insights: insights,
      season: season,
      quarterInfo: quarterInfo,
      actions: actions,
      followups: followups,
      keyFocus: keyFocus,
      qna: qna,
      stat: stat,
      message: message,
      /* v53 复查元数据：供渲染层（季度报告 / 年度报告）按需展示 */
      qKey: qKey,
      retest: retest,
      retestCodes: Object.keys(retestCodes),
      anomalyCodes: anomalyCodes,
      generatedAt: new Date().toISOString()
    };
  }
  function nextQuarter(q) {
    var map = { Q1: 'Q2', Q2: 'Q3', Q3: 'Q4', Q4: '次年 Q1' };
    return map[q] || '下一季度';
  }

  /* v3 Plan B 基线导入：为「无已确认首份 A/B 版报告」的客户补建基线。
   * 仅生成基线，不回溯历史报告、不改变服务季度边界。
   * A 版含 FFR 基线，B 版自动跳过 FFR；缺失字段保持缺失，不由系统推测。 */
  function planBImport(customer, metrics, abType, examDate) {
    customer = customer || {};
    metrics = metrics || {};
    abType = (abType === 'A') ? 'A' : 'B';
    var baseline = {
      source: 'plan_b_upload',
      abType: abType,
      baseline_date: examDate || null,
      metrics: {},
      ffr: null
    };
    var FIELD_WHITELIST = ['height', 'weight', 'bmi', 'sbp', 'dbp', 'hr', 'fpg', 'tc', 'ldl', 'tg', 'waist', 'ua', 'vitd', 'bmd', 'cyfra21', 'ggt', 'egfr'];
    FIELD_WHITELIST.forEach(function (code) {
      var v = metrics[code];
      if (v != null && v !== '' && !isNaN(Number(v))) baseline.metrics[code] = v;
    });
    /* A 版额外提取 FFR 基线；B 版跳过 */
    if (abType === 'A') {
      var ffr = {};
      ['ffrLAD', 'ffrLCX', 'ffrRCA'].forEach(function (code) {
        var v = metrics[code];
        if (v != null && v !== '' && !isNaN(Number(v))) ffr[code] = v;
      });
      if (Object.keys(ffr).length) baseline.ffr = ffr;
    }
    return baseline;
  }

  global.QuarterEngine = {
    evaluate: evaluate,
    aggregate: aggregate,
    evaluateCheckin: evaluateCheckin,
    planBImport: planBImport
  };
})(window);
