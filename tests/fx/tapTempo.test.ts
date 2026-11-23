import { describe, expect, it } from 'vitest';
import { TapTempo } from '../../src/fx/tempo/tapTempo';

/** Taps each time in order and returns every result. */
function tapAll(t: TapTempo, times: number[]): (number | null)[] {
  return times.map((x) => t.tap(x));
}

describe('tap tempo: steady taps', () => {
  it('gives exactly 120 BPM for taps 500 ms apart', () => {
    const results = tapAll(new TapTempo(), [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
    expect(results[0]).toBeNull();
    for (const r of results.slice(1)) {
      expect(r).toBe(120);
    }
  });

  it('uses the median, so one late tap barely moves the result', () => {
    const results = tapAll(new TapTempo(), [0, 500, 1000, 1500, 2000, 2600, 3100]);
    expect(results[5]).toBe(120);
    expect(results[6]).toBe(120);
  });

  it('orders the intervals as numbers, not as text', () => {
    // intervals 900, 1000, 1100: as text "900" would sort last and the median would be 1100
    const results = tapAll(new TapTempo(), [0, 900, 1900, 3000]);
    expect(results[3]).toBe(60);
  });

  it('uses the mean of the two middle intervals for an even count', () => {
    const results = tapAll(new TapTempo(), [0, 500, 1020]);
    expect(results[2]).toBeCloseTo(60000 / 510, 6);
  });
});

describe('tap tempo: window', () => {
  it('keeps 8 taps (7 intervals) by default', () => {
    const times = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4900, 5300, 5700, 6100];
    const results = tapAll(new TapTempo(), times);
    expect(results.slice(10)).toStrictEqual([120, 120, 120, 150]);
  });

  it('keeps 4 taps (3 intervals) with window 4', () => {
    const results = tapAll(new TapTempo({ window: 4 }), [0, 500, 1000, 1500, 1900, 2300]);
    expect(results[4]).toBe(120);
    expect(results[5]).toBe(150);
  });
});

describe('tap tempo: long gaps', () => {
  it('starts over after a long gap', () => {
    const results = tapAll(new TapTempo(), [0, 500, 1000, 3001, 3401]);
    expect(results).toStrictEqual([null, 120, 120, null, 150]);
  });

  it('does not start over for a gap of exactly maxGapMs', () => {
    const results = tapAll(new TapTempo(), [0, 500, 2500]);
    expect(results[2]).toBe(48);
  });

  it('uses a custom maxGapMs', () => {
    const results = tapAll(new TapTempo({ maxGapMs: 1000 }), [0, 500, 1501, 1901]);
    expect(results).toStrictEqual([null, 120, null, 150]);
  });
});

describe('tap tempo: out of range', () => {
  it('returns null above 240 BPM but keeps the taps', () => {
    const results = tapAll(new TapTempo(), [0, 200]);
    expect(results).toStrictEqual([null, null]);
  });

  it('returns null below 40 BPM but keeps the taps', () => {
    const results = tapAll(new TapTempo(), [0, 1600]);
    expect(results).toStrictEqual([null, null]);
  });

  it('keeps fast taps when the tempo is out of range, so later taps can recover', () => {
    const results = tapAll(new TapTempo(), [0, 200, 400, 900, 1400, 1900]);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
    expect(results[3]).toBeNull();
    expect(results[4]).toBeCloseTo(60000 / 350, 6);
    expect(results[5]).toBe(120);
  });
});

describe('tap tempo: limits', () => {
  it('accepts exactly 240 BPM', () => {
    expect(tapAll(new TapTempo(), [0, 250])).toStrictEqual([null, 240]);
  });

  it('accepts exactly 40 BPM', () => {
    expect(tapAll(new TapTempo(), [0, 1500])).toStrictEqual([null, 40]);
  });
});

describe('tap tempo: time not moving forward', () => {
  it('starts over when time goes back', () => {
    const results = tapAll(new TapTempo(), [0, 500, 400, 900]);
    expect(results).toStrictEqual([null, 120, null, 120]);
  });

  it('forgets the earlier taps when time goes back', () => {
    // if the old taps were kept, the last result would come from the intervals 500, 500, -600, 400
    const results = tapAll(new TapTempo(), [0, 500, 1000, 400, 800]);
    expect(results).toStrictEqual([null, 120, 120, null, 150]);
  });

  it('starts over when the time repeats', () => {
    const results = tapAll(new TapTempo(), [0, 500, 500]);
    expect(results[2]).toBeNull();
  });
});

describe('tap tempo: non-finite times', () => {
  it('ignores NaN and Infinity without changing the taps', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBe(120);
    expect(t.tap(NaN)).toBeNull();
    expect(t.tap(Infinity)).toBeNull();
    expect(t.tap(1000)).toBe(120);
  });
});

describe('tap tempo: reset', () => {
  it('forgets all taps', () => {
    const t = new TapTempo();
    tapAll(t, [0, 500, 1000]);
    t.reset();
    expect(t.tap(1400)).toBeNull();
    expect(t.tap(1800)).toBe(150);
  });
});

describe('tap tempo: option sanitising', () => {
  it('treats window 1 as 2', () => {
    expect(tapAll(new TapTempo({ window: 1 }), [0, 500, 900])).toStrictEqual([null, 120, 150]);
  });

  it('treats window 2.7 as 2', () => {
    expect(tapAll(new TapTempo({ window: 2.7 }), [0, 500, 900])).toStrictEqual([null, 120, 150]);
  });

  it('treats window NaN as 8', () => {
    const results = tapAll(new TapTempo({ window: NaN }), [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4900, 5300, 5700, 6100]);
    expect(results.slice(10)).toStrictEqual([120, 120, 120, 150]);
  });

  it('treats window 100 as 32 (31 intervals)', () => {
    const t = new TapTempo({ window: 100 });
    let now = 0;
    t.tap(now);
    for (let i = 0; i < 40; i++) t.tap((now += 500));
    const results: (number | null)[] = [];
    for (let i = 0; i < 16; i++) results.push(t.tap((now += 400)));
    // 15 short intervals out of 31 are not yet the majority, 16 are
    expect(results[14]).toBe(120);
    expect(results[15]).toBe(150);
  });

  it('treats maxGapMs 0, negative and NaN as 2000', () => {
    for (const maxGapMs of [0, -5, NaN]) {
      expect(tapAll(new TapTempo({ maxGapMs }), [0, 500, 2500])[2], `maxGapMs ${maxGapMs}`).toBe(48);
    }
  });
});
