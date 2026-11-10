import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPING, parseFeedback, pressMessages } from '../src/midi/mapping';
import { ACTIONS } from '../src/types';

const NOTES = { loop1: 62, loop2: 63, loop4: 65, drums: 70, vocals: 71, inst: 72 } as const;

describe('pressMessages', () => {
  it.each(ACTIONS)('sends %s as note on/off on channel 1 for deck A and 2 for deck B', (action) => {
    expect(pressMessages(DEFAULT_MAPPING, 'A', action)).toEqual({ on: [0x90, NOTES[action], 127], off: [0x80, NOTES[action], 0] });
    expect(pressMessages(DEFAULT_MAPPING, 'B', action)).toEqual({ on: [0x91, NOTES[action], 127], off: [0x81, NOTES[action], 0] });
  });
});

describe('parseFeedback', () => {
  it('reads note on with velocity as on, on channel 3 for deck A and 4 for deck B', () => {
    expect(parseFeedback(DEFAULT_MAPPING, [0x92, 63, 127])).toEqual({ deck: 'A', action: 'loop2', on: true });
    expect(parseFeedback(DEFAULT_MAPPING, [0x93, 70, 1])).toEqual({ deck: 'B', action: 'drums', on: true });
  });

  it('reads note on with velocity 0 and note off as off', () => {
    expect(parseFeedback(DEFAULT_MAPPING, [0x92, 62, 0])).toEqual({ deck: 'A', action: 'loop1', on: false });
    expect(parseFeedback(DEFAULT_MAPPING, [0x83, 72, 64])).toEqual({ deck: 'B', action: 'inst', on: false });
  });

  it('ignores the command channels so the app never hears its own commands as confirmation', () => {
    expect(parseFeedback(DEFAULT_MAPPING, [0x90, 63, 127])).toBeNull();
    expect(parseFeedback(DEFAULT_MAPPING, [0x81, 63, 0])).toBeNull();
  });

  it('ignores unknown notes, other message types and short messages', () => {
    expect(parseFeedback(DEFAULT_MAPPING, [0x92, 10, 127])).toBeNull();
    expect(parseFeedback(DEFAULT_MAPPING, [0xb2, 63, 127])).toBeNull();
    expect(parseFeedback(DEFAULT_MAPPING, [0x92, 63])).toBeNull();
    expect(parseFeedback(DEFAULT_MAPPING, [])).toBeNull();
  });

  it('applies the per-control invert flag', () => {
    const m = { ...DEFAULT_MAPPING, invert: { vocals: true } };
    expect(parseFeedback(m, [0x92, 71, 127])).toEqual({ deck: 'A', action: 'vocals', on: false });
    expect(parseFeedback(m, [0x92, 71, 0])).toEqual({ deck: 'A', action: 'vocals', on: true });
  });
});
