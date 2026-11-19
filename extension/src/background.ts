// Service worker: wires popup, offscreen document, the captured tab and the music tab together.
// Its memory can be wiped at any time (MV3), so tab ids live in chrome.storage.session.
import type { Msg, Status, WrongEntry } from "./shared/messages";
import { FADE_S, loadSettings } from "./shared/settings";

interface Run { captureTabId: number | null; musicTabId: number | null; musicUrl: string; music: Status["music"]; status: Status | null }

// All reads/writes of the run state go through one queue, so the twice-a-second status updates
// can't overwrite a tab id that another handler just saved.
let cache: Run | null = null;
let chain: Promise<unknown> = Promise.resolve();
const EMPTY: Run = { captureTabId: null, musicTabId: null, musicUrl: "", music: "none", status: null };

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

async function load(): Promise<Run> {
  if (!cache) {
    const r = await chrome.storage.session.get("run");
    cache = { ...EMPTY, ...((r.run as Partial<Run> | undefined) ?? {}) };
  }
  return cache;
}

function getRun(): Promise<Run> {
  return serial(async () => ({ ...(await load()) }));
}

function setRun(patch: Partial<Run>): Promise<Run> {
  return serial(async () => {
    cache = { ...(await load()), ...patch };
    await chrome.storage.session.set({ run: cache });
    return { ...cache };
  });
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Analyse the captured tab audio and mute selected speakers",
  });
}

const isYouTube = (url: string) => /^https:\/\/(www\.|m\.|music\.)?youtube\.com\/|^https:\/\/youtu\.be\//.test(url);

// Music tab: opened (not pinned) the first time someone is muted; after that we switch to it on
// every mute and back to the parliament tab when the muted speaker stops.
async function musicTabAlive(id: number | null): Promise<boolean> {
  if (id == null) return false;
  return chrome.tabs.get(id).then(() => true, () => false);
}

async function playMusic() {
  const run = await getRun();
  const settings = await loadSettings();
  if (!settings.musicUrl || !isYouTube(settings.musicUrl)) return;
  if (await musicTabAlive(run.musicTabId) && run.musicUrl === settings.musicUrl) {
    await chrome.tabs.update(run.musicTabId!, { active: true });
    chrome.tabs.sendMessage(run.musicTabId!, { type: "music-control", play: true, fadeS: FADE_S } satisfies Msg).catch(() => {});
    return;
  }
  if (run.musicTabId != null) await chrome.tabs.remove(run.musicTabId).catch(() => {});
  const tab = await chrome.tabs.create({ url: settings.musicUrl, active: true });
  // music.js is injected on load and starts playing on its own (see onUpdated)
  await setRun({ musicTabId: tab.id ?? null, musicUrl: settings.musicUrl, music: "ready" });
}

async function pauseMusic() {
  const run = await getRun();
  if (await musicTabAlive(run.musicTabId)) {
    chrome.tabs.sendMessage(run.musicTabId!, { type: "music-control", play: false, fadeS: FADE_S } satisfies Msg).catch(() => {});
  }
  if (run.captureTabId != null) await chrome.tabs.update(run.captureTabId, { active: true }).catch(() => {});
}

async function pushStatus() {
  const run = await getRun();
  if (run.captureTabId != null && run.status) {
    chrome.tabs.sendMessage(run.captureTabId, { type: "status", status: { ...run.status, music: run.music } } satisfies Msg).catch(() => {});
  }
}

async function injectMusic(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["music.js"] }).catch(() => {});
}

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const run = await getRun();
  if (tabId === run.musicTabId && info.status === "complete") await injectMusic(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const run = await getRun();
  if (tabId === run.captureTabId) await stopAll();
  if (tabId === run.musicTabId) await setRun({ musicTabId: null, musicUrl: "" });
});

async function stopAll() {
  const run = await getRun();
  chrome.runtime.sendMessage({ type: "offscreen-stop" } satisfies Msg).catch(() => {});
  if (await musicTabAlive(run.musicTabId)) {
    chrome.tabs.sendMessage(run.musicTabId!, { type: "music-control", play: false, fadeS: FADE_S } satisfies Msg).catch(() => {});
  }
  await setRun({ captureTabId: null });
  await chrome.action.setBadgeText({ text: "" });
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "start": {
        const settings = await loadSettings();
        await ensureOffscreen();
        await setRun({ captureTabId: msg.tabId, music: settings.musicUrl ? "ready" : "none" });
        chrome.runtime.sendMessage({ type: "offscreen-start", streamId: msg.streamId, settings } satisfies Msg);
        reply({ ok: true });
        break;
      }
      case "stop":
        await stopAll();
        reply({ ok: true });
        break;
      case "get-state": {
        const run = await getRun();
        reply({ ...run, isCaptureTab: sender.tab?.id != null && sender.tab.id === run.captureTabId });
        break;
      }
      case "settings-changed": {
        chrome.runtime.sendMessage({ type: "offscreen-settings", settings: msg.settings } satisfies Msg).catch(() => {});
        const run = await getRun();
        await setRun({ music: msg.settings.musicUrl ? "ready" : "none" });
        if (run.captureTabId != null) chrome.tabs.sendMessage(run.captureTabId, msg).catch(() => {});
        reply({ ok: true });
        break;
      }
      case "status": {
        const run = await setRun({ status: msg.status });
        if (run.captureTabId != null) chrome.tabs.sendMessage(run.captureTabId, { type: "status", status: { ...msg.status, music: run.music } } satisfies Msg).catch(() => {});
        await chrome.action.setBadgeText({ text: msg.status.running ? (msg.status.muted ? "♪" : "on") : "" });
        await chrome.action.setBadgeBackgroundColor({ color: msg.status.muted ? "#993556" : "#3B6D11" });
        break;
      }
      case "music": {
        if (msg.play) await playMusic();
        else await pauseMusic();
        break;
      }
      case "music-armed":
        await setRun({ music: "ready" });
        await pushStatus();
        break;
      case "music-blocked":
        await setRun({ music: "blocked" });
        await pushStatus();
        break;
      case "wrong": {
        const r = await chrome.storage.local.get("wrongLog");
        const log = (r.wrongLog as WrongEntry[] | undefined) ?? [];
        log.push(msg.entry);
        await chrome.storage.local.set({ wrongLog: log });
        reply({ ok: true, count: log.length });
        break;
      }
    }
  })();
  return true;
});
