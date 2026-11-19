// Injected into the music tab. The tab is opened (in front) on the first mute, so the song plays
// right away; afterwards the background script pauses it on unmute and resumes it on the next
// mute. The song loops. If Chrome blocks play() (autoplay rules), a "click to enable" overlay
// appears; one click on the tab unlocks it.
import type { Msg } from "./shared/messages";

declare global { interface Window { __pmuteMusic?: boolean } }

if (!window.__pmuteMusic) {
  window.__pmuteMusic = true;
  let wantPlay = true; // opened because someone was just muted
  let fadeTimer = 0;
  let overlay: HTMLDivElement | null = null;

  const video = () => document.querySelector<HTMLVideoElement>("video.html5-main-video, video");

  function fade(v: HTMLVideoElement, to: number, seconds: number, done?: () => void) {
    clearInterval(fadeTimer);
    const from = v.volume, t0 = performance.now();
    fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      v.volume = from + (to - from) * k;
      if (k >= 1) { clearInterval(fadeTimer); done?.(); }
    }, 20);
  }

  function showOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647", "background:rgba(28,28,26,.86)", "color:#f1efe8",
      "display:flex", "align-items:center", "justify-content:center", "text-align:center",
      "font:20px/1.5 -apple-system,system-ui,sans-serif", "cursor:pointer",
    ].join(";");
    overlay.textContent = "Chrome je blokirao muziku. Klikni bilo gde da krene.";
    overlay.addEventListener("click", () => {
      overlay?.remove();
      overlay = null;
      chrome.runtime.sendMessage({ type: "music-armed" } satisfies Msg).catch(() => {});
      if (wantPlay) void play(0.3);
    });
    document.documentElement.appendChild(overlay);
  }

  async function play(fadeS: number) {
    const v = video();
    if (!v) return;
    v.loop = true;
    try {
      v.volume = Math.min(v.volume, 0.05);
      await v.play();
      fade(v, 1, fadeS);
    } catch {
      chrome.runtime.sendMessage({ type: "music-blocked" } satisfies Msg).catch(() => {});
      showOverlay();
    }
  }

  // first load: wait for YouTube's player, then make sure it's playing and looping
  const boot = setInterval(() => {
    const v = video();
    if (!v) return;
    clearInterval(boot);
    v.loop = true;
    if (wantPlay) void play(0.3);
  }, 200);

  chrome.runtime.onMessage.addListener((msg: Msg) => {
    if (msg.type !== "music-control") return;
    const v = video();
    wantPlay = msg.play;
    if (!v) return;
    if (msg.play) void play(msg.fadeS);
    else fade(v, 0, msg.fadeS, () => { if (!wantPlay) v.pause(); });
  });
}
export {};
