# Touchless Core Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Note on detail level:** this plan is executed immediately, in the same session that wrote it. Each task fixes the files, interfaces and test cases exactly; the implementation code lives in the commits, not duplicated here.

**Goal:** Replace the Python/OpenCV controller with a browser app (TypeScript, MediaPipe Tasks, Web MIDI) that fires loop and stem actions only through a thumb-clutch state machine and displays state only from rekordbox feedback.

**Architecture:** Pure modules (`gestures/`, `state/`, `midi/mapping`, `config/calibration`) hold all the logic and are unit tested with synthetic landmark data. Thin browser adapters (`tracking/`, `midi/io`, `ui/`) wrap MediaPipe, Web MIDI and the DOM. `main.ts` wires them together in a frame loop.

**Tech Stack:** TypeScript 5.9.3, Vite 6.4.4, Vitest 3.2.7, @mediapipe/tasks-vision 0.10.21, Web MIDI API, preinstalled Playwright for the smoke test.

## Global Constraints

- Chromium only (Chrome, Edge). Web MIDI required; show a clear message elsewhere.
- No UI framework. No runtime dependencies besides `@mediapipe/tasks-vision`.
- MediaPipe WASM and the model are served from the app's own origin (`public/mediapipe/`, fetched by script, git-ignored) so the app works offline at a gig.
- Deck A = left half of the mirrored view, deck B = right half. MediaPipe handedness is ignored.
- Commands: deck A channel 1, deck B channel 2. Feedback: deck A channel 3, deck B channel 4. Input on channels 1 and 2 is ignored.
- Notes: loop1 62, loop2 63, loop4 65, drums 70, vocals 71, inst 72.
- Button press = note_on vel 127, note_off 10 ms later (Web MIDI timestamp).
- Confirm timeout 300 ms, no automatic retry. Default hold 80 ms, fired flash 250 ms.
- Stem display: lit = audible, struck-through = muted.
- Copy: no em-dashes in user-facing text.

---

## File structure

```
index.html                     app shell
package.json, tsconfig.json, vite.config.ts
scripts/fetch-assets.mjs       copy MediaPipe wasm + download model into public/mediapipe
scripts/smoke.mjs              Playwright smoke test
src/types.ts                   shared types (Vec3, HandFrame, Deck, Pose, Action, RingState, ActionEvent)
src/gestures/geometry.ts       vector helpers
src/gestures/features.ts       FeatureExtractor (finger extension, clutch, speed)
src/gestures/classifier.ts     classify(fingers) -> Pose
src/gestures/stabilizer.ts     Stabilizer state machine
src/gestures/pipeline.ts       GesturePipeline: deck assignment + per-deck extractor/stabilizer
src/state/deckStore.ts         control states, pending/unconfirmed/blind
src/midi/mapping.ts            press messages, feedback parsing
src/midi/io.ts                 MidiIO: ports, reconnection, send, feedback
src/config/config.ts           Config, defaults, load/save
src/config/calibration.ts      computeClutchThresholds
src/tracking/handTracker.ts    MediaPipe HandLandmarker wrapper
src/ui/labels.ts               action/ring label text
src/ui/overlay.ts              canvas: camera, skeleton, rings, centre line
src/ui/console.ts              bottom console chips
src/ui/status.ts               status pill + banners
src/ui/settings.ts             settings drawer
src/ui/onboarding.ts           first-run flow + calibration screen
src/ui/styles.css
src/record.ts                  ?record mode
src/main.ts                    wiring + frame loop
tests/fixtures/synthHand.ts    synthetic hand generator
tests/*.test.ts
.github/workflows/ci.yml       typecheck, test, build, deploy Pages
```

## Shared types (`src/types.ts`)

```ts
export interface Vec3 { x: number; y: number; z: number }
export type Deck = 'A' | 'B';
export const DECKS: readonly Deck[] = ['A', 'B'];
export interface HandFrame { landmarks: Vec3[]; world: Vec3[] }   // image coords are unmirrored, 0..1
export type Pose = 'fist' | 'index' | 'index_middle' | 'index_middle_ring' | 'all_four' | 'pinky' | 'index_pinky' | 'none';
export type ActionPose = Exclude<Pose, 'fist' | 'none'>;
export type Action = 'loop1' | 'loop2' | 'loop4' | 'drums' | 'vocals' | 'inst';
export const ACTIONS: readonly Action[] = ['loop1', 'loop2', 'loop4', 'drums', 'vocals', 'inst'];
export type PoseMap = Record<ActionPose, Action | null>;
export interface ActionEvent { deck: Deck; action: Action; t: number }
export type RingPhase = 'idle' | 'armed' | 'forming' | 'fired' | 'rearm';
export interface RingState { phase: RingPhase; action: Action | null; progress: number }
```

---

### Task 1: Scaffold the TypeScript project, remove Python

**Files:** delete `src/main.py`, `tests/test_main.py`, `requirements.txt`, `bootstrap.sh`, `mini_dj.spec`, `.python-version`, `.Rhistory`, `.github/workflows/release.yml`. Create `package.json`, `tsconfig.json`, `vite.config.ts` (`base: './'`), `index.html`, `src/main.ts` (placeholder), `src/types.ts`, `scripts/fetch-assets.mjs`, `.github/workflows/ci.yml`. Update `.gitignore` (node_modules, dist, public/mediapipe).

- [ ] Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `typecheck`, `test` (`vitest run`), `smoke`, `predev`/`prebuild` run `fetch-assets`.
- [ ] `fetch-assets.mjs`: copy `node_modules/@mediapipe/tasks-vision/wasm/*` to `public/mediapipe/wasm/`; download `hand_landmarker.task` (float16/1) to `public/mediapipe/` if missing; fail with a clear message on network error.
- [ ] CI: on push and PR run `npm ci`, typecheck, test, build; on `main` deploy `dist/` to GitHub Pages.
- [ ] Verify `npm run typecheck && npm test -- --passWithNoTests && npm run build` succeeds. Commit.

### Task 2: Synthetic hands + feature extraction

**Files:** `tests/fixtures/synthHand.ts`, `src/gestures/geometry.ts`, `src/gestures/features.ts`, `tests/features.test.ts`.

**Interfaces:**
- `synthHand(opts: { fingers: {index,middle,ring,pinky: number /*0 folded..1 extended*/}; thumb: 'clutch'|'away'; center?: {x,y}; rollDeg?: number; scale?: number; noise?: number; seed?: number }): HandFrame`
- `interface FeatureConfig { clutchOn: number; clutchOff: number }`
- `interface FingerFlags { index: boolean; middle: boolean; ring: boolean; pinky: boolean }`
- `interface HandFeatures { fingers: FingerFlags; clutch: boolean; clutchRatio: number; mirroredX: number; mirroredY: number; speed: number }`
- `fingerAngle(world: Vec3[], mcp, pip, tip): number` (degrees, 180 = straight)
- `clutchRatio(world: Vec3[]): number` = distance from thumb tip (4) to segment 5–6, divided by |0–9|
- `class FeatureExtractor { constructor(cfg: FeatureConfig); setConfig(cfg); update(hand: HandFrame, t: number): HandFeatures; reset() }`
  - finger hysteresis: becomes extended above 150°, becomes folded below 125°
  - clutch hysteresis: engages below `clutchOn`, releases above `clutchOff`
  - speed: EMA (alpha 0.5) of wrist image displacement / image hand size / seconds

**Tests:** extended vs folded fingers detected for every pose; same flags at roll 0°, 45°, 90°, -60°; clutch engaged for `thumb:'clutch'`, released for `'away'`; hysteresis keeps state for a ratio between on and off; speed ~0 for a still hand, > 3 for a hand moving 0.2 frame widths in 50 ms; mirroredX = 1 - wrist.x.

### Task 3: Classifier

**Files:** `src/gestures/classifier.ts`, `tests/classifier.test.ts`.
**Interface:** `classify(f: FingerFlags): Pose`.
**Tests:** table of all 16 flag combinations; the 7 named poses map correctly, all others are `'none'`.

### Task 4: Stabilizer state machine

**Files:** `src/gestures/stabilizer.ts`, `tests/stabilizer.test.ts`.
**Interfaces:**
- `interface StabilizerConfig { holdMs: number; firedMs: number; speedGate: number; poseMap: PoseMap }`
- `DEFAULT_POSE_MAP: PoseMap` (index→loop1, index_middle→loop2, all_four→loop4, index_pinky→drums, pinky→vocals, index_middle_ring→inst)
- `class Stabilizer { constructor(cfg); setConfig(cfg); update(i: { pose: Pose; clutch: boolean; speed: number; t: number }): { ring: RingState; fired: Action | null }; reset(): void }`
- Transitions exactly as spec section 4.

**Tests:** idle without clutch never fires; clutch+fist → armed; armed + mapped pose held ≥ holdMs fires once; released before holdMs fires nothing; pose change during forming restarts with new pose; fast motion aborts forming; after firing, holding the pose or switching poses fires nothing until fist; fist → armed again allows a second fire; clutch released mid-forming → idle; unmapped pose in armed does nothing; progress goes 0→1 during forming.

### Task 5: Gesture pipeline (deck assignment + replay tests)

**Files:** `src/gestures/pipeline.ts`, `tests/pipeline.test.ts`.
**Interfaces:**
- `interface PipelineConfig extends FeatureConfig, StabilizerConfig { deadBand: number }` (default 0.04)
- `interface DeckView { hand: HandFrame | null; features: HandFeatures | null; pose: Pose; ring: RingState }`
- `class GesturePipeline { constructor(cfg); setConfig(cfg); update(hands: HandFrame[], t: number): { decks: Record<Deck, DeckView>; actions: ActionEvent[] } }`
- Deck assignment: mirroredX < 0.5 - deadBand → A, > 0.5 + deadBand → B, inside the band → deck whose last wrist is nearest (side fallback). Two hands on one deck: the one nearer that deck's outer edge wins. Deck with no hand → extractor and stabilizer reset.

**Tests (replay at 30 fps with noise):** fist→open-hand transition with clutch released fires nothing; clutch fist → index_middle flick fires exactly one loop2 on the correct deck; interpolated fist→all_four transition passing through index fires loop4 only; holding a pose for 3 s after firing fires nothing more; tilted (45°) flick fires the same action; a hand at the centre line does not flip decks; left-half hand → deck A, right-half → deck B; two hands fire independently.

### Task 6: Deck store

**Files:** `src/state/deckStore.ts`, `tests/deckStore.test.ts`.
**Interfaces:**
- `interface ControlView { value: boolean | null; pending: boolean; unconfirmed: boolean; blind: boolean }` (value = function engaged: loop active, stem muted)
- `class DeckStore { constructor(o: { now: () => number; confirmMs: number }); setBlind(action: Action, blind: boolean); sent(deck, action); feedback(deck, action, on: boolean); tick(); get(deck, action): ControlView; snapshot(): Record<Deck, Record<Action, ControlView>>; subscribe(fn: () => void): () => void }`

**Tests:** initial value null; sent → pending; feedback → value set, pending cleared; no feedback after 300 ms + tick → unconfirmed, value unchanged; feedback after unconfirmed clears it; blind control flips optimistically and never goes pending; feedback without a send (FLX2 change) updates value; subscribers notified on change.

### Task 7: MIDI mapping and IO

**Files:** `src/midi/mapping.ts`, `src/midi/io.ts`, `tests/mapping.test.ts`, `tests/midiIo.test.ts`.
**Interfaces:**
- `interface MidiMapping { cmdChannel: Record<Deck, number>; fbChannel: Record<Deck, number>; notes: Record<Action, number>; invert: Partial<Record<Action, boolean>> }` (channels 0-based: cmd A0 B1, fb A2 B3)
- `DEFAULT_MAPPING`
- `pressMessages(m, deck, action): { on: number[]; off: number[] }`
- `parseFeedback(m, data: ArrayLike<number>): { deck: Deck; action: Action; on: boolean } | null`
- Minimal structural types `MidiAccessLike`, `MidiOutputLike`, `MidiInputLike` so tests can mock.
- `interface MidiStatus { outName: string | null; inName: string | null; outConnected: boolean; inConnected: boolean; feedbackSeen: boolean }`
- `class MidiIO { constructor(access: MidiAccessLike, mapping: MidiMapping, now?: () => number); outputs(): string[]; inputs(): string[]; select(outName: string | null, inName: string | null /* null = same name as output */); send(deck, action): boolean; onFeedback(fn); onStatus(fn); status(): MidiStatus; setMapping(m) }`
- `requestMidi(): Promise<MidiAccessLike | null>` (null if unsupported or denied)

**Tests:** press bytes for every action/deck (0x90/0x91, note, 127 and 0x80/0x81, note, 0); off is sent with timestamp now+10; feedback on channels 3/4 parsed, note_on vel 0 and note_off = off; channels 1/2 ignored; unknown note ignored; invert flips; IO sends to selected output; input defaults to same-named port; port disconnect updates status and send returns false; reconnect by name on statechange reattaches; feedbackSeen flips on first valid feedback.

### Task 8: Config and calibration

**Files:** `src/config/config.ts`, `src/config/calibration.ts`, `tests/config.test.ts`, `tests/calibration.test.ts`.
**Interfaces:**
- `interface Config { outPort: string | null; inPort: string | null; clutchOn: number; clutchOff: number; calibrated: boolean; holdMs: number; speedGate: number; poseMap: PoseMap; showSkeleton: boolean; cameraDim: number; blind: Partial<Record<Action, boolean>>; invert: Partial<Record<Action, boolean>> }`
- `DEFAULT_CONFIG` (clutchOn 0.32, clutchOff 0.40, holdMs 80, speedGate 3, cameraDim 0.35, showSkeleton true)
- `loadConfig(storage?: StorageLike): Config` (merges defaults, survives missing/corrupt/throwing storage); `saveConfig(cfg, storage?)` (swallows errors)
- `computeClutchThresholds(engaged: number[], relaxed: number[]): { ok: true; on: number; off: number } | { ok: false; reason: string }` (medians, gap < 0.08 or too few samples fails; band = gap/4 centred on midpoint)

**Tests:** defaults when storage empty, corrupt JSON, or throwing; partial stored config merged; save/load round trip; thresholds for clear separation; failure when overlapping; failure with < 10 samples.

### Task 9: Tracking adapter

**Files:** `src/tracking/handTracker.ts`.
**Interface:** `class HandTracker { static create(base: string): Promise<HandTracker>; detect(video: HTMLVideoElement, t: number): HandFrame[]; close() }` (VIDEO mode, numHands 2, GPU delegate with CPU fallback, model at `${base}mediapipe/hand_landmarker.task`, wasm at `${base}mediapipe/wasm`).
**Verify:** typecheck. No unit test (browser + GPU).

### Task 10: UI and wiring

**Files:** `index.html`, `src/ui/*`, `src/main.ts`, `src/record.ts`.
- `labels.ts`: `actionLabel(a)` ("LOOP 1", "DRUMS"...), `firedLabel(a, view)` ("LOOP 2 ON", "DRUMS MUTED", "NO REPLY"). Unit tested.
- `overlay.ts`: `drawOverlay(ctx, video, decks, cfg, labelFor)` draws mirrored, dimmed camera, centre line with DECK A/B labels, skeletons, rings per spec section 4.
- `console.ts`: `renderConsole(root, snapshot)` builds two deck panels, chips with classes `on | muted | unknown | pending | unconfirmed | blind`.
- `status.ts`: status pill (MIDI out/in, feedback, fps) and banner (`showBanner(text)`, `hideBanner()`).
- `settings.ts`: drawer with port selects, recalibrate, hold time, speed gate, pose map, skeleton toggle, camera dim, per-control blind/invert; emits config changes.
- `onboarding.ts`: browser check → camera → MIDI port → calibration (two 1.5 s captures of `clutchRatio`, `computeClutchThresholds`) → main.
- `main.ts`: load config, run onboarding when needed, frame loop via `requestVideoFrameCallback` (fallback rAF): tracker → pipeline → for each action `midi.send` + `store.sent` → `store.tick()` → overlay + console; MIDI feedback → store. Keyboard `S` toggles settings.
- `record.ts`: with `?record`, a Record button captures `{t, hands}` per frame and offers the JSON for download.
- Verify: typecheck, build, smoke test (Task 11). Commit.

### Task 11: Smoke test and README

**Files:** `scripts/smoke.mjs`, `README.md`.
- Smoke: `vite preview` on a free port, Chromium with fake media flags, assert the onboarding screen renders and there are no page errors or console errors. Run with `npm run smoke`.
- README: what it is, requirements (Chrome/Edge, virtual MIDI port, rekordbox), setup, rekordbox mapping table (MIDI IN channel 1/2, MIDI OUT channel 3/4 per function), gesture guide with the clutch, troubleshooting (no reply badge, blind mode, calibration), development commands, manual test checklist with the FLX2. Keep the demo video.
- Commit and push.
