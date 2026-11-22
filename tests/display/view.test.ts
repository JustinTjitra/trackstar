import { describe, expect, it } from 'vitest';
import type { DisplayState } from '../../src/display/bus';
import { buildView, formatClock, STALE_AFTER_MS, WAITING_HINT, WAITING_MESSAGE } from '../../src/display/view';
import type { DisplayView } from '../../src/display/view';
import viewSource from '../../src/display/view.ts?raw';
import type { ControlView, DeckSnapshot } from '../../src/state/deckStore';
import { chipClasses } from '../../src/ui/labels';
import { DECK_COLOR } from '../../src/ui/colors';
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
  return { v: 1, t: 10_000, mode: 'deck', decks: snapshot(), fx: null, bpm: null, ...over };
}

const T = 10_000;

function chip(view: DisplayView, deck: Deck, action: Action): string {
  const panel = view.decks.find((p) => p.deck === deck);
  const found = [...(panel?.loops ?? []), ...(panel?.stems ?? [])].find((c) => c.action === action);
  if (!found) throw new Error('chip not found');
  return found.classes;
}

function withControl(deck: Deck, action: Action, c: Partial<ControlView>): DisplayState {
  const decks = snapshot();
  decks[deck][action] = { ...decks[deck][action], ...c };
  return state({ decks });
}

describe('buildView: waiting', () => {
  it('describes the waiting screen exactly', () => {
    expect(buildView(null, 123, 1280, 720)).toEqual({
      layout: 'standard',
      status: 'waiting',
      message: 'Waiting for Trackstar',
      hint: 'Open the Trackstar app in another tab of this browser.',
      mode: null,
      bpm: null,
      decks: [],
      fx: null,
    });
    expect(WAITING_MESSAGE).toBe('Waiting for Trackstar');
    expect(WAITING_HINT).toBe('Open the Trackstar app in another tab of this browser.');
  });
});

describe('buildView: live', () => {
  it('shows both panels in order with labelled chips', () => {
    const v = buildView(state(), T + 500, 1280, 720);
    expect(v.status).toBe('live');
    expect(v.message).toBeNull();
    expect(v.hint).toBeNull();
    expect(v.mode).toBe('DECK');
    expect(v.decks.map((d) => d.title)).toEqual(['DECK A', 'DECK B']);
    expect(v.decks.map((d) => d.deck)).toEqual(['A', 'B']);
    expect(v.decks[0].color).toBe(DECK_COLOR.A);
    expect(v.decks[1].color).toBe(DECK_COLOR.B);
    for (const p of v.decks) {
      expect(p.loops.map((c) => c.label)).toEqual(['1B', '2B', '4B']);
      expect(p.loops.map((c) => c.action)).toEqual(['loop1', 'loop2', 'loop4']);
      expect(p.stems.map((c) => c.label)).toEqual(['DRUMS', 'VOCALS', 'INST']);
      expect(p.stems.map((c) => c.action)).toEqual(['drums', 'vocals', 'inst']);
      for (const c of [...p.loops, ...p.stems]) expect(c.classes).toBe('chip unknown');
    }
  });
});

describe('buildView: chips match the main console', () => {
  it('uses chipClasses for every control state', () => {
    const decks = snapshot();
    decks.A.loop1 = { value: true, pending: false, unconfirmed: false, blind: false };
    decks.A.loop2 = { value: true, pending: true, unconfirmed: false, blind: false };
    decks.A.loop4 = { value: false, pending: false, unconfirmed: true, blind: false };
    decks.A.drums = { value: true, pending: false, unconfirmed: false, blind: false };
    decks.A.vocals = { value: false, pending: false, unconfirmed: false, blind: false };
    decks.A.inst = { value: null, pending: false, unconfirmed: false, blind: true };
    decks.B.loop1 = { value: false, pending: false, unconfirmed: false, blind: false };
    decks.B.drums = { value: true, pending: false, unconfirmed: false, blind: true };
    const v = buildView(state({ decks }), T, 1280, 720);
    for (const d of DECKS) {
      for (const a of ACTIONS) expect(chip(v, d, a)).toBe(chipClasses(a, decks[d][a]));
    }
    expect(chip(v, 'A', 'loop1')).toBe('chip on');
    expect(chip(v, 'A', 'drums')).toBe('chip muted');
    expect(chip(v, 'A', 'vocals')).toBe('chip on');
    expect(chip(v, 'A', 'loop2')).toBe('chip pending');
    expect(chip(v, 'A', 'loop4')).toBe('chip unconfirmed');
    expect(chip(v, 'A', 'inst')).toBe('chip unknown blind');
    expect(chip(v, 'B', 'drums')).toBe('chip muted blind');
  });

  it('takes deck B chips from deck B controls only', () => {
    const base = buildView(state(), T, 1280, 720);
    const v = buildView(withControl('B', 'loop1', { value: true }), T, 1280, 720);
    expect(chip(v, 'B', 'loop1')).toBe('chip on');
    expect(chip(v, 'A', 'loop1')).toBe(chip(base, 'A', 'loop1'));
    expect(chip(v, 'A', 'loop1')).toBe('chip unknown');
    const w = buildView(withControl('A', 'drums', { value: true }), T, 1280, 720);
    expect(chip(w, 'A', 'drums')).toBe('chip muted');
    expect(chip(w, 'B', 'drums')).toBe('chip unknown');
  });
});

describe('buildView: stale', () => {
  it('is live at exactly 3000 ms and stale after', () => {
    expect(STALE_AFTER_MS).toBe(3000);
    const live = buildView(state(), T + 3000, 1280, 720);
    expect(live.status).toBe('live');
    expect(live.message).toBeNull();
    const stale = buildView(state(), T + 3001, 1280, 720);
    expect(stale.status).toBe('stale');
    expect(stale.message).toBe('Trackstar stopped sending 3 s ago');
    expect(buildView(state(), T + 65_400, 1280, 720).message).toBe('Trackstar stopped sending 65 s ago');
    expect(buildView(state(), T + 65_999, 1280, 720).message).toBe('Trackstar stopped sending 65 s ago');
  });

  it('still shows the panels and chips', () => {
    const s = withControl('B', 'vocals', { value: true });
    const v = buildView(s, T + 9000, 1280, 720);
    expect(v.status).toBe('stale');
    expect(v.hint).toBeNull();
    expect(v.decks).toHaveLength(2);
    expect(v.decks[0].loops).toHaveLength(3);
    expect(v.decks[1].stems).toHaveLength(3);
    expect(chip(v, 'B', 'vocals')).toBe('chip muted');
    expect(chip(v, 'A', 'vocals')).toBe('chip unknown');
    expect(v.mode).toBe('DECK');
  });
});

describe('buildView: clock disagreement', () => {
  it('treats a negative or non-finite age as zero', () => {
    const early = buildView(state(), T - 5000, 1280, 720);
    expect(early.status).toBe('live');
    expect(early.message).toBeNull();
    const nan = buildView(state(), NaN, 1280, 720);
    expect(nan.status).toBe('live');
    expect(nan.message).toBeNull();
    expect(buildView(state(), Infinity, 1280, 720).status).toBe('live');
  });
});

describe('buildView: layout', () => {
  const layoutOf = (w: number, h: number): string => buildView(state(), T, w, h).layout;

  it('is wide from 3:1', () => {
    expect(layoutOf(1920, 480)).toBe('wide');
    expect(layoutOf(1440, 480)).toBe('wide');
    expect(layoutOf(1439, 480)).toBe('standard');
    expect(layoutOf(1280, 720)).toBe('standard');
    expect(layoutOf(720, 1280)).toBe('standard');
  });

  it('is standard for unusable sizes', () => {
    for (const [w, h] of [
      [0, 480],
      [1920, 0],
      [-1920, 480],
      [1920, -480],
      [NaN, 480],
      [1920, NaN],
      [Infinity, 480],
      [1920, Infinity],
    ]) {
      expect(layoutOf(w, h)).toBe('standard');
    }
  });

  it('is reported while waiting', () => {
    expect(buildView(null, 0, 1920, 480).layout).toBe('wide');
    expect(buildView(null, 0, 1280, 720).layout).toBe('standard');
  });
});

describe('buildView: mode and tempo', () => {
  it('maps the mode', () => {
    expect(buildView(state({ mode: 'fx' }), T, 1280, 720).mode).toBe('FX');
    expect(buildView(state({ mode: 'deck' }), T, 1280, 720).mode).toBe('DECK');
  });

  it('formats the tempo with one decimal', () => {
    const bpm = (n: number | null): string | null => buildView(state({ bpm: n }), T, 1280, 720).bpm;
    expect(bpm(124)).toBe('124.0');
    expect(bpm(127.96)).toBe('128.0');
    expect(bpm(99.94)).toBe('99.9');
    expect(bpm(null)).toBeNull();
  });
});

describe('buildView: effects summary', () => {
  const fxOf = (over: Partial<NonNullable<DisplayState['fx']>>): DisplayView['fx'] =>
    buildView(
      state({ fx: { slot: 0, amount: 0.7, rollActive: false, releaseActive: false, bypass: false, ...over } }),
      T,
      1280,
      720,
    ).fx;

  it('describes a positive amount', () => {
    expect(fxOf({})).toEqual({
      slotLabel: 'FX 1',
      direction: 'up',
      amountPercent: 70,
      roll: false,
      release: false,
      bypass: false,
    });
  });

  it('describes a negative amount and rounds', () => {
    const fx = fxOf({ slot: 4, amount: -0.255 });
    expect(fx?.slotLabel).toBe('FX 5');
    expect(fx?.direction).toBe('down');
    expect(fx?.amountPercent).toBe(26);
  });

  it('describes zero', () => {
    const fx = fxOf({ amount: 0 });
    expect(fx?.direction).toBe('off');
    expect(fx?.amountPercent).toBe(0);
  });

  it('clamps to 100', () => {
    expect(fxOf({ amount: 1.7 })?.amountPercent).toBe(100);
    expect(fxOf({ amount: -3 })?.amountPercent).toBe(100);
  });

  it('copies the flags', () => {
    expect(fxOf({ rollActive: true })).toMatchObject({ roll: true, release: false, bypass: false });
    expect(fxOf({ releaseActive: true })).toMatchObject({ roll: false, release: true, bypass: false });
    expect(fxOf({ bypass: true })).toMatchObject({ roll: false, release: false, bypass: true });
  });

  it('is null without effects', () => {
    expect(buildView(state({ fx: null }), T, 1280, 720).fx).toBeNull();
  });
});

describe('buildView: purity', () => {
  it('does not change the input', () => {
    const s = state({
      mode: 'fx',
      bpm: 120,
      fx: { slot: 1, amount: -0.4, rollActive: true, releaseActive: false, bypass: true },
      decks: withControl('A', 'loop1', { value: true, pending: true }).decks,
    });
    const copy = structuredClone(s);
    buildView(s, T + 9000, 1920, 480);
    expect(s).toEqual(copy);
  });

  it('returns equal but distinct results', () => {
    const s = state({ fx: { slot: 1, amount: 0.5, rollActive: false, releaseActive: false, bypass: false } });
    const a = buildView(s, T, 1280, 720);
    const b = buildView(s, T, 1280, 720);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.decks).not.toBe(b.decks);
    expect(a.decks[0]).not.toBe(b.decks[0]);
    expect(a.decks[0].loops).not.toBe(b.decks[0].loops);
    expect(a.decks[0].loops[0]).not.toBe(b.decks[0].loops[0]);
    expect(a.fx).not.toBe(b.fx);
    const w1 = buildView(null, 0, 1, 1);
    const w2 = buildView(null, 0, 1, 1);
    expect(w1.decks).not.toBe(w2.decks);
  });

  it('keeps the source free of clocks and the DOM', () => {
    const src: string = viewSource;
    expect(src.length).toBeGreaterThan(500);
    for (const word of ['document', 'window', 'Date.now', 'new Date']) {
      expect(src.includes(word), word).toBe(false);
    }
  });
});

describe('formatClock', () => {
  it('pads hours and minutes to two digits', () => {
    expect(formatClock(new Date(2026, 0, 5, 9, 5))).toBe('09:05');
    expect(formatClock(new Date(2026, 0, 5, 0, 0))).toBe('00:00');
    expect(formatClock(new Date(2026, 0, 5, 23, 59))).toBe('23:59');
  });

  it('gives placeholders for an invalid date', () => {
    expect(formatClock(new Date(NaN))).toBe('--:--');
  });
});
