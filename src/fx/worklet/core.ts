// the core of the audio processor: copies input to output, runs the effects engine, follows the tempo, reports state, and fails safe. No Web Audio here, so it runs under test.

import { FxEngine } from '../engine';
import { applyMessage, isFxMessage } from '../protocol';
import type { FxErrorMessage, FxStateMessage } from '../protocol';
import { BpmDetector } from '../tempo/bpmDetector';
import { OnsetDetector } from '../tempo/onset';

/** Seconds between state reports. */
const STATE_INTERVAL_S = 0.1;
/** Seconds between tempo estimates. */
const ESTIMATE_INTERVAL_S = 1;
/** An estimate must be more confident than this to move the engine tempo. */
const AUTO_BPM_CONFIDENCE = 0.5;
/** An estimate must differ from the engine tempo by more than this (BPM) to move it. */
const AUTO_BPM_DEADBAND = 0.25;
/** Largest number of samples mixed to mono and analysed at once. */
const MONO_CHUNK = 128;

/** A message sent from the audio thread to the page. */
export type FxOutMessage = FxStateMessage | FxErrorMessage;

/**
 * Everything the audio thread decides, without any Web Audio: it copies audio, runs the effects
 * engine, follows the tempo, reports state, handles messages, and passes audio through untouched
 * once anything has failed.
 */
export class FxProcessorCore {
  #engine: FxEngine;
  #onset: OnsetDetector;
  #bpmDetector: BpmDetector;
  #post: (msg: FxOutMessage) => void;
  #stateInterval: number;
  #estimateEvery: number;
  #mono: Float32Array;
  #stateMsg: FxStateMessage;
  #onOnsetValue: (v: number) => void;
  #autoBpm = true;
  #detectedBpm: number | null = null;
  #bpmConfidence = 0;
  #failed = false;
  #sinceState = 0;
  #sinceEstimate = 0;

  /**
   * Throws RangeError unless sampleRate is finite and > 0. `post` receives every outgoing message;
   * the state message object is reused, so the receiver must copy it. When `initial` is an array,
   * its elements are handled as messages in order and the engine is then reset so they are in force
   * at once; anything else is ignored.
   */
  constructor(sampleRate: number, post: (msg: FxOutMessage) => void, initial?: unknown) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('FxProcessorCore: sampleRate must be finite and > 0');
    }
    this.#post = post;
    this.#engine = new FxEngine(sampleRate);
    this.#onset = new OnsetDetector(sampleRate);
    this.#bpmDetector = new BpmDetector(this.#onset.hopRate);
    this.#stateInterval = Math.max(1, Math.round(STATE_INTERVAL_S * sampleRate));
    this.#estimateEvery = Math.max(1, Math.round(ESTIMATE_INTERVAL_S * this.#onset.hopRate));
    this.#mono = new Float32Array(MONO_CHUNK);
    const s = this.#engine.state();
    this.#stateMsg = {
      type: 'state',
      bypass: s.bypass,
      slot: s.slot,
      amount: s.amount,
      rollActive: s.rollActive,
      releaseActive: s.releaseActive,
      limiterGain: s.limiterGain,
      bpm: s.bpm,
      detectedBpm: null,
      bpmConfidence: 0,
    };
    this.#onOnsetValue = (v: number): void => this.#onValue(v);
    if (Array.isArray(initial)) {
      for (const msg of initial) this.handleMessage(msg);
      this.#engine.reset();
    }
  }

  /** Handles a control message from the page. Malformed messages are ignored; nothing is handled after a failure. */
  handleMessage(data: unknown): void {
    if (this.#failed) return;
    try {
      if (!isFxMessage(data)) return;
      if (data.type === 'autoBpm') {
        this.#autoBpm = data.on;
        return;
      }
      applyMessage(this.#engine, data);
      if (data.type === 'reset') {
        this.#onset.reset();
        this.#bpmDetector.reset();
        this.#detectedBpm = null;
        this.#bpmConfidence = 0;
        this.#sinceEstimate = 0;
      }
    } catch (err) {
      this.#fail(err);
    }
  }

  /**
   * Processes one block: `input` and `output` are the channel lists of the first input and output
   * (input has 0, 1 or 2 channels, output normally 2, all of equal length). The input is copied to
   * the output, then the effects run in place. With fewer than two output channels, or after a
   * failure, the audio is only passed through.
   */
  process(input: Float32Array[], output: Float32Array[]): void {
    if (output.length === 0) return;
    const frames = output[0].length;
    const inL = input.length > 0 ? input[0] : undefined;
    const inR = input.length > 1 ? input[1] : inL;
    this.#copy(inL, inR, output, frames);
    if (this.#failed || output.length < 2) return;
    try {
      if (inL && inR) {
        const mono = this.#mono;
        for (let off = 0; off < frames; off += MONO_CHUNK) {
          const n = Math.min(MONO_CHUNK, frames - off);
          for (let i = 0; i < n; i++) mono[i] = 0.5 * (inL[off + i] + inR[off + i]);
          this.#onset.process(mono, n, this.#onOnsetValue);
        }
      }
      this.#engine.process(output[0], output[1], frames);
      this.#sinceState += frames;
      if (this.#sinceState >= this.#stateInterval) {
        this.#sinceState -= this.#stateInterval;
        this.#postState();
      }
    } catch (err) {
      this.#fail(err);
      // the engine may have left the output half processed
      this.#copy(inL, inR, output, frames);
    }
  }

  /** Copies the input channels to the output channels; a missing source gives silence. */
  #copy(inL: Float32Array | undefined, inR: Float32Array | undefined, output: Float32Array[], frames: number): void {
    for (let c = 0; c < output.length; c++) {
      const source = c === 0 ? inL : inR;
      const dest = output[c];
      if (source) {
        for (let i = 0; i < frames; i++) dest[i] = source[i];
      } else {
        dest.fill(0, 0, frames);
      }
    }
  }

  /** Takes one onset value: feeds the detector and, once a second, refreshes the tempo estimate. */
  #onValue(v: number): void {
    this.#bpmDetector.push(v);
    this.#sinceEstimate++;
    if (this.#sinceEstimate >= this.#estimateEvery) {
      this.#sinceEstimate = 0;
      const e = this.#bpmDetector.estimate();
      if (e === null) {
        this.#detectedBpm = null;
        this.#bpmConfidence = 0;
      } else {
        this.#detectedBpm = e.bpm;
        this.#bpmConfidence = e.confidence;
        if (
          this.#autoBpm &&
          e.confidence > AUTO_BPM_CONFIDENCE &&
          Math.abs(e.bpm - this.#engine.state().bpm) > AUTO_BPM_DEADBAND
        ) {
          this.#engine.setBpm(e.bpm);
        }
      }
    }
  }

  /** Refills the one state message from the engine and posts it. */
  #postState(): void {
    const s = this.#engine.state();
    const m = this.#stateMsg;
    m.bypass = s.bypass;
    m.slot = s.slot;
    m.amount = s.amount;
    m.rollActive = s.rollActive;
    m.releaseActive = s.releaseActive;
    m.limiterGain = s.limiterGain;
    m.bpm = s.bpm;
    m.detectedBpm = this.#detectedBpm;
    m.bpmConfidence = this.#bpmConfidence;
    this.#post(m);
  }

  /** Switches to pass-through for good and tells the page, once. */
  #fail(err: unknown): void {
    this.#failed = true;
    try {
      this.#post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } catch {
      // nothing more can be done
    }
  }
}
