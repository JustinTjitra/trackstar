// scene manager: holds the ten Scene effects, runs only the ones that sound, and crossfades against the dry signal on every switch

import { FilterEcho } from './effects/echo';
import { NoiseSweep } from './effects/noiseSweep';
import { ReverbSweep } from './effects/reverbSweep';
import { Spiral } from './effects/spiral';
import { clamp, sanitize } from './dsp/math';
import type { SceneSlot, StereoEffect, TempoAware } from './types';

/** Length of every fade in and fade out, in milliseconds. */
const FADE_MS = 10;
/** Samples processed per block of the sounding effects. */
const CHUNK = 128;
/** Number of Scene slots. */
const SLOTS = 5;

/** Names of the effects of each slot: 'up' for a positive amount, 'down' for a negative one. */
export const SCENE_TABLE: Record<SceneSlot, { up: string; down: string }> = {
  0: { up: 'BPF ECHO', down: 'HPF ECHO' },
  1: { up: 'ECHO', down: 'LPF ECHO' },
  2: { up: 'NOISE', down: 'CRUSH ECHO' },
  3: { up: 'SPIRAL UP', down: 'SPIRAL DOWN' },
  4: { up: 'REVERB UP', down: 'REVERB DOWN' },
};

/** What the scene needs from each of its effects. */
type SceneEffect = StereoEffect & { setAmount(v: number): void };

/**
 * Scene FX: five slots with two effects each, one of which sounds at a time, chosen by the sign
 * of the amount. Only the effects that sound are processed. Every start, stop and switch is a
 * 10 ms fade: a starting effect is fed the dry signal ramped in (so its memory sees no jump) and a stopping one
 * fades out of the output. An effect that is not sounding is kept silent and clean,
 * so it starts from an empty memory the next time.
 */
export class SceneFx implements StereoEffect, TempoAware {
  #fade: number;
  /** The ten effects, at index slot * 2 + (down ? 1 : 0). */
  #effects: SceneEffect[];
  /** The tempo-aware effects among them. */
  #tempo: TempoAware[];
  #slot: SceneSlot = 0;
  #amount = 0;
  /** Index of the current effect (fading in or fully in), or -1. */
  #cur = -1;
  /** Index of the outgoing effect, or -1. */
  #out = -1;
  /** Send of the current effect, 0..fade: the dry signal fed into it has the gain send / fade. */
  #curSend = 0;
  /** Gain of the current effect's contribution to the output, 0..fade, as gain / fade. */
  #curGain = 0;
  /** Send of the outgoing effect, 0..fade. */
  #outSend = 0;
  /** Gain of the outgoing effect's contribution, 0..fade; it is retired at 0. */
  #outGain = 0;
  #dryL: Float32Array;
  #dryR: Float32Array;
  #aL: Float32Array;
  #aR: Float32Array;
  #bL: Float32Array;
  #bR: Float32Array;

  /** Throws RangeError unless sampleRate is finite and > 0. Starts at slot 0, amount 0 (off). */
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('SceneFx: sampleRate must be finite and > 0');
    }
    this.#fade = Math.max(1, Math.round((FADE_MS / 1000) * sampleRate));
    const echoes = [
      new FilterEcho(sampleRate, { filter: 'bpf' }),
      new FilterEcho(sampleRate, { filter: 'hpf' }),
      new FilterEcho(sampleRate, { filter: 'none' }),
      new FilterEcho(sampleRate, { filter: 'lpf' }),
    ];
    const crush = new FilterEcho(sampleRate, { filter: 'none', crush: true });
    const spiralUp = new Spiral(sampleRate, 'up');
    const spiralDown = new Spiral(sampleRate, 'down');
    this.#effects = [
      echoes[0],
      echoes[1],
      echoes[2],
      echoes[3],
      new NoiseSweep(sampleRate),
      crush,
      spiralUp,
      spiralDown,
      new ReverbSweep(sampleRate, 'up'),
      new ReverbSweep(sampleRate, 'down'),
    ];
    this.#tempo = [echoes[0], echoes[1], echoes[2], echoes[3], crush, spiralUp, spiralDown];
    this.#dryL = new Float32Array(CHUNK);
    this.#dryR = new Float32Array(CHUNK);
    this.#aL = new Float32Array(CHUNK);
    this.#aR = new Float32Array(CHUNK);
    this.#bL = new Float32Array(CHUNK);
    this.#bR = new Float32Array(CHUNK);
  }

  /** Tempo in BPM for all effects that follow it; each clamps the value and ignores non-finite ones. */
  setBpm(bpm: number): void {
    for (let i = 0; i < this.#tempo.length; i++) this.#tempo[i].setBpm(bpm);
  }

  /** Chooses the slot, 0..4. Anything else is ignored. The sound changes with a crossfade. */
  setSlot(slot: SceneSlot): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return;
    this.#slot = slot;
    this.#select();
  }

  /**
   * Amount from -1 to 1: positive drives the 'up' effect of the slot, negative its 'down' effect, 0 is
   * off. Clamped; non-finite values are ignored.
   */
  setAmount(v: number): void {
    if (!Number.isFinite(v)) return;
    this.#amount = clamp(v, -1, 1);
    this.#select();
  }

  /** The chosen slot. */
  get slot(): SceneSlot {
    return this.#slot;
  }

  /** The amount last set, clamped to -1..1. */
  get amount(): number {
    return this.#amount;
  }

  /** Processes the first `frames` samples of both buffers in place. */
  process(l: Float32Array, r: Float32Array, frames: number): void {
    const count = Number.isFinite(frames) && frames > 0 ? Math.min(Math.floor(frames), l.length, r.length) : 0;
    const fade = this.#fade;
    const dryL = this.#dryL;
    const dryR = this.#dryR;
    const aL = this.#aL;
    const aR = this.#aR;
    const bL = this.#bL;
    const bR = this.#bR;
    let off = 0;
    while (off < count) {
      if (this.#cur < 0 && this.#out < 0) {
        // nothing is sounding: the rest passes through
        for (let i = off; i < count; i++) {
          l[i] = sanitize(l[i]);
          r[i] = sanitize(r[i]);
        }
        break;
      }
      const n = Math.min(CHUNK, count - off);
      for (let i = 0; i < n; i++) {
        dryL[i] = sanitize(l[off + i]);
        dryR[i] = sanitize(r[off + i]);
      }
      const c = this.#cur;
      const o = this.#out;
      const cs0 = this.#curSend;
      const os0 = this.#outSend;
      if (c >= 0) {
        // the effect is fed the dry signal ramped in, so its memory never sees a jump
        for (let i = 0; i < n; i++) {
          const g = Math.min(fade, cs0 + i + 1) / fade;
          aL[i] = dryL[i] * g;
          aR[i] = dryR[i] * g;
        }
        this.#effects[c].process(aL, aR, n);
      }
      if (o >= 0) {
        for (let i = 0; i < n; i++) {
          const g = Math.min(fade, os0 + i + 1) / fade;
          bL[i] = dryL[i] * g;
          bR[i] = dryR[i] * g;
        }
        this.#effects[o].process(bL, bR, n);
      }
      for (let i = 0; i < n; i++) {
        let oL = dryL[i];
        let oR = dryR[i];
        let gO = 0;
        let sO = 0;
        if (this.#out >= 0) {
          if (this.#outSend < fade) this.#outSend++;
          this.#outGain--;
          if (this.#outGain <= 0) {
            this.#retire(this.#out);
            this.#out = -1;
            this.#outSend = 0;
            this.#outGain = 0;
          } else {
            gO = this.#outGain / fade;
            sO = this.#outSend / fade;
          }
        }
        if (c >= 0) {
          if (this.#curSend < fade) this.#curSend++;
          if (this.#curGain < fade) this.#curGain++;
          if (this.#curSend === fade && this.#curGain === fade && gO === 0) {
            // fully in: the effect's own output
            oL = aL[i];
            oR = aR[i];
          } else {
            const sC = this.#curSend / fade;
            const gC = this.#curGain / fade;
            oL += gC * (aL[i] - dryL[i] * sC);
            oR += gC * (aR[i] - dryR[i] * sC);
            if (gO > 0) {
              oL += gO * (bL[i] - dryL[i] * sO);
              oR += gO * (bR[i] - dryR[i] * sO);
            }
          }
        } else if (gO > 0) {
          oL += gO * (bL[i] - dryL[i] * sO);
          oR += gO * (bR[i] - dryR[i] * sO);
        }
        l[off + i] = oL;
        r[off + i] = oR;
      }
      off += n;
    }
  }

  /** Silences and clears every effect and drops any crossfade; the wanted effect is at full strength at once. Slot, amount and tempo are kept. */
  reset(): void {
    for (let i = 0; i < this.#effects.length; i++) this.#retire(i);
    this.#out = -1;
    this.#outSend = 0;
    this.#outGain = 0;
    this.#cur = this.#wanted();
    if (this.#cur >= 0) {
      this.#effects[this.#cur].setAmount(Math.abs(this.#amount));
      this.#effects[this.#cur].reset();
      this.#curSend = this.#fade;
      this.#curGain = this.#fade;
    } else {
      this.#curSend = 0;
      this.#curGain = 0;
    }
  }

  /** Index of the effect the slot and amount ask for, or -1 when the amount is 0. */
  #wanted(): number {
    return this.#amount === 0 ? -1 : this.#slot * 2 + (this.#amount < 0 ? 1 : 0);
  }

  /** Puts an effect in the state of a freshly built one: silent, with an empty memory. */
  #retire(i: number): void {
    this.#effects[i].setAmount(0);
    this.#effects[i].reset();
  }

  /** Decides which effect is current and arranges the fades. */
  #select(): void {
    const want = this.#wanted();
    const mag = Math.abs(this.#amount);
    if (want === this.#cur) {
      if (this.#cur >= 0) this.#effects[this.#cur].setAmount(mag);
      return;
    }
    if (want >= 0 && want === this.#out) {
      // the effect that is fading out is wanted again: the two swap roles and each keeps its send and gain
      const oldCur = this.#cur;
      const oldSend = this.#curSend;
      const oldGain = this.#curGain;
      this.#cur = this.#out;
      this.#curSend = this.#outSend;
      this.#curGain = this.#outGain;
      if (oldCur >= 0 && oldSend > 0) {
        this.#out = oldCur;
        this.#outSend = oldSend;
        this.#outGain = oldGain;
      } else {
        if (oldCur >= 0) this.#retire(oldCur);
        this.#out = -1;
        this.#outSend = 0;
        this.#outGain = 0;
      }
      this.#effects[this.#cur].setAmount(mag);
      return;
    }
    if (this.#cur >= 0) {
      if (this.#curSend === 0) {
        // it was never fed: drop it, the outgoing effect is untouched
        this.#retire(this.#cur);
      } else if (this.#out < 0) {
        // it becomes the outgoing effect
        this.#out = this.#cur;
        this.#outSend = this.#curSend;
        this.#outGain = this.#curGain;
      } else if (this.#curSend < this.#outGain) {
        // three effects at once: the quieter of the two is cut, the louder fades out
        this.#retire(this.#cur);
      } else {
        this.#retire(this.#out);
        this.#out = this.#cur;
        this.#outSend = this.#curSend;
        this.#outGain = this.#curGain;
      }
    }
    this.#cur = want;
    this.#curSend = 0;
    this.#curGain = want >= 0 ? this.#fade : 0;
    if (this.#cur >= 0) this.#effects[this.#cur].setAmount(mag);
  }
}
