// Streaming analyzer: 16 kHz samples in, one Observation per hop out.
// Same parameters as the Python pipeline: 1.5 s windows, VAD threshold 0.5, window counts as
// speech if >= 60% of its 32 ms VAD frames are speech.
import type { Observation } from "../engine/decide";
import { dot, Embedder, WINDOW_SAMPLES } from "./embed";
import { SileroVAD, VAD_CHUNK } from "./vad";

export interface Voiceprint { id: string; vec: Float32Array }

export const HOP_SAMPLES = 8000; // 0.5 s
const VAD_THRESHOLD = 0.5;
const MIN_SPEECH_RATIO = 0.6;
const VAD_PER_WINDOW = Math.floor(WINDOW_SAMPLES / VAD_CHUNK); // 46

export class Analyzer {
  private ring = new Float32Array(WINDOW_SAMPLES);
  private filled = 0;
  private pending = new Float32Array(0);
  private vadFlags: boolean[] = [];
  private sinceHop = 0;
  private t = 0; // seconds of audio consumed
  lastEmbedMs = 0;

  constructor(private vad: SileroVAD, private emb: Embedder, public voiceprints: Voiceprint[]) {}

  /** Feed any number of samples; returns observations completed by this block (usually 0 or 1). */
  async feed(samples: Float32Array): Promise<Observation[]> {
    const obs: Observation[] = [];
    // accumulate into VAD-sized chunks
    const buf = new Float32Array(this.pending.length + samples.length);
    buf.set(this.pending, 0);
    buf.set(samples, this.pending.length);
    let off = 0;
    while (off + VAD_CHUNK <= buf.length) {
      const chunk = buf.subarray(off, off + VAD_CHUNK);
      off += VAD_CHUNK;
      this.push(chunk);
      const p = await this.vad.prob(chunk);
      this.vadFlags.push(p > VAD_THRESHOLD);
      if (this.vadFlags.length > VAD_PER_WINDOW) this.vadFlags.shift();
      this.t += VAD_CHUNK / 16000;
      this.sinceHop += VAD_CHUNK;
      if (this.sinceHop >= HOP_SAMPLES && this.filled >= WINDOW_SAMPLES) {
        this.sinceHop -= HOP_SAMPLES;
        obs.push(await this.observe());
      }
    }
    this.pending = buf.slice(off);
    return obs;
  }

  private push(chunk: Float32Array): void {
    const n = chunk.length;
    this.ring.copyWithin(0, n);
    this.ring.set(chunk, WINDOW_SAMPLES - n);
    this.filled = Math.min(WINDOW_SAMPLES, this.filled + n);
  }

  private async observe(): Promise<Observation> {
    const ratio = this.vadFlags.filter(Boolean).length / VAD_PER_WINDOW;
    const speech = ratio >= MIN_SPEECH_RATIO;
    const scores: Record<string, number> = {};
    if (speech) {
      const t0 = performance.now();
      const e = await this.emb.embed(this.ring);
      this.lastEmbedMs = performance.now() - t0;
      for (const v of this.voiceprints) scores[v.id] = dot(e, v.vec);
    }
    return { t: this.t, speech, scores };
  }
}
