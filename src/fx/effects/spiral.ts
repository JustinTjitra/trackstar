// tempo-synced feedback delay with a two-tap crossfading delay-line pitch shifter in the loop

import { beatsToSamples, clamp, clamp01, sanitize } from '../dsp/math';
import { DelayLine } from '../dsp/delayLine';
import { Smoother } from '../dsp/smoother';
import type { SceneDirection, StereoEffect, TempoAware } from '../types';

/** Echo spacing in beats. */
const BEATS = 0.5;
/** Feedback at amount 1; below 1 so the tail always dies out. */
const MAX_FEEDBACK = 0.8;
/** Pitch change per pass through the loop at amount 1. */
const SEMITONES_PER_REPEAT = 4;
/** Length of the pitch shifter's crossfade window. */
const WINDOW_MS = 60;
/** Glide time of the amount, so a jump of the knob does not click. */
const AMOUNT_SMOOTH_MS = 20;
/** Glide time of the echo spacing when the tempo changes. */
const DELAY_SMOOTH_MS = 50;
/** Tempo range in BPM. */
const MIN_BPM = 40;
const MAX_BPM = 240;

/**
 * Tempo-synced stereo feedback echo whose repeats rise ('up') or fall ('down') in pitch. A small
 * pitch shifter sits inside the feedback loop, so each repeat comes back a few semitones away
 * from the one before.
 *
 * The shifter reads each delay line at two taps whose delays slide steadily, which plays the
 * audio back faster or slower than it was written. The taps are half a window apart and are
 * crossfaded with triangular gains, so each one is silent at the moment its delay jumps back.
 */
export class Spiral implements StereoEffect, TempoAware {
  #sampleRate: number;
  #bpm = 120;
  /** The crossfade window in samples. */
  #window: number;
  #lineL: DelayLine;
  #lineR: DelayLine;
  #amount: Smoother;
  #delay: Smoother;
  /** +1 for 'up', -1 for 'down'. */
  #sign: number;
  /** Position of tap A in the window, 0 (inclusive) to 1 (exclusive); tap B is half a window away. */
  #phase = 0.5;
  /** Change of the phase per sample. */
  #inc = 0;
  /** The amount `#inc` was last computed for; NaN forces a recompute. */
  #incAmount = 0;

  /** Throws RangeError unless sampleRate is finite and > 0 and direction is 'up' or 'down'. Starts at 120 BPM, amount 0. */
  constructor(sampleRate: number, direction: SceneDirection) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('Spiral: sampleRate must be finite and > 0');
    }
    if (direction !== 'up' && direction !== 'down') {
      throw new RangeError("Spiral: direction must be 'up' or 'down'");
    }
    this.#sampleRate = sampleRate;
    this.#sign = direction === 'up' ? 1 : -1;
    this.#window = WINDOW_MS * 0.001 * sampleRate;
    const maxDelay = Math.ceil(beatsToSamples(BEATS, MIN_BPM, sampleRate) + this.#window / 2) + 2;
    this.#lineL = new DelayLine(maxDelay);
    this.#lineR = new DelayLine(maxDelay);
    this.#amount = new Smoother(sampleRate, AMOUNT_SMOOTH_MS, 0);
    this.#delay = new Smoother(sampleRate, DELAY_SMOOTH_MS, beatsToSamples(BEATS, this.#bpm, sampleRate));
  }

  /** Tempo, clamped to 40..240 BPM. Non-finite values are ignored. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this.#bpm = clamp(bpm, MIN_BPM, MAX_BPM);
    this.#delay.setTarget(beatsToSamples(BEATS, this.#bpm, this.#sampleRate));
  }

  /** 0 = dry only, 1 = loudest, longest tail and 4 semitones per repeat. Clamped to 0..1; non-finite values are ignored. */
  setAmount(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#amount.setTarget(clamp01(v));
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const amountSmoother = this.#amount;
    const delaySmoother = this.#delay;
    const lineL = this.#lineL;
    const lineR = this.#lineR;
    const sign = this.#sign;
    const w = this.#window;
    const halfW = w / 2;
    let phase = this.#phase;
    let inc = this.#inc;
    let lastA = this.#incAmount;
    for (let i = 0; i < n; i++) {
      const a = amountSmoother.next();
      const d = delaySmoother.next();

      // the phase speed only changes while the amount moves; pow() is too costly to repeat for nothing
      if (a !== lastA) {
        const ratio = 2 ** ((sign * SEMITONES_PER_REPEAT * a) / 12);
        inc = (1 - ratio) / w; // pitch up: the delay shrinks, so the phase moves down
        lastA = a;
      }
      const fb = MAX_FEEDBACK * a;

      phase += inc;
      if (phase < 0) phase += 1;
      else if (phase >= 1) phase -= 1;
      const phaseB = phase < 0.5 ? phase + 0.5 : phase - 0.5;

      // triangular gains: tap A is silent where it jumps (phase 0 or 1), tap B where phaseB jumps
      const gainA = 1 - Math.abs(2 * phase - 1);
      const gainB = 1 - gainA;

      const base = d - halfW - 1; // "- 1" because the read comes before the write
      const delayA = base + phase * w;
      const delayB = base + phaseB * w;

      const xl = sanitize(l[i]);
      const sl = gainA * lineL.read(delayA) + gainB * lineL.read(delayB);
      lineL.write(xl + fb * sl);
      l[i] = xl + a * sl;

      const xr = sanitize(r[i]);
      const sr = gainA * lineR.read(delayA) + gainB * lineR.read(delayB);
      lineR.write(xr + fb * sr);
      r[i] = xr + a * sr;
    }
    this.#phase = phase;
    this.#inc = inc;
    this.#incAmount = lastA;
  }

  /** Clears the echo memory, restarts the pitch shifter and ends any glide. Settings are kept. */
  reset(): void {
    this.#lineL.clear();
    this.#lineR.clear();
    this.#phase = 0.5;
    this.#incAmount = NaN; // `NaN !== a` is always true, so the speed is recomputed on the next sample
    this.#amount.jump(this.#amount.target);
    this.#delay.jump(this.#delay.target);
  }
}
