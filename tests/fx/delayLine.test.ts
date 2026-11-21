import { describe, expect, it } from 'vitest';
import { DelayLine } from '../../src/fx/dsp/delayLine';
import { impulse, noise, sine } from '../fixtures/synthAudio';

/** Writes the samples of `x` into `line` in order. */
function writeAll(line: DelayLine, x: ArrayLike<number>): void {
  for (let n = 0; n < x.length; n++) line.write(x[n]);
}

describe('DelayLine', () => {
  it('returns samples in write order: newest at delay 0', () => {
    const line = new DelayLine(8);
    line.write(1);
    line.write(2);
    line.write(3);
    expect(line.read(0)).toBe(3);
    expect(line.read(1)).toBe(2);
    expect(line.read(2)).toBe(1);
  });

  it('reads an impulse back after exactly N writes', () => {
    const line0 = new DelayLine(130);
    for (const N of [1, 7, 100, line0.maxDelay]) {
      const line = new DelayLine(130);
      line.write(1);
      for (let k = 0; k <= N + 1; k++) {
        // k zeros have been written after the impulse
        expect(line.read(N)).toBe(k === N ? 1 : 0);
        line.write(0);
      }
    }
  });

  it('acts as an exact integer delay in a read-then-write loop', () => {
    const D = 37;
    const x = noise(500, 7);
    const line = new DelayLine(64);
    const y = new Float32Array(x.length);
    for (let n = 0; n < x.length; n++) {
      y[n] = line.read(D - 1); // before the write, read(0) is x[n - 1]
      line.write(x[n]);
    }
    for (let n = 0; n < D; n++) expect(y[n]).toBe(0);
    for (let n = D; n < x.length; n++) expect(y[n]).toBe(Math.fround(x[n - D]));
  });

  it('acts as a delay of D relative to the current sample in a write-then-read loop', () => {
    const D = 5;
    const x = noise(200, 11);
    const line = new DelayLine(16);
    for (let n = 0; n < x.length; n++) {
      line.write(x[n]);
      const y = line.read(D);
      expect(y).toBe(n >= D ? Math.fround(x[n - D]) : 0);
    }
  });

  it('interpolates fractional reads linearly between neighbours', () => {
    const line = new DelayLine(64);
    writeAll(line, noise(300, 3));
    const a = line.read(10);
    const b = line.read(11);
    expect(a).not.toBeCloseTo(b, 3);
    expect(line.read(10.5)).toBeCloseTo((a + b) / 2, 6);
    expect(line.read(10.25)).toBeCloseTo(0.75 * a + 0.25 * b, 6);
    expect(line.read(10.75)).toBeCloseTo(0.25 * a + 0.75 * b, 6);
  });

  it('shifts a slow sine in time by a fractional delay', () => {
    const fs = 48000;
    const freq = 100;
    const delay = 240.5;
    const x = sine(freq, 0.1, fs);
    const line = new DelayLine(512);
    const w = (2 * Math.PI * freq) / fs;
    for (let n = 0; n < x.length; n++) {
      line.write(x[n]);
      const y = line.read(delay);
      if (n > 300) expect(Math.abs(y - Math.sin(w * (n - delay)))).toBeLessThan(1e-3);
    }
  });

  it('reads unwritten history as 0 at every delay', () => {
    const line = new DelayLine(20);
    for (let d = 0; d <= line.maxDelay; d++) expect(line.read(d)).toBe(0);
    line.write(1);
    line.write(2);
    expect(line.read(0)).toBe(2);
    expect(line.read(1)).toBe(1);
    for (let d = 2; d <= line.maxDelay; d++) expect(line.read(d)).toBe(0);
  });

  it('stays correct across many wrap-arounds', () => {
    const line = new DelayLine(5);
    const total = 5000;
    // small integers are exact in a Float32Array
    const value = (n: number): number => (n % 251) + 1;
    for (let n = 0; n < total; n++) {
      line.write(value(n));
      if (n % 97 === 0 || n >= total - 3 || (n >= 5 && n <= 20)) {
        for (let k = 0; k <= line.maxDelay; k++) {
          expect(line.read(k)).toBe(n - k >= 0 ? value(n - k) : 0);
        }
      }
    }
    for (let k = 0; k <= line.maxDelay; k++) expect(line.read(k)).toBe(value(total - 1 - k));
  });

  it('clamps delays to [0, maxDelay] and treats NaN as 0', () => {
    const line = new DelayLine(10);
    writeAll(line, noise(100, 5));
    expect(line.read(-3)).toBe(line.read(0));
    expect(line.read(line.maxDelay + 50)).toBe(line.read(line.maxDelay));
    expect(line.read(NaN)).toBe(line.read(0));
    expect(line.read(Infinity)).toBe(line.read(line.maxDelay));
    expect(line.read(-Infinity)).toBe(line.read(0));
  });

  it('reads the oldest valid sample at maxDelay for awkward sizes', () => {
    for (const size of [1, 2, 3, 6, 7, 8, 9, 15, 16, 17, 1000]) {
      const line = new DelayLine(size);
      const x = noise(3 * size + 10, 13);
      writeAll(line, x);
      const last = x.length - 1;
      expect(line.read(line.maxDelay)).toBe(Math.fround(x[last - line.maxDelay]));
      expect(line.read(line.maxDelay - 1)).toBe(Math.fround(x[last - line.maxDelay + 1]));
      // a fractional read just under maxDelay uses the oldest sample as neighbour
      const a = Math.fround(x[last - line.maxDelay + 1]);
      const b = Math.fround(x[last - line.maxDelay]);
      expect(line.read(line.maxDelay - 0.5)).toBeCloseTo((a + b) / 2, 6);
    }
  });

  it('reports maxDelay as the ceiling of the requested size', () => {
    expect(new DelayLine(100).maxDelay).toBe(100);
    expect(new DelayLine(10.2).maxDelay).toBe(11);
  });

  it('zeroes everything on clear and keeps working', () => {
    const line = new DelayLine(50);
    writeAll(line, noise(200, 9));
    line.clear();
    for (let d = 0; d <= line.maxDelay; d++) expect(line.read(d)).toBe(0);
    for (let d = 0; d < line.maxDelay; d++) expect(line.read(d + 0.5)).toBe(0);
    line.write(0.5);
    line.write(0.25);
    expect(line.read(0)).toBe(0.25);
    expect(line.read(1)).toBe(0.5);
    expect(line.read(2)).toBe(0);
  });

  it('stores non-finite input as 0', () => {
    const line = new DelayLine(8);
    line.write(1);
    line.write(NaN);
    line.write(Infinity);
    line.write(-Infinity);
    expect(line.read(0)).toBe(0);
    expect(line.read(1)).toBe(0);
    expect(line.read(2)).toBe(0);
    expect(line.read(3)).toBe(1);
    for (let d = 0; d <= 8; d += 0.5) expect(Number.isFinite(line.read(d))).toBe(true);
  });

  it('rejects an invalid maximum delay', () => {
    expect(() => new DelayLine(0)).toThrow(RangeError);
    expect(() => new DelayLine(-5)).toThrow(RangeError);
    expect(() => new DelayLine(NaN)).toThrow(RangeError);
    expect(() => new DelayLine(Infinity)).toThrow(RangeError);
  });

  it('keeps an impulse from the fixture at the right place', () => {
    const line = new DelayLine(32);
    const x = impulse(100, 10);
    const y = new Float32Array(x.length);
    for (let n = 0; n < x.length; n++) {
      line.write(x[n]);
      y[n] = line.read(20);
    }
    expect(y[30]).toBe(1);
    expect(y[29]).toBe(0);
    expect(y[31]).toBe(0);
  });
});
