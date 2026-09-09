/* =============================================================
 * 知识库数据层 knowledge-base.js
 * 倍佐健康 · 心脑血管健康管理服务系统
 * 纯前端、数据驱动。所有规则均可在此集中维护，不影响已生成报告。
 * ============================================================= */
(function (global) {
  'use strict';

  /* ---------- 品牌规范 ---------- */
  var BRAND = {
    name: '倍佐健康',
    enName: 'BeZuo Health',
    slogan: '健康无忧 · 未来可控',
    desc: '心脑血管健康数字化服务商',
    red: '#E60012',
    redDark: '#B3000E',
    ink: '#333333',
    silver: '#C9CDD4',
    docVersion: 'v1.0',
    docDate: '2026年8月'
  };

  /* ---------- 状态等级体系 ---------- */
  var LEVEL = {
    NORMAL:   { key: 'normal',   label: '正常',   color: '#2E9E5B' },
    ATTENTION:{ key: 'attention',label: '需关注', color: '#E8941A' },
    ABNORMAL: { key: 'abnormal', label: '异常',   color: '#E60012' },
    CRITICAL: { key: 'critical', label: '危急',   color: '#9E0010' },
    REVIEW:   { key: 'review',   label: '待复查', color: '#2E6FE8' }
  };

  /* ---------- 判断工具 ---------- */
  function band(v, defs) {
    // defs: [{max, level, phrase, tags}] 升序；最后一条可无 max 兜底
    if (v == null || v === '' || isNaN(Number(v))) return null;
    v = Number(v);
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].max == null || v <= defs[i].max) {
        return { level: defs[i].level, phrase: defs[i].phrase, tags: defs[i].tags || [] };
      }
    }
    var last = defs[defs.length - 1];
    return { level: last.level, phrase: last.phrase, tags: last.tags || [] };
  }
  function between(v, min, max) { return v >= min && v <= max; }

  /* =============================================================
   * 【v3.0】ASCVD 风险分层框架（依据中国血脂管理指南 2023）
   * 五级风险 → LDL-C 个性化判定目标
   * ============================================================= */
  var ASCVD_RISK_LEVELS = {
    low:        { key: 'low',        label: '低危',   ldlTarget: 3.4,
                  def: '10年ASCVD风险<5%' },
    medium:     { key: 'medium',     label: '中危',   ldlTarget: 2.6,
                  def: '10年ASCVD风险5%~9%，或<40岁糖尿病，或高血压+1~2个危险因素' },
    high:       { key: 'high',       label: '高危',   ldlTarget: 2.6,
                  def: 'LDL-C≥4.9 或 TC≥7.2，或≥40岁糖尿病，或CKD 3~4期' },
    very_high:  { key: 'very_high',  label: '极高危', ldlTarget: 1.8,
                  def: '已确诊ASCVD（急性冠脉综合征、稳定性冠心病、缺血性卒中/TIA、外周动脉疾病等）' },
    ultra_high: { key: 'ultra_high', label: '超高危', ldlTarget: 1.4,
                  def: '≥2次严重ASCVD事件，或1次严重ASCVD事件+≥2个高危险因素' }
  };

  /* ASCVD 主要危险因素清单（用于风险判定辅助说明） */
  var ASCVD_RISK_FACTORS = [
    '高血压', '吸烟', '低HDL-C（<1.0 mmol/L）',
    '年龄（男≥45岁，女≥55岁）',
    '早发心血管病家族史（男<55岁，女<65岁）',
    '肥胖（BMI≥28 或腰围男≥90cm/女≥85cm）'
  ];

  /* 高危险因素（用于超高危判定） */
  var ASCVD_HIGH_RISK_FACTORS = [
    '年龄≥50岁', '靶器官损害', '糖尿病（不含<40岁1型糖尿病）',
    '家族性高胆固醇血症', '持续LDL-C≥4.9 mmol/L（即使经治疗）'
  ];

  /* LDL-C 按风险等级分档阈值（band defs，升序） */
  var LDL_THRESHOLDS = {
    /* 低危/未评估统一阈值：<3.4 正常 / 3.4~4.0 需关注 / ≥4.1 异常 */
    low: [
      { max: 3.39, level: LEVEL.NORMAL,    phrase: '达到低危目标（<3.4）', tags: [] },
      { max: 4.09, level: LEVEL.ATTENTION, phrase: '边缘升高，需关注', tags: ['血脂边缘升高'] },
      { max: 999,  level: LEVEL.ABNORMAL,  phrase: '升高，建议干预', tags: ['血脂异常'] }
    ],
    medium: [
      { max: 2.59, level: LEVEL.NORMAL,    phrase: '达到中危目标（<2.6）', tags: [] },
      { max: 3.39, level: LEVEL.ATTENTION, phrase: '边缘升高，需关注', tags: ['血脂边缘升高'] },
      { max: 999,  level: LEVEL.ABNORMAL,  phrase: '升高，建议干预', tags: ['血脂异常'] }
    ],
    high: [
      { max: 2.59, level: LEVEL.NORMAL,    phrase: '达到高危目标（<2.6）', tags: [] },
      { max: 3.39, level: LEVEL.ATTENTION, phrase: '边缘升高，需关注', tags: ['血脂边缘升高'] },
      { max: 999,  level: LEVEL.ABNORMAL,  phrase: '升高，建议干预', tags: ['血脂异常'] }
    ],
    very_high: [
      { max: 1.79, level: LEVEL.NORMAL,    phrase: '达到极高危目标（<1.8）', tags: [] },
      { max: 2.59, level: LEVEL.ATTENTION, phrase: '未达极高危目标（1.8~2.5），需强化降脂', tags: ['LDL-C未达标'] },
      { max: 999,  level: LEVEL.ABNORMAL,  phrase: '严重超标（≥2.6），需紧急干预', tags: ['LDL-C严重超标'] }
    ],
    ultra_high: [
      { max: 1.39, level: LEVEL.NORMAL,    phrase: '达到超高危目标（<1.4）', tags: [] },
      { max: 1.79, level: LEVEL.ATTENTION, phrase: '未达超高危目标（1.4~1.7），需强化降脂', tags: ['LDL-C未达标'] },
      { max: 999,  level: LEVEL.ABNORMAL,  phrase: '严重超标（≥1.8），需紧急干预', tags: ['LDL-C严重超标'] }
    ]
  };
  /* 未评估（ascvd_risk 为空）时降级使用统一阈值 */
  LDL_THRESHOLDS._fallback = LDL_THRESHOLDS.low;

  /* 极高危/超高危：较基线降幅不足 50% 时在短语中强调需强化降脂；
     未评估（ascvd_risk 空档）：降幅不足 50% 时提示建议完成 ASCVD 风险评估，而非"需强化降脂" */
  function ldlIntensify(r, v, ctx, unassessed) {
    var base = ctx ? ctx.ldlBaseline : null;
    if (base == null || isNaN(Number(base)) || Number(base) <= 0) return r;
    if (r.level === LEVEL.NORMAL) return r;
    var drop = (Number(base) - Number(v)) / Number(base);
    if (drop < 0.5) {
      r.phrase += unassessed
        ? '，较基线降幅不足50%，建议尽快完成 ASCVD 风险评估'
        : '，较基线降幅不足50%，需强化降脂';
    }
    return r;
  }

  /* =============================================================
   * 指标字典 + 数值判定规则
   * 每条：{ code, label, system, unit, kind, options?, evaluate(v, ctx) }
   * evaluate 返回 { level, phrase, tags, text }
   * ============================================================= */
  var INDICATORS = [
    /* ---------- 心脑血管 ---------- */
    {
      code: 'sbp', label: '收缩压', system: '心脑血管', unit: 'mmHg', kind: 'number',
      evaluate: function (v) {
        var r = band(v, [
          { max: 119, level: LEVEL.NORMAL,   phrase: '处于正常理想范围', tags: [] },
          { max: 139, level: LEVEL.ATTENTION, phrase: '正常高值，需关注', tags: ['血压正常高值'] },
          { max: 159, level: LEVEL.ABNORMAL,  phrase: '达到1级高血压诊断标准', tags: ['高血压'] },
          { max: 999, level: LEVEL.CRITICAL,  phrase: '达到2级及以上高血压标准', tags: ['高血压'] }
        ]);
        return pack(r, v);
      }
    },
    {
      code: 'dbp', label: '舒张压', system: '心脑血管', unit: 'mmHg', kind: 'number',
      evaluate: function (v) {
        var r = band(v, [
          { max: 79,  level: LEVEL.NORMAL,   phrase: '处于正常理想范围', tags: [] },
          { max: 89,  level: LEVEL.ATTENTION, phrase: '正常高值，需关注', tags: ['血压正常高值'] },
          { max: 99,  level: LEVEL.ABNORMAL,  phrase: '达到1级高血压诊断标准', tags: ['高血压'] },
          { max: 999, level: LEVEL.CRITICAL,  phrase: '达到2级及以上高血压标准', tags: ['高血压'] }
        ]);
        return pack(r, v);
      }
    },
    {
      code: 'bp', label: '血压（综合）', system: '心脑血管', unit: '', kind: 'derived',
      evaluate: function (v, ctx) {
        var s = ctx.sbp, d = ctx.dbp;
        if (s == null && d == null) return null;
        var lv = LEVEL.NORMAL, ph = '血压正常', tags = [];
        function upd(level, phrase, tag) {
          if (rank(level) > rank(lv)) { lv = level; ph = phrase; tags = tag ? [tag] : []; }
          else if (rank(level) === rank(lv) && tag) tags.push(tag);
        }
        if (s != null) { var rs = INDICATORS_lookup('sbp').evaluate(s).level; }
        // 取 SBP/DBP 分级较高者
        var ls = s != null ? INDICATORS_lookup('sbp').evaluate(s) : null;
        var ld = d != null ? INDICATORS_lookup('dbp').evaluate(d) : null;
        var lv2 = LEVEL.NORMAL, ph2 = '血压正常', tags2 = [];
        if (ls && rank(ls.level) > rank(lv2)) { lv2 = ls.level; ph2 = ls.phrase; tags2 = ls.tags.slice(); }
        if (ld && rank(ld.level) > rank(lv2)) { lv2 = ld.level; ph2 = ld.phrase; tags2 = ld.tags.slice(); }
        else if (ld && rank(ld.level) === rank(lv2)) { for (var i=0;i<ld.tags.length;i++) if(tags2.indexOf(ld.tags[i])<0) tags2.push(ld.tags[i]); }
        else if (ls && rank(ls.level) === rank(lv2)) { for (var j=0;j<ls.tags.length;j++) if(tags2.indexOf(ls.tags[j])<0) tags2.push(ls.tags[j]); }
        return { level: lv2, phrase: ph2, tags: tags2, text: (s!=null?s:'—') + '/' + (d!=null?d:'—') + ' mmHg' };
      }
    },
    {
      code: 'hr', label: '心率', system: '心脑血管', unit: '次/分', kind: 'number',
      evaluate: function (v) {
        var r = band(v, [
          { max: 49,  level: LEVEL.ABNORMAL,  phrase: '心动过缓（<50 次/分），建议尽快评估', tags: ['心动过缓'] },
          { max: 59,  level: LEVEL.ATTENTION, phrase: '心率偏慢，需结合症状观察', tags: [] },
          { max: 100, level: LEVEL.NORMAL,    phrase: '窦性心律正常范围', tags: [] },
          { max: 119, level: LEVEL.ATTENTION, phrase: '心率偏快，建议复查', tags: ['心率偏快'] },
          { max: 999, level: LEVEL.ABNORMAL,  phrase: '心动过速（≥120 次/分），建议尽快就医', tags: ['心动过速'] }
        ]);
        return pack(r, v);
      }
    },
    {
      code: 'ldl', label: '低密度脂蛋白胆固醇', system: '心脑血管', unit: 'mmol/L', kind: 'number',
      evaluate: function (v, ctx) {
        // 【v3.0】按 ASCVD 风险等级个性化判定（ascvd_risk 为空时降级统一阈值）
        ctx = ctx || {};
        var risk = ctx.ascvdRisk;
        var defs = LDL_THRESHOLDS[risk] || LDL_THRESHOLDS._fallback;
        var r = band(v, defs);
        if (!r) return null;
        if (risk === 'very_high' || risk === 'ultra_high') {
          r = ldlIntensify(r, v, ctx);          // 极高危/超高危：需强化降脂
        } else if (!LDL_THRESHOLDS[risk]) {
          r = ldlIntensify(r, v, ctx, true);    // 未评估：建议完成 ASCVD 评估（非强化降脂）
        }
        return pack(r, v);
      }
    },
    {
      code: 'hdl', label: '高密度脂蛋白胆固醇', system: '心脑血管', unit: 'mmol/L', kind: 'number',
      evaluate: function (v) {
        var thr = 1.0;
        if (v == null) return null;
        var lv = (v < thr) ? LEVEL.ATTENTION : LEVEL.NORMAL;
        var ph = (v < thr) ? '偏低，心血管保护性不足' : '正常（心血管保护性因素）';
        var tags = (v < thr) ? ['低HDL'] : [];
        return { level: lv, phrase: ph, tags: tags, text: v };
      }
    },
    {
      code: 'tc', label: '总胆固醇', system: '心脑血管', unit: 'mmol/L', kind: 'number',
      evaluate: function (v) {
        var r = band(v, [
          { max: 5.19, level: LEVEL.NORMAL,    phrase: '正常', tags: [] },
          { max: 6.19, level: LEVEL.ATTENTION, phrase: '边缘升高', tags: ['血脂边缘升高'] },
          { max: 999,  level: LEVEL.ABNORMAL,  phrase: '升高', tags: ['血脂异常'] }
        ]);
        return pack(r, v);
      }
    },
    {
      code: 'tg', label: '甘油三酯', system: '心脑血管', unit: 'mmol/L', kind: 'number',
      evaluate: function (v) {
        var r = band(v, [
          { max: 1.69, level: LEVEL.NORMAL,    phrase: '正常', tags: [] },
          { max: 2.29, level: LEVEL.ATTENTION, phrase: '边缘升高', tags: ['血脂边缘升高'] },
          { max: 5.59, level: LEVEL.ABNORMAL,  phrase: '升高', tags: ['血脂异常'] },
          { max: 999,  level: LEVEL.CRITICAL,  phrase: '重度升高，警惕胰腺炎风险', tags: ['血脂异常'] }
        ]);
        return pack(r, v);
      }
    },
    {
      code: 'carotidPlaque', label: '颈动脉斑块', system: '心脑血管', unit: '', kind: 'select',
      options: [
        { value: 'none', label: '无明确斑块' },
        { value: 'stable', label: '稳定斑块' },
        { value: 'multi', label: '多发/混合斑块' }
      ],
      evaluate: function (v) {
        if (!v) return null;
        if (v === 'none') return { level: LEVEL.NORMAL, phrase: '未见明确斑块', tags: [] };
        if (v === 'stable') return { level: LEVEL.ATTENTION, phrase: '存在稳定斑块', tags: ['颈动脉斑块'] };
        return { level: LEVEL.ATTENTION, phrase: '多发/混合斑块，需强化管控', tags: ['颈动脉斑块'] };
      }
    },
    {
      code: 'ecg', label: '心电图', system: '心脑血管', unit: '', kind: 'select',
      options: [ { value:'normal', label:'正常' }, { value:'abn', label:'异常' } ],
      evaluate: function (v) {
        if (!v) return null;
        if (v === 'normal') return { level: LEVEL.NORMAL, phrase: '窦性心律，正常心电图', tags: [] };
        return { level: LEVEL.ATTENTION, phrase: '存在异常改变，建议复查', tags: ['心电图异常'] };
      }
    },

    /* ---------- 内分泌代谢 ---------- */
    {
      code: 'fpg', label: '葡萄糖', system: '内分泌代谢', unit: 'mmol/L', kind: 'number',
      evaluate: function (v) {
        var r = band(v, [
          { max: 5.59, level: LEVEL.NORMAL,    phrase: '正常', tags: [] },
          { max: 6.09, level: LEVEL.ATTENTION, phrase: '空腹血糖受损早期（IFG 早期）', tags: ['糖耐量受损'] },
          { max: 6.99, level: LEVEL.ATTENTION, phrase: '空腹血糖受损（糖耐量受损）', tags: ['糖耐量受损'] },
          { max: 999,  level: LEVEL.ABNORMAL,  phrase: '达到糖尿病诊断标准', tags: ['血糖异常'] }
        ]);
        return pack(r, v);
      }
    },
    {
      code: 'hba1c', label: '糖化血红蛋白', system: '内分泌代谢', unit: '%', kind: 'number',
      evaluate: function (v) {
        var r = band(v, [
          { max: 5.69, level: LEVEL.NORMAL,    phrase: '正常', tags: [] },
          { max: 6.49, level: LEVEL.ATTENTION, phrase: '处于糖尿病前期', tags: ['糖耐量受损'] },
          { max: 999,  level: LEVEL.ABNORMAL,  phrase: '达到糖尿病诊断标准', tags: ['血糖异常'] }
        ]);
        return pack(r, v);
      }
    },
    {
      code: 'ua', label: '血尿酸', system: '内分泌代谢', unit: 'μmol/L', kind: 'number',
      evaluate: function (v, ctx) {
        if (v == null) return null;
        v = Number(v);
        var hi = (ctx.gender === '女') ? 360 : 420;
        if (v <= hi) return { level: LEVEL.NORMAL, phrase: '正常', tags: [] };
        if (v <= hi + 120) return { level: LEVEL.ATTENTION, phrase: '轻度升高', tags: ['高尿酸'] };
        return { level: LEVEL.ABNORMAL, phrase: '明显升高，警惕痛风', tags: ['高尿酸'] };
      }
    },
    {
      code: 'bmi', label: '体重指数', system: '内分泌代谢', unit: 'kg/m²', kind: 'derived',
      evaluate: function (v, ctx) {
        var w = ctx.weight, h = ctx.height;
        if (!w || !h) return null;
        var bmi = Number(w) / Math.pow(Number(h) / 100, 2);
        var r = band(bmi, [
          { max: 18.49, level: LEVEL.ATTENTION, phrase: '偏瘦', tags: ['偏瘦'] },
          { max: 23.99, level: LEVEL.NORMAL,    phrase: '正常', tags: [] },
          { max: 27.99, level: LEVEL.ATTENTION, phrase: '超重', tags: ['超重'] },
          { max: 999,   level: LEVEL.ABNORMAL,  phrase: '肥胖', tags: ['肥胖'] }
        ]);
        return pack(r, bmi.toFixed(2));
      }
    },
    {
      code: 'waist', label: '腰围', system: '内分泌代谢', unit: 'cm', kind: 'number',
      evaluate: function (v, ctx) {
        if (v == null) return null;
        v = Number(v);
        var thr = (ctx.gender === '女') ? 85 : 90;
        if (v < thr) return { level: LEVEL.NORMAL, phrase: '正常', tags: [] };
        return { level: LEVEL.ATTENTION, phrase: '达到中心性肥胖标准', tags: ['中心性肥胖'] };
      }
    },

    /* ---------- 呼吸 ---------- */
    {
      code: 'lungNodule', label: '肺结节', system: '呼吸', unit: '', kind: 'select',
      options: [ {value:'none',label:'无'}, {value:'micro',label:'微小结节(<6mm)'}, {value:'small',label:'小结节(6-8mm)'}, {value:'large',label:'结节(>8mm)'} ],
      evaluate: function (v) {
        if (!v || v === 'none') return null;
        if (v === 'micro') return { level: LEVEL.ATTENTION, phrase: '微小结节，年度随访', tags: ['肺结节'] };
        if (v === 'small') return { level: LEVEL.ATTENTION, phrase: '小结节，需缩短随访', tags: ['肺结节'] };
        return { level: LEVEL.ABNORMAL, phrase: '结节偏大，建议专科评估', tags: ['肺结节'] };
      }
    },
    {
      code: 'hpylori', label: '幽门螺杆菌', system: '消化泌尿', unit: '', kind: 'select',
      options: [ {value:'neg',label:'阴性'}, {value:'pos',label:'阳性'} ],
      evaluate: function (v) {
        if (!v) return null;
        if (v === 'neg') return { level: LEVEL.NORMAL, phrase: '阴性', tags: [] };
        return { level: LEVEL.ABNORMAL, phrase: '现症感染，建议根除', tags: ['幽门螺杆菌感染'] };
      }
    },
    {
      code: 'ggt', label: '谷氨酰转肽酶', system: '消化泌尿', unit: 'U/L', kind: 'number',
      evaluate: function (v, ctx) {
        if (v == null) return null;
        v = Number(v);
        var hi = (ctx.gender === '女') ? 35 : 50;
        if (v <= hi) return { level: LEVEL.NORMAL, phrase: '正常', tags: [] };
        if (v <= hi * 2) return { level: LEVEL.ATTENTION, phrase: '轻度升高，警惕酒精/脂肪肝', tags: ['肝酶异常'] };
        return { level: LEVEL.ABNORMAL, phrase: '明显升高', tags: ['肝酶异常'] };
      }
    },
    {
      code: 'egfr', label: '肾小球滤过率', system: '消化泌尿', unit: 'mL/min', kind: 'number',
      evaluate: function (v, ctx) {
        if (v == null) return null;
        v = Number(v);
        ctx = ctx || {};
        /* v3 年龄分层：>65 岁 60~89 不再标轻度下降 */
        var age = ctx.age != null ? Number(ctx.age) : null;
        var elderly = age != null && age > 65;
        if (v >= 90) return { level: LEVEL.NORMAL, phrase: '正常', tags: [] };
        if (v >= 60) {
          if (elderly) return { level: LEVEL.NORMAL, phrase: '正常（老年参考范围）', tags: [] };
          return { level: LEVEL.ATTENTION, phrase: '轻度下降', tags: ['肾功能下降'] };
        }
        return { level: LEVEL.ABNORMAL, phrase: '中重度下降', tags: ['肾功能下降'] };
      }
    },
    {
      code: 'renalCyst', label: '肾囊肿/占位', system: '消化泌尿', unit: '', kind: 'select',
      options: [ {value:'none',label:'无'}, {value:'benign',label:'良性囊肿'}, {value:'unclear',label:'性质待定'} ],
      evaluate: function (v) {
        if (!v || v === 'none') return null;
        if (v === 'benign') return { level: LEVEL.ATTENTION, phrase: '良性囊肿，年度随访', tags: ['泌尿系异常'] };
        return { level: LEVEL.ATTENTION, phrase: '性质待定，建议进一步检查', tags: ['泌尿系异常'] };
      }
    },

    /* ---------- 其他专科 ---------- */
    {
      code: 'homocysteine', label: '同型半胱氨酸', system: '其他专科', unit: 'μmol/L', kind: 'number',
      evaluate: function (v) {
        if (v == null) return null;
        v = Number(v);
        if (v < 15) return { level: LEVEL.NORMAL, phrase: '正常', tags: [] };
        if (v < 20) return { level: LEVEL.ATTENTION, phrase: '升高', tags: ['高同型半胱氨酸'] };
        return { level: LEVEL.ABNORMAL, phrase: '明显升高', tags: ['高同型半胱氨酸'] };
      }
    }
  ];

  function rank(lv) { return [LEVEL.NORMAL, LEVEL.ATTENTION, LEVEL.ABNORMAL, LEVEL.CRITICAL, LEVEL.REVIEW].indexOf(lv); }
  function pack(r, v) {
    if (!r) return null;
    return { level: r.level, phrase: r.phrase, tags: r.tags, text: (v == null ? '—' : v) };
  }
  function INDICATORS_lookup(code) {
    for (var i = 0; i < INDICATORS.length; i++) if (INDICATORS[i].code === code) return INDICATORS[i];
    return null;
  }

  /* FFR（仅 A版）：≥0.8 正常，<0.8 存在心肌缺血 */
  var FFR = {
    vessels: [
      { code: 'ffrLAD', label: '左前降支' },
      { code: 'ffrLCX', label: '左回旋支' },
      { code: 'ffrRCA', label: '右冠状动脉' }
    ],
    evaluate: function (v) {
      if (v == null || v === '') return null;
      v = Number(v);
      if (v >= 0.8) return { ok: true, text: v.toFixed(3), phrase: '血流功能状态良好' };
      return { ok: false, text: v.toFixed(3), phrase: '存在心肌缺血风险' };
    },
    normalThreshold: 0.8
  };

  /* =============================================================
   * 管理建议库（按触发标签调用）
   * ============================================================= */
  var ADVICE = {
    '高血压':      { title: '血压管理', level: LEVEL.ABNORMAL, text: '建议居家定期监测血压，长期维持在 120/80mmHg 以内；低盐饮食（每日<5g），规律有氧运动；如已用药请遵医嘱维持，3 个月复查血压与电解质。' },
    '血压正常高值':{ title: '血压临界管控', level: LEVEL.ATTENTION, text: '血压处于正常高值，建议通过减重、限盐、规律运动进行生活方式干预，居家监测，避免进展为高血压。' },
    '血脂异常':    { title: '血脂管理', level: LEVEL.ABNORMAL, text: '规范降脂是控制斑块进展的核心手段。建议遵医嘱维持降脂治疗，低脂饮食、增加膳食纤维，3 个月左右复查血脂全套与肝功能。' },
    '血脂边缘升高':{ title: '血脂边缘管控', level: LEVEL.ATTENTION, text: '血脂边缘升高，建议减少红肉与高油高糖摄入，增加全谷物与蔬果，每周 150 分钟中等强度有氧运动，年度复查血脂。' },
    'LDL-C未达标': { title: 'LDL-C强化降脂', level: LEVEL.ABNORMAL, text: 'LDL-C 未达到 ASCVD 风险分层目标，建议遵医嘱强化降脂治疗（他汀 ± 依折麦布/PCSK9抑制剂），目标 <1.8 或 <1.4 mmol/L（视风险等级），3 个月复查血脂全套与肝功能，关注肌痛、肝酶升高等不良反应。' },
    'LDL-C严重超标':{ title: 'LDL-C紧急干预', level: LEVEL.ABNORMAL, text: 'LDL-C 严重超出目标，建议尽快心内科就诊评估，启动强化联合降脂方案（他汀 + 依折麦布 ± PCSK9抑制剂），评估他汀不耐受情况，1 个月复查血脂与肝功能。' },
    '低HDL':      { title: '提升保护性血脂', level: LEVEL.ATTENTION, text: '高密度脂蛋白偏低，建议增加规律有氧运动、戒烟限酒、适量摄入不饱和脂肪酸（坚果、橄榄油），以改善心血管保护。' },
    '高尿酸':      { title: '尿酸管理', level: LEVEL.ATTENTION, text: '血尿酸升高，酒精是核心诱因之一，需优先控制饮酒；严格限制海鲜、动物内脏、浓肉汤、干豆类等高嘌呤食物；每日饮水 2000ml 以上；1~3 个月复查血尿酸。' },
    '血糖异常':    { title: '血糖管理', level: LEVEL.ABNORMAL, text: '血糖达到异常标准，建议内分泌科就诊，规范饮食与运动，控制精制糖与碳水摄入，3 个月复查葡萄糖与糖化血红蛋白。' },
    '糖耐量受损':  { title: '血糖临界管控', level: LEVEL.ATTENTION, text: '处于糖尿病前期，建议控制体重、减少精制糖摄入、增加运动，年度复查糖代谢指标，防止进展。' },
    '中心性肥胖':  { title: '腹型肥胖管控', level: LEVEL.ATTENTION, text: '腰围超标提示中心性肥胖，建议控制总能量、减少腹型脂肪：低油低糖饮食 + 每周 150 分钟有氧 + 2~3 次抗阻训练，目标腰围男性<90cm、女性<85cm。' },
    '超重':        { title: '体重管理', level: LEVEL.ATTENTION, text: '体重超重，建议合理控制总能量摄入，增加运动消耗，目标 BMI 回归 18.5~23.9。' },
    '肥胖':        { title: '体重管理', level: LEVEL.ABNORMAL, text: '体重达到肥胖标准，建议在医生指导下进行体重管理，联合饮食、运动与必要药物干预，降低心脑血管与代谢负担。' },
    '偏瘦':        { title: '体重改善', level: LEVEL.ATTENTION, text: '体重偏瘦，建议均衡营养、适度增加优质蛋白与能量摄入，排查吸收或慢性消耗因素。' },
    '颈动脉斑块':  { title: '全身动脉斑块随访', level: LEVEL.ATTENTION, text: '多部位动脉斑块为全身动脉粥样硬化早期信号，核心干预为强化降脂 + 管控危险因素。建议每年复查颈动脉（含头臂干）及下肢动脉超声，监测斑块变化。' },
    '肝酶异常':    { title: '肝功能与饮酒管控', level: LEVEL.ATTENTION, text: '肝酶升高需减少应酬饮酒频率与单次饮用量，避免空腹饮酒与混饮；增加蔬果摄入，定期复查肝功能及超声。' },
    '幽门螺杆菌感染':{ title: '幽门螺杆菌根除', level: LEVEL.ABNORMAL, text: '遵医嘱足疗程完成根除治疗，服药期间严格禁酒、忌辛辣；停药 2 个月后复查 C13 呼气试验；家庭实行分餐制、使用公筷。' },
    '肺结节':      { title: '肺结节随访', level: LEVEL.ATTENTION, text: '肺结节恶性风险低，建议年度胸部低剂量 CT 随访；如出现咳嗽加重、胸痛咯血及时就诊。' },
    '泌尿系异常':  { title: '泌尿系随访', level: LEVEL.ATTENTION, text: '建议每年复查泌尿系超声，跟踪囊肿/占位大小与形态变化；若出现腰痛、血尿等不适及时就诊。' },
    '肾功能下降':  { title: '肾功能保护', level: LEVEL.ATTENTION, text: '肾功能下降，建议控制血压与蛋白摄入、避免肾毒性药物，定期复查肾功能与尿常规。' },
    '高同型半胱氨酸':{ title: '同型半胱氨酸管控', level: LEVEL.ATTENTION, text: '建议补充叶酸、维生素 B6/B12，改善饮食结构与生活方式，降低脑血管风险。' },
    '心电图异常':  { title: '心律随访', level: LEVEL.ATTENTION, text: '心电图存在异常改变，建议结合症状复查，必要时行动态心电图或心内科评估。' }
  };

  /* 生活方式通用建议（始终展示或按标签附加） */
  var LIFESTYLE = {
    diet: '坚持低盐、低嘌呤、低油低糖饮食，保证优质蛋白、全谷物与新鲜蔬果均衡摄入；每日盐<5g、油<20g、饮水 2~3L。',
    alcohol: '这是当前最核心的可改善危险因素。参照《中国居民膳食指南（2022）》，如饮酒单日酒精摄入不超过 15g、每周不超过 2 次；应酬场合主动控制，避免空腹饮酒、混饮，优先推荐逐步戒酒。',
    exercise: '建议每周累计 150 分钟中等强度有氧运动，搭配 2~3 次抗阻训练，强度以身体耐受、不引发过度疲劳为宜。',
    sleep: '保持规律作息，避免熬夜与过度劳累，维持稳定代谢状态；每日睡眠 7~8 小时。'
  };

  /* =============================================================
   * 季节知识库（按报告生成月份匹配）
   * 冬春季(1-3) 春夏季(4-6) 夏秋季(7-9) 秋冬季(10-12)
   * ============================================================= */
  var SEASON = {
    '冬春季': { months: [1,2,3], risks: '气温波动大、冷暖交替，心脑血管与呼吸道感染风险升高。',
      diet: '温润饮食、少油腻，保证优质蛋白与维生素摄入；控制高盐腌制食品。',
      exercise: '避免清晨低温时剧烈运动，运动前充分热身；选择室内或午后温和有氧。',
      selfcheck: '关注头晕、胸闷、血压波动；注意保暖与流感预防。' },
    '春夏季': { months: [4,5,6], risks: '气温升高、湿度增加，代谢加快但消化道与过敏风险上升。',
      diet: '清淡易消化，补充水分与电解质；少吃生冷、隔夜食物。',
      exercise: '利用温和气候增加户外有氧，避免高温时段暴晒运动。',
      selfcheck: '关注肠胃不适、血压季节性变化与过敏表现。' },
    '夏秋季': { months: [7,8,9], risks: '高温高湿，心脑血管负荷与中暑风险增加，饮酒应酬易增多。',
      diet: '补水充足、饮食清淡，严格限酒；减少高嘌呤与高油高糖。',
      exercise: '避开高温时段，选择清晨或傍晚运动，及时补水。',
      selfcheck: '关注头晕、心悸、脱水与尿酸波动；控制饮酒量。' },
    '秋冬季': { months: [10,11,12], risks: '气温下降、空气干燥，血管收缩致心脑血管事件风险升高。',
      diet: '温补适度、控盐控油，增加蔬果与全谷物；减少高嘌呤聚餐。',
      exercise: '保暖前提下坚持有氧，运动前后充分热身与放松。',
      selfcheck: '关注血压波动、胸闷与跌倒风险；做好保暖。' }
  };
  function seasonOfMonth(m) {
    m = Number(m) || new Date().getMonth() + 1;
    for (var k in SEASON) if (SEASON[k].months.indexOf(m) >= 0) return { name: k, data: SEASON[k] };
    return { name: '秋冬季', data: SEASON['秋冬季'] };
  }

  /* =============================================================
   * 饮食原则 / 食谱示例 / 高嘌呤食物 / 健康寄语 模板
   * ============================================================= */
  var DIET_PRINCIPLES = [
    '食物品种每天不少于 12 种，每周不少于 25 种。',
    '每天多食新鲜蔬菜，推荐不少于 500g，深色蔬菜占 1/2。',
    '红肉每天摄入不超过 50g。',
    '每天 1/3 主食为全谷物或杂豆类（燕麦、藜麦、玉米等）。',
    '每周摄入 1~2 次豆制品，植物蛋白对心血管有益。',
    '每天摄入 10~15g 坚果仁。',
    '每天摄入 300mL 以上低脂（或脱脂）乳制品。',
    '不饮或限制饮酒（不超过 15g 酒精），不喝或少喝含糖饮料。',
    '选择含不饱和脂肪酸的植物油，每天食用油控制在 20g 以内。',
    '每天盐摄入不超过 5g，注意隐形盐（咸菜、酱油、鸡精等）。',
    '每日推荐饮水量 2L~3L。'
  ];
  var DIET_PRINCIPLES_COND = {
    '高尿酸': ['少吃或不吃动物内脏、贝壳海鲜、浓肉汤、干豆类等高嘌呤食物；科学选择低嘌呤膳食。'],
    '幽门螺杆菌感染': ['杀菌期饮食清淡易消化，避免辛辣油腻；少食多餐、细嚼慢咽；实行分餐制或使用公筷。'],
    '泌尿系异常': ['每日饮水不少于 2000mL，限制高草酸食物（菠菜、浓茶、巧克力）。']
  };
  var SAMPLE_MENU = {
    baseKcal: 1500,
    energyTip: function (ctx) {
      // 能量建议 v2：标准体重 = 身高(cm) - 105；按体重状态分档，输出对齐报告模板格式
      var h = Number(ctx.height), w = Number(ctx.weight);
      if (!h) return '能量摄入建议：需先录入身高，方可按标准体重测算每日能量摄入。';
      var sw = h - 105;                 // 标准体重 kg
      var ratio = w ? (w - sw) / sw : 0;
      var status = '', lo, hi;
      if (!w || Math.abs(ratio) <= 0.1) { status = w ? '标准体重' : ''; lo = sw * 27; hi = sw * 31; }      // 标准/未录体重：按标准体重能量需求
      else if (ratio < 0) { status = '低于标准体重（偏瘦）'; lo = sw * 30; hi = sw * 35; }                   // 偏瘦：适当增加能量
      else { status = '高于标准体重'; lo = sw * 22; hi = sw * 26; }                                          // 超重：控制能量摄入
      lo = Math.round(lo); hi = Math.round(hi);
      var base = this.baseKcal || 1500;
      var addLo = lo - base, addHi = hi - base;
      var s = w
        ? '能量摄入建议：您的体重为' + status + '，按照您目前的情况建议为每日摄入能量 ' + lo + ' kcal ~ ' + hi + ' kcal。'
        : '能量摄入建议：按照标准体重测算，您目前的情况建议为每日摄入能量 ' + lo + ' kcal ~ ' + hi + ' kcal。';
      if (addHi < 0) s += '参考食谱 ' + base + 'kcal，可在此基础上减 ' + (-addHi) + ' kcal ~ ' + (-addLo) + ' kcal 的食物。';
      else if (addLo < 0) s += '参考食谱 ' + base + 'kcal，可在此基础上减 ' + (-addLo) + ' kcal ~ 加 ' + addHi + ' kcal 的食物。';
      else s += '参考食谱 ' + base + 'kcal，可在此基础上加 ' + addLo + ' kcal ~ ' + addHi + ' kcal 的食物。';
      return s;
    },
    meals: [
      { name: '早餐', food: '水煮玉米、水煮鸡蛋 1 个、纯牛奶一盒', amount: '玉米 1 根约 200g、鸡蛋 1 个、牛奶 250-300mL' },
      { name: '中餐', food: '香煎鸡胸肉、蒜蓉西兰花、蚝油生菜、1 小碗米饭', amount: '鸡胸肉 100g、西兰花 200g、生菜 100g、粗杂粮米约 100g' },
      { name: '加餐', food: '苹果一个', amount: '中等大小苹果约 200g' },
      { name: '晚餐', food: '肉末豆腐、清炒菠菜、丝瓜汤、小香薯一个', amount: '猪瘦肉 50g、豆腐 100g、菠菜 150g、丝瓜 100g、小香薯约 150g' }
    ]
  };
  var HIGH_PURINE = [
    { cat: '动物内脏', items: '鸡肝、猪肝、牛肝、鹅肝、猪肾、牛脑/羊脑、牛杂/羊杂、肝肠' },
    { cat: '高嘌呤鱼', items: '凤尾鱼、秋刀鱼、沙丁鱼、带鱼、金枪鱼、鲅鱼、鲭鱼、鱼干/鱼脯、鱼子酱' },
    { cat: '贝壳海鲜', items: '牡蛎/生蚝、贻贝/淡菜、鱿鱼/墨鱼、蛏子、扇贝、蛤蜊、章鱼、鲍鱼' },
    { cat: '菌类/干豆', items: '香菇（干）、鲍鱼菇（干）、榆黄蘑（干）、树菇（干）' },
    { cat: '浓汤/提取物', items: '火锅汤底、肉汁/肉酱、骨汤' },
    { cat: '酒类/含糖饮品', items: '啤酒、黄酒、白酒、高果糖饮料/碳酸饮料、蜂蜜' }
  ];
  var LIFESTYLE_INTERVENTION = [
    { cat: '运动建议', items: [
      '推荐中等强度有氧运动（快走、游泳、骑自行车），每周 150 分钟以上，分 5 天以上进行。',
      '增加负重运动（快走、哑铃操）每周 2~3 次，刺激骨形成、改善骨密度。',
      '加入平衡训练（太极拳、单脚站立）每周 2~3 次，预防跌倒骨折。',
      '运动前后充分热身与拉伸，遵循安全、循序渐进、长期坚持三原则。'
    ]},
    { cat: '作息与生活习惯', items: [
      '保证充足睡眠，每晚 7~8 小时，有助于身体修复与免疫维护。',
      '每日户外活动 15~20 分钟（避开正午强紫外线），促进维生素 D 合成。',
      '保持良好体态，避免长时间弯腰驼背，保护腰椎。',
      '戒烟限酒；保持心情舒畅，避免长期焦虑、抑郁。'
    ]},
    { cat: '环境与职业防护', items: [
      '避免接触粉尘、化学烟雾等有害物质，保护肺部健康。',
      '厨房烹饪务必使用抽油烟机，减少油烟吸入。',
      '居家环境保持通风，定期体检、早发现早干预。'
    ]}
  ];
  function healthMessage(name, gender) {
    var honor = (gender === '女') ? '女士' : '先生';
    return '尊敬的 ' + (name || '客户') + ' ' + honor + '：\n在这份报告里，每一个数字、每一个指标，都是您身体最诚实的告白。它们或许在为您的充沛精力喝彩，又或许在悄悄提醒您需要休息与调整。但请您务必记住，健康并非一个静止的终点，而是一场动态的、值得终身投入的旅程。\n守护健康，有时并不需要轰轰烈烈的变革。它更多地藏匿于朝朝暮暮的细微选择里——是案头久坐后的一次起身远眺，是面对压力时的一次深呼吸，是告别深夜荧幕、拥抱清晨阳光的决断，是餐盘中多一抹绿色的智慧。\n未来，愿您以这份报告为基点，制定属于自己的个性化健康计划。不求完美，但求持之以恒；不必慌张，只需步步为营。请记得，您从来不是独自前行。健康，是送给未来自己最好的礼物。';
  }

  /* =============================================================
   * 【文献知识库 LIT_KNOWLEDGE】2026-08 基于临床指南/共识整理
   * 来源文献（按类别）：
   *  高血压：《中国高血压防治指南(2024年修)》《成人高血压食养指南》
   *  血脂 ：《中国血脂管理指南(2023)》《成人高脂血症食养指南》《他汀不耐受专家共识》
   *  冠心病：《冠心病指南》《遗传检测与冠心病风险评估中国专家共识(2023)》
   *  糖尿病：《糖尿病防治指南(2023/2018)》《国家基层糖尿病防治管理指南(2022)》
   *          《老年人糖尿病防治指南》《成人高血糖食养指南》
   *  肥胖 ：《肥胖症诊疗指南》《体重管理指导原则(2024)》《成人肥胖食养指南》
   *  心血管：《2020中国心血管病一级预防指南》《ARNI 在高血压应用中国专家建议》
   * 每条含：diagnosis 诊断/分层标准、targets 管理目标、lifestyle 生活方式、
   *        drug 用药要点、special 专项知识（供规则引擎/报告按标签引用）
   * ============================================================= */
  var LIT_KNOWLEDGE = {
    hypertension: {
      title: '高血压',
      tags: ['高血压', '血压正常高值'],
      source: '中国高血压防治指南(2024年修)·成人高血压食养指南',
      diagnosis: [
        ['正常血压', '诊室 <120/80 mmHg'],
        ['正常高值', '120~139 / 80~89'],
        ['1级高血压', '140~159 / 90~99'],
        ['2级高血压', '160~179 / 100~109'],
        ['3级高血压', '≥180 / ≥110'],
        ['家庭自测标准', '连续 5~7 天 ≥135/85 即诊断高血压'],
        ['动态血压标准', '24h 均值 ≥130/80（日间 ≥135/85、夜间 ≥120/70）']
      ],
      targets: [
        '一般人群：<140/90 mmHg，能耐受可降至 <130/80',
        '高危 / 合并糖尿病、CKD 伴蛋白尿、心衰者：<130/80',
        '65~79 岁：<140/90，可降至 <130/80；≥80 岁：<150/90，可降至 <140/90',
        '家庭自测目标 <135/85；清晨、夜间 <135/85、<120/70'
      ],
      lifestyle: [
        '限盐：每日钠 <2g（盐 <5g）；5g 盐 ≈ 酱油 32ml ≈ 鸡精 10g ≈ 咸菜 63g，警惕咸菜/酱油/鸡精/加工肉等隐形盐',
        '减重：BMI 目标 18.5~23.9，腰围男 <90cm、女 <85cm；每日减少 500~1000kcal，1 年减重 5%~10%',
        '运动：中等强度有氧每日 30 分钟、每周 5~7 天（约可降血压 5~7mmHg）；抗阻每周 2~3 次；SBP>160 未控制者避免高强度',
        '饮食：每日蔬菜 ≥300g（深色过半）、水果 200~350g、全谷杂豆 50~150g、奶 ≥300ml、烹调油 25~30g；富钾食物（菠菜/苋菜/口蘑/豆类）优先',
        '限酒：不饮最佳；如饮，男 ≤25g、女 ≤15g 乙醇/日；戒烟（含电子烟）',
        '监测：连续 5~7 天、早晚各 2~3 个读数；晨测在排尿后、服药前、早餐前；清晨血压 ≥135/85 为清晨高血压'
      ],
      drug: '血压 ≥160/100 立即启动；140~159/90~99 中危以上启动、低危可生活方式干预 4~12 周；130~139/85~89 高危/很高危启动。常用六类：CCB、ACEI、ARB、噻嗪类利尿剂、β阻滞剂及 ARNI（沙库巴曲缬沙坦，较 ARB 额外降压 5~7mmHg）。ACEI/ARB/ARNI 不可两两联用；ACEI 转 ARNI 须停药 ≥36h；孕妇禁用 ARNI。',
      special: [
        '中国心脏健康饮食（CHH）每日钠 6g→3g，可降血压约 10/3.8mmHg；DASH 饮食可降约 11.4/5.5mmHg',
        '高同型半胱氨酸与高尿酸（男 ≥420、女 ≥360μmol/L）为 2024 版新增危险因素',
        '心率 >80 次/分提示交感激活，需纳入危险分层'
      ]
    },
    dyslipidemia: {
      title: '血脂管理',
      tags: ['血脂异常', '血脂边缘升高', '低HDL', 'LDL-C未达标', 'LDL-C严重超标'],
      source: '中国血脂管理指南(2023)·成人高脂血症食养指南·他汀不耐受专家共识',
      diagnosis: [
        ['总胆固醇 TC', '合适 <5.2 / 边缘 5.2~6.2 / 升高 ≥6.2 mmol/L'],
        ['低密度脂蛋白 LDL-C', '按 ASCVD 风险分层：低危<3.4 / 中危与高危<2.6 / 极高危<1.8 / 超高危<1.4'],
        ['甘油三酯 TG', '合适 <1.7 / 边缘 1.7~2.3 / 升高 ≥2.3'],
        ['高密度脂蛋白 HDL-C', '降低 <1.0（升高无上限）'],
        ['脂蛋白 a', 'Lp(a) ≥300mg/L 提示风险升高']
      ],
      targets: [
        'LDL-C 分层目标：低危 <3.4 / 中危与高危 <2.6 / 极高危 <1.8 且降幅 ≥50% / 超高危 <1.4 且降幅 ≥50%',
        'LDL-C ≥4.9 或 TC ≥7.2、≥40 岁糖尿病、CKD 3~4 期者直接判高危',
        '极高危/超高危：即使基线不明确，也应力争较基线降幅 ≥50%；未达者须强化降脂方案',
        '非HDL-C 目标 = LDL-C 目标 + 0.8 mmol/L'
      ],
      lifestyle: [
        '胆固醇摄入：高脂血症 <300mg/日，高胆固醇血症 <200mg/日',
        '膳食纤维 25~40g/日（可溶性纤维 7~13g）；饱和脂肪 <10% 总能量（高胆固醇血症 <7%）；反式脂肪 <1%',
        '每日蔬菜 ≥500g（深色过半）、水果 200~350g、大豆蛋白 25g、烹调油 ≤25g',
        '升脂食物：动物脑/内脏、肥肉、加工肉、鱼籽蟹黄、黄油奶油、猪牛羊油、棕榈油、油炸食品',
        '降脂食物：全谷物杂豆、深海鱼、去皮禽肉、脱脂低脂奶、橄榄/茶籽/亚麻籽油',
        '运动：每周 5~7 次、每次 30 分钟中等强度（日耗 ≥200kcal）；肥胖者减重 >10% 降脂更明显'
      ],
      drug: '他汀中等强度起始（阿托伐他汀 10~20mg、瑞舒伐他汀 5~10mg），LDL-C 每降 1mmol/L 事件风险降 20~23%；不达标加依折麦布（再降 18~20%）或 PCSK9 抑制剂（降 50~70%）。PCSK9 抑制剂（如依洛尤单抗/阿利西尤单抗）每 2~4 周皮下注射一次，用于极高危/超高危、家族性高胆固醇血症及他汀不耐受者，可大幅强化降幅并减少心血管事件。服药后 4~6 周复查血脂+肝酶+CK，达标后每 3~6 个月一次。',
      special: [
        'ASCVD 风险分层（中国血脂管理指南 2023）：低危<5%、中危5%~9%、高危（LDL-C≥4.9/TC≥7.2、≥40岁糖尿病、CKD3~4期）、极高危（已确诊ASCVD）、超高危（≥2次严重ASCVD事件或1次事件+≥2高危险因素）；LDL-C 目标随分层逐级收紧',
        '他汀不耐受：症状（肌痛/无力）或 CK、ALT/AST 异常，且 ≥2 种他汀（含最小剂量）再发；CK>4 倍停药，ALT/AST ≥3 倍+胆红素升高减量/停药',
        '完全不耐受者替代：依折麦布（降 15~22%）、胆汁酸螯合剂（18~25%）、PCSK9 抑制剂（约 60%）、贝派地酸',
        '他汀与记忆力：长期研究（含 8.4 年随访）未发现他汀/PCSK9 抑制剂损害认知；心血管获益远大于风险，不应因担忧记忆而停用'
      ]
    },
    diabetes: {
      title: '血糖管理',
      tags: ['血糖异常', '糖耐量受损'],
      source: '糖尿病防治指南(2023/2018)·基层指南(2022)·老年人指南·高血糖食养指南',
      diagnosis: [
        ['空腹血糖', '≥7.0 mmol/L 诊断糖尿病；6.1~6.9 为空腹血糖受损；5.6~6.0 为空腹血糖受损早期'],
        ['餐后 2h / OGTT', '≥11.1 mmol/L 诊断糖尿病；7.8~11.0 为糖耐量受损'],
        ['糖化血红蛋白', '≥6.5% 可诊断（需复查）；5.7~6.4% 为糖尿病前期'],
        ['随机血糖', '≥11.1 mmol/L 伴典型症状可诊断']
      ],
      targets: [
        '一般成人：空腹 4.4~7.0、非空腹 <10.0 mmol/L；HbA1c <7.0%',
        'HbA1c 分层：<6.5%（年轻、短病程）；<7.0%（大多数）；<8.0%（老年/长病程/低血糖史）',
        '血压 <130/80；LDL-C 无 ASCVD <2.6、有 ASCVD <1.8；TG <1.7；BMI <24',
        '血糖波动：TIR（3.9~10.0）>50%，CV ≤36%'
      ],
      lifestyle: [
        '碳水供能 45~60%，全谷物/杂豆占主食 ≥1/3；每餐先吃蔬菜再吃主食（利于控餐后血糖）',
        '每日蔬菜 ≥500g（深色过半）；烹调油 ≤25g、盐 ≤5g；不喝含糖饮料',
        '有氧运动每周 ≥150 分钟（每周 5 天、每次 30 分钟，餐后 1 小时最佳）；抗阻每周 2~3 次',
        '减重 3~5% 即有临床获益，3~6 个月减 5~10%（每月 1~2kg）；腰围男 <85、女 <80cm',
        '老年患者：蛋白质 1.0~1.3g/kg/日（急慢性病 1.2~1.5）；每坐 30 分钟起身活动 1~5 分钟',
        '运动禁忌：血糖控制极差伴急性并发症时暂停；餐前运动须先补碳水；运动前后监测血糖防低血糖'
      ],
      drug: '二甲双胍为一线并贯穿全程（500~2000mg/日），eGFR<45 禁用；合并 ASCVD/心衰/CKD 首选 SGLT2 抑制剂或 GLP-1 受体激动剂；口服药 3 个月不达标起始胰岛素；HbA1c ≥9.0% 或空腹 ≥11.1 伴症状行短期强化。',
      special: [
        '并发症筛查（每年）：眼底（视力+眼底照相）、肾功能（尿常规+肌酐/eGFR+UACR）、神经病变（踝反射/痛觉/10g 尼龙丝）、足部',
        '随访：血糖每月 2 次（1 空腹 1 餐后）；HbA1c 初期每 3 月、达标后每 6 月；血压体重腰围每月',
        '老年"简约去强化"：优先低血糖风险低药物（DPP-4i、SGLT2i、GLP-1RA），小剂量起始'
      ]
    },
    obesity: {
      title: '体重管理',
      tags: ['肥胖', '超重', '中心性肥胖'],
      source: '肥胖症诊疗指南·体重管理指导原则(2024)·成人肥胖食养指南',
      diagnosis: [
        ['BMI（中国标准）', '<18.5 过低 / 18.5~23.9 正常 / 24~27.9 超重 / ≥28 肥胖'],
        ['肥胖分级', '28~32.4 轻度 / 32.5~37.4 中度 / 37.5~49.9 重度 / ≥50 极重度'],
        ['中心性肥胖', '腰围男 ≥90cm、女 ≥85cm；前期男 85~90、女 80~85'],
        ['体脂比', '男 >25%、女 >30% 为体脂过多']
      ],
      targets: [
        '一般目标：3~6 个月减重 5%~15% 并长期维持',
        '速度：每周 0.5~1kg、每月 2~4kg；中重度肥胖按减 5%/10%/15% 分阶段',
        '腰围目标男 <90cm、女 <85cm；BMI 回归 18.5~23.9'
      ],
      lifestyle: [
        '限能量饮食：每日减少 500~1000kcal 或减 30% 总能量；供能比碳水 50~60%、脂肪 20~30%、蛋白 15~20%',
        '高蛋白模式：蛋白供能 >20%~30%（需肾功能正常）；低碳水模式：碳水 ≤40% 短期用、糖尿病慎用',
        '轻断食 5+2：断食日男 600/女 500kcal；三餐能量比 3:4:3；盐 <5g、烹调油 20~25g、添加糖 <25g',
        '有氧：减重期每周 150~420 分钟、维持期 200~300 分钟、长期 ≥250 分钟/周；抗阻每周 2~3 次（8~12 次×2~4 组）',
        '行为：睡眠约 7 小时、23 点前入睡；久坐每 1 小时起身 3~5 分钟；晚餐 17:00~19:00 且餐后不进食；进餐顺序蔬菜→肉→主食',
        '重度肥胖：低强度开始，单次 30 分钟渐增至 60~120 分钟'
      ],
      drug: '药物减重适应证：BMI≥28 且生活方式干预 3~6 个月减重 <5%，或 BMI≥24 合并并发症。常用：奥利司他（-3.1%）、利拉鲁肽 3.0mg（-4.7%）、司美格鲁肽 2.4mg/周（-12.1%）、替尔泊肽（-11.9%~17.8%）。手术适应证：BMI≥32.5，或 27.5~32.5 合并 T2DM。',
      special: [
        '肥胖并发症：高血压 52%、血脂异常 46%、糖尿病前期 43.1%、脂肪肝超重 70%/肥胖 75.3%、睡眠呼吸暂停 BMI>30 者 40%',
        'BMI 每增加 1，房颤风险 +4%~5%；每 +1SD 心衰风险 +29%',
        '每 3~6 个月评估减重效果与代谢指标；药物减重须联合生活方式管理'
      ]
    },
    chd: {
      title: '冠心病与动脉粥样硬化',
      tags: ['颈动脉斑块', '心电图异常'],
      source: '冠心病指南·遗传检测与冠心病风险评估中国专家共识(2023)',
      diagnosis: [
        ['ASCVD 危险因素', '吸烟、高血压、血脂异常、糖尿病、肥胖、早发家族史（男<55/女<65）、Lp(a) 升高'],
        ['风险增强因素', '冠脉钙化积分 ≥100、颈动脉 IMT≥0.9mm 或斑块、ABI<0.9、左室肥厚、Lp(a)≥125nmol/L、hsCRP≥2.0、TG≥2.3'],
        ['遗传风险', '家族性高胆固醇血症（FH）杂合子约 1/220；携带 FH 突变者冠心病风险增加 3 倍']
      ],
      targets: [
        '生活方式为基础：健康饮食、戒烟、控制体重、规律运动（每周 ≥150 分钟）',
        '血压 <130/80（基础 <140/90）；LDL-C 达标（一级预防高危 <1.8、二级预防 <1.4）',
        '二级预防：他汀 + ACEI/ARB + β受体阻滞剂 + 双联抗血小板'
      ],
      lifestyle: [
        '饮食：谷薯 250~400g（全谷物 50~150g）、蔬菜 300~500g、水果 200~350g、鱼禽蛋肉 120~200g、奶 300g；盐 <5g',
        '运动：每周 ≥150 分钟中等强度或 ≥75 分钟高强度；心脏康复可改善冠脉血流储备',
        '戒烟是收益最高的单一干预；管理情绪与压力，避免应激诱发（尤其痉挛性心绞痛）'
      ],
      drug: '一级预防：降压首选 ACEI/ARB，降脂用他汀（LDL-C≥4.9 者直接启动），糖尿病用二甲双胍/SGLT2 抑制剂。二级预防：强化他汀+抗血小板（阿司匹林+氯吡格雷/替格瑞洛）。',
      special: [
        '遗传检测适用人群：疑似/确诊家族性高胆固醇血症（检测 LDLR/APOB/PCSK9）；早发冠心病家族史建议检测 Lp(a)',
        '多基因风险评分（PRS）：高遗传风险者坚持健康生活方式可使冠心病相对风险降低 50%',
        '症状识别：劳力诱发的胸痛持续 >10 分钟、静息不缓解、含服硝酸甘油无效提示微血管病变，需专科评估'
      ]
    },
    cardio: {
      title: '心血管病一级预防',
      tags: [],
      source: '2020中国心血管病一级预防指南·ARNI 临床应用中国专家建议',
      diagnosis: [
        ['直接高危', '糖尿病 ≥40 岁，或 LDL-C≥4.9（TC≥7.2），或 CKD 3/4 期'],
        ['10 年风险分层', '按 ASCVD 评估：<5% 低危 / 5%~9% 中危 / ≥10% 高危'],
        ['余生风险', '<55 岁且 10 年中危者，满足 SBP≥160、非HDL-C≥5.2、HDL-C<1.0、BMI≥28、吸烟 任 2 项为余生高危']
      ],
      targets: [
        '血压：一般人群 <130/80（基本 <140/90）；SBP 降 10 可致主要心血管事件降 20%、卒中降 35%、心衰降 40%',
        'LDL-C：高危 <1.8（或降 ≥50%）、中危 <2.6、低危 <3.4',
        '运动：每周 ≥150 分钟中等强度或 ≥75 分钟高强度；减重维持期每周 200~300 分钟',
        '饮食：盐 <5g；碳水供能 50~55%；胆固醇中低危 <300mg、高危 <200mg；不饱和脂肪替代饱和脂肪'
      ],
      lifestyle: [
        '热量：男 1500~1800kcal、女 1200~1500kcal/日；目标 BMI<24、腰围男 <90/女 <85cm',
        '避免饮酒；如饮，男 ≤25g、女 ≤15g 乙醇/日',
        '危险因素综合管理：血压、血脂、血糖、吸烟、肥胖同抓；风险评估工具建议用中国人群模型（China-PAR）'
      ],
      drug: '阿司匹林需 10 年 ASCVD 风险 ≥10% 并合并风险增强因素时权衡启用。ARNI（沙库巴曲缬沙坦）用于原发性高血压，尤其老年/盐敏感/合并心衰或左室肥厚者，常规 200mg 每日 1 次，较 ARB 额外降压 5~7mmHg，兼有逆转左室重构与肾保护作用。',
      special: [
        'ARNI 禁忌：禁与 ACEI 合用（需停药 ≥36h）、孕妇禁用、eGFR<15 及肾动脉狭窄慎用',
        '风险增强因素（中危个体决定用药）：冠脉钙化 ≥100、颈动脉斑块、Lp(a) 升高等',
        '评估工具：China-PAR 模型基于中国 10.6 万队列，较国际 PCEs 更适合中国人'
      ]
    }
  };
  /* 标签 → 文献条目 key（规则引擎引用） */
  var LIT_TAG_MAP = {
    '高血压': 'hypertension', '血压正常高值': 'hypertension',
    '血脂异常': 'dyslipidemia', '血脂边缘升高': 'dyslipidemia', '低HDL': 'dyslipidemia',
    'LDL-C未达标': 'dyslipidemia', 'LDL-C严重超标': 'dyslipidemia',
    '血糖异常': 'diabetes', '糖耐量受损': 'diabetes',
    '肥胖': 'obesity', '超重': 'obesity', '中心性肥胖': 'obesity',
    '颈动脉斑块': 'chd', '心电图异常': 'chd'
  };
  function litForTags(tags) {
    var seen = {}, out = [];
    (tags || []).forEach(function (t) {
      var key = LIT_TAG_MAP[t];
      if (key && !seen[key]) { seen[key] = 1; out.push(LIT_KNOWLEDGE[key]); }
    });
    return out;
  }

  /* =============================================================
   * 【季度报告数据底座 · 一】月度打卡维度字典 + 依从性判定规则
   * evaluate(v) 接收「季度聚合值」，返回 { level, phrase, tags, text }
   * ============================================================= */
  var CHECKIN_DIM = [
    {
      code: 'medAdherence', label: '服药依从性', unit: '%', dim: '依从性',
      standard: '≥90% 良好 / 70~89% 需改善 / <70% 依从性不佳',
      evaluate: function (v) {
        if (v == null) return null;
        v = Number(v);
        if (v >= 90) return { level: LEVEL.NORMAL, phrase: '按医嘱规律服药，依从性良好', tags: [], text: v + '%' };
        if (v >= 70) return { level: LEVEL.ATTENTION, phrase: '偶有漏服，需建立提醒机制', tags: ['依从性待改善'], text: v + '%' };
        return { level: LEVEL.ABNORMAL, phrase: '漏服较多，影响指标控制效果', tags: ['依从性不佳'], text: v + '%' };
      }
    },
    {
      code: 'weeklyExercise', label: '每周运动量', unit: '分钟/周', dim: '运动',
      standard: '≥150 分钟/周 达标（指南推荐）',
      evaluate: function (v) {
        if (v == null) return null;
        v = Number(v);
        if (v >= 150) return { level: LEVEL.NORMAL, phrase: '达到每周 150 分钟推荐量', tags: [], text: Math.round(v) + ' 分钟/周' };
        if (v >= 90) return { level: LEVEL.ATTENTION, phrase: '接近推荐量，仍需增加', tags: ['运动待加强'], text: Math.round(v) + ' 分钟/周' };
        if (v > 0) return { level: LEVEL.ABNORMAL, phrase: '明显低于推荐量，运动不足', tags: ['运动不足'], text: Math.round(v) + ' 分钟/周' };
        return { level: LEVEL.ABNORMAL, phrase: '本季度基本无规律运动', tags: ['运动不足'], text: '0 分钟/周' };
      }
    },
    {
      code: 'sleepHours', label: '平均睡眠时长', unit: '小时', dim: '睡眠',
      standard: '7~8 小时为宜',
      evaluate: function (v) {
        if (v == null) return null;
        v = Number(v);
        if (v >= 7) return { level: LEVEL.NORMAL, phrase: '睡眠时长充足', tags: [], text: v.toFixed(1) + ' 小时' };
        if (v >= 6) return { level: LEVEL.ATTENTION, phrase: '睡眠偏少，需调整作息', tags: ['睡眠不足'], text: v.toFixed(1) + ' 小时' };
        return { level: LEVEL.ABNORMAL, phrase: '睡眠明显不足，增加心脑血管负荷', tags: ['睡眠不足'], text: v.toFixed(1) + ' 小时' };
      }
    },
    {
      code: 'dietPattern', label: '饮食结构', unit: '', dim: '饮食',
      standard: '荤素均衡为宜',
      evaluate: function (v) {
        if (!v) return null;
        if (v.indexOf('均衡') >= 0) return { level: LEVEL.NORMAL, phrase: '荤素搭配合理', tags: [], text: v };
        if (v.indexOf('多荤') >= 0 || v.indexOf('偏荤') >= 0) return { level: LEVEL.ATTENTION, phrase: '动物性食物偏多，需增加蔬菜与全谷物', tags: ['饮食结构偏荤'], text: v };
        if (v.indexOf('多素') >= 0 || v.indexOf('偏素') >= 0) return { level: LEVEL.ATTENTION, phrase: '素食偏多，注意优质蛋白摄入', tags: ['优质蛋白不足'], text: v };
        return { level: LEVEL.NORMAL, phrase: '饮食结构基本合理', tags: [], text: v };
      }
    },
    {
      code: 'friedFreq', label: '油炸/高脂摄入', unit: '', dim: '饮食',
      standard: '每月 ≤1 次为宜',
      evaluate: function (v) {
        if (!v) return null;
        if (v.indexOf('几乎不') >= 0) return { level: LEVEL.NORMAL, phrase: '高脂食物控制良好', tags: [], text: v };
        if (v.indexOf('1-2') >= 0 || v.indexOf('偶尔') >= 0) return { level: LEVEL.ATTENTION, phrase: '偶有高脂摄入，建议进一步减少', tags: ['高脂饮食'], text: v };
        return { level: LEVEL.ABNORMAL, phrase: '高脂摄入频繁，不利于血脂与体重管控', tags: ['高脂饮食'], text: v };
      }
    },
    {
      code: 'smoke', label: '吸烟情况', unit: '支/天', dim: '依从性',
      standard: '0 支/天',
      evaluate: function (v) {
        if (v == null) return null;
        v = Number(v);
        if (v === 0) return { level: LEVEL.NORMAL, phrase: '不吸烟', tags: [], text: '0 支/天' };
        if (v <= 5) return { level: LEVEL.ATTENTION, phrase: '仍有少量吸烟，建议逐步戒断', tags: ['吸烟'], text: v + ' 支/天' };
        return { level: LEVEL.ABNORMAL, phrase: '吸烟量较大，是心脑血管核心危险因素', tags: ['吸烟'], text: v + ' 支/天' };
      }
    },
    {
      code: 'drink', label: '饮酒情况', unit: '', dim: '依从性',
      standard: '不饮或每周不超过 2 次',
      evaluate: function (v) {
        if (!v) return null;
        if (v.indexOf('不饮') >= 0 || v === '0') return { level: LEVEL.NORMAL, phrase: '本季度未饮酒', tags: [], text: v };
        if (v.indexOf('偶尔') >= 0) return { level: LEVEL.ATTENTION, phrase: '偶有饮酒，需继续控制单次量', tags: ['饮酒'], text: v };
        return { level: LEVEL.ABNORMAL, phrase: '饮酒频繁，是当前最核心的可改善危险因素', tags: ['饮酒频繁'], text: v };
      }
    },
    {
      code: 'weightStatus', label: '体重 / BMI 状态', unit: 'kg/m²', dim: '饮食',
      standard: '成人 BMI 18.5~23.99；季度体重变化 ±2% 内为稳定',
      evaluate: function (agg) {
        if (!agg) return null;
        var bmi = agg.bmi != null ? Number(agg.bmi) : null;
        var dpct = agg.weightDeltaPct != null ? Number(agg.weightDeltaPct) : null;
        var hasHeight = agg.height != null;
        /* 身高缺失：不判 BMI 绝对状态，仅展示体重趋势 + 触发需补录身高 */
        if (!hasHeight || bmi == null) {
          if (dpct != null && Math.abs(dpct) > 2) {
            var t = dpct > 0 ? '体重上升' : '体重下降';
            return { level: LEVEL.ATTENTION, phrase: (dpct > 0 ? '体重较基线上升' : '体重较基线下降') + '，且缺少身高无法评估 BMI', tags: [t, '需补录身高'], text: (dpct > 0 ? '+' : '') + dpct + '%（需补录身高）' };
          }
          if (dpct != null) return { level: LEVEL.NORMAL, phrase: '体重基本稳定（缺少身高，BMI 待评估）', tags: ['需补录身高'], text: (dpct > 0 ? '+' : '') + dpct + '%（需补录身高）' };
          return { level: LEVEL.ATTENTION, phrase: '缺少身高与体重数据，无法评估体重状况', tags: ['需补录身高'], text: '需补录身高' };
        }
        /* 绝对状态优先：BMI ≥24 恒为超重/需关注，≥28 恒为肥胖/异常 */
        if (bmi >= 28) {
          var pct = dpct != null && Math.abs(dpct) > 2 ? (dpct < 0 ? '，本季较基线下降 ' + Math.abs(dpct) + '%（改善中）' : '，本季较基线上升 ' + dpct + '%') : '';
          return { level: LEVEL.ABNORMAL, phrase: '肥胖（BMI ' + bmi + '），需系统减重' + pct, tags: ['肥胖'], text: 'BMI ' + bmi };
        }
        if (bmi >= 24) {
          var pct2 = dpct != null && Math.abs(dpct) > 2 ? (dpct < 0 ? '，本季较基线下降 ' + Math.abs(dpct) + '%（改善中）' : '，本季较基线上升 ' + dpct + '%') : '';
          return { level: LEVEL.ATTENTION, phrase: '超重（BMI ' + bmi + '），需控制体重' + pct2, tags: ['超重'], text: 'BMI ' + bmi };
        }
        if (bmi < 18.5) {
          return { level: LEVEL.ATTENTION, phrase: '偏瘦（BMI ' + bmi + '），需排查营养与病因', tags: ['偏瘦'], text: 'BMI ' + bmi };
        }
        /* 正常 BMI：再看趋势（±2% 容差） */
        if (dpct != null && Math.abs(dpct) > 2) {
          var tt = dpct > 0 ? '体重上升' : '体重下降';
          return { level: LEVEL.ATTENTION, phrase: dpct > 0 ? '体重较基线上升，需关注' : '体重较基线下降，需排查原因', tags: [tt], text: (dpct > 0 ? '+' : '') + dpct + '%' };
        }
        return { level: LEVEL.NORMAL, phrase: '体重与 BMI 均在正常范围', tags: [], text: 'BMI ' + bmi };
      }
    },
    {
      code: 'symptomScore', label: '症状反馈', unit: '分', dim: '症状',
      standard: '加权总分 = 0（高危症状 2 分/月，一般 1 分/月）',
      evaluate: function (v) {
        if (v == null) return null;
        v = Number(v);
        if (v === 0) return { level: LEVEL.NORMAL, phrase: '本季度无明显不适反馈', tags: [], text: '0 分' };
        if (v <= 2) return { level: LEVEL.ATTENTION, phrase: '偶有不适，需持续观察', tags: ['症状反馈'], text: v + ' 分' };
        return { level: LEVEL.ABNORMAL, phrase: '症状反复出现，建议专科评估', tags: ['症状反复'], text: v + ' 分' };
      }
    }
  ];
  function checkinLookup(code) {
    for (var i = 0; i < CHECKIN_DIM.length; i++) if (CHECKIN_DIM[i].code === code) return CHECKIN_DIM[i];
    return null;
  }

  /* =============================================================
   * 【季度报告数据底座 · 二】季度洞察与改善建议库
   * 每个维度：lead（引言，按标签优先匹配）+ base（通用条目）+ cond（标签条件条目）
   * ============================================================= */
  var QUARTER_INSIGHT = {
    exercise: {
      title: '运动优化',
      lead: {
        '骨质疏松': '客户骨密度提示骨质疏松，需通过适度负重运动刺激骨形成，同时改善心肺功能。',
        '骨量减少': '客户骨量已开始减少，需通过负重运动延缓骨流失，并维持心肺功能。',
        '运动不足': '本季度打卡显示运动量明显低于推荐水平，需优先建立规律运动习惯。',
        '高血压': '规律有氧运动是降压的核心非药物手段，需在安全前提下坚持执行。',
        '颈动脉斑块': '规律运动有助于改善血脂与血管内皮功能，延缓斑块进展。',
        '超重': '需通过运动增加能量消耗，配合饮食实现体重与腰围下降。',
        '中心性肥胖': '腹型脂肪对代谢影响最大，需通过有氧结合抗阻训练针对性改善。',
        '_default': '规律运动是心脑血管健康的基础，本季度重点在于保持频次与强度的稳定。'
      },
      base: [
        { t: '有氧运动打底', d: '推荐快走、游泳、骑自行车等中等强度有氧运动，每周 150 分钟以上，分 5 天以上进行。' },
        { t: '避开高风险时段', d: '运动避开清晨（6-9 点）心脑血管高发时段，建议选择上午 10 点后或傍晚；运动前后充分热身和拉伸。' },
        { t: '循序渐进', d: '运动遵循安全性、循序渐进、长期坚持三大原则；运动中能正常说话为宜，气喘吁吁说明强度过大。' }
      ],
      cond: {
        '骨质疏松': [
          { t: '加入负重训练', d: '每周 2~3 次负重运动（哑铃操、快走、太极拳），有助于刺激骨形成、改善骨密度。' },
          { t: '平衡防跌倒', d: '每周 2~3 次平衡训练（太极拳、单脚站立），预防跌倒导致骨折。避免高冲击力运动和脊柱过度前弯动作。' }
        ],
        '骨量减少': [ { t: '增加负重刺激', d: '每周 2~3 次负重运动（快走、哑铃操、爬楼梯），配合钙与维生素 D 摄入，延缓骨量流失。' } ],
        '运动不足': [ { t: '先建频次再提强度', d: '本季度先以「每周 3 次、每次 20 分钟快走」建立习惯，达成后再逐步延长至 30~40 分钟。' } ],
        '运动待加强': [ { t: '补足缺口时长', d: '在现有基础上每周增加 1~2 次运动或每次延长 10 分钟，逐步补足至 150 分钟/周。' } ],
        '超重': [ { t: '增加消耗型运动', d: '在有氧基础上加入 2~3 次抗阻训练（弹力带、器械），提升基础代谢，目标 BMI 回归 18.5~23.9。' } ],
        '中心性肥胖': [ { t: '针对腹型脂肪', d: '有氧运动时长延长至每次 40 分钟以上，配合核心训练；目标腰围男性<90cm、女性<85cm。' } ],
        '高血压': [ { t: '监测运动血压', d: '运动前后各测一次血压，避免憋气发力动作（如硬拉、快速起身），血压>160/100mmHg 时暂缓运动。' } ],
        '糖耐量受损': [ { t: '餐后运动优先', d: '餐后 30~60 分钟散步 20 分钟，可有效削减餐后血糖峰值。' } ],
        '高尿酸': [ { t: '避免剧烈无氧', d: '剧烈运动产生乳酸会抑制尿酸排泄，宜选中低强度有氧并保证运动中补水。' } ]
      }
    },
    diet: {
      title: '饮食调整',
      lead: {
        '血脂异常': '客户血脂升高，是斑块进展的核心驱动因素，需以控脂为主线全面调整饮食结构。',
        '血脂边缘升高': '客户血脂整体处于正常高值（总胆固醇、低密度脂蛋白接近上限），需通过饮食提前干预。',
        '骨质疏松': '客户合并骨质疏松，需在控脂控盐的同时保证充足钙与优质蛋白摄入。',
        '高尿酸': '客户血尿酸升高，需在均衡膳食基础上严格控制嘌呤与酒精摄入。',
        '高脂饮食': '本季度打卡显示油炸与高脂食物摄入偏多，是本季度饮食调整的首要目标。',
        '高血压': '限盐是饮食干预降压最有效的环节，需从隐形盐入手系统减量。',
        '_default': '饮食结构是长期健康管理的地基，本季度重点在于稳定执行与细节优化。'
      },
      base: [
        { t: '主食粗细搭配', d: '用杂粮、糙米、燕麦替代部分精白米面；水煮玉米、小香薯等可作为主食补充。' },
        { t: '优质蛋白优选', d: '每日蛋白质 1.0~1.2g/kg 体重，优选鱼类（尤其深海鱼）、豆制品、白肉，减少红肉和加工肉。' },
        { t: '控油限糖限咖啡', d: '每日烹调油 25~30g；减少精制糖、动物内脏摄入；咖啡每日不超过 2 杯，避免过量碳酸饮料。' }
      ],
      cond: {
        '骨质疏松': [ { t: '高钙低盐架构', d: '每日钙摄入不低于 1000mg：低脂牛奶/酸奶 ≥300mL、北豆腐 100g、深色蔬菜；每日食盐 ＜5g，高钠加速尿钙流失。' } ],
        '骨量减少': [ { t: '补足钙与维D', d: '每日奶制品 ≥300mL，配合豆制品与深色蔬菜；维生素 D 800~1000IU/日。' } ],
        '血脂异常': [ { t: '严格控制饱和脂肪', d: '红肉每日不超过 50g，避免动物油、肥肉、动物内脏；增加膳食纤维（燕麦、豆类）促进胆固醇排出。' } ],
        '血脂边缘升高': [ { t: '提前控脂', d: '减少红肉与高油高糖摄入，每日新鲜蔬菜 ≥500g（深色占一半），增加全谷物与豆制品。' } ],
        '高脂饮食': [ { t: '压缩油炸频次', d: '本季度目标：油炸/高脂食物降至每月 ≤1 次；外出就餐主动要求少油少盐、菜品过水。' } ],
        '高血压': [ { t: '全面限盐', d: '每日盐 <5g，警惕咸菜、酱油、鸡精、加工肉等隐形盐；可用醋、柠檬、香辛料替代部分咸味。' } ],
        '高尿酸': [ { t: '低嘌呤饮食', d: '少吃或不吃动物内脏、贝壳海鲜、浓肉汤、干豆类；每日饮水 2000mL 以上促进尿酸排泄。' } ],
        '糖耐量受损': [ { t: '控制碳水质量', d: '减少精制糖与甜饮料，主食定量并搭配蛋白质与蔬菜，降低餐后血糖波动。' } ],
        '幽门螺杆菌感染': [ { t: '杀菌期饮食', d: '清淡易消化、少食多餐，避免辛辣油腻与酒精；家庭实行分餐制、使用公筷。' } ],
        '维生素D不足': [ { t: '补充维D来源', d: '增加三文鱼、蛋黄、强化奶摄入，配合每日 20~30 分钟日晒。' } ],
        '肝酶异常': [ { t: '严格禁酒护肝', d: '停止饮酒是肝酶回落的关键；增加蔬果与优质蛋白，避免高果糖饮料与油炸食品。' } ],
        '优质蛋白不足': [ { t: '补足蛋白', d: '每餐保证一个掌心大小的蛋白质来源（鱼、蛋、豆制品、瘦肉），避免长期纯素导致肌肉流失。' } ]
      }
    },
    sleep: {
      title: '睡眠管理',
      lead: {
        '睡眠不足': '本季度打卡显示睡眠时长不足，睡眠剥夺会直接升高血压与交感张力。',
        '_default': '睡眠是被低估的心脑血管危险因素，本季度继续保持规律作息。'
      },
      base: [
        { t: '固定作息节律', d: '每日固定入睡与起床时间（波动不超过 1 小时），保证 7~8 小时睡眠；午休控制在 30 分钟内。' },
        { t: '睡前减少刺激', d: '睡前 1 小时远离手机与强光，避免咖啡、浓茶与酒精助眠；卧室保持安静、微暗、凉爽。' }
      ],
      cond: {
        '睡眠不足': [
          { t: '排查睡眠障碍', d: '若存在入睡困难>30 分钟、夜间频繁憋醒或明显鼾声，建议行睡眠呼吸监测，排除睡眠呼吸暂停。' },
          { t: '记录睡眠日志', d: '通过月度打卡持续记录睡眠时长与质量，帮助识别影响因素（应酬、加班、作息）。' }
        ],
        '高血压': [ { t: '关注晨峰血压', d: '睡眠不佳常伴晨起血压升高，建议起床后 1 小时内加测一次血压并记录。' } ]
      }
    },
    adherence: {
      title: '用药与监测依从性',
      lead: {
        '依从性不佳': '本季度服药依从性偏低，是指标未能达标的重要原因，需优先改善。',
        '依从性待改善': '本季度存在偶发漏服，建议建立提醒机制以稳定药效。',
        '吸烟': '吸烟是心脑血管首要可改变危险因素，戒烟收益高于任何单一药物。',
        '饮酒频繁': '饮酒是本季度最核心的可改善危险因素，需优先控制频次与单次量。',
        '_default': '规范执行医嘱与居家监测，是让健康管理方案真正产生效果的前提。'
      },
      base: [
        { t: '居家监测规范', d: '每周固定 2~3 天早晚各测一次血压（静坐 5 分钟后、同一侧上臂），记录于月度打卡表。' },
        { t: '按月完成打卡', d: '每月月底完成健康打卡，帮助健管师与私人医生及时发现趋势变化。' }
      ],
      cond: {
        '依从性不佳': [ { t: '建立服药提醒', d: '使用分药盒 + 手机定时提醒，将服药与固定生活场景绑定（如早餐后）；漏服请勿自行加倍补服。' } ],
        '依从性待改善': [ { t: '减少漏服', d: '外出随身携带 1~2 日备用药量；将药盒置于每日必经位置，降低遗忘概率。' } ],
        '吸烟': [ { t: '启动戒烟计划', d: '设定明确戒烟日，清除环境中的烟具；必要时寻求戒烟门诊与药物辅助。' } ],
        '饮酒频繁': [ { t: '限酒执行方案', d: '参照《中国居民膳食指南（2022）》，单日酒精不超过 15g、每周不超过 2 次；应酬前主动申明、避免空腹与混饮。' } ],
        '饮酒': [ { t: '控制单次饮酒量', d: '继续保持低频饮酒，单次不超过 1 个标准杯，避免空腹饮酒与混饮。' } ],
        '症状反复': [ { t: '症状记录与就诊', d: '出现症状时记录发作时间、持续时长与诱因；胸痛、肢体无力、言语不清等立即就医。' } ]
      }
    }
  };

  /* =============================================================
   * 【季度报告数据底座 · 三】行动清单库（按触发标签生成本季度行动项）
   * priority 越小越优先；when 支持 '持续' 或 '+N月'
   * ============================================================= */
  var ACTION_LIB = {
    '骨质疏松':      { priority: 1, action: '启动骨质疏松干预方案', goal: '每日补充钙剂 + 活性维生素 D（800~1000IU），保证 20~30 分钟日晒，减少浓茶咖啡', when: '持续' },
    '高血压':        { priority: 1, action: '强化血压管控', goal: '居家每周监测 2~3 次并记录，目标长期维持 <130/80mmHg；遵医嘱规律用药', when: '持续' },
    '血糖异常':      { priority: 1, action: '血糖规范管理', goal: '内分泌科随诊，控制精制碳水，3 个月内复查空腹血糖与糖化血红蛋白', when: '+3月' },
    '幽门螺杆菌感染':{ priority: 1, action: '完成幽门螺杆菌根除治疗', goal: '足疗程服药，服药期间禁酒忌辛辣；停药 2 个月后复查 C13 呼气试验', when: '+2月' },
    '血脂异常':      { priority: 2, action: '执行降脂方案', goal: '遵医嘱维持降脂治疗 + 低脂饮食，3 个月复查血脂全套与肝功能，LDL-C 目标 <2.6mmol/L', when: '+3月' },
    'LDL-C严重超标':{ priority: 1, action: '紧急降脂就医', goal: '尽快心内科就诊评估，启动强化联合降脂方案，关注他汀不耐受，1 个月内复查血脂全套与肝功能', when: '+1月' },
    'LDL-C未达标':  { priority: 2, action: '强化降脂达标', goal: '遵医嘱强化降脂（他汀 ± 依折麦布/PCSK9抑制剂），3 个月复查血脂与肝功能，LDL-C 目标 <1.8 或 <1.4 mmol/L', when: '+3月' },
    '肿瘤标志物升高':{ priority: 2, action: '肿瘤标志物复查', goal: '3 个月内于肿瘤科或相应专科复查，动态观察数值变化', when: '+3月' },
    '依从性不佳':    { priority: 2, action: '改善服药依从性', goal: '使用分药盒与定时提醒，本季度服药依从率提升至 90% 以上', when: '持续' },
    '饮酒频繁':      { priority: 2, action: '执行限酒/戒酒计划', goal: '单日酒精 <15g、每周不超过 2 次，逐步过渡到不饮酒', when: '持续' },
    '吸烟':          { priority: 2, action: '启动戒烟计划', goal: '设定戒烟日，本季度日吸烟量降至 0；必要时戒烟门诊辅助', when: '持续' },
    '运动不足':      { priority: 2, action: '执行规律运动计划', goal: '每周 150 分钟中等强度有氧 + 2~3 次负重/平衡训练，通过月度打卡表记录', when: '持续' },
    '运动待加强':    { priority: 3, action: '补足运动缺口', goal: '每周增加 1~2 次运动或每次延长 10 分钟，达成 150 分钟/周', when: '持续' },
    '肺结节':        { priority: 3, action: '肺结节年度随访', goal: '按期完成胸部低剂量 CT，比对结节大小与形态变化', when: '+12月' },
    '甲状腺结节':    { priority: 3, action: '甲状腺结节随访', goal: '6~12 个月复查甲状腺超声与功能，关注大小与形态', when: '+6月' },
    '白内障':        { priority: 3, action: '眼科门诊评估白内障', goal: '至眼科进一步评估白内障进展，外出佩戴墨镜减少紫外线损伤', when: '+1月' },
    '颈动脉斑块':    { priority: 3, action: '血管斑块管控随访', goal: '强化降脂与危险因素管控，年度复查颈动脉（含头臂干）及下肢动脉超声', when: '+12月' },
    '高尿酸':        { priority: 3, action: '尿酸管控', goal: '限酒、限高嘌呤食物，每日饮水 2000mL 以上，1~3 个月复查血尿酸', when: '+3月' },
    '肝酶异常':      { priority: 3, action: '肝功能保护与复查', goal: '严格禁酒，减少油炸食品，3 个月复查肝功能及肝脏超声', when: '+3月' },
    '维生素D不足':   { priority: 3, action: '补充维生素 D', goal: '每日 800~1000IU + 日晒 20~30 分钟，3 个月复查 25 羟维生素 D', when: '+3月' },
    '中心性肥胖':    { priority: 3, action: '腰围管理', goal: '目标腰围男性<90cm、女性<85cm；控油控糖 + 每周 5 次有氧', when: '持续' },
    '超重':          { priority: 3, action: '体重管理', goal: '本季度体重下降 1~2kg，BMI 向 18.5~23.9 回归', when: '持续' },
    '睡眠不足':      { priority: 3, action: '改善睡眠', goal: '固定作息，平均睡眠恢复至 7 小时以上；必要时行睡眠呼吸监测', when: '持续' },
    '高脂饮食':      { priority: 3, action: '压缩高脂饮食', goal: '油炸/高脂食物降至每月 ≤1 次，烹调油每日 <25g', when: '持续' },
    '饮食结构偏荤':  { priority: 4, action: '优化饮食结构', goal: '每日蔬菜 ≥500g（深色占一半），红肉每日 ≤50g', when: '持续' },
    '泌尿系异常':    { priority: 4, action: '泌尿系随访', goal: '复查泌尿系超声，跟踪囊肿/占位大小与形态变化', when: '+6月' },
    '肾功能下降':    { priority: 2, action: '肾功能保护', goal: '控制血压与蛋白摄入，避免肾毒性药物，3 个月复查肾功能与尿常规', when: '+3月' },
    '糖耐量受损':    { priority: 3, action: '糖代谢干预', goal: '控制体重与精制糖摄入，餐后散步；6~12 个月复查糖代谢指标', when: '+6月' },
    '心电图异常':    { priority: 2, action: '心律评估', goal: '结合症状复查心电图，必要时行动态心电图或心内科评估', when: '+1月' },
    '高同型半胱氨酸':{ priority: 4, action: '同型半胱氨酸管控', goal: '补充叶酸与维生素 B6/B12，3~6 个月复查', when: '+3月' },
    '症状反复':      { priority: 1, action: '症状专科评估', goal: '就诊评估反复出现的不适，明确原因并调整方案', when: '+1月' },
    '血压正常高值':  { priority: 3, action: '血压临界管控', goal: '限盐减重、规律运动，居家监测防止进展为高血压', when: '持续' },
    '血脂边缘升高':  { priority: 3, action: '血脂提前干预', goal: '低脂高纤饮食 + 每周 150 分钟有氧，6 个月复查血脂', when: '+6月' },
    '骨量减少':      { priority: 3, action: '骨量维护', goal: '钙 + 维生素 D 补充配合负重运动，年度复查骨密度', when: '持续' },
    '体重上升':      { priority: 3, action: '控制体重反弹', goal: '恢复饮食记录与运动频次，本季度体重回落至基线水平', when: '持续' },
    '体重下降':      { priority: 3, action: '排查体重下降原因', goal: '评估摄入是否充足，必要时查血糖、甲功与肿瘤指标', when: '+1月' }
  };

  /* =============================================================
   * 【季度报告数据底座 · 四】随访安排库（按标签生成复查项与间隔）
   * ============================================================= */
  var FOLLOWUP_LIB = {
    '高血压':        { item: '血压与电解质复查', months: 3 },
    '血脂异常':      { item: '血脂全套 + 肝功能', months: 3 },
    'LDL-C严重超标':{ item: '血脂全套 + 肝功能', months: 1 },
    'LDL-C未达标':  { item: '血脂全套 + 肝功能', months: 3 },
    '血脂边缘升高':  { item: '血脂全套', months: 6 },
    '血糖异常':      { item: '空腹血糖 + 糖化血红蛋白', months: 3 },
    '糖耐量受损':    { item: '空腹血糖 + 糖化血红蛋白', months: 6 },
    '高尿酸':        { item: '血尿酸', months: 3 },
    '肝酶异常':      { item: '肝功能 + 肝脏超声', months: 3 },
    '维生素D不足':   { item: '25 羟维生素 D 及骨代谢指标', months: 3 },
    '骨质疏松':      { item: '骨密度 + 骨代谢指标', months: 6 },
    '骨量减少':      { item: '骨密度', months: 12 },
    '甲状腺结节':    { item: '甲状腺超声 + 甲功', months: 6 },
    '颈动脉斑块':    { item: '颈动脉（含头臂干）及下肢动脉超声', months: 12 },
    '肺结节':        { item: '胸部低剂量 CT', months: 12 },
    '肿瘤标志物升高':{ item: '肿瘤标志物复查', months: 3 },
    '幽门螺杆菌感染':{ item: 'C13 呼气试验', months: 2 },
    '泌尿系异常':    { item: '泌尿系超声', months: 6 },
    '肾功能下降':    { item: '肾功能 + 尿常规', months: 3 },
    '心电图异常':    { item: '心电图 / 动态心电图', months: 1 },
    '白内障':        { item: '眼科门诊评估', months: 1 },
    '高同型半胱氨酸':{ item: '同型半胱氨酸', months: 3 }
  };

  /* 季节季度标签：冬春季→春季、春夏季→夏季、夏秋季→秋季、秋冬季→冬季 */
  function seasonShortLabel(name) {
    var map = { '冬春季': '春季', '春夏季': '夏季', '夏秋季': '秋季', '秋冬季': '冬季' };
    return map[name] || name;
  }
  function seasonMonthRange(name) {
    var s = SEASON[name];
    if (!s) return '';
    return s.months[0] + '-' + s.months[s.months.length - 1] + ' 月';
  }

  /* 季度健康寄语（动态嵌入姓名 / 血压 / 亮点 / 核心任务） */
  function quarterMessage(ctx) {
    ctx = ctx || {};
    var honor = (ctx.gender === '女') ? '女士' : '先生';
    var lines = [];
    lines.push('尊敬的 ' + (ctx.name || '客户') + ' ' + honor + '：');
    lines.push('感谢您在本季度对健康管理计划的信任与配合。在这份报告中，每一个数字都是您身体最诚实的告白' +
      (ctx.bpText ? ('——血压维持在 ' + ctx.bpText + '，是您日常自律的见证') : '') +
      (ctx.concernText ? ('；而' + ctx.concernText + '，则是身体在温和地提醒您：需要给予血管与代谢更多的呵护') : '') + '。');
    lines.push('本季度，您的核心任务是' + (ctx.coreTask || '保持指标稳定、延续既有的良好习惯') +
      '。守护健康并不需要轰轰烈烈的变革，它藏匿于每日的细微选择里：是按时服下的那一粒药，是餐盘中多一抹深绿色的蔬菜，是告别久坐后的一次起身快走，是面对' + (ctx.seasonLabel || '季节') + '变化时及时调整的智慧。');
    if (ctx.reassureText) lines.push('请记得，' + ctx.reassureText + '这些都无需焦虑，只需按时随访观察。健康的真谛，在于找到一种能与自我和谐共处的方式，是倾听身体的声音，并给予它恰如其分的回应。');
    lines.push('未来，愿您以这份报告为基点，不求完美，但求持之以恒；不必慌张，只需步步为营。心脑血管健康管理是一个长期过程，我们始终与您同行，为您的健康保驾护航。');
    lines.push('健康无忧，未来可控。');
    return lines.join('\n');
  }

  /* =============================================================
   * 【v3.0】指标判定规则文字版（前端「指标规则」tab 展示）
   * key 与 INDICATORS 指标 code 一一对应
   * ============================================================= */
  var RULE_TEXT = {
    sbp:   { rule: '≤119 → 正常；120~139 → 需关注；140~159 → 异常；≥160 → 危急', tags: '— / 血压正常高值 / 高血压' },
    dbp:   { rule: '≤79 → 正常；80~89 → 需关注；90~99 → 异常；≥100 → 危急', tags: '— / 血压正常高值 / 高血压' },
    hr:    { rule: '<50 → 异常（心动过缓）；50~59 → 需关注（偏慢）；60~100 → 正常；100~119 → 需关注（偏快）；≥120 → 异常（心动过速）', tags: '— / 心率偏快 / 心动过缓 / 心动过速' },
    ldl:   { rule: '按 ASCVD 风险等级个性化判定（见下方分层表）；未评估时统一阈值：<3.4 正常 / 3.4~4.0 需关注 / ≥4.1 异常', tags: '— / 血脂边缘升高 / 血脂异常 / LDL-C未达标 / LDL-C严重超标' },
    hdl:   { rule: '<1.0 → 需关注；≥1.0 → 正常', tags: '— / 低HDL' },
    tc:    { rule: '≤5.19 → 正常；5.20~6.19 → 需关注；≥6.20 → 异常', tags: '— / 血脂边缘升高 / 血脂异常' },
    tg:    { rule: '≤1.69 → 正常；1.70~2.29 → 需关注；2.30~5.59 → 异常；≥5.60 → 危急', tags: '— / 血脂边缘升高 / 血脂异常' },
    fpg:   { rule: '≤6.09 → 正常；6.10~6.99 → 需关注；≥7.00 → 异常', tags: '— / 糖耐量受损 / 血糖异常' },
    hba1c: { rule: '≤5.69 → 正常；5.70~6.49 → 需关注；≥6.50 → 异常', tags: '— / 糖耐量受损 / 血糖异常' },
    ua:    { rule: '男 ≤420 / 女 ≤360 → 正常；阈值~阈值+120 → 需关注；>阈值+120 → 异常', tags: '— / 高尿酸' },
    waist: { rule: '男 <90cm / 女 <85cm → 正常；男 ≥90 / 女 ≥85 → 需关注', tags: '— / 中心性肥胖' },
    lungNodule: { rule: '无 → 不输出；微小结节(<6mm) → 需关注；小结节(6-8mm) → 需关注；结节(>8mm) → 异常', tags: '— / 肺结节' },
    hpylori: { rule: '阴性 → 正常；阳性 → 异常', tags: '— / 幽门螺杆菌感染' },
    ggt:   { rule: '男 ≤50 / 女 ≤35 → 正常；阈值~2×阈值 → 需关注；>2×阈值 → 异常', tags: '— / 肝酶异常' },
    egfr:  { rule: '≤65 岁：≥90 → 正常；60~89 → 需关注；<60 → 异常。>65 岁：≥60 → 正常；<60 → 异常', tags: '— / 肾功能下降' },
    renalCyst: { rule: '无 → 不输出；良性囊肿 → 需关注；性质待定 → 需关注', tags: '— / 泌尿系异常' },
    homocysteine: { rule: '<15 → 正常；15~19 → 需关注；≥20 → 异常', tags: '— / 高同型半胱氨酸' },
    carotidPlaque: { rule: '无明确斑块 → 正常；稳定斑块 → 需关注；多发/混合斑块 → 需关注', tags: '— / 颈动脉斑块' },
    ecg:   { rule: '正常 → 正常；异常 → 需关注', tags: '— / 心电图异常' },
    bmi:   { rule: '≤18.49 → 需关注（偏瘦）；18.50~23.99 → 正常；24.00~27.99 → 需关注（超重）；≥28.00 → 异常（肥胖）', tags: '— / 偏瘦 / 超重 / 肥胖' },
    bp:    { rule: '综合血压：取 SBP/DBP 判定较高一级，分档同 sbp/dbp', tags: '同 sbp/dbp' },
    vitd:  { rule: '基础指标行，无独立阈值判定，标准列显示"—"', tags: '—' },
    bmd:   { rule: '基础指标行，无独立阈值判定，标准列显示"—"', tags: '—' },
    cyfra21: { rule: '基础指标行，无独立阈值判定，标准列显示"—"', tags: '—' }
  };

  /* =============================================================
   * 【v3.0】前端自定义指标与标签体系（localStorage 持久化）
   * custom_indicators：自定义指标定义数组
   * custom_tags：自定义标签定义数组（含建议/行动配置）
   * ============================================================= */
  var CUSTOM_KEYS = { indicators: 'custom_indicators', tags: 'custom_tags' };

  function customLoad(key) {
    try {
      var raw = (global.localStorage || {}).getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function customSave(key, arr) {
    try { (global.localStorage || {}).setItem(key, JSON.stringify(arr || [])); return true; }
    catch (e) { return false; }
  }
  function customIndicators() { return customLoad(CUSTOM_KEYS.indicators); }
  function customTags() { return customLoad(CUSTOM_KEYS.tags); }

  /* level 字符串 → LEVEL 对象（normal/attention/abnormal/critical/review） */
  function levelFromKey(k) {
    var map = {
      'normal': LEVEL.NORMAL, 'attention': LEVEL.ATTENTION,
      'abnormal': LEVEL.ABNORMAL, 'critical': LEVEL.CRITICAL, 'review': LEVEL.REVIEW
    };
    return map[k] || LEVEL.ATTENTION;
  }

  /* 自定义指标求值：返回 { level, phrase, tags, text } 或 null */
  function evalIndicator(ind, v) {
    if (!ind || v == null || v === '') return null;
    var type = ind.indicator_type || 'numeric';
    if (type === 'text') {
      return { level: LEVEL.NORMAL, phrase: '已记录（文本型）', tags: [], text: String(v) };
    }
    if (type === 'numeric') {
      var n = Number(v);
      if (isNaN(n)) return null;
      var ths = ind.thresholds || [];
      for (var i = 0; i < ths.length; i++) {
        var t = ths[i];
        var okMin = (t.value_min == null || t.value_min === '') ? true : (n >= Number(t.value_min));
        var okMax = (t.value_max == null || t.value_max === '') ? true : (n <= Number(t.value_max));
        if (okMin && okMax) {
          return { level: levelFromKey(t.level), phrase: t.phrase || '自定义判定', tags: t.tag ? [t.tag] : [], text: n };
        }
      }
      return null;
    }
    if (type === 'choice') {
      var chs = ind.choices || [];
      var sv = String(v);
      for (var j = 0; j < chs.length; j++) {
        if (String(chs[j].label) === sv) {
          return { level: levelFromKey(chs[j].level), phrase: chs[j].phrase || '', tags: chs[j].tag ? [chs[j].tag] : [], text: sv };
        }
      }
      return null;
    }
    return null;
  }

  /* 联动建议：内置优先，其次自定义标签配置 */
  function adviceFor(tag) {
    if (ADVICE[tag]) return ADVICE[tag];
    var cts = customTags();
    for (var i = 0; i < cts.length; i++) {
      if (cts[i].tag_name === tag && cts[i].advice_title) {
        /* 前端表单存英文 key（attention/abnormal/critical），统一走 levelFromKey 映射 */
        var lv = levelFromKey(cts[i].advice_level);
        return { title: cts[i].advice_title, level: lv, text: cts[i].advice_content || '遵医嘱进一步评估与处理。' };
      }
    }
    return null;
  }
  /* 联动行动项：内置优先，其次自定义标签配置 */
  function actionFor(tag) {
    if (ACTION_LIB[tag]) return ACTION_LIB[tag];
    var cts = customTags();
    for (var i = 0; i < cts.length; i++) {
      if (cts[i].tag_name === tag && cts[i].action_item) {
        return {
          priority: cts[i].action_priority || 3,
          action: cts[i].action_item,
          goal: cts[i].advice_content || '',
          when: cts[i].action_deadline || '+3月'
        };
      }
    }
    return null;
  }
  /* 联动随访：内置优先；自定义标签按行动时限推断（+N月→N月复查） */
  function followupFor(tag) {
    if (FOLLOWUP_LIB[tag]) return FOLLOWUP_LIB[tag];
    var cts = customTags();
    for (var i = 0; i < cts.length; i++) {
      if (cts[i].tag_name === tag && cts[i].action_deadline) {
        var m = /\+(\d+)月/.exec(cts[i].action_deadline);
        var months = m ? Number(m[1]) : 3;
        return { item: cts[i].action_item || cts[i].tag_name + ' 复查', months: months };
      }
    }
    return null;
  }

  /* =============================================================
   * 复查覆盖映射：KB tag → SNAP_SPEC 基础指标 code（v53）
   * 用于季度/年度报告中"基础指标行仅在当季复查覆盖 + 既往异常时显示"。
   * 多个 tag 取并集。
   * ============================================================= */
  var SNAP_CODE_BY_TAG = {
    '高血压':       ['bp'],
    '血压正常高值': ['bp'],
    '血脂异常':     ['ldl', 'tc', 'tg'],
    '血脂边缘升高': ['ldl', 'tc', 'tg'],
    'LDL-C未达标':  ['ldl'],
    'LDL-C严重超标':['ldl'],
    '低HDL':        ['tc'],
    '高尿酸':       ['ua'],
    '血糖异常':     ['fpg'],
    '糖耐量受损':   ['fpg'],
    '中心性肥胖':   ['waist', 'weight'],
    '超重':         ['weight'],
    '肥胖':         ['weight'],
    '偏瘦':         ['weight'],
    '颈动脉斑块':   ['ldl', 'tc'],
    '肝酶异常':     ['ggt'],
    '骨质疏松':     ['bmd'],
    '骨量减少':     ['bmd'],
    '维生素D不足':  ['vitd'],
    '肺结节风险':   ['cyfra21'],
    'CYFRA升高':    ['cyfra21'],
    '肾功能下降':   ['egfr']
  };

  /* 输入一组 KB 标签，返回覆盖的 SNAP_SPEC code 集合（去重，无序） */
  function snapCodesForTags(tags) {
    var out = {};
    (tags || []).forEach(function (t) {
      var codes = SNAP_CODE_BY_TAG[t];
      if (codes) codes.forEach(function (c) { out[c] = true; });
    });
    return Object.keys(out);
  }

  /* 单个 tag → codes（无结果返回空数组） */
  function snapCodesForTag(tag) {
    return (SNAP_CODE_BY_TAG[tag] || []).slice();
  }

  /* ---------- 外部暴露 ---------- */
  global.KB = {
    BRAND: BRAND,
    LEVEL: LEVEL,
    INDICATORS: INDICATORS,
    FFR: FFR,
    ADVICE: ADVICE,
    LIFESTYLE: LIFESTYLE,
    SEASON: SEASON,
    DIET_PRINCIPLES: DIET_PRINCIPLES,
    DIET_PRINCIPLES_COND: DIET_PRINCIPLES_COND,
    SAMPLE_MENU: SAMPLE_MENU,
    HIGH_PURINE: HIGH_PURINE,
    LIFESTYLE_INTERVENTION: LIFESTYLE_INTERVENTION,
    healthMessage: healthMessage,
    seasonOfMonth: seasonOfMonth,
    lookup: INDICATORS_lookup,
    rank: rank,
    /* --- v3.0 ASCVD 风险分层 --- */
    ASCVD_RISK_LEVELS: ASCVD_RISK_LEVELS,
    ASCVD_RISK_FACTORS: ASCVD_RISK_FACTORS,
    ASCVD_HIGH_RISK_FACTORS: ASCVD_HIGH_RISK_FACTORS,
    LDL_THRESHOLDS: LDL_THRESHOLDS,
    /* --- 季度报告扩展 --- */
    CHECKIN_DIM: CHECKIN_DIM,
    checkinLookup: checkinLookup,
    QUARTER_INSIGHT: QUARTER_INSIGHT,
    ACTION_LIB: ACTION_LIB,
    FOLLOWUP_LIB: FOLLOWUP_LIB,
    seasonShortLabel: seasonShortLabel,
    seasonMonthRange: seasonMonthRange,
    quarterMessage: quarterMessage,
    /* --- 文献知识库扩展 --- */
    LIT_KNOWLEDGE: LIT_KNOWLEDGE,
    litForTags: litForTags,
    /* --- v3.0 指标规则文字版 --- */
    RULE_TEXT: RULE_TEXT,
    /* --- v3.0 自定义指标/标签体系 --- */
    CUSTOM_KEYS: CUSTOM_KEYS,
    customIndicators: customIndicators,
    customTags: customTags,
    customSave: customSave,
    customLoad: customLoad,
    evalIndicator: evalIndicator,
    adviceFor: adviceFor,
    actionFor: actionFor,
    followupFor: followupFor,
    /* --- v53 复查覆盖：KB tag → SNAP_SPEC code --- */
    SNAP_CODE_BY_TAG: SNAP_CODE_BY_TAG,
    snapCodesForTag: snapCodesForTag,
    snapCodesForTags: snapCodesForTags
  };
})(window);
