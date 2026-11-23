// src/shared/settings.ts
var DEFAULT_SETTINGS = {
  muted: ["vucic", "brnabic", "jovanov"],
  musicUrl: "",
  // paste a YouTube link in the popup; empty = plain mute
  delay: false,
  debug: true,
  threshold: 0.55
};
var SETTINGS_VERSION = 3;
async function loadSettings() {
  const r = await chrome.storage.local.get(["settings", "settingsVersion"]);
  const s = { ...DEFAULT_SETTINGS, ...r.settings ?? {} };
  if (r.settingsVersion !== SETTINGS_VERSION) {
    s.threshold = DEFAULT_SETTINGS.threshold;
    await chrome.storage.local.set({ settings: s, settingsVersion: SETTINGS_VERSION });
  }
  s.delay = false;
  return s;
}
async function saveSettings(s) {
  await chrome.storage.local.set({ settings: s });
}

// src/popup.ts
var $ = (id) => document.getElementById(id);
var NAMES = { vucic: "Vu\u010Di\u0107", brnabic: "Brnabi\u0107", jovanov: "Jovanov", bakic: "Baki\u0107", gasic: "Ga\u0161i\u0107" };
var settings;
var running = false;
function showStatus(s) {
  running = !!s?.running;
  const t = $("toggle");
  t.textContent = running ? "Stop" : "Start on this tab";
  t.className = running ? "stop" : "start";
  if (!s) {
    $("status").textContent = "";
    return;
  }
  $("status").textContent = s.error ? `Error: ${s.error}` : !s.running ? s.reason : s.muted ? `Muted: ${NAMES[s.target ?? ""] ?? s.target}` : `Listening (${s.reason})`;
}
async function persist() {
  await saveSettings(settings);
  chrome.runtime.sendMessage({ type: "settings-changed", settings });
}
async function init() {
  settings = await loadSettings();
  const vp = await (await fetch(chrome.runtime.getURL("voiceprints.json"))).json();
  const box = $("speakers");
  for (const s of vp.speakers.filter((x) => x.default_muted)) {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = settings.muted.includes(s.id);
    c.onchange = () => {
      settings.muted = c.checked ? [.../* @__PURE__ */ new Set([...settings.muted, s.id])] : settings.muted.filter((x) => x !== s.id);
      void persist();
    };
    l.append(c, document.createTextNode(s.display_name));
    box.append(l);
  }
  const music = $("music");
  music.value = settings.musicUrl;
  music.onchange = () => {
    settings.musicUrl = music.value.trim();
    void persist();
  };
  const debug = $("debug");
  debug.checked = settings.debug;
  debug.onchange = () => {
    settings.debug = debug.checked;
    void persist();
  };
  const thr = $("thr");
  thr.value = String(settings.threshold);
  $("thrv").textContent = settings.threshold.toFixed(2);
  thr.oninput = () => {
    $("thrv").textContent = Number(thr.value).toFixed(2);
  };
  thr.onchange = () => {
    settings.threshold = Number(thr.value);
    void persist();
  };
  const run = await chrome.runtime.sendMessage({ type: "get-state" });
  showStatus(run?.captureTabId != null ? run.status : null);
  $("toggle").onclick = async () => {
    if (running) {
      await chrome.runtime.sendMessage({ type: "stop" });
      showStatus(null);
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/youtube\.com/.test(tab.url ?? "")) {
      $("status").textContent = "Open a YouTube video in this tab first.";
      return;
    }
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await chrome.runtime.sendMessage({ type: "start", tabId: tab.id, streamId });
    showStatus({ running: true, muted: false, target: null, best: null, bestScore: 0, reason: "loading models\u2026", embedMs: 0, t: 0 });
  };
  $("export").onclick = async () => {
    const r = await chrome.storage.local.get("wrongLog");
    const blob = new Blob([JSON.stringify(r.wrongLog ?? [], null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pmute-wrong-log-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    a.click();
  };
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "status") showStatus(msg.status);
  });
}
void init();
//# sourceMappingURL=popup.js.map
