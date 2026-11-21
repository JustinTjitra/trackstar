// three-band crossover: Linkwitz-Riley fourth-order slopes with all-pass phase compensation

import { Biquad } from './biquad';
import { sanitize } from './math';

/** Three-band Linkwitz-Riley (fourth-order) crossover whose bands sum to a flat level. */
export class ThreeBand {
  /** Low band of the most recent `process` call. */
  low = 0;
  /** Mid band of the most recent `process` call. */
  mid = 0;
  /** High band of the most recent `process` call. */
  high = 0;

  #lowLp1 = new Biquad();
  #lowLp2 = new Biquad();
  #lowHp1 = new Biquad();
  #lowHp2 = new Biquad();
  #highLp1 = new Biquad();
  #highLp2 = new Biquad();
  #highHp1 = new Biquad();
  #highHp2 = new Biquad();
  #lowAp = new Biquad();

  /** Throws RangeError unless sampleRate is finite and > 0 and 0 < lowHz < highHz. */
  constructor(sampleRate: number, lowHz = 300, highHz = 3000) {
    if (!Number.isFinite(sampleRate) || !(sampleRate > 0)) {
      throw new RangeError('ThreeBand: sampleRate must be finite and positive');
    }
    if (!Number.isFinite(lowHz) || !Number.isFinite(highHz) || !(lowHz > 0) || !(lowHz < highHz)) {
      throw new RangeError('ThreeBand: need finite frequencies with 0 < lowHz < highHz');
    }
    const q = Math.SQRT1_2;
    this.#lowLp1.setLowpass(lowHz, q, sampleRate);
    this.#lowLp2.setLowpass(lowHz, q, sampleRate);
    this.#lowHp1.setHighpass(lowHz, q, sampleRate);
    this.#lowHp2.setHighpass(lowHz, q, sampleRate);
    this.#highLp1.setLowpass(highHz, q, sampleRate);
    this.#highLp2.setLowpass(highHz, q, sampleRate);
    this.#highHp1.setHighpass(highHz, q, sampleRate);
    this.#highHp2.setHighpass(highHz, q, sampleRate);
    this.#lowAp.setAllpass(highHz, q, sampleRate);
  }

  /** Splits one sample into `low`, `mid` and `high`. Non-finite input is treated as 0. */
  process(x: number): void {
    const v = sanitize(x);
    const lowPart = this.#lowLp2.process(this.#lowLp1.process(v));
    const highPart = this.#lowHp2.process(this.#lowHp1.process(v));
    this.low = this.#lowAp.process(lowPart);
    this.mid = this.#highLp2.process(this.#highLp1.process(highPart));
    this.high = this.#highHp2.process(this.#highHp1.process(highPart));
  }

  /** Clears all filter memory and the three outputs. */
  reset(): void {
    this.#lowLp1.reset();
    this.#lowLp2.reset();
    this.#lowHp1.reset();
    this.#lowHp2.reset();
    this.#highLp1.reset();
    this.#highLp2.reset();
    this.#highHp1.reset();
    this.#highHp2.reset();
    this.#lowAp.reset();
    this.low = 0;
    this.mid = 0;
    this.high = 0;
  }
}
