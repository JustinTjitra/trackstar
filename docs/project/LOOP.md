# The unattended loop

A scheduled task wakes the planning session once an hour. Each run does **one task** from [TASKS.md](TASKS.md) and then stops. This file is the rulebook for that run. The project owner can change it; the loop itself must not.

## Roles

| Role | Model | Does |
|---|---|---|
| Planner | The expensive model (the scheduled session itself) | Picks the task, writes the brief, reviews the diff, runs all checks, commits, logs. Solves problems the implementer could not |
| Implementer | A less expensive model, set per task in TASKS.md (`sonnet` by default, `haiku` for mechanical tasks) | Writes the tests and the code for exactly one task. Never commits |

The planner does not write the task's code itself unless the fix is small (about 30 lines or fewer) after the implementer has failed twice.

## One run, step by step

1. **Sync.** `git fetch origin main`, check out `main` at `origin/main`. The working tree must be clean. Set the commit identity to the project owner's (see "Commits"). Run `npm ci` if `node_modules` is missing.
2. **Pick.** Take the first task in TASKS.md, top to bottom, that is `todo`, has type `agent`, whose dependencies are all `done`, and whose gate (if any) is `open`. If there is none: write a LOG.md entry saying why, turn the scheduled task off, and stop.
3. **Brief.** Write the implementer's brief from the task entry: goal, exact files it may create or change, exact interfaces, the conventions below, the test cases, and the acceptance command. Paste in the signatures of anything the task consumes from earlier tasks (read them from the code, not from memory).
4. **Implement.** Hand the brief to an implementer on the task's model. It writes the failing test first, then the code, runs the acceptance command, and reports. It must not touch other files, add dependencies, or commit.
5. **Verify.** Run the full check suite yourself (below). Read the whole diff: is it inside the task's file list, does it follow the conventions, are the tests real (would they fail if the code were wrong), is there anything that does not belong.
6. **On failure.** Send the failure output back to the implementer once. If it fails again: fix it yourself if small, otherwise discard the changes (`git checkout -- .` and remove the task's new untracked files), set the task to `blocked` with a note saying what failed, and log it.
7. **Commit.** One commit containing the task's files, the TASKS.md status change and a LOG.md line. Push to `main`. If the push is rejected because `main` moved, `git pull --rebase origin main`, run the checks again, then push. Never force-push.
8. **Stop.** One task per run.

## Check suite (all must pass before any commit)

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run smoke
```

For tasks under `hardware/`, also run the commands given in that task.

## Stop conditions

- No eligible task: turn the scheduled task off.
- Three runs in a row end in `blocked`: turn the scheduled task off and say so in LOG.md.
- The working tree is not clean at the start, or `main` has changes the loop does not understand (for example the owner is mid-refactor in the files the next task needs): log it and skip the run.
- A task turns out to need a decision, a purchase, real audio, real hands or real hardware: set it to `blocked: needs owner` and move on. Never guess a result for a `human` task.

## Never

- Force-push, rewrite history, or delete branches.
- Change `.github/`, `package.json` dependencies, `LOOP.md` or `AGENTS.md`, unless the task entry says so in words.
- Mark a `human` task or a gate as done.
- Add third-party code or a dependency without the planner reading its licence file directly. GPL and AGPL code is reference only.
- Install agent skills, MCP servers or plugins.
- Post on GitHub (issues, pull requests, comments).
- Work on more than one task in a commit.

## Commits

- Author and committer: the project owner's git identity, as configured by the scheduled task. No co-author lines, no session links, no tool or AI attribution anywhere: not in commit messages, code comments, docs or file names.
- Message format: `<area>: <what changed> (<task id>)`, for example `fx: add fractional delay line (F003)`. Body optional, plain sentences.

## Code conventions for `src/fx/`

- **No allocation on the audio path.** `process` methods must not create arrays, objects or closures. Allocate every buffer in the constructor.
- **Sample-rate aware.** Every class takes `sampleRate` in its constructor and derives all times and frequencies from it. Tests run at both 44100 and 48000 where it matters.
- **Stereo, in place.** Effects implement `process(l: Float32Array, r: Float32Array, frames: number): void` and overwrite the buffers. `frames` may be smaller than the array length.
- **Deterministic.** No `Math.random` and no clocks. Noise uses the seeded source from `dsp/noise.ts`.
- **Parameters** are normalised 0..1 unless the task says otherwise, clamped on entry, and smoothed so changes do not click.
- **Stable.** Feedback gains are capped below 1. Output must stay finite for any parameter values; non-finite input samples are treated as 0.
- **No dependencies, no DOM, no Web Audio** anywhere outside `src/fx/worklet/` and `src/fx/audio/`.
- **Original code.** Implement from the public algorithm description and name the algorithm and its reference in a short header comment. Do not copy code from other projects.
- **Tests** live in `tests/fx/`, use the helpers in `tests/fixtures/synthAudio.ts`, and assert on measurable properties (levels in dB, frequencies, timing in samples, decay), not on snapshots of raw samples.

## Log format

Append to LOG.md, newest at the bottom:

```
## 2026-11-21 14:05 UTC  F003 delay line  done
Implementer: sonnet, 1 attempt. Checks: typecheck, 104 tests, build, smoke all pass. Commit abc1234.
Notes: anything the owner should know, in a sentence or two.
```
