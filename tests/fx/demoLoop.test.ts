import { describe, expect, it } from 'vitest';
import { Biquad } from '../../src/fx/dsp/biquad';
import { renderDemoLoop } from '../../src/fx/demo/demoLoop';
import { BpmDetector } from '../../src/fx/tempo/bpmDetector';
import { OnsetDetector } from '../../src/fx/tempo/onset';
import { allFinite, magnitudeAt, peak, rms, toDb } from '../fixtures/synthAudio';

type Loop = { l: Float32Array; r: Float32Array };

const SR = 48000;

/** Renders once per configuration and shares the result between tests. */
const cache = new Map<string, Loop>();
function render(sampleRate: number, bpm = 124, bars = 4): Loop {
  const key = `${sampleRate}/${bpm}/${bars}`;
  let loop = cache.get(key);
  if (!loop) {
    loop = renderDemoLoop(sampleRate, bpm, bars);
    cache.set(key, loop);
  }
  return loop;
}

/** Expected length in samples. */
function expectedLength(sampleRate: number, bpm: number, bars: number): number {
  return Math.round(((bars * 4 * 60) / bpm) * sampleRate);
}

/** Start sample of musical position b (in beats). */
function at(b: number, bpm: number, sampleRate: number): number {
  return Math.round(b * (60 / bpm) * sampleRate);
}

/** Seconds to samples. */
function sec(s: number, sampleRate = SR): number {
  return Math.round(s * sampleRate);
}

type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

/** Runs x through one biquad. */
function filtered(x: Float32Array, kind: FilterKind, freq: number, q: number, sampleRate = SR): Float32Array {
  const f = new Biquad();
  if (kind === 'lowpass') f.setLowpass(freq, q, sampleRate);
  else if (kind === 'highpass') f.setHighpass(freq, q, sampleRate);
  else f.setBandpass(freq, q, sampleRate);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = f.process(x[i]);
  return out;
}

/** True when both buffers hold exactly the same samples. */
function same(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Smallest of a list of ratios. */
function minRatio(ratios: number[]): number {
  return Math.min(...ratios);
}

/** Loops the mono mix of the loop for at least `seconds` and reads the tempo. */
function detectTempo(loop: Loop, sampleRate: number, seconds = 10): { bpm: number; confidence: number } {
  const reps = Math.ceil((seconds * sampleRate) / loop.l.length);
  const mono = new Float32Array(reps * loop.l.length);
  for (let k = 0; k < reps; k++) {
    for (let i = 0; i < loop.l.length; i++) {
      mono[k * loop.l.length + i] = 0.5 * (loop.l[i] + loop.r[i]);
    }
  }
  const onset = new OnsetDetector(sampleRate);
  const det = new BpmDetector(onset.hopRate);
  onset.process(mono, mono.length, (v) => det.push(v));
  const e = det.estimate();
  if (e === null) throw new Error('no tempo estimate');
  return { bpm: e.bpm, confidence: e.confidence };
}

describe('renderDemoLoop length', () => {
  const cases: Array<[number, number, number]> = [
    [48000, 124, 4],
    [44100, 124, 4],
    [48000, 100, 4],
    [48000, 140, 2],
  ];
  for (const [sr, bpm, bars] of cases) {
    it(`is ${bars} bars at ${bpm} BPM and ${sr} Hz long on both channels`, () => {
      const { l, r } = render(sr, bpm, bars);
      expect(l.length).toBe(expectedLength(sr, bpm, bars));
      expect(r.length).toBe(expectedLength(sr, bpm, bars));
    });
  }

  it('uses 124 BPM and 4 bars by default, sample for sample', () => {
    const d = renderDemoLoop(48000);
    const e = render(48000, 124, 4);
    expect(d.l.length).toBe(371613);
    expect(same(d.l, e.l)).toBe(true);
    expect(same(d.r, e.r)).toBe(true);
  });
});

describe('renderDemoLoop level', () => {
  for (const sr of [48000, 44100]) {
    it(`peaks at -3 dBFS over both channels at ${sr} Hz`, () => {
      const { l, r } = render(sr);
      const p = Math.max(peak(l), peak(r));
      expect(Math.abs(toDb(p) - -3)).toBeLessThan(0.01);
    });
  }
});

describe('renderDemoLoop determinism', () => {
  it('renders identically twice and stays finite', () => {
    const a = render(SR);
    const b = renderDemoLoop(SR, 124, 4);
    expect(same(a.l, b.l)).toBe(true);
    expect(same(a.r, b.r)).toBe(true);
    expect(allFinite(a.l)).toBe(true);
    expect(allFinite(a.r)).toBe(true);
  });
});

describe('renderDemoLoop seam', () => {
  it('starts and ends in silence so the loop can repeat without a click', () => {
    const { l, r } = render(SR);
    const n = l.length;
    for (const x of [l, r]) {
      expect(peak(x.subarray(n - 32))).toBeLessThan(0.01);
      expect(Math.abs(x[0])).toBeLessThan(0.01);
      expect(Math.abs(x[0] - x[n - 1])).toBeLessThan(0.01);
    }
  });

  it('cuts off a kick that would run past the end with a fade, not a click', () => {
    // At 200 BPM a beat is 0.3 s, the kick length, and rounding may push it over the end.
    const { l, r } = render(SR, 200, 1);
    for (const x of [l, r]) {
      expect(peak(x.subarray(x.length - 32))).toBeLessThan(0.01);
    }
  });
});

describe('renderDemoLoop tempo', () => {
  const cases: Array<[number, number, number]> = [
    [48000, 124, 4],
    [44100, 124, 4],
    [48000, 100, 4],
    [48000, 140, 2],
  ];
  for (const [sr, bpm, bars] of cases) {
    it(`reads ${bpm} BPM at ${sr} Hz when looped`, () => {
      const e = detectTempo(render(sr, bpm, bars), sr);
      expect(Math.abs(e.bpm - bpm)).toBeLessThan(1);
      expect(e.confidence).toBeGreaterThan(0.7);
    });
  }
});

describe('renderDemoLoop pattern', () => {
  const bpm = 124;
  const { l, r } = render(SR, bpm, 4);
  const beats = 16;

  it('has a kick on every beat', () => {
    const low = filtered(l, 'lowpass', 150, Math.SQRT1_2);
    const ratios: number[] = [];
    for (let k = 1; k < beats; k++) {
      const s = at(k, bpm, SR);
      const after = rms(low, s, s + sec(0.06));
      const before = rms(low, s - sec(0.04), s);
      ratios.push(after / before);
    }
    expect(minRatio(ratios)).toBeGreaterThanOrEqual(3);
  });

  it('has a kick whose pitch falls to about 45 Hz', () => {
    // beats 1 and 3 have no clap; 100 to 230 ms after the beat only the tail of the kick sounds
    for (const k of [0, 2, 8]) {
      const start = at(k, bpm, SR);
      const tail = l.subarray(start + sec(0.1), start + sec(0.23));
      expect(magnitudeAt(tail, 45, SR)).toBeGreaterThan(2 * magnitudeAt(tail, 90, SR));
    }
  });

  it('has a hat on every offbeat', () => {
    const high = filtered(l, 'highpass', 6000, Math.SQRT1_2);
    const ratios: number[] = [];
    const later: number[] = [];
    for (let k = 0; k < beats; k++) {
      const s = at(k + 0.5, bpm, SR);
      const hit = rms(high, s, s + sec(0.03));
      ratios.push(hit / rms(high, s - sec(0.04), s));
      // The bass note starting on the same offbeat also has a little high content; the hat must
      // stand well above what is left of the note once the hat has died away.
      later.push(hit / rms(high, s + sec(0.04), s + sec(0.07)));
    }
    expect(minRatio(ratios)).toBeGreaterThanOrEqual(5);
    expect(minRatio(later)).toBeGreaterThanOrEqual(10);
  });

  it('has claps on beats 2 and 4 only', () => {
    // two high-passes at 800 Hz in a row: steep enough to keep the kick out (a single band-pass lets it through)
    const band = filtered(filtered(l, 'highpass', 800, Math.SQRT1_2), 'highpass', 800, Math.SQRT1_2);
    const odd: number[] = [];
    const even: number[] = [];
    for (let k = 0; k < beats; k++) {
      const s = at(k, bpm, SR);
      (k % 2 === 1 ? odd : even).push(rms(band, s, s + sec(0.1)));
    }
    // measured 21: beats 2 and 4 carry the clap, beats 1 and 3 only the kick
    expect(Math.min(...odd) / Math.max(...even)).toBeGreaterThanOrEqual(5);
  });

  it('plays the bass notes of the pattern', () => {
    const freqs = [55.0, 65.41, 73.42];
    const beatLen = (60 / bpm) * SR;
    const noteLen = Math.round(0.4 * beatLen);
    const expectedIndex: Record<number, number> = { 0: 0, 3: 1, 6: 2, 11: 1 };
    const ratios: number[] = [];
    for (const k of [0, 3, 6, 11]) {
      const s = at(k + 0.5, bpm, SR);
      const win = l.subarray(s + sec(0.03), s + noteLen - sec(0.03));
      const mags = freqs.map((f) => magnitudeAt(win, f, SR));
      const want = expectedIndex[k];
      for (let j = 0; j < mags.length; j++) {
        if (j !== want) {
          expect(mags[want]).toBeGreaterThan(mags[j]);
          ratios.push(mags[want] / mags[j]);
        }
      }
    }
    expect(minRatio(ratios)).toBeGreaterThan(1);
  });

  it('keeps the kick and bass in the centre and the hats and claps wide', () => {
    const ll = filtered(l, 'lowpass', 150, Math.SQRT1_2);
    const lr = filtered(r, 'lowpass', 150, Math.SQRT1_2);
    const diff = new Float32Array(ll.length);
    for (let i = 0; i < diff.length; i++) diff[i] = ll[i] - lr[i];
    expect(rms(diff) / rms(ll)).toBeLessThan(0.01);

    let differ = 0;
    for (let i = 0; i < l.length; i++) if (l[i] !== r[i]) differ++;
    expect(differ).toBeGreaterThan(l.length / 100);

    // The clap region itself differs between channels.
    const s = at(1, bpm, SR);
    let clapDiff = 0;
    for (let i = s; i < s + sec(0.1); i++) if (l[i] !== r[i]) clapDiff++;
    expect(clapDiff).toBeGreaterThan(sec(0.1) / 2);
  });
});

describe('renderDemoLoop arguments', () => {
  it('throws RangeError for a bad sample rate', () => {
    for (const sr of [0, -1, NaN, Infinity]) {
      expect(() => renderDemoLoop(sr)).toThrow(RangeError);
    }
  });

  it('treats a non-finite bpm as 124 and clamps to 60..200', () => {
    expect(renderDemoLoop(8000, NaN, 1).l.length).toBe(expectedLength(8000, 124, 1));
    expect(renderDemoLoop(8000, 10, 1).l.length).toBe(expectedLength(8000, 60, 1));
    expect(renderDemoLoop(8000, 1000, 1).l.length).toBe(expectedLength(8000, 200, 1));
  });

  it('treats non-finite bars as 4, floors, and clamps to 1..16', () => {
    expect(renderDemoLoop(8000, 124, NaN).l.length).toBe(expectedLength(8000, 124, 4));
    expect(renderDemoLoop(8000, 124, 0).l.length).toBe(expectedLength(8000, 124, 1));
    expect(renderDemoLoop(8000, 124, 100).l.length).toBe(expectedLength(8000, 124, 16));
    expect(renderDemoLoop(8000, 124, 2.9).l.length).toBe(expectedLength(8000, 124, 2));
  });
});
