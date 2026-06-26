// app.js — 主流程编排
//
// 流程：输入分数+选科 → 查今年位次 → 换算往年等位分 → 加载院校数据 →
//      选科过滤 → 冲稳保匹配 → 渲染结果

(function () {
  "use strict";

  // 配置：基准年（今年）、对比年（用于等位分换算和匹配）
  const BASE_YEAR = 2025;
  const COMPARE_YEARS = [2024, 2023];

  // 各年本科线（用于提示，2026 尚未公布，用 2025 锚点）
  const LINE_SCORES = {
    2023: 472,
    2024: 475,
    2025: 476,
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

  // 选科交互
  const subjectChips = subjectGrid.querySelectorAll(".subject-chip");
  let selectedSubs = [];

  function updateSubjectUI() {
    selectedSubs = Array.from(subjectGrid.querySelectorAll("input:checked")).map(
      (i) => i.value
    );
    subjectChips.forEach((chip) => {
      const cb = chip.querySelector("input");
      chip.classList.toggle("selected", cb.checked);
    });
    const n = selectedSubs.length;
    subjectCount.textContent = `已选 ${n} / 3`;
    subjectCount.className = "subject-count";
    if (n === 3) subjectCount.classList.add("ok");
    else if (n > 3) subjectCount.classList.add("warn");
    validateForm();
  }

  function validateForm() {
    const score = parseInt(scoreInput.value, 10);
    const scoreOk = score >= 300 && score <= 750;
    const subjOk = selectedSubs.length === 3;
    submitBtn.disabled = !(scoreOk && subjOk);
  }

  subjectChips.forEach((chip) => {
    chip.addEventListener("click", (e) => {
      // label 包 input，click 会冒泡；这里手动限制最多选 3 个
      const cb = chip.querySelector("input");
      if (!cb.checked && selectedSubs.length >= 3) {
        e.preventDefault();
        subjectCount.classList.add("warn");
        return;
      }
      // 让 checkbox 状态由默认行为切换
      setTimeout(updateSubjectUI, 0);
    });
  });

  scoreInput.addEventListener("input", validateForm);

  // 提交
  submitBtn.addEventListener("click", run);

  async function run() {
    const score = parseInt(scoreInput.value, 10);
    if (!(score >= 300 && score <= 750) || selectedSubs.length !== 3) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "正在计算…";

    try {
      // 1. 位次换算
      const conv = await TJ.Ranking.convert(score, BASE_YEAR, COMPARE_YEARS);
      renderRank(conv, score);

      // 2. 加载院校 + 选科过滤 + 匹配
      rankCard.classList.remove("hidden");
      matchCard.classList.remove("hidden");
      bucketsContainer.innerHTML =
        '<div class="loading"><div class="spinner"></div><div style="margin-top:10px">正在匹配院校…</div></div>';

      const groups = await loadColleges();
      const filtered = groups.filter((g) => {
        if (!g.subjectReq) return true;
        const rule = TJ.Subject.parseRequirement(g.subjectReq);
        return TJ.Subject.satisfies(selectedSubs, rule);
      });

      const buckets = TJ.Matcher.match(conv.rank, filtered, {
        preferYears: ["2024", "2023"],
      });
      renderBuckets(buckets);
    } catch (err) {
      console.error(err);
      bucketsContainer.innerHTML =
        '<div class="empty">匹配出错：' +
        (err.message || err) +
        "<br>请稍后重试。</div>";
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
      bucket.innerHTML = `
        <div class="bucket-header ${d.cls}">
          <span>${d.title} <span style="opacity:.85;font-size:13px;font-weight:400">· ${d.desc}</span></span>
          <span class="count">${list.length} 个</span>
        </div>
        <div class="bucket-body"></div>`;
      const body = bucket.querySelector(".bucket-body");
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
