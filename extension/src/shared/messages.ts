import type { Settings } from "./settings";

export interface Status {
  running: boolean;
  muted: boolean;
  target: string | null;
  best: string | null;
  bestScore: number;
  reason: string;
  embedMs: number;
  error?: string;
  music?: "none" | "ready" | "blocked";
  t: number;
}

export type Msg =
  // popup -> background
  | { type: "start"; tabId: number; streamId: string }
  | { type: "stop" }
  | { type: "get-state" }
  | { type: "settings-changed"; settings: Settings }
  // background -> offscreen
  | { type: "offscreen-start"; streamId: string; settings: Settings }
  | { type: "offscreen-stop" }
  | { type: "offscreen-settings"; settings: Settings }
  // offscreen -> background (and relayed to the captured tab + popup)
  | { type: "status"; status: Status }
  | { type: "music"; play: boolean }
  // background -> music tab
  | { type: "music-control"; play: boolean; fadeS: number }
  // music tab -> background
  | { type: "music-armed" }
  | { type: "music-blocked" }
  // content -> background
  | { type: "wrong"; entry: WrongEntry };

export interface WrongEntry {
  at: string;
  url: string;
  videoTime: number;
  status: Status | null;
}
