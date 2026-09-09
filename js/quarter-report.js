/* =============================================================
 * 季度小结报告生成器 quarter-report.js
 * 依据《第X季度小结汇总》模板渲染：
 * 封面 → 目录 → 01 本季度健康快照 → 02 健康洞察与改善建议
 * → 03 季节性健康提示 → 04 本季度行动清单 → 05 健康寄语
 * 支持浏览器打印（PDF）与导出 Word(.doc)
 * ============================================================= */
(function (global) {
  'use strict';
  var KB = global.KB, RG = global.ReportGen;

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function lc(level) { return level ? level.color : '#666'; }
  var CN_NO = ['一', '二', '三', '四', '五', '六', '七', '八'];

  /* ---------------- 正文 ---------------- */
  function reportBody(r) {
    var c = r.customer || {};
    var b = KB.BRAND;
    var q = r.quarterInfo || {};
    var qName = (c.quarter || 'Q1');
    var qCn = /^S(\d+)$/.test(qName)
      ? ('第' + Number(qName.slice(1)) + '个服务季度')
      : ({ Q1: '第一季度', Q2: '第二季度', Q3: '第三季度', Q4: '第四季度' }[qName] || (qName + ' 季度'));
    var honor = (c.gender === '女') ? '女士' : '先生';
    var dateText = c.reportDate || new Date().toISOString().slice(0, 10);

    var chapters = [
      '01 本季度健康快照',
      '02 健康洞察与改善建议',
      '03 季节性健康提示',
      '04 本季度行动清单',
      '05 健康寄语'
    ];

    var html = '';

    /* ===== 封面（统一模板，仅标题与 AB 报告不同：X季度小结汇总） ===== */
    html += RG.coverHtml({ title: qCn + '小结汇总', customer: c, date: dateText });

    /* ===== 目录 ===== */
    html += '<div class="rp-page"><div class="rp-contents"><h2>目 录 · CONTENTS</h2><ul>';
    chapters.forEach(function (ch, i) {
      html += '<li><span>' + esc(ch) + '</span><span class="dot"></span><span>' + (i + 3) + '</span></li>';
    });
    html += '</ul></div></div>';

    /* ===== PART 01 本季度健康快照 ===== */
    html += '<div class="rp-page">';
    html += sec('01', '一、本季度健康快照', 'PART 01 · QUARTERLY HEALTH SNAPSHOT');
    html += basicInfo(r);
    html += '<div class="qr-note">核心健康问题：' + esc(r.baseline.coreIssues || autoCoreIssues(r)) +
      '。服务季度：' + esc(qName + ' / ' + (c.quarterYear || new Date().getFullYear())) + '。</div>';
    html += '<div class="qr-note">数据来源说明：本报告数据来源于' + esc(r.baseline.source || '体检报告') +
      '、基线健康评估、月度打卡表反馈及季度自填表。本季度有打卡或新体检的指标方列入快照对比；无当季检测的基线指标不再单列。生活方式基线值取自本季度首次月度打卡（体重基线直接引用体检报告体重数值），变化趋势为首次打卡与季度均值对比。</div>';
    html += snapshotTable(r);
    html += checkinTrend(r);
    html += newSymptomsBlock(r);
    if (r.baseline && r.baseline.ab && r.baseline.ab.trim()) {
      html += '<div class="qr-note"><b>基线参考（客户提供《体检报告解读汇总及健康规划》A/B 版）：</b><br>' + nl2br(r.baseline.ab) + '</div>';
    }
    html += '<div class="qr-foot">注：季度报告聚焦生活方式与关键指标跟踪；颈动脉内膜、甲状腺结节、骨密度等超声及影像评估内容集中在年度总结报告中呈现。</div>';
    html += '</div>';

    /* ===== PART 02 健康洞察与改善建议 ===== */
    html += '<div class="rp-page">';
    html += sec('02', '二、健康洞察与改善建议', 'PART 02 · HEALTH INSIGHTS & IMPROVEMENT');
    (r.insights || []).forEach(function (ins, i) {
      html += '<div class="qr-ins">';
      html += '<div class="qr-ins-h">' + CN_NO[i] + '、' + esc(ins.title) +
        (ins.triggers && ins.triggers.length ? '<em>触发：' + esc(ins.triggers.join('、')) + '</em>' : '') + '</div>';
      html += '<div class="qr-ins-lead">' + esc(ins.lead) + '</div>';
      html += '<table class="rp-tb qr-tb"><thead><tr><th style="width:8%">序号</th><th style="width:24%">建 议</th><th>具 体 说 明</th></tr></thead><tbody>';
      ins.items.forEach(function (it, k) {
        html += '<tr><td class="qr-c">' + (k + 1) + '</td><th>' + esc(it.t) + '</th><td>' + esc(it.d) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    /* 客户提问解答 */
    if (r.qna && r.qna.length) {
      html += '<div class="qr-ins"><div class="qr-ins-h">' + CN_NO[(r.insights || []).length] + '、本季度您关注的问题</div>';
      r.qna.forEach(function (x, i) {
        html += '<div class="qr-qa"><div class="qr-q"><b>Q' + (i + 1) + '（' + esc(x.month) + '）</b>' + esc(x.q) + '</div>' +
          '<div class="qr-a"><b>A</b>' + nl2br(x.a) + (x.auto ? '<i class="qr-auto">规则引擎草稿 · 建议私人医生复核</i>' : '') + '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    /* ===== PART 03 季节性健康提示 ===== */
    html += '<div class="rp-page">';
    html += sec('03', '三、季节性健康提示', 'PART 03 · SEASONAL HEALTH TIPS');
    var sd = r.season.data;
    html += '<div class="qr-season-h"><span class="qr-season-badge">' + esc(q.label || '') + '</span>' +
      esc((q.label || '') + '（' + (c.quarter || '') + '：' + (q.range || '') + '）健康提示') + '</div>';
    html += '<table class="rp-tb qr-tb"><thead><tr><th style="width:22%">提 示 项 目</th><th>具 体 内 容</th></tr></thead><tbody>' +
      '<tr><th>当季风险提醒</th><td>' + esc(sd.risks) + '</td></tr>' +
      '<tr><th>饮食建议</th><td>' + esc(sd.diet) + '</td></tr>' +
      '<tr><th>运动建议</th><td>' + esc(sd.exercise) + '</td></tr>' +
      '<tr><th>症状自查要点</th><td>' + esc(sd.selfcheck) + '</td></tr>' +
      '</tbody></table>';
    html += '</div>';

    /* ===== PART 04 本季度行动清单 ===== */
    html += '<div class="rp-page">';
    html += sec('04', '四、本季度行动清单', 'PART 04 · QUARTERLY ACTION PLAN');
    html += '<div class="qr-ins-lead">基于本季度打卡数据、基线体检结果与规则引擎判定，自动生成以下重点行动计划。</div>';
    html += '<table class="rp-tb qr-tb"><thead><tr><th style="width:7%">序号</th><th style="width:22%">行 动 项</th><th>具 体 目 标</th><th style="width:16%">建议完成时间</th><th style="width:9%">状态</th></tr></thead><tbody>';
    if ((r.actions || []).length) {
      r.actions.forEach(function (a) {
        html += '<tr><td class="qr-c">' + a.no + '</td><th>' + esc(a.action) + '</th><td>' + esc(a.goal) + '</td><td>' + esc(a.when) + '</td><td class="qr-c qr-status">' + esc(a.status) + '</td></tr>';
      });
    } else {
      html += '<tr><td colspan="5" class="qr-c" style="color:#999">各项指标与生活方式执行良好，本季度以维持现有方案为主。</td></tr>';
    }
    html += '</tbody></table>';

    html += '<div class="qr-sub-h">随访安排确认</div>';
    html += '<table class="rp-tb qr-tb"><thead><tr><th style="width:28%">项 目</th><th>安 排</th></tr></thead><tbody>';
    (r.followups || []).forEach(function (f) {
      html += '<tr><th>' + esc(f.item) + '</th><td>' + esc(f.arrange) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<div class="qr-sub-h">需重点跟进事项</div><div class="qr-focus">';
    (r.keyFocus || []).forEach(function (k, i) {
      html += '<span class="qr-focus-i">' + '①②③④⑤'.charAt(i) + ' ' + esc(k) + '</span>';
    });
    if (!(r.keyFocus || []).length) html += '<span class="qr-focus-i" style="color:#999">本季度无特别跟进事项</span>';
    html += '</div>';
    html += '</div>';

    /* ===== PART 05 健康寄语 ===== */
    html += '<div class="rp-page">';
    html += sec('05', '五、健康寄语', 'PART 05 · HEALTH MESSAGE');
    html += '<div class="rp-message">' + nl2br(r.message) + '</div>';
    html += '<div class="qr-sign">您的健康管理团队<br><span>' + esc(dateText) + '</span></div>';
    html += '</div>';

    return html;
  }

  /* ---------------- 区块构件 ---------------- */
  function sec(no, cn, en) {
    return '<div class="rp-sec"><span class="rp-sec-no">' + no + '</span><div class="rp-sec-tt"><b>' + esc(cn) + '</b><i>' + esc(en) + '</i></div></div>';
  }
  function autoCoreIssues(r) {
    var xs = (r.base.results || []).filter(function (x) {
      return x.level === KB.LEVEL.ATTENTION || x.level === KB.LEVEL.ABNORMAL || x.level === KB.LEVEL.CRITICAL;
    }).map(function (x) { return x.label + x.phrase; });
    return xs.length ? xs.slice(0, 5).join('、') : '各项基线指标基本正常';
  }
  function basicInfo(r) {
    var m = (r.baseline && r.baseline.metrics) || {}, c = r.customer || {}, agg = r.agg || {};
    var h = m.height, w = (agg.weight != null ? agg.weight : (m.weight != null ? m.weight : c.baseline_weight));
    var bmi = (h && w) ? (Number(w) / Math.pow(Number(h) / 100, 2)).toFixed(2) : '—';
    var hr = (agg.hr != null ? agg.hr : m.hr);
    var sbp = (agg.sbp != null ? agg.sbp : m.sbp), dbp = (agg.dbp != null ? agg.dbp : m.dbp);
    var rows = [
      ['年 龄', (c.age != null && c.age !== '' ? c.age + ' 岁' : '—'), '心 率', (hr != null && hr !== '' ? hr + ' 次/分' : '—')],
      ['身 高', (h ? h + ' cm' : '—'), '体 重', (w ? w + ' kg' : '—')],
      ['腰 围', (m.waist != null && m.waist !== '' ? m.waist + ' cm' : '—'), 'B M I', (bmi + ' kg/m²')],
      ['收 缩 压', (sbp != null && sbp !== '' ? sbp + ' mmHg' : '—'), '舒 张 压', (dbp != null && dbp !== '' ? dbp + ' mmHg' : '—')]
    ];
    var t = '<div class="rp-basic"><div class="rp-basic-h">基 本 信 息 · BASIC INFORMATION</div><table class="rp-tb"><tbody>';
    rows.forEach(function (x) { t += '<tr><th>' + x[0] + '</th><td>' + x[1] + '</td><th>' + x[2] + '</th><td>' + x[3] + '</td></tr>'; });
    t += '</tbody></table></div>';
    return t;
  }
  function snapshotTable(r) {
    var groups = [
      { name: '基础指标', rows: r.snapshot.filter(function (x) { return x.group === '基础指标'; }) },
      { name: '生活方式（月度打卡聚合）', rows: r.snapshot.filter(function (x) { return x.group === '生活方式'; }) }
    ];
    var html = '';
    groups.forEach(function (g) {
      if (!g.rows.length) return;
      /* 基础指标：逐行隐藏正常项 + 本季度无数据项（hasQ=false）——仅显示当季有跟踪内容的非正常项；全无则整组不显示 */
      if (g.name === '基础指标') {
        g.rows = g.rows.filter(function (x) {
          return x.level && x.level !== KB.LEVEL.NORMAL && x.hasQ !== false;
        });
        if (!g.rows.length) return;
      }
      html += '<div class="qr-sub-h">' + esc(g.name) + '</div>';
      html += '<table class="rp-tb qr-tb qr-snap"><thead><tr>' +
        '<th style="width:17%">指 标</th><th style="width:15%">基线值</th><th style="width:16%">本季度值</th>' +
        '<th style="width:12%">变化趋势</th><th>评估标准</th><th style="width:17%">数据来源</th>' +
        '</tr></thead><tbody>';
      g.rows.forEach(function (x) {
        html += '<tr>' +
          '<th>' + esc(x.label) + (x.unit ? '<i>(' + esc(x.unit) + ')</i>' : '') + '</th>' +
          '<td>' + esc(x.baseline) + '</td>' +
          '<td><b>' + esc(x.quarter) + '</b></td>' +
          '<td style="color:' + lc(x.trendLevel) + '">' + esc(x.trend) + '</td>' +
          '<td style="color:' + lc(x.level) + '">' + esc(x.standard) + (x.level ? '（' + esc(x.level.label) + '）' : '') + '</td>' +
          '<td class="qr-src">' + esc(x.source) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    });
    html += '<div class="qr-stat">状态统计：' +
      '<span style="color:' + KB.LEVEL.NORMAL.color + '">正常 ' + r.stat.normal + '</span> · ' +
      '<span style="color:' + KB.LEVEL.ATTENTION.color + '">需关注 ' + r.stat.attention + '</span> · ' +
      '<span style="color:' + KB.LEVEL.ABNORMAL.color + '">异常 ' + r.stat.abnormal + '</span> · ' +
      '<span style="color:' + KB.LEVEL.REVIEW.color + '">待复查 ' + r.stat.review + '</span>　|　' +
      '打卡完成：' + r.agg.filled + ' / 3 个月　|　触发规则标签 ' + r.tags.length + ' 项</div>';
    return html;
  }
  /* 月度打卡趋势（纯 CSS 条形，打印友好） */
  function checkinTrend(r) {
    var ms = (r.agg && r.agg.months) || [];
    if (!ms.length) return '<div class="qr-foot">尚未录入本季度月度打卡数据，生活方式部分显示为"待填写"。</div>';
    var html = '<div class="qr-sub-h">月度打卡趋势</div><table class="rp-tb qr-tb"><thead><tr>' +
      '<th style="width:16%">月份</th><th style="width:28%">周运动量</th><th style="width:24%">睡眠</th><th style="width:14%">体重</th><th>症状反馈</th>' +
      '</tr></thead><tbody>';
    ms.forEach(function (m) {
      html += '<tr><th>' + esc(m.month) + '</th>' +
        '<td>' + bar(m.weekMin, 300, (m.weekMin != null ? Math.round(m.weekMin) + ' 分钟' : '—'), m.weekMin >= 150) + '</td>' +
        '<td>' + bar(m.sleep, 10, (m.sleep != null ? m.sleep.toFixed(1) + ' 小时' : '—'), m.sleep >= 7) + '</td>' +
        '<td>' + (m.weight != null ? m.weight + ' kg' : '—') + '</td>' +
        '<td>' + (m.symptoms && m.symptoms.length ? esc(m.symptoms.join('、')) : '<span style="color:#2E9E5B">无不适</span>') + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  function bar(v, max, text, good) {
    if (v == null) return '—';
    var pct = Math.max(4, Math.min(100, Math.round(Number(v) / max * 100)));
    var color = good ? '#2E9E5B' : '#E8941A';
    return '<div class="qr-bar"><i style="width:' + pct + '%;background:' + color + '"></i><span>' + esc(text) + '</span></div>';
  }
  /* 新发症状与就医记录：客户在月度打卡/问卷中填写的文本，逐月列出 */
  function newSymptomsBlock(r) {
    var ns = (r.agg && r.agg.newSymptoms) || [];
    if (!ns.length) return '';
    var html = '<div class="qr-sub-h">新发症状与就医记录</div>';
    ns.forEach(function (n) {
      html += '<div class="qr-note" style="border-left-color:#E8941A"><b>' + esc(n.month) + '：</b>' + esc(n.text) + '</div>';
    });
    return html;
  }

  /* ---------------- 预览 / 导出 ---------------- */
  function buildPreview(r) {
    return '<style>' + RG.commonCSS() + QUARTER_CSS() + RG.printCSS() + '</style><div class="rp-root">' + reportBody(r) + '</div>';
  }
  function exportWord(r, filename) {
    var doc = RG.wrapWord('季度小结汇总', '<style>' + RG.commonCSS() + QUARTER_CSS() + '</style>', reportBody(r));
    var blob = new Blob(['\ufeff', doc], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var c = r.customer || {};
    a.href = url;
    a.download = (filename || ((c.quarter || 'Q') + '季度小结汇总_' + (c.name || ''))).replace(/[\\/:*?"<>|]/g, '') + '.doc';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function QUARTER_CSS() {
    return '' +
    '.qr-note{background:#faf3f3;border-left:3px solid #E60012;padding:8px 12px;margin:10px 0;font-size:13px;color:#555;line-height:1.7;}' +
    '.qr-foot{font-size:12px;color:#999;margin-top:10px;line-height:1.7;}' +
    '.qr-sub-h{font-weight:700;color:#E60012;margin:18px 0 6px;font-size:15px;border-left:4px solid #E60012;padding-left:8px;}' +
    '.qr-tb th i{color:#aaa;font-style:normal;font-weight:400;font-size:11px;margin-left:2px;}' +
    '.qr-tb thead th{background:#faf3f3;color:#B3000E;font-weight:700;text-align:center;}' +
    '.qr-c{text-align:center;}' +
    '.qr-src{color:#999;font-size:12px;}' +
    '.qr-status{color:#E8941A;font-weight:700;}' +
    '.qr-snap tbody th{background:#fcfcfc;}' +
    '.qr-stat{margin-top:10px;font-size:13px;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:8px 12px;}' +
    '.qr-bar{position:relative;background:#f0f0f0;border-radius:3px;height:18px;overflow:hidden;}' +
    '.qr-bar i{position:absolute;left:0;top:0;bottom:0;display:block;}' +
    '.qr-bar span{position:relative;z-index:2;font-size:12px;padding-left:6px;line-height:18px;color:#333;}' +
    '.qr-ins{margin:18px 0 24px;}' +
    '.qr-ins-h{font-size:17px;font-weight:700;color:#222;border-bottom:2px solid #E60012;padding-bottom:5px;margin-bottom:8px;}' +
    '.qr-ins-h em{float:right;font-size:11px;color:#aaa;font-style:normal;font-weight:400;line-height:24px;}' +
    '.qr-ins-lead{color:#666;font-size:13px;margin-bottom:8px;line-height:1.8;}' +
    '.qr-season-h{font-size:17px;font-weight:700;color:#222;margin:6px 0 10px;}' +
    '.qr-season-badge{display:inline-block;background:#E60012;color:#fff;border-radius:6px;padding:2px 10px;margin-right:10px;font-size:14px;}' +
    '.qr-focus{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;}' +
    '.qr-focus-i{background:#faf3f3;border:1px solid #f0dcdc;border-radius:16px;padding:5px 14px;font-size:13px;color:#B3000E;}' +
    '.qr-qa{border:1px solid #eee;border-left:4px solid #2E6FE8;border-radius:6px;padding:10px 14px;margin:10px 0;}' +
    '.qr-q{font-size:14px;color:#222;margin-bottom:6px;}' +
    '.qr-q b{color:#2E6FE8;margin-right:6px;}' +
    '.qr-a{font-size:13px;color:#555;line-height:1.8;}' +
    '.qr-a b{color:#E60012;margin-right:6px;}' +
    '.qr-auto{display:block;color:#bbb;font-size:11px;font-style:normal;margin-top:4px;}' +
    '.qr-sign{text-align:right;margin-top:26px;color:#555;line-height:2;}' +
    '.qr-sign span{color:#999;font-size:13px;}';
  }

  global.QuarterReport = {
    reportBody: reportBody,
    buildPreview: buildPreview,
    exportWord: exportWord
  };
})(window);
