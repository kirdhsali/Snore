# Snorewatch handover

State at version **1.12.4**, prepared 2026-10-01 as the checkpoint for a fresh
development session. 1.12.0 was reviewed independently twice (v1.9.1 and `a87c1f3`);
1.12.1–1.12.4 fix the second review's C1, C2, C3 and C5. The tested revision and all
check results are in [`docs/VERIFICATION.md`](VERIFICATION.md); the finding-by-finding
answers to both reviews are in [`docs/REVIEW-RESPONSE.md`](REVIEW-RESPONSE.md).
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
- **Privacy:** only short snore clips keep audio; everything runs on the device; no
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

## 3. What changed in this session (v1.9.1 → v1.12.4) and why

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

## 4. Architecture

```
mic or demo ─► js/recorder.js: AudioWorklet tap (ScriptProcessor fallback)
                 ├─► SnoreDetector (chosen sensitivity) ─► SessionStats ─┐
                 ├─► SnoreDetector (background "breath") ─► SessionStats ─┼─► frozen night record on Stop
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
| `js/detector.js` | FFT, `FrameAnalyzer`, `SnoreDetector` (floor, events, classification, clips, `release()`, `resumeAfterGap()`), `RhythmGate`, `classify`, `DEFAULTS`/`SENSITIVITY`/`REASONS`. UMD facade `SnoreCore` that re-exports `stats.js` and `wav.js` |
| `js/synth.js` | Seeded synthetic sounds and rooms; used by the demo and tests |
| `js/charts.js` | Canvas drawing (live strip, timeline, clip waveform) |
| `js/share.js` | Star-map image and script-free HTML report (also runs in Node) |
| `js/report-format.js` | The data file: `toReport` (download), `fromReport` (reads schema 1 and 2) (`SnoreReport`) |
| `js/recorder.js` | Recording controller (`SnoreRecorder`): audio graph, three detectors, interruptions, wake lock, state machine, `finishNight`. Browser APIs injected through `env` (unit-tested with fakes) |
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
  buffer), three detectors on the same samples, and asks for a screen wake lock (a
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
≤ 500 Hz, 20–60 Hz share ≤ 0.85, ≤ 2 bursts else rhythm candidate, optional breath
rise) → `RhythmGate` → `SessionStats` (confirmed = another snore 2–12 s away).

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
- **[suspected]** Three detectors may cost noticeable CPU/battery on a phone; not measured.
- Interruption handling is verified with simulated events in Chromium only; how iOS
  Safari reports a call, Siri or a locked screen is **untested on a device**.
- Not tested on a physical iPhone in this session: an overnight run, the share sheet,
  clip playback after the v1.2 fix. Safari/WebKit and Firefox are not automated; the
  ScriptProcessor fallback has no automated browser test (only the fake-browser unit test).
- The e2e demo step uses a random demo seed (the review suggested deterministic
  seeds); the step was made robust (longer run) but is not seeded.
- **[assumption]** Thresholds generalise beyond 3 real nights of one person, synthetic
  sounds and ESC-50; the breath rule (3 dB) and auto sensitivity are untested live.
- No Content-Security-Policy; Google Fonts reveals the visitor's IP to Google.
- No type checker. `dist/` builds are not maintained. `eval:public` is not in CI.
- Event times are analysed audio plus interruptions, not raw wall clock (start, end
  and gaps use the real clock).

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

- **Agreed now:** the owner records real nights with 1.12.4 (Normal sensitivity) and
  sends the JSON; run `npm run evaluate -- <file>.json` and compare Normal vs the
  background tests `breath` and `auto`. Any default change (planned v2.0: auto +
  breath rule) needs 2–3 such nights, `npm run eval:public` and the owner's approval.
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
