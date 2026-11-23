// tempo estimation: autocorrelation of the onset strength over a sliding window; the shortest strong period is chosen and refined with its multiples

/** Default length of the analysis window, in seconds. */
const DEFAULT_WINDOW_SECONDS = 8;
/** Shortest window accepted, in seconds. */
const MIN_WINDOW_SECONDS = 2;
/** Longest window accepted, in seconds. */
const MAX_WINDOW_SECONDS = 30;
/** Default lower end of the reported tempo range, in BPM. */
const DEFAULT_MIN_BPM = 70;
/** Default upper end of the reported tempo range, in BPM. */
const DEFAULT_MAX_BPM = 180;
/** A period counts as strong when its autocorrelation is at least this fraction of the strongest one. */
const PICK_RATIO = 0.8;
/** A multiple of the period confirms it when its autocorrelation is at least this fraction of the period's. */
const MULTIPLE_RATIO = 0.5;
/** Largest multiple of the period used to refine it. */
const MAX_MULTIPLE = 4;
/** Half width, in lags, of the centroid used to refine a peak. */
const REFINE_HALF_WIDTH = 2;
/** Autocorrelation at lag 0 per value at or below this counts as no rhythm at all. */
const MIN_VARIANCE = 1e-12;

/** A tempo estimate. */
export interface BpmEstimate {
  /** Tempo in beats per minute, inside the configured range. */
  bpm: number;
  /** Strength of the periodicity, 0..1. Clean rhythms read high, noise reads low. */
  confidence: number;
}

/**
 * Tempo detector: takes onset strength values at a fixed rate (see OnsetDetector) and
 * estimates the tempo from the autocorrelation of the last few seconds of them.
 */
export class BpmDetector {
  #hopRate: number;
  #minBpm: number;
  #maxBpm: number;
  #n: number;
  #lo: number;
  #hiFull: number;
  #lmax: number;
  #buf: Float64Array;
  #a: Float64Array;
  #z: Float64Array;
  #r: Float64Array;
  #result: BpmEstimate = { bpm: 0, confidence: 0 };
  #index = 0;
  #count = 0;
  /** Last lag index the refinement may read; set by estimate. */
  #lagLimit = 0;

  /**
   * Throws RangeError unless hopRate is finite and > 0. windowSeconds is clamped to 2..30
   * (default 8). minBpm and maxBpm are used only when both are finite, > 0 and
   * maxBpm >= 2 * minBpm; otherwise 70 and 180.
   */
  constructor(hopRate: number, opts: { windowSeconds?: number; minBpm?: number; maxBpm?: number } = {}) {
    if (!Number.isFinite(hopRate) || hopRate <= 0) {
      throw new RangeError('BpmDetector: hopRate must be finite and > 0');
    }
    const w = opts.windowSeconds;
    const windowSeconds =
      typeof w === 'number' && Number.isFinite(w) && w > 0
        ? Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, w))
        : DEFAULT_WINDOW_SECONDS;
    const a = opts.minBpm;
    const b = opts.maxBpm;
    const rangeOk =
      typeof a === 'number' && typeof b === 'number' &&
      Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && b >= 2 * a;
    this.#minBpm = rangeOk ? (a as number) : DEFAULT_MIN_BPM;
    this.#maxBpm = rangeOk ? (b as number) : DEFAULT_MAX_BPM;
    this.#hopRate = hopRate;
    this.#n = Math.max(8, Math.round(windowSeconds * hopRate));
    this.#lo = Math.max(1, Math.floor((hopRate * 60) / this.#maxBpm));
    this.#hiFull = Math.ceil((2 * hopRate * 60) / this.#minBpm);
    this.#lmax = Math.min(this.#n - 1, 2 * this.#hiFull + 4);
    this.#buf = new Float64Array(this.#n);
    this.#a = new Float64Array(this.#n);
    this.#z = new Float64Array(this.#n);
    this.#r = new Float64Array(this.#lmax + 1);
  }

  /** Adds one onset strength value. A value that is not finite or is negative counts as 0. */
  push(onsetValue: number): void {
    this.#buf[this.#index] = Number.isFinite(onsetValue) && onsetValue >= 0 ? onsetValue : 0;
    this.#index++;
    if (this.#index === this.#n) this.#index = 0;
    if (this.#count < this.#n) this.#count++;
  }

  /**
   * The current tempo, or null while less than half a window has been pushed or the input
   * has no rhythm (silence, a constant). The same object is returned every time, updated in
   * place; copy its fields to keep them.
   */
  estimate(): BpmEstimate | null {
    const n = this.#n;
    const m = this.#count;
    if (m < Math.ceil(n / 2)) return null;
    const buf = this.#buf;
    const a = this.#a;
    const z = this.#z;
    const r = this.#r;

    // the last m values, oldest first
    let src = this.#index - m;
    if (src < 0) src += n;
    for (let i = 0; i < m; i++) {
      a[i] = buf[src];
      src++;
      if (src === n) src = 0;
    }

    // light smoothing, then mean removal
    z[0] = a[0];
    z[m - 1] = a[m - 1];
    for (let i = 1; i < m - 1; i++) z[i] = 0.25 * a[i - 1] + 0.5 * a[i] + 0.25 * a[i + 1];
    let sum = 0;
    for (let i = 0; i < m; i++) sum += z[i];
    const mean = sum / m;
    for (let i = 0; i < m; i++) z[i] -= mean;

    // autocorrelation
    const L = Math.min(m - 1, this.#lmax);
    const lo = this.#lo;
    const hi = Math.min(this.#hiFull, L - 1);
    if (lo > hi) return null;
    for (let l = 0; l <= L; l++) {
      let s = 0;
      for (let i = 0; i + l < m; i++) s += z[i] * z[i + l];
      r[l] = s;
    }
    if (!(r[0] > m * MIN_VARIANCE)) return null;

    // the strongest period, then the shortest one that is nearly as strong
    let g = r[lo];
    let gi = lo;
    for (let l = lo + 1; l <= hi; l++) {
      if (r[l] > g) {
        g = r[l];
        gi = l;
      }
    }
    if (!(g > 0)) return null;
    let pk = gi;
    for (let l = lo; l <= hi; l++) {
      if (r[l] >= PICK_RATIO * g && r[l] >= r[l - 1] && r[l] >= r[l + 1]) {
        pk = l;
        break;
      }
    }

    // refine with the multiples of the period
    this.#lagLimit = L;
    let lag = this.#refine(pk);
    for (let k = 2; k <= MAX_MULTIPLE; k++) {
      const c0 = Math.round(k * lag);
      if (c0 + REFINE_HALF_WIDTH > L) break;
      let c = c0 - REFINE_HALF_WIDTH;
      for (let l = c0 - REFINE_HALF_WIDTH + 1; l <= c0 + REFINE_HALF_WIDTH; l++) {
        if (r[l] > r[c]) c = l;
      }
      if (r[c] < MULTIPLE_RATIO * r[pk]) break;
      lag = this.#refine(c) / k;
    }

    // fold into the range by octaves
    let bpm = (60 * this.#hopRate) / lag;
    while (bpm < this.#minBpm) bpm *= 2;
    while (bpm > this.#maxBpm) bpm /= 2;
    const conf = r[pk] / r[0];
    this.#result.bpm = bpm;
    this.#result.confidence = conf < 0 ? 0 : conf > 1 ? 1 : conf;
    return this.#result;
  }

  /** Forgets all pushed values. */
  reset(): void {
    this.#count = 0;
    this.#index = 0;
  }

  /** Centroid of the positive part of the autocorrelation within 2 lags of c. */
  #refine(c: number): number {
    const r = this.#r;
    let sw = 0;
    let sl = 0;
    const end = Math.min(this.#lagLimit, c + REFINE_HALF_WIDTH);
    for (let l = Math.max(0, c - REFINE_HALF_WIDTH); l <= end; l++) {
      const w = r[l] > 0 ? r[l] : 0;
      sw += w;
      sl += w * l;
    }
    return sw > 0 ? sl / sw : c;
  }
}
