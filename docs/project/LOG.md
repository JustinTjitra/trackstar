# Loop log

What the unattended loop did, newest at the bottom. Format is in [LOOP.md](LOOP.md).

## 2026-11-20  Setup
Project guide, task queue and loop rules written. Research notes committed under `research_notes/`. No tasks run yet.

## 2026-11-20 22:10 UTC  F000 synthetic audio test helpers  done
Implementer: haiku, 1 attempt. Checks: typecheck, 133 tests, build, smoke all pass.
Notes: first task, run by hand to prove the process before scheduling. Two deliberate breakages of the helpers (Goertzel scaling, click spacing) each failed 2 tests, so the tests are doing their job.

## 2026-11-20 22:45 UTC  F001 shared types and maths helpers  done
Implementer: haiku, 1 attempt. Checks: typecheck, 169 tests, build, smoke all pass.
Notes: three deliberate breakages (expLerp made linear, sanitize letting Infinity through, clamp without its NaN guard) each failed 2 tests. The planner reworded one doc comment on ReleaseType that described it wrongly.

## 2026-11-20 23:44 UTC  F002 parameter smoother  done
Implementer: haiku, 1 attempt. Checks: typecheck, 180 tests, build, smoke all pass.
Notes: four deliberate breakages (time constant in seconds, jump not updating the target, no snap, NaN accepted as a target) were each caught. The class uses `#private` fields because plain private fields would clash with its `value` and `target` getters.

## 2026-11-21 00:46 UTC  F003 fractional delay line  done
Implementer: sonnet, 1 attempt. Checks: typecheck, 195 tests, build, smoke all pass.
Notes: the planner's brief contained an error, which the implementer caught and reported: reading at delay D before writing gives a delay of D + 1, not D, because `read(0)` is the newest written sample. The task spec's semantics were kept. For later tasks (echo, reverb, capture buffer): use `write(x)` then `read(d)` for a delay of d, or `read(d - 1)` then `write(x)`. Five of six deliberate breakages were caught; the sixth (buffer one slot smaller) cannot change any output, since the extra slot is only read with an interpolation weight of zero.

## 2026-11-21 01:45 UTC  F004 biquad filter  done
Implementer: sonnet, 1 attempt. Checks: typecheck, 221 tests, build, smoke all pass.
Notes: no threshold in the brief needed changing. Six deliberate breakages by the planner (sign of a1, low-pass and high-pass swapped, band-pass peak gain, missing frequency clamp, partial reset, all-pass coefficients swapped) were each caught. The impulse response is checked against an independent direct-form reference to 1e-12.

## 2026-11-21 02:50 UTC  F005 state variable filter  done
Implementer: sonnet, 1 attempt. Checks: typecheck, 251 tests, build, smoke all pass.
Notes: outputs match the cookbook biquad to about 2e-15, which confirms both filters. Seven deliberate breakages by the planner were each caught. One finding for later tasks: with the cutoff jumping between 200 Hz and 8 kHz on every sample, output stays finite but peaks reach about 5 times the input at q 8 (about 2.4 times at q 0.707). Swept filters inside feedback loops should keep q low (the specs use 0.8 and 1.2) and smooth their cutoff; the engine's limiter is the last line of defence.

## 2026-11-21 03:46 UTC  F006 three-band crossover  done
Implementer: sonnet, 1 attempt. Checks: typecheck, 292 tests, build, smoke all pass.
Notes: the three bands sum to the reference all-pass chain within 3e-14, so the sum is level-flat by construction. No threshold needed changing. Five of six deliberate breakages by the planner were caught; the sixth (dropping the input sanitising) cannot change any output because each biquad sanitises its own input. One thing to know: with the default 300 Hz and 3 kHz split points, leaving out the low band's all-pass changes the summed level by less than 0.1 dB, so only the exact-identity test guards it. It would matter more if the two split points were moved close together.

## 2026-11-21 04:50 UTC  F007 noise source  done
Implementer: haiku, 1 attempt. Checks: typecheck, 307 tests, build, smoke all pass.
Notes: the planner's review found a real test gap and fixed it. Removing the slowest of the three pink filter stages passed every test, because the flatness test only measured 250 Hz and up and that stage shapes the bass. Measured over 62.5 Hz to 8 kHz, the correct filter stays within about 1.2 dB across four seeds and the broken one spreads 4.5 dB, so the test now starts at 62.5 Hz; removing any one stage fails it. Measured pink level: RMS 0.255, peak 1.09 over 10 s, so "roughly -1..1" means occasional samples just above 1. The white octave steps read 2.6 to 2.9 dB, not 3.0, because the digital band-pass used for measuring narrows toward high frequencies; the same effect makes the 8 kHz pink band read about 0.9 dB low.

## 2026-11-21 05:45 UTC  F008 bit crusher  done
Implementer: haiku, 1 attempt. Checks: typecheck, 324 tests, build, smoke all pass.
Notes: no expectation in the brief needed changing. Seven deliberate breakages by the planner (negative zero, clipping, NaN setting accepted, incomplete reset, counter reset instead of subtract, missing upper bit clamp, unsanitised input) were each caught, on top of the implementer's own three. The crusher does not clip values beyond -1..1; the engine's limiter handles level.

## 2026-11-21 06:58 UTC  F009 reverb  done
Implementer: sonnet, 1 attempt. Checks: typecheck, 345 tests, build, smoke all pass.
Notes: the implementer's first test set missed two of the four breakages the brief asked it to try (no all-passes, only four combs), so it added a level and diffusion test. The planner's review then found and closed two more gaps. First, a wrong comb or all-pass length passed every test, since only the shortest comb was pinned; a new test checks the exact echo pattern of the first 1720 samples, which the planner derived from the structure and then confirmed by measurement, and now all 8 comb lengths, all 4 all-pass lengths, the stereo spread, the all-pass feedback and the input gain each fail a test when changed. Second, the stability test's limit of 20 was almost hit (peak 18.3): at 0 Hz all eight combs add up, giving a gain of exactly 0.72 / (1 - feedback) = 36 at room size 1. That is how this reverb design behaves, not a bug. A steady-input test now checks that gain at three room sizes (2.4, 4.5, 36) and the noise bound is 40. A note was added to F024 to high-pass the reverb's input so bass cannot build up.

## 2026-11-21 07:52 UTC  F010 beat clock  done
Implementer: haiku, 1 attempt, correct to the brief. Checks: typecheck, 368 tests, build, smoke all pass.
Notes: the planner's review found a flaw in its own brief and fixed it. The brief said to add a fraction of a beat on every block. Simulating that showed the rounding errors pile up: at 125 BPM most beat boundaries are missed by up to 1.5e-7 beats, and after about 90 minutes at 128 BPM by 5e-7, far beyond the 1e-9 rounding guard, so `phase` would read 0.9999995 on a beat and `samplesToNext` almost 0 instead of a full division. The clock now keeps the beats at the last tempo change plus an exact whole-number sample count, and converts on request. New tests run 11000 beats block by block and require every boundary to be exact, cover tempo changes mid-run, and `setBeats` after advancing. Ten deliberate breakages are each caught, including a return to the original design. Consumers should still treat `samplesToNext` below one sample as "now", since tempo estimates are never sample-exact.

## 2026-11-21 08:47 UTC  F011 stereo capture buffer  done
Implementer: haiku, 1 attempt. Checks: typecheck, 381 tests, build, smoke all pass.
Notes: no expected number in the brief needed changing. The implementer pointed out that one breakage the brief asked for (swapping two independent write calls) could not change behaviour, and broke the channel mapping instead. Nine deliberate breakages by the planner are each caught; one needed an extra assertion first (a size of 1.5 must be rejected, which only the bound check itself catches). For F026 and F027: `capacity` samples are kept, `readL(0)` is the newest, and reading further back than `filled` gives 0.

## 2026-11-21 09:50 UTC  F012 soft clip and limiter  done
Implementer: sonnet, 1 attempt. Checks: typecheck, 408 tests, build, smoke all pass.
Notes: the implementer caught an error in the brief: 20 release times is not enough for the gain to snap back to exactly 1 (0.51 * e^-20 is 1.05e-9, just above the 1e-9 snap), so the test uses 25. The planner added a hostile-input test of the limiter's one guarantee: across four ceilings, four block sizes and input mixing eight orders of magnitude with NaN, infinities and the largest 32-bit floats, no output exceeds the ceiling (worst excess 1.9e-8, which is 32-bit rounding) and nothing is non-finite. Ten deliberate breakages by the planner plus the implementer's five are each caught. The limiter is a brick wall with no lookahead, so heavy limiting distorts; it is a failsafe, and effects should be tuned not to lean on it. This finishes the building blocks (F000 to F012).

## 2026-11-21 10:55 UTC  F002 follow-up: smoother stalls on large values  fixed
Found by the F020 implementer. The smoother snapped onto its target when within a fixed 1e-9. For large values that never happens: gliding an echo delay from 18000 to 14400 samples stopped 2e-9 short for ever, because each step became smaller than the spacing between neighbouring floating point numbers. The threshold now scales with the target (1e-9 relative, never below 1e-9). New tests glide to large targets and require the exact value; going back to the fixed threshold fails 4 tests. Checks: typecheck, 414 tests, build, smoke all pass. Committed on its own, before F020.

## 2026-11-21 11:20 UTC  F020 filter echo  done
Implementer: sonnet, 1 attempt; the effect code was correct to the brief and is committed unchanged. Checks: typecheck, 450 tests, build, smoke all pass.
Notes: the implementer's report exposed two mistakes by the planner. (1) The smoother stall, fixed in its own commit (see the entry above); the echo's timing tests now require exact sample positions and fail if the old smoother returns. (2) Three thresholds in the brief's filter tests were wrong because of how the brief said to measure: a second-order band-pass has shallow skirts and lets neighbouring frequencies leak in, so the implementer had to loosen them. The planner replaced those tests with an exact method: send a pure tone, and compare echo 1 with a * g and echo 2 with a * fb * g * g, where g is the gain of a separate filter set to the cutoff the echo should be using. All three filter types match within 0.3 dB (echo 1) and 0.5 dB (echo 2) in pass bands and stop bands, which also pins the cutoff ranges and q values. "Filter outside the loop" now fails 6 tests (it failed 1 weak check before). The planner also closed gaps in the reset tests (each delay line, each filter memory, and a pending glide of the echo spacing). 21 deliberate breakages by the planner: 20 caught; the one left (reset not ending a glide of the amount) cannot be observed, because the echo memory has just been cleared. Use the tone method for F021 and the other filtered effects.
For H5 (tuning by ear): at amount 1 the echo tail builds to about 2.1 times the input level (+6.6 dB) on steady material, measured and predicted, so loud music at high amounts will hit the limiter. The numbers follow the task spec; whether that is too hot is a listening decision.

## 2026-11-21 11:50 UTC  F008 follow-up: crusher gets a round-toward-zero mode  done
Found by the planner while designing F021, before any code was written. A quantiser that rounds to the nearest step, inside a feedback loop, can round a quiet echo back up to its own level on every pass. With 5 bits and feedback 0.85 (the crush echo at full amount), values of 1, 2 or 3 steps are fixed points: simulated with the real blocks, a short burst left an echo stuck at 0.1875 (about -14.5 dBFS) after 400 repeats. The crush echo would have buzzed for ever. `Crusher.setTruncate(true)` now rounds toward zero, which can only shrink a value, so the tail reaches exact silence. Default behaviour is unchanged and the 17 existing tests pass untouched. Five new tests, including the loop itself in both modes; five deliberate breakages each caught. Checks: typecheck, 455 tests, build, smoke all pass. Committed on its own, before F021.

## 2026-11-21 12:10 UTC  F021 crush echo  done
Implementer: sonnet, 1 attempt; the feature code is committed unchanged. Checks: typecheck, 471 tests, build, smoke all pass. The 36 existing echo tests were not edited and still pass.
Notes: built on the round-toward-zero crusher mode committed just before (see the entry above). With it, at full amount the tail reaches exact silence within 8 s of the input stopping; without it the test fails. The implementer improved on the brief twice: the brief's reset test could not detect a forgotten crusher reset, because its 1 s test signal ended exactly on a hold boundary (48000 is a multiple of the 5-sample hold at amount 0.8), so it feeds two more samples; and it added a direct check that crushing happens inside the loop (echo 1 at 0.25, echo 2 at 0.1875 for a steady input). The planner then pinned the order inside the loop (filter first, crusher last) and made the hold-length check exact (every run is a whole number of 6-sample holds). 13 deliberate breakages by the planner: 12 caught; the one left (crusher settings not applied at construction) cannot be observed, since at amount 0 the crusher's output is neither heard nor fed back. Measured grit (distortion relative to a clean echo, 1 kHz tone): 0.06 at amount 0.05, 0.14 at 0.3, 0.25 at 0.6, 0.38 at 1.0.
For H5: a single-sample click can vanish in the crush echo, because the sample-and-hold only looks at every Nth sample. That is how sample-rate reduction behaves; on music it is the lo-fi character.

## 2026-11-21 12:55 UTC  F022 noise sweep  done
Implementer: sonnet, 1 attempt; the code is committed unchanged. Checks: typecheck, 498 tests, build, smoke all pass.
Notes: because the noise is seeded, the tests compare the effect sample for sample with a reference built from the blocks (same seed through a separate filter), at several amounts and seeds. That pins the level law, the sweep range, the q and both channel seeds: 12 of 13 deliberate breakages by the planner are caught, and the one left (freezing the noise generator while the amount is exactly 0) only shifts which part of the random sequence is heard later. One threshold in the brief was wrong: at amount 0.2 the share of level above 4 kHz measures 0.30, not below 0.2, because a band-pass with q 0.8 is wide; the implementer kept the behaviour and set the limit from the measurement. It also showed that invalidating the filter setting in `reset()` is redundant by construction (kept anyway, harmless).
For H5: measured noise level at amount 1 is -15.1 dBFS RMS (peak 0.585), and at amount 0.5 it is far lower because the level goes with the square of the amount. If the riser is too quiet against loud music, raise MAX_LEVEL or flatten the curve.
