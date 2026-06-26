// gate.js — 密码门（明文比对，简单可靠）
//
// 修改密码：直接改下面这行的值即可，无需任何计算。
// 说明：密码写在代码里，懂技术的人查看源码能找到。
//       但本工具用于"控制亲友访问、防止网址被陌生人随手打开"，
//       这个安全级别足够。需要更高安全性需后端实现。

(function () {
  "use strict";

  // ↓↓↓ 修改密码只需改这一行 ↓↓↓
  var PASSWORD = "tj2026";
  // ↑↑↑ 修改密码只需改这一行 ↑↑↑

  var SESSION_KEY = "tj_gate_unlocked";

  function unlock() {
    var gate = document.getElementById("gate");
    if (gate) gate.classList.add("hidden");
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
  }

  function tryUnlock() {
    var input = document.getElementById("gateInput");
    var err = document.getElementById("gateErr");
    if (!input || !err) return;
    var pwd = input.value;
    if (!pwd) { err.textContent = "请输入密码"; return; }
    if (pwd === PASSWORD) {
      unlock();
    } else {
      err.textContent = "密码不正确，请重试";
      input.value = "";
      input.focus();
    }
  }

  function init() {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") { unlock(); return; }
    } catch (e) {}
    var btn = document.getElementById("gateBtn");
    var input = document.getElementById("gateInput");
    if (!btn || !input) return;
    btn.addEventListener("click", tryUnlock);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") tryUnlock();
    });
    try { input.focus(); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
