import { describe, it, expect } from 'vitest';
import { BeatClock } from '../../src/fx/dsp/beatClock';

const SR = 48000;

describe('BeatClock defaults', () => {
  it('starts at 120 BPM, position 0, 24000 samples per beat', () => {
    const clock = new BeatClock(SR);
    expect(clock.bpm).toBe(120);
    expect(clock.beats).toBe(0);
    expect(clock.samplesPerBeat).toBe(24000);
  });
});

describe('BeatClock samplesPerBeat', () => {
  it('depends on tempo and sample rate', () => {
    const a = new BeatClock(SR);
    a.setBpm(128);
    expect(a.samplesPerBeat).toBe(22500);

    const b = new BeatClock(44100);
    expect(b.samplesPerBeat).toBe(22050);

    const c = new BeatClock(SR);
    c.setBpm(100);
    expect(c.samplesPerBeat).toBe(28800);
  });
});

describe('BeatClock advancing', () => {
  it('reports position, phase and distance to the next division after 12000 samples', () => {
    const clock = new BeatClock(SR);
    clock.advance(12000);
    expect(clock.beats).toBeCloseTo(0.5, 9);
    expect(clock.phase(1)).toBeCloseTo(0.5, 9);
    expect(clock.phase(0.5)).toBeCloseTo(0, 9);
    expect(clock.phase(0.25)).toBeCloseTo(0, 9);
    expect(clock.phase(4)).toBeCloseTo(0.125, 9);
    expect(clock.samplesToNext(1)).toBeCloseTo(12000, 9);
    expect(clock.samplesToNext(4)).toBeCloseTo(84000, 9);
  });
});

describe('BeatClock on a boundary', () => {
  it('phase is 0 and samplesToNext is a full division at position 0', () => {
    const clock = new BeatClock(SR);
    expect(clock.phase(1)).toBe(0);
    expect(clock.samplesToNext(1)).toBe(24000);
    expect(clock.samplesToNext(0.25)).toBe(6000);
  });
});

describe('BeatClock just before and after a boundary', () => {
  it('samplesToNext is 1 one sample before the boundary and a full beat after it', () => {
    const clock = new BeatClock(SR);
    clock.advance(23999);
    expect(clock.samplesToNext(1)).toBeCloseTo(1, 6);
    expect(clock.phase(1)).toBeCloseTo(23999 / 24000, 9);

    clock.advance(1);
    expect(clock.phase(1)).toBe(0);
    expect(clock.samplesToNext(1)).toBeCloseTo(24000, 6);
  });
});

describe('BeatClock block-wise advancing', () => {
  it('375 blocks of 128 samples match one step of 48000 samples', () => {
    const clock = new BeatClock(SR);
    for (let i = 0; i < 375; i++) clock.advance(128);
    expect(Math.abs(clock.beats - 2)).toBeLessThan(1e-9);
  });

  it('has no drift over one hour of 128-sample blocks at 128 BPM', () => {
    const clock = new BeatClock(SR);
    clock.setBpm(128);
    for (let i = 0; i < 1350000; i++) clock.advance(128);
    const exact = (1350000 * 128) / 22500;
    expect(clock.beats).toBe(exact);
  });

  // At 125 BPM and 48000 Hz a beat is 23040 samples, which is exactly 180 blocks of 128. A
  // clock that adds a fraction of a beat per block lands just short of most of these
  // boundaries (by up to 1.5e-7 beats), which the 1e-9 rounding guard does not cover.
  it('lands exactly on every beat boundary over a long set', () => {
    const clock = new BeatClock(SR);
    clock.setBpm(125);
    let offBoundary = 0;
    for (let beat = 1; beat <= 11000; beat++) {
      for (let i = 0; i < 180; i++) clock.advance(128);
      if (clock.beats !== beat || clock.phase(1) !== 0 || clock.samplesToNext(1) !== 23040) offBoundary++;
    }
    expect(offBoundary).toBe(0);
  });

  it('stays exact across tempo changes in the middle of a run', () => {
    const clock = new BeatClock(SR);
    for (let i = 0; i < 375; i++) clock.advance(128); // 48000 samples = 2 beats at 120 BPM
    clock.setBpm(125);
    for (let i = 0; i < 180 * 3; i++) clock.advance(128); // 3 beats at 125 BPM
    clock.setBpm(125); // setting the same tempo again must not disturb anything
    expect(clock.beats).toBe(5);
    expect(clock.phase(1)).toBe(0);
  });

  it('setBeats replaces the position even after the clock has advanced', () => {
    const clock = new BeatClock(SR);
    clock.advance(36000); // 1.5 beats
    clock.setBeats(3.25);
    expect(clock.beats).toBe(3.25);
    clock.advance(24000);
    expect(clock.beats).toBe(4.25);
  });
});

describe('BeatClock tempo changes', () => {
  it('setBpm keeps the position and only changes the speed from then on', () => {
    const clock = new BeatClock(SR);
    clock.advance(36000);
    expect(clock.beats).toBeCloseTo(1.5, 9);

    clock.setBpm(60);
    expect(clock.beats).toBeCloseTo(1.5, 9);

    clock.advance(48000);
    expect(clock.beats).toBeCloseTo(2.5, 9);
  });

  it('clamps the tempo to 40..240 BPM', () => {
    const clock = new BeatClock(SR);
    clock.setBpm(10);
    expect(clock.bpm).toBe(40);
    clock.setBpm(999);
    expect(clock.bpm).toBe(240);
  });

  it('ignores non-finite tempos', () => {
    const clock = new BeatClock(SR);
    clock.setBpm(140);
    clock.setBpm(NaN);
    expect(clock.bpm).toBe(140);
    clock.setBpm(Infinity);
    expect(clock.bpm).toBe(140);
  });
});

describe('BeatClock setBeats', () => {
  it('sets the position, clamps negatives to 0 and ignores NaN', () => {
    const clock = new BeatClock(SR);
    clock.setBeats(3.25);
    expect(clock.beats).toBe(3.25);
    expect(clock.phase(1)).toBeCloseTo(0.25, 9);

    clock.setBeats(-2);
    expect(clock.beats).toBe(0);

    clock.setBeats(3.5);
    clock.setBeats(NaN);
    expect(clock.beats).toBe(3.5);
  });
});

describe('BeatClock advance input validation', () => {
  it('ignores NaN, negative and infinite frame counts', () => {
    const clock = new BeatClock(SR);
    clock.setBeats(1.25);
    clock.advance(NaN);
    expect(clock.beats).toBe(1.25);
    clock.advance(-100);
    expect(clock.beats).toBe(1.25);
    clock.advance(Infinity);
    expect(clock.beats).toBe(1.25);
  });
});

describe('BeatClock bad divisions', () => {
  it('treats a division that is not a finite number above 0 as 1', () => {
    const clock = new BeatClock(SR);
    clock.setBeats(0.3);
    const p1 = clock.phase(1);
    const s1 = clock.samplesToNext(1);
    for (const bad of [0, -1, NaN]) {
      expect(clock.phase(bad)).toBe(p1);
      expect(clock.samplesToNext(bad)).toBe(s1);
    }
  });
});

describe('BeatClock rounding guard', () => {
  it('a hair before a boundary counts as on it', () => {
    const clock = new BeatClock(SR);
    clock.setBeats(0.9999999999);
    expect(clock.phase(1)).toBe(0);
    expect(clock.samplesToNext(1)).toBeCloseTo(24000, 6);
  });
});

describe('BeatClock phase range', () => {
  it('stays in [0, 1) across many positions and divisions', () => {
    const divisions = [4, 1, 0.5, 0.25, 0.125];
    for (const division of divisions) {
      const clock = new BeatClock(SR);
      for (let i = 0; i < 400; i++) {
        clock.advance(777);
        const p = clock.phase(division);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
      }
    }
  });
});

describe('BeatClock reset', () => {
  it('sets the position to 0 and keeps the tempo', () => {
    const clock = new BeatClock(SR);
    clock.setBpm(150);
    clock.advance(48000);
    expect(clock.beats).toBeGreaterThan(0);
    clock.reset();
    expect(clock.beats).toBe(0);
    expect(clock.bpm).toBe(150);
  });
});

describe('BeatClock constructor validation', () => {
  it.each([0, -48000, NaN, Infinity])('throws RangeError for sample rate %s', (rate) => {
    expect(() => new BeatClock(rate)).toThrow(RangeError);
  });
});
