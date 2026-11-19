// Parity: the TypeScript feature pipeline + ONNX model must reproduce the Python pipeline.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ort from "onnxruntime-web";
import { cmn, fbank, NUM_MEL } from "../src/audio/fbank";
import { dot, Embedder } from "../src/audio/embed";

const here = new URL(".", import.meta.url).pathname;
const MODEL = process.env.PMUTE_MODEL ?? new URL("../../models/wespeaker_resnet34_lm.onnx", import.meta.url).pathname;

const f32 = (p: string) => {
  const b = readFileSync(here + p);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const py = JSON.parse(readFileSync(here + "fixture_py.json", "utf8"));

describe("fbank parity with kaldi-native-fbank", () => {
  it("matches the Python fbank within 1e-3", () => {
    const wav = f32("fixture_wav.f32");
    const ref = f32("fixture_fbank.f32");
    const ts = fbank(wav);
    expect(ts.length).toBe(ref.length);
    let maxDiff = 0;
    for (let i = 0; i < ts.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ts[i] - ref[i]));
    console.log("fbank max abs diff", maxDiff);
    expect(maxDiff).toBeLessThan(1e-3);
  });
});

describe("embedding parity", () => {
  it("cosine with Python embeddings > 0.999 on every window", async () => {
    ort.env.wasm.numThreads = 1;
    const emb = await Embedder.create(ort, readFileSync(MODEL));
    const feats = fbank(f32("fixture_wav.f32"));
    let worst = 1;
    for (let k = 0; k < py.starts.length; k++) {
      const s = py.starts[k];
      const win = feats.slice(s * NUM_MEL, (s + 150) * NUM_MEL);
      const e = await emb.embedFeats(cmn(win, 150), 150);
      worst = Math.min(worst, dot(e, py.emb[k]));
    }
    console.log("worst cosine vs python", worst);
    expect(worst).toBeGreaterThan(0.999);
  }, 60000);
});
