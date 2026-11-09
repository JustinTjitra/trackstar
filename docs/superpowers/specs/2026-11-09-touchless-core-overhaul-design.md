# Touchless Core Overhaul: Design

Date: 2026-11-09
Status: Draft, pending user review
Follow-up (separate spec): RMX-1000 style effects extension

## 1. Goal

Rebuild the touchless DJ controller so it holds up in a live set next to a Pioneer DDJ-FLX2 running rekordbox. In priority order:

1. **No misfires.** Discrete actions only fire when the performer clearly means them to.
2. **Never out of sync.** The display shows what rekordbox reports, including changes made on the FLX2.
3. **A clean, readable UI** that does not compete with the performer's hands for screen space.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Platform | Full port to the browser: TypeScript + Vite, no UI framework. Python code is deleted (git history keeps it). |
| Runtime | Chromium browsers only (Chrome, Edge). Web MIDI is required. Served from GitHub Pages (HTTPS) or `localhost`. |
| Role next to the FLX2 | Complementary. The FLX2 owns faders, knobs, play and sync. Gestures cover loops and stems only. |
| Removed gestures | Gain, tempo, EQ (they fight the FLX2's physical controls), play/pause, beat sync (dedicated FLX2 buttons). |
| Arming | Thumb clutch: thumb tip pressed to the side of the index finger near the knuckle. |
| Firing rule | An action fires only when entering a pose from the armed fist, and nothing else fires until the hand returns to the armed fist. |
| Deck assignment | By screen half of the mirrored view (left = deck A, right = deck B), not by MediaPipe's handedness label. |
| State | Deck state changes only from rekordbox MIDI feedback. |
| Layout | Bottom console (mockup option B) plus a ring that follows each hand. |
| Stem display | Lit = audible, struck-through = muted. |

## 3. Architecture

```
camera ─▶ tracking ─▶ gestures ─▶ action ─▶ midi (out) ─▶ rekordbox
                                                              │
ui ◀── state ◀── midi (in, feedback channels) ◀──────────────┘
```

### Modules

Each module has one job and a narrow interface. Only `tracking`, `midi` and `ui` touch browser APIs; `gestures` and `state` are pure and unit tested.

| Module | Responsibility | Input | Output |
|---|---|---|---|
| `src/tracking/` | Wrap MediaPipe Tasks Vision `HandLandmarker` (VIDEO mode, 2 hands, GPU delegate with CPU fallback). | `HTMLVideoElement` frames | `HandFrame[]`: 21 image landmarks + 21 world landmarks + timestamp per hand |
| `src/gestures/features.ts` | Per-hand features: finger extension from 3D joint angles (world landmarks), clutch distance normalised by hand size, wrist velocity normalised by hand size, deck from screen half. | `HandFrame` | `HandFeatures` |
| `src/gestures/classifier.ts` | Map features to a pose: `fist`, `index`, `index_middle`, `index_middle_ring`, `all_four`, `pinky`, `index_pinky`, or `none`. | `HandFeatures` | `Pose` |
| `src/gestures/stabilizer.ts` | Per-deck state machine (section 4) with hold time, velocity gate and hysteresis. | `Pose`, clutch, velocity, timestamp | `ActionEvent` (e.g. `{deck: 'A', action: 'loop2'}`) and `RingState` for the UI |
| `src/midi/` | Web MIDI access, port selection and reconnection, action → message mapping, feedback parsing. | `ActionEvent`; incoming MIDI | MIDI messages; `FeedbackEvent` |
| `src/state/` | Per-deck store of control states (section 5). Pending timers. | `FeedbackEvent`, sent actions | `DeckState` snapshots |
| `src/ui/` | Render camera, hand skeletons, rings, bottom console, status pill, settings, calibration. Never makes decisions. | `DeckState`, `RingState`, landmarks | DOM + canvas |
| `src/config/` | Settings persisted in `localStorage` (wrapped in try/catch, defaults if unavailable). | | `Config` |
| `src/main.ts` | Wires modules together and runs the frame loop (`requestVideoFrameCallback`, falling back to `requestAnimationFrame`). | | |

### Gesture features

- **Finger extended**: angle at the PIP joint (MCP→PIP→TIP) from world landmarks above a threshold, with hysteresis (separate thresholds for becoming extended and becoming folded). This is orientation independent, unlike the current `tip.y < pip.y` check.
- **Clutch engaged**: distance from thumb tip (4) to index MCP (5), divided by hand size (wrist 0 to middle MCP 9), below the calibrated threshold, with hysteresis.
- **Velocity**: wrist displacement per second divided by hand size.
- **Deck**: wrist x in the mirrored display. Left half = A, right half = B. A small dead band around the centre line keeps the previous assignment so a hand on the line does not flip decks.

## 4. Gesture model

### Default pose map (per deck, remappable in settings)

| Pose (with clutch held) | Action | MIDI note |
|---|---|---|
| Index | Loop 1 beat | 62 |
| Index + middle | Loop 2 beats | 63 |
| All four fingers | Loop 4 beats | 65 |
| Index + pinky | Drums mute toggle | 70 |
| Pinky | Vocals mute toggle | 71 |
| Index + middle + ring | Instrumental mute toggle | 72 |

Note numbers match the current Python mapping so an existing rekordbox mapping partly carries over.

### Stabilizer state machine (one per deck)

| State | Ring shown | Transition |
|---|---|---|
| `IDLE` | Faint dashed ring | Clutch engaged and pose is `fist` → `ARMED` |
| `ARMED` | Solid white ring, "ARMED" | Clutch released → `IDLE`. Pose becomes a mapped action pose and velocity is under the gate → `FORMING` |
| `FORMING` | Arc fills in deck colour, names the action | Pose held for `holdMs` (default 80 ms) → fire action, go to `FIRED`. Pose changes, clutch released or velocity over the gate → `ARMED` (or `IDLE` if clutch released) without firing |
| `FIRED` | Filled flash naming the action ("LOOP 2"). The label switches to the confirmed result ("LOOP 2 ON" / "LOOP 2 OFF") when feedback arrives, or shows a warning if the control goes `unconfirmed` | After the flash (~250 ms) → `REARM` |
| `REARM` | Dim ring, "CLOSE HAND" | Pose returns to `fist` with clutch engaged → `ARMED`. Clutch released → `IDLE` |

Consequences:
- Moving from one pose to another never fires anything, because it does not start from `ARMED`.
- An unmapped pose in `ARMED` does nothing.
- The hand leaving the frame resets that deck to `IDLE`.

### Calibration

Run on first launch and from settings. Two prompts of about 1.5 s each: "Make a fist and press your thumb to the side of your index knuckle", then "Make a fist with your thumb relaxed away". The clutch threshold is the midpoint of the two median normalised distances, with a hysteresis band of a quarter of the gap. If the two medians are too close to separate (gap under a fixed minimum), calibration fails with a message asking the user to press the thumb more clearly, and the previous threshold is kept.

## 5. MIDI and state sync

### Channels, not ports

The app sends commands and reads feedback on **one virtual port by default** (IAC Driver bus on macOS, loopMIDI port on Windows). Commands and feedback are separated by channel:

| | Deck A | Deck B |
|---|---|---|
| Commands (app → rekordbox) | Channel 1 | Channel 2 |
| Feedback (rekordbox MIDI OUT → app) | Channel 3 | Channel 4 |

The app ignores channels 1 and 2 on input, so it never mistakes its own commands for confirmation. rekordbox ignores channels 3 and 4 on input because nothing is mapped to them. This works whether rekordbox pairs input and output by port name or not. Settings allow a separate input port if a user prefers that, but the channel rule applies either way.

### Messages

- Every action sends a button press: `note_on` velocity 127, then `note_off` after 10 ms. rekordbox treats it as one press and toggles the function.
- Feedback: `note_on` with velocity > 0 means the function's LED is on. `note_on` velocity 0 or `note_off` means off.
- For stems, whether rekordbox's LED means "muted" or "playing" is verified during implementation. A per-control `invert` flag in the mapping handles either case.

### Control states

Each loop and stem control is in one of: `unknown`, `off`, `on`, `pending`, `unconfirmed`, `blind`.

- At launch every control is `unknown` until feedback arrives. The design does not assume rekordbox sends current LED state when a device connects.
- Sending an action sets the control to `pending`. Feedback resolves it to `on` or `off`.
- No feedback within 300 ms sets `unconfirmed` and shows a warning badge (usually a missing MIDI OUT mapping). **No automatic retry**, since a retry is a second toggle.
- If feedback is disabled or not mapped for a control, it runs as `blind`: the display flips optimistically on send and is marked as a best guess.
- Loops in rekordbox are mutually exclusive per deck in practice; the display follows feedback, so whatever rekordbox reports wins.

### Resilience

- Web MIDI `statechange`: if the port disappears, a banner shows and the app reconnects to the remembered port name when it returns. Actions are not queued while disconnected; they are dropped and the ring shows "NO MIDI".
- Camera permission denied or device lost: a full-panel message explains how to fix it. No frozen frame.
- MediaPipe model fails to load: error panel with the reason and a retry button.
- Web MIDI unsupported (Safari, Firefox): a clear message that Chrome or Edge is required.

### rekordbox mapping

The README documents the mapping: for each function, MIDI IN on the command channel and MIDI OUT on the matching feedback channel. Stretch goal: ship a CSV that rekordbox can import for the virtual device, if rekordbox's import accepts it for a virtual port. Which rekordbox functions offer MIDI OUT (especially stem mutes) is checked during implementation; any control without one runs `blind`.

## 6. UI

Mockups: `docs/superpowers/specs/2026-11-09-touchless-ui-mockups.html` (option B chosen).

- **Camera canvas**: full window, mirrored, slightly dimmed so overlays read. A faint dashed centre line labelled DECK A / DECK B.
- **Hand overlay**: skeleton plus the ring described in section 4, drawn on a canvas layer.
- **Bottom console**: two translucent panels, deck A (blue) and deck B (coral). Each shows LOOP chips 1B / 2B / 4B and STEMS chips DRUMS / VOCALS / INST using the six control states.
- **Status pill** (top centre): MIDI port status, feedback status, tracking fps.
- **Settings drawer** (gear icon, also `S` key): MIDI port(s), recalibrate, hold time, velocity gate, pose map, show/hide skeleton, camera dim level.
- **First-run flow**: browser check → camera permission → MIDI port pick → calibration → main view. Later launches skip straight to the main view with remembered settings.
- Visual tokens: dark booth palette, Sora for UI text, JetBrains Mono for labels and numbers. Respects `prefers-reduced-motion` (no pulsing; static outline instead).

## 7. Testing

- **Unit tests (Vitest)** for `gestures/` and `state/`, and for `midi/` mapping and feedback parsing against a mocked `MIDIAccess`.
- **Landmark fixtures**: JSON sequences of `HandFrame`s replayed through features → classifier → stabilizer. The first fixtures are synthetic: pose templates with noise and interpolated transitions, including fist-to-open and pose-to-pose transitions that misfire today. Required assertions: transitions fire nothing; deliberate actions fire exactly once; tilted hands classify the same as upright ones.
- **Recording mode** (dev only, hidden behind `?record`): records live landmark sequences to a downloadable JSON so real-hand fixtures can replace or supplement synthetic ones. Real recordings need the user's camera and cannot be made in CI.
- **Smoke test (Playwright, Chromium)**: the app loads, shows the browser/permission flow without console errors. Uses Chromium's fake media stream flags.
- **Manual checklist** in the README for the rekordbox round trip with the FLX2 connected.

## 8. Repository changes

- Remove: `src/main.py`, `tests/test_main.py`, `requirements.txt`, `bootstrap.sh`, `mini_dj.spec`, `.python-version`, `.Rhistory`, and the broken `.github/workflows/release.yml`.
- Add: Vite + TypeScript project at the repo root (`index.html`, `src/`, `tests/`, `package.json`, `tsconfig.json`, `vite.config.ts`).
- Add: GitHub Actions workflow that runs tests and type checks on push and deploys `main` to GitHub Pages.
- Rewrite `README.md`: what it is, the FLX2 + rekordbox setup, the mapping table, gestures, troubleshooting. Keep the demo video link.

## 9. Out of scope

- RMX-1000 style effects (next spec; will be a new mode built on this architecture).
- Gain, tempo, EQ, play/pause and sync gestures.
- Safari and Firefox.
- Serato or other DJ software.
- Multiple cameras or more than two hands.

## 10. Open items to verify during implementation

1. rekordbox MIDI OUT availability for loop and stem functions, and stem LED polarity.
2. Whether rekordbox sends a state dump when the virtual device connects (design works either way).
3. Whether rekordbox accepts an imported mapping CSV for a virtual port (stretch).
