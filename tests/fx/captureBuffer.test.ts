import { describe, expect, it } from 'vitest';
import { CaptureBuffer } from '../../src/fx/dsp/captureBuffer';

describe('CaptureBuffer', () => {
  it('reports the capacity as the ceiling of the requested size', () => {
    expect(new CaptureBuffer(1000).capacity).toBe(1000);
    expect(new CaptureBuffer(10.2).capacity).toBe(11);
    expect(new CaptureBuffer(2).capacity).toBe(2);
  });

  it('counts filled up to capacity and no further', () => {
    const buf = new CaptureBuffer(4);
    expect(buf.filled).toBe(0);
    for (let i = 1; i <= 4; i++) {
      buf.write(i, -i);
      expect(buf.filled).toBe(i);
    }
    for (let i = 0; i < 25; i++) buf.write(0, 0);
    expect(buf.filled).toBe(4);
  });

  it('returns samples newest first on both channels', () => {
    const buf = new CaptureBuffer(10);
    for (let i = 1; i <= 5; i++) buf.write(i, -i);
    expect(buf.readL(0)).toBe(5);
    expect(buf.readL(1)).toBe(4);
    expect(buf.readL(4)).toBe(1);
    expect(buf.readR(0)).toBe(-5);
    expect(buf.readR(1)).toBe(-4);
    expect(buf.readR(4)).toBe(-1);
  });

  it('keeps the channels independent and not swapped', () => {
    const buf = new CaptureBuffer(10);
    buf.write(1, 100);
    buf.write(2, 200);
    expect(buf.readL(0)).toBe(2);
    expect(buf.readR(0)).toBe(200);
    expect(buf.readL(1)).toBe(1);
    expect(buf.readR(1)).toBe(100);
  });

  it('reads samples not yet recorded as exactly 0', () => {
    const buf = new CaptureBuffer(10);
    buf.write(7, 8);
    buf.write(9, 10);
    buf.write(11, 12);
    for (const ago of [3, 5, 9]) {
      expect(buf.readL(ago)).toBe(0);
      expect(buf.readR(ago)).toBe(0);
    }
  });

  it('retains exactly capacity samples, with the oldest at capacity - 1', () => {
    const buf = new CaptureBuffer(8);
    for (let i = 1; i <= 20; i++) buf.write(i, -i);
    expect(buf.readL(0)).toBe(20);
    expect(buf.readL(7)).toBe(13);
    expect(buf.readR(0)).toBe(-20);
    expect(buf.readR(7)).toBe(-13);
  });

  it('clamps delays to [0, capacity - 1] on both channels', () => {
    const buf = new CaptureBuffer(8);
    for (let i = 1; i <= 20; i++) buf.write(i, -i);
    expect(buf.readL(8)).toBe(buf.readL(7));
    expect(buf.readL(100)).toBe(buf.readL(7));
    expect(buf.readL(Infinity)).toBe(buf.readL(7));
    expect(buf.readL(-3)).toBe(buf.readL(0));
    expect(buf.readL(NaN)).toBe(buf.readL(0));
    expect(buf.readR(8)).toBe(buf.readR(7));
    expect(buf.readR(100)).toBe(buf.readR(7));
    expect(buf.readR(Infinity)).toBe(buf.readR(7));
    expect(buf.readR(-3)).toBe(buf.readR(0));
    expect(buf.readR(NaN)).toBe(buf.readR(0));
  });

  it('interpolates fractional reads linearly between neighbours', () => {
    const buf = new CaptureBuffer(10);
    for (const v of [1, 4, 9, 16, 25]) buf.write(v, -v);
    expect(buf.readL(2.5)).toBe((buf.readL(2) + buf.readL(3)) / 2);
    expect(buf.readL(2.5)).toBe(6.5);
    expect(buf.readL(1.25)).toBe(0.75 * buf.readL(1) + 0.25 * buf.readL(2));
    expect(buf.readL(1.25)).toBe(14.25);
    expect(buf.readR(2.5)).toBe((buf.readR(2) + buf.readR(3)) / 2);
    expect(buf.readR(1.25)).toBe(0.75 * buf.readR(1) + 0.25 * buf.readR(2));
  });

  it('stays correct over a long run that wraps many times', () => {
    const capacity = 7;
    const buf = new CaptureBuffer(capacity);
    const total = 10000;
    const check = (newest: number): void => {
      for (let k = 0; k < capacity; k++) {
        expect(buf.readL(k)).toBe(newest - k);
        expect(buf.readR(k)).toBe(-2 * (newest - k));
      }
    };
    for (let n = 1; n <= total; n++) {
      buf.write(n, -2 * n);
      if (n % 997 === 0) check(n);
    }
    check(total);
    expect(buf.filled).toBe(capacity);
  });

  it('forgets the recording on clear and keeps working afterwards', () => {
    const buf = new CaptureBuffer(6);
    for (let i = 1; i <= 10; i++) buf.write(i, -i);
    buf.clear();
    expect(buf.filled).toBe(0);
    for (let k = 0; k < 6; k++) {
      expect(buf.readL(k)).toBe(0);
      expect(buf.readR(k)).toBe(0);
    }
    buf.write(3, -4);
    expect(buf.filled).toBe(1);
    expect(buf.readL(0)).toBe(3);
    expect(buf.readR(0)).toBe(-4);
    expect(buf.readL(1)).toBe(0);
    expect(buf.readR(1)).toBe(0);
  });

  it('stores non-finite input as 0 and still counts it', () => {
    const buf = new CaptureBuffer(4);
    buf.write(NaN, Infinity);
    expect(buf.filled).toBe(1);
    expect(buf.readL(0)).toBe(0);
    expect(buf.readR(0)).toBe(0);
    buf.write(-Infinity, 5);
    expect(buf.filled).toBe(2);
    expect(buf.readL(0)).toBe(0);
    expect(buf.readR(0)).toBe(5);
    expect(buf.readR(1)).toBe(0);
  });

  it('rejects a maximum size below 2 or not finite', () => {
    expect(() => new CaptureBuffer(1)).toThrow(RangeError);
    // 1.5 would round up to a workable size of 2, so it only fails if the bound itself is checked
    expect(() => new CaptureBuffer(1.5)).toThrow(/CaptureBuffer/);
    expect(() => new CaptureBuffer(1.5)).toThrow(RangeError);
    expect(() => new CaptureBuffer(0)).toThrow(RangeError);
    expect(() => new CaptureBuffer(-5)).toThrow(RangeError);
    expect(() => new CaptureBuffer(NaN)).toThrow(RangeError);
    expect(() => new CaptureBuffer(Infinity)).toThrow(RangeError);
  });

  it('rounds values to 32-bit floats', () => {
    const buf = new CaptureBuffer(4);
    buf.write(0.1, -0.7);
    expect(buf.readL(0)).toBe(Math.fround(0.1));
    expect(buf.readR(0)).toBe(Math.fround(-0.7));
  });
});
