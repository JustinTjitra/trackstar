import { ACTIONS, DECKS, type Action, type Deck } from '../types';

export interface MidiMapping {
  /** 0-based MIDI channel the app sends commands on. */
  cmdChannel: Record<Deck, number>;
  /** 0-based MIDI channel rekordbox's MIDI OUT sends feedback on. */
  fbChannel: Record<Deck, number>;
  notes: Record<Action, number>;
  /** Flip feedback for controls whose rekordbox light means the opposite. */
  invert: Partial<Record<Action, boolean>>;
}

/** Commands on channels 1/2, feedback on 3/4 (shown 1-based in rekordbox). */
export const DEFAULT_MAPPING: MidiMapping = {
  cmdChannel: { A: 0, B: 1 },
  fbChannel: { A: 2, B: 3 },
  notes: { loop1: 62, loop2: 63, loop4: 65, drums: 70, vocals: 71, inst: 72 },
  invert: {},
};

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

export function pressMessages(m: MidiMapping, deck: Deck, action: Action): { on: number[]; off: number[] } {
  const ch = m.cmdChannel[deck];
  const note = m.notes[action];
  return { on: [NOTE_ON | ch, note, 127], off: [NOTE_OFF | ch, note, 0] };
}

export interface Feedback {
  deck: Deck;
  action: Action;
  on: boolean;
}

/** Parses rekordbox MIDI OUT. Anything not on a feedback channel is ignored. */
export function parseFeedback(m: MidiMapping, data: ArrayLike<number>): Feedback | null {
  if (data.length < 3) return null;
  const type = data[0] & 0xf0;
  if (type !== NOTE_ON && type !== NOTE_OFF) return null;
  const channel = data[0] & 0x0f;
  const deck = DECKS.find((d) => m.fbChannel[d] === channel);
  if (!deck) return null;
  const action = ACTIONS.find((a) => m.notes[a] === data[1]);
  if (!action) return null;
  const lit = type === NOTE_ON && data[2] > 0;
  return { deck, action, on: m.invert[action] ? !lit : lit };
}
