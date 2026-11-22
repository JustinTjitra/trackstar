import { describe, expect, it, vi } from 'vitest';
import { describeTrack } from '../../src/fx/audio/devices';
import {
  FxSession,
  MSG_INPUT_ENDED,
  MSG_NO_SINK,
  MSG_PROCESSOR_CRASHED,
  MSG_SINK_FAILED,
} from '../../src/fx/audio/session';
import type { SessionDeps } from '../../src/fx/audio/session';
import type { FxMessage, FxStateMessage } from '../../src/fx/protocol';

// The real node module needs the Vite worklet suffix; stand in for it and count when it is loaded.
const nodeModule = vi.hoisted(() => ({ loads: 0, calls: [] as unknown[][], node: null as unknown }));
vi.mock('../../src/fx/audio/node', () => {
  nodeModule.loads += 1;
  return {
    createFxNode: (...args: unknown[]): Promise<unknown> => {
      nodeModule.calls.push(args);
      return Promise.resolve(nodeModule.node);
    },
  };
});

// ---- a small fake audio world ----

interface World { edges: Array<[FakeNode, FakeNode]> }

class FakeNode {
  throwOnDisconnect = false;
  constructor(readonly name: string, readonly world: World) {}
  connect(target: FakeNode): FakeNode {
    this.world.edges.push([this, target]);
    return target;
  }
  disconnect(): void {
    if (this.throwOnDisconnect) throw new Error('disconnect failed');
    this.world.edges = this.world.edges.filter(([from]) => from !== this);
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  startCalls = 0;
  stopCalls = 0;
  stream: unknown = null;
  start(): void { this.startCalls += 1; }
  stop(): void { this.stopCalls += 1; }
}

class FakeBuffer {
  copies: Array<{ data: Float32Array; channel: number }> = [];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {}
  copyToChannel(data: Float32Array, channel: number): void { this.copies.push({ data, channel }); }
}

class FakeEffects extends FakeNode {
  posted: unknown[] = [];
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage: (m: unknown): void => { this.posted.push(m); },
  };
  /** Delivers a message from the audio thread, as the browser would. */
  emit(data: unknown): void {
    const handler = this.port.onmessage;
    if (handler === null) throw new Error('no onmessage handler');
    handler({ data });
  }
}

class FakeTrack {
  stopCalls = 0;
  onended: (() => void) | null = null;
  constructor(readonly settings: MediaTrackSettings) {}
  getSettings(): MediaTrackSettings { return this.settings; }
  stop(): void { this.stopCalls += 1; }
}

class FakeStream {
  constructor(readonly track: FakeTrack) {}
  getAudioTracks(): FakeTrack[] { return [this.track]; }
  getTracks(): FakeTrack[] { return [this.track]; }
}

type SinkMode = 'none' | 'ok' | 'reject';

class FakeContext {
  sampleRate = 48000;
  state: string;
  baseLatency: number | undefined;
  outputLatency: number | undefined;
  destination: FakeNode;
  buffers: FakeBuffer[] = [];
  sources: FakeSource[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  sinkCalls: string[] = [];
  setSinkId?: (id: string) => Promise<void>;
  constructor(world: World, opts: RigOptions) {
    this.state = opts.state ?? 'running';
    this.baseLatency = 'baseLatency' in opts ? opts.baseLatency : 0.005;
    this.outputLatency = 'outputLatency' in opts ? opts.outputLatency : 0.012;
    this.destination = new FakeNode('destination', world);
    this.world = world;
    const sink = opts.sink ?? 'ok';
    if (sink !== 'none') {
      this.setSinkId = (id: string): Promise<void> => {
        this.sinkCalls.push(id);
        return sink === 'reject' ? Promise.reject(new Error('no such sink')) : Promise.resolve();
      };
    }
  }
  private world: World;
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const b = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource('source', this.world);
    this.sources.push(s);
    return s;
  }
  createMediaStreamSource(stream: unknown): FakeSource {
    const s = new FakeSource('source', this.world);
    s.stream = stream;
    this.sources.push(s);
    return s;
  }
  resume(): Promise<void> { this.resumeCalls += 1; this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.closeCalls += 1; return Promise.resolve(); }
}

interface RigOptions {
  state?: string;
  sink?: SinkMode;
  baseLatency?: number | undefined;
  outputLatency?: number | undefined;
  /** Settings of the input track; mono by default so the report has a warning. */
  settings?: MediaTrackSettings;
  openInputError?: unknown;
  createFxNodeError?: unknown;
  /** When set, createFxNode waits until `releaseNode()` is called. */
  deferNode?: boolean;
}

interface Rig {
  session: FxSession;
  world: World;
  loop: { l: Float32Array; r: Float32Array };
  contexts: FakeContext[];
  contextOptions: unknown[];
  nodes: FakeEffects[];
  nodeCalls: Array<{ ctx: unknown; initial: FxMessage[] | undefined }>;
  streams: FakeStream[];
  openInputCalls: string[];
  renderCalls: number[];
  releaseNode(): void;
  errors: string[];
  edges(): string[];
}

function rig(opts: RigOptions = {}): Rig {
  const world: World = { edges: [] };
  const loop = { l: new Float32Array([0.1, 0.2, 0.3, 0.4]), r: new Float32Array([0.5, 0.6, 0.7, 0.8]) };
  const contexts: FakeContext[] = [];
  const contextOptions: unknown[] = [];
  const nodes: FakeEffects[] = [];
  const nodeCalls: Rig['nodeCalls'] = [];
  const streams: FakeStream[] = [];
  const openInputCalls: string[] = [];
  const renderCalls: number[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const deps: SessionDeps = {
    createContext(o) {
      contextOptions.push(o);
      const c = new FakeContext(world, opts);
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    async createFxNode(ctx, initial) {
      nodeCalls.push({ ctx, initial });
      if (opts.deferNode) await gate;
      if (opts.createFxNodeError !== undefined) throw opts.createFxNodeError;
      const n = new FakeEffects('effects', world);
      nodes.push(n);
      return n as unknown as AudioWorkletNode;
    },
    async openInput(deviceId) {
      openInputCalls.push(deviceId);
      if (opts.openInputError !== undefined) throw opts.openInputError;
      const s = new FakeStream(new FakeTrack(opts.settings ?? { channelCount: 1, sampleRate: 48000 }));
      streams.push(s);
      return s as unknown as MediaStream;
    },
    renderDemoLoop(sampleRate) {
      renderCalls.push(sampleRate);
      return loop;
    },
  };
  const session = new FxSession(deps);
  const errors: string[] = [];
  session.onError((m) => { errors.push(m); });
  return {
    session, world, loop, contexts, contextOptions, nodes, nodeCalls, streams, openInputCalls, renderCalls,
    releaseNode: () => release(),
    errors,
    edges: () => world.edges.map(([a, b]) => `${a.name}->${b.name}`).sort(),
  };
}

const DEMO = { source: 'demo', outputDeviceId: null } as const;
const INPUT = { source: { inputDeviceId: 'in-1' }, outputDeviceId: null } as const;
const WIRED = ['effects->destination', 'source->effects'];
const BYPASSED = ['source->destination'];

function stateMsg(bpm: number): FxStateMessage {
  return { type: 'state', detectedBpm: bpm } as unknown as FxStateMessage;
}

// ---- tests ----

describe('FxSession start', () => {
  it('starts the demo loop through the effects into the output', async () => {
    const r = rig();
    await r.session.start(DEMO);
    expect(r.contextOptions).toEqual([{ latencyHint: 'interactive' }]);
    expect(r.renderCalls).toEqual([48000]);
    const buffer = r.contexts[0].buffers[0];
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(r.loop.l.length);
    expect(buffer.copies).toHaveLength(2);
    expect(buffer.copies[0].data).toBe(r.loop.l);
    expect(buffer.copies[0].channel).toBe(0);
    expect(buffer.copies[1].data).toBe(r.loop.r);
    expect(buffer.copies[1].channel).toBe(1);
    const src = r.contexts[0].sources[0];
    expect(src.buffer).toBe(buffer);
    expect(src.loop).toBe(true);
    expect(src.startCalls).toBe(1);
    expect(r.edges()).toEqual(WIRED);
    expect(r.session.running).toBe(true);
    expect(r.session.bypassed).toBe(false);
  });

  it('resumes a suspended context and leaves a running one alone', async () => {
    const suspended = rig({ state: 'suspended' });
    await suspended.session.start(DEMO);
    expect(suspended.contexts[0].resumeCalls).toBe(1);
    expect(suspended.session.running).toBe(true);
    const running = rig({ state: 'running' });
    await running.session.start(DEMO);
    expect(running.contexts[0].resumeCalls).toBe(0);
  });

  it('starts a live input and reports what the track gave', async () => {
    const r = rig();
    await r.session.start(INPUT);
    expect(r.openInputCalls).toEqual(['in-1']);
    expect(r.contexts[0].sources[0].stream).toBe(r.streams[0]);
    expect(r.edges()).toEqual(WIRED);
    const report = r.session.inputReport();
    expect(report).toEqual(describeTrack(r.streams[0].track.settings));
    expect(report?.warnings.length).toBeGreaterThan(0);
    expect(r.contexts[0].buffers).toHaveLength(0);
    expect(r.contexts[0].sources[0].startCalls).toBe(0);
  });

  it('has no input report for the demo source or before start', async () => {
    const r = rig();
    expect(r.session.inputReport()).toBeNull();
    await r.session.start(DEMO);
    expect(r.session.inputReport()).toBeNull();
  });

  it('routes the output to the chosen device', async () => {
    const r = rig();
    await r.session.start({ source: 'demo', outputDeviceId: 'out-1' });
    expect(r.contexts[0].sinkCalls).toEqual(['out-1']);
    expect(r.errors).toEqual([]);
    const none = rig();
    await none.session.start(DEMO);
    expect(none.contexts[0].sinkCalls).toEqual([]);
  });

  it('reports a browser without output selection and plays on the default output', async () => {
    const r = rig({ sink: 'none' });
    await r.session.start({ source: 'demo', outputDeviceId: 'out-1' });
    expect(r.errors).toEqual([MSG_NO_SINK]);
    expect(r.session.running).toBe(true);
    expect(r.edges()).toEqual(WIRED);
  });

  it('reports a failing output device and plays on the default output', async () => {
    const r = rig({ sink: 'reject' });
    await r.session.start({ source: 'demo', outputDeviceId: 'out-1' });
    expect(r.errors).toEqual([MSG_SINK_FAILED]);
    expect(r.session.running).toBe(true);
  });

  it('passes the initial messages to the effects node as given, or an empty array', async () => {
    const initial: FxMessage[] = [{ type: 'bpm', bpm: 128 }, { type: 'bypass', on: false }];
    const r = rig();
    await r.session.start({ ...DEMO, initial });
    expect(r.nodeCalls[0].initial).toBe(initial);
    expect(r.nodeCalls[0].ctx).toBe(r.contexts[0]);
    const r2 = rig();
    await r2.session.start(DEMO);
    expect(r2.nodeCalls[0].initial).toEqual([]);
  });

  it('replaces a running session when started again', async () => {
    const r = rig();
    await r.session.start(DEMO);
    await r.session.start(DEMO);
    expect(r.contexts).toHaveLength(2);
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.contexts[1].closeCalls).toBe(0);
    expect(r.session.running).toBe(true);
    expect(r.edges()).toEqual(WIRED);
    expect(r.contexts[0].sources[0].stopCalls).toBe(1);
  });
});

describe('FxSession messages', () => {
  it('delivers state messages to every listener until unsubscribed', async () => {
    const r = rig();
    const a: FxStateMessage[] = [];
    const b: FxStateMessage[] = [];
    r.session.onState((s) => { a.push(s); });
    const off = r.session.onState((s) => { b.push(s); });
    await r.session.start(DEMO);
    const m1 = stateMsg(120);
    r.nodes[0].emit(m1);
    expect(a).toEqual([m1]);
    expect(b).toEqual([m1]);
    off();
    const m2 = stateMsg(121);
    r.nodes[0].emit(m2);
    expect(a).toEqual([m1, m2]);
    expect(b).toEqual([m1]);
  });

  it('keeps going when a state listener throws', async () => {
    const r = rig();
    const got: FxStateMessage[] = [];
    r.session.onState(() => { throw new Error('listener broke'); });
    r.session.onState((s) => { got.push(s); });
    await r.session.start(DEMO);
    const m = stateMsg(120);
    expect(() => r.nodes[0].emit(m)).not.toThrow();
    expect(got).toEqual([m]);
    expect(r.session.bypassed).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('ignores unknown and malformed messages', async () => {
    const r = rig();
    const got: unknown[] = [];
    r.session.onState((s) => { got.push(s); });
    await r.session.start(DEMO);
    for (const data of [{ type: 'weird' }, { type: 5 }, {}, null, undefined, 'state', 42, ['state']]) {
      expect(() => r.nodes[0].emit(data)).not.toThrow();
    }
    expect(got).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.edges()).toEqual(WIRED);
  });

  it('keeps other error listeners working when one throws', async () => {
    const r = rig();
    const got: string[] = [];
    r.session.onError(() => { throw new Error('listener broke'); });
    r.session.onError((m) => { got.push(m); });
    await r.session.start(DEMO);
    expect(() => r.nodes[0].emit({ type: 'error', message: 'boom' })).not.toThrow();
    expect(got).toHaveLength(1);
    expect(r.edges()).toEqual(BYPASSED);
  });

  it('unsubscribes an error listener', async () => {
    const r = rig();
    const got: string[] = [];
    const off = r.session.onError((m) => { got.push(m); });
    off();
    await r.session.start(DEMO);
    r.nodes[0].emit({ type: 'error', message: 'boom' });
    expect(got).toEqual([]);
  });
});

describe('FxSession failsafe', () => {
  it('connects the source straight to the output when the effects report an error', async () => {
    const r = rig();
    await r.session.start(DEMO);
    r.nodes[0].emit({ type: 'error', message: 'boom' });
    expect(r.edges()).toEqual(BYPASSED);
    expect(r.session.bypassed).toBe(true);
    expect(r.session.running).toBe(true);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('boom');
    r.session.send({ type: 'bpm', bpm: 130 });
    expect(r.nodes[0].posted).toEqual([]);
  });

  it('does its work only once', async () => {
    const r = rig();
    await r.session.start(DEMO);
    r.nodes[0].emit({ type: 'error', message: 'boom' });
    r.nodes[0].emit({ type: 'error', message: 'again' });
    r.nodes[0].onprocessorerror?.();
    expect(r.edges()).toEqual(BYPASSED);
    expect(r.errors).toHaveLength(1);
  });

  it('does the same when the processor crashes', async () => {
    const r = rig();
    await r.session.start(DEMO);
    expect(typeof r.nodes[0].onprocessorerror).toBe('function');
    r.nodes[0].onprocessorerror?.();
    expect(r.edges()).toEqual(BYPASSED);
    expect(r.session.bypassed).toBe(true);
    expect(r.session.running).toBe(true);
    expect(r.errors).toEqual([MSG_PROCESSOR_CRASHED]);
  });

  it('still connects the source when a graph call throws', async () => {
    const r = rig();
    await r.session.start(DEMO);
    r.nodes[0].throwOnDisconnect = true;
    expect(() => r.nodes[0].emit({ type: 'error', message: 'boom' })).not.toThrow();
    expect(r.edges()).toContain('source->destination');
    expect(r.session.bypassed).toBe(true);
    expect(r.errors).toHaveLength(1);
  });

  it('still connects the source when disconnecting the source throws', async () => {
    const r = rig();
    await r.session.start(DEMO);
    r.contexts[0].sources[0].throwOnDisconnect = true;
    expect(() => r.nodes[0].onprocessorerror?.()).not.toThrow();
    expect(r.edges()).toContain('source->destination');
    expect(r.edges()).not.toContain('effects->destination');
    expect(r.errors).toEqual([MSG_PROCESSOR_CRASHED]);
  });

  it('starts clean after a stop that followed a failsafe', async () => {
    const r = rig();
    await r.session.start(DEMO);
    r.nodes[0].emit({ type: 'error', message: 'boom' });
    await r.session.stop();
    expect(r.session.bypassed).toBe(false);
    await r.session.start(DEMO);
    expect(r.session.bypassed).toBe(false);
    expect(r.edges()).toEqual(WIRED);
    r.session.send({ type: 'reset' });
    expect(r.nodes[1].posted).toEqual([{ type: 'reset' }]);
  });
});

describe('FxSession send', () => {
  it('does nothing before start, posts while running, and does nothing after stop', async () => {
    const r = rig();
    const msg: FxMessage = { type: 'bpm', bpm: 126 };
    expect(() => r.session.send(msg)).not.toThrow();
    await r.session.start(DEMO);
    r.session.send(msg);
    expect(r.nodes[0].posted).toHaveLength(1);
    expect(r.nodes[0].posted[0]).toBe(msg);
    await r.session.stop();
    r.session.send(msg);
    expect(r.nodes[0].posted).toHaveLength(1);
  });

  it('never throws when posting fails', async () => {
    const r = rig();
    await r.session.start(DEMO);
    r.nodes[0].port.postMessage = (): void => { throw new Error('port closed'); };
    expect(() => r.session.send({ type: 'reset' })).not.toThrow();
  });
});

describe('FxSession stop', () => {
  it('stops a demo session completely', async () => {
    const r = rig();
    await r.session.start(DEMO);
    await r.session.stop();
    const ctx = r.contexts[0];
    expect(ctx.sources[0].stopCalls).toBe(1);
    expect(ctx.closeCalls).toBe(1);
    expect(r.session.running).toBe(false);
    expect(r.session.latencyMs()).toBeNull();
    expect(r.nodes[0].port.onmessage).toBeNull();
    expect(r.nodes[0].onprocessorerror).toBeNull();
    expect(r.edges()).toEqual([]);
  });

  it('stops the tracks of an input session', async () => {
    const r = rig();
    await r.session.start(INPUT);
    const track = r.streams[0].track;
    await r.session.stop();
    expect(track.stopCalls).toBe(1);
    expect(track.onended).toBeNull();
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.session.inputReport()).toBeNull();
    expect(r.contexts[0].sources[0].stopCalls).toBe(0);
  });

  it('does nothing when called twice or before start', async () => {
    const fresh = rig();
    await expect(fresh.session.stop()).resolves.toBeUndefined();
    expect(fresh.contexts).toHaveLength(0);
    const r = rig();
    await r.session.start(DEMO);
    await r.session.stop();
    await expect(r.session.stop()).resolves.toBeUndefined();
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.contexts[0].sources[0].stopCalls).toBe(1);
  });

  it('finishes every step even when one throws', async () => {
    const r = rig();
    await r.session.start(INPUT);
    r.contexts[0].sources[0].throwOnDisconnect = true;
    r.nodes[0].throwOnDisconnect = true;
    r.contexts[0].close = (): Promise<void> => { r.contexts[0].closeCalls += 1; return Promise.reject(new Error('close failed')); };
    await expect(r.session.stop()).resolves.toBeUndefined();
    expect(r.streams[0].track.stopCalls).toBe(1);
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.session.running).toBe(false);
  });

  it('keeps listeners across a stop', async () => {
    const r = rig();
    const states: FxStateMessage[] = [];
    r.session.onState((s) => { states.push(s); });
    await r.session.start(DEMO);
    await r.session.stop();
    await r.session.start(DEMO);
    r.nodes[1].emit(stateMsg(125));
    r.nodes[1].emit({ type: 'error', message: 'boom' });
    expect(states).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });
});

describe('FxSession latency', () => {
  it('adds base and output latency in milliseconds', async () => {
    const r = rig({ baseLatency: 0.005, outputLatency: 0.012 });
    expect(r.session.latencyMs()).toBeNull();
    await r.session.start(DEMO);
    expect(r.session.latencyMs()).toBeCloseTo(17, 9);
  });

  it('counts a missing latency as zero', async () => {
    const r = rig({ baseLatency: 0.005, outputLatency: undefined });
    await r.session.start(DEMO);
    expect(r.session.latencyMs()).toBeCloseTo(5, 9);
    const bad = rig({ baseLatency: Number.NaN, outputLatency: Infinity });
    await bad.session.start(DEMO);
    expect(bad.session.latencyMs()).toBe(0);
  });
});

describe('FxSession failing and cancelled starts', () => {
  it('cleans up when the input cannot be opened', async () => {
    const err = new Error('Permission denied');
    const r = rig({ openInputError: err });
    await expect(r.session.start(INPUT)).rejects.toBe(err);
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.session.running).toBe(false);
    expect(r.edges()).toEqual([]);
  });

  it('cleans up when the effects node cannot be created', async () => {
    const err = new Error('worklet failed to load');
    const r = rig({ createFxNodeError: err });
    await expect(r.session.start(INPUT)).rejects.toBe(err);
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.streams[0].track.stopCalls).toBe(1);
    expect(r.session.running).toBe(false);
  });

  it('can start again after a failure', async () => {
    const r = rig({ createFxNodeError: new Error('first') });
    await expect(r.session.start(DEMO)).rejects.toThrow('first');
    const ok = rig();
    await ok.session.start(DEMO);
    expect(ok.session.running).toBe(true);
  });

  it.each(['demo', 'input'] as const)('a stop during a %s start cancels it quietly', async (kind) => {
    const r = rig({ deferNode: true });
    const started = r.session.start(kind === 'demo' ? DEMO : INPUT);
    // let the start run up to the pending effects node
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(r.nodeCalls).toHaveLength(1);
    await r.session.stop();
    r.releaseNode();
    await expect(started).resolves.toBeUndefined();
    expect(r.session.running).toBe(false);
    expect(r.edges()).toEqual([]);
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.contexts[0].sources.every((s) => s.startCalls === 0)).toBe(true);
    if (kind === 'input') expect(r.streams[0].track.stopCalls).toBe(1);
    expect(r.nodes[0].port.onmessage).toBeNull();
  });

  it('a stop during the output device wait cancels the start', async () => {
    const r = rig();
    const started = r.session.start({ source: 'demo', outputDeviceId: 'out-1' });
    await r.session.stop();
    await expect(started).resolves.toBeUndefined();
    expect(r.session.running).toBe(false);
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.nodeCalls).toHaveLength(0);
  });

  it('a stop during the input wait stops the track that arrives late', async () => {
    const r = rig();
    const started = r.session.start(INPUT);
    await r.session.stop();
    await expect(started).resolves.toBeUndefined();
    expect(r.session.running).toBe(false);
    expect(r.streams[0].track.stopCalls).toBe(1);
    expect(r.contexts[0].closeCalls).toBe(1);
    expect(r.nodeCalls).toHaveLength(0);
  });

  it('a cancelled start that then fails ends quietly: nobody is waiting for its error', async () => {
    const r = rig({ openInputError: new Error('late failure') });
    const started = r.session.start(INPUT);
    await r.session.stop(); // cancels before the input failure is seen
    await expect(started).resolves.toBeUndefined();
    expect(r.session.running).toBe(false);
    expect(r.contexts[0].closeCalls).toBe(1);
    // the same failure without a stop is reported to the caller
    const again = rig({ openInputError: new Error('late failure') });
    await expect(again.session.start(INPUT)).rejects.toThrow('late failure');
  });

  it('a stop during the resume wait cancels the start', async () => {
    const r = rig({ state: 'suspended' });
    const started = r.session.start(DEMO);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await r.session.stop();
    await expect(started).resolves.toBeUndefined();
    expect(r.session.running).toBe(false);
    expect(r.contexts[0].closeCalls).toBe(1);
  });
});

describe('FxSession input ending', () => {
  it('reports when the input track ends', async () => {
    const r = rig();
    await r.session.start(INPUT);
    r.streams[0].track.onended?.();
    expect(r.errors).toEqual([MSG_INPUT_ENDED]);
    expect(r.session.running).toBe(true);
  });
});

describe('FxSession without deps', () => {
  it('can be constructed in Node and fails to start without an AudioContext', async () => {
    const session = new FxSession();
    expect(session.running).toBe(false);
    expect(session.bypassed).toBe(false);
    expect(session.latencyMs()).toBeNull();
    await expect(session.start({ source: 'demo', outputDeviceId: null })).rejects.toThrow();
    expect(session.running).toBe(false);
  });
});

describe('FxSession default effects node', () => {
  it('loads the node module only when the effects node is first needed', async () => {
    expect(nodeModule.loads).toBe(0);
    const r = rig();
    nodeModule.node = new FakeEffects('effects', r.world);
    const initial: FxMessage[] = [{ type: 'reset' }];
    const session = new FxSession({
      createContext: () => new FakeContext(r.world, {}) as unknown as AudioContext,
      renderDemoLoop: () => r.loop,
    });
    expect(nodeModule.loads).toBe(0);
    await session.start({ source: 'demo', outputDeviceId: null, initial });
    expect(nodeModule.loads).toBe(1);
    expect(nodeModule.calls).toHaveLength(1);
    expect(nodeModule.calls[0][1]).toBe(initial);
    expect(session.running).toBe(true);
    await session.stop();
  });
});
