import { describe, expect, it } from 'vitest';
import type { DisplayState } from '../../src/display/bus';
import { newSourceId, SOURCE_STALE_MS, SourceFollower } from '../../src/display/source';
import { STALE_AFTER_MS } from '../../src/display/view';
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

/** A valid display state, with overrides. */
function state(over: Partial<DisplayState> = {}): DisplayState {
  return { v: 1, t: 1000, mode: 'deck', decks: snapshot(), fx: null, bpm: null, ...over };
}

/** A state from the source `src` that started at `born`. */
function msg(src: string, born: number, t = 1000): DisplayState {
  return state({ src, born, t });
}

describe('SOURCE_STALE_MS', () => {
  it('is 3000 and equals the deck screen stale limit', () => {
    expect(SOURCE_STALE_MS).toBe(3000);
    expect(SOURCE_STALE_MS).toBe(STALE_AFTER_MS);
  });
});

describe('newSourceId', () => {
  it('uses randomUUID when there is one', () => {
    expect(newSourceId({ randomUUID: () => 'uuid-1' })).toBe('uuid-1');
  });

  it('falls back to time and a random number without crypto', () => {
    const id = newSourceId(null, () => 1_700_000_000_000, () => 0.5);
    expect(id).toBe((1_700_000_000_000).toString(36) + '-' + (0x80000000).toString(36));
  });

  it('falls back when the object has no randomUUID', () => {
    const id = newSourceId({}, () => 1_700_000_000_000, () => 0.5);
    expect(id).toBe((1_700_000_000_000).toString(36) + '-' + (0x80000000).toString(36));
  });

  it('gives a string of 1 to 64 characters with no arguments, different each time', () => {
    const a = newSourceId();
    const b = newSourceId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
  });

  it('keeps the fallback within 64 characters', () => {
    const id = newSourceId(null, () => Number.MAX_SAFE_INTEGER, () => 0.999999999);
    expect(id.length).toBeGreaterThanOrEqual(1);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('calls randomUUID as a method of the object', () => {
    const fake = {
      tag: 'me',
      randomUUID(this: { tag?: string }): string {
        if (this.tag !== 'me') throw new Error('detached call');
        return 'bound-ok';
      },
    };
    expect(newSourceId(fake)).toBe('bound-ok');
  });
});

describe('SourceFollower: one source', () => {
  it('accepts every offer and never reports a conflict', () => {
    const f = new SourceFollower();
    expect(f.followed).toBeNull();
    for (const t of [0, 100, 200, 10_000, 10_100, 100_000]) {
      expect(f.offer(msg('A', 100), t), `t ${t}`).toBe(true);
      expect(f.followed).toBe('A');
      expect(f.conflict(t), `conflict ${t}`).toBe(false);
    }
  });
});

describe('SourceFollower: a newer second source', () => {
  it('is ignored and raises a conflict that fades', () => {
    const f = new SourceFollower();
    expect(f.offer(msg('A', 100), 0)).toBe(true);
    expect(f.offer(msg('B', 200), 500)).toBe(false);
    expect(f.followed).toBe('A');
    expect(f.conflict(500)).toBe(true);
    expect(f.offer(msg('A', 100), 600)).toBe(true);
    expect(f.conflict(600)).toBe(true);
    expect(f.conflict(3500)).toBe(true);
    expect(f.conflict(3501)).toBe(false);
  });
});

describe('SourceFollower: an older second source', () => {
  it('takes over at once', () => {
    const f = new SourceFollower();
    expect(f.offer(msg('B', 200), 0)).toBe(true);
    expect(f.offer(msg('A', 100), 500)).toBe(true);
    expect(f.followed).toBe('A');
    expect(f.conflict(500)).toBe(true);
    expect(f.offer(msg('B', 200), 600)).toBe(false);
  });
});

describe('SourceFollower: take-over of a quiet source', () => {
  it('happens only after more than the stale limit', () => {
    const f = new SourceFollower();
    expect(f.offer(msg('A', 100), 0)).toBe(true);
    expect(f.offer(msg('B', 200), 100)).toBe(false);
    expect(f.offer(msg('B', 200), 3000)).toBe(false);
    expect(f.offer(msg('B', 200), 3001)).toBe(true);
    expect(f.followed).toBe('B');
    expect(f.conflict(3001)).toBe(false);
  });
});

describe('SourceFollower: a source that keeps sending', () => {
  it('stays followed against a newer one', () => {
    const f = new SourceFollower();
    for (let t = 0; t <= 10_000; t += 1000) {
      expect(f.offer(msg('A', 100), t), `A at ${t}`).toBe(true);
      if (t > 0) expect(f.conflict(t), `conflict after A at ${t}`).toBe(true);
      expect(f.offer(msg('B', 200), t + 500), `B at ${t + 500}`).toBe(false);
      expect(f.conflict(t + 500), `conflict after B at ${t + 500}`).toBe(true);
    }
    expect(f.followed).toBe('A');
  });
});

describe('SourceFollower: equal born', () => {
  it('lets the smaller src win whichever comes first', () => {
    const first = new SourceFollower();
    expect(first.offer(msg('a', 100), 0)).toBe(true);
    expect(first.offer(msg('b', 100), 10)).toBe(false);
    expect(first.followed).toBe('a');

    const second = new SourceFollower();
    expect(second.offer(msg('b', 100), 0)).toBe(true);
    expect(second.offer(msg('a', 100), 10)).toBe(true);
    expect(second.followed).toBe('a');
    expect(second.offer(msg('b', 100), 20)).toBe(false);
  });
});

describe('SourceFollower: messages without a source', () => {
  it('count as one source named empty, born 0', () => {
    const f = new SourceFollower();
    expect(f.offer(state(), 0)).toBe(true);
    expect(f.offer(state(), 10)).toBe(true);
    expect(f.followed).toBe('');
    expect(f.conflict(10)).toBe(false);
  });

  it('win against a source born at 100', () => {
    const f = new SourceFollower();
    expect(f.offer(msg('A', 100), 0)).toBe(true);
    expect(f.offer(state(), 10)).toBe(true);
    expect(f.followed).toBe('');
    expect(f.offer(msg('A', 100), 20)).toBe(false);
  });
});

describe('SourceFollower: reset', () => {
  it('forgets everything', () => {
    const f = new SourceFollower();
    f.offer(msg('A', 100), 0);
    f.offer(msg('B', 200), 10);
    expect(f.conflict(10)).toBe(true);
    f.reset();
    expect(f.followed).toBeNull();
    expect(f.conflict(10)).toBe(false);
    expect(f.offer(msg('B', 200), 20)).toBe(true);
    expect(f.followed).toBe('B');
  });
});

describe('SourceFollower: stale limit option', () => {
  it('uses the given limit', () => {
    const f = new SourceFollower(1000);
    f.offer(msg('A', 100), 0);
    expect(f.offer(msg('B', 200), 1000)).toBe(false);
    expect(f.offer(msg('B', 200), 1001)).toBe(true);
  });

  for (const bad of [Number.NaN, 0, -5]) {
    it(`treats ${bad} as 3000`, () => {
      const f = new SourceFollower(bad);
      f.offer(msg('A', 100), 0);
      expect(f.offer(msg('B', 200), 3000)).toBe(false);
      expect(f.offer(msg('B', 200), 3001)).toBe(true);
    });
  }
});

describe('SourceFollower: receiver clock', () => {
  it('going backwards does not hand over', () => {
    const f = new SourceFollower();
    f.offer(msg('A', 100), 5000);
    expect(f.offer(msg('B', 200), 100)).toBe(false);
    expect(f.followed).toBe('A');
  });
});
