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

  it("unmutes after 3 s of another speaker", () => {
    const ds = run([[10, "vucic"], [5, "chair"]]);
    // vucic until 10.0, chair from 10.5; unmute after 3.0 s of chair -> t=13.0
    expect(mutedAt(ds, 12.5)).toBe(true);
    expect(mutedAt(ds, 13.0)).toBe(false);
  });

  it("a few words from the chair keep the music going", () => {
    const ds = run([[8, "vucic"], [2, "chair"], [6, "vucic"], [2.5, "chair"], [4, "vucic"]]);
    expect(ds.filter((d) => d.t >= 2).every((d) => d.muted)).toBe(true);
    expect(ds.filter((d) => d.changed).length).toBe(1);
  });

  it("min hold after muting: no unmute sooner than 5 s", () => {
    const ds = run([[2, "vucic"], [6, "chair"]]);
    expect(mutedAt(ds, 2.0)).toBe(true);
    expect(mutedAt(ds, 5.5)).toBe(true); // 3.5 s of chair, but only 3.5 s since mute
    expect(mutedAt(ds, 7.0)).toBe(false);
  });

  it("min hold after unmuting: a quick comeback does not flip the music right back", () => {
    const ds = run([[10, "vucic"], [3, "chair"], [10, "vucic"]]);
    // unmuted at 13.0; vucic back at 13.5 -> 2 s matched by 15.0, but hold until 18.0
    expect(mutedAt(ds, 13.0)).toBe(false);
    expect(mutedAt(ds, 17.5)).toBe(false);
    expect(mutedAt(ds, 18.0)).toBe(true);
    expect(ds.filter((d) => d.changed).length).toBe(3);
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
