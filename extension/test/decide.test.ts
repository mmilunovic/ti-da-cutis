import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, MuteEngine, Observation } from "../src/engine/decide";

const MUTE = new Set(["vucic", "jovanov"]);
const HI = 0.7, LO = 0.1;

// build observations at 0.5 s hops from a script of [seconds, who] segments ("" = silence)
function script(parts: [number, string][]): Observation[] {
  const obs: Observation[] = [];
  let t = 0;
  for (const [dur, who] of parts) {
    for (let k = 0; k < dur / 0.5; k++) {
      t += 0.5;
      obs.push({
        t, speech: who !== "",
        scores: { vucic: who === "vucic" ? HI : LO, jovanov: who === "jovanov" ? HI : LO, gasic: who === "gasic" ? HI : LO, chair: who === "chair" ? HI : LO },
      });
    }
  }
  return obs;
}

function run(parts: [number, string][]) {
  const e = new MuteEngine({ ...DEFAULT_PARAMS, smoothN: 1 }, MUTE);
  return script(parts).map((o) => e.step(o));
}

const mutedAt = (ds: ReturnType<typeof run>, t: number) => ds.find((d) => Math.abs(d.t - t) < 1e-9)!.muted;

describe("MuteEngine", () => {
  it("mutes a blocked MP after 2 s of sustained speech", () => {
    const ds = run([[3, "chair"], [10, "vucic"]]);
    expect(mutedAt(ds, 4.5)).toBe(false);
    expect(mutedAt(ds, 5.0)).toBe(true); // 2.0 s of vucic
    expect(ds.at(-1)!.target).toBe("vucic");
  });

  it("lets short interjections through", () => {
    const ds = run([[5, "chair"], [1.5, "vucic"], [5, "chair"]]);
    expect(ds.some((d) => d.muted)).toBe(false);
  });

  it("unmutes after 1 s of another speaker, but holds music at least 2 s", () => {
    const ds = run([[10, "vucic"], [3, "chair"]]);
    // muted at t=2.0; chair starts at 10.5, unmute after 1.0 s -> t=11.0
    expect(mutedAt(ds, 10.5)).toBe(true);
    expect(mutedAt(ds, 11.0)).toBe(false);
  });

  it("min hold: a quick switch right after muting does not flicker", () => {
    const ds = run([[2, "vucic"], [1, "chair"], [5, "chair"]]);
    expect(mutedAt(ds, 2.0)).toBe(true);
    expect(mutedAt(ds, 3.0)).toBe(true); // otherRun=1.0 but only 1 s since mute
    expect(mutedAt(ds, 4.0)).toBe(false);
  });

  it("silence changes nothing", () => {
    const ds = run([[3, "vucic"], [6, ""], [1, "vucic"]]);
    expect(ds.filter((d) => d.t > 3 && d.t <= 9).every((d) => d.muted)).toBe(true);
    const ds2 = run([[1.5, "vucic"], [6, ""], [0.5, "vucic"]]);
    expect(mutedAt(ds2, 8.0)).toBe(true); // 1.5 + 0.5 s of vucic across a pause
  });

  it("stays muted when one blocked MP hands over to another", () => {
    const ds = run([[4, "vucic"], [4, "jovanov"]]);
    expect(ds.filter((d) => d.t >= 2).every((d) => d.muted)).toBe(true);
    expect(ds.at(-1)!.target).toBe("jovanov");
  });

  it("a non-muted voiceprint that scores higher wins (no mute)", () => {
    const e = new MuteEngine({ ...DEFAULT_PARAMS, smoothN: 1 }, MUTE);
    let last;
    for (let t = 0.5; t <= 5; t += 0.5) last = e.step({ t, speech: true, scores: { jovanov: 0.55, gasic: 0.6, vucic: 0.1 } });
    expect(last!.muted).toBe(false);
  });

  it("below threshold never mutes", () => {
    const e = new MuteEngine({ ...DEFAULT_PARAMS, smoothN: 1 }, MUTE);
    let last;
    for (let t = 0.5; t <= 10; t += 0.5) last = e.step({ t, speech: true, scores: { vucic: 0.45, gasic: 0.1 } });
    expect(last!.muted).toBe(false);
  });

  it("fails open", () => {
    const e = new MuteEngine({ ...DEFAULT_PARAMS, smoothN: 1 }, MUTE);
    for (const o of script([[4, "vucic"]])) e.step(o);
    expect(e.isMuted).toBe(true);
    const d = e.fail(5, "model error");
    expect(d.muted).toBe(false);
    expect(d.changed).toBe(true);
  });
});
