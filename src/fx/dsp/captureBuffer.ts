// rolling stereo capture of recent audio, built from two DelayLine instances

import { DelayLine } from './delayLine';

/** Rolling stereo recording of the most recent audio, read back by "samples ago". */
export class CaptureBuffer {
  #left: DelayLine;
  #right: DelayLine;
  #capacity: number;
  #count = 0;

  /** Keeps the last `Math.ceil(maxSamples)` samples. Throws RangeError unless maxSamples is a finite number >= 2. */
  constructor(maxSamples: number) {
    if (!Number.isFinite(maxSamples) || maxSamples < 2) {
      throw new RangeError('CaptureBuffer: maxSamples must be a finite number >= 2');
    }
    this.#capacity = Math.ceil(maxSamples);
    // delays 0..capacity - 1 are readable, which is exactly capacity samples
    this.#left = new DelayLine(this.#capacity - 1);
    this.#right = new DelayLine(this.#capacity - 1);
  }

  /** Records one stereo sample. Non-finite values are stored as 0. */
  write(l: number, r: number): void {
    this.#left.write(l);
    this.#right.write(r);
    if (this.#count < this.#capacity) this.#count++;
  }

  /** Left sample written `ago` samples back: 0 is the newest. Fractional values interpolate. Clamped to [0, capacity - 1]. */
  readL(ago: number): number {
    return this.#left.read(ago);
  }

  /** Right sample written `ago` samples back, same rules as `readL`. */
  readR(ago: number): number {
    return this.#right.read(ago);
  }

  /** How many samples have been recorded since construction or `clear()`, capped at `capacity`. */
  get filled(): number {
    return this.#count;
  }

  /** The number of samples the buffer retains. */
  get capacity(): number {
    return this.#capacity;
  }

  /** Erases the recording and sets `filled` back to 0. */
  clear(): void {
    this.#left.clear();
    this.#right.clear();
    this.#count = 0;
  }
}
