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
  // 返回 { rank, isEstimate }：
  //   - 精确命中：rank=位次, isEstimate=false
  //   - 落在最高分合并区间(如天津680及以上)：rank=估算位次, isEstimate=true
  //   - 低于最低分：rank=null
  function scoreToRank(year, score) {
    const t = tables[year];
    if (!t) throw new Error(`未加载 ${year} 年数据`);
    const exact = t.byScore.get(score);
    if (exact) return { rank: exact.cum, isEstimate: false };
    // 分数落在最高分合并区间内（如天津"680及以上"，数据存为 score=750,score_lo=680）。
    // 官方对这一段不细分到每分，任何具体位次都是线性估算。
    const top = t.rows[0];
    if (top && top.score_lo !== undefined && score >= top.score_lo && score <= top.score) {
      const span = top.score - top.score_lo + 1;
      const above = Math.max(0, top.score - score); // 距区间上限差多少分
      const estCount = Math.max(1, Math.round(top.count * (1 - above / span)));
      return { rank: Math.max(1, top.cum - (top.count - estCount)), isEstimate: true };
    }
    // 分数高于区间上限（极少见，如查 760 分）：取区间累计
    if (score > t.maxScore) {
      return { rank: top ? top.cum : null, isEstimate: true };
    }
    // 分数在表中间但非整数命中（兜底）：取最近的高一档
    for (const r of t.rows) {
      if (r.score <= score) {
        const seg = r.count;
        const above = score - r.score;
        const est = Math.max(0, seg - Math.round(above));
        return { rank: Math.max(1, r.cum - est), isEstimate: false };
      }
    }
    return { rank: null, isEstimate: false }; // 低于最低分
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
    const { rank, isEstimate } = scoreToRank(baseYear, score);
    const result = { baseYear, score, rank, isEstimate, equiv: [] };
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
