import type { Msg, Status } from "./shared/messages";
import { loadSettings, saveSettings, Settings } from "./shared/settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const NAMES: Record<string, string> = { vucic: "Vučić", brnabic: "Brnabić", jovanov: "Jovanov", bakic: "Bakić", gasic: "Gašić" };

let settings: Settings;
let running = false;

function showStatus(s: Status | null) {
  running = !!s?.running;
  const t = $<HTMLButtonElement>("toggle");
  t.textContent = running ? "Stop" : "Start on this tab";
  t.className = running ? "stop" : "start";
  if (!s) { $("status").textContent = ""; return; }
  $("status").textContent = s.error ? `Error: ${s.error}`
    : !s.running ? s.reason
    : s.muted ? `Muted: ${NAMES[s.target ?? ""] ?? s.target}` : `Listening (${s.reason})`;
}

async function persist() {
  await saveSettings(settings);
  chrome.runtime.sendMessage({ type: "settings-changed", settings } satisfies Msg);
}

async function init() {
  settings = await loadSettings();
  const vp = await (await fetch(chrome.runtime.getURL("voiceprints.json"))).json();
  const box = $("speakers");
  // only MPs we can mute are listed; the other voiceprints (Bakić, Gašić) stay in the file
  // because they compete with the targets and prevent false mutes
  for (const s of (vp.speakers as { id: string; display_name: string; default_muted: boolean }[]).filter((x) => x.default_muted)) {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = settings.muted.includes(s.id);
    c.onchange = () => {
      settings.muted = c.checked ? [...new Set([...settings.muted, s.id])] : settings.muted.filter((x) => x !== s.id);
      void persist();
    };
    l.append(c, document.createTextNode(s.display_name));
    box.append(l);
  }
  const music = $<HTMLInputElement>("music");
  music.value = settings.musicUrl;
  music.onchange = () => { settings.musicUrl = music.value.trim(); void persist(); };
  const debug = $<HTMLInputElement>("debug");
  debug.checked = settings.debug;
  debug.onchange = () => { settings.debug = debug.checked; void persist(); };
  const thr = $<HTMLInputElement>("thr");
  thr.value = String(settings.threshold);
  $("thrv").textContent = settings.threshold.toFixed(2);
  thr.oninput = () => { $("thrv").textContent = Number(thr.value).toFixed(2); };
  thr.onchange = () => { settings.threshold = Number(thr.value); void persist(); };

  const run = await chrome.runtime.sendMessage({ type: "get-state" } satisfies Msg);
  showStatus(run?.captureTabId != null ? run.status : null);

  $("toggle").onclick = async () => {
    if (running) {
      await chrome.runtime.sendMessage({ type: "stop" } satisfies Msg);
      showStatus(null);
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/youtube\.com/.test(tab.url ?? "")) {
      $("status").textContent = "Open a YouTube video in this tab first.";
      return;
    }
    // must be called from the popup (user gesture) for tab capture to be allowed
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await chrome.runtime.sendMessage({ type: "start", tabId: tab.id, streamId } satisfies Msg);
    showStatus({ running: true, muted: false, target: null, best: null, bestScore: 0, reason: "loading models…", embedMs: 0, t: 0 });
  };

  $("export").onclick = async () => {
    const r = await chrome.storage.local.get("wrongLog");
    const blob = new Blob([JSON.stringify(r.wrongLog ?? [], null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pmute-wrong-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  chrome.runtime.onMessage.addListener((msg: Msg) => { if (msg.type === "status") showStatus(msg.status); });
}

void init();
