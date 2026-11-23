// onset detection: onset strength as the positive change of log energy per hop, in two bands (full band and below 200 Hz), a standard energy-based onset detection function

import { Biquad } from '../dsp/biquad';
import { sanitize } from '../dsp/math';

/** Corner frequency of the low band, in Hz. */
const LOW_HZ = 200;
/** Q of the low band low-pass (Butterworth). */
const LOW_Q = Math.SQRT1_2;
/** Time constant of the one-pole smoothing of the signal power, in milliseconds. */
const SMOOTH_MS = 8;
/** Power added before the logarithm, about -40 dB: quieter than this counts as silence. */
const ENERGY_FLOOR = 1e-4;
/** Weight of the full band in the onset strength. */
const FULL_WEIGHT = 0.5;
/** Weight of the low band in the onset strength. */
const LOW_WEIGHT = 0.5;

/**
 * Onset detector: turns mono audio into a slow onset strength signal, one value per hop,
 * large where a new sound starts. Each value is the positive rise of the log of the smoothed
 * power since the previous hop, averaged over the full band and the band below 200 Hz.
 */
export class OnsetDetector {
  #hop: number;
  #rate: number;
  #lowpass = new Biquad();
  #c: number;
  #sF = 0;
  #sL = 0;
  #accF = 0;
  #accL = 0;
  #count = 0;
  #prevF = Math.log(ENERGY_FLOOR);
  #prevL = Math.log(ENERGY_FLOOR);

  /** Throws RangeError unless sampleRate is finite and > 0 and hop is finite and >= 1. The hop used is Math.floor(hop). */
  constructor(sampleRate: number, hop = 512) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('OnsetDetector: sampleRate must be finite and > 0');
    }
    if (!Number.isFinite(hop) || hop < 1) {
      throw new RangeError('OnsetDetector: hop must be finite and >= 1');
    }
    this.#hop = Math.floor(hop);
    this.#rate = sampleRate / this.#hop;
    this.#lowpass.setLowpass(LOW_HZ, LOW_Q, sampleRate);
    this.#c = 1 - Math.exp(-1 / ((SMOOTH_MS / 1000) * sampleRate));
  }

  /** Number of values per second: sampleRate / hop. */
  get hopRate(): number {
    return this.#rate;
  }

  /**
   * Reads the first `frames` samples of `mono` and calls `onValue` once per completed hop, in
   * order and before returning. A partial hop carries over to the next call.
   */
  process(mono: Float32Array, frames: number, onValue: (v: number) => void): void {
    const n = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), mono.length) : 0;
    const hop = this.#hop;
    const c = this.#c;
    const lowpass = this.#lowpass;
    for (let i = 0; i < n; i++) {
      const x = sanitize(mono[i]);
      const lo = lowpass.process(x);
      this.#sF += (x * x - this.#sF) * c;
      this.#sL += (lo * lo - this.#sL) * c;
      this.#accF += this.#sF;
      this.#accL += this.#sL;
      this.#count++;
      if (this.#count === hop) {
        const logF = Math.log(this.#accF / hop + ENERGY_FLOOR);
        const logL = Math.log(this.#accL / hop + ENERGY_FLOOR);
        const v = FULL_WEIGHT * Math.max(0, logF - this.#prevF) + LOW_WEIGHT * Math.max(0, logL - this.#prevL);
        this.#prevF = logF;
        this.#prevL = logL;
        this.#accF = 0;
        this.#accL = 0;
        this.#count = 0;
        onValue(v);
      }
    }
  }

  /** Forgets all history and any partial hop, as if silence came before. */
  reset(): void {
    this.#lowpass.reset();
    this.#sF = 0;
    this.#sL = 0;
    this.#accF = 0;
    this.#accL = 0;
    this.#count = 0;
    this.#prevF = Math.log(ENERGY_FLOOR);
    this.#prevL = Math.log(ENERGY_FLOOR);
  }
}
