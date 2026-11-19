"use strict";
(() => {
  // src/music.ts
  if (!window.__pmuteMusic) {
    let fade2 = function(v, to, seconds, done) {
      clearInterval(fadeTimer);
      const from = v.volume, t0 = performance.now();
      fadeTimer = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / (seconds * 1e3));
        v.volume = from + (to - from) * k;
        if (k >= 1) {
          clearInterval(fadeTimer);
          done?.();
        }
      }, 20);
    }, showOverlay2 = function() {
      if (overlay) return;
      overlay = document.createElement("div");
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:rgba(28,28,26,.86)",
        "color:#f1efe8",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "text-align:center",
        "font:20px/1.5 -apple-system,system-ui,sans-serif",
        "cursor:pointer"
      ].join(";");
      overlay.textContent = "Chrome je blokirao muziku. Klikni bilo gde da krene.";
      overlay.addEventListener("click", () => {
        overlay?.remove();
        overlay = null;
        chrome.runtime.sendMessage({ type: "music-armed" }).catch(() => {
        });
        if (wantPlay) void play(0.3);
      });
      document.documentElement.appendChild(overlay);
    };
    fade = fade2, showOverlay = showOverlay2;
    window.__pmuteMusic = true;
    let wantPlay = true;
    let fadeTimer = 0;
    let overlay = null;
    const video = () => document.querySelector("video.html5-main-video, video");
    async function play(fadeS) {
      const v = video();
      if (!v) return;
      v.loop = true;
      try {
        v.volume = Math.min(v.volume, 0.05);
        await v.play();
        fade2(v, 1, fadeS);
      } catch {
        chrome.runtime.sendMessage({ type: "music-blocked" }).catch(() => {
        });
        showOverlay2();
      }
    }
    const boot = setInterval(() => {
      const v = video();
      if (!v) return;
      clearInterval(boot);
      v.loop = true;
      if (wantPlay) void play(0.3);
    }, 200);
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type !== "music-control") return;
      const v = video();
      wantPlay = msg.play;
      if (!v) return;
      if (msg.play) void play(msg.fadeS);
      else fade2(v, 0, msg.fadeS, () => {
        if (!wantPlay) v.pause();
      });
    });
  }
  var fade;
  var showOverlay;
})();
//# sourceMappingURL=music.js.map
