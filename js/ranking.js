// ranking.js — 天津高考一分一段表查询 + 等位分换算核心算法
//
// 数据结构（data/score_rank/tianjin_YYYY.json）：
//   { year, rows: [ {score, count(本段人数), cum(累计人数=位次), [score_lo], [official_line]} ] }
// rows 按 score 降序排列（高分在前），cum 单调递增。
//
// 核心概念：
//   - 位次(rank)：某分数的"累计人数"，表示全市考到这个分数及以上的总人数。
//   - 等位分：把"今年的位次"放到往年一分一段表里反查，得到"往年同位次对应多少分"。
//     位次法比直接比分靠谱，因为每年试卷难度、考生数都在变，位次才反映相对水平。

window.TJ = window.TJ || {};

TJ.Ranking = (function () {
  // 缓存已加载的年份表；按 score 降序
  const tables = {}; // year -> { rows:[], byScore:Map, maxScore, minScore }

  // 加载某年一分一段表 JSON
  async function load(year) {
    if (tables[year]) return tables[year];
    const resp = await fetch(`data/score_rank/tianjin_${year}.json`);
    if (!resp.ok) throw new Error(`无法加载 ${year} 年一分一段表`);
    const data = await resp.json();
    const rows = data.rows.slice().sort((a, b) => b.score - a.score);
    const byScore = new Map();
    for (const r of rows) byScore.set(r.score, r);
    const maxScore = rows[0].score;
    const minScore = rows[rows.length - 1].score;
    tables[year] = { year: data.year, rows, byScore, maxScore, minScore };
    return tables[year];
  }

  // 一次性加载多个年份
  async function loadAll(years) {
    return Promise.all(years.map((y) => load(y)));
  }

  // 由分数查当年位次（累计人数）
  // 若精确分数存在于表中，直接返回其 cum；
  // 若分数高于表内最高分(如 700+ 在最高分段区间内)，按最高分段累计处理；
  // 若分数低于表内最低分，返回 null。
  function scoreToRank(year, score) {
    const t = tables[year];
    if (!t) throw new Error(`未加载 ${year} 年数据`);
    const exact = t.byScore.get(score);
    if (exact) return exact.cum;
    // 分数高于最高分单点记录：最高分通常是"681-750"这样的区间，
    // 此时 cum 表示 ≥ 该区间下限的人数，对高于下限的分数，位次取该区间内插值更准
    if (score >= t.maxScore) {
      const top = t.rows[0]; // 最高分段
      if (top.score_lo !== undefined) {
        // 在 [score_lo, maxScore] 内线性估算（高分段人数很少，近似合理）
        const span = top.score - top.score_lo + 1;
        const above = Math.max(0, top.score - score); // 比区间上限高出多少分
        const estCount = Math.max(1, Math.round(top.count * (1 - above / span)));
        return Math.max(1, top.cum - (top.count - estCount));
      }
      return top.cum;
    }
    // 分数在表中间但非整数命中（理论上 1 分一档不该出现，做兜底）：取最近的高一档
    // 这里找略高于该分数的最小档（cum 更小）
    for (const r of t.rows) {
      if (r.score <= score) {
        // 向下找：r.score 略低于 score，位次用 r 累计减去该分段中分数高于 score 的部分
        const seg = r.count;
        const above = score - r.score; // 在该分段内高出多少分（该分段理论上是 1 分，通常 0）
        const est = Math.max(0, seg - Math.round(above)); // 极少数情况
        return Math.max(1, r.cum - est);
      }
    }
    return null; // 低于最低分
  }

  // 由位次反查等位分：在 year 的一分一段表里，找出 cum >= rank 的最小分数
  // 即"排在第 rank 名，对应多少分"。这是位次法的核心换算。
  function rankToScore(year, rank) {
    const t = tables[year];
    if (!t) throw new Error(`未加载 ${year} 年数据`);
    if (rank == null) return null;
    // rows 降序，cum 升序。找第一个 cum >= rank 的行，其分数即等位分（取该分段顶端）
    for (const r of t.rows) {
      if (r.cum >= rank) return r.score;
    }
    // rank 比所有人位次都小（极高分），返回最高分
    return t.maxScore;
  }

  // 综合：输入 (基准年, 基准分) -> 输出基准年位次 + 各对比年的等位分
  // compareYears: 数组，如 [2023,2024]
  async function convert(baseYear, score, compareYears) {
    await load(baseYear);
    const rank = scoreToRank(baseYear, score);
    const result = { baseYear, score, rank, equiv: [] };
    if (rank == null) return result;
    for (const y of compareYears) {
      await load(y);
      result.equiv.push({
        year: y,
        rank,
        equivScore: rankToScore(y, rank),
      });
    }
    return result;
  }

  // 判断分数是否达到某年本科线（取该年 official_line 或约定的本科线分数）
  function isAboveLine(year, score, lineScore) {
    return score >= lineScore;
  }

  return { load, loadAll, scoreToRank, rankToScore, convert, isAboveLine, tables };
})();
