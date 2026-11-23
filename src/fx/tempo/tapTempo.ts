// tap tempo: the tempo in BPM from the median interval between recent taps

const DEFAULT_MAX_GAP_MS = 2000;
const DEFAULT_WINDOW = 8;
const MIN_WINDOW = 2;
const MAX_WINDOW = 32;
const MIN_BPM = 40;
const MAX_BPM = 240;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Works out a tempo from the moments the user taps. Keeps the most recent taps and reports 60000 divided
 * by the median gap between them. A long pause, or a time that does not move forward, starts over.
 * Runs on the page, not on the audio thread. Takes times in milliseconds from the caller.
 */
export class TapTempo {
  #maxGapMs: number;
  #window: number;
  /** Tap times in milliseconds, oldest first, never longer than the window. */
  #taps: number[] = [];

  /**
   * @param opts.maxGapMs longest pause that still counts as the same run of taps; any other value gives 2000.
   * @param opts.window how many recent taps to keep, floored and clamped to 2..32; any other value gives 8.
   */
  constructor(opts: { maxGapMs?: number; window?: number } = {}) {
    const gap = opts.maxGapMs;
    this.#maxGapMs = isFiniteNumber(gap) && gap > 0 ? gap : DEFAULT_MAX_GAP_MS;
    const w = opts.window;
    this.#window = isFiniteNumber(w) ? Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.floor(w))) : DEFAULT_WINDOW;
  }

  /**
   * Records a tap at tMs and returns the tempo in BPM, or null when there is none yet, when the tap was
   * not a finite number (nothing changes), or when the tempo is outside 40..240 (the taps are kept).
   * A gap longer than maxGapMs, or a time not after the previous tap, forgets the old taps.
   */
  tap(tMs: number): number | null {
    if (!isFiniteNumber(tMs)) return null;

    const last = this.#taps[this.#taps.length - 1];
    if (last !== undefined && (tMs - last > this.#maxGapMs || tMs <= last)) {
      this.#taps = [tMs];
      return null;
    }

    this.#taps.push(tMs);
    if (this.#taps.length > this.#window) this.#taps.shift();
    if (this.#taps.length < 2) return null;

    const intervals: number[] = [];
    for (let i = 1; i < this.#taps.length; i++) {
      intervals.push(this.#taps[i] - this.#taps[i - 1]);
    }
    intervals.sort((a, b) => a - b);
    const n = intervals.length;
    const mid = Math.floor(n / 2);
    const median = n % 2 === 1 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2;

    const bpm = 60000 / median;
    if (bpm < MIN_BPM || bpm > MAX_BPM) return null;
    return bpm;
  }

  /** Forgets all taps. The next tap starts a new run. */
  reset(): void {
    this.#taps = [];
  }
}
