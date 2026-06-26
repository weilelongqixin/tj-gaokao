// app.js — 主流程编排
//
// 流程：输入分数+选科 → 查今年位次 → 换算往年等位分 → 加载院校数据 →
//      选科过滤 → 冲稳保匹配 → 渲染结果

(function () {
  "use strict";

  // 配置：基准年（今年）、对比年（用于等位分换算和匹配）
  const BASE_YEAR = 2026;
  const COMPARE_YEARS = [2025, 2024];

  // 各年本科线（用于提示）
  const LINE_SCORES = {
    2024: 475,
    2025: 476,
    2026: 458,
  };

  // DOM
  const scoreInput = document.getElementById("scoreInput");
  const scoreHint = document.getElementById("scoreHint");
  const subjectGrid = document.getElementById("subjectGrid");
  const subjectCount = document.getElementById("subjectCount");
  const submitBtn = document.getElementById("submitBtn");
  const rankCard = document.getElementById("rankCard");
  const matchCard = document.getElementById("matchCard");
  const bucketsContainer = document.getElementById("bucketsContainer");

  // 选科交互：用 button + data-code，点击切换选中态
  const subjectChips = Array.from(
    document.querySelectorAll("#subjectGrid .subject-chip")
  );
  let selectedSubs = [];

  function updateSubjectUI() {
    const selectedSet = new Set(selectedSubs);
    const full = selectedSubs.length >= 3;
    subjectChips.forEach((chip) => {
      const code = chip.dataset.code;
      const isOn = selectedSet.has(code);
      chip.classList.toggle("selected", isOn);
      // 选满 3 个后，未选的禁用（变灰），已选的仍可点（用于取消）
      chip.disabled = full && !isOn;
      chip.setAttribute("aria-pressed", isOn ? "true" : "false");
    });
    const n = selectedSubs.length;
    subjectCount.textContent = `已选 ${n} / 3`;
    subjectCount.className = "subject-count";
    if (n === 3) subjectCount.classList.add("ok");
    else if (n > 3) subjectCount.classList.add("warn");
    validateForm();
  }

  function toggleSubject(code) {
    const idx = selectedSubs.indexOf(code);
    if (idx === -1) {
      // 选中：最多 3 个
      if (selectedSubs.length >= 3) return;
      selectedSubs.push(code);
    } else {
      // 取消选中：随时可以
      selectedSubs.splice(idx, 1);
    }
    updateSubjectUI();
  }

  subjectChips.forEach((chip) => {
    chip.addEventListener("click", () => toggleSubject(chip.dataset.code));
  });

  function validateForm() {
    const score = parseInt(scoreInput.value, 10);
    const scoreOk = score >= 300 && score <= 750;
    const subjOk = selectedSubs.length === 3;
    submitBtn.disabled = !(scoreOk && subjOk);
  }

  scoreInput.addEventListener("input", validateForm);

  // 提交
  submitBtn.addEventListener("click", run);

  async function run() {
    const score = parseInt(scoreInput.value, 10);
    // 友好提示，避免静默 return 造成"点了没反应"
    if (isNaN(score) || score < 300 || score > 750) {
      alert("请先输入有效分数（300 ~ 750 分）");
      scoreInput.focus();
      return;
    }
    if (selectedSubs.length !== 3) {
      alert("请勾选 3 门选考科目（当前选了 " + selectedSubs.length + " 门）");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "正在计算…";
    // 立刻让结果卡片可见并显示加载态，避免"没反应"的错觉
    rankCard.classList.remove("hidden");
    matchCard.classList.remove("hidden");
    bucketsContainer.innerHTML =
      '<div class="loading"><div class="spinner"></div><div style="margin-top:10px">正在换算位次…</div></div>';
    // 滚动到结果区（兼容性兜底，失败不影响计算）
    try {
      if (rankCard.scrollIntoView) {
        rankCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      /* 滚动失败忽略 */
    }

    try {
      // 1. 位次换算
      const conv = await TJ.Ranking.convert(BASE_YEAR, score, COMPARE_YEARS);
      renderRank(conv, score);

      // 2. 加载院校 + 选科过滤 + 匹配
      bucketsContainer.innerHTML =
        '<div class="loading"><div class="spinner"></div><div style="margin-top:10px">正在匹配院校…</div></div>';

      const groups = await loadColleges();
      if (!groups || groups.length === 0) {
        throw new Error("院校数据加载失败（colleges.json 为空或未加载）");
      }
      const filtered = groups.filter((g) => {
        if (!g.subjectReq) return true;
        const rule = TJ.Subject.parseRequirement(g.subjectReq);
        return TJ.Subject.satisfies(selectedSubs, rule);
      });

      const buckets = TJ.Matcher.match(conv.rank, filtered, {
        preferYears: ["2025", "2024"],
      });
      renderBuckets(buckets);
    } catch (err) {
      console.error("[填报助手] 出错：", err);
      const msg = err && err.message ? err.message : String(err);
      // 结果区显示错误，并弹窗提示，确保用户能看到
      bucketsContainer.innerHTML =
        '<div class="empty">计算出错：' + msg + "<br>请刷新页面重试（⌘+Shift+R）。</div>";
      alert("计算出错：" + msg + "\n\n请尝试强制刷新页面（Mac: ⌘+Shift+R）。");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "开始换算并推荐";
    }
  }

  // 渲染位次换算
  function renderRank(conv, score) {
    document.getElementById("rankValue").textContent =
      conv.rank != null ? conv.rank.toLocaleString() : "—";
    document.getElementById("rankScore").textContent = score;

    // 本科线提示
    const line = LINE_SCORES[BASE_YEAR];
    if (score < line) {
      scoreHint.innerHTML = `⚠️ 当前分数低于 ${BASE_YEAR} 年本科线（${line} 分），可报本科院校很少`;
      scoreHint.style.color = "var(--chong)";
    } else {
      scoreHint.textContent = `满分 750 分，${BASE_YEAR} 年本科线 ${line} 分`;
      scoreHint.style.color = "";
    }

    const tbody = document.getElementById("equivBody");
    tbody.innerHTML = "";
    for (const e of conv.equiv) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${e.year} 年</td><td class="score">${
        e.equivScore != null ? e.equivScore : "—"
      }</td>`;
      tbody.appendChild(tr);
    }
  }

  // 渲染冲稳保分档
  function renderBuckets(buckets) {
    bucketsContainer.innerHTML = "";
    const defs = [
      { key: "chong", cls: "chong", title: "冲刺院校", desc: "录取位次高于孩子，可以搏一搏" },
      { key: "wen", cls: "wen", title: "稳妥院校", desc: "录取位次与孩子接近，把握较大" },
      { key: "bao", cls: "bao", title: "保底院校", desc: "录取位次低于孩子，留有余量" },
    ];
    let total = 0;
    for (const d of defs) {
      const list = buckets[d.key] || [];
      total += list.length;
      const bucket = document.createElement("div");
      bucket.className = "bucket";
      // 默认：冲刺档默认折叠（数量多），稳妥/保底默认展开
      const collapsed = d.key === "chong";
      bucket.innerHTML = `
        <div class="bucket-header ${d.cls}" role="button" tabindex="0">
          <span class="bucket-title">${d.title} <span class="bucket-desc">· ${d.desc}</span></span>
          <span class="bucket-right"><span class="count">${list.length} 个</span><span class="collapse-arrow">${collapsed ? "▶" : "▼"}</span></span>
        </div>
        <div class="bucket-body"></div>`;
      const body = bucket.querySelector(".bucket-body");
      const header = bucket.querySelector(".bucket-header");
      const arrow = bucket.querySelector(".collapse-arrow");
      if (collapsed) {
        body.classList.add("collapsed");
        header.classList.add("collapsed");
      }
      if (list.length === 0) {
        body.innerHTML = '<div class="empty">该档暂无匹配院校</div>';
      } else {
        for (const item of list.slice(0, 30)) {
          body.appendChild(renderGroupCard(item, d.cls));
        }
        if (list.length > 30) {
          body.innerHTML += `<div class="empty">…还有 ${list.length - 30} 个，建议缩小范围查看</div>`;
        }
      }
      // 点击 header 折叠/展开
      const toggle = function () {
        const isCollapsed = body.classList.toggle("collapsed");
        header.classList.toggle("collapsed", isCollapsed);
        arrow.textContent = isCollapsed ? "▶" : "▼";
      };
      header.addEventListener("click", toggle);
      header.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
      bucketsContainer.appendChild(bucket);
    }
    if (total === 0) {
      bucketsContainer.innerHTML =
        '<div class="empty">未找到匹配的院校。可能是该分数段暂无内置数据，或选科组合限制较多。可尝试调整选科后重试。</div>';
    }
  }

  function renderGroupCard(item, bucketCls) {
    const g = item.record;
    const div = document.createElement("div");
    div.className = "group-card";
    const gradeLabel = TJ.Matcher.gradeLabel(item.grade);
    const hint = TJ.Matcher.ratioHint(item.ratio);
    const rule = TJ.Subject.parseRequirement(g.subjectReq);
    const subjText = TJ.Subject.ruleToText(rule);
    const hist = formatHist(g.hist);
    const loc = g.location ? ` · ${g.location}` : "";
    div.innerHTML = `
      <div class="group-name">${escapeHtml(g.college)}${g.groupName ? " · " + escapeHtml(g.groupName) : ""}</div>
      <div class="group-meta">${g.level || ""}${loc}${g.groupCode ? " · 专业组 " + g.groupCode : ""}</div>
      <div class="group-tags">
        <span class="tag subj">选科：${escapeHtml(subjText)}</span>
        <span class="tag hint ${bucketCls}">${escapeHtml(hint)}</span>
      </div>
      <div class="group-hist">近年录取位次：${hist}</div>`;
    return div;
  }

  function formatHist(hist) {
    if (!hist) return "暂无数据";
    const years = Object.keys(hist).sort((a, b) => b - a);
    const parts = [];
    for (const y of years.slice(0, 3)) {
      const h = hist[y];
      if (h && h.minRank != null) {
        parts.push(`${y}: ${h.minRank.toLocaleString()}名(${h.minScore}分)`);
      }
    }
    return parts.length ? parts.join("　") : "暂无数据";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 加载院校数据（带容错：文件不存在时返回空数组）
  let collegesCache = null;
  async function loadColleges() {
    if (collegesCache) return collegesCache;
    try {
      const resp = await fetch("data/colleges/colleges.json");
      if (!resp.ok) throw new Error("院校数据未就绪");
      collegesCache = await resp.json();
    } catch (e) {
      console.warn("院校数据加载失败：", e);
      collegesCache = [];
    }
    return collegesCache;
  }

  // 初始化
  updateSubjectUI();
})();
