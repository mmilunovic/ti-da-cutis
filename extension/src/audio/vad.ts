// Silero VAD v5 (ONNX). One probability per 512-sample chunk (32 ms) at 16 kHz.
import type * as OrtNS from "onnxruntime-web";

export const VAD_CHUNK = 512;
const CONTEXT = 64;

export class SileroVAD {
  private state: Float32Array = new Float32Array(2 * 128);
  private context = new Float32Array(CONTEXT);
  private sr: OrtNS.Tensor;

  private constructor(private ort: typeof OrtNS, private sess: OrtNS.InferenceSession) {
    this.sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
  }

  static async create(ort: typeof OrtNS, model: Uint8Array | ArrayBuffer): Promise<SileroVAD> {
    const sess = await ort.InferenceSession.create(model instanceof Uint8Array ? model : new Uint8Array(model), {
      executionProviders: ["wasm"],
    });
    return new SileroVAD(ort, sess);
  }

  reset(): void {
    this.state = new Float32Array(2 * 128);
    this.context = new Float32Array(CONTEXT);
  }

  async prob(chunk: Float32Array): Promise<number> {
    const x = new Float32Array(CONTEXT + VAD_CHUNK);
    x.set(this.context, 0);
    x.set(chunk, CONTEXT);
    const out = await this.sess.run({
      input: new this.ort.Tensor("float32", x, [1, CONTEXT + VAD_CHUNK]),
      state: new this.ort.Tensor("float32", this.state, [2, 1, 128]),
      sr: this.sr,
    });
    this.state = new Float32Array(out["stateN"].data as Float32Array);
    this.context = x.slice(x.length - CONTEXT);
    return (out["output"].data as Float32Array)[0];
  }
}
