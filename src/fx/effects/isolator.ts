// three-band isolator: Linkwitz-Riley split into low, mid and high with a smoothed gain per band

import { ThreeBand } from '../dsp/crossover';
import { clamp01, dbToGain, sanitize } from '../dsp/math';
import { Smoother } from '../dsp/smoother';
import type { StereoEffect } from '../types';

/** Boost in dB when a band control is at 1. */
const MAX_BOOST_DB = 6;
/** Glide time of the band gains, so a jump of a knob does not click. */
const GAIN_SMOOTH_MS = 20;

/** The gain for a band control value: exported so the engine and tests can use the same curve. */
export function isolatorGain(v: number): number {
  const x = v !== v ? 0.5 : clamp01(v);
  if (x <= 0.5) {
    const t = x / 0.5;
    return t * t;
  }
  return 1 + ((x - 0.5) / 0.5) * (dbToGain(MAX_BOOST_DB) - 1);
}

/** Three-band isolator: each band can be killed, left alone or boosted. */
export class Isolator implements StereoEffect {
  #splitL: ThreeBand;
  #splitR: ThreeBand;
  #low: Smoother;
  #mid: Smoother;
  #high: Smoother;

  /** Throws RangeError unless sampleRate is finite and > 0. All three bands start at 0.5 (unity). */
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('Isolator: sampleRate must be finite and > 0');
    }
    this.#splitL = new ThreeBand(sampleRate);
    this.#splitR = new ThreeBand(sampleRate);
    this.#low = new Smoother(sampleRate, GAIN_SMOOTH_MS, 1);
    this.#mid = new Smoother(sampleRate, GAIN_SMOOTH_MS, 1);
    this.#high = new Smoother(sampleRate, GAIN_SMOOTH_MS, 1);
  }

  /** Low band control: 0 = killed, 0.5 = unchanged, 1 = +6 dB. Clamped to 0..1; non-finite values are ignored. */
  setLow(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#low.setTarget(isolatorGain(v));
  }

  /** Mid band control, same scale. */
  setMid(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#mid.setTarget(isolatorGain(v));
  }

  /** High band control, same scale. */
  setHigh(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#high.setTarget(isolatorGain(v));
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const splitL = this.#splitL;
    const splitR = this.#splitR;
    const lowSmoother = this.#low;
    const midSmoother = this.#mid;
    const highSmoother = this.#high;
    for (let i = 0; i < n; i++) {
      const gl = lowSmoother.next();
      const gm = midSmoother.next();
      const gh = highSmoother.next();

      // the crossover always runs, so moving a control never switches between differently phased signals
      splitL.process(sanitize(l[i]));
      l[i] = gl * splitL.low + gm * splitL.mid + gh * splitL.high;

      splitR.process(sanitize(r[i]));
      r[i] = gl * splitR.low + gm * splitR.mid + gh * splitR.high;
    }
  }

  /** Clears the filter memory and ends any glide. The band settings are kept. */
  reset(): void {
    this.#splitL.reset();
    this.#splitR.reset();
    this.#low.jump(this.#low.target);
    this.#mid.jump(this.#mid.target);
    this.#high.jump(this.#high.target);
  }
}
