import { describe, expect, it } from 'vitest';
import { actionLabel, chipClasses, firedLabel } from '../src/ui/labels';
import type { ControlView } from '../src/state/deckStore';

const view = (v: Partial<ControlView>): ControlView => ({ value: null, pending: false, unconfirmed: false, blind: false, ...v });

describe('labels', () => {
  it('names actions the way the console does', () => {
    expect(actionLabel('loop1')).toBe('LOOP 1');
    expect(actionLabel('loop4')).toBe('LOOP 4');
    expect(actionLabel('inst')).toBe('INST');
  });

  it('describes the confirmed result after firing', () => {
    expect(firedLabel('loop2', view({ value: true }), true)).toBe('LOOP 2 ON');
    expect(firedLabel('loop2', view({ value: false }), true)).toBe('LOOP 2 OFF');
    expect(firedLabel('drums', view({ value: true }), true)).toBe('DRUMS MUTED');
    expect(firedLabel('drums', view({ value: false }), true)).toBe('DRUMS ON');
  });

  it('shows the plain action while waiting, and problems when they happen', () => {
    expect(firedLabel('loop2', view({ pending: true, value: false }), true)).toBe('LOOP 2');
    expect(firedLabel('loop2', view({ unconfirmed: true }), true)).toBe('NO REPLY');
    expect(firedLabel('loop2', view({}), false)).toBe('NO MIDI');
  });

  it('maps loop control states to chip classes', () => {
    expect(chipClasses('loop1', view({}))).toBe('chip unknown');
    expect(chipClasses('loop1', view({ value: false }))).toBe('chip');
    expect(chipClasses('loop1', view({ value: true }))).toBe('chip on');
    expect(chipClasses('loop1', view({ value: true, pending: true }))).toBe('chip pending');
    expect(chipClasses('loop1', view({ value: true, unconfirmed: true }))).toBe('chip unconfirmed');
    expect(chipClasses('loop1', view({ value: true, blind: true }))).toBe('chip on blind');
  });

  it('lights stems while audible and strikes them through when muted', () => {
    expect(chipClasses('vocals', view({ value: false }))).toBe('chip on');
    expect(chipClasses('vocals', view({ value: true }))).toBe('chip muted');
    expect(chipClasses('vocals', view({}))).toBe('chip unknown');
  });
});
