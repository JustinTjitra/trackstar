// retroactive beat roll: a frozen slice of recent audio is looped, with a crossfaded seam and short fades in and out

import { CaptureBuffer } from '../dsp/captureBuffer';
import { beatsToSamples, clamp, sanitize } from '../dsp/math';
import type { RollDivision, StereoEffect, TempoAware } from '../types';

/** Length of the glide at the loop seam, in milliseconds. */
const SEAM_MS = 3;
/** Length of the crossfade between live and roll (and between two rolls), in milliseconds. */
const FADE_MS = 5;
/** Tempo range in BPM. */
const MIN_BPM = 40;
const MAX_BPM = 240;
/** Roll length range in beats. */
const MIN_DIVISION = 0.125;
const MAX_DIVISION = 1;

/**
 * Beat roll: while active it repeats the last 1, 1/2, 1/4 or 1/8 beat of the audio that was
 * playing when it was started. The live input keeps being recorded, so stopping returns to
 * the live sound.
 */
export class Roll implements StereoEffect, TempoAware {
  #sampleRate: number;
  #bpm = 120;
  #capture: CaptureBuffer;
  /** Frozen audio in time order: index 0 is the oldest sample, `#stored - 1` the last one recorded before the freeze. */
  #storeL: Float32Array;
  #storeR: Float32Array;
  #stored = 0;
  #loopLen = 0;
  #seam = 0;
  #pos = 0;
  #fade: number;
  #seamMax: number;
  /** Last signal of the previous roll, glided out when the loop changes. */
  #tailL: Float32Array;
  #tailR: Float32Array;
  #tailLeft = 0;
  /** Live/roll mix as an integer 0..fade: 0 is live only, fade is roll only. */
  #mixStep = 0;
  #active = false;
  #outL = 0;
  #outR = 0;

  /**
   * Throws RangeError unless sampleRate is finite and > 0, and maxSeconds is finite and > 0
   * with at least 2 samples of recording. `maxSeconds` limits how far back a roll can reach.
   */
  constructor(sampleRate: number, maxSeconds = 4) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('Roll: sampleRate must be finite and > 0');
    }
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || Math.ceil(maxSeconds * sampleRate) < 2) {
      throw new RangeError('Roll: maxSeconds must be finite and > 0 and cover at least 2 samples');
    }
    this.#sampleRate = sampleRate;
    this.#capture = new CaptureBuffer(Math.ceil(maxSeconds * sampleRate));
    this.#storeL = new Float32Array(this.#capture.capacity);
    this.#storeR = new Float32Array(this.#capture.capacity);
    this.#fade = Math.max(1, Math.round((FADE_MS / 1000) * sampleRate));
    this.#seamMax = Math.max(1, Math.round((SEAM_MS / 1000) * sampleRate));
    this.#tailL = new Float32Array(this.#fade);
    this.#tailR = new Float32Array(this.#fade);
  }

  /** Tempo in BPM, clamped to 40..240. Non-finite values are ignored. A running loop keeps its length. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this.#bpm = clamp(bpm, MIN_BPM, MAX_BPM);
  }

  /**
   * Starts rolling the last `division` beats before the first start. While already rolling,
   * only the loop length changes: the frozen audio stays the same. Does nothing when nothing
   * has been recorded yet or when `division` is not finite. Out-of-range values are clamped.
   */
  start(division: RollDivision): void {
    if (!Number.isFinite(division)) return;
    const d = clamp(division, MIN_DIVISION, MAX_DIVISION);
    const requested = Math.max(1, Math.round(beatsToSamples(d, this.#bpm, this.#sampleRate)));
    if (this.#active) {
      this.#captureTail();
      this.#loopLen = Math.min(requested, this.#stored);
      this.#seam = Math.min(this.#seamMax, Math.floor(this.#loopLen / 2));
      this.#pos = 0;
      return;
    }
    const n = Math.min(
      this.#capture.filled,
      Math.round(beatsToSamples(MAX_DIVISION, this.#bpm, this.#sampleRate)) + this.#seamMax,
      this.#storeL.length,
    );
    if (n < 1) return;
    if (this.#mixStep > 0) this.#captureTail();
    else this.#tailLeft = 0;
    const capture = this.#capture;
    const storeL = this.#storeL;
    const storeR = this.#storeR;
    for (let i = 0; i < n; i++) {
      storeL[i] = capture.readL(n - 1 - i);
      storeR[i] = capture.readR(n - 1 - i);
    }
    this.#stored = n;
    this.#loopLen = Math.min(requested, n);
    this.#seam = Math.min(this.#seamMax, Math.floor(this.#loopLen / 2));
    this.#pos = 0;
    this.#active = true;
  }

  /** Ends the roll; the output fades back to the live input over a few milliseconds. Does nothing when not rolling. */
  stop(): void {
    this.#active = false;
  }

  /** True while a roll is running (false as soon as `stop` is called, even while the fade-out is still going). */
  get active(): boolean {
    return this.#active;
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const fade = this.#fade;
    for (let i = 0; i < n; i++) {
      const inL = sanitize(l[i]);
      const inR = sanitize(r[i]);
      this.#capture.write(inL, inR);
      if (this.#active) {
        if (this.#mixStep < fade) this.#mixStep++;
      } else if (this.#mixStep > 0) {
        this.#mixStep--;
      }
      if (this.#mixStep === 0) {
        l[i] = inL;
        r[i] = inR;
      } else {
        this.#nextRoll();
        if (this.#mixStep === fade) {
          l[i] = this.#outL;
          r[i] = this.#outR;
        } else {
          const m = this.#mixStep / fade;
          l[i] = inL + (this.#outL - inL) * m;
          r[i] = inR + (this.#outR - inR) * m;
        }
      }
    }
  }

  /** Forgets the recording and the frozen audio and returns to the live sound at once. The tempo is kept. */
  reset(): void {
    this.#capture.clear();
    this.#stored = 0;
    this.#loopLen = 0;
    this.#seam = 0;
    this.#pos = 0;
    this.#tailLeft = 0;
    this.#mixStep = 0;
    this.#active = false;
  }

  /** Produces the next roll sample into `#outL`/`#outR` and advances the loop. */
  #nextRoll(): void {
    const len = this.#loopLen;
    const xf = this.#seam;
    const i = this.#pos;
    const base = this.#stored - len;
    let sL = this.#storeL[base + i];
    let sR = this.#storeR[base + i];
    if (i >= len - xf) {
      // loop seam: glide into the audio that came just before the loop start
      const k = i - (len - xf);
      const t = (k + 1) / xf;
      const pi = base - xf + k;
      const pL = pi >= 0 ? this.#storeL[pi] : 0;
      const pR = pi >= 0 ? this.#storeR[pi] : 0;
      sL = sL + (pL - sL) * t;
      sR = sR + (pR - sR) * t;
    }
    this.#pos = i + 1 === len ? 0 : i + 1;
    if (this.#tailLeft > 0) {
      // glide from the previous roll signal into this one
      const j = this.#fade - this.#tailLeft;
      const u = (j + 1) / this.#fade;
      sL = this.#tailL[j] + (sL - this.#tailL[j]) * u;
      sR = this.#tailR[j] + (sR - this.#tailR[j]) * u;
      this.#tailLeft--;
    }
    this.#outL = sL;
    this.#outR = sR;
  }

  /** Records the next `fade` samples of the current roll so a new loop can glide from them. Run before the store, loop or position change. */
  #captureTail(): void {
    // safe in place: while it runs, nextRoll only reads tail indices >= j before index j is written
    for (let j = 0; j < this.#fade; j++) {
      this.#nextRoll();
      this.#tailL[j] = this.#outL;
      this.#tailR[j] = this.#outR;
    }
    this.#tailLeft = this.#fade;
  }
}
