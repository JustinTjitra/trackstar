import { describe, it, expect } from 'vitest';
import {
  TAU,
  clamp,
  clamp01,
  lerp,
  expLerp,
  dbToGain,
  gainToDb,
  beatsToSamples,
  sanitize,
} from '../../src/fx/dsp/math';
import type {
  StereoEffect,
  TempoAware,
  SceneSlot,
  SceneDirection,
  ReleaseType,
  RollDivision,
} from '../../src/fx/types';

describe('types (compile-level check)', () => {
  it('accepts one value of each shared type', () => {
    const slot: SceneSlot = 4;
    const direction: SceneDirection = 'down';
    const release: ReleaseType = 'backspin';
    const roll: RollDivision = 0.125;
    const tempo: TempoAware = { setBpm: () => {} };
    const fx: StereoEffect = {
      process: () => {},
      reset: () => {},
    };
    const all = [slot, direction, release, roll];
    expect(all).toHaveLength(4);
    expect(typeof tempo.setBpm).toBe('function');
    expect(typeof fx.process).toBe('function');
  });
});

describe('TAU', () => {
  it('equals 2 * Math.PI', () => {
    expect(TAU).toBe(2 * Math.PI);
  });
});

describe('clamp', () => {
  it('returns x when inside the range', () => {
    expect(clamp(3, 2, 5)).toBe(3);
  });

  it('returns lo when x is below the range', () => {
    expect(clamp(-1, 2, 5)).toBe(2);
  });

  it('returns hi when x is above the range', () => {
    expect(clamp(9, 2, 5)).toBe(5);
  });

  it('returns the bounds exactly when x equals them', () => {
    expect(clamp(2, 2, 5)).toBe(2);
    expect(clamp(5, 2, 5)).toBe(5);
  });

  it('returns lo for NaN', () => {
    expect(clamp(NaN, 2, 5)).toBe(2);
  });
});

describe('clamp01', () => {
  it('maps negative values to 0', () => {
    expect(clamp01(-1)).toBe(0);
  });

  it('keeps values inside 0..1', () => {
    expect(clamp01(0.3)).toBe(0.3);
  });

  it('maps values above 1 to 1', () => {
    expect(clamp01(7)).toBe(1);
  });

  it('maps NaN to 0', () => {
    expect(clamp01(NaN)).toBe(0);
  });
});

describe('lerp', () => {
  it('returns a at t = 0', () => {
    expect(lerp(3, 10, 0)).toBe(3);
  });

  it('returns b at t = 1', () => {
    expect(lerp(3, 10, 1)).toBe(10);
  });

  it('returns the midpoint at t = 0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('extrapolates when t is outside 0..1', () => {
    expect(lerp(0, 10, 1.5)).toBe(15);
    expect(lerp(0, 10, -0.5)).toBe(-5);
  });
});

describe('expLerp', () => {
  it('interpolates geometrically (midpoint of 100 and 10000 is 1000)', () => {
    expect(Math.abs(expLerp(100, 10000, 0.5) - 1000) / 1000).toBeLessThan(1e-9);
  });

  it('returns a at t = 0', () => {
    expect(expLerp(100, 10000, 0)).toBeCloseTo(100, 9);
  });

  it('returns b at t = 1', () => {
    expect(expLerp(100, 10000, 1)).toBeCloseTo(10000, 6);
  });

  it('handles a downward range (8000 to 500 midpoint is 2000)', () => {
    expect(expLerp(8000, 500, 0.5)).toBeCloseTo(2000, 6);
  });
});

describe('dbToGain', () => {
  it('maps 0 dB to a gain of 1', () => {
    expect(dbToGain(0)).toBe(1);
  });

  it('maps about -6.0206 dB to a gain of 0.5', () => {
    expect(Math.abs(dbToGain(-6.0206) - 0.5)).toBeLessThan(1e-4);
  });

  it('maps +20 dB to a gain of 10', () => {
    expect(dbToGain(20)).toBeCloseTo(10, 9);
  });
});

describe('gainToDb', () => {
  it('maps a gain of 1 to 0 dB', () => {
    expect(gainToDb(1)).toBe(0);
  });

  it('maps a gain of 0.5 to about -6.0206 dB', () => {
    expect(Math.abs(gainToDb(0.5) - -6.0206)).toBeLessThan(1e-4);
  });

  it('maps a gain of 0 to -Infinity', () => {
    expect(gainToDb(0)).toBe(-Infinity);
  });

  it('maps a negative gain to -Infinity', () => {
    expect(gainToDb(-0.5)).toBe(-Infinity);
  });

  it('round-trips with dbToGain', () => {
    expect(gainToDb(dbToGain(-12.5))).toBeCloseTo(-12.5, 9);
  });
});

describe('beatsToSamples', () => {
  it('converts one beat at 120 BPM and 48 kHz to 24000 samples', () => {
    expect(beatsToSamples(1, 120, 48000)).toBe(24000);
  });

  it('converts half a beat at 120 BPM and 44.1 kHz to 11025 samples', () => {
    expect(beatsToSamples(0.5, 120, 44100)).toBe(11025);
  });

  it('keeps fractional results unrounded', () => {
    expect(beatsToSamples(0.75, 128, 48000)).toBe(16875);
    expect(beatsToSamples(1, 124, 44100)).toBeCloseTo((60 / 124) * 44100, 9);
    expect(beatsToSamples(1, 124, 44100) % 1).not.toBe(0);
  });
});

describe('sanitize', () => {
  it('passes 0 through unchanged', () => {
    expect(sanitize(0)).toBe(0);
  });

  it('passes a negative finite value through unchanged', () => {
    expect(sanitize(-0.25)).toBe(-0.25);
  });

  it('passes a large finite value through unchanged', () => {
    expect(sanitize(1e30)).toBe(1e30);
  });

  it('maps NaN to 0', () => {
    expect(sanitize(NaN)).toBe(0);
  });

  it('maps Infinity to 0', () => {
    expect(sanitize(Infinity)).toBe(0);
  });

  it('maps -Infinity to 0', () => {
    expect(sanitize(-Infinity)).toBe(0);
  });
});
