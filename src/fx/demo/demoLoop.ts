// a synthesised four-on-the-floor demo loop (kick, offbeat hat, clap, offbeat bass), rendered from formulas so the app needs no audio files

import { Biquad } from '../dsp/biquad';
import { NoiseSource } from '../dsp/noise';

/** Tempo used when the requested one is not finite, in BPM. */
const DEFAULT_BPM = 124;
/** Slowest tempo accepted, in BPM. */
const MIN_BPM = 60;
/** Fastest tempo accepted, in BPM. */
const MAX_BPM = 200;
/** Number of bars used when the requested count is not finite. */
const DEFAULT_BARS = 4;
/** Fewest bars accepted. */
const MIN_BARS = 1;
/** Most bars accepted. */
const MAX_BARS = 16;
/** Beats in one bar. */
const BEATS_PER_BAR = 4;
/** Length of the linear fade at the end of every sound, in seconds. */
const END_FADE_SECONDS = 0.005;
/** Peak level of the finished loop: -3 dBFS, as a linear amplitude. */
const TARGET_PEAK = 10 ** (-3 / 20);

/** Kick length, in seconds. */
const KICK_SECONDS = 0.3;
/** Kick pitch at the start of the sound, in Hz. */
const KICK_START_HZ = 120;
/** Kick pitch the sweep settles on, in Hz. */
const KICK_END_HZ = 45;
/** Time constant of the kick pitch sweep, in seconds. */
const KICK_SWEEP_TAU = 0.03;
/** Kick peak level before the final scaling. */
const KICK_LEVEL = 0.9;
/** Time constant of the kick amplitude decay, in seconds. */
const KICK_DECAY_TAU = 0.09;

/** Hat length, in seconds. */
const HAT_SECONDS = 0.05;
/** Corner frequency of the hat high-pass, in Hz. */
const HAT_HIGHPASS_HZ = 7000;
/** Q of the hat high-pass. */
const HAT_HIGHPASS_Q = 0.7;
/** Hat peak level before the final scaling. */
const HAT_LEVEL = 0.25;
/** Time constant of the hat amplitude decay, in seconds. */
const HAT_DECAY_TAU = 0.012;
/** Noise seed of the left hat channel. */
const HAT_SEED_L = 11;
/** Noise seed of the right hat channel. */
const HAT_SEED_R = 12;
/** Position of the hat inside its beat, in beats. */
const OFFBEAT = 0.5;

/** Clap length, in seconds. */
const CLAP_SECONDS = 0.18;
/** Centre frequency of the clap band-pass, in Hz. */
const CLAP_BANDPASS_HZ = 1500;
/** Q of the clap band-pass. */
const CLAP_BANDPASS_Q = 1.2;
/** Clap peak level before the final scaling. */
const CLAP_LEVEL = 0.45;
/** Noise seed of the left clap channel. */
const CLAP_SEED_L = 21;
/** Noise seed of the right clap channel. */
const CLAP_SEED_R = 22;
/** Length of the three short clap pulses, in seconds. */
const CLAP_PULSES_SECONDS = 0.035;
/** Period of one clap pulse, in seconds. */
const CLAP_PULSE_PERIOD = 0.01;
/** Time constant of the clap tail decay, in seconds. */
const CLAP_TAIL_TAU = 0.05;

/** Bass note length, as a fraction of a beat. */
const BASS_BEAT_FRACTION = 0.4;
/** Frequency of the lowest bass note (A1), in Hz. */
const BASS_ROOT_HZ = 55;
/** Bass note offsets above the root in semitones, one per offbeat, repeating every 8. */
const BASS_NOTES: readonly number[] = [0, 0, 0, 3, 0, 0, 5, 3];
/** Level of the second bass harmonic relative to the fundamental. */
const BASS_HARMONIC_2 = 0.35;
/** Level of the third bass harmonic relative to the fundamental. */
const BASS_HARMONIC_3 = 0.15;
/** Bass peak level before the final scaling. */
const BASS_LEVEL = 0.4;
/** Length of the bass attack, in seconds. */
const BASS_ATTACK_SECONDS = 0.005;

/**
 * Renders a short drum and bass loop of `bars` bars at `bpm` BPM as two channels. Throws
 * RangeError unless sampleRate is finite and > 0. A non-finite bpm reads as 124, otherwise it is
 * clamped to 60..200; a non-finite bars reads as 4, otherwise it is floored and clamped to 1..16.
 * The loop starts and ends in silence and peaks at -3 dBFS. Runs once on the page, not on the
 * audio thread, so it allocates freely.
 */
export function renderDemoLoop(sampleRate: number, bpm = DEFAULT_BPM, bars = DEFAULT_BARS): { l: Float32Array; r: Float32Array } {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('renderDemoLoop: sampleRate must be finite and > 0');
  }
  const tempo = Number.isFinite(bpm) ? Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) : DEFAULT_BPM;
  const barCount = Number.isFinite(bars)
    ? Math.min(MAX_BARS, Math.max(MIN_BARS, Math.floor(bars)))
    : DEFAULT_BARS;

  const beats = barCount * BEATS_PER_BAR;
  const beatLen = (60 / tempo) * sampleRate;
  const total = Math.round(beats * beatLen);
  const fade = Math.max(1, Math.round(END_FADE_SECONDS * sampleRate));
  const l = new Float64Array(total);
  const r = new Float64Array(total);
  const out = new Float64Array(2);

  /** Adds a sound at musical position `beat`; `gen(i, out)` writes the left and right sample i. */
  const add = (beat: number, length: number, gen: (i: number, out: Float64Array) => void): void => {
    const start = Math.round(beat * beatLen);
    const end = Math.min(total, start + length);
    for (let n = start; n < end; n++) {
      gen(n - start, out);
      const gain = Math.min(1, (end - 1 - n) / fade);
      l[n] += out[0] * gain;
      r[n] += out[1] * gain;
    }
  };

  const kickLen = Math.round(KICK_SECONDS * sampleRate);
  const hatLen = Math.round(HAT_SECONDS * sampleRate);
  const clapLen = Math.round(CLAP_SECONDS * sampleRate);
  const bassLen = Math.round(BASS_BEAT_FRACTION * beatLen);

  // Kick: sine with a falling pitch, on every beat.
  for (let k = 0; k < beats; k++) {
    let phase = 0;
    add(k, kickLen, (i, o) => {
      const t = i / sampleRate;
      const f = KICK_END_HZ + (KICK_START_HZ - KICK_END_HZ) * Math.exp(-t / KICK_SWEEP_TAU);
      const s = Math.sin(phase) * KICK_LEVEL * Math.exp(-t / KICK_DECAY_TAU);
      phase += (2 * Math.PI * f) / sampleRate;
      o[0] = s;
      o[1] = s;
    });
  }

  // Closed hat: high-passed noise, different noise per channel, on every offbeat.
  const hatNoiseL = new NoiseSource(HAT_SEED_L);
  const hatNoiseR = new NoiseSource(HAT_SEED_R);
  const hatFilterL = new Biquad();
  const hatFilterR = new Biquad();
  hatFilterL.setHighpass(HAT_HIGHPASS_HZ, HAT_HIGHPASS_Q, sampleRate);
  hatFilterR.setHighpass(HAT_HIGHPASS_HZ, HAT_HIGHPASS_Q, sampleRate);
  for (let k = 0; k < beats; k++) {
    hatFilterL.reset();
    hatFilterR.reset();
    add(k + OFFBEAT, hatLen, (i, o) => {
      const level = HAT_LEVEL * Math.exp(-(i / sampleRate) / HAT_DECAY_TAU);
      o[0] = hatFilterL.process(hatNoiseL.white()) * level;
      o[1] = hatFilterR.process(hatNoiseR.white()) * level;
    });
  }

  // Clap: band-passed noise in three short pulses and a tail, on beats 2 and 4 of each bar.
  const clapNoiseL = new NoiseSource(CLAP_SEED_L);
  const clapNoiseR = new NoiseSource(CLAP_SEED_R);
  const clapFilterL = new Biquad();
  const clapFilterR = new Biquad();
  clapFilterL.setBandpass(CLAP_BANDPASS_HZ, CLAP_BANDPASS_Q, sampleRate);
  clapFilterR.setBandpass(CLAP_BANDPASS_HZ, CLAP_BANDPASS_Q, sampleRate);
  for (let k = 1; k < beats; k += 2) {
    clapFilterL.reset();
    clapFilterR.reset();
    add(k, clapLen, (i, o) => {
      const t = i / sampleRate;
      const env =
        t < CLAP_PULSES_SECONDS
          ? 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / CLAP_PULSE_PERIOD)
          : Math.exp(-(t - CLAP_PULSES_SECONDS) / CLAP_TAIL_TAU);
      const level = CLAP_LEVEL * env;
      o[0] = clapFilterL.process(clapNoiseL.white()) * level;
      o[1] = clapFilterR.process(clapNoiseR.white()) * level;
    });
  }

  // Bass: three-harmonic tone with a short attack, on every offbeat.
  for (let k = 0; k < beats; k++) {
    const freq = BASS_ROOT_HZ * 2 ** (BASS_NOTES[k % BASS_NOTES.length] / 12);
    const w = 2 * Math.PI * freq;
    add(k + OFFBEAT, bassLen, (i, o) => {
      const t = i / sampleRate;
      const tone =
        Math.sin(w * t) + BASS_HARMONIC_2 * Math.sin(2 * w * t) + BASS_HARMONIC_3 * Math.sin(3 * w * t);
      const s = tone * BASS_LEVEL * Math.min(1, t / BASS_ATTACK_SECONDS);
      o[0] = s;
      o[1] = s;
    });
  }

  // Scale both channels by the same factor so the largest sample is exactly -3 dBFS.
  let max = 0;
  for (let n = 0; n < total; n++) {
    max = Math.max(max, Math.abs(l[n]), Math.abs(r[n]));
  }
  const scale = max > 0 ? TARGET_PEAK / max : 1;
  const outL = new Float32Array(total);
  const outR = new Float32Array(total);
  for (let n = 0; n < total; n++) {
    outL[n] = l[n] * scale;
    outR[n] = r[n] * scale;
  }
  return { l: outL, r: outR };
}
