// tracks musical position in beats from a tempo and a running sample count
//
// The position is kept as "beats at the last tempo change" plus an exact count of samples since
// then. Adding a fraction of a beat every block instead would let rounding errors pile up: after
// an hour a position that should sit exactly on a beat lands about 5e-7 beats short of it.

import { clamp } from './math';

const MIN_BPM = 40;
const MAX_BPM = 240;
const DEFAULT_BPM = 120;
const BOUNDARY_EPS = 1e-9;

/** Tracks musical position in beats from a tempo and a running sample count. */
export class BeatClock {
  #sampleRate: number;
  #tempo: number = DEFAULT_BPM;
  /** Position in beats at the last tempo change, `setBeats` or `reset`. */
  #base = 0;
  /** Samples advanced since then. Whole numbers stay exact far beyond any session length. */
  #samples = 0;

  /** Throws RangeError unless sampleRate is finite and > 0. Starts at 120 BPM, position 0. */
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError(`BeatClock sample rate must be finite and > 0, got ${sampleRate}`);
    }
    this.#sampleRate = sampleRate;
  }

  /** Sets the tempo, clamped to 40..240 BPM. Non-finite values are ignored. The beat position is kept. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    const next = clamp(bpm, MIN_BPM, MAX_BPM);
    if (next === this.#tempo) return;
    // Fold the samples counted at the old tempo into the base before the speed changes.
    this.#base = this.beats;
    this.#samples = 0;
    this.#tempo = next;
  }

  /** Current tempo in BPM. */
  get bpm(): number {
    return this.#tempo;
  }

  /** Samples in one beat at the current tempo: sampleRate * 60 / bpm. */
  get samplesPerBeat(): number {
    return (this.#sampleRate * 60) / this.#tempo;
  }

  /** Moves the clock forward by `frames` samples. Non-finite or negative values are ignored. */
  advance(frames: number): void {
    if (!Number.isFinite(frames) || frames < 0) return;
    this.#samples += frames;
  }

  /** Position in beats since the last reset (fractional). */
  get beats(): number {
    return this.#base + this.#samples / this.samplesPerBeat;
  }

  /** Sets the position in beats. Non-finite values are ignored; negative values become 0. */
  setBeats(b: number): void {
    if (!Number.isFinite(b)) return;
    this.#base = b < 0 ? 0 : b;
    this.#samples = 0;
  }

  /** Position inside the current division, 0 (on the boundary) up to but not including 1. */
  phase(division: number): number {
    const d = Number.isFinite(division) && division > 0 ? division : 1;
    const x = this.beats / d;
    let p = x - Math.floor(x);
    if (p >= 1 - BOUNDARY_EPS) p = 0;
    return p;
  }

  /** Samples until the next division boundary; exactly on a boundary this is one full division. */
  samplesToNext(division: number): number {
    const d = Number.isFinite(division) && division > 0 ? division : 1;
    return (1 - this.phase(d)) * d * this.samplesPerBeat;
  }

  /** Sets the position back to 0. The tempo is kept. */
  reset(): void {
    this.#base = 0;
    this.#samples = 0;
  }
}
