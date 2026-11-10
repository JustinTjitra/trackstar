import { describe, expect, it, vi } from 'vitest';
import { MidiIO, type MidiAccessLike, type MidiInputLike, type MidiOutputLike } from '../src/midi/io';
import { DEFAULT_MAPPING } from '../src/midi/mapping';

class FakeOutput implements MidiOutputLike {
  sent: { data: number[]; timestamp?: number }[] = [];
  constructor(public name: string, public state: 'connected' | 'disconnected' = 'connected') {}
  send(data: number[], timestamp?: number) {
    this.sent.push({ data: [...data], timestamp });
  }
}

class FakeInput implements MidiInputLike {
  onmidimessage: ((e: { data: Uint8Array | null }) => void) | null = null;
  constructor(public name: string, public state: 'connected' | 'disconnected' = 'connected') {}
  emit(bytes: number[]) {
    this.onmidimessage?.({ data: new Uint8Array(bytes) });
  }
}

class FakeAccess implements MidiAccessLike {
  outs: FakeOutput[] = [];
  ins: FakeInput[] = [];
  onstatechange: ((e: unknown) => void) | null = null;
  get outputs() {
    return { values: () => this.outs.values() };
  }
  get inputs() {
    return { values: () => this.ins.values() };
  }
  change() {
    this.onstatechange?.({});
  }
}

function setup() {
  const access = new FakeAccess();
  const out = new FakeOutput('Touchless');
  const inp = new FakeInput('Touchless');
  access.outs.push(out, new FakeOutput('DDJ-FLX2'));
  access.ins.push(inp, new FakeInput('DDJ-FLX2'));
  const io = new MidiIO(access, DEFAULT_MAPPING, () => 1000);
  return { access, out, inp, io };
}

describe('MidiIO', () => {
  it('lists port names', () => {
    const { io } = setup();
    expect(io.outputs()).toEqual(['Touchless', 'DDJ-FLX2']);
    expect(io.inputs()).toEqual(['Touchless', 'DDJ-FLX2']);
  });

  it('sends a press as note on now and note off 10 ms later', () => {
    const { io, out } = setup();
    io.select('Touchless', null);
    expect(io.send('B', 'loop2')).toBe(true);
    expect(out.sent).toEqual([
      { data: [0x91, 63, 127], timestamp: undefined },
      { data: [0x81, 63, 0], timestamp: 1010 },
    ]);
  });

  it('returns false and sends nothing without an output', () => {
    const { io, out } = setup();
    expect(io.send('A', 'loop1')).toBe(false);
    expect(out.sent).toEqual([]);
  });

  it('listens on the input with the same name as the output by default', () => {
    const { io, inp } = setup();
    const fn = vi.fn();
    io.onFeedback(fn);
    io.select('Touchless', null);
    inp.emit([0x92, 70, 127]);
    expect(fn).toHaveBeenCalledWith({ deck: 'A', action: 'drums', on: true });
    expect(io.status()).toMatchObject({ outName: 'Touchless', inName: 'Touchless', feedbackSeen: true });
  });

  it('can listen on a different named input', () => {
    const { io, access } = setup();
    const other = new FakeInput('Touchless Feedback');
    access.ins.push(other);
    const fn = vi.fn();
    io.onFeedback(fn);
    io.select('Touchless', 'Touchless Feedback');
    other.emit([0x93, 62, 0]);
    expect(fn).toHaveBeenCalledWith({ deck: 'B', action: 'loop1', on: false });
  });

  it('ignores its own commands echoed back on the same port', () => {
    const { io, inp } = setup();
    const fn = vi.fn();
    io.onFeedback(fn);
    io.select('Touchless', null);
    inp.emit([0x90, 63, 127]);
    expect(fn).not.toHaveBeenCalled();
    expect(io.status().feedbackSeen).toBe(false);
  });

  it('stops listening to the old input after switching ports', () => {
    const { io, inp, access } = setup();
    access.outs.push(new FakeOutput('Other'));
    access.ins.push(new FakeInput('Other'));
    const fn = vi.fn();
    io.onFeedback(fn);
    io.select('Touchless', null);
    io.select('Other', null);
    inp.emit([0x92, 70, 127]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('reports disconnects and reattaches by name when the port returns', () => {
    const { io, access, out } = setup();
    const status = vi.fn();
    io.onStatus(status);
    io.select('Touchless', null);
    expect(io.status()).toMatchObject({ outConnected: true, inConnected: true });

    out.state = 'disconnected';
    access.outs = access.outs.filter((o) => o !== out);
    access.ins = access.ins.filter((i) => i.name !== 'Touchless');
    access.change();
    expect(io.status()).toMatchObject({ outConnected: false, inConnected: false });
    expect(io.send('A', 'loop1')).toBe(false);

    const back = new FakeOutput('Touchless');
    const backIn = new FakeInput('Touchless');
    access.outs.push(back);
    access.ins.push(backIn);
    access.change();
    expect(io.status()).toMatchObject({ outConnected: true, inConnected: true });
    expect(io.send('A', 'loop1')).toBe(true);
    expect(back.sent.length).toBe(2);
    const fn = vi.fn();
    io.onFeedback(fn);
    backIn.emit([0x92, 62, 127]);
    expect(fn).toHaveBeenCalled();
    expect(status).toHaveBeenCalled();
  });

  it('does not listen when feedback is turned off', () => {
    const { io, inp } = setup();
    const fn = vi.fn();
    io.onFeedback(fn);
    io.select('Touchless', null);
    io.setFeedbackEnabled(false);
    inp.emit([0x92, 70, 127]);
    expect(fn).not.toHaveBeenCalled();
    expect(io.status().inName).toBeNull();
  });
});
