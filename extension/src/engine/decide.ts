// Mute decision logic. Pure and synchronous, so the same code runs in the extension and in the
// offline evaluation harness (via Node).
//
// Rules (agreed in the spec):
//  * Every hop we get one observation: is there speech, and the score of the latest 1.5 s window
//    against every enrolled speaker (muted or not).
//  * Scores are smoothed over the last `smoothN` speech observations.
//  * The best-scoring speaker must be on the mute list AND above its threshold to count as a match.
//    (Non-muted voiceprints compete, so a voice closer to Gašić than to Jovanov never mutes.)
//  * Mute once the same muted speaker has matched for `muteAfterS` of speech (short heckles pass).
//  * While muted, unmute after `unmuteAfterS` of speech that is not the muted speaker, but never
//    sooner than `minHoldS` after muting (avoids music flicker).
//  * Silence changes nothing. Any error fails open (unmute).

export interface Params {
  hopS: number;
  smoothN: number;
  muteAfterS: number;
  unmuteAfterS: number;
  minHoldS: number;
  defaultThreshold: number;
  thresholds: Record<string, number>;
}

export const DEFAULT_PARAMS: Params = {
  hopS: 0.5,
  smoothN: 3,
  muteAfterS: 2.0,
  unmuteAfterS: 1.0,
  minHoldS: 2.0,
  defaultThreshold: 0.5,
  thresholds: {},
};

export interface Observation {
  t: number; // seconds, monotonic
  speech: boolean;
  scores: Record<string, number>; // raw cosine per speaker id
}

export interface Decision {
  t: number;
  muted: boolean;
  target: string | null; // who we're muting (or about to)
  best: string | null;
  bestScore: number;
  smoothed: Record<string, number>;
  changed: boolean;
  reason: string;
}

export class MuteEngine {
  private hist = new Map<string, number[]>();
  private muted = false;
  private target: string | null = null;
  private candidate: string | null = null;
  private matchRun = 0;
  private otherRun = 0;
  private mutedAt = -Infinity;
  private last: Decision | null = null;

  constructor(public params: Params, public muteSet: Set<string>) {}

  private thr(id: string): number {
    return this.params.thresholds[id] ?? this.params.defaultThreshold;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  reset(): void {
    this.hist.clear();
    this.muted = false;
    this.target = this.candidate = null;
    this.matchRun = this.otherRun = 0;
    this.mutedAt = -Infinity;
  }

  /** Fail open: unmute immediately. */
  fail(t: number, reason: string): Decision {
    const changed = this.muted;
    this.reset();
    return (this.last = { t, muted: false, target: null, best: null, bestScore: 0, smoothed: {}, changed, reason: `fail: ${reason}` });
  }

  step(o: Observation): Decision {
    const p = this.params;
    if (!o.speech) {
      const prev = this.last;
      return (this.last = {
        t: o.t, muted: this.muted, target: this.target, best: prev?.best ?? null,
        bestScore: prev?.bestScore ?? 0, smoothed: prev?.smoothed ?? {}, changed: false, reason: "silence",
      });
    }

    const smoothed: Record<string, number> = {};
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const [id, s] of Object.entries(o.scores)) {
      const h = this.hist.get(id) ?? [];
      h.push(s);
      if (h.length > p.smoothN) h.shift();
      this.hist.set(id, h);
      const m = h.reduce((a, b) => a + b, 0) / h.length;
      smoothed[id] = m;
      if (m > bestScore) { bestScore = m; best = id; }
    }
    const match = best !== null && this.muteSet.has(best) && bestScore >= this.thr(best) ? best : null;

    let changed = false;
    let reason: string;
    if (!this.muted) {
      if (match) {
        if (match === this.candidate) this.matchRun += p.hopS;
        else { this.candidate = match; this.matchRun = p.hopS; }
      } else {
        this.candidate = null;
        this.matchRun = 0;
      }
      if (this.candidate && this.matchRun >= p.muteAfterS - 1e-9) {
        this.muted = true;
        this.target = this.candidate;
        this.mutedAt = o.t;
        this.otherRun = 0;
        changed = true;
        reason = `mute: ${this.target} matched ${this.matchRun.toFixed(1)}s`;
      } else {
        reason = match ? `matching ${match} ${this.matchRun.toFixed(1)}s` : "playing";
      }
    } else {
      if (match) {
        this.target = match; // a different muted MP took over: stay muted
        this.otherRun = 0;
        reason = `muted: ${match}`;
      } else {
        this.otherRun += p.hopS;
        reason = `other speech ${this.otherRun.toFixed(1)}s`;
        if (this.otherRun >= p.unmuteAfterS - 1e-9 && o.t - this.mutedAt >= p.minHoldS - 1e-9) {
          this.muted = false;
          this.target = this.candidate = null;
          this.matchRun = this.otherRun = 0;
          changed = true;
          reason = "unmute: other speaker";
        }
      }
    }
    return (this.last = { t: o.t, muted: this.muted, target: this.target, best, bestScore, smoothed, changed, reason });
  }
}
