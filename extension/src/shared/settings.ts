export interface Settings {
  muted: string[]; // speaker ids to mute
  musicUrl: string; // YouTube link played while muted
  delay: boolean; // 3 s audio delay: mute from the first word, picture runs ahead
  debug: boolean; // show the badge on the page
  threshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  muted: ["vucic", "brnabic", "jovanov"],
  musicUrl: "", // paste a YouTube link in the popup; empty = plain mute
  delay: false,
  debug: true,
  threshold: 0.4,
};

export const DELAY_S = 3.0;
export const FADE_S = 0.3;

const SETTINGS_VERSION = 2;

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(["settings", "settingsVersion"]);
  const s: Settings = { ...DEFAULT_SETTINGS, ...((r.settings as Partial<Settings> | undefined) ?? {}) };
  if (r.settingsVersion !== SETTINGS_VERSION) {
    // v2: default threshold 0.4, delay option removed
    s.threshold = DEFAULT_SETTINGS.threshold;
    await chrome.storage.local.set({ settings: s, settingsVersion: SETTINGS_VERSION });
  }
  s.delay = false;
  return s;
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}
