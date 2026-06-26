// gate.js — 密码门
//
// 原理：密码不明文写在代码里，而是存它的 SHA-256 哈希。
//      用户输入密码 → 算哈希 → 和预设哈希比对 → 一致则放行。
//      这样别人查看网页源码也看不到密码本身。
//
// 修改密码方法：
//   1. 在浏览器控制台执行：async()=>console.log(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('你的新密码')))...
//      或更简单：访问 https://www.duplichecker.com/sha256-encrypt.php 把新密码转成 SHA-256
//   2. 把得到的哈希替换下面的 PASSWORD_HASH 值
//
// 默认密码：tj2025 （你应当改成只有你知道的密码）

(function () {
  "use strict";

  // 默认密码 tj2025 的 SHA-256 哈希（hex）
  // 如需修改密码，把新密码的 SHA-256 填到这里
  const PASSWORD_HASH = "4c6393e33c0cc162ef74d48ef2076d74ec32c65d2b21a4568a322cedb36a6ca0";
  const SESSION_KEY = "tj_gate_unlocked";

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function unlock() {
    document.getElementById("gate").classList.add("hidden");
    sessionStorage.setItem(SESSION_KEY, "1");
  }

  async function tryUnlock() {
    const input = document.getElementById("gateInput");
    const err = document.getElementById("gateErr");
    const pwd = input.value.trim();
    if (!pwd) {
      err.textContent = "请输入密码";
      return;
    }
    const hash = await sha256(pwd);
    if (hash === PASSWORD_HASH) {
      unlock();
    } else {
      err.textContent = "密码不正确，请重试或联系分享人";
      input.value = "";
      input.focus();
    }
  }

  function init() {
    // 本会话已解锁则直接放行（关浏览器才需重输）
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      unlock();
      return;
    }
    const btn = document.getElementById("gateBtn");
    const input = document.getElementById("gateInput");
    btn.addEventListener("click", tryUnlock);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryUnlock();
    });
    setTimeout(() => input.focus(), 100);
  }

  // crypto.subtle 需要在安全上下文（https 或 localhost）下才可用。
  // GitHub Pages 是 https，没问题。
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
