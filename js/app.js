/* =============================================================
 * 健管师端主控制器 app.js（按《产品手册》8-Tab 架构重构）
 * 数据层：Customers（localStorage 'customers'）
 * 引擎：KB / RulesEngine / ExtractEngine / QuarterEngine / QuarterReport / ReportGen / SeasonMatcher
 * ============================================================= */
(function () {
  'use strict';
  var KB = window.KB, RE = window.RulesEngine, RG = window.ReportGen,
      QE = window.QuarterEngine, QR = window.QuarterReport, EX = window.ExtractEngine,
      CM = window.Customers, SM = window.SeasonMatcher, AR = window.AnnualReport;

  var state = { currentId: null, work: null, plan: null, quarter: null, annual: null, consultDraft: [] };
  var _pendingExtract = null;
  var _bkTimer = null, _bkRestored = false;   // 云端自动备份（防 localStorage 被清导致"隔天数据消失"）

  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  /* ================= 初始化 ================= */
  function init() {
    CM.migrateIfNeeded();
    hideStorageWarn();   // 每次加载重置存储告警横幅
    // 每个模块独立容错：单个模块异常不再拖垮其它 Tab 与初始渲染
    var binders = [bindTabs, bindTopbar, bindCust, bindEnroll, bindPlan, bindCheckin, bindRetest, bindQuarter, bindAnnual, bindTmpl, bindKB, bindModals];
    binders.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[初始化失败]', fn.name, e); }
    });
    renderCustPicker(); renderCustList();
    var first = CM.list()[0];
    if (first) selectCust(first.id); else state.work = CM.blankCustomer();
    // 若以 ?import= / #import= 链接打开（客户发来的打卡数据链接），自动导入
    try { autoImportFromURL(); } catch (e) { console.error('[URL 导入]', e); }
    // 本地无客户且云端有备份时自动拉回（防"数据隔天消失"，静默容错）
    try { tryCloudRestore(); } catch (e) { console.error('[云端恢复]', e); }
  }

  function selectCust(id) {
    state.currentId = id;
    state.work = CM.get(id) || CM.blankCustomer({ id: id });
    state.ckYearOffset = null;   // 切客户后让 renderCheckinView 重新归零到当前所属服务年度
    renderCustPicker();
    loadEnroll(); loadPlan(); loadQuarterForm(); renderCheckinView();
    /* v53 复查：切换客户后默认当前季度、刷新已上传列表 */
    var d = new Date();
    var qEl = $('retest-paste-q'), yEl = $('retest-paste-y'), qkeyEl = $('retest-paste-qkey');
    if (qEl) qEl.value = 'Q' + Math.floor(d.getMonth() / 3 + 1);
    if (yEl) yEl.value = d.getFullYear();
    if (qkeyEl) qkeyEl.textContent = (qEl ? qEl.value : 'Q?') + '_' + d.getFullYear();
    renderRetestList();
    /* v55 切换客户清空复查上传残留 */
    var uFile = $('retest-file'), uStat = $('retest-upload-status'), uPrev = $('retest-upload-preview');
    if (uFile) uFile.value = '';
    if (uStat) uStat.textContent = '';
    if (uPrev) uPrev.innerHTML = '';
    autoSyncCloud(true);   // 切换客户后自动静默同步该客户云端打卡，无需手动拉取
  }
  function saveWork() {
    if (state.work) { CM.save(state.work); renderCustList(); renderCustPicker(); }
    // 存储写入失败必须让用户知道：配额满时静默失败 = 数据"假保存"，刷新即丢。
    // 常驻顶部红色横幅（而非 3 秒 toast），直到某次保存成功才自动消失。
    if (CM.lastError) {
      showStorageWarn('⚠️ 保存失败：' + CM.lastError.msg + '。系统已自动清理历史报告正文以腾出空间；若仍失败，请立即「导出全部」备份，再到「客户管理 → 存储空间」手动清理或删除不需要的报告。');
    } else {
      hideStorageWarn();
      queueCloudBackup();   // 写入成功 → 防抖整体备份到云端，防"隔天消失"
    }
  }

  /* ---- 云端自动备份与恢复（第 46 轮）----
     背景：客户/报告存 localStorage，若浏览器清理/无痕窗口关闭/沙箱域重建，
     本地存储跨夜清空 → 表现为"数据隔天消失"。这里把整份客户档案定期上云，
     打开页面时若本地为空则自动拉回。 */
  function queueCloudBackup() {
    if (!window.CloudSync || !CloudSync.ready()) return;
    if (_bkTimer) clearTimeout(_bkTimer);
    _bkTimer = setTimeout(doCloudBackup, 2000);
  }
  function cloudBackupPayload() {
    var arr = CM.list();
    return {
      v: 1,
      at: new Date().toISOString(),
      customers: arr.map(function (c) {
        var copy = clone(c);
        /* 报告正文是最大体积来源，云端只保留每客户最近 5 份正文，更早仅元数据（与本地瘦身策略一致） */
        var rp = copy.reports || [];
        for (var j = 0; j < rp.length - 5; j++) { if (rp[j] && rp[j].html) rp[j].html = ''; }
        return copy;
      })
    };
  }
  function doCloudBackup() {
    _bkTimer = null;
    if (!window.CloudSync || !CloudSync.ready()) return;
    CloudSync.backupCustomers(cloudBackupPayload())
      .catch(function (e) { console.warn('[云端备份失败]', e && e.message); });
  }
  /* 本地无客户且此前未尝试恢复时，尝试从云端拉回备份；失败静默不打扰 */
  function tryCloudRestore() {
    if (_bkRestored || !window.CloudSync || !CloudSync.ready()) return;
    if (CM.list().length) return;
    _bkRestored = true;
    CloudSync.fetchCustomersBackup().then(function (bk) {
      var arr = bk && bk.payload && Array.isArray(bk.payload.customers) ? bk.payload.customers : [];
      if (!arr.length) return;
      CM.importAll(JSON.stringify({ customers: arr }));
      var n = CM.list().length;
      if (!n) return;
      renderCustList(); renderCustPicker();
      selectCust(CM.list()[0].id);
      showToast('☁️ 检测到本地客户数据为空，已从云端备份恢复 ' + n + ' 位客户（备份于 ' + (bk.at || '').slice(0, 10) + '）', true);
    }).catch(function (e) { console.warn('[云端恢复失败]', e && e.message); });
  }
  function showStorageWarn(msg) {
    var w = $('storage-warn');
    if (!w) {
      w = document.createElement('div'); w.id = 'storage-warn';
      w.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:10000;max-width:92vw;padding:10px 18px;border-radius:10px;font-size:13.5px;line-height:1.6;background:#c0392b;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.25);text-align:center;';
      document.body.appendChild(w);
    }
    w.textContent = msg; w.style.display = 'block';
  }
  function hideStorageWarn() {
    var w = $('storage-warn');
    if (w) w.style.display = 'none';
  }

  /* ================= Tab 切换 ================= */
  function bindTabs() {
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });
  }
  function switchTab(name) {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'checkin') autoSyncCloud(false);   // 进入月度打卡页自动同步云端，无需手动点「拉取打卡」
  }
  /* 全局轻提示（保存成功等），3 秒自动消失 */
  function showToast(msg, ok) {
    var t = document.getElementById('app-toast');
    if (!t) {
      t = document.createElement('div'); t.id = 'app-toast';
      t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:9999;padding:12px 22px;border-radius:10px;font-size:14px;box-shadow:0 4px 18px rgba(0,0,0,.18);transition:opacity .3s;max-width:86vw;';
      document.body.appendChild(t);
    }
    t.style.background = ok === false ? '#fdecec' : '#e8f7ee';
    t.style.color = ok === false ? '#c0392b' : '#1e7a41';
    t.style.border = '1px solid ' + (ok === false ? '#f2b8b5' : '#b7e2c6');
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(function () { t.style.opacity = '0'; }, 3000);
  }

  /* ================= 顶栏：当前客户 ================= */
  function bindTopbar() {
    $('btn-new-cust').addEventListener('click', newCust);
    $('btn-new-cust2').addEventListener('click', newCust);
    $('btn-open-mgr').addEventListener('click', function () { switchTab('cust'); });
    $('cur-cust').addEventListener('change', function () { if (this.value) selectCust(this.value); });
  }
  function renderCustPicker() {
    var sel = $('cur-cust'); if (!sel) return;
    var list = CM.list();
    var cur = state.currentId;
    sel.innerHTML = '<option value="">— 选择客户 —</option>' + list.map(function (c) {
      var nm = (c.name || '未命名') + (c.phone ? '（' + c.phone + '）' : '');
      return '<option value="' + c.id + '"' + (c.id === cur ? ' selected' : '') + '>' + esc(nm) + '</option>';
    }).join('');
  }

  /* ================= ① 客户管理 ================= */
  function bindCust() {
    $('cust-search').addEventListener('input', renderCustList);
    $('btn-export-all').addEventListener('click', function () {
      var blob = new Blob([CM.exportAll()], { type: 'application/json' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a');
      a.href = url; a.download = '客户全量备份_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $('btn-import-all').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { try { CM.importAll(r.result); renderCustList(); renderCustPicker(); alert('导入成功'); } catch (e) { alert('导入失败：' + e.message); } };
      r.readAsText(f); this.value = '';
    });
    /* 存储空间诊断与维护：防止 localStorage 配额写满导致"假保存"丢客户 */
    $('btn-storage').addEventListener('click', openStoragePanel);
  }
  function openStoragePanel() {
    var info = CM.storageInfo();
    var est = info.totalKB > 4000 ? '极高' : (info.totalKB > 2500 ? '偏高' : '正常');
    var warn = info.totalKB > 4000;
    $('storage-info').innerHTML =
      '<p><b>数据体积：</b>' + info.totalKB + ' KB（客户 ' + info.customers + ' 位）　<b>风险：' + est + '</b>' + (warn ? '　<span style="color:#c0392b">⚠️ 已接近浏览器约 5MB 上限，随时可能保存失败丢数据！</span>' : '') + '</p>' +
      '<p><b>其中历史报告正文占：</b>' + info.reportKB + ' KB（单客户最多 ' + info.maxReports + ' 份）。报告全文是占用大头，建议定期清理。</p>' +
      '<div class="row"><button class="btn small" id="btn-trim-reports">清理历史报告正文（每客户保留最近 5 份）</button>' +
      '<span class="hint" style="align-self:center">清理后旧报告仅保留日期/类型记录，档案不受影响；如需完整报告可在「解读/报告」页重新生成。</span></div>' +
      '<div class="hint" style="margin-top:8px">如数据仍未保存成功，请先点「导出全部」备份，再清理或减少报告生成。</div>';
    $('storage-modal').style.display = 'flex';
    $('btn-trim-reports').addEventListener('click', function () {
      var n = CM.trimReportsHtml(5);
      renderCustList(); renderCustPicker();
      $('storage-info').innerHTML = '<p style="color:#1e7a41">已清理 ' + n + ' 份历史报告正文。当前数据体积 ' + CM.storageInfo().totalKB + ' KB。</p>' +
        '<div class="hint">提示：保存失败多为存储空间已满所致，清理后即可恢复正常保存。请确认之前丢失的客户是否已重新建档。</div>';
      if (n > 0) hideStorageWarn();
    });
  }
  /* 服务进度：按手册服务旅程（建档→访谈→方案→解读→A/B→打卡→季度→年度）自动判定 */
  function serviceProgress(c) {
    if (!c) return { tags: [], next: '' };
    var en = c.enrollment || {}, inpt = c.input || {};
    var hasInterview = en.interview && [en.interview.present, en.interview.past, en.interview.family, en.interview.habit, en.interview.demand].some(function (v) { return v && String(v).trim(); });
    var hasPlan = !!(en.examPlan && String(en.examPlan).trim());
    var hasMetrics = Object.keys(inpt.metrics || {}).some(function (k) { var v = inpt.metrics[k]; return v !== '' && v != null && String(v).trim() !== ''; });
    var hasConsult = (c.consultation || []).some(function (x) { return x && (x.text || x.dept || x.diagnosis || x.advice); });
    var hasAB = (c.reports || []).length > 0;
    var ck = Object.keys(c.checkins || {}).length, qn = Object.keys(c.quarters || {}).length, an = Object.keys(c.annuals || {}).length;

    var tags = [];
    if (c.name || c.phone) tags.push('已建档');
    if (hasInterview) tags.push('已访谈');
    if (hasPlan) tags.push('已出方案');
    if (hasMetrics || hasConsult) tags.push('已解读');
    if (hasAB) tags.push('已出A/B');
    if (ck) tags.push('打卡' + ck + '月');
    if (qn) tags.push('季度' + qn);
    if (an) tags.push('年度' + an);

    var next = '';
    if (!c.name && !c.phone) next = '填写基本信息';
    else if (!hasInterview) next = '进行健康访谈';
    else if (!hasPlan) next = '制定体检方案';
    else if (!hasMetrics && !hasConsult) next = '解读体检报告/会诊';
    else if (!hasAB) next = '生成A/B版报告';
    else if (!ck) next = '发送月度打卡';
    else if (!qn) next = '生成季度报告';
    else if (!an) next = '生成年度报告';
    else next = '持续服务中';
    return { tags: tags, next: next };
  }
  function renderCustList() {
    var host = $('cust-list'); if (!host) return;
    var q = ($('cust-search').value || '').trim();
    var list = CM.list().slice().sort(function (a, b) { return (b.updated_at || 0) < (a.updated_at || 0) ? -1 : 1; });
    if (q) list = list.filter(function (c) { return (c.name || '').indexOf(q) >= 0 || (c.phone || '').indexOf(q) >= 0; });
    var total = CM.list().length, active = CM.list().filter(function (c) { return c.status === '服务中'; }).length,
        done = CM.list().filter(function (c) { return c.status === '已完成'; }).length;
    $('cust-stats').innerHTML = '共 <b>' + total + '</b> 位客户 · 服务中 <b>' + active + '</b> · 已完成 <b>' + done + '</b> · 待出报告（无 A/B 报告） <b>' +
      CM.list().filter(function (c) { return !c.reports || !c.reports.length; }).length + '</b>';
    if (!list.length) { host.innerHTML = '<div class="hint">暂无客户档案。点右上角「＋新建」创建。</div>'; return; }
    host.innerHTML = '';
    list.forEach(function (c) {
      var card = el('div', 'cust-card' + (c.customer_type === 'A' ? '' : ' b'));
      var upd = c.updated_at ? new Date(c.updated_at).toLocaleString('zh-CN', { hour12: false }) : '';
      var nC = Object.keys(c.checkins || {}).length, nQ = Object.keys(c.quarters || {}).length;
    var rep = (c.reports || []).map(function (rp, i) {
      return '<span class="rep-chip" data-id="' + c.id + '" data-i="' + i + '">' + (rp.type === 'A' ? 'A版' : 'B版') + ' ' + esc(rp.at) + '</span>';
    }).join('');
    var prog = serviceProgress(c);
    card.innerHTML =
      '<div class="cust-name">' + esc(c.name || '未命名') + '</div>' +
      '<div class="cust-meta">' + esc(c.gender || '') + ' · ' + (c.age != null && c.age !== '' ? c.age + '岁' : '') +
      (c.phone ? ' · ' + esc(c.phone) : '') + ' · 更新 ' + esc(upd) + '</div>' +
      '<div class="cust-track"><span class="trk-label">服务进度</span>' +
      prog.tags.map(function (t) { return '<span class="trk-step on">' + esc(t) + '</span>'; }).join('') +
      '<span class="trk-next">下一步：' + esc(prog.next) + '</span></div>' +
      '<div class="cust-tags">' +
          '<span class="cust-tag ' + (c.customer_type === 'A' ? '' : 'b') + '">' + (c.customer_type === 'A' ? 'A类(含FFR)' : 'B类') + '</span>' +
          (nC ? '<span class="cust-tag">打卡 ' + nC + ' 月</span>' : '') +
          (nQ ? '<span class="cust-tag q">季度 ' + nQ + '</span>' : '') + rep +
        '</div>';
      var acts = el('div', 'cust-acts');
      [['打开', function () { selectCust(c.id); switchTab('enroll'); }],
       ['A版报告', function () { selectCust(c.id); generatePlan('A'); switchTab('plan'); }],
       ['B版报告', function () { selectCust(c.id); generatePlan('B'); switchTab('plan'); }],
       ['季度小结', function () { selectCust(c.id); switchTab('quarter'); }],
       ['年度总结', function () { selectCust(c.id); switchTab('annual'); }],
       ['发打卡', function () { selectCust(c.id); shareCheckin(c); }],
       ['历史报告', function () { selectCust(c.id); openReportList(c.id); }],
       ['导出', function () { exportCust(c.id); }],
       ['删除', function () { deleteCust(c.id); }]
      ].forEach(function (pair) {
        var b = el('button', 'btn small' + (pair[0] === '打开' ? ' primary' : ''), pair[0]); b.type = 'button';
        b.addEventListener('click', pair[1]); acts.appendChild(b);
      });
      card.appendChild(acts);
      host.appendChild(card);
    });
    host.querySelectorAll('.rep-chip').forEach(function (chip) {
      chip.addEventListener('click', function () { openReportHistory(chip.dataset.id, Number(chip.dataset.i)); });
    });
  }
  function newCust() {
    // 清理遗留的空白档案（从未录入任何数据就放弃的），避免列表堆积"未命名"卡片。
    // 判定交给 CM.isEmptyCustomer：录过体检指标/访谈/方案/报告/打卡等任一实质数据都保留。
    CM.list().forEach(function (c) { if (CM.isEmptyCustomer(c)) CM.remove(c.id); });
    state.work = CM.blankCustomer();
    state.currentId = state.work.id;
    saveWork(); selectCust(state.work.id); switchTab('enroll');
    $('enroll-hint').textContent = '已新建空白档案，录入后点「保存入组评估」。';
  }
  function deleteCust(id) {
    if (!confirm('确定删除该客户档案？不可撤销。')) return;
    CM.remove(id); if (state.currentId === id) state.currentId = null;
    renderCustList(); renderCustPicker();
  }
  function exportCust(id) {
    var c = CM.get(id); if (!c) return;
    var blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob); var a = document.createElement('a');
    a.href = url; a.download = '客户档案_' + (c.name || '客户') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ================= ② 入组评估 ================= */
  function bindEnroll() {
    ['e-name', 'e-gender', 'e-age', 'e-phone', 'e-height', 'e-weight', 'e-waist', 'e-type', 'e-enroll', 'e-status', 'e-issues',
     'e-present', 'e-past', 'e-family', 'e-habit', 'e-demand', 'e-plan'].forEach(function (id) {
      var i = $(id); if (i) i.addEventListener('input', syncEnroll);
    });
    $('btn-add-consult').addEventListener('click', function () {
      state.consultDraft.push({ dept: '', text: '' }); renderConsult(); syncEnroll();
    });
    $('btn-save-enroll').addEventListener('click', function () {
      syncEnroll(); saveWork();
      var nm = state.work.name || '未命名';
      showToast('✅ 已保存「' + nm + '」的入组评估');
      $('enroll-hint').textContent = '已保存「' + nm + '」的入组评估。';
      // 保存成功后返回客户管理主界面，可直接看到新客户卡片
      setTimeout(function () { switchTab('cust'); }, 900);
    });
    renderConsult();
  }
  function renderConsult() {
    var host = $('e-consult-list'); if (!host) return; host.innerHTML = '';
    state.consultDraft.forEach(function (c, i) {
      var row = el('div', 'row');
      row.innerHTML = '<input class="field" placeholder="专科（如内分泌科）" value="' + esc(c.dept) + '">' +
        '<input class="field wide" placeholder="会诊意见" value="' + esc(c.text) + '">' +
        '<button class="btn small gray">删</button>';
      row.querySelector('input').addEventListener('input', function () { c.dept = this.value; });
      row.querySelector('.wide').addEventListener('input', function () { c.text = this.value; });
      row.querySelector('button').addEventListener('click', function () { state.consultDraft.splice(i, 1); renderConsult(); syncEnroll(); });
      host.appendChild(row);
    });
  }
  function loadEnroll() {
    var c = state.work; if (!c) return;
    $('e-name').value = c.name || ''; $('e-gender').value = c.gender || '女';
    $('e-age').value = (c.age != null && c.age !== '') ? c.age : ''; $('e-phone').value = c.phone || '';
    $('e-height').value = c.height != null ? c.height : ''; $('e-weight').value = c.baseline_weight != null ? c.baseline_weight : '';
    $('e-exfreq').value = c.ex_freq != null ? c.ex_freq : ''; $('e-exmin').value = c.ex_min != null ? c.ex_min : '';
    $('e-sleep').value = c.sleep_hours != null ? c.sleep_hours : ''; $('e-med').value = c.med_regular || '';
    $('e-ascvd').value = c.ascvd_risk || ''; $('e-ldlbase').value = c.ldl_baseline != null ? c.ldl_baseline : '';
    var hxSel = $('e-hx'), hx = c.ascvd_history || [];
    [].forEach.call(hxSel.options, function (o) { o.selected = hx.indexOf(o.value) >= 0; });
    $('e-waist').value = c.waist != null ? c.waist : ''; $('e-type').value = c.customer_type || 'B';
    $('e-enroll').value = c.enroll_date || ''; $('e-status').value = c.status || '服务中';
    $('e-issues').value = (c.core_issues || []).join('、');
    var en = c.enrollment || {};
    $('e-present').value = (en.interview && en.interview.present) || '';
    $('e-past').value = (en.interview && en.interview.past) || '';
    $('e-family').value = (en.interview && en.interview.family) || '';
    $('e-habit').value = (en.interview && en.interview.habit) || '';
    $('e-demand').value = (en.interview && en.interview.demand) || '';
    $('e-plan').value = en.examPlan || '';
    state.consultDraft = (c.consultation || []).map(function (x) { return clone(x); });
    renderConsult();
  }
  function syncEnroll() {
    var c = state.work; if (!c) return;
    c.name = $('e-name').value; c.gender = $('e-gender').value;
    c.age = $('e-age').value; c.phone = $('e-phone').value;
    c.height = $('e-height').value; c.baseline_weight = $('e-weight').value; c.waist = $('e-waist').value;
    c.ex_freq = $('e-exfreq').value; c.ex_min = $('e-exmin').value; c.sleep_hours = $('e-sleep').value; c.med_regular = $('e-med').value;
    c.ascvd_risk = $('e-ascvd').value; c.ldl_baseline = $('e-ldlbase').value;
    c.ascvd_history = [].filter.call($('e-hx').options, function (o) { return o.selected; }).map(function (o) { return o.value; });
    c.customer_type = $('e-type').value; c.enroll_date = $('e-enroll').value;
    c.status = $('e-status').value;
    c.core_issues = $('e-issues').value.split(/[，,、]/).map(function (s) { return s.trim(); }).filter(Boolean);
    c.enrollment = c.enrollment || CM.blankEnrollment();
    c.enrollment.interview = { present: $('e-present').value, past: $('e-past').value, family: $('e-family').value, habit: $('e-habit').value, demand: $('e-demand').value };
    c.enrollment.examPlan = $('e-plan').value;
    c.consultation = clone(state.consultDraft);
    // 同步到体检报告解读的客户信息
    c.input = c.input || CM.blankInput();
    c.input.consultation = clone(c.consultation); // 专家会诊内容进入报告输入（reportBody 读取 input.consultation）
    c.input.customer = { name: c.name, gender: c.gender, age: c.age, type: c.customer_type, examDate: c.input.customer.examDate || '', reportDate: c.input.customer.reportDate || '', phone: c.phone, ascvd_risk: c.ascvd_risk || '', ldl_baseline: c.ldl_baseline != null ? c.ldl_baseline : '' };
  }

  /* ================= ③ 体检报告解读（A/B） ================= */
  function bindPlan() {
    buildMetricsForm(); buildFFRForm(); buildNarrativeForm(); buildAppendixForm();
    ['p-type', 'p-examdate', 'p-reportdate'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        if (!state.work) return;
        state.work.input.customer.type = $('p-type').value;
        state.work.input.customer.examDate = $('p-examdate').value;
        state.work.input.customer.reportDate = $('p-reportdate').value;
      });
    });
    $('p-consult').addEventListener('change', function () {
      if (!state.work) return;
      state.work.input.showConsultation = this.checked;
      saveWork();
    });
    // 提取
    var fileInput = $('ext-file'), runBtn = $('btn-ext-run'), pasteArea = $('ext-paste'),
        statusEl = $('ext-status'), reviewEl = $('ext-review'), actionsEl = $('ext-actions');
    $('btn-ext-paste').addEventListener('click', function () { pasteArea.style.display = 'block'; });
    runBtn.addEventListener('click', function () {
      var file = fileInput.files && fileInput.files[0];
      var text = (pasteArea.value || '').trim();
      if (!file && !text) { statusEl.className = 'ext-status err'; statusEl.textContent = '请选择文件或粘贴文字。'; return; }
      statusEl.className = 'ext-status'; statusEl.textContent = '处理中…'; reviewEl.innerHTML = ''; actionsEl.style.display = 'none';
      var p = file ? EX.fileToText(file, function (s) { statusEl.textContent = s; }) : Promise.resolve({ text: text, method: 'paste' });
      p.then(function (res) {
        var txt = res && res.text, method = res && res.method;
        if (!txt || !txt.trim()) { statusEl.className = 'ext-status err'; statusEl.textContent = file ? '❌ 未读取到文字（扫描图需联网 OCR，建议粘贴文字）。' : '未读取到文字。'; return; }
        var payload = EX.extract(txt); _pendingExtract = payload; EX.renderReview(reviewEl, payload);
        var n = (payload.results || []).length;
        statusEl.className = n > 0 ? 'ext-status ok' : 'ext-status err';
        statusEl.textContent = n > 0 ? ('✅ 提取成功（' + EX.methodLabel(method) + '），识别 ' + n + ' 项，请核对后「应用到建档」。') : '⚠️ 已读取但未识别到已知指标，建议粘贴文字或手动录入。';
        actionsEl.style.display = 'flex';
      }).catch(function (e) { statusEl.className = 'ext-status err'; statusEl.textContent = '❌ 提取失败：' + (e && e.message ? e.message : e); });
    });
    $('btn-ext-apply').addEventListener('click', function () { if (_pendingExtract) { applyExtraction(_pendingExtract); statusEl.textContent = '已应用到建档指标。'; } });
    $('btn-ext-clear').addEventListener('click', function () { _pendingExtract = null; reviewEl.innerHTML = ''; actionsEl.style.display = 'none'; statusEl.textContent = ''; fileInput.value = ''; pasteArea.value = ''; });

    // 上传已有 A/B 版 → 基线参考
    var abFile = $('ab-file'), abRun = $('btn-ab-run'), abText = $('ab-text');
    abRun.addEventListener('click', function () {
      var f = abFile.files && abFile.files[0]; if (!f) { abText.style.display = 'block'; abText.value = '请先选择 A/B 版文件。'; return; }
      abText.style.display = 'block'; abText.value = '正在提取 A/B 版正文…';
      EX.fileToText(f, function (s) { abText.value = s; }).then(function (res) {
        var txt = (res && res.text) || ''; state.work.input.baselineAB = txt; abText.value = txt; saveWork();
        abText.value = txt && txt.trim() ? ('✅ 已提取 ' + txt.length + ' 字作为季度基线参考，生成季度报告时自动纳入。\n\n' + txt) : '⚠️ 未识别到文字（扫描图需联网 OCR）。';
      }).catch(function (e) { abText.value = '❌ 提取失败：' + (e && e.message ? e.message : e); });
    });

    // 叙述 / 附录上传
    var narFile = $('nar-file');
    var narRun = $('btn-nar-run');
    if (narRun) narRun.addEventListener('click', function () { narFile.click(); });
    narFile.addEventListener('change', function () {
      var f = narFile.files && narFile.files[0]; if (!f) return;
      $('nar-status').className = 'ext-status'; $('nar-status').textContent = '解析中…';
      EX.fileToText(f, function (s) { $('nar-status').textContent = s; }).then(function (res) {
        var struct = EX.structureDoc(res.text || '');
        /* 上传即刷新：与已有块同名（忽略编号前缀差异）的用新解析正文替换，
           避免旧版本解析残留（无编号/无 vMerge 回填）混入导致报告与最新解析不一致，
           也避免重复上传同一文档时内容叠加；文档中新增的章节照常追加。 */
        var normTitle = function (t) { return String(t || '').trim().replace(/^[一二三四五六七八九十百\d]+\s*[、.．:：]\s*/, '').trim(); };
        var upsert = function (list, items) {
          items.forEach(function (s) {
            var key = normTitle(s.title);
            var hit = -1;
            for (var i = 0; i < list.length; i++) { if (key && normTitle(list[i].title) === key) { hit = i; break; } }
            if (hit >= 0) list[hit] = { title: s.title, body: s.body };
            else list.push({ title: s.title, body: s.body });
          });
          /* 去掉历史重复上传遗留的同名重复块（保留首个，即刚被新解析刷新的那条） */
          var seen = {};
          for (var i = 0; i < list.length; i++) {
            var k = normTitle(list[i].title);
            if (!k) continue;
            if (seen[k]) { list.splice(i, 1); i--; } else seen[k] = 1;
          }
          return list;
        };
        state.work.input.narrativeBlocks = upsert(state.work.input.narrativeBlocks || [], struct.narrative);
        state.work.input.customAppendix = upsert(state.work.input.customAppendix || [], struct.appendix);
        buildNarrativeForm(); buildAppendixForm(); saveWork();
        $('nar-status').className = 'ext-status ok';
        $('nar-status').textContent = '✅ 叙述 ' + struct.narrative.length + ' 章 + 附录 ' + struct.appendix.length + ' 章，可核对后生成报告。';
      }).catch(function (e) { $('nar-status').className = 'ext-status err'; $('nar-status').textContent = '❌ 失败：' + (e && e.message ? e.message : e); });
      narFile.value = '';
    });

    $('btn-gen-plan').addEventListener('click', function () { generatePlan($('p-type').value); });
    $('btn-plan-word').addEventListener('click', function () {
      if (!state.plan) { alert('请先生成报告'); return; }
      RG.exportDocx(state.plan.result, state.plan.input).catch(function (e) {
        console.warn('docx 导出失败，降级为 .doc：', e);
        RG.exportWord(state.plan.result, state.plan.input);
      });
    });
    $('btn-plan-html').addEventListener('click', function () { if (state.plan) exportHtml('体检报告解读汇总及健康规划_' + state.plan.input.customer.name + '_' + state.plan.input.customer.type + '版', state.plan.html); else alert('请先生成报告'); });
    $('btn-plan-print').addEventListener('click', function () { if (state.plan) printHtml(state.plan.html); else alert('请先生成报告'); });
  }
  function buildMetricsForm() {
    var host = $('metrics-form'); if (!host) return; host.innerHTML = '';
    var groups = {};
    KB.INDICATORS.forEach(function (ind) { if (ind.kind === 'derived') return; (groups[ind.system] = groups[ind.system] || []).push(ind); });
    Object.keys(groups).forEach(function (sys) {
      var g = el('div', 'metric-group'); g.appendChild(el('div', 'metric-group-h', sys));
      var grid = el('div', 'metric-grid');
      groups[sys].forEach(function (ind) { grid.appendChild(metricField(ind)); });
      g.appendChild(grid); host.appendChild(g);
    });
    /* v3.0 自定义指标补录：与预设指标同等展示与判定 */
    var customs = KB.customIndicators();
    if (customs.length) {
      var g2 = el('div', 'metric-group'); g2.appendChild(el('div', 'metric-group-h', '自定义指标'));
      var grid2 = el('div', 'metric-grid');
      customs.forEach(function (ind) { grid2.appendChild(customMetricField(ind)); });
      g2.appendChild(grid2); host.appendChild(g2);
    }
  }
  function customMetricField(ind) {
    var wrap = el('label', 'mf');
    wrap.appendChild(el('span', 'mf-label', esc(ind.indicator_name || ind.indicator_code) + (ind.indicator_unit ? ' <i>(' + esc(ind.indicator_unit) + ')</i>' : '') + ' <i class="mf-tag">自定义</i>'));
    var input;
    if (ind.indicator_type === 'choice') {
      input = el('select');
      var opts = ind.choices || [];
      if (!opts.length) { var op0 = el('option'); op0.value = ''; op0.textContent = '—'; input.appendChild(op0); }
      opts.forEach(function (o) { var op = el('option'); op.value = o.label; op.textContent = o.label; input.appendChild(op); });
    } else if (ind.indicator_type === 'text') {
      input = el('input'); input.type = 'text';
    } else {
      input = el('input'); input.type = 'number'; input.step = 'any';
    }
    input.dataset.code = ind.indicator_code;
    input.addEventListener('input', function () {
      if (!state.work) return;
      state.work.input.metrics[ind.indicator_code] = input.value;
      saveWork();
    });
    wrap.appendChild(input); return wrap;
  }
  function metricField(ind) {
    var wrap = el('label', 'mf');
    wrap.appendChild(el('span', 'mf-label', ind.label + (ind.unit ? ' <i>(' + ind.unit + ')</i>' : '')));
    var input;
    if (ind.kind === 'select') {
      input = el('select'); ind.options.forEach(function (o) { var op = el('option'); op.value = o.value; op.textContent = o.label; input.appendChild(op); });
    } else { input = el('input'); input.type = 'number'; input.step = 'any'; }
    input.dataset.code = ind.code;
    input.addEventListener('input', function () {
      if (!state.work) return;
      state.work.input.metrics[ind.code] = input.value;
      if (ind.code === 'weight' || ind.code === 'height' || ind.code === 'sbp' || ind.code === 'dbp') updateDerived();
      saveWork();
    });
    wrap.appendChild(input); return wrap;
  }
  function buildFFRForm() {
    var host = $('ffr-form'); if (!host) return; host.innerHTML = '';
    KB.FFR.vessels.forEach(function (v) {
      var wrap = el('label', 'mf'); wrap.appendChild(el('span', 'mf-label', v.label));
      var input = el('input'); input.type = 'number'; input.step = 'any'; input.placeholder = '≥0.8 正常'; input.dataset.code = v.code;
      input.addEventListener('input', function () { if (state.work) { state.work.input.ffr[v.code] = input.value; saveWork(); } });
      wrap.appendChild(input); host.appendChild(wrap);
    });
  }
  function updateDerived() {
    var m = state.work ? state.work.input.metrics : {}, h = m.height, w = m.weight, box = $('derived-box');
    var html = '';
    if (w && h) html += '派生 BMI：<b>' + (Number(w) / Math.pow(Number(h) / 100, 2)).toFixed(2) + '</b> kg/m²　';
    if (m.sbp && m.dbp) html += '综合血压：<b>' + m.sbp + '/' + m.dbp + '</b> mmHg';
    if (box) box.innerHTML = html ? ('<span class="derived-h">自动计算：</span>' + html) : '';
  }
  function buildNarrativeForm() {
    var host = $('narr-form'); if (!host || !state.work) return; host.innerHTML = '';
    var nb = state.work.input.narrativeBlocks || (state.work.input.narrativeBlocks = []);
    nb.forEach(function (b, i) {
      var block = el('div', 'card'); block.style.margin = '8px 0';
      block.innerHTML = '<div class="row">' +
        '<button class="btn small gray" title="上移">↑</button><button class="btn small gray" title="下移">↓</button>' +
        '<input class="field" placeholder="章节标题（如：冠脉与全身血管）" value="' + esc(b.title) + '">' +
        '<button class="btn small gray">删</button></div>' +
        '<textarea class="field wide" rows="3" placeholder="章节正文">' + esc(b.body) + '</textarea>';
      var btns = block.querySelectorAll('button');
      block.querySelector('input').addEventListener('input', function () { b.title = this.value; });
      block.querySelector('textarea').addEventListener('input', function () { b.body = this.value; });
      btns[0].addEventListener('click', function () { if (i > 0) { nb[i - 1] = nb.splice(i, 1, nb[i - 1])[0]; buildNarrativeForm(); saveWork(); } });
      btns[1].addEventListener('click', function () { if (i < nb.length - 1) { nb[i + 1] = nb.splice(i, 1, nb[i + 1])[0]; buildNarrativeForm(); saveWork(); } });
      btns[2].addEventListener('click', function () { nb.splice(i, 1); buildNarrativeForm(); saveWork(); });
      host.appendChild(block);
    });
    var add = el('button', 'btn small gray', '＋添加叙述章节'); add.type = 'button';
    add.addEventListener('click', function () { nb.push({ title: '', body: '' }); buildNarrativeForm(); });
    host.appendChild(add);
  }
  function buildAppendixForm() {
    var host = $('appendix-form'); if (!host || !state.work) return; host.innerHTML = '';
    var ap = state.work.input.customAppendix || (state.work.input.customAppendix = []);
    ap.forEach(function (b, i) {
      var block = el('div', 'card'); block.style.margin = '8px 0';
      var dupNote = (RG && RG.isDupBuiltin && b.title &&
        RG.isDupBuiltin(b.title, (RG.builtinAppendixA || []).concat(RG.builtinAppendixB || [])))
        ? '<span style="margin-left:8px;color:#1a7f37;font-size:12px">· 与系统内置附录同名，生成报告时将以本内容替换内置模板</span>' : '';
      block.innerHTML = '<div class="row">' +
        '<button class="btn small gray" title="上移">↑</button><button class="btn small gray" title="下移">↓</button>' +
        '<input class="field" placeholder="附录标题（如：附录1 饮食原则）" value="' + esc(b.title) + '">' + dupNote +
        '<button class="btn small gray">删</button></div>' +
        '<textarea class="field wide" rows="3" placeholder="附录正文">' + esc(b.body) + '</textarea>';
      var btns = block.querySelectorAll('button');
      block.querySelector('input').addEventListener('input', function () { b.title = this.value; });
      block.querySelector('textarea').addEventListener('input', function () { b.body = this.value; });
      btns[0].addEventListener('click', function () { if (i > 0) { ap[i - 1] = ap.splice(i, 1, ap[i - 1])[0]; buildAppendixForm(); saveWork(); } });
      btns[1].addEventListener('click', function () { if (i < ap.length - 1) { ap[i + 1] = ap.splice(i, 1, ap[i + 1])[0]; buildAppendixForm(); saveWork(); } });
      btns[2].addEventListener('click', function () { ap.splice(i, 1); buildAppendixForm(); saveWork(); });
      host.appendChild(block);
    });
    var add = el('button', 'btn small gray', '＋添加附录'); add.type = 'button';
    add.addEventListener('click', function () { ap.push({ title: '', body: '' }); buildAppendixForm(); });
    host.appendChild(add);
  }
  function loadPlan() {
    if (!state.work) return;
    var c = state.work.input.customer;
    $('p-type').value = c.type || 'B'; $('p-examdate').value = c.examDate || ''; $('p-reportdate').value = c.reportDate || '';
    $('p-consult').checked = state.work.input.showConsultation !== false;
    Object.keys(state.work.input.metrics).forEach(function (code) {
      var inp = document.querySelector('#metrics-form [data-code="' + code + '"]');
      if (inp) inp.value = state.work.input.metrics[code];
    });
    Object.keys(state.work.input.ffr).forEach(function (code) {
      var inp = document.querySelector('#ffr-form [data-code="' + code + '"]');
      if (inp) inp.value = state.work.input.ffr[code];
    });
    $('ab-text').value = state.work.input.baselineAB || '';
    buildNarrativeForm(); buildAppendixForm(); updateDerived();
  }
  function applyExtraction(payload) {
    var m = state.work.input.metrics;
    var ic = state.work.input.customer || (state.work.input.customer = {});
    (payload.results || []).forEach(function (r) {
      m[r.code] = r.value;
      /* 识别出的基础指标同步到客户档案 + 报告输入客户信息，保证报告基本信息/季度基线可引用。
         只写 input.customer 而不重建整对象，避免把快照里其他已填字段（examDate 等）冲掉。 */
      if (r.code === 'height' && r.value != null && r.value !== '') { state.work.height = r.value; ic.height = r.value; }
      if (r.code === 'weight' && r.value != null && r.value !== '') { state.work.baseline_weight = r.value; ic.baseline_weight = r.value; }
      if (r.code === 'waist' && r.value != null && r.value !== '') { state.work.waist = r.value; ic.waist = r.value; }
      var inp = document.querySelector('#metrics-form [data-code="' + r.code + '"]');
      if (inp) { inp.value = r.value; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    var meta = payload.meta || {};
    /* meta（性别/年龄/体检日期）为轻量建议；在档案相应字段为空时写入，并同步报告输入客户信息，
       否则基本信息表「年龄」等永远读不到识别值（此前只写 state.work，表格读 input.customer 导致脱节） */
    if (meta.gender && !state.work.gender) { state.work.gender = meta.gender; ic.gender = meta.gender; }
    if (meta.age != null && !state.work.age) { state.work.age = meta.age; ic.age = meta.age; }
    if (meta.examDate && !ic.examDate) ic.examDate = meta.examDate;
    saveWork();
  }
  function generatePlan(type) {
    if (!state.work || !state.work.name) { alert('请先在「入组评估」填写客户姓名。'); switchTab('enroll'); return; }
    state.work.input.customer.type = type;
    $('p-type').value = type;
    /* 用客户档案基础数据补齐指标缺失项：身高/体重/腰围。
       体检报告识别未命中或指标表单未录入时，仍能正确输出基本信息、BMI、能量摄入建议。 */
    var inp = state.work.input;
    inp.metrics = inp.metrics || {};
    var fb = { height: state.work.height, weight: state.work.baseline_weight, waist: state.work.waist };
    ['height', 'weight', 'waist'].forEach(function (code) {
      if ((inp.metrics[code] == null || inp.metrics[code] === '') && fb[code] != null && fb[code] !== '') inp.metrics[code] = fb[code];
    });
    /* 心率/体重缺失时回退该客户最近一次打卡的实测值（checkins 按月 "YYYY-MM" 存，键序即时间序），
       保证已开始月度打卡的客户在 A/B 报告基本信息也能带上最近体重与心率 */
    var cks = state.work.checkins || {}, lastMon = '', lastCk = null;
    Object.keys(cks).forEach(function (mo) { if (mo > lastMon) { lastMon = mo; lastCk = cks[mo]; } });
    if (lastCk) {
      if ((inp.metrics.hr == null || inp.metrics.hr === '') && lastCk.hr != null && lastCk.hr !== '') inp.metrics.hr = lastCk.hr;
      if ((inp.metrics.weight == null || inp.metrics.weight === '') && lastCk.weight != null && lastCk.weight !== '') inp.metrics.weight = lastCk.weight;
    }
    /* 报告基本信息/规则引擎以客户档案为权威：识别应用、客户管理改档等入口不重建 input.customer
       快照，故生成前统一覆盖，防止「年龄/身高/体重/血压分层」等滞后（表格读 input.customer/metrics） */
    inp.customer.height = state.work.height;
    inp.customer.baseline_weight = state.work.baseline_weight;
    inp.customer.waist = state.work.waist;
    if (state.work.name) inp.customer.name = state.work.name;
    if (state.work.gender) inp.customer.gender = state.work.gender;
    if (state.work.age != null && state.work.age !== '') inp.customer.age = state.work.age;
    if (state.work.phone != null && state.work.phone !== '') inp.customer.phone = state.work.phone;
    inp.customer.ascvd_risk = state.work.ascvd_risk || '';
    inp.customer.ldl_baseline = state.work.ldl_baseline != null ? state.work.ldl_baseline : inp.customer.ldl_baseline;
    var result = RE.evaluate(state.work.input);
    var html = RG.reportBody(result, state.work.input);
    state.plan = { result: result, html: html, input: clone(state.work.input) };
    $('plan-preview').innerHTML = '<style>' + RG.commonCSS() + '</style><div class="rp-root">' + html + '</div>';
    $('plan-hint').textContent = '已生成 ' + (type === 'A' ? 'A 版（含 FFR）' : 'B 版') + ' 报告。可导出 Word / HTML / 打印。';
    // 存档到客户 reports[]
    state.work.reports = state.work.reports || [];
    // 防 localStorage 溢出：报告 HTML 是最大体积来源，超阈值先瘦身（保留最近 10 份正文，更早的仅留元数据）
    var rp0 = state.work.reports, rpBytes0 = 0;
    rp0.forEach(function (r) { if (r && r.html) rpBytes0 += r.html.length; });
    if (rp0.length >= 15 || rpBytes0 > 400 * 1024) {
      CM.trimReportsHtml(10);
      var fresh = CM.get(state.work.id);
      if (fresh) state.work.reports = fresh.reports || [];
    }
    state.work.reports.push({ at: new Date().toISOString().slice(0, 10), type: type, html: html, name: state.work.name });
    saveWork();
  }

  /* v3 Plan B 补基线：为「无已确认首份 A/B 版报告」的客户补建基线（上传体检报告 + A/B 版后调用）。
     仅生成基线，不回溯历史报告、不改变服务季度边界；A 版含 FFR、B 版跳过；缺失字段不推测。 */
  function importPlanB(custId, metrics, abType, examDate) {
    var cust = CM.get(custId);
    if (!cust) { alert('未找到客户，无法补建基线'); return null; }
    var baseline = QE.planBImport(cust, metrics, abType, examDate);
    var m = baseline.metrics || {};
    /* 只补缺失基线字段，不覆盖已确认基线 */
    if (m.height != null && (cust.height == null || cust.height === '')) cust.height = m.height;
    if (m.weight != null && (cust.baseline_weight == null || cust.baseline_weight === '')) cust.baseline_weight = m.weight;
    if (m.waist != null && (cust.waist == null || cust.waist === '')) cust.waist = m.waist;
    if (m.ldl != null && (cust.ldl_baseline == null || cust.ldl_baseline === '')) cust.ldl_baseline = m.ldl;
    if (m.sbp != null && (cust.sbp == null || cust.sbp === '')) cust.sbp = m.sbp;
    if (m.dbp != null && (cust.dbp == null || cust.dbp === '')) cust.dbp = m.dbp;
    cust.baseline_source = 'plan_b_upload';
    cust.baseline_date = baseline.baseline_date || cust.baseline_date || '';
    cust.planb_baseline = baseline;
    CM.save(cust);
    if (state.work && state.work.id === custId) state.work = cust;
    return baseline;
  }

  /* ================= ④ 月度打卡 ================= */
  function bindCheckin() {
    $('btn-share-checkin').addEventListener('click', function () { if (state.work) shareCheckin(state.work); });
    $('btn-pull-checkin').addEventListener('click', pullCheckin);
    $('btn-cloud-records').addEventListener('click', openCloudRecords);
    $('btn-import-code2').addEventListener('click', importFromArea);
  }
  /* 服务季度：按客户入组日期每满 3 个月为一个季度（入组当月计第 1 个月）。n 从 1 起。
     例：入组 2026-05 → 第1个服务季度 = 2026-05/06/07，第2个 = 2026-08/09/10，第3个 = 2026-11/12/2027-01。 */
  function monthsOfServiceQuarter(enroll, n) {
    var m = /^(\d{4})-(\d{2})/.exec(String(enroll || '').trim());
    if (!m) return null;
    var base = Number(m[1]) * 12 + (Number(m[2]) - 1);
    return [0, 1, 2].map(function (i) {
      var t = base + (n - 1) * 3 + i;
      var y = Math.floor(t / 12), mo = (t % 12) + 1;
      return y + '-' + (mo < 10 ? '0' + mo : mo);
    });
  }
  /* 当前日期落在第几个服务季度（用于默认选中），无入组日期返回 1 */
  function currentServiceQuarterIndex(enroll) {
    var m = /^(\d{4})-(\d{2})/.exec(String(enroll || '').trim());
    if (!m) return 1;
    var now = new Date();
    var cur = now.getFullYear() * 12 + now.getMonth();
    var base = Number(m[1]) * 12 + (Number(m[2]) - 1);
    var idx = Math.floor((cur - base) / 3) + 1;
    return Math.min(Math.max(idx, 1), 4);
  }
  /* 服务年度：以入组月为锚，每 12 个月为一个服务年度。
     例：入组 2026-05 → 第 1 个服务年度 = 2026-05~2027-04；入组 2026-12 → 第 1 个服务年度 = 2026-12~2027-11。
     yearOffset 0 = 第 1 个服务年度，1 = 第 2 个，依此类推。无入组日期返回 null。 */
  function monthsOfServiceYear(enroll, yearOffset) {
    var m = /^(\d{4})-(\d{2})/.exec(String(enroll || '').trim());
    if (!m) return null;
    var base = Number(m[1]) * 12 + (Number(m[2]) - 1);
    var yo = Number(yearOffset || 0);
    var list = [];
    for (var i = 0; i < 12; i++) {
      var t = base + yo * 12 + i;
      var y = Math.floor(t / 12), mo = (t % 12) + 1;
      list.push(y + '-' + (mo < 10 ? '0' + mo : mo));
    }
    return list;
  }
  /* 当前日期落在第几个服务年度（0 起），无入组日期返回 0。
     用于打卡视图默认展示当前所属的服务年度，避免跨年后所有月份被截掉。 */
  function currentServiceYearOffset(enroll) {
    var m = /^(\d{4})-(\d{2})/.exec(String(enroll || '').trim());
    if (!m) return 0;
    var now = new Date();
    var cur = now.getFullYear() * 12 + now.getMonth();
    var base = Number(m[1]) * 12 + (Number(m[2]) - 1);
    return Math.max(0, Math.floor((cur - base) / 12));
  }
  function readGlobalCheckins() {
    try { return JSON.parse(localStorage.getItem('bz_checkins') || '[]'); } catch (e) { return []; }
  }
  function mapCheckinFields(src) {
    return {
      month: src.month || src.月份 || src.serviceMonth || '', name: src.name || '',
      date: src.date || src.填写日期 || '', symptoms: src.symptoms || src.症状 || [],
      newSymptom: src.newSymptom || src.新发症状 || '',
      meds: src.meds || src.长期用药 || [], medDays: src.medDays || src.规律服药天数 || '',
      exFreq: src.exFreq || src.运动次数 || '', exMin: src.exMin || src.运动时长 || '', weight: src.weight || src.体重 || '', height: src.height || src.身高 || '',
      diet: src.diet || src.饮食结构 || '', fried: src.fried || src.油炸频次 || '', sleep: src.sleep || src.睡眠质量 || '', sleepHours: src.sleepHours || src.睡眠时长 || '',
      smoke: src.smoke || src.吸烟 || '', drink: src.drink || src.饮酒 || '',
      sbp: src.sbp || src.收缩压 || '', dbp: src.dbp || src.舒张压 || '', fpg: src.fpg || src.空腹血糖 || '',
      hr: src.hr || src.心率 || '', measureDate: src.measureDate || src.测量日期 || '', question: src.question || src.问题 || '',
      cid: src.cid || ''
    };
  }
  function placeCheckin(ck) {
    if (!ck.month) return false;
    state.work.checkins = state.work.checkins || {};
    state.work.checkins[ck.month] = ck; saveWork(); return true;
  }
  /* 自动同步云端打卡：管理端打开页面 / 切换客户 / 进入月度打卡页时静默拉取当前客户在 Supabase 的打卡并落库。
     客户手机提交后数据已存入云端（永不丢失），此函数让管理端无需任何手动操作即可看到最新打卡。
     节流：同一客户 30 秒内不重复请求；busy 防重入。失败静默，不影响使用（可手动点「拉取打卡」重试）。 */
  var _cloudSyncBusy = false, _cloudSyncTarget = '', _cloudSyncLast = 0;
  function autoSyncCloud(silent) {
    if (!state.work || !state.work.id) return;
    if (!(window.CloudSync && CloudSync.ready())) return;
    if (_cloudSyncBusy) return;
    var now = Date.now();
    if (state.work.id === _cloudSyncTarget && now - _cloudSyncLast < 30000) return;
    _cloudSyncTarget = state.work.id; _cloudSyncLast = now; _cloudSyncBusy = true;
    var st = $('import-status');
    if (!silent && st) st.textContent = '正在自动同步云端打卡…';
    CloudSync.fetchCheckins(state.work.id, state.work.name).then(function (rows) {
      var cloud = 0;
      rows.forEach(function (row) {
        var ck = mapCheckinFields(row.data || {});
        ck.cid = row.cid || ck.cid;
        if (placeCheckin(ck)) cloud++;
      });
      if (cloud) {
        renderCheckinView(); renderQuarterCheckins();
        if (st) st.textContent = '已自动同步 ' + cloud + ' 个月云端打卡（客户提交后无需手动导入）。';
        showToast('已自动同步客户打卡 ' + cloud + ' 个月', true);
      } else if (st && !silent) {
        st.textContent = '云端已同步，暂无新打卡。';
      }
      _cloudSyncBusy = false;
    }).catch(function () {
      _cloudSyncBusy = false;   // 静默失败，手动「拉取打卡」可重试
    });
  }

  /* 拉取打卡：
     1) 云端（Supabase 已配置时）：自动取回客户手机上直传的打卡，无需回传码；
     2) 本机：把客户在【这台电脑的浏览器】上提交的打卡（暂存于 bz_checkins）归档到当前客户。 */
  function pullCheckin() {
    var matched = 0;
    var arr = readGlobalCheckins();
    arr.forEach(function (src) {
      var ck = mapCheckinFields(src);
      if ((ck.cid && ck.cid === state.work.id) || (!ck.cid && ck.name && ck.name === state.work.name)) { if (placeCheckin(ck)) matched++; }
    });
    renderCheckinView(); renderQuarterCheckins();
    var st = $('import-status');
    var stMsg = '已从本机归档 ' + matched + ' 个月打卡（按当前客户匹配；0 个月属正常）。';
    if (window.CloudSync && CloudSync.ready()) {
      if (st) st.textContent = '正在从云端拉取打卡…';
      CloudSync.fetchCheckins(state.work.id, state.work.name).then(function (rows) {
        var cloud = 0;
        rows.forEach(function (row) {
          var ck = mapCheckinFields(row.data || {});
          ck.cid = row.cid || ck.cid;
          if (placeCheckin(ck)) cloud++;
        });
        renderCheckinView(); renderQuarterCheckins();
        var msg = '云端拉取成功：新增/更新 ' + cloud + ' 个月打卡' + (matched ? '；本机归档 ' + matched + ' 个月' : '') + '。';
        if (st) st.textContent = msg;
        alert(msg);
        /* 附加诊断：云端共有多少条记录；若匹配 0 条但有其他客户记录，引导打开「云端记录」手动导入 */
        CloudSync.fetchAllCheckins().then(function (all) {
          var total = all.length;
          var others = total - rows.length;
          var extra = '（云端共 ' + total + ' 条记录）';
          if (cloud === 0 && others > 0) {
            extra += ' 当前客户未匹配到云端记录，但云端有 ' + others + ' 条其他记录，可点「云端记录」按钮手动导入。';
          }
          if (st) st.textContent = msg.replace(/。$/, '。') + extra;
        }).catch(function () {});
      }).catch(function (err) {
        var msg = '云端拉取失败（' + (err && err.message ? err.message : '网络异常') + '）。' + stMsg + '客户手机打卡数据也可通过回传码导入。';
        if (st) st.textContent = msg;
        alert(msg);
      });
    } else {
      if (st) st.textContent = stMsg + '（未配置 Supabase 云端直传，客户手机打卡请走回传码导入；配置方法见 js/supabase-config.js）';
      alert('已从本机归档 ' + matched + ' 个月打卡。\n（仅适用于客户在这台电脑上代填的场景；配置 Supabase 后可自动拉取客户手机打卡。）');
    }
  }
  /* 云端记录总览：列出所有已上传到 Supabase 的打卡，供健管师核对 / 手动导入（即使客户 ID 不匹配也能捞回） */
  var _cloudRows = [];
  function openCloudRecords() {
    var box = $('cr-body'); if (!box) return;
    $('cr-modal').style.display = 'flex';
    box.innerHTML = '<span class="hint">正在读取云端记录…</span>';
    if (!(window.CloudSync && CloudSync.ready())) { box.innerHTML = '<span class="hint">未配置 Supabase 云端直传（js/supabase-config.js）。</span>'; return; }
    CloudSync.fetchAllCheckins().then(function (rows) {
      _cloudRows = rows;
      if (!rows.length) { box.innerHTML = '<span class="hint">云端暂无打卡记录。客户手机提交打卡后会自动出现在这里。</span>'; return; }
      var html = '<div class="hint" style="margin-bottom:8px">云端共 <b>' + rows.length + '</b> 条记录（点「导入到当前客户」即写入档案，重复导入会覆盖同月旧数据）：</div><table class="rp-tb" style="width:100%;font-size:13px"><thead><tr><th>提交时间</th><th>姓名</th><th>月份</th><th>内容摘要</th><th style="width:110px">操作</th></tr></thead><tbody>';
      rows.forEach(function (row, i) {
        var d = row.data || {};
        var when = String(row.created_at || '').replace('T', ' ').slice(0, 16);
        var abs = [];
        if (d.meds && d.meds.length) abs.push('用药:' + d.meds.join('/'));
        else if (d.medDays) abs.push(d.medDays === '是' || d.medDays === '否' ? '按时用药:' + d.medDays : '服药' + d.medDays + '天');
        if (d.exFreq != null && d.exFreq !== '') abs.push('运动' + d.exFreq + '次/周');
        if (d.weight) abs.push(d.weight + 'kg');
        if (d.sbp || d.dbp) abs.push((d.sbp || '—') + '/' + (d.dbp || '—') + 'mmHg');
        if (d.fpg) abs.push('血糖' + d.fpg);
        if (d.symptoms && d.symptoms.length) abs.push('症状:' + d.symptoms.join('/'));
        html += '<tr><td>' + esc(when) + '</td><td>' + esc(row.name || d.name || '—') + '</td><td>' + esc(row.month || d.month || '—') + '</td>' +
          '<td>' + esc(abs.join('；') || '未填写具体内容') + '</td>' +
          '<td><button class="btn small primary" onclick="window._importCloudRow(' + i + ')">导入当前客户</button></td></tr>';
      });
      html += '</tbody></table>';
      box.innerHTML = html;
    }).catch(function (err) {
      box.innerHTML = '<span class="hint">云端读取失败（' + (err && err.message ? err.message : '网络异常') + '）。</span>';
    });
  }
  window._importCloudRow = function (idx) {
    var row = _cloudRows[idx]; if (!row) return;
    var ck = mapCheckinFields(row.data || {});
    ck.cid = row.cid || ck.cid;
    if (placeCheckin(ck)) {
      renderCheckinView(); renderQuarterCheckins();
      openCloudRecords();
      alert('已导入「' + (ck.name || '') + '」' + ck.month + ' 打卡到当前客户档案。');
    } else {
      alert('导入失败：该记录缺少月份字段。');
    }
  };
  /* 解析回传码文本：回传码为 Base64（A-Za-z0-9+/=），按非这些字符切分，兼容聊天框复制残留与整条链接 */
  function parseImportText(text) {
    var tokens = String(text || '').split(/[^A-Za-z0-9+/=]+/).filter(function (t) { return t.length > 10; });
    var placed = 0, failed = 0, names = {};
    tokens.forEach(function (token) {
      var data;
      try { data = JSON.parse(decodeURIComponent(escape(atob(token.trim())))); } catch (e) { failed++; return; }
      var arr = data.checkins ? data.checkins : [data];
      arr.forEach(function (src) {
        var ck = mapCheckinFields(src);
        if (ck.month && placeCheckin(ck)) { placed++; if (ck.name) names[ck.name] = 1; }
        else failed++;
      });
    });
    return { tokens: tokens, placed: placed, failed: failed, names: names };
  }
  function importFromArea() {
    var input = $('import-input'), status = $('import-status');
    if (!input) return;
    var text = (input.value || '').trim();
    if (!text) { if (status) status.textContent = '请先粘贴客户发来的回传码。'; return; }
    var r = parseImportText(text);
    if (!r.tokens.length) { if (status) status.textContent = '未识别到回传码，请确认已完整复制（建议整段复制）。'; return; }
    renderCheckinView(); renderQuarterCheckins();
    var msg = '已导入 ' + r.placed + ' 个月打卡';
    var ns = Object.keys(r.names);
    if (ns.length) msg += '（' + ns.join('、') + '）';
    if (r.failed) msg += '；' + r.failed + ' 段无法解析';
    if (status) status.textContent = msg;
    if (r.placed) input.value = '';
  }
  /* 健管师端 URL 自动导入：客户发来 checkin.html#import=... 链接，或分享链接自带 import=，打开即自动落库 */
  function autoImportFromURL() {
    try {
      var src = (location.search || '') + (location.hash || '');
      var m = src.match(/[?&#]import=([^&#]+)/);
      if (!m) return;
      var codeText = decodeURIComponent(m[1]);
      // 客户发来的可能是完整链接（含 #import=xxx），取最后一个 import= 之后的部分
      if (/import=/.test(codeText)) codeText = codeText.split('import=').pop();
      var r = parseImportText(codeText);
      if (r.placed) {
        // 若回传码客户与当前选中客户不同，自动切换到该客户
        var nm = Object.keys(r.names)[0];
        if (nm && state.work && state.work.name !== nm) {
          var hit = CM.list().filter(function (c) { return c.name === nm; })[0];
          if (hit) selectCust(hit.id);
        }
        renderCheckinView(); renderQuarterCheckins();
        alert('已自动导入 ' + r.placed + ' 个月打卡' + (Object.keys(r.names).length ? '（' + Object.keys(r.names).join('、') + '）' : '') + '，可在「月度打卡」查看。');
      } else if (r.failed) {
        alert('链接中的打卡数据无法解析，请复制完整回传码后在「月度打卡 → 粘贴客户回传码」手动导入。');
      }
      // 清理 URL，避免刷新重复导入
      try { history.replaceState(null, '', location.pathname); } catch (e2) {}
    } catch (e) {}
  }
  function renderCheckinView() {
    var host = $('checkin-view'); if (!host) return;
    if (!state.work) { host.innerHTML = ''; return; }
    /* 服务年度：以入组月为锚 12 个月滚动（修复跨年后月份被截掉的问题）。
       若 state.ckYearOffset 未初始化或客户切换，用 currentServiceYearOffset 归零到当前所属年度。 */
    if (state.ckYearOffset == null) state.ckYearOffset = currentServiceYearOffset(state.work.enroll_date);
    var enroll = state.work.enroll_date;
    var months = monthsOfServiceYear(enroll, state.ckYearOffset);
    var yearLabel, yearEndLabel;
    if (!months) {
      /* 无入组日期：保留旧行为（当前自然年 1-12 月）作为降级 */
      var y = new Date().getFullYear();
      months = []; for (var i = 1; i <= 12; i++) { months.push(y + '-' + (i < 10 ? '0' + i : i)); }
      yearLabel = y + ' 年（未填入组日期，按自然年展示）';
      yearEndLabel = '';
    } else {
      yearLabel = '第 ' + (state.ckYearOffset + 1) + ' 个服务年度';
      yearEndLabel = months[0].replace('-', '年') + ' 月 ～ ' + months[11].replace('-', '年') + ' 月';
    }
    var ck = state.work.checkins || {};
    host.innerHTML = '';
    /* 完成率统计 */
    var filled = months.filter(function (k) { return ck[k]; }).length;
    var stat = el('div', 'card');
    stat.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<div><b>' + esc(yearLabel) + ' · ' + esc(yearEndLabel) + ' · 完成率 ' + filled + '/12 = ' + Math.round(filled / 12 * 100) + '%</b>' +
          '<div class="hint">已打卡月份标绿；点击任意月份可查看 / 编辑该月数据（手动录入为客户无法自行填写时的降级方案）。' +
          (!enroll ? '提示：尚未填写入组日期，打卡视图以自然年展示；建议尽快补全入组日期以便按服务年度滚动。' : '') +
          '</div></div>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="btn small ghost" id="ck-prev-year" title="查看上一服务年度（入组月向前 12 个月）">← 上一服务年度</button>' +
          '<button class="btn small ghost" id="ck-next-year" title="查看下一服务年度（入组月向后 12 个月）">下一服务年度 →</button>' +
        '</div>' +
      '</div>';
    host.appendChild(stat);
    var prevBtn = $('ck-prev-year'), nextBtn = $('ck-next-year');
    if (prevBtn) prevBtn.addEventListener('click', function () { state.ckYearOffset = (state.ckYearOffset || 0) - 1; renderCheckinView(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { state.ckYearOffset = (state.ckYearOffset || 0) + 1; renderCheckinView(); });
    /* 12 个月格子 */
    var grid = el('div', 'ck-grid');
    months.forEach(function (k) {
      var has = !!ck[k];
      var cell = el('div', 'ck-month' + (has ? ' ok' : ''));
      cell.innerHTML = '<b>' + esc(k.slice(5)) + '月</b><span>' + (has ? '已打卡' : '未打卡') + '</span>';
      cell.addEventListener('click', function () { openCheckinEditor(k); });
      grid.appendChild(cell);
    });
    host.appendChild(grid);
    /* 已打卡月份明细（完整字段，供健管师查看客户打卡内容） */
    var keys = Object.keys(ck).sort();
    if (keys.length) {
      keys.forEach(function (k) {
        var c = ck[k];
        var card = el('div', 'card ck-card');
        var src = c.manual ? '健管师手动录入' : ('客户提交' + (c.submittedAt ? ' · ' + esc(String(c.submittedAt).slice(0, 10)) : ''));
        card.innerHTML = '<div class="ck-h"><b>' + k + ' · ' + esc(c.name || '') + ' 打卡</b><span class="ck-src">' + src + '</span></div>' + checkinDetailHtml(c);
        host.appendChild(card);
      });
    }
  }
  /* 单月打卡完整内容（身体/生活/监测/问题 全字段） */
  function checkinDetailHtml(c) {
    var d = [];
    function add(k, v, full) {
      if (v === '' || v == null || !String(v).trim()) return;
      d.push('<span class="ck-item' + (full ? ' full' : '') + '"><b>' + k + '</b> ' + esc(v) + '</span>');
    }
    if (c.symptoms && c.symptoms.length) add('症状', c.symptoms.join('、'), true);
    add('新发症状/就医', c.newSymptom, true);
    if (c.meds && c.meds.length) add('长期用药/补剂', c.meds.join('、'), true);
    add('按时用药', c.medDays ? ((c.medDays === '是' || c.medDays === '否') ? c.medDays : c.medDays + ' 天/月') : '');
    add('运动', [c.exFreq ? c.exFreq + ' 次/周' : '', c.exMin ? c.exMin + ' 分钟/次' : ''].filter(Boolean).join(' · '));
    add('体重', c.weight ? c.weight + ' kg' : '');
    add('饮食结构', c.diet);
    add('油炸/高脂', c.fried);
    add('睡眠质量', c.sleep);
    add('吸烟', c.smoke ? c.smoke + ' 支/天' : '');
    add('饮酒', c.drink);
    add('血压', c.sbp || c.dbp ? (c.sbp || '—') + '/' + (c.dbp || '—') + ' mmHg' : '');
    add('空腹血糖', c.fpg ? c.fpg + ' mmol/L' : '');
    add('心率', c.hr ? c.hr + ' 次/分' : '');
    add('测量日期', c.measureDate);
    add('填写日期', c.date);
    add('最关心的问题', c.question, true);
    return '<div class="ck-detail">' + (d.length ? d.join('') : '<span class="hint">该月未填写具体内容（可点击上方月份格手动补充）</span>') + '</div>';
  }
  /* 手动录入 / 编辑单月打卡 */
  var MED_OPTS = ['降压药', '降脂药', '降糖药', '降尿酸药', '护肝药', '维生素/矿物质补充剂', '不服用任何药物/补剂'];
  function openCheckinEditor(month) {
    var c = (state.work.checkins || {})[month] || {};
    var fields = [
      ['month', '月份（YYYY-MM）', 'text'], ['weight', '体重(kg)', 'number'], ['sbp', '收缩压', 'number'], ['dbp', '舒张压', 'number'],
      ['fpg', '空腹血糖', 'number'], ['hr', '心率', 'number'], ['exFreq', '运动次数(次/周)', 'number'],
      ['meds', '长期用药/补剂（多选）', 'chips', MED_OPTS],
      ['medDays', '是否按时用药', 'select', ['是', '否']],
      ['diet', '饮食结构', 'select', ['荤素均衡', '偏荤', '偏素']], ['fried', '油炸/高脂频次', 'select', ['几乎不吃', '每周 1-2 次', '每周 3 次以上']],
      ['sleep', '睡眠质量', 'select', ['好', '一般', '差']],
      ['smoke', '吸烟(支/天，若不吸烟填0)', 'number'], ['drink', '饮酒频次', 'select', ['不饮', '偶尔', '经常']],
      ['question', '本月最关心的问题', 'textarea']
    ];
    var box = el('div');
    fields.forEach(function (f) {
      var lab = el('label', 'field'); lab.style.minWidth = '140px';
      var ctrl;
      if (f[1] === 'textarea' || f[2] === 'textarea') { ctrl = el('textarea'); ctrl.rows = 2; }
      else if (f[2] === 'chips') {
        /* 多选 chips：选药排除「不服用」，反之亦然 */
        ctrl = el('div');
        ctrl.dataset.chips = '1';
        ctrl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
        (f[3] || []).forEach(function (opt) {
          var chip = el('div', 'q-chip');
          chip.textContent = opt;
          var cur = (c.meds || []);
          if (cur.indexOf(opt) >= 0) chip.classList.add('on');
          chip.addEventListener('click', function () {
            var on = !chip.classList.contains('on');
            if (on) {
              if (opt === '不服用任何药物/补剂') {
                ctrl.querySelectorAll('.q-chip.on').forEach(function (x) { x.classList.remove('on'); });
              } else {
                ctrl.querySelectorAll('.q-chip').forEach(function (x) { if (x.textContent === '不服用任何药物/补剂') x.classList.remove('on'); });
              }
            }
            chip.classList.toggle('on', on);
          });
          ctrl.appendChild(chip);
        });
      }
      else if (f[2] === 'select') { ctrl = el('select'); f[3].forEach(function (o) { var op = el('option'); op.value = o; op.textContent = o; ctrl.appendChild(op); }); }
      else { ctrl = el('input'); ctrl.type = f[2] || 'text'; }
      ctrl.dataset.f = f[0];
      if (f[2] !== 'chips') ctrl.value = c[f[0]] != null ? c[f[0]] : (f[0] === 'month' ? month : '');
      lab.appendChild(el('span', null, f[1])); lab.appendChild(ctrl);
      box.appendChild(lab);
    });
    var m = $('ck-modal');
    $('ck-title').textContent = (c ? '编辑' : '手动录入') + '打卡 · ' + month;
    $('ck-form').innerHTML = ''; $('ck-form').appendChild(box);
    $('ck-modal').dataset.month = month;
    m.style.display = 'flex';
  }
  function saveCheckinEditor() {
    var month = $('ck-modal').dataset.month;
    var obj = { month: month, name: state.work.name, cid: state.work.id, manual: true, date: new Date().toISOString().slice(0, 10) };
    $('ck-form').querySelectorAll('[data-f]').forEach(function (ctrl) {
      var key = ctrl.dataset.f;
      if (key === 'month') { month = ctrl.value.trim() || month; obj.month = month; return; }
      if (ctrl.dataset.chips === '1') {
        var picked = [].map.call(ctrl.querySelectorAll('.q-chip.on'), function (x) { return x.textContent; });
        if (picked.length) obj[key] = picked;
        return;
      }
      if (ctrl.value !== '') obj[key] = ctrl.value;
    });
    /* 仅选「不服用任何药物/补剂」时清掉按时用药答案 */
    if (obj.meds && obj.meds.length && obj.meds.indexOf('不服用任何药物/补剂') >= 0) delete obj.medDays;
    if (!/^\d{4}-\d{2}$/.test(obj.month)) { alert('月份格式应为 YYYY-MM'); return; }
    state.work.checkins = state.work.checkins || {};
    state.work.checkins[obj.month] = obj;
    saveWork(); renderCheckinView(); renderQuarterCheckins();
    $('ck-modal').style.display = 'none';
  }

  /* ================= ⑤ 季度报告 ================= */
  function bindQuarter() {
    ['q-name', 'q-gender', 'q-age', 'q-date', 'q-source', 'q-issues'].forEach(function (id) {
      var i = $(id); if (i) i.addEventListener('input', function () { if (state.work) saveWork(); });
    });
    var qsel = $('q-quarter');
    if (qsel) qsel.addEventListener('change', function () { if (state.work) renderQuarterCheckins(); });
    var qabEdit = $('q-ab-edit');
    if (qabEdit) qabEdit.addEventListener('click', function () { switchTab('plan'); var t = $('ab-text'); if (t) t.focus(); });
    $('btn-gen-quarter').addEventListener('click', generateQuarter);
    $('btn-q-word').addEventListener('click', function () { if (state.quarter) QR.exportWord(state.quarter.result); else alert('请先生成季度报告'); });
    $('btn-q-html').addEventListener('click', function () { if (state.quarter) exportHtml('季度小结汇总_' + state.quarter.qin.customer.name, state.quarter.html); else alert('请先生成季度报告'); });
    $('btn-q-print').addEventListener('click', function () { if (state.quarter) printHtml(state.quarter.html); else alert('请先生成季度报告'); });
  }
  function loadQuarterForm() {
    if (!state.work) return;
    $('q-name').value = state.work.name || ''; $('q-gender').value = state.work.gender || '女';
    $('q-age').value = (state.work.age != null && state.work.age !== '') ? state.work.age : '';
    $('q-quarter').value = String(currentServiceQuarterIndex(state.work.enroll_date));
    $('q-date').value = new Date().toISOString().slice(0, 10);
    $('q-source').value = '体检报告'; $('q-issues').value = (state.work.core_issues || []).join('、');
    var abSum = $('q-ab-summary');
    if (abSum) {
      var ab = ((state.work.input || {}).baselineAB) || '';
      if (ab && ab.trim()) {
        var brief = ab.trim().replace(/\s+/g, ' ');
        abSum.innerHTML = '<span style="color:#2c7a48">已提供（' + brief.length + ' 字）：</span>' + esc(brief.slice(0, 80)) + (brief.length > 80 ? '…' : '');
      } else abSum.innerHTML = '尚未提供。若客户已有《体检报告解读汇总与健康规划》A/B 版，可到「体检报告解读」上传或粘贴，将作为季度报告基线参考。';
    }
    renderQuarterCheckins();
  }
  function renderQuarterCheckins() {
    var host = $('q-checkins'); if (!host) return;
    var n = Number($('q-quarter').value) || 1;
    var months = state.work ? monthsOfServiceQuarter(state.work.enroll_date, n) : null;
    var range = $('q-months-range');
    if (!months) {
      if (range) range.value = '请先填写入组日期';
      host.innerHTML = '<p class="hint">服务季度按客户入组日期每满 3 个月推算，当前客户尚未填写入组日期。请到「入组评估」填写后再生成季度报告。</p>';
      return;
    }
    if (range) range.value = months[0] + ' ~ ' + months[2];
    host.innerHTML = '';
    months.forEach(function (m) {
      var ck = (state.work.checkins || {})[m];
      host.appendChild(el('div', 'card',
        '<b>' + m + '</b>：' + (ck ? ('体重 ' + esc(ck.weight || '—') + ' · 血压 ' + esc(ck.sbp || '—') + '/' + esc(ck.dbp || '—') + ' · 空腹血糖 ' + esc(ck.fpg || '—'))
          : '<span class="hint">待填写（客户月底打卡或由回传码导入）</span>')));
    });
  }
  function generateQuarter() {
    if (!state.work || !state.work.name) { alert('请先在「入组评估」填写客户。'); switchTab('enroll'); return; }
    var n = Number($('q-quarter').value) || 1;
    var months = monthsOfServiceQuarter(state.work.enroll_date, n);
    if (!months) { alert('服务季度按入组日期推算，请先在「入组评估」填写该客户的入组日期。'); switchTab('enroll'); var t = $('e-enroll'); if (t) t.focus(); return; }
    var c = { name: $('q-name').value, gender: $('q-gender').value, age: $('q-age').value, quarter: 'S' + n, quarterYear: Number(months[0].slice(0, 4)), reportDate: $('q-date').value, type: state.work.customer_type || 'B' };
    /* 携带档案生活方式基线，供季度小结引用（体检报告无对应数值时回退） */
    ['baseline_weight', 'ex_freq', 'ex_min', 'sleep_hours', 'med_regular', 'ascvd_risk', 'ldl_baseline', 'enroll_date'].forEach(function (k) { c[k] = state.work[k]; });
    var checkins = months.map(function (m) { return (state.work.checkins || {})[m] || null; });
    var inData = state.work.input || {};
    var baseline = { source: $('q-source').value || '体检报告', coreIssues: $('q-issues').value, metrics: inData.metrics, ab: inData.baselineAB || '' };
    var agg = QE.aggregate(checkins, baseline.metrics, state.work);
    /* qin 注入本服务季度月份与体检日期，供快照判定「当季是否上传过新体检报告」（体检日期落在本季度月份内） */
    var qin = { customer: c, baseline: baseline, checkins: checkins, quarterMonths: months, examDate: (state.work.input.customer || {}).examDate || '', answers: (agg.questions || []).map(function (qq) { return ''; }) };
    var result = QE.evaluate(qin);
    var html = QR.reportBody(result);
    state.quarter = { result: result, html: html, qin: qin };
    $('q-preview').innerHTML = '<style>' + RG.commonCSS() + '</style><div class="rp-root">' + html + '</div>';
    $('q-hint').textContent = '已生成季度报告 · 触发标签 ' + result.tags.length + ' 项 · 打卡完成 ' + (result.agg.filled || 0) + '/3 个月。';
    // 存档
    state.work.quarters = state.work.quarters || {};
    state.work.quarters[c.quarter + '_' + c.quarterYear] = { at: c.reportDate, html: html, qin: qin };
    saveWork();
  }

  /* ================= ⑥ 年度报告 ================= */
  function bindAnnual() {
    $('btn-gen-annual').addEventListener('click', generateAnnual);
    $('btn-a-word').addEventListener('click', function () { if (state.annual) AR.exportWord(state.annual.result); else alert('请先生成年度总结'); });
    $('btn-a-print').addEventListener('click', function () { if (state.annual) printHtml(state.annual.html); else alert('请先生成年度总结'); });
  }
  function generateAnnual() {
    if (!state.work || !state.work.name) { alert('请先在「入组评估」填写客户。'); switchTab('enroll'); return; }
    var year = Number($('a-year').value);
    var result = AR.build(state.work, year);
    var html = AR.reportBody(result);
    state.annual = { result: result, html: html };
    $('annual-body').innerHTML = '<style>' + RG.commonCSS() + '</style><div class="rp-root">' + html + '</div>';
    state.work.annuals = state.work.annuals || {};
    state.work.annuals[year] = { at: new Date().toISOString().slice(0, 10), html: html };
    saveWork();
  }

  /* ================= ⑦ 模板管理 ================= */
  function bindTmpl() {
    $('btn-tmpl-upload').addEventListener('click', function () {
      var f = $('tmpl-file').files && $('tmpl-file').files[0]; if (!f) { $('tmpl-list').textContent = '请先选择 HTML 模板文件。'; return; }
      var r = new FileReader(); r.onload = function () { localStorage.setItem('tmpl_custom', r.result); $('tmpl-list').textContent = '已上传模板：' + f.name + '（' + r.result.length + ' 字）。'; }; r.readAsText(f);
    });
    $('btn-tmpl-download').addEventListener('click', function () {
      var t = localStorage.getItem('tmpl_custom'); if (!t) { $('tmpl-list').textContent = '暂无自定义模板。'; return; }
      var blob = new Blob([t], { type: 'text/html' }); var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = '自定义报告模板.html'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    var t = localStorage.getItem('tmpl_custom'); $('tmpl-list').textContent = t ? '当前已有一份自定义模板。' : '尚未上传自定义模板。';
  }

  /* ================= ⑧ 知识库（文字版） ================= */
  function lvInfo(l) {
    if (!l) return { label: '', color: '#999' };
    if (typeof l === 'object') return { label: l.label || '', color: l.color || '#999' };
    if (KB.LEVEL && KB.LEVEL[l]) return { label: KB.LEVEL[l].label, color: KB.LEVEL[l].color };
    return { label: String(l), color: '#999' };
  }
  function kbCard(h) { return '<div class="kb-card">' + h + '</div>'; }
  function kbHead(t, right) { return '<div class="kb-card-h">' + esc(t) + (right ? '<span class="kb-sub">' + esc(right) + '</span>' : '') + '</div>'; }
  function kbSec(t) { return '<div class="kb-sec">' + t + '</div>'; }
  function kbUl(arr) { return '<ul class="kb-ul">' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }
  function kbP(t) { return '<p class="kb-p">' + esc(t) + '</p>'; }
  function kbRow(k, v) { return '<div class="kb-row"><span class="kb-row-k">' + esc(k) + '</span><span class="kb-row-v">' + esc(v) + '</span></div>'; }
  /* 文献知识库条目 → 文字卡片 */
  function renderLit(d) {
    var h = '<div class="kb-card"><div class="kb-card-h">' + esc(d.title) +
      (d.tags && d.tags.length ? '<span class="kb-sub">匹配标签：' + esc(d.tags.join('、')) + '</span>' : '') + '</div>';
    if (d.source) h += '<div class="kb-src">依据文献：' + esc(d.source) + '</div>';
    if (d.diagnosis && d.diagnosis.length) {
      h += kbSec('诊断 / 分层标准');
      d.diagnosis.forEach(function (r) { if (Array.isArray(r)) h += kbRow(r[0], r[1]); });
    }
    if (d.targets && d.targets.length) { h += kbSec('管理目标'); h += kbUl(d.targets); }
    if (d.lifestyle && d.lifestyle.length) { h += kbSec('生活方式干预要点'); h += kbUl(d.lifestyle); }
    if (d.drug) { h += kbSec('用药要点'); h += kbP(d.drug); }
    if (d.special && d.special.length) { h += kbSec('专项提示'); h += kbUl(d.special); }
    return h + '</div>';
  }
  function bindKB() {
    var subs = [
      ['LIT_KNOWLEDGE', '文献知识库'],
      ['INDICATORS', '指标字典'],
      ['KB_RULES', '指标规则'],
      ['ADVICE', '管理建议库'],
      ['SEASON', '季节知识库'],
      ['HIGH_PURINE', '高嘌呤食物'],
      ['FFR', 'FFR 判定'],
      ['SAMPLE_MENU', '食谱/能量'],
      ['LIFESTYLE_INTERVENTION', '生活方式干预'],
      ['CUSTOM_MGR', '自定义指标/标签']
    ];
    var kbTabs = $('kb-tabs');
    subs.forEach(function (s, i) {
      var b = el('button', 'btn small' + (i === 0 ? ' primary' : ''), s[1]); b.type = 'button';
      b.addEventListener('click', function () { kbTabs.querySelectorAll('button').forEach(function (x) { x.classList.remove('primary'); }); b.classList.add('primary'); renderKB(s[0]); });
      kbTabs.appendChild(b);
    });
    $('btn-kb-reset').addEventListener('click', function () { if (confirm('重置为默认知识库？已生成的报告不受影响。')) { localStorage.removeItem(CM.LS_KB); alert('已重置，刷新后生效。'); } });
    renderKB('LIT_KNOWLEDGE');
  }
  /* ---------- 指标规则查看界面（v3.0 §15.2） ---------- */
  function f1(n) { return Math.round(n * 10) / 10; }
  function renderKBRules() {
    var h = '';
    var inds = KB.INDICATORS || [];
    var rules = KB.RULE_TEXT || {};
    h += '<div class="kb-card-h">体检指标判定规则</div><p class="hint">19 项自动判定指标 + 基础指标行（vitd/bmd/cyfra21）。未录入（null/空）不判定、不输出、不产生标签。</p>';
    h += '<div class="kb-scroll"><table class="kb-table"><thead><tr><th>指标代码</th><th>指标名称</th><th>单位</th><th>类型</th><th>判定阈值 / 选项</th><th>触发标签</th></tr></thead><tbody>';
    inds.forEach(function (d) {
      var rt = rules[d.code] || { rule: '（判定规则见文献知识库对应条目）', tags: '—' };
      var kind = d.kind === 'number' ? '数值' : (d.kind === 'select' ? '选项' : (d.kind === 'derived' ? '综合判定' : (d.kind || '')));
      h += '<tr><td>' + esc(d.code) + '</td><td>' + esc(d.label) + '</td><td>' + esc(d.unit || '') + '</td><td>' + esc(kind) + '</td><td>' + esc(rt.rule) + '</td><td>' + esc(rt.tags) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="hint">触发标签会联动「管理建议库」输出对应建议，并进入行动清单与随访安排；文献知识库按标签自动引用。</p>';

    h += '<div class="kb-sec">LDL-C 按 ASCVD 风险等级个性化判定阈值（中国血脂管理指南 2023）</div>';
    var lvl = KB.ASCVD_RISK_LEVELS || {}, th = KB.LDL_THRESHOLDS || {};
    h += '<div class="kb-scroll"><table class="kb-table"><thead><tr><th>风险等级</th><th>LDL-C 目标</th><th>正常</th><th>需关注</th><th>异常</th><th>触发标签</th></tr></thead><tbody>';
    Object.keys(lvl).forEach(function (risk) {
      var L = lvl[risk], defs = th[risk]; if (!defs) return;
      var cells = defs.map(function (b, i) {
        var prev = i > 0 ? defs[i - 1].max : null;
        var t;
        if (i === 0) t = '<' + f1(b.max + 0.01);
        else if (b.max >= 999) t = '≥' + f1(prev + 0.1);
        else t = f1(prev + 0.1) + '~' + f1(b.max);
        return t + ' ' + lvInfo(b.level).label;
      });
      var tagStr = defs.map(function (b) { return (b.tags || []).join('/'); }).filter(Boolean).join(' / ');
      h += '<tr><td>' + esc(L.label) + '</td><td><' + esc(String(L.ldlTarget)) + ' mmol/L</td>' + cells.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '<td>' + esc(tagStr) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="hint">极高危 / 超高危：较基线降幅不足 50% 时建议强调「需强化降脂」；客户档案 ascvd_risk 为空时降级统一阈值（<3.4 / 3.4~4.0 / ≥4.1）。</p>';

    h += '<div class="kb-sec">ASCVD 五级风险分层定义</div>';
    var defRows = Object.keys(lvl).map(function (k) {
      var L = lvl[k];
      return kbRow(L.label, L.def + '（LDL-C 目标 <' + L.ldlTarget + ' mmol/L）');
    }).join('');
    h += kbCard(kbHead('风险等级与定义') + defRows);
    h += kbCard(kbHead('ASCVD 主要危险因素', '用于风险分层辅助') + kbUl(KB.ASCVD_RISK_FACTORS || []));
    h += kbCard(kbHead('高危险因素', '用于超高危判定') + kbUl(KB.ASCVD_HIGH_RISK_FACTORS || []));
    return h;
  }

  /* ---------- 自定义指标 / 标签管理界面（v3.0 §15.3~15.5） ---------- */
  function renderCustomIndTable() {
    var list = KB.customIndicators();
    if (!list.length) return '<div class="hint">暂无自定义指标。</div>';
    var rows = list.map(function (d, i) {
      return '<tr><td>' + esc(d.indicator_name || '') + '</td><td>' + esc(d.indicator_code || '') + '</td><td>' + esc(d.indicator_unit || '') + '</td><td>' + esc(d.indicator_type || '') + '</td><td>' + esc(d.trigger_tag || '') + '</td><td>' + esc(d.source || 'manual') + '</td><td><button type="button" class="btn small gray" data-act="del-ind" data-i="' + i + '">删除</button></td></tr>';
    }).join('');
    return '<div class="kb-scroll"><table class="kb-table"><thead><tr><th>名称</th><th>代码</th><th>单位</th><th>类型</th><th>触发标签</th><th>来源</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function customIndForm() {
    return '<div class="kb-card"><div class="kb-card-h">＋新增自定义指标</div><div class="cm-form">' +
      '<label class="field">名称<input id="ci-name" placeholder="如：甲状腺结节TI-RADS分级"></label>' +
      '<label class="field">代码<input id="ci-code" placeholder="如：thyroid_tirads（英文唯一）"></label>' +
      '<label class="field">单位<input id="ci-unit" placeholder="如：级 / ng/mL"></label>' +
      '<label class="field">类型<select id="ci-type"><option value="numeric">数值型</option><option value="choice">选择型</option><option value="text">文本型</option></select></label>' +
      '<label class="field">触发标签<input id="ci-tag" placeholder="如：甲状腺结节"></label>' +
      '<label class="field">来源<select id="ci-source"><option value="manual">手动录入</option><option value="ocr">报告识别</option></select></label>' +
      '<label class="field wide">阈值分档（数值型）<textarea id="ci-thr" rows="3" placeholder=\'JSON 数组，如 [{"value_min":0,"value_max":2,"level":"normal","tag":""},{"value_min":3,"level":"attention","tag":"甲状腺结节"}]  level 取值 normal/attention/abnormal/critical\'></textarea>' +
        '<i style="font-style:normal;font-size:12px;color:#999">数值型指标按录入值落入的区间判定：值满足 value_min ≤ 值 ≤ value_max 即命中该档，输出该档的 level（normal 正常 / attention 需关注 / abnormal 异常 / critical 危急）与 tag（触发标签，可留空）。</i></label>' +
      '<label class="field wide">选项映射（选择型）<textarea id="ci-ch" rows="3" placeholder=\'JSON 数组，如 [{"label":"无结节","level":"normal","tag":""},{"label":"TI-RADS 3","level":"attention","tag":"甲状腺结节"}]\'></textarea>' +
        '<i style="font-style:normal;font-size:12px;color:#999">选择型指标按录入值匹配选项：录入值等于哪个 label，就按该选项的 level 与 tag 判定；录入值未匹配任何 label 则不判定（不产生等级与标签）。</i></label>' +
      '</div><button type="button" class="btn primary" id="btn-ci-add">保存指标</button></div>';
  }
  function renderCustomTagTable() {
    var list = KB.customTags();
    if (!list.length) return '<div class="hint">暂无自定义标签。</div>';
    var rows = list.map(function (d, i) {
      return '<tr><td>' + esc(d.tag_name || '') + '</td><td>' + esc(d.tag_source || '') + '</td><td>' + esc(d.advice_title || '—') + '</td><td>' + esc(d.action_item || '—') + '</td><td>' + esc(d.action_deadline || '—') + '</td><td><button type="button" class="btn small gray" data-act="del-tag" data-i="' + i + '">删除</button></td></tr>';
    }).join('');
    return '<div class="kb-scroll"><table class="kb-table"><thead><tr><th>标签名</th><th>来源</th><th>建议标题</th><th>行动项</th><th>时限</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function customTagForm() {
    return '<div class="kb-card"><div class="kb-card-h">＋新增自定义标签</div><div class="cm-form">' +
      '<label class="field">标签名称<input id="ct-name" placeholder="4~8 字，不与已有标签重复"></label>' +
      '<label class="field">来源<input id="ct-src" value="自定义" placeholder="体检判定/打卡判定/报告解读/自定义"></label>' +
      '<label class="field">建议标题<input id="ct-atitle" placeholder="如：甲状腺结节随访"></label>' +
      '<label class="field">建议等级<select id="ct-alv"><option value="attention">需关注</option><option value="abnormal">异常</option><option value="critical">危急</option></select></label>' +
      '<label class="field wide">建议正文<textarea id="ct-acontent" rows="2" placeholder="管理建议正文，联动报告输出"></textarea></label>' +
      '<label class="field">行动项<input id="ct-action" placeholder="如：甲状腺超声随访"></label>' +
      '<label class="field">优先级<select id="ct-prio"><option value="3">3</option><option value="1">1</option><option value="2">2</option><option value="4">4</option><option value="5">5</option></select></label>' +
      '<label class="field">时限<input id="ct-when" placeholder="持续 或 +3月"></label>' +
      '</div><button type="button" class="btn primary" id="btn-ct-add">保存标签</button></div>';
  }
  function renderCustomMgr() {
    var h = '';
    h += '<div class="kb-card-h">自定义指标补录</div><p class="hint">适用于体检报告中超出系统预设 19 项以外的异常指标。自定义指标与预设指标同等参与判定、标签聚合、管理建议与行动清单联动。纯前端无 OCR 能力，报告识别以「手动录入」方式补录（来源可标记为报告识别）。</p>';
    h += renderCustomIndTable();
    h += customIndForm();
    h += '<div class="kb-sec">自定义标签</div><p class="hint">标签可关联管理建议与行动项，进入报告联动；名称不可与已有标签重复。</p>';
    h += renderCustomTagTable();
    h += customTagForm();
    h += '<p class="hint" id="cm-tip"></p>';
    return h;
  }
  function cmTip(msg) { var t = $('cm-tip'); if (t) t.textContent = msg; }
  function bindCustomMgr(host) {
    host.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act'), i = Number(btn.getAttribute('data-i'));
      if (act === 'del-ind') {
        var inds = KB.customIndicators();
        if (inds[i] && confirm('确定删除自定义指标「' + inds[i].indicator_name + '」？')) { inds.splice(i, 1); KB.customSave(KB.CUSTOM_KEYS.indicators, inds); renderKB('CUSTOM_MGR'); }
      } else if (act === 'del-tag') {
        var tags = KB.customTags();
        if (tags[i] && confirm('确定删除自定义标签「' + tags[i].tag_name + '」？')) { tags.splice(i, 1); KB.customSave(KB.CUSTOM_KEYS.tags, tags); renderKB('CUSTOM_MGR'); }
      }
    });
    var addInd = $('btn-ci-add');
    if (addInd) addInd.addEventListener('click', function () {
      var name = $('ci-name').value.trim(), code = $('ci-code').value.trim(), type = $('ci-type').value;
      if (!name || !code) { cmTip('请填写指标名称与代码。'); return; }
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(code)) { cmTip('指标代码须为英文字母开头，仅含字母/数字/下划线。'); return; }
      var inds = KB.customIndicators();
      if (inds.some(function (d) { return d.indicator_code === code; })) { cmTip('指标代码已存在，请更换。'); return; }
      var thr = [], ch = [];
      try { thr = $('ci-thr').value.trim() ? JSON.parse($('ci-thr').value) : []; } catch (e) { cmTip('阈值分档 JSON 解析失败，请检查格式。'); return; }
      try { ch = $('ci-ch').value.trim() ? JSON.parse($('ci-ch').value) : []; } catch (e) { cmTip('选项映射 JSON 解析失败，请检查格式。'); return; }
      inds.push({
        indicator_name: name, indicator_code: code,
        indicator_unit: $('ci-unit').value.trim(), indicator_type: type,
        trigger_tag: $('ci-tag').value.trim(), source: $('ci-source').value,
        thresholds: thr, choices: ch
      });
      KB.customSave(KB.CUSTOM_KEYS.indicators, inds);
      cmTip('已保存自定义指标「' + name + '」。在体检报告录入该指标后即可自动判定。');
      renderKB('CUSTOM_MGR');
    });
    var addTag = $('btn-ct-add');
    if (addTag) addTag.addEventListener('click', function () {
      var name = $('ct-name').value.trim();
      if (!name) { cmTip('请填写标签名称。'); return; }
      var dup = (KB.ADVICE && KB.ADVICE[name]) || KB.customTags().some(function (t) { return t.tag_name === name; });
      if (dup) { cmTip('标签已存在，请勿重复。'); return; }
      var tags = KB.customTags();
      tags.push({
        tag_name: name, tag_source: $('ct-src').value.trim() || '自定义',
        advice_title: $('ct-atitle').value.trim(), advice_level: $('ct-alv').value,
        advice_content: $('ct-acontent').value.trim(),
        action_item: $('ct-action').value.trim(),
        action_priority: Number($('ct-prio').value) || 3,
        action_deadline: $('ct-when').value.trim() || '+3月'
      });
      KB.customSave(KB.CUSTOM_KEYS.tags, tags);
      cmTip('已保存自定义标签「' + name + '」。');
      renderKB('CUSTOM_MGR');
    });
  }

  function renderKB(key) {
    var host = $('kb-body');
    if (key === 'KB_RULES') { host.innerHTML = renderKBRules(); return; }
    if (key === 'CUSTOM_MGR') { host.innerHTML = renderCustomMgr(); bindCustomMgr(host); return; }
    var data = KB[key];
    if (!data) { host.innerHTML = '<div class="hint">该子表暂未加载。</div>'; return; }
    var html = '';
    if (key === 'LIT_KNOWLEDGE') {
      var list = [];
      for (var k in data) if (data[k] && data[k].title) list.push(data[k]);
      html = list.map(renderLit).join('');
      html += '<div class="hint">以上知识依据您提供的临床指南 / 专家共识整理，共 ' + list.length + ' 类疾病主题。报告「管理建议」第 5 区块按客户异常标签自动引用对应条目。</div>';
    } else if (key === 'INDICATORS') {
      var rows = data.map(function (d) {
        var kind = d.kind === 'number' ? '数值' : (d.kind === 'select' ? '选项' : (d.kind === 'derived' ? '综合判定' : (d.kind || '')));
        return '<tr><td>' + esc(d.code) + '</td><td>' + esc(d.label) + '</td><td>' + esc(d.system || '') + '</td><td>' + esc(d.unit || '') + '</td><td>' + esc(kind) + '</td></tr>';
      }).join('');
      html = '<div class="kb-scroll"><table class="kb-table"><thead><tr><th>指标代码</th><th>指标名称</th><th>所属系统</th><th>单位</th><th>类型</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="hint">共 ' + data.length + ' 个指标，数值判定阈值详见「文献知识库」各疾病条目。</div>';
    } else if (key === 'ADVICE') {
      Object.keys(data).forEach(function (tag) {
        var a = data[tag]; var info = lvInfo(a.level);
        html += kbCard(kbHead(a.title, '触发标签：' + tag) +
          '<div class="kb-lv" style="color:' + esc(info.color) + '">' + esc(info.label) + '</div>' + kbP(a.text));
      });
      html += '<div class="hint">共 ' + Object.keys(data).length + ' 条管理建议，按客户触发标签自动调用。</div>';
    } else if (key === 'SEASON') {
      Object.keys(data).forEach(function (name) {
        var s = data[name];
        html += kbCard(kbHead(name, '适用月份：' + (s.months || []).join('、') + ' 月') + kbP(s.risks) +
          kbRow('饮食', s.diet) + kbRow('运动', s.exercise) + kbRow('自查', s.selfcheck));
      });
      html += '<div class="hint">共 ' + Object.keys(data).length + ' 个季节，报告按生成月份自动匹配。</div>';
    } else if (key === 'HIGH_PURINE') {
      data.forEach(function (g) { html += kbCard(kbHead(g.cat) + kbP(g.items)); });
      html += '<div class="hint">共 ' + data.length + ' 类高嘌呤食物，供高尿酸客户饮食宣教参考。</div>';
    } else if (key === 'FFR') {
      html += kbCard(kbHead('FFR 血流储备分数判定', '正常阈值 ≥0.8') +
        kbP('评估心肌缺血风险：FFR ≥0.8 表示血流功能状态良好；<0.8 提示存在心肌缺血风险，建议心内科专科评估。') +
        kbSec('可测量血管') + kbRow('左前降支', 'ffrLAD') + kbRow('左回旋支', 'ffrLCX') + kbRow('右冠状动脉', 'ffrRCA'));
    } else if (key === 'SAMPLE_MENU') {
      html = kbCard(kbHead('参考食谱', '基础能量 ' + (data.baseKcal || '') + ' kcal') +
        kbP('能量建议：按标准体重（身高cm-105）×25~30 测算每日能量摄入，可在此食谱基础上浮动。'));
      (data.meals || []).forEach(function (m) {
        html += kbCard(kbHead(m.name) + kbRow('食物', m.food) + kbRow('用量', m.amount));
      });
      html += '<div class="hint">共 ' + (data.meals || []).length + ' 餐次。</div>';
    } else if (key === 'LIFESTYLE_INTERVENTION') {
      data.forEach(function (g) { html += kbCard(kbHead(g.cat) + kbUl(g.items)); });
      html += '<div class="hint">共 ' + data.length + ' 类生活方式干预建议。</div>';
    } else if (Array.isArray(data)) {
      var rows2 = data.slice(0, 200).map(function (d) { return '<tr>' + Object.keys(d).slice(0, 6).map(function (k) { return '<td>' + esc(d[k]) + '</td>'; }).join('') + '</tr>'; }).join('');
      html = '<table class="kb-table"><thead><tr>' + Object.keys(data[0] || {}).slice(0, 6).map(function (k) { return '<th>' + esc(k) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows2 + '</tbody></table><div class="hint">共 ' + data.length + ' 条。</div>';
    } else if (typeof data === 'object') {
      var lines = Object.keys(data).map(function (k) { return esc(k) + '：' + esc(typeof data[k] === 'function' ? '（函数）' : data[k]); });
      html = '<div class="kb-card">' + lines.map(function (x) { return '<p class="kb-p">' + x + '</p>'; }).join('') + '</div>';
    } else {
      host.textContent = String(data); return;
    }
    host.innerHTML = html;
  }

  /* ================= 弹窗：分享链接 / 二维码 ================= */
  function shareCheckin(c) {
    var d = new Date();
    var month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    // v 版本戳：每次生成的打卡链接 URL 唯一，绕过微信等浏览器对旧版页面的缓存
    var rel = 'checkin.html?name=' + encodeURIComponent(c.name || '') + '&month=' + month + '&cid=' + encodeURIComponent(c.id) + '&v=' + Date.now();
    openShareModal('发打卡链接 / 二维码', rel);
  }
  /* v53 复查回传链接：默认指向报告日期所在公历季度，客户可在 retest.html 改季度+年份 */
  function shareRetest(c) {
    var d = new Date();
    var q = 'Q' + Math.floor(d.getMonth() / 3 + 1);
    var y = d.getFullYear();
    var rel = 'retest.html?name=' + encodeURIComponent(c.name || '') + '&q=' + q + '&y=' + y + '&cid=' + encodeURIComponent(c.id) + '&v=' + Date.now();
    openShareModal('发复查链接 / 二维码', rel);
  }
  /* v53 复查数据回传码解析（解析 retest.html gather() 生成的对象） */
  function parseRetestText(text) {
    var tokens = String(text || '').split(/[^A-Za-z0-9+/=]+/).filter(function (t) { return t.length > 10; });
    var placed = 0, failed = 0, names = {}, qKeys = {};
    tokens.forEach(function (token) {
      var data;
      try { data = JSON.parse(decodeURIComponent(escape(atob(token.trim())))); } catch (e) { failed++; return; }
      /* 单条或批量：与 parseImportText 同款惯例 */
      var arr = Array.isArray(data) ? data : (data.retests ? data.retests : [data]);
      arr.forEach(function (src) {
        if (!src || !src.qKey) return;
        var qKey = src.qKey;
        /* 健管师端归档：若回传码带 cid 且与当前客户一致，使用回传码里的 cid；否则仅按姓名匹配 */
        var ck = {
          cid: src.cid || '',
          name: src.name || '',
          qKey: qKey,
          quarter: src.quarter || qKey.split('_')[0],
          year: src.year || Number(qKey.split('_')[1]) || new Date().getFullYear(),
          date: src.date || '',
          metrics: src.metrics || {},
          bp: src.bp || ((src.metrics && src.metrics.sbp != null && src.metrics.dbp != null) ? (src.metrics.sbp + '/' + src.metrics.dbp) : ''),
          rawText: src.rawText || '',
          submittedAt: src.submittedAt || new Date().toISOString()
        };
        if (placeRetest(ck)) { placed++; if (ck.name) names[ck.name] = 1; qKeys[qKey] = 1; }
        else failed++;
      });
    });
    return { tokens: tokens, placed: placed, failed: failed, names: names, qKeys: Object.keys(qKeys) };
  }
  /* 把 retest 数据写入 state.work.retests[qKey]；已存在则覆盖（保留历史时不重复增加） */
  function placeRetest(rt) {
    if (!state.work || !rt || !rt.qKey) return false;
    state.work.retests = state.work.retests || {};
    state.work.retests[rt.qKey] = rt;
    saveWork(); return true;
  }
  /* v55 复查单 15 项基础指标白名单（与 SNAP_SPEC / retest.html 表单一致；排除体检建档才有的 hdl/hba1c/同型半胱氨酸 等） */
  var RETEST_METRIC_CODES = ['sbp', 'dbp', 'weight', 'hr', 'fpg', 'tc', 'ldl', 'tg', 'waist', 'ua', 'vitd', 'bmd', 'cyfra21', 'ggt', 'egfr'];

  /* 共享：ExtractEngine 抽取结果 → 归档到 retests[qKey]；status/resBox 可空 */
  function runRetestFromPayload(payload, q, y, rawText, source, status, resBox) {
    if (!state.work) { if (status) status.textContent = '请先在「客户管理」选择客户'; return false; }
    var metrics = {};
    (payload.results || []).forEach(function (r) {
      if (r && RETEST_METRIC_CODES.indexOf(r.code) >= 0 && r.value != null && r.value !== '') metrics[r.code] = r.value;
    });
    var keys = Object.keys(metrics);
    if (!keys.length) {
      if (status) status.textContent = '未能识别到任何基础指标，请确认报告内容或切换为手动录入';
      if (resBox) resBox.innerHTML = '<div class="hint">识别 0 项。可识别指标：收缩压/舒张压/体重/心率/空腹血糖/总胆固醇/LDL/甘油三酯/腰围/尿酸/25羟维生素D/骨密度T值/CYFRA21-1/GGT/eGFR。</div>';
      return false;
    }
    var bp = (metrics.sbp != null && metrics.dbp != null) ? (metrics.sbp + '/' + metrics.dbp) : '';
    var rt = {
      cid: state.work.id, name: state.work.name,
      qKey: q + '_' + y, quarter: q, year: y,
      date: new Date().toISOString().slice(0, 10),
      metrics: metrics, bp: bp, rawText: rawText || '',
      submittedAt: new Date().toISOString(),
      source: source
    };
    placeRetest(rt);
    if (status) status.textContent = '已归档到 ' + rt.qKey + ' · 识别 ' + keys.length + ' 项指标';
    if (resBox) {
      var html = '<div class="ck-detail" style="margin-top:8px"><b>识别结果：</b>';
      (payload.results || []).forEach(function (r) {
        if (metrics[r.code] != null) {
          html += '<span class="ck-item"><b>' + esc(r.label || r.code) + '</b> ' + esc(String(r.value)) + (r.unit ? ' ' + esc(r.unit) : '') + '</span>';
        }
      });
      html += '</div>';
      resBox.innerHTML = html;
    }
    renderRetestList();
    return true;
  }
  function retestQuarterFields() {
    var d = new Date();
    var qEl = $('retest-paste-q'), yEl = $('retest-paste-y');
    if (qEl && !qEl.value) qEl.value = 'Q' + Math.floor(d.getMonth() / 3 + 1);
    if (yEl && !yEl.value) yEl.value = d.getFullYear();
    return { q: qEl ? qEl.value : '', y: yEl ? Number(yEl.value) : NaN, qEl: qEl, yEl: yEl };
  }
  function extractFrom(raw) {
    var EXA = (window.ExtractEngine && ExtractEngine.extract) ? ExtractEngine : (EX && EX.extract ? EX : null);
    return EXA ? EXA.extract(raw) : { results: [], meta: {} };
  }
  /* v53 健管师粘贴复查报告文本 → ExtractEngine 抽取 → 写入 retests[qKey] */
  function applyRetestFromText() {
    var ta = $('retest-paste-text'), status = $('retest-paste-status'), resBox = $('retest-paste-result');
    var raw = (ta && ta.value) || '';
    if (!raw.trim()) { if (status) status.textContent = '请先粘贴复查报告文本'; return; }
    var qf = retestQuarterFields();
    if (!/^Q[1-4]$/.test(qf.q) || !/^\d{4}$/.test(String(qf.y))) { if (status) status.textContent = '请确认季度与年份'; return; }
    runRetestFromPayload(extractFrom(raw), qf.q, qf.y, raw, 'paste', status, resBox);
  }
  /* v55 健管师上传复查单图片/PDF/Word → OCR/文本识别 → 写入 retests[qKey] */
  function runRetestUpload() {
    if (!state.work) { alert('请先在「客户管理」选择客户'); return; }
    var fileEl = $('retest-file'), status = $('retest-upload-status'), resBox = $('retest-upload-preview');
    var file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) { if (status) status.textContent = '请先选择复查单照片 / 文件'; return; }
    var qf = retestQuarterFields();
    if (!/^Q[1-4]$/.test(qf.q) || !/^\d{4}$/.test(String(qf.y))) { if (status) status.textContent = '请确认季度与年份'; return; }
    if (status) status.textContent = '处理中…（图片首次识别需联网加载引擎，请稍候）';
    if (resBox) resBox.innerHTML = '';
    var EXA = (window.ExtractEngine && ExtractEngine.fileToText) ? ExtractEngine : (EX && EX.fileToText ? EX : null);
    if (!EXA) { if (status) status.textContent = '识别引擎未加载，请刷新页面后重试或改用文本粘贴'; return; }
    EXA.fileToText(file, function (s) { if (status) status.textContent = s; }).then(function (res) {
      var txt = (res && res.text) || '';
      if (!txt || !txt.trim()) { if (status) status.textContent = '未读取到文字（图片需联网 OCR，建议换清晰照片重试或改用文本粘贴）。'; return; }
      runRetestFromPayload(extractFrom(txt), qf.q, qf.y, txt, 'ocr', status, resBox);
    }).catch(function (e) {
      if (status) status.textContent = '❌ 识别失败：' + (e && e.message ? e.message : e) + '。可改用文本粘贴或客户回传码。';
    });
  }
  /* 健管师粘贴回传码导入复查 */
  function importRetestFromArea() {
    var input = $('retest-import-input'), status = $('retest-import-status');
    if (!input) return;
    var text = (input.value || '').trim();
    if (!text) { if (status) status.textContent = '请先粘贴客户发来的复查回传码或数据链接'; return; }
    var r = parseRetestText(text);
    if (!r.tokens.length) { if (status) status.textContent = '未识别到回传码，请确认已完整复制'; return; }
    var msg = '已导入 ' + r.placed + ' 份复查';
    var qs = r.qKeys || [];
    if (qs.length) msg += '（' + qs.join('、') + '）';
    if (r.failed) msg += '；' + r.failed + ' 段无法解析';
    if (status) status.textContent = msg;
    if (r.placed) { input.value = ''; renderRetestList(); }
  }
  /* 当季已上传复查列表（按客户档案 retests 全部列出，按 qKey 排序） */
  function renderRetestList() {
    var host = $('retest-list');
    if (!host) return;
    if (!state.work) { host.innerHTML = ''; return; }
    var rs = state.work.retests || {};
    var keys = Object.keys(rs).sort();
    if (!keys.length) { host.innerHTML = '<div class="hint">尚未上传任何复查。可通过上方文本粘贴或客户回传码录入。</div>'; return; }
    var html = '<div class="card"><legend>已上传的复查检查单</legend>';
    keys.forEach(function (k) {
      var r = rs[k];
      var src = r.source === 'paste' ? '健管师粘贴' : (r.source === 'ocr' ? '健管师上传识别' : (r.cid === state.work.id ? '客户提交（已归档）' : '客户提交'));
      var m = r.metrics || {};
      var items = Object.keys(m).map(function (code) {
        var labelMap = { sbp: '收缩压', dbp: '舒张压', weight: '体重', hr: '心率', fpg: '空腹血糖', tc: '总胆固醇', ldl: 'LDL', tg: '甘油三酯', waist: '腰围', ua: '尿酸', vitd: '25羟维生素D', bmd: '骨密度T值', cyfra21: 'CYFRA21-1', ggt: 'GGT', egfr: 'eGFR' };
        return '<span class="ck-item"><b>' + (labelMap[code] || code) + '</b> ' + esc(String(m[code])) + '</span>';
      }).join('');
      var bp = r.bp || (m.sbp != null && m.dbp != null ? m.sbp + '/' + m.dbp : '');
      if (bp) items = '<span class="ck-item"><b>血压</b> ' + esc(bp) + ' mmHg</span>' + items;
      html += '<div class="ck-h"><b>' + esc(k) + ' · 复查日期 ' + esc(r.date || '—') + '</b><span class="ck-src">' + esc(src) + (r.submittedAt ? ' · ' + esc(String(r.submittedAt).slice(0, 10)) : '') + '</span></div>' +
        '<div class="ck-detail">' + (items || '<span class="hint">无识别指标（仅原文）</span>') + '</div>';
    });
    html += '</div>';
    host.innerHTML = html;
  }
  function bindRetest() {
    $('btn-share-retest').addEventListener('click', function () { if (state.work) shareRetest(state.work); });
    $('btn-list-retests').addEventListener('click', function () { retestQuarterFields(); renderRetestList(); });
    $('btn-retest-paste-apply').addEventListener('click', applyRetestFromText);
    $('btn-retest-import-apply').addEventListener('click', importRetestFromArea);
    $('btn-retest-upload-run').addEventListener('click', runRetestUpload);
  }
  function detectBaseURL() {
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        var p = location.pathname.replace(/[^/]*$/, '');
        return location.origin + p;
      }
    } catch (e) {}
    return '';
  }
  function rebuildShareLink() {
    var relLink = window._shareRelLink || '';
    var base = ($('qn-host').value || '').trim().replace(/\/+$/, '');
    $('qn-link').value = base ? base + '/' + relLink.replace(/^\//, '') : relLink;
    var tip = $('qn-tip');
    if (tip) {
      var finalLink = $('qn-link').value;
      var proto = 'file:';
      try { if (typeof location !== 'undefined' && location && location.protocol) proto = location.protocol; } catch (e) {}
      tip.style.display = (/^file:/i.test(proto) && !/^https?:\/\//i.test(finalLink)) ? 'block' : 'none';
    }
  }
  function openShareModal(title, relLink) {
    $('qn-title').textContent = title;
    window._shareRelLink = relLink;
    var hostInput = $('qn-host');
    // 优先用用户上次填写的服务端地址；没有且页面本身从 http(s) 打开时，自动推断当前部署地址
    var saved = '';
    try { saved = localStorage.getItem('bz_share_host') || ''; } catch (e) {}
    if (!saved) {
      var auto = detectBaseURL();
      if (auto) saved = auto;
    }
    if (saved) hostInput.value = saved; // 两者都空时保留输入框当前值
    rebuildShareLink();
    $('qn-qr').innerHTML = '';
    $('qn-modal').style.display = 'flex';
  }
  function bindModals() {
    $('qn-close').addEventListener('click', function () { $('qn-modal').style.display = 'none'; });
    $('qn-copy').addEventListener('click', function () { $('qn-link').select(); document.execCommand('copy'); });
    $('qn-host').addEventListener('input', function () {
      try { localStorage.setItem('bz_share_host', this.value); } catch (e) {}
      rebuildShareLink();
    });
    $('qn-gen').addEventListener('click', function () {
      rebuildShareLink();
      var host = $('qn-qr'); host.innerHTML = '';
      if (window.QRCode) { try { new window.QRCode(host, { text: $('qn-link').value, width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.L }); } catch (e) { host.innerHTML = '<span class="hint">二维码生成失败，请复制链接。</span>'; } }
      else host.innerHTML = '<span class="hint">未加载二维码库，请复制链接。</span>';
    });
    $('rep-close').addEventListener('click', function () { $('rep-modal').style.display = 'none'; });
    $('rep-delete').addEventListener('click', function () {
      var ctx = window._repCtx; if (!ctx) return;
      var c = CM.get(ctx.custId); var rp = (c && c.reports || [])[ctx.idx];
      if (!confirm('确定删除这份 ' + ((rp && rp.type === 'A') ? 'A版' : 'B版') + ' 报告（' + (rp && rp.at || '') + '）？删除后不可恢复。')) return;
      CM.removeReport(ctx.custId, ctx.idx);
      window._repView = null; window._repCtx = null;
      $('rep-modal').style.display = 'none';
      renderCustList(); renderCustPicker();
      if (window._repListCust === ctx.custId && $('rep-list-modal').style.display === 'flex') openReportList(ctx.custId);
    });
    $('rep-list-close').addEventListener('click', function () { $('rep-list-modal').style.display = 'none'; });
    $('rep-export').addEventListener('click', function () {
      if (!window._repView) return;
      if (!window._repView.html) { alert('该报告正文已清理，无法导出。请重新生成报告。'); return; }
      exportHtml('历史报告_' + (window._repView.name || ''), window._repView.html);
    });
    $('storage-close').addEventListener('click', function () { $('storage-modal').style.display = 'none'; });
    $('ck-close').addEventListener('click', function () { $('ck-modal').style.display = 'none'; });
    $('ck-save').addEventListener('click', saveCheckinEditor);
  }

  /* ================= 弹窗：历史报告预览 / 列表管理 ================= */
  function openReportHistory(custId, idx) {
    var c = CM.get(custId); if (!c) return;
    var rp = (c.reports || [])[idx]; if (!rp) return;
    window._repView = rp;
    window._repCtx = { custId: custId, idx: idx };
    if (rp.html) {
      $('rep-view').innerHTML = '<style>' + RG.commonCSS() + '</style><div class="rp-root">' + rp.html + '</div>';
    } else {
      $('rep-view').innerHTML = '<div class="hint" style="padding:28px;font-size:14px">该报告正文已随「清理历史报告正文」移除以节省浏览器存储空间，仅保留记录（' +
        esc((rp.type || '') + ' · ' + (rp.at || '')) + '）。如需查看，可在「解读/报告」页重新生成，或在「历史报告」中删除此条记录。' +
        '</div>';
    }
    $('rep-modal').style.display = 'flex';
  }

  /* 打开某客户的历史报告列表：查阅 / 导出 / 删除单份 */
  function openReportList(custId) {
    var c = CM.get(custId); if (!c) return;
    window._repListCust = custId;
    $('rep-list-cust').textContent = (c.name || '未命名') + ' 的历史报告（' + (c.reports || []).length + ' 份）';
    var host = $('rep-list-view'); host.innerHTML = '';
    var rps = c.reports || [];
    if (!rps.length) {
      host.innerHTML = '<div class="hint">该客户暂无历史报告。生成 A/B 版报告后会自动存档于此，可在此查阅、导出或删除。</div>';
      $('rep-list-modal').style.display = 'flex';
      return;
    }
    rps.forEach(function (rp, i) {
      var hasHtml = !!(rp && rp.html);
      var size = hasHtml ? Math.max(1, Math.round(rp.html.length / 1024)) : 0;
      var row = el('div', 'rep-list-row');
      row.dataset.i = i;
      row.innerHTML =
        '<span class="no">' + (i + 1) + '</span>' +
        '<span class="meta"><b>' + (rp.type === 'A' ? 'A版' : 'B版') + '</b> · ' + esc(rp.at || '') +
        (rp.name ? ' · ' + esc(rp.name) : '') + '</span>' +
        '<span class="stat' + (hasHtml ? '' : ' gray') + '">' + (hasHtml ? '正文 ' + size + ' KB' : '正文已清理') + '</span>' +
        '<span class="row" style="gap:6px;flex:none">' +
          '<button class="btn small" data-a="view">查看</button>' +
          '<button class="btn small" data-a="export">导出</button>' +
          '<button class="btn small danger" data-a="del">删除</button>' +
        '</span>';
      host.appendChild(row);
    });
    host.querySelectorAll('[data-a]').forEach(function (b) {
      var i = Number(b.closest('.rep-list-row').dataset.i);
      var rp = rps[i];
      b.addEventListener('click', function () {
        var act = b.dataset.a;
        if (act === 'view') { openReportHistory(custId, i); return; }
        if (act === 'export') {
          if (!rp || !rp.html) { alert('该报告正文已清理，无法导出。请重新生成报告。'); return; }
          exportHtml('历史报告_' + (rp.name || ''), rp.html);
          return;
        }
        if (act === 'del') {
          if (!confirm('确定删除这份 ' + (rp.type === 'A' ? 'A版' : 'B版') + ' 报告（' + (rp.at || '') + '）？删除后不可恢复。')) return;
          CM.removeReport(custId, i);
          openReportList(custId);
          renderCustList(); renderCustPicker();
        }
      });
    });
    $('rep-list-modal').style.display = 'flex';
  }

  /* ================= 导出 / 打印 辅助 ================= */
  function exportHtml(name, html) {
    var full = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(name) + '</title><style>' +
      RG.commonCSS() + RG.printCSS() + '</style></head><body><div class="rp-root">' + html + '</div></body></html>';
    var blob = new Blob(['﻿', full], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob); var a = document.createElement('a');
    a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '') + '.html';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function printHtml(html) {
    // 改用 Blob URL（显式 UTF-8 BOM + charset），避免部分浏览器对 about:blank + document.write 的编码误判导致中文乱码
    var full = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>报告</title><style>' +
      RG.commonCSS() + RG.printCSS() + '</style></head><body><div class="rp-root">' + html + '</div></body></html>';
    var blob = new Blob(['﻿', full], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var w = window.open(url, '_blank');
    if (!w) { // 弹窗被拦截时降级为当前页 iframe 打印
      var ifr = document.createElement('iframe');
      ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(ifr);
      ifr.src = url;
      ifr.onload = function () { ifr.contentWindow.focus(); ifr.contentWindow.print(); setTimeout(function () { document.body.removeChild(ifr); URL.revokeObjectURL(url); }, 30000); };
      return;
    }
    w.addEventListener('load', function () {
      setTimeout(function () { w.focus(); w.print(); }, 300);
    });
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* v3 Plan B 补基线对外入口（供后续 UI / 测试调用） */
  window.BesjuPlanB = { importPlanB: importPlanB };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
