/**
 * customer-manager.js — 客户数据管理（localStorage 持久化）
 * 对应《产品手册》"数据模型"：customers 数组，每条客户含完整服务周期字段。
 * 纯前端、离线优先；无云端依赖（Supabase 同步不在离线版范围内）。
 */
(function (global) {
  'use strict';

  var LS_CUSTOMERS = 'customers';          // 主表：客户列表（JSON 数组）
  var LS_KB = 'kb_data_v3';                // 可匹配规则版知识库（7 子表）
  var LS_REPORTS_CACHE = 'reports_cache';  // 已生成报告缓存（避免重复计算）

  function nowISO() { return new Date().toISOString(); }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blankCustomer(opts) {
    opts = opts || {};
    return {
      id: uid(),
      name: opts.name || '',
      phone: opts.phone || '',
      gender: opts.gender || '女',
      age: opts.age != null ? opts.age : '',
      height: opts.height != null ? opts.height : '',
      baseline_weight: opts.baseline_weight != null ? opts.baseline_weight : '',
      ex_freq: opts.ex_freq != null ? opts.ex_freq : '',              // 生活方式基线：每周运动次数（次/周）
      ex_min: opts.ex_min != null ? opts.ex_min : '',                 // 生活方式基线：每次运动时长（分钟）
      sleep_hours: opts.sleep_hours != null ? opts.sleep_hours : '',  // 生活方式基线：每日睡眠时长（小时）
      med_regular: opts.med_regular != null ? opts.med_regular : '',  // 生活方式基线：是否规律服药（是/否/空）
      ascvd_risk: opts.ascvd_risk || '',         // 【v3.0】ASCVD 风险等级（low/medium/high/very_high/ultra_high/空）
      ascvd_history: opts.ascvd_history || [],   // 【v3.0】ASCVD 病史（多选）
      ldl_baseline: opts.ldl_baseline != null ? opts.ldl_baseline : '',  // 【v3.0】LDL-C 基线值 mmol/L
      waist: opts.waist != null ? opts.waist : '',
      customer_type: opts.customer_type || 'B',      // A 类含 FFR / B 类不含
      core_issues: opts.core_issues || [],           // 核心健康问题列表
      enroll_date: opts.enroll_date || '',           // 入组日期（服务季度按此推算，无需单独填写）
      status: opts.status || '服务中',                // 服务中 / 已完成
      created_at: nowISO(),
      updated_at: nowISO(),
      // —— 服务周期各阶段数据 ——
      input: opts.input || blankInput(),             // 体检报告解读(A/B) 输入
      enrollment: opts.enrollment || blankEnrollment(), // 入组评估：访谈/体检方案
      exam: opts.exam || {},                         // 体检数据 + 专家会诊意见
      consultation: opts.consultation || [],         // 专家会诊（按专科）
      checkins: opts.checkins || {},                 // 月度打卡：按 "YYYY-MM" 独立存储
      retests: opts.retests || {},                   // 复查检查单：按 "Q*_YYYY" 独立存储（v53）
      quarters: opts.quarters || {},                 // 季度小结：按 "Q?_YYYY" 存储
      annuals: opts.annuals || {},                   // 年度总结：按 "YYYY" 存储
      reports: opts.reports || []                    // 历史报告存档：{at,type,html,name}
    };
  }

  function blankInput() {
    return {
      customer: { name: '', gender: '女', age: '', type: 'B', examDate: '', reportDate: '', phone: '' },
      metrics: {}, ffr: {}, narrative: {}, narrativeBlocks: null,
      customAppendix: [], consultation: [], baselineAB: '',
      showConsultation: true   // 报告是否包含「专家会诊建议」板块
    };
  }

  function blankEnrollment() {
    return {
      interview: { present: '', past: '', family: '', habit: '', demand: '' }, // 健康访谈
      examPlan: '',          // 体检方案
      baselineMetrics: {}    // 基线体检指标（入组时录入）
    };
  }

  /* ---------------- 读写 ---------------- */
  function list() {
    try { var a = JSON.parse(localStorage.getItem(LS_CUSTOMERS) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }

  function get(id) {
    return list().filter(function (c) { return c.id === id; })[0] || null;
  }

  function findByPhone(phone) {
    if (!phone) return null;
    return list().filter(function (c) { return (c.phone || '') === phone; })[0] || null;
  }

  var lastError = null;   // 最近一次存储写入错误（配额满等），供 UI 提示

  function recordErr(op, e) {
    lastError = { op: op, msg: (e && e.name === 'QuotaExceededError') ? '浏览器存储空间已满' : String((e && e.message) || e) };
    console.error('[存储写入失败]', op, lastError.msg);
  }

  function writeAll(arr) {
    try { localStorage.setItem(LS_CUSTOMERS, JSON.stringify(arr)); lastError = null; return true; }
    catch (e) { recordErr('save', e); return false; }
  }

  /* 就地清理各客户 reports[] 中超出 keep 份的旧报告正文（html 置空，元数据保留），返回清理份数 */
  function trimInPlace(arr, keep) {
    keep = keep == null ? 5 : Number(keep);
    var trimmed = 0;
    arr.forEach(function (c) {
      var rp = c.reports || [];
      for (var j = 0; j < rp.length - keep; j++) { if (rp[j] && rp[j].html) { rp[j].html = ''; trimmed++; } }
    });
    return trimmed;
  }

  function save(c) {
    var arr = list();
    c.updated_at = nowISO();
    var i = -1;
    for (var k = 0; k < arr.length; k++) { if (arr[k].id === c.id) { i = k; break; } }
    if (i >= 0) arr[i] = c; else arr.push(c);
    if (writeAll(arr)) return c;
    /* 配额写满自动降级：历史报告正文是最大体积来源，先全局清理（每客户保留 5 份）再重试一次，
       避免配额满时任何新客户/新数据都写不进去（表现为"客户消失""指标未保存"） */
    if (trimInPlace(arr, 5) > 0 && writeAll(arr)) return c;
    return c;
  }

  function remove(id) {
    var arr = list().filter(function (c) { return c.id !== id; });
    try { localStorage.setItem(LS_CUSTOMERS, JSON.stringify(arr)); lastError = null; }
    catch (e) { recordErr('remove', e); }
  }

  function upsertByPhone(phone, patch) {
    var c = findByPhone(phone) || blankCustomer({ phone: phone });
    Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
    return save(c);
  }

  /* ---------------- 迁移：旧 bz_customers → customers ---------------- */
  function migrateIfNeeded() {
    if (localStorage.getItem(LS_CUSTOMERS)) return;
    try {
      var old = JSON.parse(localStorage.getItem('bz_customers') || '[]');
      if (!Array.isArray(old) || !old.length) return;
      var arr = old.map(function (o) {
        var inp = o.input || {};
        var cm = (inp.customer) || {};
        var c = blankCustomer({
          name: cm.name, phone: cm.phone, gender: cm.gender, age: cm.age,
          customer_type: cm.type === 'A' ? 'A' : 'B',
          input: inp, checkins: o.checkins || {}, retests: o.retests || {},
          quarters: o.quarters || {},
          annuals: o.annuals || {}, reports: normalizeReports(o.reports)
        });
        c.id = o.id || c.id;
        c.created_at = o.createdAt || o.created_at || c.created_at;
        return c;
      });
      localStorage.setItem(LS_CUSTOMERS, JSON.stringify(arr));
    } catch (e) { /* 忽略迁移错误 */ }
  }

  function normalizeReports(r) {
    if (Array.isArray(r)) return r;
    if (r && typeof r === 'object') {
      var out = [];
      ['A', 'B'].forEach(function (t) { if (r[t] && r[t].at) out.push({ at: r[t].at, type: t }); });
      return out;
    }
    return [];
  }

  /* ---------------- 空白档案判定 ---------------- */
  /* 仅当客户没有任何实质性数据（连姓名/电话/体检指标/访谈/方案都没有）才算空白。
     blankCustomer() 自带的默认值（gender='女'、type='B'、status='服务中'）不计入。 */
  function isEmptyCustomer(c) {
    if (!c) return true;
    if (c.name || c.phone) return false;
    if (c.age != null && c.age !== '') return false;
    if (c.height || c.baseline_weight || c.waist) return false;
    if (c.ascvd_risk || c.ldl_baseline || (c.ascvd_history && c.ascvd_history.length)) return false;
    if (c.core_issues && c.core_issues.length) return false;
    if (c.enroll_date) return false;
    if (c.checkins && Object.keys(c.checkins).length) return false;
    if (c.retests && Object.keys(c.retests).length) return false;
    if (c.quarters && Object.keys(c.quarters).length) return false;
    if (c.annuals && Object.keys(c.annuals).length) return false;
    if (c.reports && c.reports.length) return false;
    if (c.consultation && c.consultation.length) return false;
    if (c.customAppendix && c.customAppendix.length) return false;
    if (c.input) {
      var inp = c.input;
      if (inp.metrics && Object.keys(inp.metrics).length) return false;
      if (inp.narrative && Object.keys(inp.narrative).length) return false;
      if (inp.ffr && Object.keys(inp.ffr).length) return false;
    }
    if (c.enrollment) {
      var en = c.enrollment;
      var iv = en.interview || {};
      if (iv.present || iv.past || iv.family || iv.habit || iv.demand) return false;
      if (en.examPlan) return false;
      if (en.baselineMetrics && Object.keys(en.baselineMetrics).length) return false;
    }
    return true;
  }

  /* ---------------- 导出 / 导入 ---------------- */
  function exportAll() {
    return JSON.stringify({ customers: list(), kb: knowledgeDump() }, null, 2);
  }
  function importAll(json) {
    var o = JSON.parse(json);
    if (o.customers) {
      try { localStorage.setItem(LS_CUSTOMERS, JSON.stringify(o.customers)); }
      catch (e) { recordErr('import', e); throw e; }
    }
    if (o.kb) {
      try { localStorage.setItem(LS_KB, JSON.stringify(o.kb)); }
      catch (e) { recordErr('import', e); throw e; }
    }
  }
  function knowledgeDump() {
    try { return JSON.parse(localStorage.getItem(LS_KB) || 'null'); } catch (e) { return null; }
  }

  /* ---------------- 存储诊断与维护 ----------------
     报告 HTML 是 localStorage 最大体积来源（每次生成 A/B 报告都会全文存档），
     无保护时配额写满会导致 save 静默失败 → 新客户数据未真正落盘。 */
  function storageInfo() {
    var arr = list();
    var json = JSON.stringify(arr);
    var reportBytes = 0, maxRep = 0;
    arr.forEach(function (c) {
      var rp = c.reports || [];
      if (rp.length > maxRep) maxRep = rp.length;
      rp.forEach(function (r) { if (r && r.html) reportBytes += r.html.length; });
    });
    return {
      customers: arr.length,
      totalKB: Math.round(json.length / 1024),
      reportKB: Math.round(reportBytes / 1024),
      maxReports: maxRep
    };
  }

  /* 删除客户某份历史报告（整条移除，释放存储空间）；返回是否成功 */
  function removeReport(custId, idx) {
    var arr = list(), ok = false;
    for (var k = 0; k < arr.length; k++) {
      if (arr[k].id === custId) {
        var rp = arr[k].reports || [];
        if (idx >= 0 && idx < rp.length) { rp.splice(idx, 1); arr[k].reports = rp; ok = true; }
        break;
      }
    }
    if (!ok) return false;
    try { localStorage.setItem(LS_CUSTOMERS, JSON.stringify(arr)); lastError = null; }
    catch (e) { recordErr('removeReport', e); return false; }
    return true;
  }

  /* 报告瘦身：每客户保留最近 keep 份报告的完整正文，更早报告的 html 置空（时间/类型/姓名等元数据保留），
     不删条目、不丢档案；返回被清除正文的份数。 */
  function trimReportsHtml(keep) {
    var arr = list();
    var trimmed = trimInPlace(arr, keep == null ? 5 : Number(keep));
    if (trimmed <= 0) return 0;
    return writeAll(arr) ? trimmed : 0;
  }

  global.Customers = {
    LS_CUSTOMERS: LS_CUSTOMERS, LS_KB: LS_KB, LS_REPORTS_CACHE: LS_REPORTS_CACHE,
    blankCustomer: blankCustomer, blankInput: blankInput, blankEnrollment: blankEnrollment,
    list: list, get: get, findByPhone: findByPhone, save: save, remove: remove,
    upsertByPhone: upsertByPhone, migrateIfNeeded: migrateIfNeeded,
    isEmptyCustomer: isEmptyCustomer,
    get lastError() { return lastError; },   // 实时读取最近一次写入错误（不能直接导出值快照）
    storageInfo: storageInfo, trimReportsHtml: trimReportsHtml, removeReport: removeReport,
    exportAll: exportAll, importAll: importAll
  };
})(window);
