import { describe, expect, it } from 'vitest';
import { Spiral } from '../../src/fx/effects/spiral';
import { allFinite, noise, peak, rms, runBlocks, silence, sine } from '../fixtures/synthAudio';

const SR = 48000;
type Dir = 'up' | 'down';
const DIRS: Dir[] = ['up', 'down'];

/** Processes `seconds` of silence on both channels. */
function settle(fx: Spiral, seconds: number): void {
  const n = Math.round(seconds * SR);
  fx.process(silence(n), silence(n), n);
}

/** Processes whole buffers in place. */
function run(fx: Spiral, l: Float32Array, r: Float32Array): void {
  fx.process(l, r, l.length);
}

function expectEqual(a: Float32Array, b: Float32Array): void {
  expect(a.length).toBe(b.length);
  let diff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diff = i;
      break;
    }
  }
  expect(diff).toBe(-1);
}

/** Pitch in Hz of x between two times, from the number of sign changes between consecutive samples. */
function zeroCrossHz(x: Float32Array, fromSeconds: number, toSeconds: number): number {
  const from = Math.round(fromSeconds * SR);
  const to = Math.round(toSeconds * SR);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 !== x[i] < 0) crossings++;
  }
  return crossings / 2 / (toSeconds - fromSeconds);
}

/** A 0.15 s burst of a 440 Hz sine (amplitude 0.5) on the left in a 1 s buffer; the right is silent. */
function burstInput(): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(SR);
  l.set(sine(440, 0.15, SR, 0.5));
  return { l, r: silence(SR) };
}

/** Outputs for the burst, with the amount (and tempo) settled before the burst is sent. */
function burstOutput(direction: Dir, amount: number, bpm = 120): { l: Float32Array; r: Float32Array } {
  const fx = new Spiral(SR, direction);
  fx.setBpm(bpm);
  fx.setAmount(amount);
  settle(fx, 1);
  const { l, r } = burstInput();
  run(fx, l, r);
  return { l, r };
}

/** The same noise processed twice through two instances set up by `setup`; returns both outputs. */
function noiseOut(setup: (fx: Spiral) => void, seed = 1): Float32Array {
  const fx = new Spiral(SR, 'up');
  setup(fx);
  const l = noise(SR, seed);
  const r = noise(SR, seed + 1);
  run(fx, l, r);
  return l;
}

function expectWithin(actual: number, target: number, tolerance: number): void {
  expect(Math.abs(actual - target) / target).toBeLessThan(tolerance);
}

describe('Spiral identity', () => {
  it('leaves noise on both channels bit-identical at amount 0', () => {
    for (const dir of DIRS) {
      const fx = new Spiral(SR, dir);
      const inL = noise(5000, 1);
      const inR = noise(5000, 2);
      const l = inL.slice();
      const r = inR.slice();
      run(fx, l, r);
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
  });

  it('returns to bit-identical output after the amount goes back to 0', () => {
    for (const dir of DIRS) {
      const fx = new Spiral(SR, dir);
      fx.setAmount(0.8);
      run(fx, noise(SR, 1), noise(SR, 2));
      fx.setAmount(0);
      run(fx, noise(SR, 3), noise(SR, 4));
      const inL = noise(5000, 5);
      const inR = noise(5000, 6);
      const l = inL.slice();
      const r = inR.slice();
      run(fx, l, r);
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
  });
});

describe('Spiral pitch', () => {
  it('climbs by 4 semitones per repeat going up at amount 1', () => {
    const { l } = burstOutput('up', 1);
    expectWithin(zeroCrossHz(l, 0.27, 0.38), 554.4, 0.03);
    expectWithin(zeroCrossHz(l, 0.52, 0.63), 698.5, 0.03);
    expectWithin(zeroCrossHz(l, 0.77, 0.88), 880.0, 0.04);
  });

  it('sinks by 4 semitones per repeat going down at amount 1', () => {
    const { l } = burstOutput('down', 1);
    expectWithin(zeroCrossHz(l, 0.27, 0.38), 349.2, 0.03);
    expectWithin(zeroCrossHz(l, 0.52, 0.63), 277.2, 0.03);
    expectWithin(zeroCrossHz(l, 0.77, 0.88), 220.0, 0.05);
  });

  it('follows the amount for the size of the interval', () => {
    const { l } = burstOutput('up', 0.5);
    expectWithin(zeroCrossHz(l, 0.27, 0.38), 493.9, 0.03);
    expectWithin(zeroCrossHz(l, 0.52, 0.63), 554.4, 0.03);
  });
});

describe('Spiral timing and levels', () => {
  it('stays silent until the first echo and then repeats with falling level', () => {
    const { l } = burstOutput('up', 1);
    expect(peak(l.subarray(Math.round(0.16 * SR), Math.round(0.21 * SR)))).toBe(0);
    const dry = rms(l, 0, Math.round(0.15 * SR));
    const e1 = rms(l, Math.round(0.27 * SR), Math.round(0.38 * SR));
    const e2 = rms(l, Math.round(0.52 * SR), Math.round(0.63 * SR));
    expect(e1).toBeGreaterThan(0.5 * dry);
    expect(e2).toBeLessThan(e1);
    expect(e2).toBeGreaterThan(0.25 * e1);
  });

  it('follows the tempo', () => {
    const { l } = burstOutput('up', 1, 100);
    expect(peak(l.subarray(Math.round(0.16 * SR), Math.round(0.26 * SR)))).toBe(0);
    expect(rms(l, Math.round(0.32 * SR), Math.round(0.43 * SR))).toBeGreaterThan(0.1);
  });
});

describe('Spiral tap geometry', () => {
  // Where a single click comes back follows from the two taps alone, with no delay line needed
  // to work it out. A tap whose delay is `delay` at sample n reads the audio written at time
  // n - 1 - delay; with linear interpolation a click written at time 0 is picked up with weight
  // 1 - |that time|. This model predicts every returning sample, which pins the window length,
  // its centring on the beat, the starting phase, the triangular crossfade and the pitch ratio.
  function predicted(dir: Dir, samples: number): Map<number, number> {
    const windowSamples = 0.06 * SR;
    const beatDelay = 12000; // half a beat at 120 BPM
    const ratio = 2 ** (((dir === 'up' ? 1 : -1) * 4) / 12);
    const inc = (1 - ratio) / windowSamples;
    let phase = 0.5;
    const out = new Map<number, number>();
    for (let n = 0; n < samples; n++) {
      phase += inc;
      if (phase < 0) phase += 1;
      else if (phase >= 1) phase -= 1;
      const phaseB = phase < 0.5 ? phase + 0.5 : phase - 0.5;
      const gainA = 1 - Math.abs(2 * phase - 1);
      const taps: [number, number][] = [
        [phase, gainA],
        [phaseB, 1 - gainA],
      ];
      for (const [p, gain] of taps) {
        const readTime = n - 1 - (beatDelay - windowSamples / 2 - 1 + p * windowSamples);
        const weight = 1 - Math.abs(readTime);
        if (n > 0 && weight > 0 && gain * weight !== 0) out.set(n, (out.get(n) ?? 0) + gain * weight);
      }
    }
    return out;
  }

  it.each(DIRS)('a click after reset comes back exactly where the taps put it (%s)', (dir) => {
    const fx = new Spiral(SR, dir);
    fx.setAmount(1);
    fx.reset();
    const n = 16000; // shorter than two echo spacings, so nothing has been round the loop twice
    const l = silence(n);
    l[0] = 1;
    const r = silence(n);
    run(fx, l, r);
    const want = predicted(dir, n);
    expect(want.size).toBeGreaterThanOrEqual(3);
    const got: number[] = [];
    for (let i = 1; i < n; i++) if (l[i] !== 0) got.push(i);
    expect(got).toEqual([...want.keys()].sort((a, b) => a - b));
    for (const [index, value] of want) expect(Math.abs(l[index] - value)).toBeLessThan(1e-5);
  });

  it('the first returns land where hand calculation says for "up"', () => {
    // Tap B meets the click at n * ratio = 12000 + 1440, tap A at n * ratio = 12000 + 2880.
    const ratio = 2 ** (4 / 12);
    const want = predicted('up', 16000);
    expect([...want.keys()].slice(0, 2)).toEqual([Math.round(13440 / ratio), Math.round(14880 / ratio)]);
  });
});

describe('Spiral steady input', () => {
  /**
   * Constant 0.5 on both channels; returns both outputs. Each repeat (0.25 s) adds 0.8 times
   * the previous one at amount 1, so the level closes in on its limit by a factor of 0.8 per
   * repeat: after 12 s (48 repeats) the remaining gap is 2.5 * 0.8^48, about 6e-5.
   */
  function steady(dir: Dir, amount: number, seconds = 12): { l: Float32Array; r: Float32Array } {
    const fx = new Spiral(SR, dir);
    fx.setAmount(amount);
    const n = seconds * SR;
    const l = new Float32Array(n).fill(0.5);
    const r = new Float32Array(n).fill(0.5);
    run(fx, l, r);
    return { l, r };
  }

  function maxStep(x: Float32Array, from: number): number {
    let m = 0;
    for (let i = Math.max(1, from); i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
    return m;
  }

  it('settles at 6 times the input at amount 1 and stays perfectly flat', () => {
    for (const dir of DIRS) {
      const { l, r } = steady(dir, 1);
      expect(Math.abs(l[l.length - 1] - 3)).toBeLessThan(1e-3);
      expect(Math.abs(r[r.length - 1] - 3)).toBeLessThan(1e-3);
      expect(maxStep(l, l.length - SR)).toBeLessThan(1e-5);
      expect(maxStep(r, r.length - SR)).toBeLessThan(1e-5);
    }
  });

  it('settles at 1.8333 times the input at amount 0.5', () => {
    for (const dir of DIRS) {
      const { l, r } = steady(dir, 0.5, 6);
      expect(Math.abs(l[l.length - 1] - 0.91667)).toBeLessThan(1e-3);
      expect(Math.abs(r[r.length - 1] - 0.91667)).toBeLessThan(1e-3);
    }
  });

  it('does not click when the amount jumps', () => {
    for (const dir of DIRS) {
      const fx = new Spiral(SR, dir);
      fx.process(new Float32Array(SR).fill(0.5), new Float32Array(SR).fill(0.5), SR);
      fx.setAmount(1);
      const l = new Float32Array(2 * SR).fill(0.5);
      const r = new Float32Array(2 * SR).fill(0.5);
      run(fx, l, r);
      expect(maxStep(l, 0)).toBeLessThan(0.005);
      expect(maxStep(r, 0)).toBeLessThan(0.005);
    }
  });
});

describe('Spiral stability', () => {
  it('stays finite and below the bound of 6 on loud noise at amount 1', () => {
    for (const dir of DIRS) {
      const fx = new Spiral(SR, dir);
      fx.setAmount(1);
      const l = noise(10 * SR, 3);
      const r = noise(10 * SR, 4);
      run(fx, l, r);
      expect(allFinite(l)).toBe(true);
      expect(allFinite(r)).toBe(true);
      expect(peak(l)).toBeLessThanOrEqual(6 + 1e-3);
      expect(peak(r)).toBeLessThanOrEqual(6 + 1e-3);
    }
  });
});

describe('Spiral stereo', () => {
  it('keeps a left burst off the right channel', () => {
    for (const dir of DIRS) {
      const { l, r } = burstOutput(dir, 1);
      expect(peak(l.subarray(Math.round(0.27 * SR)))).toBeGreaterThan(0.1);
      expect(peak(r)).toBe(0);
    }
  });

  it('gives identical outputs for identical inputs', () => {
    for (const dir of DIRS) {
      const fx = new Spiral(SR, dir);
      fx.setAmount(0.9);
      const l = noise(SR, 7);
      const r = l.slice();
      run(fx, l, r);
      expectEqual(l, r);
    }
  });
});

describe('Spiral reset', () => {
  it('clears the echo memory', () => {
    for (const dir of DIRS) {
      const fx = new Spiral(SR, dir);
      fx.setAmount(0.8);
      run(fx, noise(SR, 1), noise(SR, 2));
      fx.reset();
      const l = silence(SR);
      const r = silence(SR);
      run(fx, l, r);
      expect(peak(l)).toBe(0);
      expect(peak(r)).toBe(0);
    }
  });

  it('behaves like a fresh instance with the same settings, which restarts the phase', () => {
    for (const dir of DIRS) {
      const used = new Spiral(SR, dir);
      used.setAmount(0.8);
      run(used, noise(SR + 777, 1), noise(SR + 777, 2));
      used.reset();
      const fresh = new Spiral(SR, dir);
      fresh.setAmount(0.8);
      fresh.reset();
      const a = burstInput();
      const b = burstInput();
      run(used, a.l, a.r);
      run(fresh, b.l, b.r);
      expectEqual(a.l, b.l);
      expectEqual(a.r, b.r);
      expect(peak(a.l.subarray(Math.round(0.27 * SR)))).toBeGreaterThan(0.1);
    }
  });
});

describe('Spiral setters', () => {
  it('clamps the amount to 0..1', () => {
    expectEqual(
      noiseOut((fx) => fx.setAmount(5)),
      noiseOut((fx) => fx.setAmount(1)),
    );
    expectEqual(
      noiseOut((fx) => fx.setAmount(-1)),
      noiseOut((fx) => fx.setAmount(0)),
    );
  });

  it('ignores a non-finite amount', () => {
    const ref = noiseOut((fx) => fx.setAmount(0.5));
    expectEqual(
      noiseOut((fx) => {
        fx.setAmount(0.5);
        fx.setAmount(NaN);
        fx.setAmount(Infinity);
        fx.setAmount(-Infinity);
      }),
      ref,
    );
  });

  it('clamps the tempo to 40..240 BPM', () => {
    const at = (bpm: number) =>
      noiseOut((fx) => {
        fx.setAmount(0.6);
        fx.setBpm(bpm);
      });
    expectEqual(at(1000), at(240));
    expectEqual(at(1), at(40));
    // and the clamped values really differ from the default tempo
    expect(at(240)).not.toEqual(at(120));
  });

  it('ignores a non-finite tempo', () => {
    const ref = noiseOut((fx) => {
      fx.setAmount(0.6);
      fx.setBpm(90);
    });
    expectEqual(
      noiseOut((fx) => {
        fx.setAmount(0.6);
        fx.setBpm(90);
        fx.setBpm(NaN);
        fx.setBpm(Infinity);
        fx.setBpm(-Infinity);
      }),
      ref,
    );
  });
});

describe('Spiral frames and bad input', () => {
  it('only touches the first `frames` samples', () => {
    const fx = new Spiral(SR, 'up');
    fx.setAmount(1);
    const inL = noise(200, 1);
    const inR = noise(200, 2);
    const l = inL.slice();
    const r = inR.slice();
    fx.process(l, r, 100);
    expectEqual(l.subarray(100), inL.subarray(100));
    expectEqual(r.subarray(100), inR.subarray(100));
  });

  it('copes with negative, NaN and oversize frame counts', () => {
    const fx = new Spiral(SR, 'down');
    fx.setAmount(1);
    const inL = noise(200, 1);
    const inR = noise(300, 2);
    for (const frames of [-5, NaN, -Infinity, 0, 0.9]) {
      const l = inL.slice();
      const r = inR.slice();
      expect(() => fx.process(l, r, frames)).not.toThrow();
      expectEqual(l, inL);
      expectEqual(r, inR);
    }
    const l = inL.slice();
    const r = inR.slice();
    expect(() => fx.process(l, r, 1e9)).not.toThrow();
    expect(() => fx.process(l, r, Infinity)).not.toThrow();
    expect(l.length).toBe(200);
    expect(r.length).toBe(300);
    // the part of the longer buffer beyond the shorter one is not touched
    expectEqual(r.subarray(200), inR.subarray(200));
  });

  it('treats NaN and Infinity input like 0', () => {
    const bad = noise(SR, 1);
    const good = bad.slice();
    const positions = [10, 500, 501, 9000, 20000];
    const values = [NaN, Infinity, -Infinity, NaN, Infinity];
    positions.forEach((p, k) => {
      bad[p] = values[k];
      good[p] = 0;
    });
    const make = () => {
      const fx = new Spiral(SR, 'up');
      fx.setAmount(0.8);
      return fx;
    };
    const a = make();
    const b = make();
    const badR = bad.slice();
    const goodR = good.slice();
    a.process(bad, badR, bad.length);
    b.process(good, goodR, good.length);
    expect(allFinite(bad)).toBe(true);
    expect(allFinite(badR)).toBe(true);
    expectEqual(bad, good);
    expectEqual(badR, goodR);
  });

  it('gives the same output whatever the block size', () => {
    for (const dir of DIRS) {
      const split = 10001;
      const total = 2 * SR;
      const inL = noise(total, 11);
      const inR = noise(total, 12);

      const a = new Spiral(SR, dir);
      a.setAmount(0.3);
      const aL = inL.slice();
      const aR = inR.slice();
      runBlocks((l, r, n) => a.process(l, r, n), aL.subarray(0, split), aR.subarray(0, split), 128);
      a.setAmount(0.9);
      runBlocks((l, r, n) => a.process(l, r, n), aL.subarray(split), aR.subarray(split), 128);

      const b = new Spiral(SR, dir);
      b.setAmount(0.3);
      const bL = inL.slice();
      const bR = inR.slice();
      b.process(bL.subarray(0, split), bR.subarray(0, split), split);
      b.setAmount(0.9);
      b.process(bL.subarray(split), bR.subarray(split), total - split);

      expectEqual(aL, bL);
      expectEqual(aR, bR);
    }
  });
});

describe('Spiral constructor', () => {
  it('rejects a bad sample rate', () => {
    for (const sr of [0, -1, NaN, Infinity]) {
      expect(() => new Spiral(sr, 'up')).toThrow(RangeError);
    }
  });

  it('rejects a direction other than up or down', () => {
    expect(() => new Spiral(SR, 'sideways' as unknown as 'up')).toThrow(RangeError);
    expect(() => new Spiral(SR, undefined as unknown as 'up')).toThrow(RangeError);
  });
});
