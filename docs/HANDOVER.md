# Snorewatch handover

State at version **1.27.0** (2026-10-09, deployed to GitHub Pages from `main`). The owner is
porting the app to a native iPhone app; the web app stays the test bed for making the detector
more reliable. The detector is specified in [`docs/DETECTOR.md`](DETECTOR.md), with reference
outputs a port must reproduce.

Where to find what:
- **Detection rules:** §3; every formula and constant in [`DETECTOR.md`](DETECTOR.md).
- **Checks:** [`VERIFICATION.md`](VERIFICATION.md) (the latest checkpoints).
- **The three reviews** (v1.9.1, `a87c1f3`, `8e05d2b`): the status of every finding in
  [`REVIEW-RESPONSE.md`](REVIEW-RESPONSE.md).
- **Dataset evidence:** [`research/RESULTS.md`](../research/RESULTS.md).
- **Older history:** [`archive/`](archive/): the decisions and versions before the dataset
  study (`history.md`), older checkpoints (`verification-history.md`), the full review record
  (`review-response.md`) and how to restart automatic sensitivity (`auto-sensitivity.md`).
Marks: **[verified]** checked against this repository or by running it;
**[assumption]** believed, not proven; **[suspected]** probable problem;
**[owner]** decided by the owner; **[recommendation]** Claude's advice, not decided.

## 1. Purpose, features and limits

A static browser app that records a night with the phone microphone, keeps only short
snore clips, and gives a live view plus a morning report. Built for one person (the
repository owner, iPhone at the bedside), but it must work for many people and rooms
(**[owner]** do not overfit to the owner's bedroom). Not a medical device; it cannot
detect sleep apnea (stated in the UI).

What it does now **[verified by unit and browser tests]**:
1. **Record a night:** `https://kirdhsali.github.io/Snore/`, "Before you sleep", **Start**.
   Sensitivity Low / Normal (default) / High, locked while recording. A "Darken screen"
   button under Stop (and a 20 s timeout) turns the screen black; the screen stays awake
   (Wake Lock). Interruptions (the system pausing or switching off the microphone) are
   shown, retried and recorded as gaps. **Stop** in the morning.
2. **Report:** summary sentence, tiles, snores over time, loudness classes, ignored sounds
   by reason, **room noise** (plain findings and a pitch × time heatmap), episodes, the 8
   loudest snores to play, a one-line result of the background tests, "interrupted N×".
3. **Share:** star-map PNG (1080 × 1350) and a script-free HTML report with the room noise
   and 8 loudest + 5 random snores (share sheet on phones, download elsewhere).
4. **Downloads for a developer:** snores (.wav), data (.json, schema 2), copy summary
   (the test-clip download went with the automatic-sensitivity test in 1.24.0).
   `npm run evaluate -- <file>.json`
   re-counts a night with the current or candidate rules (background tests exactly from
   1.22.1 files, approximately from older ones).
5. **Demo:** `…/Snore/#demo` plays a simulated 90 s night (16 snores, 5 distractors).

Limits: the page must stay open with the screen on (iOS stops web microphones when the
screen locks); nothing is saved (a reload or crash loses the night); not tested on a
physical iPhone overnight; thresholds rest on 7 real nights of one person (one with two
phones) plus synthetic and public sounds (§7).

## 2. Requirements and decisions

Requirements:
- One-button UI, live view, report on Stop.
- **Privacy:** everything runs on the device; no backend, uploads or accounts. Only short
  snore clips keep audio: the counting detector's snores (0.25 s before to 0.15 s after,
  8 kHz from a 48 kHz or 16 kHz microphone, 7,350 Hz from 44.1 kHz; 16-bit); no background
  test keeps audio (since 1.24.0). Non-snore audio exists only in a
  ~6.5 s rolling buffer and as a rhythm candidate (≤ 12 s); ignored sounds keep features
  only; all buffers are wiped on Stop. Clips can hold nearby sounds or be mistakes, so the
  UI promises "only short snore clips", not "only snores". Google Fonts is the only network
  request **[verified by grep: no fetch/XHR/storage in `js/`]**.
- Static site, plain HTML/CSS/JS, no build step, no runtime dependencies; GitHub Pages.

Owner decisions (**[owner]**) still in force, most recent first (older ones:
[`archive/history.md`](archive/history.md)):
- **2026-10-08, after the code review's questions:**
  - The **knock test stays a background test**: no counting change for now; decide after more
    real nights. On ESC-50 it cut night sounds counted as snores from 7.6 % to 5.0 %, but
    confirmed snoring clips fell from 13 to 11 of 40. On nights 6 and 7 it matched Normal or
    dropped 2 sounds.
  - `npm run evaluate` **keeps reading old data files** (schema 1, and labelled estimates for
    files before 1.22.1), so nights 1–6 can be re-checked.
  - **Older history moves to `docs/archive/`**, so the current documents are quick to read.
  - The saved-nights interface `js/night-store.js` was already removed with the 1.24.1
    cleanup (Claude's suggestion); it can be restored from 1.24.0 if wanted.
- **2026-10-08, porting to a Swift iPhone app:** the owner is setting up the native app; the web
  app stays the place to make the detector more reliable and test its core. After a code
  review: first a cleanup PR (leftovers of detours, the live-pill bug, the breath rule as one
  constant, room noise fed a power spectrum; 1.24.1), then a detector specification and a
  command to run the detector over a WAV file.
- **2026-10-06, preparing the move to an iPhone app:** remove unnecessary code. The
  automatic-sensitivity test goes (it "did not work yet"), with its snore-band and
  moment-before rules, the per-sound measurements `lowRiseDb`/`preRise*Db` (less to port to
  Swift) and the test-clip download ("ok to lose for now"). Keep a log to restart it
  ([`docs/archive/auto-sensitivity.md`](archive/auto-sensitivity.md)). Keep the room-noise
  check. → 1.24.0.
- **2026-10-05, after the dataset study** ([`research/RESULTS.md`](../research/RESULTS.md)):
  **High counts with the 6 dB breath rule** (APSAA, PSG-Audio and night 4 agree; the cost, a
  few of High's quiet snores, is small against the precision gained); the High background trial
  ends with it. Record the study rerunnably in a new `research/` folder. YAMNet as a "second
  opinion" in the app: wanted in principle; design and a dependency exception in a new session.
- **Public datasets:** APSAA, PSG-Audio and the Khan clips are used locally only, never
  committed (APSAA: non-commercial, no redistribution; Khan: no licence, local testing only);
  ESC-50 is never committed (CC BY-NC). Allowed hosts in the cloud environment: §9.
- **Saving nights, history, accounts:** in the native iPhone app (the web app's unused
  storage interface `js/night-store.js` was removed in 1.24.1).
- **Repository:** public; ruleset on `main` (PR required, 0 approvals, required check
  `CI tests`, no deletions, no force pushes, no bypass). Claude merges its own PRs when CI
  is green; the release workflow creates tags.
- **Earlier (review phase, 1.9.2–1.12.4):** rhythm rule exactly as documented (R3, counting
  change shown and approved); interruptions shown, retried, recorded, nothing confirmed
  across a gap (R1); sensitivity truly locked (R7); privacy wording (R5); Phase B
  restructuring without behaviour change; "Darken screen" stays under Stop.
- **Before that:** default sensitivity Normal, not remembered across reloads; new detection
  rules run as background tests before they change headline numbers; centroid limit
  500 Hz; rumble filter 0.85; ESC-50 never committed; WAV export not split.

Claude's recommendations (**[recommendation]**, not decided):
- Keep plain UMD files rather than ES modules (Node `require` for tests and scripts).
- In the native app, prove locked-screen overnight recording on a real iPhone first; the
  browser side of `js/recorder.js` is the part to replace (`js/analysis.js` and below are
  specified in `DETECTOR.md`).

## 3. Detection rules in force (1.25.0)

Every formula, constant and order of operations, for a port: [`docs/DETECTOR.md`](DETECTOR.md).

Frames of ~43 ms (2048 samples at 48 kHz) → loudness and spectral shares → a sound starts
when a frame is `trigger` dB above the adaptive floor and above the absolute gate, and
ends when the level stays within `release` dB for 0.2 s. The floor follows the quiet
(falls with τ 0.5 s, rises with 8 s; 60 s during a sound).

| Sensitivity | Trigger / release | Gate | Breath rule (`BREATH_RULE_DB`, one value since 1.24.1) |
| --- | --- | --- | --- |
| Low | 12 / 6 dB | −65 dBFS | 6 dB (since 1.21.0) |
| Normal (default) | 8 / 4 dB | −75 dBFS | 6 dB (since 1.17.0) |
| High | 5 / 3 dB | −85 dBFS | 6 dB (since 1.23.0) |

`classify` checks in this order (first failing rule names the reason): too long (> 4 s),
too short (< 0.25 s), rumble (20–60 Hz share > 0.85), too bright (1–4 kHz share > 0.2 or
centroid > 500 Hz), not low (50–800 Hz share < 0.55), **no breath** (150–1500 Hz rise
above its room noise < 6 dB), [background test only: sudden], choppy (> 2 bursts → rhythm
candidate: counts when a snore accepted on its own starts 2–12 s before or after it). A snore is **confirmed** (counted in the figures)
when another snore lies 2–12 s away, never across an interruption.

Background tests (extra detectors on the same audio that keep no audio; counts go into the
data file and one line of the report, never the headline). Since 1.22.1 each stores every feature of its
snores and of the sounds it set aside (its own rules' rejections and its choppy sounds no
snore rescued), so `npm run evaluate` can re-run it with other limits, rhythm rescue
included:

| Test | Settings | Keeps audio |
| --- | --- | --- |
| `knock` (1.18.0) | chosen sensitivity + sudden start: reject a rise > 20 dB within 20 ms (`onsetJump`) | no |

The knock test stays in the background (owner, 2026-10-08). Ended tests: `high` (1.22.0–1.22.3,
High without the breath rule) and `auto` (automatic sensitivity, 1.8.0–1.23.0; restart log in
[`archive/auto-sensitivity.md`](archive/auto-sensitivity.md)); `npm run evaluate` still reads
both from older files.

## 4. What changed and why

Since the public-dataset study. Earlier versions (the review phase 1.9.2–1.12.4 and the
real-night phase 1.12.5–1.22.3) with their reasons: [`archive/history.md`](archive/history.md).

| Version | PR | Change and reason |
| --- | --- | --- |
| — | #57 | Public-dataset study, rerunnable in `research/` (APSAA, PSG-Audio, Khan, YAMNet, the owner's nights); results in `research/RESULTS.md` |
| 1.23.0 | #58 | **Counting change:** High needs 6 dB of breath noise (the datasets put High's 3–6 dB sounds at or below chance); the `high` background test and its clips removed |
| — | #59 | Two-phone night: own sound or room without listening (`research/two-phone/`, `research/RESULTS.md` §10) |
| 1.24.0 | #60 | Automatic sensitivity removed with its snore-band and moment-before rules, `lowRiseDb`/`preRise*Db` and the test-clip download (did not beat Normal; less to port to Swift); restart log in `docs/archive/auto-sensitivity.md`; counts unchanged |
| 1.24.1 | #61 | Code review for the Swift port: unused measurements (zero-crossing rate, mean level), embed mode and single-file build, the committed demo WAV and `js/night-store.js` removed; one `percentile`; one breath-rule constant; room noise gets the power spectrum; live-pill clock after an interruption fixed; counts unchanged |
| 1.25.0 | #62 | For the Swift port: the specification `docs/DETECTOR.md`; the night's analysis moved out of the recorder into `js/analysis.js`; `npm run analyze` (a WAV file through it: data file and snores WAV); reference outputs of four synthetic nights (`npm run reference`, `tests/fixtures/reference/`) that a port compares itself with; counts unchanged |
| — | #63 | Owner decisions after the code review: the knock test stays in the background, `npm run evaluate` keeps reading old files; older history of the handover, verification record and review response moved to `docs/archive/`; the review response now gives each finding's status at 1.25.0; smoke test brought up to date |
| 1.26.0 | #64 | The browser's actual microphone processing: the app asks for echo cancellation, noise suppression and automatic gain off but never checked; it now reads back what the browser applied (`getSettings()`), stores it in the data file (`microphone`), warns while recording, in the report, the shared report and the copied summary when any of it stayed on, and `npm run evaluate` prints it. Prompted by a friend's test night with much background counted (owner, 2026-10-09); counts unchanged |
| 1.27.0 | #65 | The night's timekeeping, after a tester saw times longer than the night (owner, 2026-10-09). An interruption is now the audio actually missing (real time minus the audio that came back, decided 0.5 s after audio returns): a backlog the page received late is analysed and leaves no gap, a second busy pause is measured on its own, an interruption right after audio returned opens its own gap, and the first returning block is no longer counted twice. Lengths use the monotonic clock or, when longer (a sleeping phone), the wall clock: a clock set back changes nothing and no gap is negative; a clock set forward during an interruption cannot be told from a sleeping phone and lengthens that gap. An audio clock check compares analysed audio with real time over continuous recording, per 5-minute window (verdict after 150 s; `audioClock` with `ratio` and `worstRatio` in the data file); off by more than 2 % it warns while recording, also on the dark screen, and in the report (the iPhone Bluetooth sample-rate bugs). A report note when the recording's clock and the phone's clock differ by more than a minute. **Owner decision:** episodes and the typical interval no longer span an interruption (confirmation already did not). The share image and report end at the time Stop was tapped, like the page (the image says "times approximate" when the timing note applies), and the busiest window ends with the night. Counts unchanged for nights without interruptions (reference outputs identical); where the page was only busy, the backlog is now analysed and counts can differ |

## 5. Architecture

```
mic or demo ─► js/recorder.js: AudioWorklet tap (ScriptProcessor fallback)
WAV file    ─► scripts/analyze.js
                 └─► js/analysis.js
                       ├─► SnoreDetector (chosen sensitivity, noise profile) ─► SessionStats ─┐
                       └─► SnoreDetector (background "knock", no audio)     ─► SessionStats ─┴─► frozen night record on Stop
               states: idle → requesting → recording ⇄ interrupted → stopping → completed
js/app.js (page) ◄── onState / onFrame / onEvent / onWakeLock
               live view while recording; report, share, downloads from the night record
```

| Path | Responsibility |
| --- | --- |
| `index.html`, `css/style.css` | Page, dark-first design, night screen; loads the scripts in order |
| `js/version.js` | Version + build (`dev`, replaced by the commit hash on deploy) |
| `js/stats.js` | `SessionStats`: confirmation (2–12 s, both ways, not across gaps), episodes, intervals, timeline buckets; ignored-sound records (features only); clip cap 1500 |
| `js/wav.js` | `encodeWav`, `clipFromAudio`, `wavPositions` (each clip's start in the snores WAV) |
| `js/noise.js` | `NoiseProfile` (per minute: median quiet level, p10/p90, octave bands 31.5 Hz–8 kHz, strongest 30–400 Hz tone); `summarize`/`describe` (findings: steady tone and mains hum, on/off cycles, mid/high stretches outside snoring, loud stretches) |
| `js/detector.js` | FFT, `FrameAnalyzer`, `SnoreDetector` (floor, events, features incl. `breathRise`, `onsetJump`, classification, clips, `release()`, `resumeAfterGap()`), `RhythmGate`, `classify`, `breathRuleDb`, `DEFAULTS`/`SENSITIVITY`/`REASONS`; facade `SnoreCore` |
| `js/synth.js` | Seeded synthetic sounds and rooms (snore, rattle, breath, swell, bump, knock, …) for the demo and tests |
| `js/charts.js` | Canvas drawing (live strip, timeline, clip waveform) |
| `js/share.js` | Star-map image, script-free HTML report, room-noise heatmap SVG (`noiseSvg`, also used by the app); runs in Node |
| `js/report-format.js` | Data file: `toReport` (schema 2), `fromReport` (reads schema 1 and 2) |
| `js/analysis.js` | One night's analysis, no browser: `createAnalysis` builds the counting detector (with the noise profile), the background tests (`BACKGROUND_TESTS`, `knock`) and their `SessionStats`; `process`, `addGap`, `finish`, `result` (the analysis part of the night record) |
| `js/recorder.js` | Recording controller: audio graph, interruptions, wake lock, states, `finishNight`; feeds `js/analysis.js`; browser APIs injected via `env` |
| `js/app.js` | The page only; test hooks on `window.__snorewatch` |
| `scripts/serve.js` | Local static server (`npm start`, 127.0.0.1 unless `HOST`) |
| `scripts/evaluate.js` | Re-counts a downloaded night (current rules for its sensitivity, without the breath rule, background tests with stricter rules via `recount`, exact from 1.22.1 files (removed tests: recorded counts only), per hour with room noise, room findings) |
| `scripts/eval-public.js` | ESC-50 benchmark (downloads ~600 MB outside the repo; clips faded in/out) |
| `scripts/analyze.js` | `npm run analyze`: a WAV file (8/16/24/32-bit or float, any channels) through `js/analysis.js`; writes the data file (`source: "file"`) and the snores WAV |
| `scripts/reference.js` | `npm run reference`: the reference outputs of four seeded synthetic nights (48 and 44.1 kHz, Normal and High) checked or rewritten (`--update`); `--wav <dir>` writes their input audio for a port |
| `scripts/make-sample.js` | Writes the demo night as a WAV (`samples/`, not committed) to play next to a microphone |
| `tests/*.test.js` | `node:test`: detector, share, serve, evaluate, report-format, recorder, noise, analyze, reference |
| `tests/e2e.js` | Playwright/Chromium at 390 × 844 with a fake microphone playing the synthetic night |
| `tests/fixtures/` | Synthetic reports only; `reference/` holds the reference outputs (`docs/DETECTOR.md` §12) |
| `research/` | Dataset studies outside the app (APSAA, PSG-Audio, Khan, YAMNet, the owner's nights): rerunnable scripts, data under `~/.cache/snorewatch`, results in `research/RESULTS.md` |
| `docs/review-probes/` | Adapted probes from the first review, the second review's controller/store probe, the full demo run (1.22.0) and the third review's N1/N2 probe (C6 and N2 apply up to 1.23.0, C4 up to 1.24.0) |
| `docs/archive/` | Logs of removed features, enough to restart them (automatic sensitivity, 1.24.0), and the older history: decisions and versions before the dataset study (`history.md`), verification checkpoints up to 1.23.0 (`verification-history.md`), the full review record (`review-response.md`) |
| `docs/DETECTOR.md` | The detector's specification for a port, with tolerances for comparing a port's data files with the reference outputs |
| `.github/workflows/` | `ci.yml` (`CI tests`: unit, lint, e2e), `pages.yml` (`Tests before deploy` → deploy, `main` only), `release.yml` (`Tests before release` → tag `vX.Y.Z`) |

**How a night flows:**
- **Recording:** `recorder.start()` creates the audio context and microphone (or demo
  buffer), the night's analysis (the two detectors) and a wake lock (a refused or unsupported
  lock is shown).
- **Interruptions:** context `suspended`/`interrupted`, track `mute`/`ended`, or 2 s without
  audio open a gap at the last analysed block; the status says so; `resume()` is retried every
  second and on visibility; audio that arrives while the context or track is not live is
  dropped. Returning audio is held for 0.5 s, then the gap is the real time since the last
  analysed block minus that audio (none below 0.2 s: it only arrived late); an event during
  the hold decides the gap first and opens a new one (1.27.0). Then each detector
  `resumeAfterGap()` (closes the open sound, rejects waiting candidates, drops anchors,
  shifts later events), each `SessionStats.addGap()`, and the held audio is analysed. At
  Stop an open gap is decided the same way; with nothing held it runs to Stop.
- **Stop:** flush, wipe buffers (`release()`), build one
  frozen night record (wall times, time zone, gaps, configuration, summary, events, noise
  profile, background tests with their snores and set-aside sounds). The report, sharing
  and downloads read only this record; a new or failed Start cannot change it.
- **Exports:** JSON via `toReport` (schema 2; top level incl. `timeZone`, `interruptions`,
  `microphone` (the browser's applied processing, since 1.26.0), `audioClock` (since 1.27.0),
  `minBreathRiseDb`, `noise`; per sound the features incl. `breathRiseDb`, `onsetJumpDb`,
  `wavStartSec`; `shadows.<test>` with its rules, summary, snores and `setAside`, each sound
  with every feature and, for snores, `rhythmRescued` since 1.22.1; older files may also hold
  `lowRiseDb`, `preRise*Db`, `shadows.auto` with `levels` and test-clip positions); snores
  WAV in time order; PNG/HTML share.
- **Persistence:** none. A reload, crash or iOS eviction loses the night.

## 6. Rejected approaches (do not repeat)

- Fixed −70 dBFS gate (lost a third of real snores); strict "choppy = not a snore";
  0.4 s minimum duration; Web Audio clip playback on iPhone (silent); audio-file analysis mode; split WAV export; remembering
  sensitivity; changing sensitivity mid-night; confirming across a gap; stopping the night
  on an interruption; Prettier on CSS/HTML; ES modules; a ruleset bypass.
- A 3 or 4.5 dB breath rule (night 4's hum swells carry 3–6 dB; on APSAA and PSG-Audio High's
  3–6 dB sounds were at or below chance) — for every sensitivity (High: 1.23.0).
- Keeping the `breath`/`breath6` background tests after 1.17.0 (exactly re-computable offline).
- Knock rule as a 10 ms step at 15 dB (missed a knock, depended on the 10 ms grid; 20 ms /
  20 dB used instead). ESC-50 without fades (clips cut mid-sound look like knocks).
- Automatic sensitivity as built in 1.8.0–1.23.0 (removed in 1.24.0; its own rejected
  approaches are listed in [`docs/archive/auto-sensitivity.md`](archive/auto-sensitivity.md)).
- Mains hum only when every reading is within 2 Hz of 50/60 (FFT bins of ~23 Hz).
- An absolute microphone limit (−100 dB) for the heatmap (wiped all bands in a quiet room).

## 7. Known issues, unfinished work, missing tests, open questions

- **No persistence** (§5); saved nights are 2.x.
- **Second review leftovers:** the night record is only shallowly frozen (C4); the gap edge
  (the partial frame and the rolling buffer carry over an interruption, `DETECTOR.md` §7;
  `elapsed` read after `release()`).
- Episodes split at an interruption since 1.27.0 **[owner, 2026-10-09]**.
- **[suspected] Phone load:** two detectors on the same audio (since 1.24.0; no background
  test keeps clips any more); CPU, battery and memory on an iPhone are not measured. Clips are capped by count (1500), not bytes; event metadata of all detectors
  is unbounded (R6). The third review measured a worst case in Node: 1,500 four-second
  clips at 8,820 Hz = 105.84 MB of PCM, WAV 116.42 MB, Blob another 116.42 MB, 338.82 MB of
  ArrayBuffers at the export peak (real clips run at 8,000 or 7,350 Hz, so somewhat less);
  an iPhone night is not measured.
- **Untested on a device:** overnight run, real interruptions (call, Siri, lock), share sheet,
  clip playback. Automated browser tests are Chromium only; the ScriptProcessor fallback has
  only a fake-browser unit test; the e2e demo step uses a random seed.
- **Pitch bias [verified, research/RESULTS.md §4]:** the 500 Hz centroid limit rejects most
  higher-pitched snores (Khan: 183 of 186 missed snores are "too bright"; children's and women's
  snoring and close recordings); open, owner's decision.
- **Detection evidence is thin [assumption]:** 7 real nights of one person (home and a
  hotel), synthetic rooms, ESC-50; since 2026-10-05 also the public datasets in
  `research/RESULTS.md` (High's breath rule settled there: 6 dB). Open: the knock test has
  not yet met a real knock night after 1.18.0; it stays a background test until it has
  (owner, 2026-10-08). Night 6's tonal late sounds.
- **Room noise:** findings not very informative yet (owner); the shared report's heatmap
  is 720 units wide, so its labels are small on a phone; the e2e run is too short for a
  heatmap (checked in unit tests and a one-off 3.5 min browser run).
- `npm run evaluate` reads features rounded to 3 decimals (6 night-4 sounds at exactly
  0.850 flip; for background tests the "own rules" line shows any such flip). Its
  background-test re-counts are exact only for files from 1.22.1; nights 4–6 (older files)
  get the labelled estimate, which can keep a rattle after the snore that rescued it is
  dropped (third review N2). No Content-Security-Policy; Google Fonts reveals the visitor's
  IP. No type checker. `eval:public` not in CI. Event times
  are analysed audio plus interruptions, not raw wall clock.
- **Third review leftovers (owner or later):** Pages publishes before the full CI suite
  finishes on `main` (12:27:40Z vs 12:28:40Z on `687b1f7`), workflow-wide write permissions,
  one Pages concurrency group for all branches, actions pinned by tag, the ruleset does not
  require up-to-date branches (settings: owner); `fromReport` is not a boundary for hostile
  input (revisit before reading arbitrary files); the room-noise summary cannot see gaps
  shorter than a minute (the heatmap shows them).
- R4 leftover: the dev server's 403 body says "Bad request".

## 8. Real nights (aggregate figures only; files never committed)

- **Night 4** (home, 2026-10-02, 1.12.4, 6 h 52 min): 955 confirmed recorded; real snoring
  01:52–02:17 and 03:15–03:56; ~260 false snores after 07:30 were swells of a low hum
  (breath noise 0–5 dB). Re-counted: no breath rule 961, 3 dB 822, 4.5 dB 730, 6 dB 661
  (after 07:30: 260 / 169 / 90 / 46; clear stretches 510 → 499 at 6 dB). Room: 50 Hz hum,
  a device ~21 min every ~52 min (probably the fridge).
- **Night 5** (hotel, 2026-10-04, 1.15.0, 6 h 39 min): Normal 76 (6 dB rule: 73); the shared
  report's loudest "snores" were 4 knocks (21–42 dB within 20 ms; real snores ≤ 18 dB), hence
  the knock test; auto 581 with 59/60 test clips not snores (quiet breathing over a motor's
  70–83 Hz tone), hence 1.16.0.
- **Night 6** (home, 2026-10-05, 1.19.0, 5 h 11 min): 223 confirmed (no breath rule: 290; the
  100 set aside look like hum swells: ~72 Hz, ~3 dB breath noise); clear snoring 01:46–02:40;
  06:39–06:44 tonal sounds, judged real by the owner; knock test identical; auto 757 with
  test clips that match the moment before them (room flicker), hence 1.20.0; room: mains
  hum, the fridge 6× every 53 min for 22 min, +10 dB.
- **Night 7, two phones** (home, 2026-10-05/06, 1.23.0, both Normal, 6 h 52 min; details in
  `research/RESULTS.md` §10): near the head 101 confirmed (15/h), at the foot end 6. Automatic
  labels (near − far level): of the confirmed snores the phones could decide, 89% are the owner's
  own sound. Snore-like sounds with ≥ 6 dB of breath noise are ~11 dB louder at the head; those with
  3–6 dB are equally loud at both phones (room), confirming the 6 dB rule at home. Six confirmed
  snores (04:25, 06:12–06:30) look like a room sound. YAMNet on the saved clips scores the owner's
  own sounds low (28% ≥ 0.5) and the room ones high. Room: 50 Hz hum near the head, a 40–48 Hz
  motor at the foot end, the fridge cycle (~57 min).

## 9. Setup, development and testing

Node ≥ 18 for the app scripts and unit tests; Node ≥ 20.19 for `npm run lint`; Chromium for
the browser test.

```bash
npm ci                                     # dev tools: Playwright, ESLint, Prettier (pinned)
npm test                                   # unit tests
npm run lint                               # ESLint + Prettier check; `npm run format` fixes
npx playwright install chromium            # once; or CHROMIUM_PATH=<path to chrome>
npm run test:e2e                           # browser test (~90 s)
for f in js/*.js scripts/*.js tests/*.js; do node --check "$f"; done
npm start                                  # http://localhost:8080
npm run eval:public                        # ESC-50 benchmark, before detection changes
npm run evaluate -- <report>.json          # re-count a downloaded night
npm run analyze -- <recording>.wav         # a WAV file through the app's analysis: data file + snores WAV
npm run reference                          # reference outputs unchanged? (-- --update after a detection change)
research/setup.sh                          # research only: Python venv + YAMNet (see research/README.md)
```

Configuration (environment variables, no secrets anywhere): `PORT=<port>`, `HOST=<address>`
for `npm start` (default 8080, 127.0.0.1); `CHROMIUM_PATH=<path>` for `npm run test:e2e`;
`ESC50_DIR=<path to an ESC-50 checkout>` (default `~/.cache/snorewatch/esc-50`).
External datasets live outside the repository (suggested `~/.cache/snorewatch/datasets/`)
and are never committed. In Claude's cloud environment, GitHub clones work and the owner
allowed `zenodo.org`, `huggingface.co` (with its file host `us.aws.cdn.hf.co`) and
`www.scidb.cn` (2026-10-05); each new container starts without the ESC-50 cache or the
research data under `~/.cache/snorewatch`.

Workflow: never commit to `main`; branch from the latest `main`, PR, merge when `CI tests`
is green; bump `package.json` and `js/version.js` together (a test checks); `release.yml`
tags. Rules: `CLAUDE.md` (= `AGENTS.md`) and `docs/WORKING-RULES.md`.

## 10. Next task

**Done (2026-10-08):** after a code review for the Swift port, 1.24.1 removed leftovers of
earlier detours and fixed the live pill after an interruption; 1.25.0 adds what the port needs:
the specification [`docs/DETECTOR.md`](DETECTOR.md), the reference outputs a port must reproduce
(§12 there) and `npm run analyze` to run the analysis on any WAV file. Counts unchanged.

**Done (2026-10-09):** 1.27.0 fixes the night's timekeeping (interruptions as missing audio,
the audio clock check, episodes split at interruptions; §4). 1.26.0 records the browser's actual microphone processing (a friend's test
night kept much background; whether his browser left noise suppression on was unknown). A
strategy review of the detector is under way (advisor session and an independent ChatGPT
review); the next detector task follows from it and may replace item 1 below.

**Agreed next (owner):**
1. **New session: YAMNet as a "second opinion" background test.** A design note first, for the
   owner's approval: where it runs (judging the detector's candidates on full-rate audio, turned
   up to -20 dBFS), which runtime (LiteRT/MediaPipe or ONNX Runtime Web, self-hosted), model file
   (official Google release, Apache 2.0, licence text shipped), the exception to "no runtime
   dependencies", phone load (CPU, battery, memory) and what goes into the data file. The score
   is stored beside today's verdict; the headline count does not change. Caution from night 7:
   on the owner's saved 8 kHz clips YAMNet did not recognise the owner's snoring, so the test must
   show on real nights that full-rate judging works before YAMNet gets any counting role.
2. **When the owner has time:** listen to the six room-labelled snores of night 7 (room sound or
   another sleeper?); a second two-phone night with the far phone on **High** (on Normal it heard
   only a quarter of the near phone's sounds, so many labels stayed unclear) and a clap in the
   middle of the room; the listening sample (about 40 clips where YAMNet and the rules disagree).
3. **Open, owner's decision:** the 500 Hz pitch (centroid) limit (Khan: 63 % of snores found
   at 500 Hz, 76 % at 800 Hz; ESC-50 confirmed false alarms 1.4 % -> 2.5 %); a background test
   first if wanted.

**With each new real night** (owner sends JSON and snores WAV): run `npm run evaluate`;
check the breath rule's set-aside sounds, the knock test and the room findings (1.22.x
files: also the High re-count 3 / 4.5 / 6 dB and its clips). These
re-counts are exact for nights recorded with 1.22.1 or later ("re-counted from its stored
sounds"); for older files they are labelled approximate.

**Later / owner's decisions pending:** room-noise wording; the
on-phone interruption check (a call or Siri with the screen dark).

**Future, separate from what is implemented:** the native iPhone app (owner, from
2026-10-08; its detector follows [`docs/DETECTOR.md`](DETECTOR.md) and is checked against the
reference outputs; the web app stays the test bed for detection changes), with saved nights and recovery, a history and room noise across nights
(in-night checkpoints, a persisted schema, a clip byte budget); accounts or sync only after
that and with an explicit privacy decision.
