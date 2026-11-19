"use strict";
(() => {
  // src/content.ts
  var badge = null;
  var last = null;
  var debug = true;
  var spark = [];
  var NAMES = { vucic: "Vu\u010Di\u0107", brnabic: "Brnabi\u0107", jovanov: "Jovanov", bakic: "Baki\u0107", gasic: "Ga\u0161i\u0107" };
  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement("div");
    badge.style.cssText = [
      "position:fixed",
      "left:16px",
      "bottom:16px",
      "z-index:2147483647",
      "font:12px/1.4 -apple-system,system-ui,sans-serif",
      "background:rgba(28,28,26,.88)",
      "color:#f1efe8",
      "padding:8px 10px",
      "border-radius:10px",
      "min-width:190px",
      "pointer-events:none",
      "box-shadow:none"
    ].join(";");
    document.documentElement.appendChild(badge);
    return badge;
  }
  function render(s) {
    if (!debug || !s.running) {
      if (badge) badge.style.display = "none";
      return;
    }
    const b = ensureBadge();
    b.style.display = "block";
    spark.push(s.bestScore);
    if (spark.length > 20) spark.shift();
    const w = 170, h = 22;
    const pts = spark.map((v, i) => `${i / 19 * w},${h - Math.max(0, Math.min(1, v)) * h}`).join(" ");
    const state = s.error ? "error" : s.muted ? `\u266A muted: ${NAMES[s.target ?? ""] ?? s.target}` : "\u25B6 playing";
    const color = s.error ? "#F09595" : s.muted ? "#ED93B1" : "#97C459";
    b.innerHTML = `<div style="color:${color};font-weight:500">${state}</div>
    <div style="opacity:.8">najverovatnije: ${NAMES[s.best ?? ""] ?? s.best ?? "\u2014"} ${s.bestScore ? s.bestScore.toFixed(2) : ""}</div>
    <svg width="${w}" height="${h}" style="display:block;margin:4px 0"><line x1="0" x2="${w}" y1="${h * 0.5}" y2="${h * 0.5}" stroke="#5F5E5A" stroke-dasharray="2 3"/>
    <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>
    ${musicLine(s)}
    <div style="opacity:.6">${s.error ? s.error + " \xB7 " : ""}Alt+W = wrong</div>`;
  }
  function musicLine(s) {
    if (s.music === "blocked") return `<div style="color:#FAC775">music blocked by Chrome: click the music tab once</div>`;
    if (s.music === "ready") return `<div style="opacity:.8">muzika, mo\u017Ee!</div>`;
    return `<div style="opacity:.6">music: none (paste a YouTube link in the popup)</div>`;
  }
  function flash(text) {
    const b = ensureBadge();
    const n = document.createElement("div");
    n.textContent = text;
    n.style.cssText = "margin-top:4px;color:#FAC775";
    b.appendChild(n);
    setTimeout(() => n.remove(), 1500);
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "status") {
      last = msg.status;
      render(msg.status);
    }
    if (msg.type === "settings-changed") {
      debug = msg.settings.debug;
      if (last) render(last);
    }
  });
  chrome.runtime.sendMessage({ type: "get-state" }).then((run) => {
    if (run?.isCaptureTab && run.status?.running) {
      last = { ...run.status, music: run.music };
      render(last);
    }
  }).catch(() => {
  });
  chrome.storage.local.get("settings").then((r) => {
    const s = r.settings;
    if (s) debug = s.debug;
  });
  window.addEventListener("keydown", (e) => {
    if (!(e.altKey && e.code === "KeyW") || !last?.running) return;
    e.preventDefault();
    const v = document.querySelector("video");
    chrome.runtime.sendMessage({
      type: "wrong",
      entry: { at: (/* @__PURE__ */ new Date()).toISOString(), url: location.href, videoTime: v?.currentTime ?? -1, status: last }
    }).then((r) => flash(`logged (${r?.count ?? "?"})`));
  }, true);
})();
//# sourceMappingURL=content.js.map
