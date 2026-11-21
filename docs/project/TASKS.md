# Task queue

The loop works through this file top to bottom, one task per run, following [LOOP.md](LOOP.md). Background and reasons are in [PROJECT.md](PROJECT.md).

**Status values:** `todo`, `done`, `blocked` (with a note). **Types:** `agent` (the loop does it), `human` (only the project owner can). **Models:** the implementer's model for that task.

Each entry's `spec` fixes names and behaviour so tasks fit together. The planner expands it into a full brief at run time and reads real signatures from the code for anything a task consumes.

## Gates

A gate is opened by the project owner editing this table. The loop never opens one.

| Gate | Status | What it decides | Blocks |
|---|---|---|---|
| G2 | closed | The FX gesture mapping in PROJECT.md 3.3 is approved or changed | F060 to F068 |
| G3 | closed | Deck Screen data path (mirror mode or Mixxx) and hardware tier | S004, S012 to S015 |
| G4 | closed | Whether to build the optional encoder board | S020 |

## Owner tasks

### H1 Audio routing test on the Mac (about 10 minutes, do this first)
- status: todo | type: human
- why: decides whether FX mode can sit on the live master. Nothing found online confirms it for rekordbox Free with an FLX2.
- steps:
  1. Install BlackHole 2ch (`brew install blackhole-2ch`, or the installer from the BlackHole GitHub page).
  2. Open Audio MIDI Setup. Create an Aggregate Device containing DDJ-FLX2 and BlackHole 2ch. Set the FLX2 as clock source, tick drift correction on BlackHole, and give both the same sample rate.
  3. In rekordbox, Preferences > Audio: choose the aggregate as the audio device. Set Master Output to the BlackHole channel pair and Headphones Output to the FLX2's channels 3-4. Turn PC MASTER OUT off.
  4. Play a track.
- write the answers here:
  - Does rekordbox list the aggregate device? 
  - Does Performance mode stay unlocked with the aggregate selected?
  - Can you assign Master and Headphones to different channel pairs?
  - Do you hear the cue in your headphones?
  - Does audio arrive on BlackHole (check with QuickTime > New Audio Recording, input BlackHole 2ch)?

### H2 Do stems work on your plan? (2 minutes)
- status: todo | type: human
- why: stem separation may be a paid feature. If the ActiveStem buttons do nothing in rekordbox, the three stem gestures do nothing either and the README should say so.
- write the answer here:

### H3 Real-hand test of the core controller
- status: todo | type: human
- steps: run the app, follow the README's manual check with the FLX2. If a gesture misfires, open the app with `?record`, reproduce it, and add the downloaded JSON to `tests/fixtures/recordings/`.
- notes:

### H5 Listen and tune (after F068)
- status: todo | type: human
- steps: play with FX mode on the demo source and, if H1 passed, on the live master. Note which effects sound wrong, too strong or too weak, and the latency the app reports.
- notes:

### H7 Caliper measurements (before any printing)
- status: todo | type: human
- measure on your controller, in mm, and write into `hardware/params/flx2.yaml`:
  - gap between the desk and the underside at the rear edge (how thick a tongue can slide under)
  - foot positions and foot height
  - height of the top panel above the desk, and of the tallest knob or fader cap
  - position and size of the rear USB-C port and the Kensington slot, measured from the left edge
  - position of the two 3.5 mm jacks on the left side
  - corner radius of the case, top view
- also measure the display you buy: outer size, active area, thickness, connector positions, mounting holes.

### H8 Print or order, assemble, report
- status: todo | type: human
- steps: print the test coupon first, then the parts. Note anything that does not fit.
- notes:

---

## Phase 1: FX mode

All paths are relative to the repository root. Acceptance commands are run in addition to the full check suite.

### F000 Synthetic audio test helpers
- status: done | type: agent | model: haiku | deps: none | gate: none
- files: `tests/fixtures/synthAudio.ts`, `tests/fx/synthAudio.test.ts`
- spec: export
  - `sine(freq: number, seconds: number, sampleRate: number, amp = 1): Float32Array`
  - `impulse(length: number, at = 0): Float32Array`, `silence(length: number): Float32Array`
  - `noise(length: number, seed = 1, amp = 1): Float32Array` (uniform white, seeded, deterministic)
  - `clickTrack(bpm: number, seconds: number, sampleRate: number, opts?: { clickMs?: number; amp?: number }): Float32Array` (short decaying bursts exactly `60 / bpm` seconds apart, first at sample 0)
  - `rms(x: Float32Array, from = 0, to = x.length): number`, `peak(x: Float32Array): number`, `toDb(linear: number): number` (returns -200 for 0)
  - `magnitudeAt(x: Float32Array, freq: number, sampleRate: number): number` (Goertzel amplitude estimate; a full-scale sine at `freq` reads about 1)
  - `allFinite(x: Float32Array): boolean`
  - `runBlocks(fn: (l: Float32Array, r: Float32Array, frames: number) => void, l: Float32Array, r: Float32Array, block = 128): void` (calls `fn` on consecutive subarray views)
- tests: sine RMS equals amp / sqrt(2) within 1%; `magnitudeAt` reads about 1 at the sine's frequency and under 0.02 two octaves away; click spacing in samples; noise is identical for equal seeds and different for different seeds; `runBlocks` covers every sample once.
- accept: `npx vitest run tests/fx/synthAudio.test.ts`

### F001 Shared types and maths helpers
- status: done | type: agent | model: haiku | deps: none | gate: none
- files: `src/fx/types.ts`, `src/fx/dsp/math.ts`, `tests/fx/math.test.ts`
- spec:
  - `types.ts`: `interface StereoEffect { process(l: Float32Array, r: Float32Array, frames: number): void; reset(): void }`, `interface TempoAware { setBpm(bpm: number): void }`, `type SceneSlot = 0 | 1 | 2 | 3 | 4`, `type SceneDirection = 'up' | 'down'`, `type ReleaseType = 'brake' | 'echo' | 'backspin'`, `type RollDivision = 1 | 0.5 | 0.25 | 0.125`.
  - `math.ts`: `TAU`, `clamp(x, lo, hi)`, `clamp01(x)`, `lerp(a, b, t)`, `expLerp(a, b, t)` (geometric interpolation for frequencies, a and b > 0), `dbToGain(db)`, `gainToDb(gain)` (-Infinity for gain <= 0), `beatsToSamples(beats, bpm, sampleRate)`, `sanitize(x)` (non-finite becomes 0).
- tests: each function, including edge cases (clamp with NaN returns lo, `expLerp(100, 10000, 0.5)` is 1000).
- accept: `npx vitest run tests/fx/math.test.ts`

### F002 Parameter smoother
- status: done | type: agent | model: haiku | deps: F001 | gate: none
- files: `src/fx/dsp/smoother.ts`, `tests/fx/smoother.test.ts`
- spec: `class Smoother { constructor(sampleRate: number, timeMs: number, initial = 0); setTarget(v: number): void; jump(v: number): void; next(): number; get value(): number; get target(): number; isSettled(eps = 1e-4): boolean }`. One-pole exponential: after `timeMs` the value has covered about 63% of a step.
- tests: 63% point within 5% at 44100 and 48000; converges; `jump` is immediate; `next` with no target change returns the same value.
- accept: `npx vitest run tests/fx/smoother.test.ts`

### F003 Fractional delay line
- status: done | type: agent | model: sonnet | deps: F000, F001 | gate: none
- files: `src/fx/dsp/delayLine.ts`, `tests/fx/delayLine.test.ts`
- spec: `class DelayLine { constructor(maxDelaySamples: number); write(x: number): void; read(delaySamples: number): number; clear(): void; get maxDelay(): number }`. `read(0)` returns the most recently written sample, `read(n)` the sample written n writes earlier. Fractional delays use linear interpolation. Delays are clamped to `[0, maxDelay]`.
- tests: an impulse comes back after exactly N samples; `read(10.5)` is the mean of the neighbours; reads before anything is written are 0; wraps correctly past the buffer length; `clear`.
- accept: `npx vitest run tests/fx/delayLine.test.ts`

### F004 Biquad filter
- status: done | type: agent | model: sonnet | deps: F000, F001 | gate: none
- files: `src/fx/dsp/biquad.ts`, `tests/fx/biquad.test.ts`
- spec: Audio EQ Cookbook (Robert Bristow-Johnson) coefficients, transposed direct form II. `class Biquad { setLowpass(freq, q, sampleRate): void; setHighpass(freq, q, sampleRate): void; setBandpass(freq, q, sampleRate): void` (0 dB peak gain) `; setAllpass(freq, q, sampleRate): void; process(x: number): number; reset(): void }`. Frequencies are clamped to `[10, 0.45 * sampleRate]`.
- tests: lowpass at 1 kHz (q 0.707) passes 100 Hz within 0.5 dB and cuts 8 kHz by more than 30 dB; highpass mirrored; bandpass passes its centre within 0.5 dB and cuts two octaves away by more than 10 dB at q 2; allpass keeps level within 0.1 dB; output finite at the frequency clamps.
- accept: `npx vitest run tests/fx/biquad.test.ts`

### F005 State variable filter
- status: done | type: agent | model: sonnet | deps: F000, F001 | gate: none
- files: `src/fx/dsp/svf.ts`, `tests/fx/svf.test.ts`
- spec: trapezoidal (TPT) state variable filter, the standard Zavalishin / Cytomic formulation, safe when the cutoff changes every sample. `class Svf { constructor(sampleRate: number); set(freq: number, q: number): void; process(x: number): void; lp: number; bp: number; hp: number; reset(): void }` (`process` updates the three output fields).
- tests: same pass and stop band checks as the biquad for lp, hp and bp; sweeping the cutoff from 200 Hz to 8 kHz once per sample over noise stays finite with peak under 4 times the input peak.
- accept: `npx vitest run tests/fx/svf.test.ts`

### F006 Three-band crossover
- status: done | type: agent | model: sonnet | deps: F004 | gate: none
- files: `src/fx/dsp/crossover.ts`, `tests/fx/crossover.test.ts`
- spec: fourth-order Linkwitz-Riley splits (two cascaded Butterworth biquads per slope) at `lowHz` and `highHz`, with the low band passed through an allpass matching the upper split so the three bands sum flat. `class ThreeBand { constructor(sampleRate: number, lowHz = 300, highHz = 3000); process(x: number): void; low: number; mid: number; high: number; reset(): void }`.
- tests: `low + mid + high` has the input's level within 0.5 dB for sines at 50, 300, 1000, 3000 and 10000 Hz; at 100 Hz the low band is within 1 dB and the high band under -40 dB; at 10 kHz the reverse.
- accept: `npx vitest run tests/fx/crossover.test.ts`

### F007 Noise source
- status: done | type: agent | model: haiku | deps: F000, F004 | gate: none
- files: `src/fx/dsp/noise.ts`, `tests/fx/noise.test.ts`
- spec: `class NoiseSource { constructor(seed = 1); white(): number` (uniform, -1..1) `; pink(): number` (Paul Kellett's economy pink filter over white, scaled to stay within about -1..1) `; reseed(seed: number): void }`. Seeded integer PRNG, no `Math.random`.
- tests: deterministic per seed; white has mean near 0 and RMS near 0.577; pink has a clearly larger share of its energy below 200 Hz than white does (compare lowpassed RMS over total RMS, pink at least 3 times white).
- accept: `npx vitest run tests/fx/noise.test.ts`

### F008 Bit crusher
- status: done | type: agent | model: haiku | deps: F000, F001 | gate: none
- files: `src/fx/dsp/crusher.ts`, `tests/fx/crusher.test.ts`
- spec: `class Crusher { setBits(bits: number): void` (1..16, fractional allowed) `; setDownsample(factor: number): void` (>= 1, sample-and-hold every `factor` samples, fractional allowed) `; process(x: number): number; reset(): void }`.
- tests: 16 bits and factor 1 changes a sine by less than 1e-4; 4 bits gives at most 17 distinct output values on a ramp; factor 4 holds each value for 4 samples.
- accept: `npx vitest run tests/fx/crusher.test.ts`

### F009 Reverb
- status: done | type: agent | model: sonnet | deps: F000, F001, F003 | gate: none
- files: `src/fx/dsp/reverb.ts`, `tests/fx/reverb.test.ts`
- spec: the public-domain Freeverb structure (eight parallel damped feedback comb filters into four series allpass filters per channel, right channel offset by the stereo spread), with the standard 44.1 kHz delay lengths scaled by `sampleRate / 44100`. Implement from the structure description; write our own code. `class Reverb { constructor(sampleRate: number); setRoomSize(v: number): void; setDamping(v: number): void; process(inL: number, inR: number): void; outL: number; outR: number` (wet only) `; reset(): void }`.
- tests: silence in gives exact silence out; an impulse leaves a tail (RMS from 50 to 150 ms above -60 dB); the tail at 3.0 s is at least 20 dB below the tail at 0.1 s for room size 0.5; a larger room rings longer; 5 s of noise at room 1, damping 0 stays finite; left and right outputs differ.
- accept: `npx vitest run tests/fx/reverb.test.ts`

### F010 Beat clock
- status: done | type: agent | model: haiku | deps: F001 | gate: none
- files: `src/fx/dsp/beatClock.ts`, `tests/fx/beatClock.test.ts`
- spec: `class BeatClock { constructor(sampleRate: number); setBpm(bpm: number): void` (clamped 40..240) `; get bpm(): number; get samplesPerBeat(): number; advance(frames: number): void; get beats(): number` (fractional beats since reset) `; setBeats(b: number): void; phase(division: number): number` (0..1 inside the current division, division in beats) `; samplesToNext(division: number): number; reset(): void }`.
- tests: at 120 BPM and 48 kHz `samplesPerBeat` is 24000; after advancing 12000, `phase(1)` is 0.5, `phase(0.5)` is 0 and `samplesToNext(1)` is 12000; BPM changes keep the beat position.
- accept: `npx vitest run tests/fx/beatClock.test.ts`

### F011 Stereo capture buffer
- status: done | type: agent | model: haiku | deps: F003 | gate: none
- files: `src/fx/dsp/captureBuffer.ts`, `tests/fx/captureBuffer.test.ts`
- spec: a rolling stereo recording of the most recent audio, built on two `DelayLine`s. `class CaptureBuffer { constructor(maxSamples: number); write(l: number, r: number): void; readL(ago: number): number; readR(ago: number): number` (`ago` 0 = newest, fractional allowed) `; get filled(): number` (valid samples, capped at max) `; get capacity(): number; clear(): void }`.
- tests: reads return what was written at the right offset for both channels; `filled` counts up and caps; `clear`.
- accept: `npx vitest run tests/fx/captureBuffer.test.ts`

### F012 Soft clip and limiter
- status: done | type: agent | model: sonnet | deps: F000, F001 | gate: none
- files: `src/fx/dsp/limiter.ts`, `tests/fx/limiter.test.ts`
- spec: `softClip(x: number): number` (identity within 1e-6 for |x| <= 0.5, smooth knee above, monotonic, |output| <= 1). `class Limiter { constructor(sampleRate: number, ceiling = 0.98, releaseMs = 80); process(l: Float32Array, r: Float32Array, frames: number): void; get gain(): number` (current gain, 1 = no reduction) `; reset(): void }`. Stereo-linked peak limiter: gain drops instantly so no sample exceeds the ceiling, then recovers exponentially.
- tests: a signal below the ceiling passes unchanged (exactly); a sine of amplitude 2 comes out with peak <= ceiling + 1e-6; gain is back above 0.99 within 5 release times after the loud part ends; both channels get the same gain; `softClip` properties.
- accept: `npx vitest run tests/fx/limiter.test.ts`

### F020 Filter echo
- status: done | type: agent | model: sonnet | deps: F002, F003, F005, F010 | gate: none
- files: `src/fx/effects/echo.ts`, `tests/fx/echo.test.ts`
- spec: tempo-synced stereo feedback delay with a filter in the feedback path. Covers Echo, BPF Echo, HPF Echo and LPF Echo. `type EchoFilter = 'none' | 'bpf' | 'hpf' | 'lpf'`. `class FilterEcho implements StereoEffect, TempoAware { constructor(sampleRate: number, opts: { filter: EchoFilter }); setBpm(bpm: number): void; setAmount(v: number): void; setBeats(beats: number): void` (0.25, 0.5, 0.75 or 1; default 0.75) `; process(...); reset() }`.
  - Dry signal always passes at unity. Wet level = amount. Feedback = 0.85 x amount. Both smoothed (20 ms). Delay time changes are smoothed (50 ms).
  - Filter cutoff follows the amount geometrically: bpf centre 500 to 3000 Hz (q 1.2), hpf 200 to 2500 Hz, lpf 8000 to 600 Hz.
  - At amount 0 the output equals the input exactly.
- tests: identity at amount 0; an impulse at 120 BPM, 0.75 beats, amount 0.5 produces echoes at multiples of the delay with falling level, each about the feedback ratio below the last (within 2 dB, filter 'none'); with 'lpf', the second echo of a noise burst has lost more 8 kHz than 200 Hz compared with 'none'; 10 s of noise at amount 1 stays finite with peak under 4; BPM change moves the echo spacing.
- accept: `npx vitest run tests/fx/echo.test.ts`

### F021 Crush echo
- status: todo | type: agent | model: sonnet | deps: F008, F020 | gate: none
- files: `src/fx/effects/echo.ts`, `tests/fx/echo.test.ts`
- spec: add `crush?: boolean` to the `FilterEcho` options. When true, a `Crusher` sits in the feedback path: bits 12 down to 5 and downsample factor 1 up to 6 as the amount goes 0 to 1. Behaviour without `crush` must not change.
- tests: existing tests still pass; with `crush`, echoes of a sine contain harmonics a clean echo does not (energy at a non-harmonic probe frequency rises); identity at amount 0 still holds.
- planner note: the crusher in the loop must run with `setTruncate(true)` (see LOG, F008 follow-up), otherwise the tail never dies at high amounts. The tests must include the tail reaching exact silence at amount 1.
- accept: `npx vitest run tests/fx/echo.test.ts`

### F022 Noise sweep
- status: todo | type: agent | model: sonnet | deps: F002, F005, F007 | gate: none
- files: `src/fx/effects/noiseSweep.ts`, `tests/fx/noiseSweep.test.ts`
- spec: `class NoiseSweep implements StereoEffect { constructor(sampleRate: number, seed = 7); setAmount(v: number): void; process(...); reset() }`. Adds band-passed white noise to the untouched dry signal. Noise level = 0.5 x amount squared. Band-pass centre moves geometrically from 300 Hz to 9 kHz with the amount (q 0.8). Left and right use different seeds.
- tests: identity at amount 0; silence in at amount 1 gives output RMS between -20 and -3 dBFS; the share of energy above 4 kHz is higher at amount 0.9 than at 0.2; deterministic; left differs from right.
- accept: `npx vitest run tests/fx/noiseSweep.test.ts`

### F023 Spiral
- status: todo | type: agent | model: sonnet | deps: F002, F003, F010 | gate: none
- files: `src/fx/effects/spiral.ts`, `tests/fx/spiral.test.ts`
- spec: a feedback delay whose repeats rise or fall in pitch. `class Spiral implements StereoEffect, TempoAware { constructor(sampleRate: number, direction: SceneDirection); setBpm(bpm): void; setAmount(v: number): void; process(...); reset() }`.
  - Feedback loop with base delay 0.5 beat. Inside the loop, a two-tap crossfading delay-line pitch shifter (60 ms window, triangular crossfade between taps) shifts each pass by `2^(+-4 x amount / 12)`: up to 4 semitones per repeat, upward for 'up', downward for 'down'.
  - Wet level = amount, feedback = 0.8 x amount, smoothed. Dry at unity. Identity at amount 0.
- tests: identity at amount 0; a 0.2 s burst of 440 Hz at 120 BPM, amount 1, direction 'up': in the first echo window the level at 440 x 2^(4/12) Hz exceeds the level at 440 Hz, and in the second window 440 x 2^(8/12) dominates 440 x 2^(4/12); mirrored for 'down'; 10 s of noise at amount 1 stays finite with peak under 4.
- accept: `npx vitest run tests/fx/spiral.test.ts`

### F024 Reverb sweep
- status: todo | type: agent | model: sonnet | deps: F002, F005, F009 | gate: none
- files: `src/fx/effects/reverbSweep.ts`, `tests/fx/reverbSweep.test.ts`
- spec: `class ReverbSweep implements StereoEffect { constructor(sampleRate: number, direction: SceneDirection); setAmount(v: number): void; process(...); reset() }`.
  - Wet reverb level = 0.9 x amount; room size 0.5 to 0.95 with the amount. Dry at unity.
  - The dry + wet mix then passes a filter whose cutoff follows the amount geometrically: 'up' is a high-pass from 20 Hz to 1500 Hz, 'down' is a low-pass from 18 kHz to 500 Hz. Below amount 0.001 the filter is crossfaded out so the output equals the input exactly.
- tests: identity at amount 0; 'up' at amount 1 cuts a 100 Hz sine by more than 20 dB; 'down' at amount 1 cuts an 8 kHz sine by more than 20 dB; an impulse at amount 0.7 leaves a tail (RMS from 200 to 400 ms above -50 dB); finite under noise.
- planner note (from F009): the reverb's gain at 0 Hz is `0.72 / (1 - feedback)`, which is 4.5 at room size 0.5 and about 21 at 0.95, because all eight combs reinforce each other there. Music has little energy that low, but the brief for this task should high-pass the signal sent into the reverb (about 120 Hz, a `Biquad` or `Svf`) so bass and any offset cannot build up, and its tests should include a steady (0 Hz) input staying bounded.
- accept: `npx vitest run tests/fx/reverbSweep.test.ts`

### F025 Isolator
- status: todo | type: agent | model: sonnet | deps: F002, F006 | gate: none
- files: `src/fx/effects/isolator.ts`, `tests/fx/isolator.test.ts`
- spec: `class Isolator implements StereoEffect { constructor(sampleRate: number); setLow(v: number): void; setMid(v: number): void; setHigh(v: number): void; process(...); reset() }`. Each band control is 0..1: 0 kills the band, 0.5 is unity, 1 is +6 dB. Gain curve: below 0.5, `(v / 0.5)^2`; above, linear from 1 to `dbToGain(6)`. Gains smoothed over 20 ms.
- tests: all at 0.5 keeps sines at 60 Hz, 1 kHz and 10 kHz within 0.5 dB; low at 0 cuts 60 Hz by more than 40 dB while 5 kHz stays within 1 dB; high at 1 lifts 10 kHz by 6 dB within 1 dB.
- accept: `npx vitest run tests/fx/isolator.test.ts`

### F026 Beat roll
- status: todo | type: agent | model: sonnet | deps: F010, F011 | gate: none
- files: `src/fx/effects/roll.ts`, `tests/fx/roll.test.ts`
- spec: `class Roll implements StereoEffect, TempoAware { constructor(sampleRate: number, maxSeconds = 4); setBpm(bpm): void; start(division: RollDivision): void; stop(): void; get active(): boolean; process(...); reset() }`.
  - Input is always recorded. `start` freezes the most recent `division` beats into a preallocated loop buffer and repeats it until `stop`. If less audio has been recorded than requested, the slice is shortened; with none recorded, `start` does nothing.
  - 3 ms crossfade at the loop seam; 5 ms crossfade between live and roll on start and stop.
  - Inactive: output equals input exactly.
- tests: identity when inactive; after `start(0.5)` at 120 BPM and 48 kHz the output is periodic with period 12000 samples over three periods (outside the seam crossfade); the loop content matches the last 12000 input samples before `start`; after `stop` the output equals the live input within 10 ms.
- accept: `npx vitest run tests/fx/roll.test.ts`

### F027 Release effects
- status: todo | type: agent | model: sonnet | deps: F010, F011, F020 | gate: none
- files: `src/fx/effects/release.ts`, `tests/fx/release.test.ts`
- spec: `class ReleaseFx implements StereoEffect, TempoAware { constructor(sampleRate: number, maxSeconds = 4); setBpm(bpm): void; trigger(type: ReleaseType, beats = 2): void; get active(): boolean; consumeFinished(): boolean` (true once after a release ends) `; process(...); reset() }`. Input is always recorded.
  - `brake`: plays the recording with the playback rate falling linearly from 1 to 0 over `beats` beats, with a short fade at the end. Live input is not heard.
  - `backspin`: the rate goes from 1 to -4 during the first eighth of the duration and stays there while the level fades linearly to 0 over the whole duration.
  - `echo`: live input fades out over 10 ms; an internal echo (0.5 beat, feedback 0.6) of the last audio rings out for `2 x beats` beats.
  - Afterwards the live input fades back in over 10 ms. Inactive: output equals input exactly.
- tests: identity when inactive; a brake on a 1 kHz sine lasts `beats x samplesPerBeat` within 20 ms, and the zero-crossing rate falls across four equal sub-windows; backspin ends in silence and stays finite; echo output level decays over time; after any release, output equals live input again; `consumeFinished` is true exactly once.
- accept: `npx vitest run tests/fx/release.test.ts`

### F030 Scene manager
- status: todo | type: agent | model: sonnet | deps: F021, F022, F023, F024 | gate: none
- files: `src/fx/scene.ts`, `tests/fx/scene.test.ts`
- spec: `const SCENE_TABLE: Record<SceneSlot, { up: string; down: string }>` = slot 0 `BPF ECHO` / `HPF ECHO`, 1 `ECHO` / `LPF ECHO`, 2 `NOISE` / `CRUSH ECHO`, 3 `SPIRAL UP` / `SPIRAL DOWN`, 4 `REVERB UP` / `REVERB DOWN`. `class SceneFx implements StereoEffect, TempoAware { constructor(sampleRate: number); setBpm(bpm): void; setSlot(slot: SceneSlot): void; setAmount(v: number): void` (-1..1: positive drives the slot's build-up effect, negative its break-down effect) `; get slot(): SceneSlot; get amount(): number; process(...); reset() }`.
  - All ten effects are constructed up front; only the active one is processed.
  - On a slot change or a sign flip the outgoing effect is reset, and a 10 ms crossfade from the dry signal hides the switch.
  - At amount 0 the output equals the input exactly.
- tests: identity at 0; each of the ten slot and sign combinations at 0.7 changes a noise signal (difference above -40 dB) and stays finite; switching slots mid-stream on a sine adds no step larger than the input's largest step plus 0.2; table contents.
- accept: `npx vitest run tests/fx/scene.test.ts`

### F031 Effects engine
- status: todo | type: agent | model: sonnet | deps: F012, F025, F026, F027, F030 | gate: none
- files: `src/fx/engine.ts`, `tests/fx/engine.test.ts`
- spec: `class FxEngine { constructor(sampleRate: number); setBpm(bpm: number): void; setBypass(on: boolean): void; setSceneSlot(slot: SceneSlot): void; setSceneAmount(v: number): void; setIsolator(low: number, mid: number, high: number): void; rollStart(division: RollDivision): void; rollStop(): void; release(type: ReleaseType, beats?: number): void; process(l: Float32Array, r: Float32Array, frames: number): void; state(): EngineState; reset(): void }` with `interface EngineState { bypass: boolean; slot: SceneSlot; amount: number; rollActive: boolean; releaseActive: boolean; limiterGain: number; bpm: number }`.
  - Chain: sanitize input, isolator, scene, roll, release, limiter.
  - Bypass leaves the buffers untouched.
  - When a release finishes, the scene amount returns to 0, the roll stops and the isolator returns to unity.
  - `state()` returns one reused object.
- tests: bypass is bit-exact; neutral settings keep per-band levels within 0.5 dB of the input; after a release finishes `state().amount` is 0 and `rollActive` is false; fuzz test: 20 s of noise at 48 kHz in 128-frame blocks with seeded random calls to every setter between blocks, all output finite and within +-1; NaN and Infinity input give finite output; samples beyond `frames` are not modified.
- accept: `npx vitest run tests/fx/engine.test.ts`

### F032 Message protocol
- status: todo | type: agent | model: haiku | deps: F031 | gate: none
- files: `src/fx/protocol.ts`, `tests/fx/protocol.test.ts`
- spec: `type FxMessage = { type: 'bpm'; bpm: number } | { type: 'autoBpm'; on: boolean } | { type: 'bypass'; on: boolean } | { type: 'sceneSlot'; slot: SceneSlot } | { type: 'sceneAmount'; value: number } | { type: 'isolator'; low: number; mid: number; high: number } | { type: 'rollStart'; division: RollDivision } | { type: 'rollStop' } | { type: 'release'; release: ReleaseType; beats?: number } | { type: 'reset' }`. `isFxMessage(x: unknown): x is FxMessage` checks shape and ranges (finite numbers, valid slot, division and release type). `applyMessage(engine: Pick<FxEngine, ...>, msg: FxMessage): boolean` calls the matching engine method and returns false for `autoBpm`, which the audio processor handles itself. `interface FxStateMessage extends EngineState { type: 'state'; detectedBpm: number | null; bpmConfidence: number }` and `interface FxErrorMessage { type: 'error'; message: string }`.
- tests: every message type reaches the right method on a fake engine; malformed messages (wrong slot, NaN, missing fields, unknown type) are rejected.
- accept: `npx vitest run tests/fx/protocol.test.ts`

### F040 Tap tempo
- status: todo | type: agent | model: haiku | deps: none | gate: none
- files: `src/fx/tempo/tapTempo.ts`, `tests/fx/tapTempo.test.ts`
- spec: `class TapTempo { constructor(opts?: { maxGapMs?: number; window?: number }); tap(tMs: number): number | null; reset(): void }`. Returns the BPM from the median interval of the last `window` (default 8) taps once there are at least two. A gap longer than `maxGapMs` (default 2000) starts over and returns null. Results outside 40..240 return null.
- tests: steady taps at 500 ms give 120; one late tap barely moves the result; a long gap resets; out-of-range intervals return null.
- accept: `npx vitest run tests/fx/tapTempo.test.ts`

### F041 Onset detector
- status: todo | type: agent | model: sonnet | deps: F000, F004 | gate: none
- files: `src/fx/tempo/onset.ts`, `tests/fx/onset.test.ts`
- spec: `class OnsetDetector { constructor(sampleRate: number, hop = 512); process(mono: Float32Array, frames: number, onValue: (v: number) => void): void; get hopRate(): number` (values per second) `; reset(): void }`. Once per hop it reports an onset strength >= 0: the positive change in log energy, combining a band below 200 Hz and the full band. No allocation in `process`.
- tests: a 120 BPM click track gives peaks every `hopRate x 0.5` values within one hop; silence gives zeros; a steady sine gives values near zero after the first hop; works when fed in blocks of 128.
- accept: `npx vitest run tests/fx/onset.test.ts`

### F042 BPM detector
- status: todo | type: agent | model: sonnet | deps: F041 | gate: none
- files: `src/fx/tempo/bpmDetector.ts`, `tests/fx/bpmDetector.test.ts`
- spec: `class BpmDetector { constructor(hopRate: number, opts?: { windowSeconds?: number; minBpm?: number; maxBpm?: number }); push(onsetValue: number): void; estimate(): { bpm: number; confidence: number } | null; reset(): void }`. Defaults: 8 s window, 70 to 180 BPM. Autocorrelation of the onset envelope over the window, peak lag refined by parabolic interpolation, tempo folded into range by doubling or halving, confidence = peak over zero-lag (0..1). Returns null until 4 s of data. Work arrays are preallocated.
- tests: click tracks at 90, 120, 128, 140 and 174 BPM read within 1 BPM after 8 s; 60 BPM clicks read as 120; noise alone has confidence under 0.3; 128 BPM clicks with noise 12 dB below still read within 1.5 BPM.
- accept: `npx vitest run tests/fx/bpmDetector.test.ts`

### F050 Audio worklet and node factory
- status: todo | type: agent | model: sonnet | deps: F031, F032, F042 | gate: none
- files: `src/fx/worklet/processor.ts`, `src/fx/audio/node.ts`, `src/fx/audio/selfTest.ts`, `src/main.ts` (one guarded hook), `scripts/smoke.mjs`, `vite.config.ts` if the worklet bundle needs it
- spec:
  - `processor.ts` registers an `AudioWorkletProcessor` named `trackstar-fx`. It owns an `FxEngine`, an `OnsetDetector` and a `BpmDetector`. Messages are validated with `isFxMessage`; `autoBpm` (default on) makes detected tempo with confidence above 0.5 set the engine BPM. `process` copies input to output (mono input is duplicated, no input is silence), then runs the engine in place. It posts an `FxStateMessage` about ten times a second. If anything throws, it posts an `FxErrorMessage` once and from then on copies input to output untouched.
  - `node.ts`: `createFxNode(ctx: BaseAudioContext): Promise<AudioWorkletNode>` loads the processor module (built by Vite as a separate file) and returns a stereo-in, stereo-out node.
  - `selfTest.ts`: `runFxSelfTest(): Promise<{ bypassMaxDiff: number; effectRmsDiff: number }>` renders one second of a 440 Hz sine through the node in an `OfflineAudioContext`, once bypassed and once with scene slot 1 at amount 0.8. Exposed as `window.__trackstarFxSelfTest` only when the URL has `?fxtest`.
  - `smoke.mjs`: a second page load with `?fxtest` asserts `bypassMaxDiff < 1e-6` and `effectRmsDiff > 0.01`.
- accept: `npm run build && npm run smoke`

### F051 Demo loop
- status: todo | type: agent | model: sonnet | deps: F000, F004, F007, F042 | gate: none
- files: `src/fx/demo/demoLoop.ts`, `tests/fx/demoLoop.test.ts`
- spec: `renderDemoLoop(sampleRate: number, bpm = 124, bars = 4): { l: Float32Array; r: Float32Array }`. Pure synthesis, no samples: kick on every beat (sine sweep from about 120 Hz to 45 Hz with exponential decay), closed hat on the offbeats (seeded noise through a high-pass), clap on beats 2 and 4 (noise burst), a simple bass line. Peak at -3 dBFS. The loop seam must not click.
- tests: length is exactly `round(bars x 4 x 60 / bpm x sampleRate)`; peak between -4 and -2.5 dBFS; deterministic; finite; the BPM detector reads the tempo within 1 BPM; first and last 32 samples are below -40 dBFS.
- accept: `npx vitest run tests/fx/demoLoop.test.ts`

### F052 Audio device helpers
- status: todo | type: agent | model: sonnet | deps: none | gate: none
- files: `src/fx/audio/devices.ts`, `tests/fx/devices.test.ts`
- spec: `interface DeviceInfo { deviceId: string; label: string; kind: 'audioinput' | 'audiooutput' }`. `pickDevice(list: DeviceInfo[], kind: DeviceInfo['kind'], savedLabel: string | null, hint: RegExp): DeviceInfo | null` (exact saved label first, then the first label matching the hint, else null). `INPUT_HINT = /blackhole|loopback|soundflower|vb-audio|cable/i`, `OUTPUT_HINT = /ddj|flx/i`. `CAPTURE_CONSTRAINTS: MediaTrackConstraints` with echo cancellation, noise suppression and auto gain control off and `channelCount: { ideal: 2 }`. `describeTrack(settings: MediaTrackSettings): { stereo: boolean; processed: boolean; sampleRate: number | null; warnings: string[] }` (warns in plain words when the input is mono or when browser processing is still on). Thin browser wrappers `listDevices(): Promise<DeviceInfo[]>` and `openInput(deviceId: string): Promise<MediaStream>`.
- tests: `pickDevice` precedence; `describeTrack` warnings for mono and for processing left on; constraints object shape.
- accept: `npx vitest run tests/fx/devices.test.ts`

### F053 Audio session with failsafe
- status: todo | type: agent | model: sonnet | deps: F050, F051, F052 | gate: none
- files: `src/fx/audio/session.ts`, `tests/fx/session.test.ts`
- spec: `class FxSession { constructor(deps?: Partial<SessionDeps>); start(opts: { source: 'demo' | { inputDeviceId: string }; outputDeviceId: string | null }): Promise<void>; stop(): Promise<void>; send(msg: FxMessage): void; onState(fn: (s: FxStateMessage) => void): () => void; onError(fn: (message: string) => void): () => void; get running(): boolean; latencyMs(): number | null }`. `SessionDeps` injects the context factory, `createFxNode`, `openInput` and `renderDemoLoop` so tests can use fakes.
  - Graph: source (looping buffer for demo, media stream for input) into the FX node into the destination.
  - The context is created with the lowest latency hint and, when an output device is given, routed to it (`sinkId` option, falling back to `setSinkId`; if neither exists, report it through `onError` and use the default output).
  - Failsafe: on an `FxErrorMessage` or a processor error event, disconnect the FX node, connect the source straight to the destination, and call `onError`. Audio must keep flowing.
  - `latencyMs` = `(baseLatency + outputLatency) x 1000`, or null when not running.
- tests (with fakes): demo start builds source, node, destination; failsafe rewires on an error message; `stop` closes the context and stops input tracks; `send` before `start` does nothing; missing `sinkId` support is reported, not thrown.
- accept: `npx vitest run tests/fx/session.test.ts`

### F054 FX settings in config
- status: todo | type: agent | model: haiku | deps: F001 | gate: none
- files: `src/config/config.ts`, `tests/config.test.ts`
- spec: add `fx: { inputLabel: string | null; outputLabel: string | null; source: 'demo' | 'input'; releaseType: ReleaseType; releaseBeats: number; sceneSlot: SceneSlot; autoBpm: boolean }` to `Config`, with defaults `null, null, 'demo', 'brake', 2, 1, true`. `loadConfig` merges a partial stored `fx` over the defaults. Existing behaviour and tests must not change.
- tests: defaults present; partial stored `fx` merges; round trip.
- accept: `npx vitest run tests/config.test.ts`

### F060 to F068 Gestures and UI for FX mode
- status: todo | type: agent | model: sonnet | deps: F053, F054 | gate: G2
- note: these are specified in detail by the planner once gate G2 is open, because they depend on the mapping the owner approves. Planned split, one task each:
  - F060 stabilizer: "pose held" start and end events for momentary actions (`src/gestures/stabilizer.ts`)
  - F061 FX gesture mapper, pure: pipeline output in, `FxMessage`s out (`src/fx/gestures/mapper.ts`)
  - F062 mode state (DECK or FX), `F` key, both-hands-armed toggle (`src/state/mode.ts`)
  - F063 FX panel in the console: slot chips, amount meter, BPM, tap, bypass, latency (`src/ui/fxPanel.ts`)
  - F064 overlay: amount arc on the control hand's ring (`src/ui/overlay.ts`)
  - F065 settings: audio devices, source, release type (`src/ui/settings.ts`)
  - F066 wiring in `src/main.ts`: session, mode, mapper, panel
  - F067 smoke test: FX mode on the demo source
  - F068 README: FX mode guide and audio routing guide, stating what is and is not verified on hardware

---

## Phase 2: Deck Screen

### S001 Display state bus
- status: todo | type: agent | model: sonnet | deps: none | gate: none
- files: `src/display/bus.ts`, `tests/display/bus.test.ts`
- spec: `interface DisplayState { v: 1; t: number; mode: 'deck' | 'fx'; decks: DeckSnapshot; fx: { slot: number; amount: number; rollActive: boolean; releaseActive: boolean; bypass: boolean } | null; bpm: number | null }`. `encode(state: DisplayState): string`, `decode(raw: unknown): DisplayState | null` (validates version and shape, returns null on anything unexpected). `createBus(factory?: (name: string) => ChannelLike): { publish(state: DisplayState): void; subscribe(fn: (s: DisplayState) => void): () => void; close(): void }` over `BroadcastChannel` named `trackstar-display`, with the channel injected for tests.
- tests: round trip; malformed and wrong-version input gives null; publish reaches subscribers through a fake channel; unsubscribe and close.
- accept: `npx vitest run tests/display/bus.test.ts`

### S002 Publish state from the app
- status: todo | type: agent | model: sonnet | deps: S001 | gate: none
- files: `src/display/publisher.ts`, `tests/display/publisher.test.ts`, `src/main.ts`
- spec: `class DisplayPublisher { constructor(bus, now: () => number, minIntervalMs = 66); update(partial: Omit<DisplayState, 'v' | 't'>): void }` publishes on change, at most about 15 times a second, and at least once a second as a heartbeat. `main.ts` feeds it the deck snapshot (FX fields null until FX mode exists).
- tests: throttling, publish on change, heartbeat.
- accept: `npx vitest run tests/display/publisher.test.ts`

### S003 Display page
- status: todo | type: agent | model: sonnet | deps: S001 | gate: none
- files: `display.html`, `src/display/main.ts`, `src/display/view.ts`, `src/display/styles.css`, `tests/display/view.test.ts`, `vite.config.ts`
- spec: a second page built by Vite. `view.ts` is a pure function from `DisplayState | null` and viewport size to a view model (which layout, panel contents, stale flag when the last state is older than 3 s). Layouts: wide bar (aspect ratio 3:1 or wider: decks side by side, full height) and standard. Shows per deck: loop and stem chips with the same states as the main console, mode, BPM, clock. With no state it shows "Waiting for Trackstar" and how to open the main app. Uses the main app's palette.
- tests: view model for null state, fresh state, stale state, and both layouts.
- accept: `npx vitest run tests/display/view.test.ts && npm run build`

### S004 Mirror mode: capture and crop
- status: todo | type: agent | model: sonnet | deps: S003 | gate: G3
- spec: detailed by the planner once G3 is open. Window capture with `getDisplayMedia`, crop rectangles per deck (pure mapping maths, tested), a calibration screen to drag the rectangles, saved in settings.

### S005 Smoke test for the display page
- status: todo | type: agent | model: sonnet | deps: S002, S003 | gate: none
- files: `scripts/smoke.mjs`
- spec: open the main app and `display.html` in the same browser context; assert the display leaves its waiting state and shows chips matching injected MIDI feedback; assert no page errors on either page.
- accept: `npm run build && npm run smoke`

### S010 Hardware workspace
- status: todo | type: agent | model: sonnet | deps: none | gate: none
- files: `hardware/README.md`, `hardware/requirements.txt`, `hardware/params/flx2.yaml`, `hardware/params/flx4.yaml`, `hardware/params/display_bar_11in.yaml`, `hardware/trackstar_hw/__init__.py`, `hardware/trackstar_hw/params.py`, `hardware/tests/test_params.py`, `.gitignore`
- spec: a Python workspace in its own virtual environment at `hardware/.venv` (ignored by git), with build123d and pytest pinned to exact versions that are at least two weeks old (the planner confirms the versions on PyPI and reads the build123d licence before pinning). Do not install CadQuery in the same environment. Parameter files hold published dimensions (FLX2 383.2 x 208 x 48.2 mm, FLX4 482 x 272.8 x 59.2 mm) and `null` for everything listed in H7, each with a comment saying it is unmeasured. `params.py` loads and validates them into dataclasses and refuses to build print-ready output while required measurements are null (a `draft=True` flag allows placeholder values). The README explains setup and commands.
- accept: `cd hardware && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m pytest`

### S011 Bridge model, first draft
- status: todo | type: agent | model: sonnet | deps: S010 | gate: none
- files: `hardware/trackstar_hw/bridge.py`, `hardware/build.py`, `hardware/tests/test_bridge.py`
- spec: `build_bridge(controller, display, bed_mm=250, draft=True) -> dict[str, Part]`: two feet with thin tongues that slide under the controller, two uprights, and a crossbar that carries the display, split into segments that each fit the bed and join with bolts and alignment pins. Follows the design rules in PROJECT.md 4.5. `build.py` exports every part as STEP and STL into `hardware/out/` (ignored by git).
- tests: every part is a valid solid; every part's largest dimension fits the bed; the assembled span clears the controller's width plus clearance; tongue thickness does not exceed the parameter; no two parts intersect in their assembled positions; both controllers build.
- accept: `cd hardware && .venv/bin/python -m pytest && .venv/bin/python build.py --draft`

### S012 to S016 Display holder, checks and documents
- status: todo | type: agent | model: sonnet | deps: S011 | gate: G3
- note: specified in detail once G3 is open and the H7 measurements are in. Planned split:
  - S012 display holder and bezel for the chosen panel
  - S013 headless preview renders of each part and the assembly
  - S014 slicing check (print time, filament, errors) and a small fit-test coupon
  - S015 bill of materials and the print and assembly guide
  - S016 a CI job that runs the hardware tests (this task may edit `.github/workflows/ci.yml`)

### S020 Encoder board
- status: todo | type: agent | model: sonnet | deps: S011 | gate: G4
- note: Raspberry Pi Pico 2 with a push encoder that appears as a USB MIDI device, plus wiring notes. Specified when G4 is open.
