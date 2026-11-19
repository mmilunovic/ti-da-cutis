// Speaker embedding with the WeSpeaker ResNet34 ONNX model (same file as the Python pipeline).
import type * as OrtNS from "onnxruntime-web";
import { cmn, fbank, NUM_MEL, numFrames } from "./fbank";

export const WINDOW_SAMPLES = 24000; // 1.5 s at 16 kHz
export const WINDOW_FRAMES = numFrames(WINDOW_SAMPLES); // 148

export class Embedder {
  private constructor(private ort: typeof OrtNS, private sess: OrtNS.InferenceSession) {}

  static async create(ort: typeof OrtNS, model: Uint8Array | ArrayBuffer): Promise<Embedder> {
    const sess = await ort.InferenceSession.create(model instanceof Uint8Array ? model : new Uint8Array(model), {
      executionProviders: ["wasm"],
    });
    return new Embedder(ort, sess);
  }

  /** Embed features already computed (frames x 80, CMN applied). Returns L2-normalized vector. */
  async embedFeats(feats: Float32Array, frames: number): Promise<Float32Array> {
    const t = new this.ort.Tensor("float32", feats, [1, frames, NUM_MEL]);
    const out = await this.sess.run({ feats: t });
    const e = out["embs"].data as Float32Array;
    let n = 0;
    for (let i = 0; i < e.length; i++) n += e[i] * e[i];
    n = Math.sqrt(n);
    const r = new Float32Array(e.length);
    for (let i = 0; i < e.length; i++) r[i] = e[i] / n;
    return r;
  }

  /** Full path from 16 kHz samples (1.5 s window) to embedding. */
  async embed(samples: Float32Array): Promise<Float32Array> {
    const frames = numFrames(samples.length);
    return this.embedFeats(cmn(fbank(samples), frames), frames);
  }
}

export function dot(a: Float32Array | number[], b: Float32Array | number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
