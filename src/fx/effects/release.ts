// release effects: variable-rate playback of a rolling recording (brake, backspin) and a gated feedback delay (echo-out)

import { CaptureBuffer } from '../dsp/captureBuffer';
import { DelayLine } from '../dsp/delayLine';
import { beatsToSamples, clamp, sanitize } from '../dsp/math';
import type { ReleaseType, StereoEffect, TempoAware } from '../types';

/** Fade of the live input out of and back into the output (echo) and back in after any release, in milliseconds. */
const FADE_MS = 10;
/** Length of the fade to silence at the end of a brake, in milliseconds. */
const BRAKE_FADE_MS = 30;
/** Length of the fade to silence when playback would read past the end of the recording, in milliseconds. */
const RUNOUT_MS = 20;
/** Tempo range in BPM. */
const MIN_BPM = 40;
const MAX_BPM = 240;
/** Release length range in beats. */
const MIN_BEATS = 0.25;
const MAX_BEATS = 8;
/** Delay time of the echo in beats. */
const ECHO_BEATS = 0.5;
/** Feedback of the echo, below 1 so it always dies away. */
const ECHO_FEEDBACK = 0.6;
/** An echo release lasts this many times the requested beats, so the echo has time to ring out. */
const ECHO_TAIL_FACTOR = 2;
/** The part of a backspin spent reversing the playback, as a fraction of its length. */
const SPIN_RAMP = 0.125;
/*
 * Backspin curve. The playback rate goes linearly from 1 to a peak of -4 over the first
 * SPIN_RAMP of the release, then linearly back to 0 at the end. With x the position in the
 * release (0..1) and lag the distance behind the live input in units of the release length,
 * lag' = 1 - rate:
 *   x <= 1/8: rate = 1 - 40x, so lag = 20 x^2 (SPIN_ACCEL = 20, reaching 5/16 at x = 1/8)
 *   x > 1/8:  rate = -(32/7)(1 - x), so lag = x - (16/7)(1 - x)^2 + C (SPIN_RETURN = 16/7),
 *             and continuity at x = 1/8 gives C = SPIN_OFFSET = 1.9375
 * The total lag at the end is 2.9375 release lengths.
 */
const SPIN_ACCEL = 20;
const SPIN_OFFSET = 1.9375;
const SPIN_RETURN = 16 / 7;

const IDLE = 0;
const RUN = 1;
const RETURN = 2;

const BRAKE = 0;
const BACKSPIN = 1;
const ECHO = 2;

/**
 * Release effect: when triggered the live input is cut and a transition sound plays for a set
 * number of beats (a brake, a backspin or an echo tail), then the live input fades back in.
 * The input is recorded all the time, and the echo line keeps running so it is primed when an
 * echo release starts.
 */
export class ReleaseFx implements StereoEffect, TempoAware {
  #sampleRate: number;
  #bpm = 120;
  #capture: CaptureBuffer;
  #lineL: DelayLine;
  #lineR: DelayLine;
  #fade: number;
  #brakeFade: number;
  #runoutLen: number;
  #echoDelay: number;
  #phase = IDLE;
  #type = BRAKE;
  /** Sample counter within the current phase. */
  #n = 0;
  /** Length of the RUN phase in samples. */
  #duration = 1;
  /** Length of the brake end fade actually used. */
  #bf = 1;
  #finished = false;

  /**
   * Throws RangeError unless sampleRate is finite and > 0, and maxSeconds is finite and > 0
   * with at least 2 samples of recording. `maxSeconds` limits how far back a release can reach.
   */
  constructor(sampleRate: number, maxSeconds = 4) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('ReleaseFx: sampleRate must be finite and > 0');
    }
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || Math.ceil(maxSeconds * sampleRate) < 2) {
      throw new RangeError('ReleaseFx: maxSeconds must be finite and > 0 and cover at least 2 samples');
    }
    this.#sampleRate = sampleRate;
    this.#capture = new CaptureBuffer(Math.ceil(maxSeconds * sampleRate));
    const maxDelay = Math.ceil(beatsToSamples(ECHO_BEATS, MIN_BPM, sampleRate)) + 2;
    this.#lineL = new DelayLine(maxDelay);
    this.#lineR = new DelayLine(maxDelay);
    this.#fade = Math.max(1, Math.round((FADE_MS / 1000) * sampleRate));
    this.#brakeFade = Math.max(1, Math.round((BRAKE_FADE_MS / 1000) * sampleRate));
    this.#runoutLen = Math.max(1, Math.round((RUNOUT_MS / 1000) * sampleRate));
    this.#echoDelay = this.#computeEchoDelay();
  }

  /** Tempo in BPM, clamped to 40..240. Non-finite values are ignored. A running release keeps the tempo it started with. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this.#bpm = clamp(bpm, MIN_BPM, MAX_BPM);
    if (this.#phase === IDLE) this.#echoDelay = this.#computeEchoDelay();
  }

  /**
   * Starts a release lasting `beats` beats (clamped to 0.25..8; an echo rings out for twice
   * that), after which the live input fades back in. Ignored while a release is still
   * running or returning, for an unknown type and for a non-finite `beats`.
   */
  trigger(type: ReleaseType, beats = 2): void {
    if (this.#phase !== IDLE) return;
    let t: number;
    if (type === 'brake') t = BRAKE;
    else if (type === 'backspin') t = BACKSPIN;
    else if (type === 'echo') t = ECHO;
    else return;
    if (!Number.isFinite(beats)) return;
    const b = clamp(beats, MIN_BEATS, MAX_BEATS);
    this.#type = t;
    this.#duration = Math.max(1, Math.round(beatsToSamples(t === ECHO ? ECHO_TAIL_FACTOR * b : b, this.#bpm, this.#sampleRate)));
    this.#bf = Math.min(this.#brakeFade, this.#duration);
    this.#n = 0;
    this.#phase = RUN;
  }

  /** True from the trigger until the live input is fully back. */
  get active(): boolean {
    return this.#phase !== IDLE;
  }

  /** True exactly once after the sound of a release has ended (the live input is then fading back in). */
  consumeFinished(): boolean {
    const f = this.#finished;
    this.#finished = false;
    return f;
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const count = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const capture = this.#capture;
    const lineL = this.#lineL;
    const lineR = this.#lineR;
    const fade = this.#fade;
    for (let i = 0; i < count; i++) {
      const inL = sanitize(l[i]);
      const inR = sanitize(r[i]);
      capture.write(inL, inR);
      let lineGate = 1;
      let oL = inL;
      let oR = inR;
      let echoRun = false;
      let wetGain = 0;
      if (this.#phase === RUN) {
        const n = this.#n;
        const d = this.#duration;
        if (this.#type === BRAKE) {
          // the playback rate falls linearly from 1 to 0
          const lag = (n * n) / (2 * d);
          const g = Math.min(1, (d - n) / this.#bf) * this.#runout(lag);
          if (g > 0) {
            oL = g * capture.readL(lag);
            oR = g * capture.readR(lag);
          } else {
            oL = 0;
            oR = 0;
          }
        } else if (this.#type === BACKSPIN) {
          const x = n / d;
          const lag = d * (x <= SPIN_RAMP ? SPIN_ACCEL * x * x : SPIN_OFFSET + x - SPIN_RETURN * (1 - x) * (1 - x));
          const g = (1 - x) * this.#runout(lag);
          if (g > 0) {
            oL = g * capture.readL(lag);
            oR = g * capture.readR(lag);
          } else {
            oL = 0;
            oR = 0;
          }
        } else {
          const xf = Math.min(1, (n + 1) / fade);
          // the live sound fades out of the output and out of the echo input
          lineGate = 1 - xf;
          // the echo fades in, and out again over the last fade
          wetGain = xf * Math.min(1, (d - 1 - n) / fade);
          echoRun = true;
        }
      } else if (this.#phase === RETURN) {
        const ramp = (this.#n + 1) / fade;
        oL = inL * ramp;
        oR = inR * ramp;
        if (this.#type === ECHO) lineGate = ramp;
      }
      // the echo line runs on every sample in every phase
      const wetL = ECHO_FEEDBACK * lineL.read(this.#echoDelay - 1);
      const wetR = ECHO_FEEDBACK * lineR.read(this.#echoDelay - 1);
      lineL.write(inL * lineGate + wetL);
      lineR.write(inR * lineGate + wetR);
      if (echoRun) {
        oL = inL * lineGate + wetL * wetGain;
        oR = inR * lineGate + wetR * wetGain;
      }
      l[i] = oL;
      r[i] = oR;
      if (this.#phase === RUN) {
        this.#n++;
        if (this.#n === this.#duration) {
          this.#phase = RETURN;
          this.#n = 0;
          this.#finished = true;
        }
      } else if (this.#phase === RETURN) {
        this.#n++;
        if (this.#n === fade) {
          this.#phase = IDLE;
          this.#echoDelay = this.#computeEchoDelay();
        }
      }
    }
  }

  /** Forgets the recording and the echo, ends any release and returns to the live sound at once. The tempo is kept. */
  reset(): void {
    this.#capture.clear();
    this.#lineL.clear();
    this.#lineR.clear();
    this.#phase = IDLE;
    this.#n = 0;
    this.#finished = false;
    this.#echoDelay = this.#computeEchoDelay();
  }

  /** Echo delay in samples at the current tempo. */
  #computeEchoDelay(): number {
    return Math.max(1, Math.round(beatsToSamples(ECHO_BEATS, this.#bpm, this.#sampleRate)));
  }

  /** Gain 0..1 that fades the playback to silence when a read `lag` samples back would pass the end of the recording. */
  #runout(lag: number): number {
    return clamp((this.#capture.capacity - 2 - lag) / this.#runoutLen, 0, 1);
  }
}
