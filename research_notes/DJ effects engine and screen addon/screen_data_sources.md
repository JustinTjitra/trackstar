# Live data sources for a DIY "CDJ-3000 style" companion screen (DDJ-FLX2 / DDJ-FLX4 + laptop DJ software)

Research date: 2026-11-20. Scope: where a companion display can get live waveform, playhead, title/artist, BPM, key, time remaining and loop/cue data when the DJ uses a DDJ-FLX2 or DDJ-FLX4 with laptop software (macOS first, Windows second).

Access note for the report writer: these hosts were unreachable from the research environment, so facts from them come from search-engine snippets (cited to the real URL) and not from a full page read: manual.mixxx.org, djtechtools.com, pioneerdj.com, virtualdj.com, djl-analysis.deepsymmetry.org (rekordbox.com was not attempted directly). GitHub pages and raw files were read in full. Anything labelled "recalled, not verified this session" is from the researcher's prior knowledge and should be checked before it is relied on.

---

## 1. rekordbox Performance mode: official API / OSC / network output, and what unofficial projects do

### Takeaway
rekordbox exposes no official live-data API in Performance mode; every working project either reads rekordbox's process memory (rkbx_link: per-deck position, BPM, beat, title/artist, phrases at 60 to 120 Hz) or reads files rekordbox writes (the encrypted master.db for history, about a minute late, and the unencrypted ANLZ analysis files for waveform, beat grid and cues). The only realistic rekordbox architecture is a hybrid: memory reader for the live transport plus ANLZ/master.db parsing for the static track data, and on macOS it requires re-signing rekordbox.app.

### Cited Findings

Official outputs
- rekordbox's Ableton Link integration "only allows for receiving a signal, not extracting it" according to the rkbx_osc README, which is the stated reason the memory-reading tools exist — [rkbx_osc mirror](https://github.imc.re/grufkork/rkbx_osc); rekordbox's own Link FAQ is at [rekordbox.com Ableton Link FAQ](https://rekordbox.com/en/support/faq/ableton-link) (not read in full).
- A feature request titled "In Rekordbox output the track info of the current master deck" is open on the Pioneer DJ community forum, which indicates no official now-playing output exists — [Pioneer DJ community](https://community.pioneerdj.com/hc/en-us/community/posts/37818300129689-In-Rekordbox-output-the-track-info-of-the-current-master-deck).
- What's Now Playing (a maintained multi-software now-playing tool) lists Serato DJ, Traktor, Virtual DJ, DJUCED, djay Pro, Denon StageLinQ, Mixxx and JRiver as inputs; rekordbox is not a direct input and is covered only through its "EarShot" companion app, which identifies tracks by audio recognition — [What's Now Playing docs 5.1.0](https://whatsnowplaying.github.io/whats-now-playing/5.1.0/).

rkbx_link (grufkork), the memory reader
- Describes itself as reading "transport position and beatgrid directly from memory"; outputs Ableton Link (master deck), OSC (any deck), sACN, track-to-file and setlist-to-file — [rkbx_link README](https://github.com/grufkork/rkbx_link).
- OSC addresses (deck = `master` or 1 to 4): `/[deck]/bpm/current`, `/[deck]/bpm/original`, `/[deck]/beat/subdiv/[x]`, `/[deck]/beat/trigger/[x]`, `/[deck]/time` (position in seconds), `/[deck]/track/[title|artist|album]`, `/[deck]/phrase/current|next|countin`. Defaults: source 127.0.0.1:4450, destination 127.0.0.1:4460. Several high-rate messages (time, beat subdivisions, phrase) are off by default — [rkbx_link README](https://github.com/grufkork/rkbx_link).
- Update rate: default `keeper.update_rate` 120 Hz, actual 60 to 120 Hz on Windows because of sleep granularity; OSC `send_every_nth` default 2 (about 60 Hz); heavier data such as track name is read every 10th update; `keeper.delay_compensation` in ms. No measured latency figure is published — [rkbx_link README](https://github.com/grufkork/rkbx_link).
- Not provided: waveform, cue points, loop state, key, time remaining (none appear in the README or release notes) — [rkbx_link README](https://github.com/grufkork/rkbx_link), [rkbx_link releases](https://github.com/grufkork/rkbx_link/releases).
- Supported rekordbox versions, Windows with paid license: 7.2.19, 7.2.18, 7.2.17, 7.2.16, 7.2.14, 7.2.13, 7.2.10, 7.2.8, 7.2.6, 7.2.4, 7.2.3, 7.2.2, 7.1.4; rekordbox 6.8.5 "will be added soon". macOS (community): 7.2.18, 7.2.17, 7.2.8, Apple Silicon only, "community-supported and somewhat experimental" — [rkbx_link README](https://github.com/grufkork/rkbx_link).
- Licensing: source is GPL-3.0; the free download ships an evaluation license with offsets for rekordbox 7.2.2 only; a paid license gives offsets for the latest versions and auto-update — [rkbx_link README](https://github.com/grufkork/rkbx_link). A Gumroad listing prices it at EUR 25 — [Gumroad](https://griffindigicoustics.gumroad.com/l/rkbx_link).
- Maintenance: 10 most recent commits run from 2026-07-20 to 2026-09-30 and are almost all per-version offset updates ("7.2.16 notice", "7.2.17 Notice", "MacOS 7.2.17 offsets", "7.2.18 Notice", "MacOS 7.2.18 offsets", "Fix panic on Rekordbox disconnect (macOS)", "7.1.19 Notice") — [rkbx_link commits](https://github.com/grufkork/rkbx_link/commits/master).
- Release history: v1.0.0 "rewritten, new beat tracking method"; v1.1.0 phrase export, real beat-grid reading, sACN, rekordbox 7.2.2; v1.2.0 rekordbox 7.2.8, macOS support, beat-trigger OSC topics (the page shows day/month only) — [rkbx_link releases](https://github.com/grufkork/rkbx_link/releases).
- Fragility: offsets are version-specific and selected by `keeper.rekordbox_version`; connection fails on a wrong version or wrong deck count; "Failed to read anlz file for deck #" can occur on first load, especially for streaming tracks; scratching may cause drift in the Link output — [rkbx_link README](https://github.com/grufkork/rkbx_link).
- macOS requirements: macOS blocks cross-process memory reads "even with sudo"; rekordbox must be re-signed with the project's `resign_rekordbox.sh`, which strips Apple notarization and adds the `get-task-allow` entitlement so `task_for_pid()` succeeds; then run `sudo ./rkbx_link`. SIP stays on. The doc notes that removing notarization "allows library injection if needed" and that rekordbox shows a security warning on first launch — [rkbx_link MACOS_SETUP.md](https://raw.githubusercontent.com/grufkork/rkbx_link/master/MACOS_SETUP.md).
- How offsets are found (macOS doc): locate the BPM address, scrub the playhead and diff memory with a `memory_browser` tool to find position (in samples at 44100 Hz), search the heap for "Title: x", and locate the per-deck ANLZ `.DAT` path on the heap via pointer maps — [rkbx_link MACOS_SETUP.md](https://raw.githubusercontent.com/grufkork/rkbx_link/master/MACOS_SETUP.md).
- rkbx_osc (the predecessor, free): OSC mode read the current beat and measure from the text display above the large waveform; release notes mention rekordbox 6.8.3 and 7.0.1; v0.3.0 moved offsets to a separate file so they can be updated without rebuilding — [rkbx_osc mirror](https://github.imc.re/grufkork/rkbx_osc), [rkbx_osc releases mirror](https://github.imc.re/grufkork/rkbx_osc/releases).
- A third-party fork, rkbx_os2l, re-targets the same memory reading at the OS2L lighting protocol — [fjel/rkbx_os2l](https://github.com/fjel/rkbx_os2l).

pyrekordbox (dylanljones), the file reader
- Reads the rekordbox 6/7 `master.db` (SQLCipher-encrypted) through `MasterDatabase`, rekordbox XML, ANLZ analysis files (`.DAT`, `.EXT`, `.2EX`: waveforms, beat grids, cues), `*SETTING.DAT`, and device-export `exportLibrary.db`; MIT license; "tested on Windows and MacOS"; tested with rekordbox 5.8.6, 6.7.7 and 7.0.9 — [pyrekordbox README](https://github.com/dylanljones/pyrekordbox).
- Key handling: "Starting from Rekordbox version 6.6.5 Pioneer obfuscated the app.asar file contents, breaking the key extraction"; workarounds are passing the key manually / caching it with `write_db6_key_cache(...)`, or `python -m pyrekordbox download-key`, which downloads the key "from known sources" — [pyrekordbox quickstart](https://pyrekordbox.readthedocs.io/en/stable/quickstart.html).
- History tables: `djmdSongHistory` links tracks (ContentID) to history playlists (HistoryID) — [pyrekordbox db6 format docs](https://pyrekordbox.readthedocs.io/en/stable/formats/db6.html).
- Disclaimers quoted from the README: "This project is not affiliated with Pioneer Corp. or its related companies in any way and has been written independently!" and "The maintainers of the project are not liable for any damages to your Rekordbox library." — [pyrekordbox README](https://github.com/dylanljones/pyrekordbox).

ANLZ analysis files (crate-digger, Deep Symmetry, pyrekordbox format docs)
- Tag inventory: `.DAT` holds PPTH, PVBR, PQTZ, PWAV, PWV2, PCOB; `.EXT` holds PPTH, PCOB, PCO2, PQT2, PWV3, PWV4, PWV5, PSSI; `.2EX` holds PPTH, PWV6, PWV7, PWVC — [pyrekordbox ANLZ format docs](https://pyrekordbox.readthedocs.io/en/stable/formats/anlz.html).
- PQTZ lists each beat's position in the bar, its time in milliseconds and the tempo at that point; PCOB holds memory points/loops or hot cues/hot loops; PCO2 is the extended cue list that was "originally used only in Rekordbox Performance Mode" and is exported since rekordbox 6; PSSI is the phrase/song-structure tag; PPTH is the audio file path — [pyrekordbox ANLZ format docs](https://pyrekordbox.readthedocs.io/en/stable/formats/anlz.html).
- pyrekordbox lists PWV6 and PWV7 (the CDJ-3000-era 3-band waveforms) as unsupported tags — [pyrekordbox ANLZ format docs](https://pyrekordbox.readthedocs.io/en/stable/formats/anlz.html).
- crate-digger parses `export.pdb` and `ANLZnnnn.DAT`/`.EXT` files via Kaitai Struct specs (`rekordbox_pdb.ksy`, `rekordbox_anlz.ksy`); license EPL-2.0 (MPL-2.0 / LGPL-3 secondary); format documentation is the Deep Symmetry "Export Structure Analysis" site — [crate-digger README](https://github.com/Deep-Symmetry/crate-digger), [Deep Symmetry export analysis](https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/exports.html).

"Now playing" tools for rekordbox
- supbox (gabek): gets the current track from rekordbox 6 by reading the decrypted database; rekordbox only marks a track as played about one minute into playback, so detection lags by about a minute; macOS only; MIT; repository archived 2025-01-07; the author notes it uses rekordbox in ways Pioneer has not approved and that changes could break it — [gabek/supbox](https://github.com/gabek/supbox).
- unbox (erikrichardlarson): supports rekordbox, Serato, Traktor, VirtualDJ, Mixxx, djay Pro and DJUCED; exposes a WebSocket at `ws://localhost:8080/ws` with JSON track updates (artist, track, label, remix, artwork, bpm, key, genre, album, comments, date); the README does not describe its rekordbox method — [erikrichardlarson/unbox](https://github.com/erikrichardlarson/unbox).
- legend (tombell), an OBS overlay for rekordbox, is discontinued; it credits PRACT-OBS, unbox and supbox — [tombell/legend](https://github.com/tombell/legend).
- A rekordbox user reports that the History list adds a track when it is loaded to a deck "with the user set delay", not when it becomes audible (single user observation) — [DJ TechTools forum archive](https://forum.djtechtools.com/archive/index.php/t-89498.html).

### Inferences
- A complete rekordbox data path needs three parts: (1) rkbx_link OSC for `/time`, BPM, beat and title/artist per deck; (2) a lookup from that track to its ANLZ files (via master.db `djmdContent` with pyrekordbox, or by extending rkbx_link, which already locates the per-deck ANLZ `.DAT` path in memory but does not publish it over OSC); (3) an ANLZ parser for PWV3/PWV5 (scrolling waveform), PWAV/PWV4 (overview), PQTZ (beat grid) and PCOB/PCO2 (cues, loops). Time remaining = track length minus `/time`; key comes from master.db. Live loop in/out state is not available from any found source.
- The rkbx_link source is GPL-3.0, so any code that links or derives from it must be GPL; talking to it over OSC as a separate process avoids that.
- Fragility is high and recurring: the commit log shows a new offset set for nearly every rekordbox point release (7.2.16, .17, .18, .19 inside about ten weeks in mid-2026). A companion product built on this breaks on every rekordbox auto-update until new offsets ship, and on macOS the re-signing step presumably has to be repeated after each rekordbox update because the installer replaces the app bundle.
- macOS offsets trail Windows (macOS list stops at 7.2.18 while Windows has 7.2.19) and are contributed by one community member, so macOS-first is the weaker platform for this path.
- master.db alone cannot drive the display: it gives history about a minute late and no playhead. It is still the best source for static metadata (key, cue colors, analysis path).
- Release years are not shown on the releases page; from the rekordbox versions named, v1.0.0/v1.1.0 are probably 2025 and v1.2.0 March 2026.

### Gaps
- Deep Symmetry's ANLZ page could not be fetched, so exact byte layouts were not verified this session. Recalled, not verified: PWAV is a 400-column monochrome preview (5 bits height, 3 bits whiteness); PWV3 is the monochrome scrolling waveform at 150 entries per second; PWV4 is a 1200-column color preview at 6 bytes per column; PWV5 is the color scrolling waveform at 2 bytes per entry, 150 entries per second; PWV6/PWV7/PWVC are the 3-band variants in `.2EX`.
- Whether pyrekordbox can safely open master.db while rekordbox is running, and how quickly history rows appear, is not documented in the sources found.
- Whether pyrekordbox's `download-key` works against current rekordbox 7.2.x was not confirmed; its README only lists testing up to 7.0.9. Last commit and release dates for pyrekordbox, crate-digger and unbox were not visible in the fetched pages.
- unbox's rekordbox mechanism and current rekordbox 7 status are undocumented in its README.
- Whether rekordbox has any MIDI clock or other tempo output in Performance mode was not checked.
- rkbx_link publishes no latency or jitter measurements.

---

## 2. Pro DJ Link / beat-link / prolink-connect

### Takeaway
Confirmed: these libraries only work with CDJ/XDJ/DJM hardware on an Ethernet Pro DJ Link network. They do not see rekordbox Performance mode driving a USB controller such as the DDJ-FLX2/FLX4.

### Cited Findings
- beat-link's README states "controllers which don't even have Link (Ethernet) jacks can't work either", and warns that beat-link and rekordbox on one machine "will compete over access to network ports" — [beat-link README](https://github.com/Deep-Symmetry/beat-link).
- beat-link data (when real players are present): beats, BPM, pitch, tempo master, metadata, artwork, beat grids, preview and detail waveforms with UI components, playback position; license EPL-2.0. XDJ-RX/RX2 are unsupported, Opus Quad is experimental, XDJ-AZ is not supported — [beat-link README](https://github.com/Deep-Symmetry/beat-link).
- Prolink Tools (built on prolink-connect) reads metadata from Pioneer devices over the Pro DJ Link Ethernet network and states it does not work with rekordbox HID mode or any other controller software; MIT — [prolink-tools](https://github.com/evanpurkhiser/prolink-tools).
- VizLink (macOS) requires closing rekordbox first because it needs the same port to talk to CDJs — [nzoschke/vizlink](https://github.com/nzoschke/vizlink).

### Inferences
- The FLX2 and FLX4 have no Ethernet port and rekordbox Performance mode does not announce deck state on the network, so there is nothing for these libraries to listen to. They remain the reference implementation for how a CDJ-style waveform display should be rendered from ANLZ data (beat-link ships waveform components).

### Gaps
- None material. beat-link's README wording about being unsanctioned was garbled by the fetch summarizer; the upstream text, as recalled, calls it "in no way a sanctioned implementation".

---

## 3. What the DDJ-FLX2 / DDJ-FLX4 send, MIDI sharing, and dead reckoning

### Takeaway
Both controllers are class-compliant USB MIDI devices whose jog, play, tempo fader and pad messages can be observed by a second app on macOS (and on Windows 11 with the 2026 Windows MIDI Services stack), but MIDI alone cannot tell you which track is loaded or where rekordbox actually is. Dead reckoning is only usable as an interpolator between ground-truth samples, not as a primary source.

### Cited Findings
- The FLX4 is USB audio and MIDI class compliant and works on Linux, Windows and macOS without drivers — [Mixxx manual, DDJ-FLX4](https://manual.mixxx.org/2.4/sq/hardware/controllers/pioneer_ddj_flx4). The FLX2 is USB class-compliant and needs no manufacturer driver — [VirtualDJ DDJ-FLX2 setup](https://virtualdj.com/manuals/hardware/alphatheta/ddjflx2/setup.html).
- The FLX4 manual refers users to "the MIDI message list on the Pioneer DJ website" — [manual aggregator copy](https://www.notice-facile.com/en/manual/329567/pioneer+dj+ddj-flx4). Pioneer publishes such lists under `pioneerdj.com/-/media/pioneerdj/software-info/controller/<model>/`, for example the DDJ-SB3 list — [DDJ-SB3 MIDI message list](https://www.pioneerdj.com/-/media/pioneerdj/software-info/controller/ddj-sb3/ddj-sb3_midi_message_list_e2.pdf).
- FLX4 MIDI as implemented in Mixxx's official mapping script: jog turn is a relative 7-bit value centered on 64; platter touch enables scratch with 720 ticks per revolution at 33 1/3 rpm; the tempo slider is 14-bit (MSB then LSB, `fullValue = (MSB << 7) + LSB`, range 0 to 0x3FFF); Play/Pause is note 0x0B and Cue 0x0C on status 0x90 (deck 1) / 0x91 (deck 2); hot cue pads are notes 0x00 to 0x07; pad-mode notes 0x1B (Hot Cue), 0x20 (Beat Jump), 0x6D (Beat Loop), 0x22 (Sampler) — [Mixxx Pioneer-DDJ-FLX4-script.js](https://raw.githubusercontent.com/mixxxdj/mixxx/main/res/controllers/Pioneer-DDJ-FLX4-script.js).
- The same script sends SysEx `F0 00 40 05 00 00 04 05 00 50 02 F7` at init and every 200 ms; the comment says it "was reverse engineered with Wireshark", queries the current control positions and "seems to double as a keep alive message" — [Mixxx Pioneer-DDJ-FLX4-script.js](https://raw.githubusercontent.com/mixxxdj/mixxx/main/res/controllers/Pioneer-DDJ-FLX4-script.js).
- FLX2 MIDI as described in the open Mixxx mapping PR: 14-bit faders, crossfader, EQ and CFX knob; jog/platter scratching; hot cue, Pad FX, beat loop, loop roll and sampler pads; LED feedback; hardware "fader start" messages and a Smart Fader exist — [Mixxx PR #16567](https://github.com/mixxxdj/mixxx/pull/16567).
- macOS allows multiple applications to access the same MIDI device simultaneously — [Morningstar support article](https://help.morningstar.io/en/article/issue-using-midi-controller-in-windows-os-980qxn/).
- Windows, traditional stack: "standard MIDI drivers are exclusive under Windows" — [JUCE forum](https://forum.juce.com/t/windows-multiple-client-usb-midi-drivers/10766); the input port "can only be used by one application at a time" — [Bome BMIDI white paper](https://download.bome.com/BMIDI_WhitePaper_2.3.pdf).
- Windows 11, new stack: with Windows MIDI Services every MIDI 1.0 port and MIDI 2.0 endpoint is multi-client regardless of driver or API, with built-in loopback endpoints; phased rollout to in-support Windows 11 releases began in February 2026 — [Windows Experience blog, 2026-02-17](https://blogs.windows.com/windowsexperience/2026/02/17/making-music-with-midi-just-got-a-real-boost-in-windows-11/), [Microsoft dev blog, known issues](https://devblogs.microsoft.com/windows-music-dev/windows-midi-services-rollout-known-issues-and-workarounds).

### Inferences
- Passive listening is feasible on macOS today and on up-to-date Windows 11; on Windows 10 or un-updated Windows 11 the port is taken by rekordbox. The companion app must only listen: sending LED messages or the keep-alive SysEx would fight the DJ software.
- What MIDI cannot tell a second app: which track was loaded (the browse encoder and LOAD button act on software-side library selection); the tempo range selected in software (plus or minus 6/10/16/WIDE); whether Beat Sync overrode the fader; quantize snapping; the software's jog bend curve; play state after end-of-track or software-initiated stops (the play button is a toggle, not a state); hot cue, beat jump and loop targets (knowable only if cue positions and beat grid are also read from ANLZ/master.db).
- Accuracy estimate (arithmetic, not measured): playhead error grows linearly with tempo error. A 0.1 % tempo mismatch accumulates 0.18 s over 3 minutes (180 s x 0.001), which is roughly a third of a beat at 128 BPM; every jog nudge, scratch, sync engage or cue jump adds an unbounded step error. A scrolling waveform needs errors of a few tens of milliseconds to look locked, so dead reckoning without periodic ground truth fails within the first minute of a real mix.
- Useful role: a MIDI tap gives sub-10 ms reaction to play/cue/jog events and can smooth or predict between slower ground-truth updates (for example 60 Hz OSC or a 10 to 30 fps screen capture).

### Gaps
- The official DDJ-FLX4 and DDJ-FLX2 "MIDI message list" PDFs were not located: pioneerdj.com was unreachable and searches surfaced only sibling models and the FLX4 hardware diagram. The Mixxx mapping source is the best verified substitute.
- No source confirms a test of a second CoreMIDI client listening to an FLX4/FLX2 while rekordbox is running, nor whether rekordbox on Windows uses the class driver in a way the new multi-client stack covers. Needs a 10-minute bench test with a MIDI monitor.
- Jog ticks per revolution for the FLX2 were not found (the PR mentions "platter resolution" fixes but the value was not extracted).

---

## 4. Mixxx as the alternative host

### Takeaway
Mixxx supports the FLX4 officially since 2.4.0 (February 2024); the FLX2 mapping is an open, unmerged PR targeting 2.6 as of 18 November 2026. Mixxx is the only host where every required datum is available by design: the controller scripting engine exposes playposition, BPM, duration, key, loop and hot cue positions today in stable 2.5.x, and 2.6 adds a QML controller-screen renderer with a waveform component, but 2.6 is still unreleased, OSC is still an unmerged draft, and track title/artist are not available to legacy JS scripts.

### Cited Findings

Controller support
- "new: Pioneer DDJ-FLX4 controller mapping based on DDJ-400 [#11245]" appears under Mixxx 2.4.0, released 2024-02-16 — [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md).
- The 2.4 manual says the FLX4 mapping was built on firmware 1.02; the 2.5 manual says the secondary pad modes (KEYBOARD, PAD FX1, PAD FX2, KEYSHIFT) are not implemented; 2.6 adds stems and key shift ("Pioneer DDJ-FLX4: support for stems" #15528, "implement Key Shift" #15674) — [Mixxx manual 2.4 FLX4](https://manual.mixxx.org/2.4/sq/hardware/controllers/pioneer_ddj_flx4), [Mixxx manual 2.6 FLX4](https://manual.mixxx.org/2.6/fi/hardware/controllers/pioneer_ddj_flx4), [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md).
- DDJ-FLX2: PR #16567 "Pioneer ddj flx2 mapping" by CupoMeridio (co-author RaduTek), opened 2026-06-04, retargeted to the 2.6 branch, still open with no approving review; last activity 2026-11-18. Working: transport, sync, jog scratching, 14-bit faders, EQ, CFX, hot cues, Pad FX, beat loops, loop rolls, samplers, LEDs, 4-deck layer. Not mapped: Smart CFX, fader start, master/headphone level knobs, vinyl toggle. Companion manual PR mixxxdj/manual#1002 is open — [Mixxx PR #16567](https://github.com/mixxxdj/mixxx/pull/16567). It is the only FLX2 PR in the repository — [Mixxx PR search](https://github.com/mixxxdj/mixxx/pulls?q=is%3Apr+FLX2). There is no FLX2 entry in the changelog — [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md).

Release status
- Latest stable is 2.5.6 (changelog date 2026-03-25, announced 2026-03-27, described as probably the last 2.5 release); 2.6 beta was announced 2025-05-11; the main-branch changelog still lists 2.6.0 and 2.7.0 as "(Unreleased)" — [Mixxx 2.5.6 news](https://mixxx.org/news/2026-03-27-mixxx-2_5_6-released/), [Mixxx 2.6 beta news](https://mixxx.org/news/2025-05-11-mixxx-2_6_beta-released), [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md).

Data exposed as controls (per deck group `[ChannelN]`)
- `playposition` (0 = start, 1 = end, range -0.14 to 1.14), `play`, `play_indicator`, `bpm` (rate-adjusted), `file_bpm`, `rate`, `duration` (seconds), `track_loaded`, `track_samples`, `track_samplerate`, `key` (1 to 24), `file_key`, `loop_enabled`, `loop_start_position` / `loop_end_position` (samples, -1 if unset), `hotcue_X_position` (samples), `hotcue_X_color` (RGB), `hotcue_X_status`, `cue_point`, `beat_distance` (0 to 1), `beat_active`, `beat_closest`, `end_of_track` — [Mixxx manual source, mixxx_controls.rst](https://raw.githubusercontent.com/mixxxdj/manual/main/source/chapters/appendix/mixxx_controls.rst).
- Track title and artist are not controls: a wish "Make meta tags of a song readable in JavaScript of a controller" is still listed as Confirmed — [Launchpad bug 1981673](https://bugs.launchpad.net/bugs/1981673); a draft PR that writes per-deck status files with artist/title (#13157) was told by maintainers it would not be merged, with JoergAtGithub suggesting string-type controls such as `[Channel1],song_title` and acolombier suggesting external tools build on the OSC interface — [Mixxx PR #13157](https://github.com/mixxxdj/mixxx/pull/13157).

Controller screen rendering (QML)
- PR #11407 "feat: controller screen renderer" by acolombier, opened 2023-03-26, merged 2024-06-03: QML scenes are rendered off-screen in a separate thread to a framebuffer object and delegated to the controller; the waveform is named as the most important component to support; needs a Qt6 build with the QML option on; a `--controller-preview-screens` command-line flag exists for testing; motivating device was the Traktor Kontrol S4 MK3 — [Mixxx PR #11407](https://github.com/mixxxdj/mixxx/pull/11407).
- Changelog places it in 2.6.0 (Unreleased): "Add screen renderer to support controllers with a screen" (#11407, #13334), "ControllerRenderingEngine: add OpenGL ES for controller screen rendering" (#15566), "QML: disable to fix link failure and avoid undefined behaviour" (#14772, Experimental Features), "Fix: trigger QML waveform slot at init" (#13736) — [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md).
- S4 MK3 manual: the 2.6 manual says Mixxx does not support controller screen rendering for this device; the 2.7 manual lists "support for screens" as new in 2.7.0, says screens are rendered with QML and sent over a USB bulk endpoint, that the screens use a separate mapping from the controller mapping, and that these features are "not available out of the box on Windows and Mac for now" — [Mixxx manual 2.6 S4 MK3](https://manual.mixxx.org/2.6/de/hardware/controllers/native_instruments_traktor_kontrol_s4_mk3), [Mixxx manual 2.7 S4 MK3](https://manual.mixxx.org/2.7/cs/hardware/controllers/native_instruments_traktor_kontrol_s4_mk3) (search-snippet level).

OSC / network output
- No OSC entry exists in the Mixxx changelog — [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md). "Parameter access via OSC" has been a wishlist item for years — [Launchpad bug 319386](https://bugs.launchpad.net/bugs/319386).
- PR #13714 "OSC in Mixxx" (Eve00000, opened 2024-10-01) was closed 2025-01-14 as superseded by #13835; it pushed `(Group)@Trackartist`, `(Group)@TrackTitle`, `track_loaded`, `duration`, `play`, and answered polled requests such as `/GetP#(Channel1)@playposition`; the sample client polled playposition every 500 ms — [Mixxx PR #13714](https://github.com/mixxxdj/mixxx/pull/13714).
- PR #14388 "OSC Tree/Branch/Leaf LIBLO" (Eve00000, opened 2025-02-21) is an open draft with no milestone: liblo backend, addresses like `/Channel1/play`, pushes `TrackArtist`, `TrackTitle`, `TrackLocation`, `TrackAlbum`, `TrackBPM`, `track_loaded`, `duration`, `play`; playposition by request (`/Get/cop/ChannelN/playposition`); up to 5 receiver IPs; all values sent as floats; last code push 2026-04-24, maintainer review comments the same day — [Mixxx PR #14388](https://github.com/mixxxdj/mixxx/pull/14388).
- A third-party TouchOSC mapping bridges volume, crossfader, pitch, play, cue, beatsync, playposition and jog through the MIDI scripting layer — [rajbot/mixxx_touchosc_mapping](https://github.com/rajbot/mixxx_touchosc_mapping).

Second window / external screen
- "Allow interface split on two windows" is an old wishlist bug and no multi-window entry exists in the changelog — [Launchpad bug 1456108](https://bugs.launchpad.net/mixxx/+bug/1456108), [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md). "Support external displays on controllers" was the original request behind the screen renderer — [Launchpad bug 1642786](https://bugs.launchpad.net/mixxx/+bug/1642786).
- Mixxx skins can be reshaped for small panels: a DDJ-400 + Raspberry Pi 4 build made the skin fit an 800 x 480 touchscreen — [DJ TechTools 2020](https://djtechtools.com/2020/11/05/building-a-standalone-ddj-400-with-a-raspberry-pi-and-mixxx/).

### Inferences
- Path A, works on stable 2.5.x today (recalled Mixxx scripting API, documented in the Mixxx wiki "Midi Scripting" pages, not re-fetched): Mixxx can load several controller mappings at once, and a JS mapping can call `engine.getValue` / `engine.makeConnection` on the controls above and send arbitrary bytes with `midi.sendShortMsg` / `midi.sendSysexMsg` (or HID/bulk packets). If the DIY screen enumerates as a USB-MIDI or HID device (Pi Pico, Teensy, ESP32-S3, or a Pi in gadget mode), a small "screen" mapping can stream playposition, duration, bpm, key, loop and hot cue positions to it over SysEx at the script timer rate, alongside the FLX4 mapping. Missing in this path: track title/artist and waveform data, because neither is a control.
- Path B, Mixxx 2.6+ QML controller screen: this is architecturally the closest thing to "render a CDJ-style deck display for an external screen": a QML scene with Mixxx's own waveform item and player/track properties, rendered off-screen per frame and handed to JS for transport to a device. For a DIY screen the device would need to accept raw frames over USB HID/bulk, or the scene could be shown through the preview path. Caveats: 2.6 is unreleased, QML is flagged experimental, and the manual says the feature is not available out of the box on Windows and macOS builds, which is the wrong way round for a macOS-first project.
- Path C, fork or patch Mixxx (GPL-2.0-or-later, recalled): because the source is open, a small patch can add string controls for title/artist, a local WebSocket/OSC publisher, or a second top-level window with a waveform widget. TriMixxx (section 7) shows a single-deck CDJ-style skin on a fork of 2.5.6 is practical. Cost: maintaining a fork and shipping custom builds.
- Path D, zero code: run the Mixxx main window with a custom deck-display skin full-screen on the HDMI screen. This costs the laptop its library view because Mixxx has a single main window.
- The OSC draft would cover title/artist/duration/BPM/track path by push and playposition by polling, but it is not in any release and has been in review since early 2025; do not plan on it for a near-term build.
- The FLX2 on Mixxx requires manually installing the mapping files from PR #16567 until it merges.

### Gaps
- Could not read manual.mixxx.org directly, so the exact English wording of the 2.7 S4 MK3 screen section (and whether "not available out of the box on Windows and Mac" still holds in current 2.6/2.7 builds) is from search snippets of translated manual pages.
- Whether the QML screen renderer can target an ordinary monitor window (rather than a framebuffer handed to a device) is not stated in PR #11407; only a preview in preferences and the `--controller-preview-screens` flag are mentioned.
- The exact QML API for track metadata and waveform inside controller screens (type names, properties) was not verified.
- Status of superseding OSC PR #13835 was not checked.
- The second half of mixxx_controls.rst was not read; `rate_ratio`, `visual_key`, `beat_next`, `waveform_zoom`, per-deck VU and time-elapsed controls may be documented there.

---

## 5. Other software: Serato, djay Pro, VirtualDJ, Traktor

### Takeaway
All four support both controllers to some degree, but none offers an official second-screen deck display. Traktor Pro is the easiest closed-source route because its controller screens are QML that can be modded (DJMirror already sells exactly this as an external-monitor deck view; traktor-api-client posts deck data to localhost), VirtualDJ is second (video-skin/skin windows plus a Network Control plugin), and Serato and djay only expose now-playing history files.

### Cited Findings

Controller support
- Serato DJ Lite supports the DDJ-FLX2 (hardware unlock); Serato DJ Pro requires a paid license with it; a Serato quick-start guide exists for the FLX4 — [Serato FLX2 quickstart](https://support.serato.com/hc/en-us/articles/11087620792591-AlphaTheta-DDJ-FLX2-Quickstart-Guide), [Serato DJ Lite 3.2.3 release](https://serato.com/dj/lite/downloads/3.2.3), [Serato FLX4 Lite quick-start PDF](https://serato.com:443/downloads/files/152799/Pioneer+DJ+DDJ-FLX4+Serato+DJ+Lite+Quick-Start+Guide.pdf).
- AlphaTheta lists rekordbox, Serato DJ Lite and djay (desktop and mobile) among FLX2-compatible apps — [AlphaTheta DDJ-FLX2 product page](https://alphatheta.com/en/product/dj-controller/ddj-flx2/), [AlphaTheta FLX2 announcement](https://alphatheta.com/en/information/introducing-ddj-flx2-compact-2-channel-dj-controller/).
- "The DDJ-FLX2 and DDJ-FLX4 are now compatible with Traktor Play" at no extra cost — [Native Instruments community](https://community.native-instruments.com/discussion/comment/251499). NI hosts a Traktor Pro mapping document for the FLX4, and a community mapping covers basic deck A/B functions of the FLX2 on Traktor Pro 4 — [NI Traktor mapping DDJ-FLX4 PDF](https://www.native-instruments.com/fileadmin/ni_media/downloads/manuals/traktor/Traktor_mapping_DDJ-FLX4_X.pdf), [NI community FLX2 mapping](https://community.native-instruments.com/discussion/47030/mapping-for-ddj-flx2).
- VirtualDJ ships a factory mapping and a hardware manual for the DDJ-FLX2 — [VirtualDJ DDJ-FLX2 manual](https://virtualdj.com/manuals/hardware/alphatheta/ddjflx2/setup.html).
- The FLX4 also connects to rekordbox for iOS by USB or Bluetooth MIDI — [Pioneer DJ news, 2023-03-30](https://www.pioneerdj.com/en/news/2023/rekordbox-for-mobile-ver-4/).

Traktor
- traktor-api-client sends live track data from Traktor Pro to a local web server (default localhost:8080) on track load, deck value/state changes and master/BPM changes; it is installed by replacing the D2 QML folder in Traktor's resources — [traktor.api-client mirror](https://github.amrom.workers.dev/PatrickDroidDev/traktor.api-client).
- unbox follows Traktor's master deck the same way: a "D2" controller file installed into Traktor's CSI folder with D2 selected as a controller in settings — [erikrichardlarson/unbox](https://github.com/erikrichardlarson/unbox).
- DJMirror is a paid (Patreon) mod that shows the S8/S5/D2 screen content on an external monitor; each DJMirror window shows exactly one full deck; v1.2.0 added touch for hot cues, remix slots and FX and waveform zoom; users run it on generic portable monitors; reported issues include deck C/D not working for one user and a launch-file requirement on Mac; users expect NI not to maintain compatibility — [NI community thread](https://community.native-instruments.com/discussion/44741/djmirror-allowing-screen-data-from-s8-s5-d2-to-be-displayed-on-external-monitor).
- NI forum answer: there is no direct way to access waveform data from a Traktor QML script — [NI community](https://community.native-instruments.com/discussion/36643/any-way-to-get-waveform-data-in-a-qml-script).
- Third-party QML screen themes for Traktor Pro 3 hardware exist — [traktor-kontrol-screens](https://github.com/JorgeHontoria/traktor-kontrol-screens).

VirtualDJ
- Forum guidance: VirtualDJ handles multiple monitors and windows, but the default skin is single-screen and "You can not load multiple skins (one per screen)"; suggested approaches are a videoskin consisting of just a waveform on the second screen, or making the waveform panel of a skin a separate window — [VirtualDJ forum, floating waveforms](https://virtualdj.com/forums/255884/VirtualDJ_Skins/Creating_floating_Browser%2C_waveforms_etc....html), [VirtualDJ forum, external monitor skin](https://virtualdj.com/forums/267437/VirtualDJ_Skins/Skin_with_external_monitor_view.html), [VirtualDJ forum, floating scratch wave](https://virtualdj.com/forums/262214/VirtualDJ_Skins/Floating_scratch_wave_on_second_monitor_.html).
- A Network Control Plugin exists and is still maintained: the build 9729 changelog (2026-11-03) mentions a `Type="text"` option for querying from it — [VirtualDJ changelog via Softpedia](https://mac.softpedia.com/progChangelog/VirtualDJ-Changelog-67583.html).
- OS2L is VirtualDJ's protocol for sending beat/lighting commands to DMX software — [Digital DJ Tips review](https://www.digitaldjtips.com/reviews/virtualdj-2018/).
- unbox integrates with VirtualDJ through a sound-effect plugin that follows the master channel — [erikrichardlarson/unbox](https://github.com/erikrichardlarson/unbox).

Serato
- Serato writes a binary session/history file during playback; SSLScrobbler reads the current session file from the Serato history folder; "Now Playing for Serato" reads the local history log; Serato's official Live Playlists feature sends the track list to Serato's website — [ben-xo/sslscrobbler](https://github.com/ben-xo/sslscrobbler), [e1miran/Now-Playing-Serato](https://github.com/e1miran/Now-Playing-Serato), [Serato support](https://support.serato.com/hc/en-us/articles/223455687).

djay Pro
- What's Now Playing reads a `NowPlaying.txt` file on macOS and queries djay Pro's SQLite play history; tested with djay Pro 5.x on macOS and Windows only — [What's Now Playing djay Pro input docs](https://whatsnowplaying.github.io/whats-now-playing/5.1.0/input/djaypro/).
- Multi-screen support in djay is a user feature request — [Algoriddim community: multiple screens](https://community.algoriddim.com/t/add-support-for-multiple-screens/15692), [Algoriddim community: split screen + 2 monitors](https://community.algoriddim.com/t/split-screen-2-monitors/35568.md).

### Inferences
- Ranking for "easiest second-screen deck display": (1) Mixxx (open source, all data, section 4); (2) Traktor Pro via QML mod: the screen QML already contains NI's own waveform, track info, BPM, key, time and loop widgets, and unbox shows the virtual D2 trick works without the hardware, so it should work with an FLX4 as a plain MIDI controller; DJMirror is an existing paid implementation; (3) VirtualDJ via a custom skin window or video skin plus VDJScript queries through the Network Control plugin; (4) Serato and djay: title/artist only, no playhead, no waveform, so screen capture is the only display route.
- Traktor Play (the bundled tier for FLX2/FLX4) is a different product from Traktor Pro; the QML-mod route needs Traktor Pro 3/4, where the FLX4 has an NI-documented mapping and the FLX2 only a basic community mapping.
- QML mods live inside the application bundle, so Traktor updates overwrite them: the fragility is moderate (re-install per update), far lower than memory offsets.

### Gaps
- virtualdj.com was unreachable: the Network Control plugin's query syntax, port, authentication and license requirements were not verified, nor whether VDJScript position/BPM/title queries work through it. VirtualDJ's license terms for using FLX2/FLX4 (free vs paid) were not checked.
- Whether traktor-api-client and DJMirror work on Traktor Pro 4 current builds, their licenses and last-update dates were not verified; the traktor-api-client excerpt did not show a playback-position field.
- No source found on Serato exposing playhead or waveform data by any route.
- Android availability of rekordbox mobile is contradictory between sources (Digital DJ Tips reported a May 2023 Android release; Pioneer's page said postponed) — [Digital DJ Tips](https://digitaldjtips.com/?p=2777667), [Pioneer DJ news](https://www.pioneerdj.com/en/news/2023/rekordbox-for-mobile-ver-4/).

---

## 6. Screen capture / window mirroring fallback

### Takeaway
rekordbox has no detachable waveform or deck panel; only the browser/collection can live on a second display. Mirroring therefore means capturing and cropping the rekordbox window at the OS level, which is robust against rekordbox updates and legally clean but gives pixels, not data.

### Cited Findings
- Pioneer forum reply: multiple displays can be used "for the collection and the main window"; users are still requesting a modular layout where the player section and track information can be moved to a second screen — [Pioneer DJ community: multiple display support](https://community.pioneerdj.com/hc/en-us/community/posts/22977456149913-rekordbox-multiple-display-support-Export-Performance-Mode), [Pioneer DJ community: multi display support](https://community.pioneerdj.com/hc/en-us/community/posts/22979311168793/comments/22993804573593).
- Performance mode can send a video/image output window to an external monitor, which is for video content, not waveforms — [rekordbox FAQ](https://rekordbox.com/en/support/faq/rekordboxdj).
- Layout options in Performance mode include 2Deck Horizontal and 2Deck Vertical views — [rekordbox 7 FAQ](https://rekordbox.com/en/support/faq/rekordbox7/).
- The first rkbx_osc design already used this idea in data form: it read the beat/measure text shown above the large waveform — [rkbx_osc mirror](https://github.imc.re/grufkork/rkbx_osc).

### Inferences
- Implementation options (general knowledge, not sourced): OBS window capture with a crop filter and a fullscreen projector on the HDMI output; a small native app using ScreenCaptureKit (macOS) or Windows.Graphics.Capture, cropping fixed rectangles for each deck's waveform and info strip. Expected added latency is one to three display frames. Works with any DJ software, including Serato and djay.
- Limitations: layout coordinates change when the user resizes the window or switches view; the cropped waveform keeps rekordbox's zoom and color settings; text is small unless the rekordbox window is large; the laptop screen must keep showing the waveform (on macOS a captured window may be occluded but not minimised); macOS requires the Screen Recording permission.
- OCR of the BPM/time/title strip from the capture is a possible bridge from pixels to data without touching rekordbox's process, at the cost of robustness.

### Gaps
- No write-up was found of anyone running a cropped rekordbox waveform on a controller-mounted screen; latency and legibility are untested estimates.
- The Pioneer forum reply about multi-display support is undated; rekordbox 7.2.x behaviour was not verified against the current manual.

---

## 7. Existing DIY and commercial projects that add a screen to a controller

### Takeaway
Every DIY screen project found gets its data by running Mixxx (usually on a Raspberry Pi) or by listening to real CDJs over Pro DJ Link; the one commercial external deck-screen product found, DJMirror, mods Traktor's QML. No project was found that shows live rekordbox Performance-mode waveforms on an external device.

### Cited Findings
- TriMixxx (reported 2026-10-16): Samuel Prevost's DIY CDJ built on a Raspberry Pi 4 with a CDJ-1000MK3 jog wheel; software is a fork of Mixxx 2.5.6 with a single-deck CDJ-style skin on a 10.1-inch touchscreen, most of the screen given to the waveform; Pro DJ Link compatibility reverse-engineered from traffic between two CDJ-2000NXS; described as open source and not a product. Data source: it is Mixxx — [DJ TechTools](https://djtechtools.com/2026/10/16/trimixxx-is-a-diy-cdj-built-on-a-raspberry-pi/).
- Standalone DDJ-400 (2020): DDJ-400 plus Raspberry Pi 4B and a 7-inch 800 x 480 touchscreen running Mixxx with a resized skin. Data source: Mixxx GUI — [DJ TechTools](https://djtechtools.com/2020/11/05/building-a-standalone-ddj-400-with-a-raspberry-pi-and-mixxx/).
- pi_dj: tips, configs and skins (including a waveform skin) for DJing with Mixxx on a Raspberry Pi and a controller — [dennisdebel/pi_dj](https://github.com/dennisdebel/pi_dj), [Mixxx guest article 2020](https://mixxx.org/news/2020-08-22-portable-mixxx-setup), [Hackaday 2020](https://hackaday.com/2020/07/03/djing-without-the-truckload-of-equipment-secret-ingredient-is-raspberry-pi).
- mixxx-pi-gen: generates a Raspbian image for Mixxx — [fayaaz/mixxx-pi-gen](https://github.com/fayaaz/mixxx-pi-gen).
- A Patreon build guide for a DIY all-in-one unit lists a 5-inch DSI touchscreen, Raspberry Pi 4B and a 24 V to 5 V buck converter mounted to a controller — [Patreon: Aftermarket Spinning](https://www.patreon.com/posts/152512557).
- CDJ-1000MK3 display mod (2017/2018): tracks are analysed in rekordbox, the analysis data is imported to an SD card and a microcontroller drives an NXS-style RGB waveform display. Data source: rekordbox analysis files, offline — [DJ TechTools 2018](https://djtechtools.com/2018/05/21/diy-upgrade-a-12-year-old-cdj-1000mk3-sd-card-rgb-waveform-slip-mode/), [DJ TechTools 2017](https://djtechtools.com/2017/06/20/cdj-1000mk3-gets-amazing-nxs-style-display-mod/).
- PiDeck: Raspberry Pi standalone decks built on xwax timecode control — [Raspberry Pi magazine](https://magazine.raspberrypi.com/articles/pi-deck).
- DJMirror (commercial, Patreon): external-monitor deck screens for Traktor Pro via the S8/S5/D2 screen QML — [NI community thread](https://community.native-instruments.com/discussion/44741/djmirror-allowing-screen-data-from-s8-s5-d2-to-be-displayed-on-external-monitor).
- Prolink Tools: overlays from CDJ data over Pro DJ Link; not usable with controllers — [prolink-tools](https://github.com/evanpurkhiser/prolink-tools).
- rkbx_link's ecosystem targets lighting and VJ sync (Link, OSC, sACN, OS2L fork); a search for a waveform or deck-display project built on it returned none — [rkbx_link README](https://github.com/grufkork/rkbx_link), [fjel/rkbx_os2l](https://github.com/fjel/rkbx_os2l).

### Inferences
- The consistent pattern (Mixxx on a Pi, or Mixxx fork with a custom skin) is strong evidence that Mixxx is the low-risk host for a DIY deck screen, and that a rekordbox-fed screen would be novel work rather than assembly of existing parts.
- The CDJ-1000MK3 mod and beat-link show that rendering CDJ-style waveforms from rekordbox ANLZ data is well understood; the unsolved part for a controller setup is only the live playhead and loaded-track identity.
- A tablet running the DJ app itself (rekordbox for iOS or djay with the FLX4 over USB/Bluetooth) is the commercial "screen on the controller" answer AlphaTheta already supports, at the cost of moving the whole session off the laptop.

### Gaps
- djtechtools.com was unreachable, so TriMixxx's repository URL, license and skin details are unverified beyond the search summary; no GitHub link was found.
- Reddit (r/DJs, r/Beatmatch) and YouTube were not searchable in a targeted way from this environment; no relevant threads surfaced through general search. Commercial tablet/laptop stands were not surveyed.
- The data source of the Patreon all-in-one build is not stated in the snippet (presumably Mixxx).

---

## 8. Legal / ToS: what the projects and the vendor say

### Takeaway
The rekordbox EULA prohibits reverse engineering, and the open-source projects that read rekordbox memory or its encrypted database operate without AlphaTheta's sanction, carry non-affiliation or "may break" disclaimers, and have nonetheless been public for years, with rkbx_link openly selling licenses. Reading ANLZ files, listening to MIDI and screen capture involve no circumvention.

### Cited Findings
- The rekordbox End User Licence Agreement (updated 2025-03-04) bars modifying, reverse engineering, disassembling or decompiling the program, except where applicable law expressly permits and then only after written notice to AlphaTheta — [rekordbox EULA](https://rekordbox.com/en/license-agreement/) (search-snippet level).
- rkbx_link's README contains no legal or ToS disclaimer, describes the memory reading openly, is GPL-3.0 and sells a license for current offsets — [rkbx_link README](https://github.com/grufkork/rkbx_link). On macOS it requires stripping Apple notarization from rekordbox.app and adding `get-task-allow`, which its own doc notes "allows library injection if needed" — [rkbx_link MACOS_SETUP.md](https://raw.githubusercontent.com/grufkork/rkbx_link/master/MACOS_SETUP.md).
- pyrekordbox: "not affiliated with Pioneer Corp. or its related companies in any way and has been written independently"; "The maintainers of the project are not liable for any damages to your Rekordbox library"; the database key "must be present on the machine running Rekordbox"; after Pioneer obfuscated `app.asar` in 6.6.5 the project added a command that downloads the key from known sources — [pyrekordbox README](https://github.com/dylanljones/pyrekordbox), [pyrekordbox quickstart](https://pyrekordbox.readthedocs.io/en/stable/quickstart.html).
- supbox's author notes it uses rekordbox in ways Pioneer has not approved and that changes could break or disable it — [gabek/supbox](https://github.com/gabek/supbox).
- beat-link and crate-digger are published as independent reverse-engineering research under EPL-2.0 with the file formats documented publicly — [beat-link README](https://github.com/Deep-Symmetry/beat-link), [crate-digger README](https://github.com/Deep-Symmetry/crate-digger).
- Mixxx's own FLX4 mapping uses a controller SysEx that "was reverse engineered with Wireshark" — [Mixxx Pioneer-DDJ-FLX4-script.js](https://raw.githubusercontent.com/mixxxdj/mixxx/main/res/controllers/Pioneer-DDJ-FLX4-script.js).

### Inferences
- Risk ordering, lowest first: Mixxx (open source, no restriction) < MIDI listening and screen capture of your own screen < parsing unencrypted ANLZ files you generated < opening the SQLCipher master.db with a key obtained outside rekordbox < reading rekordbox process memory < re-signing rekordbox.app. The last three sit against the EULA's reverse-engineering clause; for a personal DIY build this is the same position as the existing public projects, but a distributed product would carry real exposure and should get legal advice.
- Pioneer's 6.6.5 `app.asar` obfuscation shows the vendor does act to close these routes, which is a maintenance risk independent of the legal one.
- Re-signing rekordbox on macOS weakens that app's platform protections on the DJ's performance machine, a practical security trade-off the user must accept knowingly.

### Gaps
- The EULA text was not read in full (rekordbox.com not fetched); clause wording is from a search summary.
- No record was found of AlphaTheta taking action against any of these projects, and none of them state that they have permission. Jurisdiction-specific interoperability exceptions were not researched.

---

## 9. Ranked comparison of data paths

### Takeaway
For a make-or-break architecture choice: Mixxx is the only path that delivers every field with low fragility and no legal question, at the price of leaving rekordbox; if rekordbox is non-negotiable, the choice is between a fragile hybrid (rkbx_link + ANLZ/master.db) that yields true data and a robust pixel mirror (screen capture) that yields none.

### Cited Findings
- Each row below summarises findings cited in sections 1 to 8; the key sources are [rkbx_link README](https://github.com/grufkork/rkbx_link), [rkbx_link MACOS_SETUP.md](https://raw.githubusercontent.com/grufkork/rkbx_link/master/MACOS_SETUP.md), [pyrekordbox README](https://github.com/dylanljones/pyrekordbox), [pyrekordbox ANLZ docs](https://pyrekordbox.readthedocs.io/en/stable/formats/anlz.html), [Mixxx CHANGELOG.md](https://raw.githubusercontent.com/mixxxdj/mixxx/main/CHANGELOG.md), [Mixxx controls reference](https://raw.githubusercontent.com/mixxxdj/manual/main/source/chapters/appendix/mixxx_controls.rst), [Mixxx PR #11407](https://github.com/mixxxdj/mixxx/pull/11407), [Mixxx PR #14388](https://github.com/mixxxdj/mixxx/pull/14388), [Mixxx PR #16567](https://github.com/mixxxdj/mixxx/pull/16567), [beat-link README](https://github.com/Deep-Symmetry/beat-link), [NI DJMirror thread](https://community.native-instruments.com/discussion/44741/djmirror-allowing-screen-data-from-s8-s5-d2-to-be-displayed-on-external-monitor), [Windows MIDI Services announcement](https://blogs.windows.com/windowsexperience/2026/02/17/making-music-with-midi-just-got-a-real-boost-in-windows-11/).

### Inferences

Ranking is the researcher's judgment for this project (macOS first, FLX2/FLX4, full CDJ-3000-style display). Latency figures are estimates unless a source in sections 1 to 8 gives them.

| Rank | Data path | Data available | Latency / freshness | Fragility | Effort | License / legal |
|---|---|---|---|---|---|---|
| 1 | Mixxx host + custom "screen" controller mapping (JS, stable 2.5.x), screen device enumerates as USB-MIDI/HID | Playhead, duration (so time remaining), BPM, key, play state, loop in/out, hot cue positions and colors, beat phase. No title/artist, no waveform data from JS | Script-timer rate, a few ms to tens of ms | Low: public, documented control names; FLX4 official since 2.4; FLX2 needs the unmerged PR mapping | Medium: firmware + JS mapping; waveform must come from elsewhere (own analysis of the audio file, or path 2/3) | Open source; no ToS issue |
| 2 | Mixxx fork or patch: add title/artist/track path + local OSC/WebSocket publisher or second waveform window (TriMixxx-style custom skin) | Everything, including Mixxx's own rendered waveform | Native GUI frame rate | Low to medium: you own a fork and must rebase on releases | Medium to high: C++/Qt build pipeline for macOS and Windows | GPL (derivative must be GPL); no ToS issue |
| 3 | Mixxx 2.6+ QML controller-screen renderer | Everything, rendered by Mixxx QML (waveform, track info) | Per-frame at the screen's target fps | Medium: 2.6 unreleased as of 2026-11-20, QML experimental, reported not enabled out of the box on macOS/Windows builds | Medium once available: QML scene + frame transport to the device | Open source; no ToS issue |
| 4 | rekordbox hybrid: rkbx_link OSC (live) + master.db/ANLZ parsing (static) | Playhead, BPM, beat, title/artist/album, phrases live; waveform (PWV3/PWV5), beat grid, cues/loops, key from files. No live loop state | 60 to 120 Hz, no published latency | High: offsets per rekordbox point release; macOS lags Windows, Apple Silicon only, needs sudo and re-signed rekordbox.app; master.db key handling changed at 6.6.5 | High: OSC client, DB lookup, ANLZ parser, renderer, update treadmill | rkbx_link GPL-3.0 source, paid license for current offsets (about EUR 25); pyrekordbox MIT; conflicts with rekordbox EULA reverse-engineering clause |
| 5 | Traktor Pro QML mod (virtual D2 screen, DJMirror or traktor-api-client approach) | NI's own deck screen: waveform, title, BPM, key, time, loops, rendered by Traktor; or deck data over HTTP | Native GUI rate for the QML window; event-driven for HTTP | Medium: mod must be re-applied after Traktor updates; needs Traktor Pro (not the bundled Traktor Play); FLX2 mapping is basic | Low (buy DJMirror) to medium (own QML mod) | DJMirror paid; mods edit vendor QML inside the app bundle; licenses unverified |
| 6 | Screen capture and crop of the DJ software window to the HDMI screen | Pixels of the software's own waveform and info strip; any software | 1 to 3 frames (estimate) | Low against app updates; medium against layout/resizing changes | Low: OBS projector, or a small capture app | No reverse engineering; OS screen-recording permission only |
| 7 | VirtualDJ: skin window / video skin on second screen + Network Control plugin | VDJ-rendered waveform window; scripted queries for data (unverified detail) | Native GUI rate; polling for queries | Low to medium | Medium: skin XML + plugin setup | Commercial; terms unverified |
| 8 | Mixxx OSC (draft PR #14388 builds) | Title, artist, album, track path, BPM, duration, play pushed; playhead by polling | Polling interval (sample client used 500 ms) | High until merged: draft since February 2025, no release | Low to medium if using a PR build | Open source |
| 9 | Passive MIDI tap of the FLX2/FLX4 + dead reckoning | Control gestures only (play, cue, jog, tempo fader, pads). No track identity, no true position | Under 10 ms for events | Low technically; accuracy unusable alone (about 0.18 s drift per 3 min at 0.1 % tempo error, unbounded after jogs/sync) | Low | No issue; macOS multi-client, Windows 11 multi-client since 2026 rollout |
| 10 | master.db / history-file polling only (pyrekordbox, supbox, Serato session, djay NowPlaying) | Title/artist, key, BPM of the loaded/played track; no playhead | About 1 minute late on rekordbox | Medium (DB key, schema) | Low | MIT tools; DB decryption is unsanctioned |
| n/a | Pro DJ Link (beat-link, prolink-connect) | Everything, but only from CDJ/XDJ/DJM hardware | n/a | n/a | n/a | Not applicable to FLX2/FLX4 + laptop |

Suggested architecture reading of the table:
- If the host software can be Mixxx: build on path 1 now (USB-MIDI/HID screen + JS mapping), compute or fetch the waveform separately, and plan to move to path 3 or 2 for native waveform and metadata.
- If rekordbox must stay: prototype path 6 first (works today, no breakage), and treat path 4 as an optional "data mode" for Windows users willing to accept the update treadmill; use path 9 only to smooth motion between samples.
- Paths 4, 5 and 6 can share one renderer if the screen firmware accepts either frames (capture) or a compact deck-state protocol (data).

### Gaps
- No path was bench-tested; all latency and effort entries are estimates from documentation.
- The decisive unknowns to test first: (a) rkbx_link on the target macOS and rekordbox version with an FLX4 attached; (b) a second CoreMIDI client listening to the FLX4 while rekordbox runs; (c) whether a current Mixxx 2.6 beta macOS build has QML controller screens enabled; (d) capture latency and legibility of a cropped rekordbox waveform on the target panel.
