// the AudioWorkletProcessor that runs the effects on the audio thread: a thin wrapper around FxProcessorCore, which holds all the behaviour.

import { FxProcessorCore } from './core';

// The audio worklet scope has its own globals, which TypeScript's DOM library does not declare.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: ProcessorOptions) => AudioWorkletProcessor): void;

interface ProcessorOptions {
  processorOptions?: { initial?: unknown };
}

class TrackstarFxProcessor extends AudioWorkletProcessor {
  #core: FxProcessorCore;

  constructor(options?: ProcessorOptions) {
    super();
    const port = this.port;
    this.#core = new FxProcessorCore(sampleRate, (msg) => port.postMessage(msg), options?.processorOptions?.initial);
    port.onmessage = (e: MessageEvent) => this.#core.handleMessage(e.data);
  }

  /** Called by the browser for every block of audio. Returning true keeps the processor alive. */
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.#core.process(inputs[0] ?? [], outputs[0] ?? []);
    return true;
  }
}

// The name must match FX_PROCESSOR_NAME in audio/node.ts.
registerProcessor('trackstar-fx', TrackstarFxProcessor);
