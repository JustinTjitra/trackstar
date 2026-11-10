[![Watch the demo](https://img.youtube.com/vi/HVagoIxUzM0/maxresdefault.jpg)](https://youtu.be/HVagoIxUzM0)

# Trackstar

A touchless layer for DJing: hand gestures in front of a webcam become MIDI for rekordbox. It is built to sit **next to a controller** (developed with a Pioneer DDJ-FLX2), not to replace one. The controller keeps the faders, knobs, play and sync. Your hands get the loops and stems.

It runs in the browser: open the page in Chrome or Edge and play. Nothing to install apart from a virtual MIDI port.

> The demo video shows the previous Python version. The gestures and UI have changed; see the guide below.

## How it works

- **Hand tracking** runs locally in the browser with MediaPipe. No video leaves your machine.
- **Your left hand controls deck A, your right hand deck B**, decided by which half of the screen your hand is in.
- **A thumb clutch arms each hand.** Nothing fires unless you are holding it, so moving your hands around does not trigger anything.
- **The display follows rekordbox.** Loop and stem state comes from rekordbox's MIDI feedback, so pressing a button on the FLX2 updates the screen too.

## Requirements

- **Chrome or Edge** (desktop). Safari and Firefox do not support Web MIDI.
- **A webcam.**
- **A virtual MIDI port:**
  - **macOS:** the built-in IAC Driver. Open *Audio MIDI Setup*, choose *Window > Show MIDI Studio*, double-click *IAC Driver* and tick *Device is online*.
  - **Windows:** [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html). Install it and add a port.
- **rekordbox** with MIDI mapping (see below).

## Running it

Use the hosted build (GitHub Pages, deployed from `main`), or run it locally:

```bash
npm install
```

```bash
npm run dev
```

Then open the address it prints (usually `http://localhost:5173`) in Chrome or Edge.

The first launch walks you through camera access, picking the MIDI port and calibrating the thumb clutch. After that it opens straight to the main view.

## rekordbox mapping

In rekordbox, open *Preferences > MIDI*, pick your virtual port as the device (for example *IAC Driver Bus 1*), and add one row per function per deck. Set *Type* to *Button* for every row.

Trackstar sends commands on **channel 1 (deck A)** and **channel 2 (deck B)**. Map each row's **MIDI OUT** to **channel 3 (deck A)** or **channel 4 (deck B)** on the same note. That is how rekordbox tells Trackstar what is on.

| Function | Deck | MIDI IN | MIDI OUT |
|---|---|---|---|
| AutoBeatLoop 1 | 1 | `903E` | `923E` |
| AutoBeatLoop 1 | 2 | `913E` | `933E` |
| AutoBeatLoop 2 | 1 | `903F` | `923F` |
| AutoBeatLoop 2 | 2 | `913F` | `933F` |
| AutoBeatLoop 4 | 1 | `9041` | `9241` |
| AutoBeatLoop 4 | 2 | `9141` | `9341` |
| ActiveStem Drums | 1 | `9046` | `9246` |
| ActiveStem Drums | 2 | `9146` | `9346` |
| ActiveStem Vocal | 1 | `9047` | `9247` |
| ActiveStem Vocal | 2 | `9147` | `9347` |
| ActiveStem Inst | 1 | `9048` | `9248` |
| ActiveStem Inst | 2 | `9148` | `9348` |

Function names can vary between rekordbox versions. If a stem function is named differently (or your version adds Bass), search the DECK tab for *Stem*.

The first two digits are the message type and channel (`90` = note on, channel 1; `93` = note on, channel 4). The last two are the note in hex.

**Why separate feedback channels:** a virtual port is a loopback, so anything sent into it comes straight back out. Keeping commands on 1/2 and feedback on 3/4 means Trackstar never mistakes its own commands for rekordbox confirming them.

![Where to type MIDI IN and MIDI OUT in rekordbox's MIDI settings. Double-click a cell, type the value and press Enter.](images/MIDISetup1.png)

_The screenshot shows an older mapping. Use the values from the table above._

## Gesture guide

Every action works the same way:

1. **Arm:** make a fist and press your thumb against the side of your index finger, near the knuckle. The ring around your hand turns solid white and says ARMED.
2. **Flick a pose** and hold it for a moment. The ring fills in the deck colour and names the action, then flashes when it fires.
3. **Close back to the armed fist** before the next action. Until you do, the ring says CLOSE HAND and nothing else can fire.

Release your thumb and the hand is disarmed.

| Pose (while armed) | Action |
|---|---|
| Index | Loop 1 beat |
| Index + middle | Loop 2 beats |
| All four fingers | Loop 4 beats |
| Index + pinky | Drums on/off |
| Pinky | Vocals on/off |
| Index + middle + ring | Instrumental on/off |

For loops, the number of fingers is the number of beats. Everything is remappable in Settings.

There are no gestures for gain, tempo, EQ, play or sync on purpose: those live on the controller, and a gesture fighting a physical fader makes the value jump.

## The screen

- **Bottom console:** loop and stem state for each deck. Loops fill when active. Stems are lit while audible and struck through when muted.
- **Dashed outline:** rekordbox has not reported this control yet (normal right after launch).
- **Pulsing outline:** sent, waiting for rekordbox. Usually too fast to see.
- **Yellow "!" badge:** rekordbox did not reply within 300 ms. The MIDI OUT for that control is probably missing. Trackstar does not retry, because a retry would toggle it a second time.
- **BLIND tag:** this control has no feedback (set in Settings), so the display is a best guess.
- **Status pill:** MIDI port, feedback status and tracking frame rate.

Press **S** for settings: MIDI ports, hold time, motion limit, recalibration, pose map, per-control *blind* and *invert*, skeleton and camera dimming.

## Troubleshooting

- **Gestures fire but the console never changes.** Check the MIDI OUT column in rekordbox uses channel 3/4 (`92xx`/`93xx`). The status pill says *Waiting for rekordbox* until the first feedback arrives.
- **A stem shows the opposite of what you hear.** Stems are set to *invert* by default because rekordbox's ActiveStem light means "playing". If your version differs, untick *Invert* for that stem in Settings.
- **The clutch triggers too easily or not at all.** Recalibrate it in Settings and press your thumb firmly in the first capture.
- **Actions fire late or are missed.** Lower the hold time. If gestures fire during big hand movements, lower the motion limit.
- **The wrong deck responds.** Keep each hand on its own side of the dashed centre line.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build && npm run smoke
```

- `src/gestures/`: feature extraction, pose classifier, clutch state machine, deck assignment. Pure and unit tested.
- `src/state/`: deck state driven by rekordbox feedback.
- `src/midi/`: message mapping and Web MIDI port handling.
- `src/ui/`: canvas overlay, console, settings, setup flow.
- `tests/fixtures/synthHand.ts`: generates synthetic hands so gesture logic can be tested without a camera.
- `npm run smoke` drives the production build in Chromium with a fake camera and a fake MIDI port. It uses the Playwright install already on the machine.
- Add `?record` to the URL to record real landmark sequences as JSON for new test fixtures.

### Manual check with the FLX2

1. Open rekordbox with the FLX2 connected and the mapping above in place. Load tracks on decks 1 and 2.
2. Start Trackstar. The status pill should show the port and *Feedback OK* after the first action.
3. Arm your left hand and flick two fingers: deck 1 starts a 2-beat loop and 2B lights in the console.
4. Exit the loop from rekordbox or the FLX2: 2B goes out without touching Trackstar.
5. Open and close your hands without the thumb clutch: nothing should fire.
6. Mute and unmute each stem on both decks and check the console matches what you hear.
