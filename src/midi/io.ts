import type { Action, Deck } from '../types';
import { parseFeedback, pressMessages, type Feedback, type MidiMapping } from './mapping';

/* Structural subsets of the Web MIDI types, so tests can supply fakes. */
export interface MidiOutputLike {
  name: string | null;
  state: string;
  send(data: number[], timestamp?: number): void;
}

export interface MidiInputLike {
  name: string | null;
  state: string;
  onmidimessage: ((e: { data: Uint8Array | null }) => void) | null;
}

export interface MidiAccessLike {
  outputs: { values(): Iterable<MidiOutputLike> };
  inputs: { values(): Iterable<MidiInputLike> };
  onstatechange: ((e: unknown) => void) | null;
}

export interface MidiStatus {
  outName: string | null;
  inName: string | null;
  outConnected: boolean;
  inConnected: boolean;
  /** True once any valid feedback message has arrived. Tells the user MIDI OUT is mapped. */
  feedbackSeen: boolean;
}

const RELEASE_MS = 10;

/** Asks the browser for MIDI access. Returns null when unsupported or denied. */
export async function requestMidi(): Promise<MidiAccessLike | null> {
  if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) return null;
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    return access as unknown as MidiAccessLike;
  } catch {
    return null;
  }
}

export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

export class MidiIO {
  private mapping: MidiMapping;
  private outName: string | null = null;
  private inName: string | null = null; // null = same name as the output
  private feedbackEnabled = true;
  private output: MidiOutputLike | null = null;
  private input: MidiInputLike | null = null;
  private feedbackSeen = false;
  private feedbackFns = new Set<(f: Feedback) => void>();
  private statusFns = new Set<(s: MidiStatus) => void>();

  constructor(
    private readonly access: MidiAccessLike,
    mapping: MidiMapping,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.mapping = mapping;
    access.onstatechange = () => this.resolve();
  }

  outputs(): string[] {
    return [...this.access.outputs.values()].map((p) => p.name ?? '').filter(Boolean);
  }

  inputs(): string[] {
    return [...this.access.inputs.values()].map((p) => p.name ?? '').filter(Boolean);
  }

  /** Choose ports by name. `inName` null means the input with the same name as the output. */
  select(outName: string | null, inName: string | null): void {
    this.outName = outName;
    this.inName = inName;
    this.resolve();
  }

  setFeedbackEnabled(enabled: boolean): void {
    this.feedbackEnabled = enabled;
    this.resolve();
  }

  setMapping(mapping: MidiMapping): void {
    this.mapping = mapping;
  }

  send(deck: Deck, action: Action): boolean {
    if (!this.output || this.output.state !== 'connected') return false;
    const { on, off } = pressMessages(this.mapping, deck, action);
    try {
      this.output.send(on);
      this.output.send(off, this.now() + RELEASE_MS);
      return true;
    } catch {
      return false;
    }
  }

  onFeedback(fn: (f: Feedback) => void): () => void {
    this.feedbackFns.add(fn);
    return () => this.feedbackFns.delete(fn);
  }

  onStatus(fn: (s: MidiStatus) => void): () => void {
    this.statusFns.add(fn);
    return () => this.statusFns.delete(fn);
  }

  status(): MidiStatus {
    const wantIn = this.wantedInputName();
    return {
      outName: this.outName,
      inName: wantIn,
      outConnected: !!this.output && this.output.state === 'connected',
      inConnected: !!this.input && this.input.state === 'connected',
      feedbackSeen: this.feedbackSeen,
    };
  }

  private wantedInputName(): string | null {
    if (!this.feedbackEnabled) return null;
    return this.inName ?? this.outName;
  }

  /** Re-find ports by name. Runs on selection changes and whenever devices come and go. */
  private resolve(): void {
    this.output = this.outName ? this.find(this.access.outputs.values(), this.outName) : null;

    const wantIn = this.wantedInputName();
    const nextInput = wantIn ? this.find(this.access.inputs.values(), wantIn) : null;
    if (nextInput !== this.input) {
      if (this.input) this.input.onmidimessage = null;
      this.input = nextInput;
      if (this.input) this.input.onmidimessage = (e) => this.handleMessage(e.data);
    }
    this.emitStatus();
  }

  private find<T extends { name: string | null; state: string }>(ports: Iterable<T>, name: string): T | null {
    for (const p of ports) if (p.name === name && p.state === 'connected') return p;
    return null;
  }

  private handleMessage(data: Uint8Array | null): void {
    if (!data) return;
    const fb = parseFeedback(this.mapping, data);
    if (!fb) return;
    if (!this.feedbackSeen) {
      this.feedbackSeen = true;
      this.emitStatus();
    }
    for (const fn of this.feedbackFns) fn(fb);
  }

  private emitStatus(): void {
    const s = this.status();
    for (const fn of this.statusFns) fn(s);
  }
}
