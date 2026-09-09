/* =============================================================
 * 规则引擎 rules-engine.js
 * 输入数据标准化 → 数值判定 → 状态等级 + 触发标签 → 联动建议/随访/季节
 * ============================================================= */
(function (global) {
  'use strict';
  var KB = global.KB;

  /* 数值指标（参与自动判定） */
  var NUMERIC = ['sbp','dbp','hr','ldl','hdl','tc','tg','fpg','hba1c','ua','waist','lungNodule','hpylori','ggt','egfr','renalCyst','homocysteine','carotidPlaque','ecg'];

  function evaluate(input) {
    input = input || {};
    var c = input.customer || {};
    var m = input.metrics || {};

    /* 1. 标准化 ctx（含派生 BMI / 综合血压 / ASCVD 风险分层） */
    var ctx = {
      gender: c.gender,
      age: c.age,
      height: num(m.height),
      weight: num(m.weight),
      sbp: num(m.sbp),
      dbp: num(m.dbp),
      ascvdRisk: c.ascvd_risk || '',
      ldlBaseline: num(c.ldl_baseline)
    };

    /* 2. 逐指标判定 */
    var results = [];
    NUMERIC.forEach(function (code) {
      var ind = KB.lookup(code);
      if (!ind) return;
      var raw = m[code];
      if (raw == null || raw === '') return;
      var r = ind.evaluate(raw, ctx);
      if (!r) return;
      results.push({
        code: code, label: ind.label, system: ind.system, unit: ind.unit,
        value: raw, level: r.level, phrase: r.phrase, tags: r.tags || [], text: r.text || raw
      });
    });

    /* 3. 派生指标：BMI、综合血压 */
    ['bmi','bp'].forEach(function (code) {
      var ind = KB.lookup(code);
      var r = ind.evaluate(null, ctx);
      if (r) results.push({
        code: code, label: ind.label, system: ind.system, unit: ind.unit,
        value: null, level: r.level, phrase: r.phrase, tags: r.tags || [], text: r.text || ''
      });
    });

    /* 3.5 自定义指标（前端补录，与预设指标同等判定/展示） */
    KB.customIndicators().forEach(function (ind) {
      if (!ind || !ind.indicator_code) return;
      var raw = m[ind.indicator_code];
      if (raw == null || raw === '') return;
      var r = KB.evalIndicator(ind, raw);
      if (!r) return;
      results.push({
        code: ind.indicator_code, label: ind.indicator_name || ind.indicator_code,
        system: '自定义', unit: ind.indicator_unit || '',
        value: raw, level: r.level, phrase: r.phrase, tags: r.tags || [],
        text: r.text != null ? r.text : raw
      });
    });

    /* 4. 触发标签聚合（去重，按严重度排序） */
    var tagSet = {};
    results.forEach(function (r) {
      (r.tags || []).forEach(function (t) { tagSet[t] = true; });
    });
    var tags = Object.keys(tagSet);

    /* 5. 联动管理建议（内置 + 自定义） */
    var advices = [];
    tags.forEach(function (t) {
      var adv = KB.adviceFor(t);
      if (adv) advices.push(adv);
    });

    /* 6. 状态统计 */
    var stat = { normal:0, attention:0, abnormal:0, critical:0, review:0 };
    results.forEach(function (r) { stat[KB.rank(r.level) >= 0 ? r.level.key : 'normal']++; });
    // level.key: normal/attention/abnormal/critical/review
    stat = { normal:0, attention:0, abnormal:0, critical:0, review:0 };
    results.forEach(function (r) {
      if (r.level.key === 'normal') stat.normal++;
      else if (r.level.key === 'attention') stat.attention++;
      else if (r.level.key === 'abnormal') stat.abnormal++;
      else if (r.level.key === 'critical') stat.critical++;
      else if (r.level.key === 'review') stat.review++;
    });

    /* 7. 季节匹配（按报告日期月份） */
    var month = c.reportMonth ? Number(c.reportMonth) : (input.reportDate ? monthOf(input.reportDate) : (new Date().getMonth() + 1));
    var season = KB.seasonOfMonth(month);

    /* 8. FFR（A版） */
    var ffr = null;
    if (c.type === 'A' && input.ffr) {
      var vals = {}; var allOk = true; var any = false;
      KB.FFR.vessels.forEach(function (v) {
        var raw = input.ffr[v.code];
        if (raw != null && raw !== '') { any = true; var e = KB.FFR.evaluate(raw); vals[v.code] = { label: v.label, value: e.text, ok: e.ok, phrase: e.phrase }; if (!e.ok) allOk = false; }
        else vals[v.code] = { label: v.label, value: '—', ok: true, phrase: '' };
      });
      if (any) ffr = { vessels: vals, allOk: allOk };
    }

    /* 9. 饮食原则（基础 + 条件追加） */
    var diet = KB.DIET_PRINCIPLES.slice();
    var healthPortraits = []; // 健康画像标签（用于饮食强调）
    ['高尿酸','幽门螺杆菌感染','泌尿系异常'].forEach(function (t) {
      if (tagSet[t] && KB.DIET_PRINCIPLES_COND[t]) {
        healthPortraits.push(t);
        KB.DIET_PRINCIPLES_COND[t].forEach(function (s) { diet.push(s); });
      }
    });

    return {
      customer: c,
      results: results,
      tags: tags,
      advices: advices,
      stat: stat,
      season: season,
      ffr: ffr,
      diet: diet,
      healthPortraits: healthPortraits,
      sampleMenu: KB.SAMPLE_MENU,
      highPurine: (tagSet['高尿酸'] || c.type === 'A') ? KB.HIGH_PURINE : null,
      lifestyle: KB.LIFESTYLE,
      lifestyleIntervention: KB.LIFESTYLE_INTERVENTION,
      litNotes: KB.litForTags(tags),
      message: KB.healthMessage(c.name, c.gender),
      generatedAt: new Date().toISOString()
    };
  }

  function num(v) { if (v == null || v === '') return null; var n = Number(v); return isNaN(n) ? null : n; }
  function monthOf(dateStr) {
    var d = new Date(dateStr); if (isNaN(d.getTime())) return new Date().getMonth() + 1; return d.getMonth() + 1;
  }

  /* 计算能量建议文本 */
  function energyText(input) {
    return KB.SAMPLE_MENU.energyTip(input.metrics || {});
  }

  global.RulesEngine = { evaluate: evaluate, energyText: energyText };
})(window);
