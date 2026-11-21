// reverb wash with a closing filter: Freeverb-style reverb, then a state variable high-pass ('up') or low-pass ('down') over dry plus wet

import { Biquad } from '../dsp/biquad';
import { clamp01, expLerp, lerp, sanitize } from '../dsp/math';
import { Reverb } from '../dsp/reverb';
import { Smoother } from '../dsp/smoother';
import { Svf } from '../dsp/svf';
import type { SceneDirection, StereoEffect } from '../types';

/** Reverb level at amount 1. */
const WET_MAX = 0.6;
/** Reverb room size at amount 0 and at amount 1. */
const ROOM_FROM = 0.5;
const ROOM_TO = 0.85;
/** High-pass on the signal sent into the reverb, in Hz. */
const SEND_HP_HZ = 120;
/** 'up': high-pass cutoff in Hz at amount 0 and at amount 1, interpolated geometrically. */
const UP_FROM = 20;
const UP_TO = 1500;
/** 'down': low-pass cutoff in Hz at amount 0 and at amount 1, interpolated geometrically. */
const DOWN_FROM = 18000;
const DOWN_TO = 500;
const FILTER_Q = 0.7071;
/** The filter is blended in over the first 2% of the amount. */
const BLEND_RANGE = 0.02;
/** Glide time of the amount, so a jump of the knob does not click. */
const AMOUNT_SMOOTH_MS = 20;

/** Reverb wash with a closing filter: a high-pass for 'up', a low-pass for 'down'. */
export class ReverbSweep implements StereoEffect {
  #up: boolean;
  #reverb: Reverb;
  #sendL: Biquad;
  #sendR: Biquad;
  #svfL: Svf;
  #svfR: Svf;
  #amount: Smoother;
  /** The amount the reverb and filter settings were last applied for. */
  #appliedAmount = 0;

  /** Throws RangeError unless sampleRate is finite and > 0 and direction is 'up' or 'down'. Starts at amount 0. */
  constructor(sampleRate: number, direction: SceneDirection) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('ReverbSweep: sampleRate must be finite and > 0');
    }
    if (direction !== 'up' && direction !== 'down') {
      throw new RangeError("ReverbSweep: direction must be 'up' or 'down'");
    }
    this.#up = direction === 'up';
    this.#reverb = new Reverb(sampleRate);
    this.#sendL = new Biquad();
    this.#sendR = new Biquad();
    this.#sendL.setHighpass(SEND_HP_HZ, FILTER_Q, sampleRate);
    this.#sendR.setHighpass(SEND_HP_HZ, FILTER_Q, sampleRate);
    this.#svfL = new Svf(sampleRate);
    this.#svfR = new Svf(sampleRate);
    this.#amount = new Smoother(sampleRate, AMOUNT_SMOOTH_MS, 0);
    this.#apply(0);
  }

  /** 0 = untouched, 1 = most reverb and the filter fully closed in. Clamped to 0..1; non-finite values are ignored. */
  setAmount(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#amount.setTarget(clamp01(v));
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const amountSmoother = this.#amount;
    const reverb = this.#reverb;
    const sendL = this.#sendL;
    const sendR = this.#sendR;
    const svfL = this.#svfL;
    const svfR = this.#svfR;
    const up = this.#up;
    let applied = this.#appliedAmount;
    for (let i = 0; i < n; i++) {
      const a = amountSmoother.next();

      // the settings only move while the amount moves; tan() is too costly to repeat for nothing
      if (a !== applied) {
        this.#apply(a);
        applied = a;
      }
      const wet = WET_MAX * a;
      // a filter always changes the signal a little, even wide open; blending it in makes amount 0 an exact pass-through
      const m = a >= BLEND_RANGE ? 1 : a / BLEND_RANGE;

      const xl = sanitize(l[i]);
      const xr = sanitize(r[i]);
      // the reverb has a huge gain at very low frequencies, so it only ever hears the high-passed signal
      reverb.process(sendL.process(xl), sendR.process(xr));

      // the filter works on dry plus reverb together, which thins or muffles the whole sound
      svfL.process(xl + wet * reverb.outL);
      svfR.process(xr + wet * reverb.outR);
      const fl = up ? svfL.hp : svfL.lp;
      const fr = up ? svfR.hp : svfR.lp;

      l[i] = xl + m * (fl - xl);
      r[i] = xr + m * (fr - xr);
    }
    this.#appliedAmount = applied;
  }

  /** Clears the reverb tail and all filter memory and ends any glide. The amount is kept. */
  reset(): void {
    this.#reverb.reset();
    this.#sendL.reset();
    this.#sendR.reset();
    this.#svfL.reset();
    this.#svfR.reset();
    this.#amount.jump(this.#amount.target);
  }

  /** Sets the room size and both output filters for the given amount. */
  #apply(amount: number): void {
    this.#reverb.setRoomSize(lerp(ROOM_FROM, ROOM_TO, amount));
    const cutoff = this.#up ? expLerp(UP_FROM, UP_TO, amount) : expLerp(DOWN_FROM, DOWN_TO, amount);
    this.#svfL.set(cutoff, FILTER_Q);
    this.#svfR.set(cutoff, FILTER_Q);
    this.#appliedAmount = amount;
  }
}
