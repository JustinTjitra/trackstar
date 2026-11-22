import { describe, expect, it } from 'vitest';
import { createBus, decode } from '../../src/display/bus';
import type { ChannelLike, DisplayState } from '../../src/display/bus';
import { DisplayPublisher } from '../../src/display/publisher';
import type { DisplayContent } from '../../src/display/publisher';
import type { DeckSnapshot } from '../../src/state/deckStore';
import { ACTIONS, DECKS } from '../../src/types';
import type { Deck } from '../../src/types';

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

/** A valid, brand new content object, with overrides. */
function content(over: Partial<DisplayContent> = {}): DisplayContent {
  return { mode: 'deck', decks: snapshot(), fx: null, bpm: null, ...over };
}

/** The same content with one changed value, as a new object. */
function changed(): DisplayContent {
  return content({ bpm: 128 });
}

const FX = { slot: 2, amount: 0.25, rollActive: false, releaseActive: false, bypass: false };

/** A bus that records every published state, and a clock the test sets. */
function setup(minIntervalMs?: number, heartbeatMs?: number) {
  const sent: DisplayState[] = [];
  const bus = { publish: (s: DisplayState): void => { sent.push(s); } };
  const clock = { t: 0 };
  const now = (): number => clock.t;
  const pub = new DisplayPublisher(bus, now, minIntervalMs, heartbeatMs);
  const at = (t: number, c: DisplayContent = content()): void => {
    clock.t = t;
    pub.update(c);
  };
  return { sent, at };
}

describe('DisplayPublisher: first update', () => {
  it('publishes at once with the version, the clock and the content', () => {
    const { sent, at } = setup();
    const decks = snapshot();
    decks.A.loop1.value = true;
    at(1234, content({ mode: 'fx', decks, fx: FX, bpm: 126 }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ v: 1, t: 1234, mode: 'fx', decks, fx: FX, bpm: 126 });
  });

  it('publishes at clock 0 too', () => {
    const { sent, at } = setup();
    at(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.t).toBe(0);
  });
});

describe('DisplayPublisher: heartbeat', () => {
  it('sends the same content again every second when nothing changes', () => {
    const { sent, at } = setup();
    at(0);
    for (const t of [10, 500, 999]) at(t);
    expect(sent).toHaveLength(1);
    at(1000);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.t).toBe(1000);
    expect(sent[1]).toEqual({ ...sent[0], t: 1000 });
    for (const t of [1500, 1999]) at(t);
    expect(sent).toHaveLength(2);
    at(2000);
    expect(sent).toHaveLength(3);
    expect(sent[2]?.t).toBe(2000);
  });
});

describe('DisplayPublisher: rate limit', () => {
  it('publishes a change that comes exactly at the minimum interval', () => {
    const { sent, at } = setup();
    at(0);
    at(66, changed());
    expect(sent).toHaveLength(2);
    expect(sent[1]?.t).toBe(66);
    expect(sent[1]?.bpm).toBe(128);
  });

  it('holds back a change that comes just before the minimum interval', () => {
    const { sent, at } = setup();
    at(0);
    at(65, changed());
    expect(sent).toHaveLength(1);
  });

  it('sends a held-back change on the next update once the interval has passed', () => {
    const { sent, at } = setup();
    at(0);
    at(30, changed());
    expect(sent).toHaveLength(1);
    at(70, changed());
    expect(sent).toHaveLength(2);
    expect(sent[1]?.t).toBe(70);
    expect(sent[1]?.bpm).toBe(128);
  });

  it('sends nothing extra for a change that is undone within the interval', () => {
    const { sent, at } = setup();
    at(0);
    at(20, changed());
    at(40, content());
    at(100, content());
    expect(sent).toHaveLength(1);
    at(999, content());
    expect(sent).toHaveLength(1);
    at(1000, content());
    expect(sent).toHaveLength(2);
  });

  it('sends about 15 messages a second at most, never closer than 66 ms', () => {
    const { sent, at } = setup();
    let n = 0;
    for (let t = 0; t <= 1000; t += 10) {
      n += 1;
      at(t, content({ bpm: 100 + n }));
    }
    expect(sent.length).toBeGreaterThanOrEqual(13);
    expect(sent.length).toBeLessThanOrEqual(16);
    for (let i = 1; i < sent.length; i++) {
      expect((sent[i] as DisplayState).t - (sent[i - 1] as DisplayState).t).toBeGreaterThanOrEqual(66);
    }
  });
});

describe('DisplayPublisher: deep comparison', () => {
  /** Publishes the base content at 0, then the candidate well after the interval; true when it was sent. */
  function isChange(candidate: DisplayContent, base: DisplayContent = content()): boolean {
    const { sent, at } = setup();
    at(0, base);
    at(100, candidate);
    return sent.length === 2;
  }

  it('does not count a new but equal object as a change', () => {
    expect(isChange(content())).toBe(false);
    expect(isChange(content({ fx: { ...FX }, bpm: 120 }), content({ fx: { ...FX }, bpm: 120 }))).toBe(false);
  });

  it('counts one changed control as a change', () => {
    const decks = snapshot();
    decks.B[ACTIONS[0]!].value = true;
    expect(isChange(content({ decks }))).toBe(true);
  });

  it('counts a changed control flag in deck A as a change', () => {
    const decks = snapshot();
    decks.A[ACTIONS[ACTIONS.length - 1]!].pending = true;
    expect(isChange(content({ decks }))).toBe(true);
  });

  it('counts fx going from null to an object as a change', () => {
    expect(isChange(content({ fx: FX }))).toBe(true);
  });

  it('counts a change inside fx as a change', () => {
    expect(isChange(content({ fx: { ...FX, amount: 0.5 } }), content({ fx: FX }))).toBe(true);
  });

  it('counts bpm as a change', () => {
    expect(isChange(content({ bpm: 120 }))).toBe(true);
  });

  it('counts mode as a change', () => {
    expect(isChange(content({ mode: 'fx' }))).toBe(true);
  });

  it('compares by value even when the very same object is mutated and passed again', () => {
    const { sent, at } = setup();
    const c = content();
    at(0, c);
    c.bpm = 140;
    at(100, c);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.bpm).toBe(null);
    expect(sent[1]?.bpm).toBe(140);
  });
});

describe('DisplayPublisher: what is sent', () => {
  it('sends only the known fields', () => {
    const { sent, at } = setup();
    at(5, { ...content(), extra: 'x', t: 99, v: 7 } as unknown as DisplayContent);
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0] as object).sort()).toEqual(['bpm', 'decks', 'fx', 'mode', 't', 'v']);
    expect(sent[0]?.v).toBe(1);
    expect(sent[0]?.t).toBe(5);
  });
});

describe('DisplayPublisher: clock', () => {
  it('does not get stuck when the clock goes backwards', () => {
    const { sent, at } = setup();
    at(5000);
    at(100, changed());
    expect(sent).toHaveLength(2);
    expect(sent[1]?.t).toBe(100);
  });

  it('sends a heartbeat at once after the clock goes backwards', () => {
    const { sent, at } = setup();
    at(5000);
    at(100);
    expect(sent).toHaveLength(2);
  });
});

describe('DisplayPublisher: custom intervals', () => {
  it('uses the given minimum interval', () => {
    const { sent, at } = setup(200, 5000);
    at(0);
    at(150, changed());
    expect(sent).toHaveLength(1);
    at(199, changed());
    expect(sent).toHaveLength(1);
    at(200, changed());
    expect(sent).toHaveLength(2);
    expect(sent[1]?.t).toBe(200);
  });

  it('uses the given heartbeat', () => {
    const { sent, at } = setup(200, 5000);
    at(0);
    at(1000);
    at(4999);
    expect(sent).toHaveLength(1);
    at(5000);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.t).toBe(5000);
  });
});

describe('DisplayPublisher: option sanitising', () => {
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    it(`treats a minimum interval of ${bad} as 66`, () => {
      const held = setup(bad);
      held.at(0);
      held.at(65, changed());
      expect(held.sent).toHaveLength(1);
      held.at(66, changed());
      expect(held.sent).toHaveLength(2);
    });
  }

  for (const bad of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
    it(`treats a heartbeat of ${bad} as 1000`, () => {
      const { sent, at } = setup(undefined, bad);
      at(0);
      at(999);
      expect(sent).toHaveLength(1);
      at(1000);
      expect(sent).toHaveLength(2);
    });
  }

  it('allows a minimum interval of 0: every change publishes, even at the same clock value', () => {
    const { sent, at } = setup(0);
    at(10, content({ bpm: 100 }));
    at(10, content({ bpm: 101 }));
    at(10, content({ bpm: 102 }));
    expect(sent).toHaveLength(3);
  });
});

describe('DisplayPublisher: with the real bus', () => {
  it('posts one string that decodes to a state with the right time', () => {
    const posted: unknown[] = [];
    const channel: ChannelLike = {
      postMessage(data: unknown): void {
        posted.push(data);
      },
      onmessage: null,
      close(): void {},
    };
    const pub = new DisplayPublisher(createBus(() => channel), () => 4321);
    pub.update(content({ bpm: 124 }));
    expect(posted).toHaveLength(1);
    expect(typeof posted[0]).toBe('string');
    const state = decode(posted[0]);
    expect(state).not.toBeNull();
    expect(state?.t).toBe(4321);
    expect(state?.bpm).toBe(124);
    expect(state?.mode).toBe('deck');
  });
});
