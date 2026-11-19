// End-to-end replay in Node: real parliament audio -> VAD -> embeddings -> MuteEngine.
// A synthetic "session": Gašić 20 s, Vučić 20 s, Gašić 2 s heckle... checks the mute timeline.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ort from "onnxruntime-web";
import { Analyzer } from "../src/audio/analyzer";
import { Embedder } from "../src/audio/embed";
import { SileroVAD } from "../src/audio/vad";
import { DEFAULT_PARAMS, MuteEngine } from "../src/engine/decide";

const ROOT = process.env.PMUTE_REPO ?? new URL("../..", import.meta.url).pathname;
const VP = process.env.PMUTE_VOICEPRINTS ?? `${ROOT}/data/voiceprints.json`;

function wav16(path: string, fromS: number, durS: number): Float32Array {
  const b = readFileSync(path);
  // 16-bit PCM mono, find "data" chunk
  let p = 12;
  while (b.toString("ascii", p, p + 4) !== "data") p += 8 + b.readUInt32LE(p + 4);
  const data = p + 8;
  const start = data + Math.floor(fromS * 16000) * 2;
  const n = Math.floor(durS * 16000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(start + i * 2) / 32768;
  return out;
}

describe("replay on real audio", () => {
  it("mutes Vučić, not Gašić, and lets a 1.5 s Vučić interjection through", async () => {
    ort.env.wasm.numThreads = 1;
    const vad = await SileroVAD.create(ort, readFileSync(`${ROOT}/models/silero_vad.onnx`));
    const emb = await Embedder.create(ort, readFileSync(`${ROOT}/models/wespeaker_resnet34_lm.onnx`));
    const doc = JSON.parse(readFileSync(VP, "utf8"));
    const vps = doc.speakers.map((s: any) => ({ id: s.id, vec: Float32Array.from(s.voiceprint) }));
    const an = new Analyzer(vad, emb, vps);
    const eng = new MuteEngine({ ...DEFAULT_PARAMS }, new Set(["vucic", "brnabic", "jovanov"]));

    // gasic and vucic from videos where... (vucic clip from LdC5, gasic from OwcVd)
    const gasic = `${ROOT}/data/clips/gasic/gasic__OwcVd-FRsK0__01892-02965.wav`;
    const vucic = `${ROOT}/data/clips/vucic/vucic__LdC5MyntgcE__01314-03124.wav`;
    const segs: [string, Float32Array][] = [
      ["gasic", wav16(gasic, 200, 20)],
      ["vucic", wav16(vucic, 600, 20)],
      ["gasic", wav16(gasic, 400, 10)],
      ["vucic", wav16(vucic, 900, 1.5)],
      ["gasic", wav16(gasic, 500, 10)],
    ];
    const timeline: { t: number; truth: string; muted: boolean; reason: string; best: string | null; score: number }[] = [];
    let t0 = 0;
    for (const [who, audio] of segs) {
      for (let i = 0; i < audio.length; i += 2048) {
        for (const o of await an.feed(audio.subarray(i, i + 2048))) {
          const d = eng.step(o);
          timeline.push({ t: o.t, truth: who, muted: d.muted, reason: d.reason, best: d.best, score: d.bestScore });
        }
      }
      t0 += audio.length / 16000;
    }
    const at = (from: number, to: number) => timeline.filter((x) => x.t > from && x.t <= to);
    const frac = (xs: typeof timeline) => xs.filter((x) => x.muted).length / Math.max(1, xs.length);
    const firstMute = timeline.find((x) => x.muted);
    console.log("first mute at", firstMute?.t.toFixed(1), "s (Vučić starts at 20.0 s)");
    console.log("muted share: gasic 0-20:", frac(at(0, 20)), " vucic 24-40:", frac(at(24, 40)),
      " gasic 43-50:", frac(at(43, 50)), " after interjection 53-61.5:", frac(at(53, 61.5)));
    console.log("embed ms (node, 1 thread):", an.lastEmbedMs.toFixed(0));
    expect(frac(at(0, 20))).toBe(0);
    expect(frac(at(24, 40))).toBe(1);
    expect(firstMute!.t).toBeGreaterThan(20);
    expect(firstMute!.t).toBeLessThan(24.5);
    expect(frac(at(43, 50))).toBe(0); // unmuted once Gašić is back
    expect(frac(at(53, 61.5))).toBe(0); // the 1.5 s Vučić interjection did not trigger music
  }, 300000);
});
