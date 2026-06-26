// matcher.js — 冲/稳/保梯度匹配
//
// 思路（位次法）：
//   1. 用考生今年的位次，换算成对比年（去年、前年）的"等位分"。
//   2. 对每个院校专业组，取它在对比年的"最低录取位次"。
//   3. 比较考生位次与专业组录取位次的差距，分档：
//        - 录取位次比考生小很多（即专业组分数高于考生）→ 冲
//        - 录取位次与考生接近 → 稳
//        - 录取位次比考生大（即专业组分数低于考生）→ 保
//   位次越小 = 排名越靠前 = 分数越高。
//
// 量化口径：用位次相对差
//   ratio = (专业组录取位次 - 考生位次) / 考生位次
//     ratio < 0  → 专业组分数高于考生，是"冲"的方向
//     ratio > 0  → 专业组分数低于考生，是"保"的方向
//
// 分档阈值（家长向、相对保守）：
//   冲：ratio <= -0.05（录取位次比考生小 5% 以上，最多冲到约 -25%，再高基本够不到）
//        其中 -0.05 ~ -0.15 为"小冲"，-0.15 ~ -0.25 为"大冲"
//   稳：-0.05 < ratio < +0.10
//   保：ratio >= +0.10（录取位次比考生大 10% 以上，至少留 10% 余量才稳）
//        其中 +0.10 ~ +0.25 为"稳保"，>= +0.25 为"兜底"

window.TJ = window.TJ || {};

TJ.Matcher = (function () {
  // 分档阈值
  const THRESH = {
    benMin: -0.05, // 稳的上界（含），高于此为稳
    chongFar: -0.15, // 大冲与小冲的分界
    baoMin: 0.1, // 保的下界（含）
    baoFar: 0.25, // 兜底分界
  };

  // 单个专业组在某对比年的录取位次（取该组记录的 rank 字段；多年取最近非空年）
  // record: { colleges.json 中一条专业组记录 }
  //   record.hist: { '2024': {minScore, minRank}, '2023': {...}, ... }
  // 返回最近一年的 {year, minRank}，若无数据返回 null
  function latestRank(record, preferYears) {
    if (!record.hist) return null;
    const years = preferYears || Object.keys(record.hist).sort((a, b) => b - a);
    for (const y of years) {
      const h = record.hist[y];
      if (h && h.minRank != null) return { year: Number(y), minRank: h.minRank };
    }
    return null;
  }

  // 计算单个专业组相对考生的档位
  // 返回 { grade: 'chong'|'wen'|'bao', ratio, detail }
  function classify(studentRank, groupRank) {
    if (studentRank == null || groupRank == null) {
      return { grade: 'unknown', ratio: null };
    }
    const ratio = (groupRank - studentRank) / studentRank;
    let grade;
    if (ratio <= THRESH.benMin) {
      grade = ratio <= THRESH.chongFar ? 'chong_big' : 'chong';
    } else if (ratio < THRESH.baoMin) {
      grade = 'wen';
    } else {
      grade = ratio >= THRESH.baoFar ? 'bao_safe' : 'bao';
    }
    return { grade, ratio };
  }

  // 主匹配：考生位次 + 候选专业组列表 → 分档结果
  // studentRank: 考生今年位次
  // groups: 专业组记录数组（已经过选科过滤的）
  // options: { preferYears:[最近年份...], studentSubs }
  // 返回 { chong:[...], wen:[...], bao:[...] }，每项含 record, grade, ratio, latest
  function match(studentRank, groups, options = {}) {
    const preferYears = options.preferYears;
    const buckets = { chong: [], wen: [], bao: [] };

    for (const g of groups) {
      const latest = latestRank(g, preferYears);
      if (!latest) continue; // 无历史位次的无法匹配
      const { grade, ratio } = classify(studentRank, latest.minRank);
      const item = {
        record: g,
        grade,
        ratio,
        latest,
      };
      if (grade === 'chong' || grade === 'chong_big') buckets.chong.push(item);
      else if (grade === 'wen') buckets.wen.push(item);
      else if (grade === 'bao' || grade === 'bao_safe') buckets.bao.push(item);
    }

    // 各档内排序——综合三个维度：
    //   1. 位次接近度（主）：越接近考生越值得填（保底不能把够不到的顶尖校排前）
    //   2. 大学层次：985/211/双一流/C9 加分（好大学优先）
    //   3. 地域：天津本地 > 京津冀 > 其他（本地优先）
    // 实现：把 ratio（位次相对差）量化到桶，层次和地域作为桶内的细化排序。
    buckets.chong.sort(makeSort("chong"));
    buckets.wen.sort(makeSort("wen"));
    buckets.bao.sort(makeSort("bao"));

    return buckets;
  }

  // 大学层次打分：分越高学校越好
  // C9(9)>985(7)>强基(6)>211(5)>双一流(4)>教育部直属(3)>中央部委(2)>普通(0)
  function tierScore(level) {
    if (!level) return 0;
    const lv = String(level);
    if (lv.indexOf("C9") !== -1) return 9;
    if (lv.indexOf("985") !== -1) return 7;
    if (lv.indexOf("强基") !== -1) return 6;
    if (lv.indexOf("211") !== -1) return 5;
    if (lv.indexOf("双一流") !== -1) return 4;
    if (lv.indexOf("教育部直属") !== -1) return 3;
    if (lv.indexOf("中央部委") !== -1) return 2;
    return 0;
  }

  // 生成排序函数：bucketType 决定位次接近方向
  // 冲(chong)：ratio 越大（越接近考生）越好；稳/保(wen/bao)：ratio 越小（越接近）越好
  function makeSort(bucketType) {
    const wantHighRatio = bucketType === "chong";
    return function (a, b) {
      // 第一优先：把 ratio 按 5% 分桶，只在"同位次段"内比较层次和地域，
      // 避免层次破坏冲稳保的位次意义（如保底档不会把够不到的清北排前）。
      const bucketA = Math.floor(Math.abs(a.ratio || 0) / 0.05);
      const bucketB = Math.floor(Math.abs(b.ratio || 0) / 0.05);
      if (bucketA !== bucketB) {
        // 同位次段内：稳/保倾向小 ratio（接近考生），冲倾向大 ratio（接近考生）
        return wantHighRatio ? (b.ratio - a.ratio) : (a.ratio - b.ratio);
      }
      // 第二优先：大学层次（好大学排前）
      const ta = tierScore(a.record.level);
      const tb = tierScore(b.record.level);
      if (ta !== tb) return tb - ta;
      // 第三优先：地域（天津本地 > 京津冀 > 其他）
      const ra = regionPriority(a.record.location);
      const rb = regionPriority(b.record.location);
      if (ra !== rb) return ra - rb;
      // 兜底：按 ratio 精细排
      return wantHighRatio ? (b.ratio - a.ratio) : (a.ratio - b.ratio);
    };
  }

  // 地域优先级：天津本地=0，京津冀=1，其他=2
  // 数值越小排越前。天津家长最关心本地和周边院校。
  function regionPriority(location) {
    if (!location) return 2;
    const loc = String(location);
    // 天津本地
    if (loc.indexOf("天津") !== -1) return 0;
    // 京津冀（北京 + 河北主要城市）
    const jingjinji = [
      "北京", "石家庄", "唐山", "保定", "廊坊", "秦皇岛",
      "沧州", "邯郸", "邢台", "张家口", "承德", "衡水",
    ];
    for (const city of jingjinji) {
      if (loc.indexOf(city) !== -1) return 1;
    }
    return 2;
  }

  // 把档位标签转中文
  function gradeLabel(grade) {
    return {
      chong: '冲',
      chong_big: '冲(强)',
      wen: '稳',
      bao: '保',
      bao_safe: '保(稳)',
      unknown: '数据不足',
    }[grade] || grade;
  }

  // 把 ratio 转成"录取概率"风格的家长友好描述（非真概率，是定性提示）
  function ratioHint(ratio) {
    if (ratio == null) return '历史数据不足';
    if (ratio <= -0.2) return '录取希望较小，可作为冲刺目标';
    if (ratio <= -0.1) return '有一定冲刺价值';
    if (ratio <= -0.05) return '可以尝试冲一冲';
    if (ratio < 0.05) return '录取把握较大';
    if (ratio < 0.1) return '相对稳妥';
    if (ratio < 0.25) return '比较保险的保底';
    return '非常稳的兜底院校';
  }

  return { THRESH, latestRank, classify, match, gradeLabel, ratioHint };
})();
