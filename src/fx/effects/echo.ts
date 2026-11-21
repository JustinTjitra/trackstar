// tempo-synced feedback delay with an optional state variable filter and an optional bit crusher in the loop

import { Crusher } from '../dsp/crusher';
import { beatsToSamples, clamp, clamp01, expLerp, lerp, sanitize } from '../dsp/math';
import { DelayLine } from '../dsp/delayLine';
import { Smoother } from '../dsp/smoother';
import { Svf } from '../dsp/svf';
import type { StereoEffect, TempoAware } from '../types';

export type EchoFilter = 'none' | 'bpf' | 'hpf' | 'lpf';

/** Feedback at amount 1; below 1 so the tail always dies out. */
const MAX_FEEDBACK = 0.85;
/** Glide time of the amount, so a jump of the knob does not click. */
const AMOUNT_SMOOTH_MS = 20;
/** Glide time of the echo spacing when tempo or beats change. */
const DELAY_SMOOTH_MS = 50;
/** Tempo range in BPM. */
const MIN_BPM = 40;
const MAX_BPM = 240;
/** Echo spacing range in beats. */
const MIN_BEATS = 0.125;
const MAX_BEATS = 1;

/** Filter ranges as the amount goes 0 to 1, interpolated geometrically. */
const BPF_FROM = 500; // centre in Hz
const BPF_TO = 3000;
const BPF_Q = 1.2;
const HPF_FROM = 200; // cutoff in Hz
const HPF_TO = 2500;
const LPF_FROM = 8000; // cutoff in Hz
const LPF_TO = 600;
const SVF_Q = 0.7071;

/** Crusher ranges as the amount goes 0 to 1, interpolated linearly. */
const CRUSH_BITS_FROM = 12; // bit depth
const CRUSH_BITS_TO = 5;
const CRUSH_HOLD_FROM = 1; // sample-and-hold length in samples
const CRUSH_HOLD_TO = 6;

/** Filter type codes, so the per-sample code compares numbers and not strings. */
const F_NONE = 0;
const F_BPF = 1;
const F_HPF = 2;
const F_LPF = 3;

/**
 * Tempo-synced stereo feedback echo with an optional filter and an optional bit crusher in the
 * feedback loop. With the crusher on, every repeat comes back grittier than the one before.
 */
export class FilterEcho implements StereoEffect, TempoAware {
  #sampleRate: number;
  #type: number;
  #lo: number;
  #hi: number;
  #q: number;
  #bpm = 120;
  #beats = 0.75;
  #lineL: DelayLine;
  #lineR: DelayLine;
  #svfL: Svf;
  #svfR: Svf;
  #crush: boolean;
  #crushL: Crusher;
  #crushR: Crusher;
  #amount: Smoother;
  #delay: Smoother;
  /** The amount the filter and crusher settings were last computed for. */
  #filterAmount = 0;

  /** Throws RangeError unless sampleRate is finite and > 0. Starts at 120 BPM, 0.75 beats, amount 0. */
  constructor(sampleRate: number, opts: { filter: EchoFilter; crush?: boolean }) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('FilterEcho: sampleRate must be finite and > 0');
    }
    this.#sampleRate = sampleRate;
    switch (opts.filter) {
      case 'bpf':
        this.#type = F_BPF;
        this.#lo = BPF_FROM;
        this.#hi = BPF_TO;
        this.#q = BPF_Q;
        break;
      case 'hpf':
        this.#type = F_HPF;
        this.#lo = HPF_FROM;
        this.#hi = HPF_TO;
        this.#q = SVF_Q;
        break;
      case 'lpf':
        this.#type = F_LPF;
        this.#lo = LPF_FROM;
        this.#hi = LPF_TO;
        this.#q = SVF_Q;
        break;
      default:
        this.#type = F_NONE;
        this.#lo = 1000;
        this.#hi = 1000;
        this.#q = SVF_Q;
    }
    const maxDelay = Math.ceil(beatsToSamples(MAX_BEATS, MIN_BPM, sampleRate)) + 2;
    this.#lineL = new DelayLine(maxDelay);
    this.#lineR = new DelayLine(maxDelay);
    this.#svfL = new Svf(sampleRate);
    this.#svfR = new Svf(sampleRate);
    // The crushers are always created; the pair is idle unless `crush` is on. They round toward
    // zero: rounding to nearest inside a feedback loop would keep a quiet echo alive for ever.
    this.#crush = opts.crush === true;
    this.#crushL = new Crusher();
    this.#crushR = new Crusher();
    this.#crushL.setTruncate(true);
    this.#crushR.setTruncate(true);
    this.#amount = new Smoother(sampleRate, AMOUNT_SMOOTH_MS, 0);
    this.#delay = new Smoother(sampleRate, DELAY_SMOOTH_MS, beatsToSamples(this.#beats, this.#bpm, sampleRate));
    if (this.#type !== F_NONE) this.#setFilter(0);
    if (this.#crush) this.#setCrush(0);
  }

  /** Tempo, clamped to 40..240 BPM. Non-finite values are ignored. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this.#bpm = clamp(bpm, MIN_BPM, MAX_BPM);
    this.#delay.setTarget(beatsToSamples(this.#beats, this.#bpm, this.#sampleRate));
  }

  /** 0 = dry only, 1 = loudest echo and longest tail. Clamped to 0..1; non-finite values are ignored. */
  setAmount(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#amount.setTarget(clamp01(v));
  }

  /** Echo spacing in beats, clamped to 0.125..1 (typical values 0.25, 0.5, 0.75, 1). Non-finite values are ignored. */
  setBeats(beats: number): void {
    if (!Number.isFinite(beats)) return;
    this.#beats = clamp(beats, MIN_BEATS, MAX_BEATS);
    this.#delay.setTarget(beatsToSamples(this.#beats, this.#bpm, this.#sampleRate));
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const amountSmoother = this.#amount;
    const delaySmoother = this.#delay;
    const lineL = this.#lineL;
    const lineR = this.#lineR;
    const svfL = this.#svfL;
    const svfR = this.#svfR;
    const crushL = this.#crushL;
    const crushR = this.#crushR;
    const type = this.#type;
    const crush = this.#crush;
    let lastA = this.#filterAmount;
    for (let i = 0; i < n; i++) {
      const a = amountSmoother.next();
      const fb = MAX_FEEDBACK * a;
      const d = delaySmoother.next();

      // the settings only move while the amount moves; tan() is too costly to repeat for nothing
      if (a !== lastA) {
        if (type !== F_NONE) this.#setFilter(a);
        if (crush) this.#setCrush(a);
        lastA = a;
      }

      const xl = sanitize(l[i]);
      let el = lineL.read(d - 1);
      if (type !== F_NONE) {
        svfL.process(el);
        el = type === F_BPF ? svfL.bp : type === F_HPF ? svfL.hp : svfL.lp;
      }
      if (crush) el = crushL.process(el);
      lineL.write(xl + fb * el);
      l[i] = xl + a * el;

      const xr = sanitize(r[i]);
      let er = lineR.read(d - 1);
      if (type !== F_NONE) {
        svfR.process(er);
        er = type === F_BPF ? svfR.bp : type === F_HPF ? svfR.hp : svfR.lp;
      }
      if (crush) er = crushR.process(er);
      lineR.write(xr + fb * er);
      r[i] = xr + a * er;
    }
    this.#filterAmount = lastA;
  }

  /** Clears the echo memory and filter memory and ends any glide. Settings are kept. */
  reset(): void {
    this.#lineL.clear();
    this.#lineR.clear();
    this.#svfL.reset();
    this.#svfR.reset();
    this.#crushL.reset();
    this.#crushR.reset();
    this.#amount.jump(this.#amount.target);
    this.#delay.jump(this.#delay.target);
  }

  /** Sets both crushers for the given amount. */
  #setCrush(amount: number): void {
    const bits = lerp(CRUSH_BITS_FROM, CRUSH_BITS_TO, amount);
    const hold = lerp(CRUSH_HOLD_FROM, CRUSH_HOLD_TO, amount);
    this.#crushL.setBits(bits);
    this.#crushR.setBits(bits);
    this.#crushL.setDownsample(hold);
    this.#crushR.setDownsample(hold);
    this.#filterAmount = amount;
  }

  /** Sets both filters for the given amount. */
  #setFilter(amount: number): void {
    const f = expLerp(this.#lo, this.#hi, amount);
    this.#svfL.set(f, this.#q);
    this.#svfR.set(f, this.#q);
    this.#filterAmount = amount;
  }
}
