# Trackstar project guide

Written 2026-11-20. This is the guiding document for the next two pieces of work on Trackstar. It says what we are building, how we work, what gets delivered, and in what order. The task queue that the unattended loop works through lives in [TASKS.md](TASKS.md); the rules the loop follows live in [LOOP.md](LOOP.md); what it did while you were away is in [LOG.md](LOG.md).

Research behind this plan: `reports/DJ effects engine and screen addon.md` (summary) and `research_notes/DJ effects engine and screen addon/` (five detailed notes with sources).

## 1. What we are building

| | Phase 1: FX mode | Phase 2: Deck Screen |
|---|---|---|
| What | A remix-station style effects engine inside the Trackstar browser app, controlled by gestures | A low-cost physical screen unit for budget controllers that shows deck information the way a club player's screen does |
| Why | The FLX2 has one effect knob per channel. A build-up/break-down effects box played with your hands is something it cannot do | Budget controllers have no screen, so your eyes are on the laptop. A screen at the controller fixes that |
| Works with | rekordbox Free + DDJ-FLX2 on macOS (first target) | DDJ-FLX2 and DDJ-FLX4 |
| Status | Starts now | Starts after Phase 1's engine is done; early software tasks can run sooner |

Phase 1 is modelled on the four sections of Pioneer's RMX-1000 Remix Station (Scene FX, Isolate FX, X-Pad FX, Release FX). The effects are our own implementations of standard, publicly documented audio algorithms. We do not copy Pioneer's code, presets, artwork or naming beyond describing which generic effect types exist.

## 2. Methodology

**Small chunks with their own tests.** Every task in TASKS.md is one small unit (typically one source file and one test file) with an acceptance command. One task becomes one commit. When something breaks, the commit and the task ID tell us where.

**Cheap model writes, expensive model plans and reviews.** For each task, the planning model writes a precise brief, a less expensive model implements it, and the planning model reviews the diff and runs every check before anything is committed. If the cheap model fails twice, the task is marked blocked with notes instead of being forced through.

**Pure core, thin adapters.** Same shape as the existing app. All audio maths is plain TypeScript with no browser APIs, tested in Node with synthetic signals. Only a thin layer touches Web Audio, devices and the DOM. This is what lets an unattended loop make real progress: most of the work can be verified without speakers.

**Tasks only a human can do are labelled.** The loop cannot hear audio, plug in a controller, use rekordbox or measure a controller with calipers. Those are `human` tasks. Some of them are **gates**: later tasks stay closed until you have done them and written down the result.

**Evidence rules.** The research notes mark each claim as read from a primary source, taken from a search snippet, or unverified. This session's network blocked most direct page reads, so many claims are snippet-level. Before any third-party code is ported or added as a dependency, its licence file must be read directly. We write original implementations from public algorithm descriptions and treat GPL projects (Mixxx, aubio, Rubber Band) as reading material only.

**Honest status.** A task is `done` only when its checks pass. Anything not tested with real hands, real audio or real hardware is called out as untested in the README and in LOG.md.

## 3. Phase 1: FX mode

### 3.1 The honest constraints

- **You are on rekordbox Free.** rekordbox's own RMX EFFECTS are mouse-only on Free, so driving them over MIDI is not an option. We build our own engine.
- **Audio has to be routed through the browser.** rekordbox's master goes into a virtual audio cable (BlackHole 2ch), the browser processes it, and the result goes out of the FLX2's master output. Your headphone cue goes straight to the FLX2 and is not delayed.
- **Expected added delay on the master: 10 to 25 ms.** This is an estimate; the only measured figure found is 19 to 23 ms round trip for Chrome on macOS through an audio interface. That is fine for blending and equivalent to standing about 7 m further from the speakers. It is poor for scratching judged from the speakers. You cannot preview the effect in headphones.
- **One thing is unverified and decides everything:** whether rekordbox 7 Free lets you pick an Aggregate Device and send Master and Headphones to different channel pairs while the FLX2 is connected, and whether the FLX2 still unlocks Performance mode when it is not the selected audio device. This is task H1, a ten-minute test on your Mac. If it fails, see 3.6.
- **Tempo:** rekordbox sends no MIDI clock, and a web page cannot join Ableton Link. The engine detects BPM from the master audio (range 70 to 180) and has tap tempo as a fallback, which is also how the hardware unit works.

### 3.2 Main features

| Section | v1 (this plan) | Later (v1.1) |
|---|---|---|
| **Scene FX** | Five slots, each with a build-up and a break-down effect, one amount control. Build up: BPF Echo, Echo, Noise, Spiral Up, Reverb Up. Break down: HPF Echo, LPF Echo, Crush Echo, Spiral Down, Reverb Down | Second sub-parameter per effect |
| **Isolate FX** | Three-band isolator (low, mid, high) with on-screen control | Cut/Add, Trans/Roll, Gate/Drive |
| **X-Pad FX** | Beat roll at 1, 1/2, 1/4 and 1/8 beat | Four-slot synthesised drum sampler with overdub |
| **Release FX** | Vinyl Brake, Echo, Back Spin. Finishing a release cancels every other effect, as on the hardware | |
| **Tempo** | Auto BPM from the master audio, tap tempo, beat-quantised roll | |
| **Safety** | Hard bypass, output limiter, automatic pass-through if the engine fails | |
| **Demo source** | A built-in synthesised loop, so effects can be heard and tested with no audio routing at all | |

### 3.3 Gesture mapping (proposal, needs your approval: gate G2)

FX depth has no physical control on the FLX2, so unlike gain or EQ a continuous gesture does not fight the hardware.

- **Mode switch.** Press `F`, or hold both hands armed (thumb clutch + fist) for 0.6 s, to switch between DECK mode (today's loops and stems) and FX mode. The screen shows the mode clearly.
- **Left hand selects.** While armed, flick a pose to choose the Scene FX slot: index, index + middle, index + middle + ring, pinky, index + pinky for slots 1 to 5. All four fingers triggers the Release FX (type chosen in settings).
- **Right hand plays.** Engaging the clutch "grabs the knob": moving the hand up from where you grabbed increases the build-up effect, moving down increases the break-down effect. Let go of the clutch and the amount holds. This mirrors the hardware's single bipolar knob.
- **Right-hand roll.** While armed, hold a pose to roll for as long as it is held: one finger = 1 beat, two = 1/2, three = 1/4, four = 1/8.
- **Isolator** has no gesture in v1. The FLX2's EQ knobs already cover that job; the isolator gets on-screen sliders.

This mapping is a starting point. It needs your judgement and a real-hand test before any of it is built, which is why the gesture and UI tasks sit behind gate G2.

### 3.4 Architecture

```
rekordbox master -> BlackHole 2ch -> browser input
                                        |
                              AudioWorklet (FxEngine)
   capture -> isolator -> scene FX -> roll -> release -> limiter
                                        |
                          browser output -> FLX2 channels 1-2 (MASTER jack)

rekordbox headphones -> FLX2 channels 3-4 (PHONES jack), untouched
```

| Folder | Job | Tested how |
|---|---|---|
| `src/fx/dsp/` | Building blocks: delay line, filters, crossover, reverb, noise, crusher, smoothing, beat clock, capture buffer, limiter | Node unit tests with synthetic signals |
| `src/fx/effects/` | One class per effect, built from the blocks | Node unit tests |
| `src/fx/engine.ts`, `scene.ts`, `protocol.ts` | The chain, effect switching, and the message format between page and audio thread | Node unit tests, including a fuzz test for NaN and runaway levels |
| `src/fx/tempo/` | Tap tempo, onset detection, BPM detection | Node tests against synthetic click tracks |
| `src/fx/worklet/`, `src/fx/audio/` | AudioWorklet wrapper, device selection, session with pass-through failsafe, demo source | Smoke test in headless Chromium |
| `src/fx/gestures/`, `src/ui/` additions | FX mode, gesture mapping, FX panel (after gate G2) | Unit tests plus smoke test |

Rules for all effect code are in LOOP.md under "Code conventions": no memory allocation on the audio thread, sample-rate aware, deterministic, parameters smoothed, no dependencies.

### 3.5 Deliverables

1. FX mode in the deployed app, with a demo source that works on any machine.
2. A routing guide in the README for BlackHole plus an Aggregate Device, with the measured latency once you have run it.
3. Unit tests for every DSP block and effect, plus an extended smoke test.
4. A short record of what was verified on real hardware and what was not.

### 3.6 If the routing test (H1) fails

In order of preference:

1. Try rekordbox's PC MASTER OUT route (documented with controllers, but it also sends the dry master to the FLX2, so the processed audio must leave by another output such as the Mac's headphone jack).
2. Keep FX mode as a practice and recording tool using the demo source or any audio input.
3. Reconsider a paid rekordbox plan, or Mixxx as the host for effects.

The engine and its tests are useful in all three cases, which is why the loop starts there.

## 4. Phase 2: Deck Screen

### 4.1 The honest constraints

- **rekordbox does not give a companion screen any live data.** There is no official output for track, playhead or waveform in Performance mode. The one unofficial tool reads rekordbox's memory: on macOS that needs `sudo` and re-signing the rekordbox app, it breaks with every rekordbox point release, current versions need a paid licence, and the rekordbox licence agreement bars reverse engineering. This project does not use it.
- **Pro DJ Link is hardware only.** It does not exist for a USB controller plus laptop.
- **What does work:**
  - **Mirror mode.** Capture the rekordbox window, crop the waveform areas, and show them on the small screen together with data Trackstar already owns (loop and stem state, FX state, BPM, clock). Robust, legal, works on Free with the FLX2. It shows pixels, so the waveform cannot be restyled.
  - **Mixxx data mode (later).** Mixxx exposes position, BPM, key, loops and cues by design. The FLX4 is officially supported. FLX2 support is an open, unmerged pull request, so this is not ready for your controller today.
- **No existing project** does a laptop-fed companion screen for rekordbox and these controllers. The nearest builds are standalone Mixxx-on-Raspberry-Pi decks.

### 4.2 Main features

| Area | v0 | Later |
|---|---|---|
| **Display page** | A second page of the app designed for a wide bar screen: per-deck panels with mirrored waveform, loop and stem state, FX state, BPM, clock | Mixxx data mode with our own waveform rendering |
| **Screen hardware** | No computer inside. The laptop drives a small HDMI or USB-C display as a second monitor | A single-board computer only if a laptop-free unit is ever wanted |
| **Mount** | A 3D-printed free-standing bridge behind the controller, with thin tongues that slide under it so the controller's weight stops it tipping. Nothing is attached to or modified on the controller | Clamp or tray variants |
| **Controls (optional)** | None | A rotary encoder with push on a Raspberry Pi Pico 2 that appears as a USB MIDI device, mapped in rekordbox for browse and load |

### 4.3 Hardware tiers (prices are late-2026 snapshots from search results, not quotes)

| Tier | Build | About |
|---|---|---|
| 0 | A phone or tablet you already own, as the first prototype | $0 to $15 |
| 1 | 7 inch 1024x600 HDMI touch panel | $55 to $75 |
| 2 (recommended) | 11.26 inch 1920x440 touch bar, about 75% of the FLX2's width | $115 to $140 |
| 3 | 12.3 inch 1920x720 bar, or a 10.1 inch 1280x800 panel | $190 to $265 |

Power note: the controller draws up to 0.5 A and a display another 0.3 to 0.5 A, which is more than one bus-powered hub can supply. Use a laptop port that sources 1.5 A or more, or a hub with its own power input.

### 4.4 How to CAD it, and which skills are needed

**Two ways to design the enclosure, and we use both:**

- **Code-CAD for the loop: build123d** (Python, Apache-2.0, OpenCascade kernel). The model is a Python script with parameters, so an agent can write it, export STEP, STL and 3MF, and check it automatically: is the solid valid, do the parts fit the printer bed, do parts collide, does the display fit its pocket. The researcher installed it in this container and built a filleted, shelled box with a lid in under a second. One trap: build123d and CadQuery must not share a Python environment.
- **GUI CAD for you: Onshape (free or education plan) or Fusion for personal use.** Use it to open the exported STEP file, look at the part, and make judgement calls a script cannot. Fusion's personal licence allows 10 active documents and non-commercial use; Onshape Free makes documents public.

**Skills you will need (human):**

| Skill | Why | How much |
|---|---|---|
| Parametric modelling basics | To read and adjust the model, and to sketch ideas in Onshape or Fusion | A weekend of tutorials |
| Design for 3D printing | Wall thickness, clearances, splitting parts, print orientation | The rules are in section 4.5 |
| Measuring with calipers | The controller dimensions the specs do not give | An hour |
| Basic electronics and USB power | Choosing the display, hub and cables | Light |
| Soldering | Only for the optional encoder board | Light, optional |
| Slicing and printing, or ordering prints | Turning STL into parts | A makerspace session, or an online order |

**Agent skills and tools:** no CAD skill is installed in this session, and none is needed to start, since plain build123d with pytest works here. The research found candidates (`pzfreo/build123d-mcp`, the `earthtojake/text-to-cad` skills, `RobertCoop/openscad-mcp`), but none was installed or tested, and installing third-party agent tools is your call, not something the loop does on its own.

### 4.5 Design rules the model will follow

- Walls 2.0 to 2.4 mm. About 0.5 mm clearance around electronics. 0.15 to 0.3 mm per side for sliding fits.
- M3 heat-set inserts: 4.0 mm hole, 1.6 to 2.0 mm of wall around it, depth = insert length + 1 mm.
- Material: PETG (softens around 75 to 85 C) or ASA (around 100 C). Not PLA, which softens around 55 to 60 C and can sag in a hot booth or car.
- Both controllers are wider than a 256 mm printer bed (FLX2 383.2 mm, FLX4 482 mm), so the bridge is split into parts joined with bolts and alignment pins.
- Controller sizes used: FLX2 383.2 x 208 x 48.2 mm, 1.2 kg. FLX4 482 x 272.8 x 59.2 mm, 2.1 kg.
- Not available from any spec sheet and needed before printing: port positions, the height of the chassis top and the knobs, the underside layout, and the gap under the controller. These are caliper measurements (task H7).

### 4.6 Deliverables

1. The display page, working on any second monitor.
2. A bill of materials for the chosen tier, with links and prices at the time of writing.
3. Parametric CAD source for the bridge and display holder for both controllers, with exported STEP and STL files and automated checks.
4. An assembly and print guide.
5. Optional: firmware and wiring for the encoder board.

## 5. Step-by-step plan

Tasks marked **you** need you. Everything else is in the loop's queue.

| Step | What | Who |
|---|---|---|
| 1 | **H1** routing test on your Mac. **H2** check whether stems work on Free. Both take minutes and decide a lot | you |
| 2 | Test helpers, then DSP building blocks (F000 to F012) | loop |
| 3 | Effects, one per task (F020 to F027) | loop |
| 4 | Scene manager, engine, message protocol, fuzz test (F030 to F032) | loop |
| 5 | Tempo: tap, onset, BPM detection (F040 to F042) | loop |
| 6 | Audio layer: worklet, demo source, devices, session with failsafe, config (F050 to F054) | loop |
| 7 | **G2**: review the gesture mapping in 3.3; change what you like | you |
| 8 | Gestures and UI for FX mode, smoke test, README guide (F060 to F068) | loop, after G2 |
| 9 | **H5** listen, tune amounts and curves, record real-hand sequences | you, then loop |
| 10 | Display page and state bus (S001 to S005) | loop |
| 11 | **G3**: choose mirror mode or Mixxx, and a hardware tier. **H7**: caliper measurements | you |
| 12 | CAD scaffold and first bridge model with placeholders (S010, S011); then real dimensions, display holder, collision checks, renders, slicing check, BOM and assembly guide (S012 to S016) | loop, partly after G3 and H7 |
| 13 | **H8** print or order, assemble, report fit problems | you |
| 14 | Optional encoder board (S020) | loop, if you want it |

## 6. Risks

| Risk | Effect | What we do |
|---|---|---|
| rekordbox Free refuses the audio routing | FX mode cannot sit on the live master | H1 first; fallbacks in 3.6 |
| Added latency feels wrong in practice | Effects are usable for blends only | Measure and show the real figure in the app; tune buffer sizes |
| Audio glitches under load (hand tracking and audio in one tab) | Dropouts on the master | Audio runs in an AudioWorklet off the main thread; pass-through failsafe; test on your machine |
| An effect misbehaves live (runaway feedback) | Loud noise on the master | Feedback caps, output limiter, hard bypass, fuzz test |
| The loop commits something wrong while you are away | Broken `main` | One small task per commit, all checks before commit, no force-push, blocked tasks are logged and skipped, loop turns itself off after repeated failures |
| Unverified research claims | Wrong design decisions | Snippet-level claims are labelled; licences and manuals get a direct read before use |
| Printed parts do not fit | Wasted prints | Parametric model, automated checks, measure first, print a small test coupon before the full part |
