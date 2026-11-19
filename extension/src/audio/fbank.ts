// Kaldi-compatible 80-dim log-mel filterbank, matching kaldi-native-fbank with the options the
// Python pipeline uses: 16 kHz, 25 ms frames, 10 ms shift, hamming window, dither 0,
// remove DC offset, pre-emphasis 0.97, 512-point FFT, power spectrum, mel 20 Hz..Nyquist,
// log with float-epsilon floor, snip_edges. Input samples are in [-1, 1]; they are scaled by
// 32768 here, exactly like the Python side.

export const SR = 16000;
export const FRAME_LEN = 400;
export const FRAME_SHIFT = 160;
export const NUM_MEL = 80;
const FFT_N = 512;
const PREEMPH = 0.97;
const FLT_EPS = 1.1920928955078125e-7;

const mel = (f: number) => 1127 * Math.log(1 + f / 700);

function buildWindow(): Float64Array {
  const w = new Float64Array(FRAME_LEN);
  const a = (2 * Math.PI) / (FRAME_LEN - 1);
  for (let i = 0; i < FRAME_LEN; i++) w[i] = 0.54 - 0.46 * Math.cos(a * i);
  return w;
}

interface MelBin { start: number; weights: Float64Array }

function buildMelBanks(): MelBin[] {
  const numFftBins = FFT_N / 2;
  const binWidth = SR / FFT_N;
  const lo = mel(20), hi = mel(SR / 2);
  const delta = (hi - lo) / (NUM_MEL + 1);
  const banks: MelBin[] = [];
  for (let b = 0; b < NUM_MEL; b++) {
    const left = lo + b * delta, center = left + delta, right = center + delta;
    const tmp = new Float64Array(numFftBins);
    let first = -1, last = -1;
    for (let i = 0; i < numFftBins; i++) {
      const m = mel(binWidth * i);
      if (m > left && m < right) {
        tmp[i] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
        if (first < 0) first = i;
        last = i;
      }
    }
    banks.push({ start: first, weights: tmp.slice(first, last + 1) });
  }
  return banks;
}

const WINDOW = buildWindow();
const BANKS = buildMelBanks();

// in-place iterative radix-2 complex FFT
const REV = (() => {
  const r = new Uint16Array(FFT_N);
  const bits = Math.log2(FFT_N);
  for (let i = 0; i < FFT_N; i++) {
    let x = i, y = 0;
    for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
    r[i] = y;
  }
  return r;
})();
const COS = new Float64Array(FFT_N / 2), SIN = new Float64Array(FFT_N / 2);
for (let i = 0; i < FFT_N / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / FFT_N); SIN[i] = -Math.sin((2 * Math.PI * i) / FFT_N); }

function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < FFT_N; i++) {
    const j = REV[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= FFT_N; size <<= 1) {
    const half = size >> 1, step = FFT_N / size;
    for (let s = 0; s < FFT_N; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step], wi = SIN[k * step];
        const a = s + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

export function numFrames(numSamples: number): number {
  return numSamples < FRAME_LEN ? 0 : 1 + Math.floor((numSamples - FRAME_LEN) / FRAME_SHIFT);
}

/** Returns row-major (frames x 80) log-mel features. */
export function fbank(samples: Float32Array): Float32Array {
  const n = numFrames(samples.length);
  const out = new Float32Array(n * NUM_MEL);
  const frame = new Float64Array(FRAME_LEN);
  const re = new Float64Array(FFT_N), im = new Float64Array(FFT_N);
  const power = new Float64Array(FFT_N / 2 + 1);
  for (let f = 0; f < n; f++) {
    const off = f * FRAME_SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME_LEN; i++) { frame[i] = samples[off + i] * 32768; mean += frame[i]; }
    mean /= FRAME_LEN;
    for (let i = 0; i < FRAME_LEN; i++) frame[i] -= mean;
    for (let i = FRAME_LEN - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1];
    frame[0] -= PREEMPH * frame[0];
    re.fill(0); im.fill(0);
    for (let i = 0; i < FRAME_LEN; i++) re[i] = frame[i] * WINDOW[i];
    fft(re, im);
    for (let i = 0; i <= FFT_N / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    for (let b = 0; b < NUM_MEL; b++) {
      const { start, weights } = BANKS[b];
      let e = 0;
      for (let k = 0; k < weights.length; k++) e += weights[k] * power[start + k];
      out[f * NUM_MEL + b] = Math.log(Math.max(e, FLT_EPS));
    }
  }
  return out;
}

/** Subtract the per-dimension mean over frames (CMN), in place. */
export function cmn(feats: Float32Array, frames: number): Float32Array {
  const mean = new Float64Array(NUM_MEL);
  for (let f = 0; f < frames; f++) for (let b = 0; b < NUM_MEL; b++) mean[b] += feats[f * NUM_MEL + b];
  for (let b = 0; b < NUM_MEL; b++) mean[b] /= frames;
  for (let f = 0; f < frames; f++) for (let b = 0; b < NUM_MEL; b++) feats[f * NUM_MEL + b] -= mean[b];
  return feats;
}
