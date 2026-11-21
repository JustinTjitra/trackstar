// effects engine: the whole effects chain behind one set of controls (isolator, scene, roll, release, limiter), with a click-free bypass

import { Isolator } from './effects/isolator';
import { ReleaseFx } from './effects/release';
import { Roll } from './effects/roll';
import { Limiter } from './dsp/limiter';
import { clamp, sanitize } from './dsp/math';
import { SceneFx } from './scene';
import type { ReleaseType, RollDivision, SceneSlot, StereoEffect, TempoAware } from './types';

/** Length of the crossfade into and out of bypass, in milliseconds. */
const FADE_MS = 10;
/** Samples per block of the fixed processing grid. */
const CHUNK = 128;
/** Tempo range in BPM. */
const MIN_BPM = 40;
const MAX_BPM = 240;
/** Length of the release recording in seconds: a 2-beat backspin reaches back 2.94 times its own length. */
const RELEASE_SECONDS = 10;
/** The isolator setting that leaves a band unchanged. */
const UNITY = 0.5;

/** A snapshot of the engine for display. */
export interface EngineState {
  /** True when bypass is on (or fading in). */
  bypass: boolean;
  /** The scene slot. */
  slot: SceneSlot;
  /** The scene amount, -1..1. */
  amount: number;
  /** True while a roll is running. */
  rollActive: boolean;
  /** True from the trigger of a release until the live input is fully back. */
  releaseActive: boolean;
  /** The limiter gain, 1 when it is not reducing. */
  limiterGain: number;
  /** The tempo in BPM, 40..240. */
  bpm: number;
}

/**
 * The effects chain: isolator, scene, roll, release and limiter, in that order. Bypass is a 10 ms
 * crossfade to the untouched input; once it is complete nothing is processed and the memory of every
 * part is cleared and the grid restarts, so the chain starts clean when bypass is switched off. The chain runs on a fixed
 * grid of 128 samples, so the result does not depend on how the caller splits its buffers. When a
 * release ends, the scene, the roll and the isolator return to neutral at the end of that grid block.
 */
export class FxEngine implements StereoEffect, TempoAware {
  #fade: number;
  #isolator: Isolator;
  #scene: SceneFx;
  #roll: Roll;
  #release: ReleaseFx;
  #limiter: Limiter;
  #wL: Float32Array;
  #wR: Float32Array;
  #state: EngineState;
  #bpm = 120;
  #bypass = false;
  /** Progress of the bypass crossfade, an integer 0..fade: 0 is fully processed, fade fully bypassed. */
  #bypassStep = 0;
  /** Position on the grid of 128 samples, an integer 0..127. */
  #gridPos = 0;

  /** Throws RangeError unless sampleRate is finite and > 0. Starts at 120 BPM, bypass off, everything neutral. */
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('FxEngine: sampleRate must be finite and > 0');
    }
    this.#fade = Math.max(1, Math.round((FADE_MS / 1000) * sampleRate));
    this.#isolator = new Isolator(sampleRate);
    this.#scene = new SceneFx(sampleRate);
    this.#roll = new Roll(sampleRate);
    this.#release = new ReleaseFx(sampleRate, RELEASE_SECONDS);
    this.#limiter = new Limiter(sampleRate);
    this.#wL = new Float32Array(CHUNK);
    this.#wR = new Float32Array(CHUNK);
    this.#state = {
      bypass: false,
      slot: 0,
      amount: 0,
      rollActive: false,
      releaseActive: false,
      limiterGain: 1,
      bpm: this.#bpm,
    };
  }

  /** Tempo in BPM, clamped to 40..240 and passed to the scene, the roll and the release. Non-finite values are ignored. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this.#bpm = clamp(bpm, MIN_BPM, MAX_BPM);
    this.#scene.setBpm(this.#bpm);
    this.#roll.setBpm(this.#bpm);
    this.#release.setBpm(this.#bpm);
  }

  /** Switches bypass on or off with a 10 ms crossfade. Roll and release triggers are ignored while it is on. */
  setBypass(on: boolean): void {
    this.#bypass = on === true;
  }

  /** Chooses the scene slot, 0..4. Anything else is ignored. */
  setSceneSlot(slot: SceneSlot): void {
    this.#scene.setSlot(slot);
  }

  /** Scene amount from -1 to 1 (negative drives the 'down' effect). Clamped; non-finite values are ignored. */
  setSceneAmount(v: number): void {
    this.#scene.setAmount(v);
  }

  /** Isolator band gains: 0 kills a band, 0.5 leaves it unchanged, 1 is +6 dB. */
  setIsolator(low: number, mid: number, high: number): void {
    this.#isolator.setLow(low);
    this.#isolator.setMid(mid);
    this.#isolator.setHigh(high);
  }

  /** Starts a roll of the given length in beats. Ignored while bypass is on. */
  rollStart(division: RollDivision): void {
    if (this.#bypass) return;
    this.#roll.start(division);
  }

  /** Ends the roll. */
  rollStop(): void {
    this.#roll.stop();
  }

  /** Starts a release of `beats` beats (2 when omitted). Ignored while bypass is on. When it ends, the scene, roll and isolator return to neutral. */
  release(type: ReleaseType, beats?: number): void {
    if (this.#bypass) return;
    this.#release.trigger(type, beats);
  }

  /** Processes the first `frames` samples of both buffers in place. While fully bypassed the buffers are left untouched. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const count = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const fade = this.#fade;
    const wL = this.#wL;
    const wR = this.#wR;
    let off = 0;
    while (off < count) {
      if (this.#bypass && this.#bypassStep === fade) break;
      const n = Math.min(CHUNK - this.#gridPos, count - off);
      for (let i = 0; i < n; i++) {
        wL[i] = l[off + i];
        wR[i] = r[off + i];
      }
      this.#isolator.process(wL, wR, n);
      this.#scene.process(wL, wR, n);
      this.#roll.process(wL, wR, n);
      this.#release.process(wL, wR, n);
      this.#limiter.process(wL, wR, n);
      for (let i = 0; i < n; i++) {
        if (this.#bypass) {
          if (this.#bypassStep < fade) this.#bypassStep++;
        } else if (this.#bypassStep > 0) {
          this.#bypassStep--;
        }
        if (this.#bypassStep === 0) {
          l[off + i] = wL[i];
          r[off + i] = wR[i];
        } else if (this.#bypassStep < fade) {
          const g = this.#bypassStep / fade;
          const dL = sanitize(l[off + i]);
          const dR = sanitize(r[off + i]);
          l[off + i] = wL[i] + (dL - wL[i]) * g;
          r[off + i] = wR[i] + (dR - wR[i]) * g;
        }
        // fully bypassed: this sample is left untouched
      }
      this.#gridPos = (this.#gridPos + n) % CHUNK;
      off += n;
      if (this.#gridPos === 0 && this.#release.consumeFinished()) this.#cancel();
      if (this.#bypass && this.#bypassStep === fade) {
        // bypass is complete: start clean, and on a fresh grid, when it is switched off again
        this.#clearMemories();
        this.#gridPos = 0;
      }
    }
  }

  /** The current state. The same object is returned every time, refreshed on each call. */
  state(): EngineState {
    const s = this.#state;
    s.bypass = this.#bypass;
    s.slot = this.#scene.slot;
    s.amount = this.#scene.amount;
    s.rollActive = this.#roll.active;
    s.releaseActive = this.#release.active;
    s.limiterGain = this.#limiter.gain;
    s.bpm = this.#bpm;
    return s;
  }

  /** Clears the memory of every part and restarts the grid. Roll and release end. Bypass, slot, amount, isolator and tempo are kept. */
  reset(): void {
    this.#clearMemories();
    this.#gridPos = 0;
    this.#bypassStep = this.#bypass ? this.#fade : 0;
  }

  /** Clears the memory of every part; their settings are kept. */
  #clearMemories(): void {
    this.#isolator.reset();
    this.#scene.reset();
    this.#roll.reset();
    this.#release.reset();
    this.#limiter.reset();
  }

  /** Returns everything to neutral after a release: no scene effect, no roll, isolator at unity. */
  #cancel(): void {
    this.#scene.setAmount(0);
    this.#roll.stop();
    this.#isolator.setLow(UNITY);
    this.#isolator.setMid(UNITY);
    this.#isolator.setHigh(UNITY);
  }
}
