# Snorewatch handover

State at version **1.18.0**, prepared 2026-10-04. 1.12.0 was reviewed independently
twice (v1.9.1 and `a87c1f3`); 1.12.1–1.12.4 fix the second review's C1, C2, C3 and C5.
1.12.5–1.14.0 follow up the first real night recorded with 1.12.4 (night 4, §6a): data
file and clips (1.12.5–1.12.6), the 6 dB breath test (1.13.0), auto sensitivity's release
(1.13.1) and its test clips (1.14.0). 1.15.0 records the room noise; 1.16.0 follows up
night 5 (§6b); 1.17.0 makes Normal count with the 6 dB breath rule (owner's decision);
1.18.0 adds the knock background test.
The tested revisions and all check results are in [`docs/VERIFICATION.md`](VERIFICATION.md);
the finding-by-finding answers to both reviews are in [`docs/REVIEW-RESPONSE.md`](REVIEW-RESPONSE.md).
Marks: **[verified]** checked against this repository or by running it;
**[assumption]** believed, not proven; **[suspected]** probable problem;
**[owner]** decided by the owner; **[recommendation]** Claude's advice, not decided.

## 1. Purpose and users

A static browser app that records a night with the phone microphone, keeps only
short snore clips, and gives a live view plus a morning report. Built for one person
(the repository owner, iPhone at the bedside); it should stay general enough for
other people and rooms (**[owner]** do not overfit to the owner's bedroom). Not a
medical device; it cannot detect sleep apnea (stated in the UI).

User journeys:
1. **Record a night:** open `https://kirdhsali.github.io/Snore/`, follow "Before you
   sleep", tap **Start**. A "Darken screen" button under Stop (and a 20 s timeout)
   turns the screen black; tap it to look. In the morning tap **Stop**.
2. **Report:** summary sentence, tiles, snores-over-time chart, loudness classes,
   ignored sounds by reason, episodes, 8 loudest snores (tap to play), a one-line
   result of the background tests, and "interrupted N×" if the system paused the
   microphone.
3. **Share:** star-map PNG (1080 × 1350) and a script-free HTML report with
   8 loudest + 5 random snores (share sheet on phones, download elsewhere).
4. **Hand data to a developer:** "Download data (.json)" (all events, features,
   interruptions, background tests) and "Download snores (.wav)";
   `npm run evaluate -- <file>.json` re-evaluates a night with the current rules.
5. **Demo:** `…/Snore/#demo` plays a simulated 90 s night (16 snores, 5 distractors).

## 2. Requirements and approved decisions

Requirements:
- One-button UI, live view, report on Stop. **[verified]**
- **Privacy:** only short snore clips keep audio (since 1.14.0 also up to 60 test clips of
  snores only the auto test heard, **[owner]**); everything runs on the device; no
  backend, uploads or accounts. Non-snore audio exists only in a ~6.5 s rolling
  buffer and as a rhythm candidate (≤ 12 s); ignored sounds keep features only; all
  buffers are wiped on Stop. Clips include 0.25 s before / 0.15 s after a snore and
  can be misclassified sounds, so the UI promises "only short snore clips", not
  "only snores". **[verified in code and tests]** Google Fonts is the only network
  request **[verified by grep: no fetch/XHR/storage in `js/`]**.
- Static site, no build step, no runtime dependencies (dev tools only); GitHub Pages.
- iOS stops web microphones when the screen locks, so the app keeps the screen awake
  (Wake Lock) and covers it with black; screen-off recording needs a native app.

Owner decisions (**[owner]**), most recent first:
- **After nights 4 and 5 (2026-10-04):** the 6 dB breath rule counts for **Normal**
  (1.17.0; Low and High unchanged, no real nights with them). The breath-rule background
  tests end with it; `npm run evaluate` shows any night with and without the rule. A
  sudden-onset (knock) rule is to be built as a background test first. The room-noise
  findings go into the report as they are ("let's start with this"); the owner finds them
  not very informative yet, so revisit their wording and content after some nights.
- **Night 4 follow-ups (2026-10-03):** the owner agreed that some of night 4's
  clips hold no snore and approved three changes: the time zone in the data file,
  clips at full 16-bit detail, and the 6 dB breath rule as a background test only
  (headline unchanged). Whether a breath rule counts is decided later (§8).
- **Saving nights, history, accounts:** to be done as version 2.x in a new session
  after the owner's instructions; nothing of it is started beyond the interface
  (§4, `js/night-store.js`).
- **GitHub ruleset on `main`** (set by the owner): pull request required with
  0 approvals, required status check `CI tests`, deletions and force pushes blocked,
  empty bypass list (Claude merges with the owner's account, so a bypass would
  exempt Claude too).
- **Phase B "go"** (restructuring without behaviour change, including ESLint and
  Prettier as dev dependencies); "Darken screen" must not move (B0).
- **Rhythm rule (R3):** implement the documented rule exactly: a choppy, snore-like
  sound counts when a snore accepted on its own starts 2–12 s before or after it;
  limits unchanged; rescued sounds never anchor. Merged after the owner saw the
  before/after numbers (synthetic confirmed 756 → 762; ESC-50 night sounds
  confirmed 22 → 23 / 1000).
- **Interruptions (R1):** show them, keep trying to resume, use real clock times,
  list the gaps, close the open sound at a gap, never confirm snores across a gap.
- **Sensitivity (R7):** truly locked while recording.
- **Privacy wording (R5):** "Everything stays on this device; only short snore
  clips are kept", with the caveat about nearby sounds and mistakes.
- Earlier (before this session): default sensitivity **Normal**, not remembered
  across reloads; new detection rules run as background tests (shadow detectors)
  before they change headline numbers; the default may switch to "auto + breath
  rule" only after 2–3 real nights and the owner's decision (planned v2.0);
  centroid limit 500 Hz; rumble filter 0.85 (owner's listening test); repository
  public; ESC-50 never committed; WAV export not split.

Claude's recommendations (**[recommendation]**, not decided):
- Keep plain UMD files rather than ES modules: modules would break the `file://`
  standalone build and Node `require` of the core.
- Saved nights: IndexedDB behind the `js/night-store.js` contract, written during
  recording (not only at Stop), recovering an unfinished night after a crash.
- Before a full native app, prototype locked-screen overnight recording on a real
  iPhone; the browser side of `js/recorder.js` is the part to replace.

## 3. What changed (v1.9.1 → v1.13.0) and why

An independent review of v1.9.1 (commit `e4eea25`) reported R1–R9 plus structural
advice. Phase A fixed the findings (one PR each), Phase B prepared the code for
expansion without behaviour change. Details per finding, with tests and results:
[`docs/REVIEW-RESPONSE.md`](REVIEW-RESPONSE.md).

| Version | PR | Change |
| --- | --- | --- |
| 1.9.2 | #11 | R2: a failed Start keeps the previous night and its downloads |
| 1.9.3 | #12 | R7: sensitivity disabled while recording; R6: dark-screen card queue bounded |
| 1.9.4 | #13 | R4: dev server contained to project files, loopback by default, 400 on bad URLs |
| 1.9.5 | #14 | R5: buffers wiped on Stop; precise privacy wording |
| 1.9.6 | #15 | R8: start-to-start intervals in time order; R9: evaluator reads breath rise |
| 1.10.0 | #16 | R3: rhythm rescue follows the documented rule (counting change, approved) |
| 1.10.1 | #17 | R1: interruptions detected, shown, resumed; real end time; gaps in the JSON |
| 1.10.2 | #18 | R1: events on the night's clock; nothing decided or confirmed across a gap |
| 1.10.3 | #19 | Workflows: read-only CI, tests before deploy and tag; docs aligned |
| 1.10.4 | #20 | B0: "Darken screen" moved under Stop (owner's bug report) |
| 1.10.5 | #21 | B1: ESLint + Prettier (JS only) in CI |
| 1.11.0 | #22 | B2: one versioned data file (`schemaVersion: 2`); evaluator respects gaps |
| 1.11.1 | #23 | B3: finished night is one frozen record |
| 1.11.2 | #24 | B4: recording controller `js/recorder.js` with explicit states |
| 1.11.3 | #25 | B5: `js/stats.js` and `js/wav.js` split out of `js/detector.js` |
| 1.12.0 | #26 | B6: storage interface `js/night-store.js` (not wired in) |
| (1.12.0) | #27 | CI job names `CI tests` / `Tests before deploy` / `Tests before release` for the ruleset |
| 1.12.1 | #29 | C1 (second review): `interrupted` audio context (iOS) is resumed like `suspended` |
| 1.12.2 | #30 | C2: the dark night screen follows the recorder ("Interrupted · trying to resume", "Microphone off · tap, then Stop") |
| 1.12.3 | #31 | C3: share image and HTML report state recorded time and interruptions; short-recording wording uses recorded time |
| 1.12.4 | #32 | C5: a screen lock that arrives after Stop or for an earlier night is released; stale release events ignored |
| 1.12.5 | #34 | Night 4 follow-up: the data file names the night's time zone; `npm run evaluate` counts per hour in it (was this computer's zone) |
| 1.12.6 | #35 | Night 4 follow-up: snore clips are turned up to listening level before the 16-bit conversion (were cut at −70 dBFS level, about 25 sample values, and boosted only for playback: grainy) |
| 1.13.0 | #36 | Night 4 follow-up: third background test `breath6` (chosen sensitivity + breath rule 6 dB); headline unchanged; `eval:public` reports it |
| 1.13.1 | #38 | Auto sensitivity (background test): a sound ends only once the level is back within the room's usual quiet range; in night 4 the release (3.2 dB) lay inside a wavering hum's usual level (median 3.2 dB, 5.0 dB in the quietest stretch), so sounds stayed open and loud snores were rejected |
| 1.14.0 | #39 | Auto test made checkable: a random sample of up to 60 clips of snores only auto heard ("Download test clips (.wav)", `wavStartSec` under `shadows.auto.snores`); `npm run evaluate` re-counts the 3 dB background tests with a 6 dB rule |
| 1.15.0 | #40 | Room noise step 1 (data only): per-minute noise profile (`noise` in the night record and JSON); `npm run evaluate` shows background and hum per hour. Detection unchanged |
| 1.16.0 | #41 | Night 5 (hotel): auto counted the sleeper's quiet breathing over a motor's 66–82 Hz tone (581 vs Normal 76; 59/60 test clips without a snore). New measure `lowRise` (50–800 Hz above its tracked room noise, like `breathRise`), saved per sound; the auto background test requires 8 dB. Normal unchanged |
| (—) | #42 | Room noise step 2 logic: `summarize`/`describe` in `js/noise.js` (steady tone, on/off cycles, mid/high stretches outside snoring, loud stretches); printed by `npm run evaluate`; not shown in the app |
| 1.17.0 | #43 | **Counting change (owner):** Normal requires 6 dB of breath noise (`SENSITIVITY.normal.minBreathRiseDb`, `breathRuleDb()`); night 4 961 → 661 confirmed, night 5 76 → 73; ESC-50 night sounds 100 → 78 (confirmed 23 → 14), snoring clips 29/40 kept (confirmed 13 → 12). Background tests `breath`/`breath6` removed (exactly re-computable offline); the JSON names the rule (`minBreathRiseDb`); the evaluator applies the night's sensitivity and prints the count without the rule |
| 1.18.0 | #44 | Knock background test `knock` (chosen sensitivity + sudden-start rule): new measure `onsetJump`, the largest rise over 20 ms at a sound's start, stored per sound (`onsetJumpDb`); option `maxOnsetJumpDb` rejects as 'sudden'; the test uses 20 dB. Night 5's 4 knocks 21–42 dB, real snores ≤ 23 dB (2 of night 4's 955 above 20). Synthetic `bump`. `eval:public` fades clips in and out over 0.1 s (they started mid-sound, which looked like a knock); with the rule ESC-50 night sounds 76 → 50 / 1000, snoring clips 29 → 28 (confirmed 13 → 11). Headline unchanged |

## 4. Architecture

```
mic or demo ─► js/recorder.js: AudioWorklet tap (ScriptProcessor fallback)
                 ├─► SnoreDetector (chosen sensitivity) ─► SessionStats ─┐
                 ├─► SnoreDetector (background "knock")  ─► SessionStats ─┼─► frozen night record on Stop
                 └─► SnoreDetector (background "auto")   ─► SessionStats ─┘
               states: idle → requesting → recording ⇄ interrupted → stopping → completed
js/app.js (page) ◄── onState / onFrame / onEvent / onWakeLock
               live view while recording; report, share, downloads from the night record
```

| Path | Responsibility |
| --- | --- |
| `index.html`, `css/style.css` | Page, dark-first design, night screen; loads the scripts below in order |
| `js/version.js` | Version + build (`dev`, replaced by the commit hash on deploy) |
| `js/stats.js` | `SessionStats`: confirmation (2–12 s, both directions, not across gaps), episodes, intervals, timeline buckets; the rhythm window as single source (`SnoreStats`) |
| `js/wav.js` | `encodeWav`, `clipFromAudio` (`SnoreWav`) |
| `js/noise.js` | `NoiseProfile` (`SnoreNoise`): room noise per minute of the night's clock from the counting detector's quiet frames: median level, p10/p90 of all frames, octave bands, strongest 30–400 Hz tone. Numbers only |
| `js/detector.js` | FFT, `FrameAnalyzer`, `SnoreDetector` (floor, events, classification, clips, `release()`, `resumeAfterGap()`), `RhythmGate`, `classify`, `DEFAULTS`/`SENSITIVITY`/`REASONS`. UMD facade `SnoreCore` that re-exports `stats.js` and `wav.js` |
| `js/synth.js` | Seeded synthetic sounds and rooms; used by the demo and tests |
| `js/charts.js` | Canvas drawing (live strip, timeline, clip waveform) |
| `js/share.js` | Star-map image and script-free HTML report (also runs in Node) |
| `js/report-format.js` | The data file: `toReport` (download), `fromReport` (reads schema 1 and 2) (`SnoreReport`) |
| `js/recorder.js` | Recording controller (`SnoreRecorder`): audio graph, detectors (one counting, background tests `knock` and `auto`), interruptions, wake lock, state machine, `finishNight`. Browser APIs injected through `env` (unit-tested with fakes) |
| `js/night-store.js` | Storage interface + in-memory implementation (`SnoreStore`). **Not loaded by the page** |
| `js/app.js` | The page only; never touches audio objects; test hooks on `window.__snorewatch` |
| `scripts/serve.js` | Local static server for `npm start` (127.0.0.1 unless `HOST`) |
| `scripts/evaluate.js` | Re-evaluates a downloaded night with current (or candidate) rules; compares background tests |
| `scripts/eval-public.js` | ESC-50 benchmark (downloads ~600 MB outside the repo) |
| `scripts/make-sample.js`, `scripts/build-standalone.js` | Synthetic sample WAV; optional single-file builds in `dist/` (not deployed, not maintained) |
| `tests/*.test.js` | `node:test`: detector, share, serve, evaluate, report-format, recorder, night-store |
| `tests/e2e.js` | Playwright/Chromium at 390 × 844 with a fake microphone playing the synthetic night |
| `tests/fixtures/` | Synthetic reports only (rhythm boundary, a 1.9 demo download, a 1.8-shaped file) |
| `.github/workflows/` | `ci.yml` (job `CI tests`: unit tests, lint, e2e), `pages.yml` (`Tests before deploy` → deploy, default branch only), `release.yml` (`Tests before release` → tag `vX.Y.Z` + release) |

**How a night flows:**
- **Recording:** `recorder.start()` creates the audio context and microphone (or demo
  buffer), the counting detector and the background tests on the same samples, and asks for a screen wake lock (a
  refused/unsupported lock is shown in the status).
- **Interruptions:** context `statechange`, track `mute`/`ended` or 2 s without audio
  open a gap; status "Recording interrupted … trying to resume" (or "switched the
  microphone off"); the recorder retries `resume()` every second and on visibility.
  Audio during a gap is not analysed. When audio returns, each detector
  `resumeAfterGap()` (closes the open sound, rejects waiting candidates, drops rhythm
  anchors, shifts later events by the gap) and each `SessionStats.addGap()`.
- **Stop:** flush, wipe buffers (`release()`), build one frozen night record (id,
  wall times, time zone, sample rate, gaps, configuration, summary, events with ids,
  background tests). The page shows the report from that record only; a new or failed
  Start cannot change it.
- **Exports:** JSON via `toReport` (schema 2; `offsetSec` on the night's clock =
  analysed audio + interruptions); WAV of all kept clips in time order; PNG/HTML share.
- **Persistence:** none in the app. Everything is in memory; a reload, crash or iOS
  eviction loses the night. `js/night-store.js` defines the future contract only.

Detection pipeline (defaults in `js/detector.js`): ~43 ms frames → loudness and
spectral shares → event when `floor + trigger` is crossed (Normal 8 dB, absolute gate
−75 dBFS) → `classify` (0.25–4 s, ≥ 55 % energy 50–800 Hz, ≤ 20 % at 1–4 kHz, centroid
≤ 500 Hz, 20–60 Hz share ≤ 0.85, breath rise ≥ 6 dB on Normal (none on Low/High), ≤ 2 bursts
else rhythm candidate) → `RhythmGate` → `SessionStats` (confirmed = another snore 2–12 s away).

## 5. Rejected approaches (do not repeat)

- Fixed −70 dBFS gate (quiet bedrooms record near −80 dBFS); strict "choppy = not a
  snore" (lost one in three rattling snores); 0.4 s minimum duration (lost 17 % of
  clear snores); Web Audio clip playback on iPhone (silent; `<audio>` used);
  auto sensitivity on single 40 ms frames (v1.8, too few snores in quiet rooms);
  audio-file analysis mode (removed v1.6); split WAV export; remembering sensitivity.
- This session: shipping the R3 fix as a background test first (owner chose the
  direct fix with before/after numbers); stopping the night on an interruption
  (owner chose resume and record the gap); changing sensitivity mid-night; confirming
  snores across a gap; Prettier on CSS/HTML (would expand every one-line rule);
  moving to ES modules (see §2); a ruleset bypass for the owner (would exempt Claude).

## 6. Known issues, unfinished work, missing tests

- **No persistence** (see §4). Saved nights are planned for 2.x.
- **Second review (a87c1f3), see `docs/REVIEW-RESPONSE.md` → "Second review":** C1
  (`interrupted` audio context never resumed), C2 (night screen said "Recording" after
  the mic ended), C3 (share image/HTML hid interruptions) and C5 (wake lock after
  Stop) are fixed in 1.12.1–1.12.4 (simulated; not yet seen on an iPhone). Still open:
  - **C4** night store returns shared nested data, a clip survives its event turning
    rejected, the night record is only shallowly frozen — fix before wiring storage in.
  - **C6** auto-sensitivity history (`levels[].t`, JSON `offsetSec`) uses sample time,
    events the gap-aware clock; the live pill mixes both.
  - Gap edge: the partial frame and raw ring survive `resumeAfterGap`; Stop reads
    `elapsed` after `release()` (sub-frame). Define "captured time" first.
  - **[owner] decision needed:** should snoring episodes split at an interruption?
    Today confirmation never crosses a gap, but two confirmed groups either side of a
    short gap form one episode. Changing it changes episode counts.
- **[suspected] Memory on long nights (R6, partly open):** clips are capped by count
  (1500, ~106 MB at worst per the review), not by bytes; event metadata of three
  detectors is unbounded; peak memory of the WAV export is not measured.
- **[suspected]** Several detectors on the same audio (three since 1.18.0) may cost noticeable
  CPU/battery on a phone; not measured.
- Interruption handling is verified with simulated events in Chromium only; how iOS
  Safari reports a call, Siri or a locked screen is **untested on a device**.
- Not tested on a physical iPhone in this session: an overnight run, the share sheet,
  clip playback after the v1.2 fix. Safari/WebKit and Firefox are not automated; the
  ScriptProcessor fallback has no automated browser test (only the fake-browser unit test).
- The e2e demo step uses a random demo seed (the review suggested deterministic
  seeds); the step was made robust (longer run) but is not seeded.
- **[assumption]** Thresholds generalise beyond 4 real nights of one person, synthetic
  sounds and ESC-50. Night 4 was the first live run of the background tests: the 3 dB
  breath rule was too lenient in that room (§6a); auto sensitivity counted more than
  Normal and missed loud snores (fixed in 1.13.1, simulated only). Since 1.14.0 up to 60
  of the snores only auto heard are kept as test clips, so they can be checked by ear.
- `npm run evaluate` reads features rounded to 3 decimals: on night 4, 6 sounds with a
  20–60 Hz share of exactly 0.850 flip from "rumble" to snore-like (1053 → 1061 recorded
  vs current with identical rules). Cosmetic; not fixed.
- No Content-Security-Policy; Google Fonts reveals the visitor's IP to Google.
- No type checker. `dist/` builds are not maintained. `eval:public` is not in CI.
- Event times are analysed audio plus interruptions, not raw wall clock (start, end
  and gaps use the real clock).

## 6a. Real night 4 (recorded 2026-10-02 with 1.12.4)

Only aggregate figures are kept here; the night's JSON and WAV are never committed.
Times are the owner's local time (UTC+2).

- 01:34–08:26, 6 h 52 min, no interruptions, screen lock held, Normal. Recorded:
  955 confirmed (139/h), 98 possible, 1534 ignored; background tests breath 3 dB 816,
  auto 1347. **[verified]**
- **Real snoring** 01:52–02:17 (~350, about every 4 s) and 03:15–03:56 (~150, louder):
  the clips show harmonic sound at 100–400 Hz rising over the 0.25 s before each
  snore. **[verified by spectrograms]** Almost nothing 04:00–06:00.
- **False snores after 07:30:** ~260 confirmed whose clips show the same spectrum as
  the moment before: swells of a low hum (centroid ~70 Hz, breath noise 0–5 dB,
  peak −73 to −75 dBFS) at intervals that confirm each other. Night 3 showed the
  same pattern (why the breath measurement exists since 1.9). **[verified by
  spectrograms; owner agreed]**
- **Room:** a steady 50 Hz hum, plus something that runs ~21 min every ~52 min
  and raises the background from −89 to −79.5 dBFS; restless from ~06:00.
- **Offline re-scoring** of the stored features (`scripts/evaluate.js` `reevaluate`):

  | Rules | Whole night | Clear stretches (01:34–02:30, 03:15–04:00) | After 07:30 |
  | --- | --- | --- | --- |
  | 1.0 (gate −70 dBFS, no confirmation; approximated) | 624 | 346 | 78 |
  | Current (1.12.4–1.13.0) | 961 | 510 | 260 |
  | + breath rule 3 dB | 822 | 505 | 169 |
  | + breath rule 6 dB | 661 | 499 | 46 |

  The trigger, floor tracking and release are unchanged since 1.0; the counting
  changes since then are the gate −70 → −75 dBFS (1.1), the rumble filter and
  rhythm rescue (1.4), centroid 500 Hz and confirmation (1.5), and the rhythm fix
  (1.10). The −75 dBFS gate (1.1) lets the quiet hum swells in, but the −70 dBFS
  gate also lost a third of the clear snores, so a level gate cannot separate them.
- **Side findings, fixed:** no time zone in the data file (1.12.5); clips cut at the
  raw −70 dBFS level, median 25 sample values, grainy when boosted (1.12.6).

## 6b. Real night 5 (hotel, recorded 2026-10-04 with 1.15.0)

Aggregate figures only; the files are not committed. Local time UTC+2 (Europe/Paris).

- 01:10–07:49, 6 h 39 min, no interruptions. Normal 76 confirmed (11/h), breath 3 dB 75,
  breath 6 dB 73; auto 581 (87/h), 60 test clips. **[verified]**
- Normal's snores are real (snore band rises a median 12–16 dB). The 3 snores the 6 dB
  rule drops look like short thumps. **But the shared report's 3 loudest "snores" and one
  random one (01:11:04–01:11:17, a minute after Start) were knocks:** an instant attack
  (14–32 dB within 10 ms) and an exponential decay; they passed every rule and confirmed
  each other by rhythm. Across nights 4 and 5, real snores jump at most 16.7 dB within
  10 ms (99% under 13 dB). **Built as a background test in 1.18.0** with a steadier measure:
  the largest rise over 20 ms (windows that do not overlap, so the knock's full step counts
  wherever it falls in the 10 ms grid): knocks 21.4–41.6 dB, real snores at most 23.1 dB
  (night 4, 99 % under 17), night 5's real snores at most 18.4 dB. Limit 20 dB: all 4 knocks
  out, 2 of night 4's 955 confirmed snores (the 10 ms version at 15 dB: 3 knocks, 3 snores).
- Auto: 59 of 60 test clips hold no snore (snore band +1.2 dB vs Normal's +15.8 dB). Its
  start margin sat 1.4 dB above the room's 90th-percentile flicker, so the sleeper's quiet
  breathing over a motor's 66–82 Hz tone passed. Fixed for the auto test in 1.16.0
  (snore-band rule 8 dB); the next night shows whether it holds.
- Room noise (first real profile): very quiet (−89 dBFS), a drifting 70–83 Hz tone for
  ~46% of the night; mid/high-pitch stretches mostly coincide with snoring (the sleeper's
  breathing), which the findings now leave out.

**How auto sensitivity works (exact, 1.16.0).** Starts like Normal (trigger 8 dB, release
4 dB above the floor) but with an absolute gate of −95 dBFS instead of −75. The floor follows
the quietest moments (falls with a 0.5 s, rises with an 8 s time constant; 60 s during a
sound). Quiet frames (no sound, more than 1 s after one) are averaged into half-second
blocks; the last 180 s are kept as levels above the floor. Every 30 s, with at least 20 s of
blocks: usual = median, spread = 90th percentile − median; release = max(1.5·spread + 2,
usual + spread + 1), trigger = max(release_old + 2 + spread, release + 1), limits 3–7 / 5–14 dB
(very quiet room, floor below −78 dBFS: release ≤ 7, trigger ≤ 9); each update moves at most
2 dB. Then the same rules as Normal plus, in the background test, breath noise ≥ 3 dB and
(since 1.16.0) a snore-band rise ≥ 8 dB.

## 7. Setup, development and testing

Requirements: Node ≥ 18 for the app scripts and unit tests; Node ≥ 20.19 for
`npm run lint` (ESLint 10); Chromium for the browser test.

```bash
npm ci                                     # dev tools: Playwright, ESLint, Prettier (pinned)
npm test                                   # unit tests
npm run lint                               # ESLint + Prettier check; `npm run format` fixes
npx playwright install chromium            # once; or CHROMIUM_PATH=<path to chrome> below
npm run test:e2e                           # browser test (~90 s)
for f in js/*.js scripts/*.js tests/*.js; do node --check "$f"; done
npm run build                              # optional dist/ single-file builds
npm start                                  # http://localhost:8080
npm run eval:public                        # ESC-50 benchmark, before detection changes
npm run evaluate -- <report>.json          # re-evaluate a downloaded night
```

Configuration (environment variables, no secrets anywhere):
`PORT=<port>` and `HOST=<address>` for `npm start` (default 8080 and 127.0.0.1;
`HOST=0.0.0.0` to test from a phone on the same network), `CHROMIUM_PATH=<path>`
for `npm run test:e2e`, `ESC50_DIR=<path to an ESC-50 checkout>` for `npm run eval:public`.

Workflow: never commit to `main`; branch from the latest `main`, open a PR, merge
when `CI tests` is green (Claude may merge its own PRs); bump `package.json` and
`js/version.js` together for app changes; `release.yml` creates the tag. See
`CLAUDE.md` / `AGENTS.md` (project rules) and `docs/WORKING-RULES.md` (general).

## 8. Next task

- **Agreed now:** the owner records real nights (Normal sensitivity) and sends the JSON,
  the snores WAV and the test-clip WAV; run `npm run evaluate -- <file>.json`. From 1.17.0
  Normal counts with the 6 dB breath rule: check by ear or spectrogram that the snores it
  sets aside ("no breath noise") hold no snore, and compare with the line "without the
  breath-noise rule". Compare Normal with the `auto` test and listen to its test clips
  (1.16.0: does the snore-band rule stop the quiet-breathing counts of night 5? does auto
  still miss Normal's loud snores, night 4: 80 of 150?). Any further default change
  (planned v2.0: auto + breath rule) needs 2–3 such nights, `npm run eval:public` and the
  owner's approval.
- **Knock test (1.18.0, background):** check in the next nights which snores the `knock`
  test drops (`npm run evaluate` lists its count; `onsetJumpDb` is stored per sound; listen
  to Normal's snores above 20 dB). Make it count only after real nights and the owner's
  approval.
- **Next build, owner agreed (2026-10-04):** the room-noise section in the report (below).
- **Next build, owner agreed (2026-10-03), after the auto work:** room noise for users.
  Step 1 (data only) done in 1.15.0: `noise` in the JSON. Step 2 logic done (not shown
  yet): `summarize`/`describe` in `js/noise.js` (steady tone held ≥ 7 of 10 minutes,
  regular on/off cycles, mid/high-pitch stretches outside snoring minutes, loud stretches;
  the 8 kHz octave left out), printed by `npm run evaluate`; owner saw examples for nights
  4 and 5 on 2026-10-04. Still to build: the "Room noise"
  report section with plain findings (steady hum, a device cycling on/off, noisy
  stretches, hours where quiet snores could not be heard) and a time × pitch heatmap;
  across nights (hour × night) once nights are saved (2.x). Step 3 (background test
  first): use it in detection, e.g. a level without the mains-hum band. Open owner
  question: show it in the shared image/HTML too, or only in the app?
- **Revisit with that data:** auto's restlessness measure ignores rejected sounds
  (hum swells, rumble), so it never saw night 4's swells. Counting them was tried in
  1.13.1 and left out (no measurable gain in simulation; one change at a time).
- **Independent review** of 1.12.0 done (saved in `docs/reviews/`); its answer is in
  `docs/REVIEW-RESPONSE.md`.
- **On the phone (owner, when convenient):** start a recording, trigger a real
  interruption (a call, Siri, another app playing audio) with the screen darkened,
  and check that the night screen says so, that recording resumes, and that the
  report, JSON and shared report show the gap. This is the device check C1–C3 need.
- **[owner] decision:** should episodes split at an interruption (see §6)?
- **Future, owner's instructions pending (new session, version 2.x):** saved nights
  on the device with recovery (IndexedDB implementing `js/night-store.js`), a history
  screen and retention policy.
  Prerequisites from the second review: fix C4; save progress during the night (a
  checkpoint, not only `finalize`); make confirmation updates reach storage; an
  explicit persisted schema with validation on import; a clip byte budget (R6).
- **Later, separate decisions:** native iPhone recording prototype (locked screen,
  overnight), then possibly a full native app; accounts or sync only after that and
  with an explicit privacy decision (it would change the on-device promise).
