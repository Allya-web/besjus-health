/**
 * season-matcher.js — 季节知识库月份匹配（对应手册"06 季节知识库 45 条，按适用月份 1-12 自动匹配"）
 * 四季划分（手册 5.1）：冬春季(1-3月) / 春夏季(4-6月) / 夏秋季(7-9月) / 秋冬季(10-12月)
 */
(function (global) {
  'use strict';

  function seasonOf(month) {
    var m = Number(month) || new Date().getMonth() + 1;
    if (m <= 3) return '冬春季';
    if (m <= 6) return '春夏季';
    if (m <= 9) return '夏秋季';
    return '秋冬季';
  }

  // 当季风险类别（手册：心血管/呼吸/骨骼/代谢），供报告按季度取提示
  function riskFocus(season) {
    return {
      '冬春季': ['心血管', '呼吸'],
      '春夏季': ['代谢', '心血管'],
      '夏秋季': ['代谢', '呼吸'],
      '秋冬季': ['骨骼', '心血管']
    }[season] || ['心血管'];
  }

  // 给定 reportMonth（如 5），从知识库 season 条目中挑选（kb 为 {season: [...]} 结构）
  function pick(reportMonth, seasonLib) {
    var s = seasonOf(reportMonth);
    var items = (seasonLib && seasonLib[s]) || [];
    return { season: s, items: items };
  }

  global.SeasonMatcher = {
    seasonOf: seasonOf,
    riskFocus: riskFocus,
    pick: pick
  };
})(window);
