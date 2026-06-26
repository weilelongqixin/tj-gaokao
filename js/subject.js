// subject.js — 选科要求硬过滤
//
// 天津 3+3 新高考：考生从 物/化/生/政/史/地 6 门中选 3 门。
// 院校专业组的"选科要求"决定考生能否报考该组。常见要求类型：
//   1. 不限               → 任何选科组合都可报
//   2. 物理(必须)          → 考生必须选了"物理"
//   3. 物理+化学(均须)      → 必须同时选了"物理"和"化学"
//   4. 物理/化学(选考其一)  → 物理化学生物三选一或物化二选一（取其一即可）
//   5. 其它单科/多科要求    → 类似规则
//
// 数据存储用规范化的科目集合，避免中文匹配的歧义：
//   科目代码：phy=物理 chem=化学 bio=生物 pol=政治 his=历史 geo=地理
//   要求用结构表达：{ type: 'all'|'any'|'none', required: [code,...] }
//     - none  : 不限
//     - all   : required 中的每一门都必须选
//     - any   : required 中至少选一门

window.TJ = window.TJ || {};

TJ.Subject = (function () {
  // 科目代码 <-> 中文名
  const CODE2NAME = {
    phy: '物理',
    chem: '化学',
    bio: '生物',
    pol: '政治',
    his: '历史',
    geo: '地理',
  };
  const NAME2CODE = Object.fromEntries(
    Object.entries(CODE2NAME).map(([c, n]) => [n, c])
  );

  const SUBJECTS = ['phy', 'chem', 'bio', 'pol', 'his', 'geo'];

  // 把中文选科要求文本解析为结构化规则。
  // 支持的写法（容错）：
  //   "" / "不限" / "不限科目"              -> {type:'none', required:[]}
  //   "物理(必须)" / "物理"                  -> {type:'all', required:['phy']}
  //   "物理+化学" / "物理、化学" / "物理化学" -> {type:'all', required:['phy','chem']}
  //   "物理或化学" / "物理/化学"             -> {type:'any', required:['phy','chem']}
  //   "物理 化学 化学(任选其一)"             -> 按关键词 any/all 识别
  function parseRequirement(text) {
    if (!text) return { type: 'none', required: [] };
    const raw = String(text).trim();
    if (raw === '' || /不限|无要求|不限科目/.test(raw)) {
      return { type: 'none', required: [] };
    }
    const anyFlag = /任选其一|或者|\/|或/.test(raw);
    // 提取出现的科目
    const required = [];
    for (const code of SUBJECTS) {
      if (raw.indexOf(CODE2NAME[code]) !== -1) required.push(code);
    }
    // "选考其中一门"/"任选其一"/含"或"按 any 处理
    if (/任选|其一|两门|选考其中/.test(raw) && required.length > 1) {
      return { type: 'any', required };
    }
    if (anyFlag && required.length > 1) {
      return { type: 'any', required };
    }
    return { type: required.length ? 'all' : 'none', required };
  }

  // 考生选科集合是否满足某专业组的选科要求
  // studentSubs: 数组，如 ['phy','chem','bio']
  // rule: parseRequirement 的返回
  function satisfies(studentSubs, rule) {
    const set = new Set(studentSubs || []);
    if (rule.type === 'none') return true;
    if (rule.type === 'all') {
      return rule.required.every((c) => set.has(c));
    }
    if (rule.type === 'any') {
      return rule.required.some((c) => set.has(c));
    }
    return false;
  }

  // 把规则渲染成中文（用于界面展示）
  function ruleToText(rule) {
    if (!rule || rule.type === 'none') return '不限';
    const names = (rule.required || []).map((c) => CODE2NAME[c] || c);
    if (rule.type === 'all') {
      return names.length === 1 ? `${names[0]}(必选)` : names.join('+') + '(均须)';
    }
    if (rule.type === 'any') return names.join('/') + '(任选其一)';
    return '不限';
  }

  return {
    CODE2NAME,
    NAME2CODE,
    SUBJECTS,
    parseRequirement,
    satisfies,
    ruleToText,
  };
})();
