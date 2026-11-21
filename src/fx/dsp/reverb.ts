// stereo reverb: Freeverb structure by Jezar at Dreampoint (public domain), Schroeder/Moorer parallel comb and series all-pass design

import { clamp01, sanitize } from './math';

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
/** Samples added to every right channel delay (before rate scaling) to decorrelate the channels. */
const STEREO_SPREAD = 23;
const TUNING_RATE = 44100;
/** Fixed input gain (keeps eight summed combs well below clipping) and output gain (restores the level). */
const INPUT_GAIN = 0.015;
const OUTPUT_GAIN = 3;
const ALLPASS_FEEDBACK = 0.5;

function scaledLength(tuning: number, sampleRate: number): number {
  return Math.max(1, Math.round((tuning * sampleRate) / TUNING_RATE));
}

/** Feedback comb filter with a one-pole low-pass in the feedback path. */
class Comb {
  #buffer: Float32Array;
  #index = 0;
  #store = 0;

  constructor(length: number) {
    this.#buffer = new Float32Array(length);
  }

  process(x: number, feedback: number, damp1: number, damp2: number): number {
    const buffer = this.#buffer;
    const y = buffer[this.#index];
    this.#store = y * damp2 + this.#store * damp1;
    buffer[this.#index] = x + this.#store * feedback;
    this.#index++;
    if (this.#index >= buffer.length) this.#index = 0;
    return y;
  }

  clear(): void {
    this.#buffer.fill(0);
    this.#store = 0;
  }
}

/** All-pass filter built on a delay with fixed feedback. */
class AllPass {
  #buffer: Float32Array;
  #index = 0;

  constructor(length: number) {
    this.#buffer = new Float32Array(length);
  }

  process(x: number): number {
    const buffer = this.#buffer;
    const bufout = buffer[this.#index];
    buffer[this.#index] = x + bufout * ALLPASS_FEEDBACK;
    this.#index++;
    if (this.#index >= buffer.length) this.#index = 0;
    return bufout - x;
  }

  clear(): void {
    this.#buffer.fill(0);
  }
}

/** Stereo reverb: eight parallel damped comb filters into four series all-pass filters per channel. */
export class Reverb {
  /** Wet output of the most recent `process` call (no dry signal). Both start at 0. */
  outL = 0;
  outR = 0;

  #combsL: Comb[] = [];
  #combsR: Comb[] = [];
  #allL: AllPass[] = [];
  #allR: AllPass[] = [];
  #feedback = 0;
  #damp1 = 0;
  #damp2 = 1;

  /** Throws RangeError unless sampleRate is finite and > 0. Starts with room size 0.5 and damping 0.5. */
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || !(sampleRate > 0)) {
      throw new RangeError('Reverb: sampleRate must be finite and positive');
    }
    for (let i = 0; i < COMB_TUNING.length; i++) {
      this.#combsL.push(new Comb(scaledLength(COMB_TUNING[i], sampleRate)));
      this.#combsR.push(new Comb(scaledLength(COMB_TUNING[i] + STEREO_SPREAD, sampleRate)));
    }
    for (let i = 0; i < ALLPASS_TUNING.length; i++) {
      this.#allL.push(new AllPass(scaledLength(ALLPASS_TUNING[i], sampleRate)));
      this.#allR.push(new AllPass(scaledLength(ALLPASS_TUNING[i] + STEREO_SPREAD, sampleRate)));
    }
    this.setRoomSize(0.5);
    this.setDamping(0.5);
  }

  /** Room size 0..1 (longer tail when larger). Clamped; non-finite values are ignored. */
  setRoomSize(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#feedback = 0.7 + 0.28 * clamp01(v);
  }

  /** Damping 0..1 (high frequencies die faster when larger). Clamped; non-finite values are ignored. */
  setDamping(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#damp1 = 0.4 * clamp01(v);
    this.#damp2 = 1 - this.#damp1;
  }

  /** Processes one stereo sample and updates `outL` and `outR`. Non-finite input is treated as 0. */
  process(inL: number, inR: number): void {
    const input = (sanitize(inL) + sanitize(inR)) * INPUT_GAIN;
    const feedback = this.#feedback;
    const damp1 = this.#damp1;
    const damp2 = this.#damp2;
    let sumL = 0;
    let sumR = 0;
    for (let i = 0; i < this.#combsL.length; i++) {
      sumL += this.#combsL[i].process(input, feedback, damp1, damp2);
      sumR += this.#combsR[i].process(input, feedback, damp1, damp2);
    }
    for (let i = 0; i < this.#allL.length; i++) {
      sumL = this.#allL[i].process(sumL);
      sumR = this.#allR[i].process(sumR);
    }
    this.outL = sumL * OUTPUT_GAIN;
    this.outR = sumR * OUTPUT_GAIN;
  }

  /** Clears all buffers, filter memory and both outputs. Settings are kept. */
  reset(): void {
    for (let i = 0; i < this.#combsL.length; i++) {
      this.#combsL[i].clear();
      this.#combsR[i].clear();
    }
    for (let i = 0; i < this.#allL.length; i++) {
      this.#allL[i].clear();
      this.#allR[i].clear();
    }
    this.outL = 0;
    this.outR = 0;
  }
}
