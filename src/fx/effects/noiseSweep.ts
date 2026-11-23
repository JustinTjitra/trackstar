// noise riser: seeded white noise through a swept state variable band-pass, added on top of the untouched input

import { clamp01, expLerp, sanitize } from '../dsp/math';
import { NoiseSource } from '../dsp/noise';
import { Smoother } from '../dsp/smoother';
import { Svf } from '../dsp/svf';
import type { StereoEffect } from '../types';

/** Noise gain at amount 1. */
const MAX_LEVEL = 0.5;
/** Band-pass centre in Hz at amount 0 and at amount 1, interpolated geometrically. */
const FREQ_FROM = 300;
const FREQ_TO = 9000;
const BAND_Q = 0.8;
/** Glide time of the amount, so a jump of the knob does not click. */
const AMOUNT_SMOOTH_MS = 20;
/** Added to the seed for the right channel, so the two channels carry different noise. */
const RIGHT_SEED_OFFSET = 0x9e3779b9;

/** Noise riser: band-passed white noise added on top of the untouched input. */
export class NoiseSweep implements StereoEffect {
  #seedL: number;
  #seedR: number;
  #noiseL: NoiseSource;
  #noiseR: NoiseSource;
  #svfL: Svf;
  #svfR: Svf;
  #amount: Smoother;
  /** The amount the filters were last set for; -1 forces a new setting on the next sample. */
  #filterAmount = 0;

  /** Throws RangeError unless sampleRate is finite and > 0. `seed` selects the noise sequence. Starts at amount 0. */
  constructor(sampleRate: number, seed = 7) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('NoiseSweep: sampleRate must be finite and > 0');
    }
    this.#seedL = seed >>> 0;
    this.#seedR = (seed + RIGHT_SEED_OFFSET) >>> 0;
    this.#noiseL = new NoiseSource(this.#seedL);
    this.#noiseR = new NoiseSource(this.#seedR);
    this.#svfL = new Svf(sampleRate);
    this.#svfR = new Svf(sampleRate);
    this.#amount = new Smoother(sampleRate, AMOUNT_SMOOTH_MS, 0);
    this.#setFilter(0);
  }

  /** 0 = no noise, 1 = loudest and brightest. Clamped to 0..1; non-finite values are ignored. */
  setAmount(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#amount.setTarget(clamp01(v));
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const amountSmoother = this.#amount;
    const noiseL = this.#noiseL;
    const noiseR = this.#noiseR;
    const svfL = this.#svfL;
    const svfR = this.#svfR;
    let lastA = this.#filterAmount;
    for (let i = 0; i < n; i++) {
      const a = amountSmoother.next();

      // the filters only move while the amount moves; tan() is too costly to repeat for nothing
      if (a !== lastA) {
        this.#setFilter(a);
        lastA = a;
      }
      const level = MAX_LEVEL * a * a;

      svfL.process(noiseL.white());
      l[i] = sanitize(l[i]) + level * svfL.bp;

      svfR.process(noiseR.white());
      r[i] = sanitize(r[i]) + level * svfR.bp;
    }
    this.#filterAmount = lastA;
  }

  /** Restarts the noise sequence, clears the filter memory and ends any glide. The amount is kept. */
  reset(): void {
    this.#noiseL.reseed(this.#seedL);
    this.#noiseR.reseed(this.#seedR);
    this.#svfL.reset();
    this.#svfR.reset();
    this.#amount.jump(this.#amount.target);
    this.#filterAmount = -1;
  }

  /** Sets both filters for the given amount. */
  #setFilter(amount: number): void {
    const f = expLerp(FREQ_FROM, FREQ_TO, amount);
    this.#svfL.set(f, BAND_Q);
    this.#svfR.set(f, BAND_Q);
    this.#filterAmount = amount;
  }
}
