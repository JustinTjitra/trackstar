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
