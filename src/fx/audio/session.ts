// the audio session: source (demo loop or live input) into the effects node into the output, with a failsafe that keeps the music playing if the effects fail

import { renderDemoLoop } from '../demo/demoLoop';
import type { FxMessage, FxStateMessage } from '../protocol';
import { describeTrack, openInput } from './devices';
import type { TrackReport } from './devices';

/** Shown when the browser has no way to choose an audio output. */
export const MSG_NO_SINK = 'This browser cannot choose an audio output; using the default output.';
/** Shown when the chosen audio output could not be used. */
export const MSG_SINK_FAILED = 'Could not use the chosen audio output; using the default output.';
/** Shown when the effects processor crashed and the failsafe took the effects out. */
export const MSG_PROCESSOR_CRASHED = 'The effects stopped working; the music is passing through untouched.';
/** Shown when the live input track ended, for example because the device was unplugged. */
export const MSG_INPUT_ENDED = 'The audio input stopped. Was the device disconnected?';

/** The outside world the session needs; tests replace these with fakes. */
export interface SessionDeps {
  /** Creates the audio context. */
  createContext(options: AudioContextOptions): AudioContext;
  /** Loads the effects processor into the context and returns its node. */
  createFxNode(ctx: BaseAudioContext, initial?: FxMessage[]): Promise<AudioWorkletNode>;
  /** Opens a live input device. */
  openInput(deviceId: string): Promise<MediaStream>;
  /** Renders the built-in demo loop at the given sample rate. */
  renderDemoLoop(sampleRate: number): { l: Float32Array; r: Float32Array };
}

/** What to play and where to send it. */
export interface SessionStartOptions {
  /** The built-in demo loop, or a live input device. */
  source: 'demo' | { inputDeviceId: string };
  /** Output device id, or null for the default output. */
  outputDeviceId: string | null;
  /** Control messages that are in force from the first sample. */
  initial?: FxMessage[];
}

/** Everything one started session owns; filled in step by step so a failed start can undo exactly what exists. */
interface Run {
  ctx: AudioContext;
  demo: boolean;
  src: AudioBufferSourceNode | MediaStreamAudioSourceNode | null;
  started: boolean;
  node: AudioWorkletNode | null;
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
  report: TrackReport | null;
  bypassed: boolean;
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** Calls `step`, ignoring anything it throws, so one failing cleanup step cannot block the rest. */
function attempt(step: () => void): void {
  try {
    step();
  } catch {
    // ignored on purpose
  }
}

/** Undoes everything `run` created: stops and unhooks the graph, stops input tracks, closes the context. */
async function teardown(run: Run): Promise<void> {
  const { src, node, stream, track } = run;
  if (run.demo && src && run.started) attempt(() => (src as AudioBufferSourceNode).stop());
  if (src) attempt(() => src.disconnect());
  if (node) {
    attempt(() => node.disconnect());
    attempt(() => { node.port.onmessage = null; });
    attempt(() => { node.onprocessorerror = null; });
  }
  if (track) attempt(() => { track.onended = null; });
  if (stream) attempt(() => stream.getTracks().forEach((t) => t.stop()));
  try {
    await run.ctx.close();
  } catch {
    // ignored on purpose
  }
}

/**
 * Owns the browser audio graph: a source into the effects node into the output. If the effects fail
 * the source is connected straight to the output, so the music does not stop.
 */
export class FxSession {
  readonly #deps: SessionDeps;
  readonly #stateListeners = new Set<(s: FxStateMessage) => void>();
  readonly #errorListeners = new Set<(message: string) => void>();
  #run: Run | null = null;
  #generation = 0;
  #starting = 0;

  /** Builds a session. Nothing browser-specific is touched until `start`; missing deps use the browser's own. */
  constructor(deps: Partial<SessionDeps> = {}) {
    this.#deps = {
      createContext: deps.createContext ?? ((o) => new AudioContext(o)),
      createFxNode: deps.createFxNode ?? ((ctx, initial) => import('./node').then((m) => m.createFxNode(ctx, initial))),
      openInput: deps.openInput ?? openInput,
      renderDemoLoop: deps.renderDemoLoop ?? ((sr) => renderDemoLoop(sr)),
    };
  }

  /** True while a session is playing, including after the failsafe has taken the effects out. */
  get running(): boolean {
    return this.#run !== null;
  }

  /** True once the failsafe has taken the effects out and the source plays straight to the output. */
  get bypassed(): boolean {
    return this.#run?.bypassed ?? false;
  }

  /**
   * Starts playing, replacing any current session. Rejects with the reason (for example permission
   * denied) after undoing everything it set up. A `stop` during the start cancels it: it resolves
   * without playing.
   */
  async start(opts: SessionStartOptions): Promise<void> {
    if (this.#run !== null || this.#starting > 0) await this.stop();
    const generation = ++this.#generation;
    const cancelled = (): boolean => generation !== this.#generation;
    this.#starting += 1;
    let run: Run | null = null;
    try {
      const ctx = this.#deps.createContext({ latencyHint: 'interactive' });
      const demo = opts.source === 'demo';
      const r: Run = { ctx, demo, src: null, started: false, node: null, stream: null, track: null, report: null, bypassed: false };
      run = r;

      if (opts.outputDeviceId !== null) {
        const setSinkId = (ctx as SinkContext).setSinkId;
        if (typeof setSinkId !== 'function') {
          this.#emitError(MSG_NO_SINK);
        } else {
          try {
            await setSinkId.call(ctx, opts.outputDeviceId);
          } catch {
            this.#emitError(MSG_SINK_FAILED);
          }
        }
        if (cancelled()) return await teardown(r);
      }

      if (opts.source === 'demo') {
        const loop = this.#deps.renderDemoLoop(ctx.sampleRate);
        const buffer = ctx.createBuffer(2, loop.l.length, ctx.sampleRate);
        // The loop is rendered into plain ArrayBuffers; the DOM typing just cannot see that.
        buffer.copyToChannel(loop.l as Float32Array<ArrayBuffer>, 0);
        buffer.copyToChannel(loop.r as Float32Array<ArrayBuffer>, 1);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        r.src = src;
      } else {
        const stream = await this.#deps.openInput(opts.source.inputDeviceId);
        r.stream = stream;
        if (cancelled()) return await teardown(r);
        r.src = ctx.createMediaStreamSource(stream);
        const track = stream.getAudioTracks()[0];
        if (track) {
          r.track = track;
          r.report = describeTrack(track.getSettings());
          track.onended = () => this.#emitError(MSG_INPUT_ENDED);
        }
      }

      const node = await this.#deps.createFxNode(ctx, opts.initial ?? []);
      r.node = node;
      if (cancelled()) return await teardown(r);

      node.port.onmessage = (e: MessageEvent) => this.#handle(r, e.data);
      node.onprocessorerror = () => this.#failsafe(r, MSG_PROCESSOR_CRASHED);
      r.src.connect(node);
      node.connect(ctx.destination);
      if (demo) {
        (r.src as AudioBufferSourceNode).start();
        r.started = true;
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
        if (cancelled()) return await teardown(r);
      }
      this.#run = r;
    } catch (err) {
      if (run) await teardown(run);
      // A start that was cancelled meanwhile has no caller waiting for its reason.
      if (cancelled()) return;
      throw err;
    } finally {
      this.#starting -= 1;
    }
  }

  /** Stops playing and releases the audio graph, the input device and the context. Safe to call at any time. */
  async stop(): Promise<void> {
    this.#generation += 1;
    const run = this.#run;
    if (run === null) return;
    this.#run = null;
    await teardown(run);
  }

  /** Sends a control message to the effects. Does nothing when not running or after the failsafe; never throws. */
  send(msg: FxMessage): void {
    const run = this.#run;
    if (run === null || run.bypassed || run.node === null) return;
    attempt(() => run.node?.port.postMessage(msg));
  }

  /** Calls `fn` with every state report from the effects. Returns a function that removes it. */
  onState(fn: (s: FxStateMessage) => void): () => void {
    this.#stateListeners.add(fn);
    return () => { this.#stateListeners.delete(fn); };
  }

  /** Calls `fn` with every message meant for the user (failsafe, output and input problems). Returns a function that removes it. */
  onError(fn: (message: string) => void): () => void {
    this.#errorListeners.add(fn);
    return () => { this.#errorListeners.delete(fn); };
  }

  /** Base plus output latency of the context in milliseconds, or null when not running. */
  latencyMs(): number | null {
    const run = this.#run;
    if (run === null) return null;
    const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return (finite(run.ctx.baseLatency) + finite(run.ctx.outputLatency)) * 1000;
  }

  /** What the browser gave for the live input track, or null for the demo source or when not running. */
  inputReport(): TrackReport | null {
    return this.#run?.report ?? null;
  }

  #handle(run: Run, data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const m = data as { type?: unknown; message?: unknown };
    if (m.type === 'state') {
      for (const fn of [...this.#stateListeners]) attempt(() => fn(data as FxStateMessage));
    } else if (m.type === 'error') {
      this.#failsafe(run, 'The effects reported an error (' + String(m.message) + '); the music is passing through untouched.');
    }
  }

  #failsafe(run: Run, message: string): void {
    if (run.bypassed) return;
    run.bypassed = true;
    const { src, node, ctx } = run;
    if (src) attempt(() => src.disconnect());
    if (node) attempt(() => node.disconnect());
    if (src) attempt(() => src.connect(ctx.destination));
    this.#emitError(message);
  }

  #emitError(message: string): void {
    for (const fn of [...this.#errorListeners]) attempt(() => fn(message));
  }
}
