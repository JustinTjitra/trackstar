import { describe, expect, it } from 'vitest';
import { createBus, decode, DISPLAY_CHANNEL, encode } from '../../src/display/bus';
import type { ChannelLike, DisplayState } from '../../src/display/bus';
import type { DeckSnapshot } from '../../src/state/deckStore';
import { ACTIONS, DECKS } from '../../src/types';
import type { Action, Deck } from '../../src/types';

/** A full snapshot with every control at its quiet default. */
function snapshot(): DeckSnapshot {
  const out = {} as DeckSnapshot;
  for (const d of DECKS) {
    const row = {} as DeckSnapshot[Deck];
    for (const a of ACTIONS) row[a] = { value: null, pending: false, unconfirmed: false, blind: false };
    out[d] = row;
  }
  return out;
}

/** A valid display state, with overrides. */
function state(over: Partial<DisplayState> = {}): DisplayState {
  return { v: 1, t: 1000, mode: 'deck', decks: snapshot(), fx: null, bpm: null, ...over };
}

/** A state in fx mode with a few controls set. */
function busyState(): DisplayState {
  const decks = snapshot();
  decks.A.loop1 = { value: true, pending: true, unconfirmed: true, blind: true };
  decks.B.vocals = { value: false, pending: false, unconfirmed: true, blind: false };
  return state({
    mode: 'fx',
    decks,
    fx: { slot: 3, amount: -0.5, rollActive: true, releaseActive: false, bypass: false },
    bpm: 127.5,
  });
}

interface FakeChannel extends ChannelLike {
  posted: unknown[];
  closeCalls: number;
  deliver(data: unknown): void;
}

function fakeChannel(): FakeChannel {
  const ch: FakeChannel = {
    posted: [],
    closeCalls: 0,
    onmessage: null,
    postMessage(data: unknown): void {
      ch.posted.push(data);
    },
    close(): void {
      ch.closeCalls += 1;
    },
    deliver(data: unknown): void {
      ch.onmessage?.({ data });
    },
  };
  return ch;
}

/** A bus on a fake channel, plus the factory call log. */
function fakeBus(): { bus: ReturnType<typeof createBus>; ch: FakeChannel; names: string[] } {
  const ch = fakeChannel();
  const names: string[] = [];
  const bus = createBus((name) => {
    names.push(name);
    return ch;
  });
  return { bus, ch, names };
}

/** A deep copy of a valid state as a plain mutable object, for building bad inputs. */
interface Raw {
  v: unknown;
  t: unknown;
  mode: unknown;
  decks: Record<string, Record<string, Record<string, unknown>>>;
  fx: Record<string, unknown>;
  bpm: unknown;
  [key: string]: unknown;
}

function mutable(): Raw {
  return JSON.parse(encode(state({ fx: { slot: 1, amount: 0.5, rollActive: false, releaseActive: false, bypass: false }, bpm: 120 })));
}

function without(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

describe('encode and decode: valid input', () => {
  it('round-trips a deck-mode state', () => {
    const s = state();
    const raw = encode(s);
    expect(typeof raw).toBe('string');
    expect(decode(raw)).toEqual(s);
  });

  it('round-trips an fx-mode state with controls set', () => {
    const s = busyState();
    expect(decode(encode(s))).toEqual(s);
  });

  it('accepts the object form and returns a fresh copy', () => {
    const s = busyState();
    const out = decode(s);
    expect(out).toEqual(s);
    expect(out).not.toBe(s);
    expect(out?.decks).not.toBe(s.decks);
    expect(out?.decks.A).not.toBe(s.decks.A);
    expect(out?.decks.A.loop1).not.toBe(s.decks.A.loop1);
    expect(out?.fx).not.toBe(s.fx);
  });

  it('drops extra properties instead of copying or rejecting them', () => {
    const raw = mutable();
    raw.extra = 1;
    raw.decks.A.loop1.junk = 'x';
    raw.decks.extraDeck = {};
    raw.decks.B.extraAction = {};
    raw.fx.more = true;
    const out = decode(raw);
    expect(out).not.toBeNull();
    expect(Object.keys(out as object).sort()).toEqual(['bpm', 'decks', 'fx', 'mode', 't', 'v']);
    expect(Object.keys(out!.decks.A.loop1).sort()).toEqual(['blind', 'pending', 'unconfirmed', 'value']);
    expect(Object.keys(out!.decks).sort()).toEqual(['A', 'B']);
    expect(Object.keys(out!.decks.B).sort()).toEqual([...ACTIONS].sort());
    expect(Object.keys(out!.fx!).sort()).toEqual(['amount', 'bypass', 'releaseActive', 'rollActive', 'slot']);
  });

  it('accepts every slot from 0 to 4', () => {
    for (const slot of [0, 1, 2, 3, 4]) {
      const raw = mutable();
      raw.fx.slot = slot;
      expect(decode(raw)?.fx?.slot, `slot ${slot}`).toBe(slot);
    }
  });
});

describe('decode: invalid input gives null', () => {
  function badControl(patch: (c: Record<string, unknown>) => void): Raw {
    const raw = mutable();
    patch(raw.decks.A.loop1);
    return raw;
  }
  function badFx(patch: (f: Record<string, unknown>) => void): Raw {
    const raw = mutable();
    patch(raw.fx);
    return raw;
  }

  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['boolean', true],
    ['not json', 'not json'],
    ['broken json', '{"v":1'],
    ['json array string', '[]'],
    ['array', []],
    ['empty object', {}],
    ['v: 2', { ...mutable(), v: 2 }],
    ["v: '1'", { ...mutable(), v: '1' }],
    ['v missing', without(mutable(), 'v')],
    ['t NaN', { ...mutable(), t: NaN }],
    ['t Infinity', { ...mutable(), t: Infinity }],
    ['t string', { ...mutable(), t: '1000' }],
    ['t missing', without(mutable(), 't')],
    ["mode 'other'", { ...mutable(), mode: 'other' }],
    ['mode missing', without(mutable(), 'mode')],
    ['decks missing', without(mutable(), 'decks')],
    ['decks null', { ...mutable(), decks: null }],
    ['decks array', { ...mutable(), decks: [] }],
    ['deck B missing', (() => { const r = mutable(); delete r.decks.B; return r; })()],
    ['last action missing from deck B', (() => { const r = mutable(); delete r.decks.B[ACTIONS[ACTIONS.length - 1] as Action]; return r; })()],
    ['first action missing from deck A', (() => { const r = mutable(); delete r.decks.A[ACTIONS[0] as Action]; return r; })()],
    ['control null', (() => { const r = mutable(); r.decks.B = { ...r.decks.B, inst: null as unknown as Record<string, unknown> }; return r; })()],
    ["control value 'yes'", badControl((c) => { c.value = 'yes'; })],
    ['control value 1', badControl((c) => { c.value = 1; })],
    ['control value missing', badControl((c) => { delete c.value; })],
    ['control pending missing', badControl((c) => { delete c.pending; })],
    ["control unconfirmed 'no'", badControl((c) => { c.unconfirmed = 'no'; })],
    ['control blind null', badControl((c) => { c.blind = null; })],
    ['fx missing', without(mutable(), 'fx')],
    ['fx 5', { ...mutable(), fx: 5 }],
    ['fx array', { ...mutable(), fx: [] }],
    ['fx slot 5', badFx((f) => { f.slot = 5; })],
    ['fx slot -1', badFx((f) => { f.slot = -1; })],
    ['fx slot 1.5', badFx((f) => { f.slot = 1.5; })],
    ["fx slot '1'", badFx((f) => { f.slot = '1'; })],
    ['fx amount NaN', badFx((f) => { f.amount = NaN; })],
    ['fx amount missing', badFx((f) => { delete f.amount; })],
    ['fx rollActive missing', badFx((f) => { delete f.rollActive; })],
    ['fx releaseActive 0', badFx((f) => { f.releaseActive = 0; })],
    ['fx bypass missing', badFx((f) => { delete f.bypass; })],
    ['bpm missing', without(mutable(), 'bpm')],
    ['bpm 0', { ...mutable(), bpm: 0 }],
    ['bpm -120', { ...mutable(), bpm: -120 }],
    ['bpm NaN', { ...mutable(), bpm: NaN }],
    ['bpm Infinity', { ...mutable(), bpm: Infinity }],
    ["bpm '120'", { ...mutable(), bpm: '120' }],
  ];

  it('rejects every malformed input without throwing', () => {
    for (const [label, input] of cases) {
      let out: unknown = 'unset';
      expect(() => { out = decode(input); }, label).not.toThrow();
      expect(out, label).toBeNull();
    }
  });

  it('rejects the same inputs when they arrive as JSON strings', () => {
    for (const [label, input] of cases) {
      if (typeof input !== 'object' || input === null) continue;
      // JSON turns NaN and Infinity into null, which is a valid bpm, so those two cases only apply to objects
      if (label === 'bpm NaN' || label === 'bpm Infinity') continue;
      expect(decode(JSON.stringify(input)), label).toBeNull();
    }
  });

  it('sanity: the base object used for the bad cases is itself valid', () => {
    expect(decode(mutable())).not.toBeNull();
  });
});

describe('decode: hostile input', () => {
  it('returns null for an object whose getter throws', () => {
    const hostile = {
      get v(): number {
        throw new Error('boom');
      },
    };
    let out: unknown = 'unset';
    expect(() => { out = decode(hostile); }).not.toThrow();
    expect(out).toBeNull();
  });

  it('returns null for a proxy whose get trap throws', () => {
    const hostile = new Proxy({}, {
      get(): never {
        throw new Error('boom');
      },
    });
    let out: unknown = 'unset';
    expect(() => { out = decode(hostile); }).not.toThrow();
    expect(out).toBeNull();
  });

  it('returns null when a nested getter throws', () => {
    const raw = mutable();
    Object.defineProperty(raw.decks.A.loop1, 'value', {
      get(): never {
        throw new Error('boom');
      },
      enumerable: true,
    });
    let out: unknown = 'unset';
    expect(() => { out = decode(raw); }).not.toThrow();
    expect(out).toBeNull();
  });
});

describe('createBus: publish', () => {
  it('creates the channel once with the display channel name', () => {
    const { names } = fakeBus();
    expect(names).toEqual(['trackstar-display']);
    expect(DISPLAY_CHANNEL).toBe('trackstar-display');
  });

  it('posts exactly one encoded string that decodes back to the state', () => {
    const { bus, ch } = fakeBus();
    const s = busyState();
    bus.publish(s);
    expect(ch.posted).toHaveLength(1);
    expect(typeof ch.posted[0]).toBe('string');
    expect(decode(ch.posted[0])).toEqual(s);
  });

  it('does not throw when postMessage throws', () => {
    const ch = fakeChannel();
    ch.postMessage = (): void => {
      throw new Error('closed');
    };
    const bus = createBus(() => ch);
    expect(() => bus.publish(state())).not.toThrow();
  });
});

describe('createBus: delivery', () => {
  it('passes a decoded state to a listener', () => {
    const { bus, ch } = fakeBus();
    const got: DisplayState[] = [];
    bus.subscribe((s) => got.push(s));
    const s = busyState();
    ch.deliver(encode(s));
    expect(got).toEqual([s]);
  });

  it('accepts a delivered object as well as a string', () => {
    const { bus, ch } = fakeBus();
    const got: DisplayState[] = [];
    bus.subscribe((s) => got.push(s));
    const s = state({ bpm: 90 });
    ch.deliver(s);
    expect(got).toEqual([s]);
    expect(got[0]).not.toBe(s);
  });

  it('drops malformed messages silently', () => {
    const { bus, ch } = fakeBus();
    const got: DisplayState[] = [];
    bus.subscribe((s) => got.push(s));
    for (const bad of ['junk', { v: 2 }, null, 7]) {
      expect(() => ch.deliver(bad), JSON.stringify(bad)).not.toThrow();
    }
    expect(got).toEqual([]);
  });

  it('delivers to every listener', () => {
    const { bus, ch } = fakeBus();
    const a: DisplayState[] = [];
    const b: DisplayState[] = [];
    bus.subscribe((s) => a.push(s));
    bus.subscribe((s) => b.push(s));
    ch.deliver(encode(state()));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('keeps going when a listener throws', () => {
    const { bus, ch } = fakeBus();
    const b: DisplayState[] = [];
    bus.subscribe(() => {
      throw new Error('bad listener');
    });
    bus.subscribe((s) => b.push(s));
    expect(() => ch.deliver(encode(state()))).not.toThrow();
    expect(b).toHaveLength(1);
  });

  it('calls a function subscribed twice once per message', () => {
    const { bus, ch } = fakeBus();
    let calls = 0;
    const fn = (): void => {
      calls += 1;
    };
    bus.subscribe(fn);
    bus.subscribe(fn);
    ch.deliver(encode(state()));
    expect(calls).toBe(1);
  });

  it('sets onmessage once and does not replace it on subscribe', () => {
    const { bus, ch } = fakeBus();
    const first = ch.onmessage;
    expect(first).not.toBeNull();
    bus.subscribe(() => {});
    expect(ch.onmessage).toBe(first);
  });
});

describe('createBus: unsubscribe', () => {
  it('stops delivery to the unsubscribed listener only', () => {
    const { bus, ch } = fakeBus();
    const a: DisplayState[] = [];
    const b: DisplayState[] = [];
    const offA = bus.subscribe((s) => a.push(s));
    bus.subscribe((s) => b.push(s));
    ch.deliver(encode(state()));
    offA();
    ch.deliver(encode(state()));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('is harmless to call twice', () => {
    const { bus, ch } = fakeBus();
    const b: DisplayState[] = [];
    const off = bus.subscribe(() => {});
    bus.subscribe((s) => b.push(s));
    off();
    expect(() => off()).not.toThrow();
    ch.deliver(encode(state()));
    expect(b).toHaveLength(1);
  });
});

describe('createBus: close', () => {
  it('closes the channel once, clears onmessage and stops publishing', () => {
    const { bus, ch } = fakeBus();
    const got: DisplayState[] = [];
    bus.subscribe((s) => got.push(s));
    bus.close();
    expect(ch.closeCalls).toBe(1);
    expect(ch.onmessage).toBeNull();
    bus.publish(state());
    expect(ch.posted).toEqual([]);
    expect(() => bus.close()).not.toThrow();
    expect(ch.closeCalls).toBe(1);
  });

  it('drops listeners on close', () => {
    const { bus, ch } = fakeBus();
    const got: DisplayState[] = [];
    bus.subscribe((s) => got.push(s));
    const handler = ch.onmessage;
    bus.close();
    handler?.({ data: encode(state()) });
    expect(got).toEqual([]);
  });

  it('does not throw when the channel close throws', () => {
    const ch = fakeChannel();
    ch.close = (): void => {
      throw new Error('already closed');
    };
    const bus = createBus(() => ch);
    expect(() => bus.close()).not.toThrow();
  });
});

describe('createBus: no channel available', () => {
  it('works as an inert object when the factory throws', () => {
    let bus: ReturnType<typeof createBus> | undefined;
    expect(() => {
      bus = createBus(() => {
        throw new Error('no channel');
      });
    }).not.toThrow();
    expect(bus).toBeDefined();
    expect(() => bus!.publish(state())).not.toThrow();
    let off: (() => void) | undefined;
    expect(() => { off = bus!.subscribe(() => {}); }).not.toThrow();
    expect(typeof off).toBe('function');
    expect(() => off!()).not.toThrow();
    expect(() => bus!.close()).not.toThrow();
    expect(() => bus!.close()).not.toThrow();
  });
});

describe('createBus: real BroadcastChannel in Node', () => {
  it('delivers between two buses and not back to the sender', async () => {
    const sender = createBus();
    const receiver = createBus();
    try {
      const own: DisplayState[] = [];
      sender.subscribe((s) => own.push(s));
      const s = busyState();
      const received = new Promise<DisplayState>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for the message')), 2000);
        receiver.subscribe((got) => {
          clearTimeout(timer);
          resolve(got);
        });
      });
      sender.publish(s);
      expect(await received).toEqual(s);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(own).toEqual([]);
    } finally {
      sender.close();
      receiver.close();
    }
  });
});

describe('decode: source fields', () => {
  it('round-trips a state with src and born, in string and object form', () => {
    const s = state({ src: 'abc-123', born: 1_700_000_000_000 });
    for (const input of [encode(s), s]) {
      const out = decode(input);
      expect(out).toEqual(s);
      expect(out?.src).toBe('abc-123');
      expect(out?.born).toBe(1_700_000_000_000);
    }
  });

  it('gives a state without them neither key', () => {
    for (const input of [encode(state()), state()]) {
      const out = decode(input) as DisplayState;
      expect(out).not.toBeNull();
      expect('src' in out).toBe(false);
      expect('born' in out).toBe(false);
    }
  });

  it('treats src and born given as undefined as absent', () => {
    const out = decode({ ...mutable(), src: undefined, born: undefined }) as DisplayState;
    expect(out).not.toBeNull();
    expect('src' in out).toBe(false);
    expect('born' in out).toBe(false);
  });

  it('rejects an invalid src or born', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ["src ''", { src: '' }],
      ['src of 65 characters', { src: 'x'.repeat(65) }],
      ['src 5', { src: 5 }],
      ['src null', { src: null }],
      ['born NaN', { born: NaN }],
      ['born Infinity', { born: Infinity }],
      ["born '5'", { born: '5' }],
      ['born null', { born: null }],
    ];
    for (const [label, patch] of bad) {
      expect(decode({ ...mutable(), ...patch }), label).toBeNull();
    }
  });

  it('accepts a src of exactly 64 characters and a born of 0 or below', () => {
    expect(decode({ ...mutable(), src: 'x'.repeat(64) })?.src).toBe('x'.repeat(64));
    expect(decode({ ...mutable(), born: 0 })?.born).toBe(0);
    expect(decode({ ...mutable(), born: -5 })?.born).toBe(-5);
  });
});
