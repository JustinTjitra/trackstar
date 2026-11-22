import { describe, expect, it } from 'vitest';
import type { DisplayState } from '../../src/display/bus';
import { escapeHtml, renderHtml, rootClass } from '../../src/display/render';
import { buildView, WAITING_HINT } from '../../src/display/view';
import type { DisplayView } from '../../src/display/view';
import type { ControlView, DeckSnapshot } from '../../src/state/deckStore';
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

function withControl(decks: DeckSnapshot, deck: Deck, action: Action, c: Partial<ControlView>): void {
  decks[deck][action] = { ...decks[deck][action], ...c };
}

function live(over: Partial<DisplayState> = {}): DisplayView {
  return buildView(state(over), T + 100, 1280, 720);
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

function pos(html: string, deck: Deck, action: Action): number {
  return html.indexOf(`data-deck="${deck}" data-action="${action}"`);
}

const ORDER: Action[] = ['loop1', 'loop2', 'loop4', 'drums', 'vocals', 'inst'];

describe('renderHtml: waiting', () => {
  it('shows the brand, clock, message and hint and nothing else', () => {
    const html = renderHtml(buildView(null, 0, 1280, 720), '09:05');
    expect(html).toContain('<span class="d-brand">TRACKSTAR</span>');
    expect(html).toContain('<span class="d-clock">09:05</span>');
    expect(html).toContain('<p class="d-message">Waiting for Trackstar</p>');
    expect(html).toContain('<p class="d-hint">' + WAITING_HINT + '</p>');
    for (const part of ['d-decks', 'd-mode', 'd-bpm', 'd-fx', 'class="chip']) expect(html).not.toContain(part);
  });
});

describe('renderHtml: live', () => {
  it('renders 12 chips in order with the classes of the view', () => {
    const html = renderHtml(live(), '09:05');
    expect(count(html, 'class="chip ')).toBe(12);
    expect(count(html, 'class="chip unknown"')).toBe(12);
    const positions = [...ORDER.map((a) => pos(html, 'A', a)), ...ORDER.map((a) => pos(html, 'B', a))];
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('writes the control states into the chip classes', () => {
    const decks = snapshot();
    withControl(decks, 'A', 'loop2', { value: true });
    withControl(decks, 'B', 'drums', { value: true });
    withControl(decks, 'B', 'loop1', { pending: true });
    const html = renderHtml(live({ decks }), '09:05');
    expect(html).toContain('class="chip on" data-deck="A" data-action="loop2"');
    expect(html).toContain('class="chip muted" data-deck="B" data-action="drums"');
    expect(html).toContain('class="chip pending" data-deck="B" data-action="loop1"');
  });

  it('shows labels, titles and deck colours, and no message or hint', () => {
    const html = renderHtml(live(), '09:05');
    for (const label of ['1B', '2B', '4B', 'DRUMS', 'VOCALS', 'INST']) expect(count(html, '>' + label + '</span>')).toBe(2);
    expect(html).toContain('<i></i>DECK A</div>');
    expect(html).toContain('<i></i>DECK B</div>');
    expect(html).toContain('data-deck="A" style="--c:#5ab0ff"');
    expect(html).toContain('data-deck="B" style="--c:#ff7a90"');
    expect(count(html, 'class="d-deck"')).toBe(2);
    expect(html).not.toContain('d-message');
    expect(html).not.toContain('d-hint');
  });

  it('puts loops before stems in each deck and deck A before deck B', () => {
    const html = renderHtml(live(), '09:05');
    const a = html.indexOf('class="d-deck" data-deck="A"');
    const b = html.indexOf('class="d-deck" data-deck="B"');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const loopA = html.indexOf('>LOOP<', a);
    const stemA = html.indexOf('>STEMS<', a);
    expect(loopA).toBeGreaterThan(a);
    expect(stemA).toBeGreaterThan(loopA);
    expect(stemA).toBeLessThan(b);
  });
});

describe('renderHtml: header', () => {
  it('shows the mode', () => {
    expect(renderHtml(live(), 'x')).toContain('<span class="d-mode">DECK</span>');
    expect(renderHtml(live({ mode: 'fx' }), 'x')).toContain('<span class="d-mode">FX</span>');
  });

  it('shows the tempo or a placeholder', () => {
    expect(renderHtml(live({ bpm: 124 }), 'x')).toContain('<span class="d-bpm"><b>124.0</b> BPM</span>');
    expect(renderHtml(live({ bpm: null }), 'x')).toContain('<span class="d-bpm"><b>--</b> BPM</span>');
  });

  it('shows the given clock', () => {
    expect(renderHtml(live(), '23:59')).toContain('<span class="d-clock">23:59</span>');
  });
});

describe('renderHtml: stale', () => {
  it('keeps the panels and adds the message', () => {
    const view = buildView(state(), T + 5000, 1280, 720);
    const html = renderHtml(view, '09:05');
    expect(html).toContain('<p class="d-message">Trackstar stopped sending 5 s ago</p>');
    expect(count(html, 'class="chip ')).toBe(12);
    expect(count(html, 'class="d-deck"')).toBe(2);
  });
});

describe('renderHtml: effects line', () => {
  it('shows slot, direction, amount and flags', () => {
    const fx = { slot: 2, amount: -0.4, rollActive: true, releaseActive: false, bypass: true };
    const html = renderHtml(live({ fx }), 'x');
    expect(html).toContain('<footer class="d-fx">');
    expect(html).toContain('<span class="d-fx-slot">FX 3</span>');
    expect(html).toContain('<span class="d-fx-dir">DOWN</span>');
    expect(html).toContain('<span class="d-fx-amt">40%</span>');
    expect(html).toContain('<span class="d-flag on">ROLL</span>');
    expect(html).toContain('<span class="d-flag">RELEASE</span>');
    expect(html).toContain('<span class="d-flag on">BYPASS</span>');
  });

  it('shows UP for a positive amount', () => {
    const fx = { slot: 0, amount: 0.7, rollActive: false, releaseActive: true, bypass: false };
    const html = renderHtml(live({ fx }), 'x');
    expect(html).toContain('<span class="d-fx-dir">UP</span>');
    expect(html).toContain('<span class="d-fx-amt">70%</span>');
    expect(html).toContain('<span class="d-flag">ROLL</span>');
    expect(html).toContain('<span class="d-flag on">RELEASE</span>');
    expect(html).toContain('<span class="d-flag">BYPASS</span>');
  });

  it('shows OFF at zero and nothing without fx', () => {
    const fx = { slot: 0, amount: 0, rollActive: false, releaseActive: false, bypass: false };
    const html = renderHtml(live({ fx }), 'x');
    expect(html).toContain('<span class="d-fx-dir">OFF</span>');
    expect(html).toContain('<span class="d-fx-amt">0%</span>');
    expect(renderHtml(live(), 'x')).not.toContain('d-fx');
  });
});

describe('escaping', () => {
  it('escapes every text and attribute written into the page', () => {
    const view = live();
    view.message = '<b>hi</b>';
    view.decks[0].loops[0].label = '<script>alert(1)</script>';
    view.decks[0].title = 'A & "B"';
    view.decks[1].stems[2].classes = 'chip" onclick="x';
    view.decks[1].stems[1].action = 'a"b' as Action;
    const html = renderHtml(view, '<i>');
    for (const bad of ['<script>', '<b>hi</b>', 'onclick="x', 'data-action="a"b"']) expect(html).not.toContain(bad);
    // the only <i> elements are the two deck title markers; the clock text must not add a third
    expect(count(html, '<i>')).toBe(2);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; &quot;B&quot;');
    expect(html).toContain('chip&quot; onclick=&quot;x');
    expect(html).toContain('data-action="a&quot;b"');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).toContain('<span class="d-clock">&lt;i&gt;</span>');
  });

  it('escapeHtml handles all five characters, ampersand first', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(escapeHtml('plain')).toBe('plain');
  });
});

describe('deck colour check', () => {
  function deckTag(color: string): string {
    const view = live();
    view.decks[0].color = color;
    const html = renderHtml(view, 'x');
    const start = html.indexOf('<div class="d-deck" data-deck="A"');
    return html.slice(start, html.indexOf('>', start) + 1);
  }

  it('leaves out the style for anything but a hex colour', () => {
    for (const bad of ['red; background:url(x)', '#12', '', '#123456789', '#12g']) {
      const tag = deckTag(bad);
      expect(tag).toBe('<div class="d-deck" data-deck="A">');
      expect(tag).not.toContain('style');
    }
  });

  it('writes valid hex colours', () => {
    expect(deckTag('#abc')).toContain('style="--c:#abc"');
    expect(deckTag('#A1B2C3D4')).toContain('style="--c:#A1B2C3D4"');
  });
});

describe('rootClass', () => {
  it('combines layout and status', () => {
    expect(rootClass(buildView(null, 0, 1280, 720))).toBe('d-root d-standard d-waiting');
    expect(rootClass(buildView(state(), T, 1920, 480))).toBe('d-root d-wide d-live');
    expect(rootClass(buildView(state(), T + 5000, 1280, 720))).toBe('d-root d-standard d-stale');
  });
});

describe('stable output', () => {
  it('is the same for the same input and differs when something changes', () => {
    const a = renderHtml(live(), '09:05');
    expect(renderHtml(live(), '09:05')).toBe(a);
    expect(renderHtml(live(), '09:06')).not.toBe(a);
    const decks = snapshot();
    withControl(decks, 'A', 'inst', { value: true });
    expect(renderHtml(live({ decks }), '09:05')).not.toBe(a);
  });
});
