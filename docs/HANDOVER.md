# Snorewatch handover

State at version **1.24.0** (2026-10-06, deployed to GitHub Pages from `main`).
1.22.0 was prepared for an independent review and a fresh session; that third review
(of `8e05d2b`, N1–N4) was answered with 1.22.1–1.22.3. The public-dataset study followed
([`research/RESULTS.md`](../research/RESULTS.md)); on its evidence High counts with the
breath rule since 1.23.0. 1.24.0 removed the automatic-sensitivity test to slim the app before
the move to a native iPhone app ([`docs/archive/auto-sensitivity.md`](archive/auto-sensitivity.md);
§10). The checks are recorded in [`docs/VERIFICATION.md`](VERIFICATION.md) ("Checkpoint
1.24.0", "1.23.0", "1.22.3" and "1.22.0");
the answers to all three reviews (v1.9.1, `a87c1f3`, `8e05d2b`) are in
[`docs/REVIEW-RESPONSE.md`](REVIEW-RESPONSE.md). Version history with reasons: §4.
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
  8 kHz from a 48 kHz or 16 kHz microphone, 7,350 Hz from 44.1 kHz; 16-bit). Up to 1.23.0
  the automatic-sensitivity test also kept up to 60 test clips (1.22.x: and the High test up
  to 30); no background test keeps audio since 1.24.0. Non-snore audio exists only in a
  ~6.5 s rolling buffer and as a rhythm candidate (≤ 12 s); ignored sounds keep features
  only; all buffers are wiped on Stop. Clips can hold nearby sounds or be mistakes, so the
  UI promises "only short snore clips", not "only snores". Google Fonts is the only network
  request **[verified by grep: no fetch/XHR/storage in `js/`]**.
- Static site, plain HTML/CSS/JS, no build step, no runtime dependencies; GitHub Pages.

Owner decisions (**[owner]**), most recent first:
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
  APSAA may be used under its non-commercial, no-redistribution terms. The owner allowed
  `us.aws.cdn.hf.co` (Hugging Face's file host) in the cloud environment.
- **2026-10-05, after the third review:** merge the 1.22.0 checkpoint docs (#51); fix the
  review's findings N1–N4 and write the review response **before** the public-dataset
  tests (the fixes are quick, the datasets slow). Dataset harnesses stay in a scratch
  directory at first; a data-free script may be proposed later.
- **2026-10-05, review preparation:** a background trial for High (1.22.0, keep its test
  clips). Public datasets for later tests: **APSAA** (Zenodo), **PSG-Audio** (Hugging Face /
  Science Data Bank) and the **Khan** clips (GitHub mirror, no clear licence) may be used
  locally, never committed; the owner added `zenodo.org`, `huggingface.co` and
  `www.scidb.cn` to the cloud environment's allowed domains. These dataset tests are **not
  run yet**; they are for a new session (§10). Tests with other people's nights are on hold.
- **2026-10-05, after night 6:** the late "tonal" sounds (06:39–06:44) are real snores for
  now (owner listened: snoring in the background, sometimes moaning). The breath rule for
  Low and High "if it made Normal better and makes sense, else explain": applied to
  **Low** (1.21.0); **High left without it** (it costs High's quiet snores; owner sees
  3–4.5 dB as a possible middle ground → background trial). The auto test gets the rise
  over the moment before (1.20.0); compare window lengths.
- **2026-10-04, after nights 4 and 5:** the 6 dB breath rule counts for **Normal**
  (1.17.0). A knock (sudden-start) rule as a background test first (1.18.0). Room-noise
  findings and heatmap go into the report as they are (1.19.0); the owner finds them not
  very informative yet, to be revisited.
- **2026-10-03, night 4:** time zone in the data file, clips at full 16-bit detail, the
  6 dB breath rule as a background test only (then).
- **Saving nights, history, accounts:** version 2.x in a new session after the owner's
  instructions; only the interface `js/night-store.js` exists (not loaded by the page).
- **Repository:** public; ruleset on `main` (PR required, 0 approvals, required check
  `CI tests`, no deletions, no force pushes, no bypass). Claude merges its own PRs when CI
  is green; the release workflow creates tags.
- **Earlier (review phase, 1.9.2–1.12.4):** rhythm rule exactly as documented (R3, counting
  change shown and approved); interruptions shown, retried, recorded, nothing confirmed
  across a gap (R1); sensitivity truly locked (R7); privacy wording (R5); Phase B
  restructuring without behaviour change; "Darken screen" stays under Stop.
- **Before that:** default sensitivity Normal, not remembered across reloads; new detection
  rules run as background tests before they change headline numbers; centroid limit
  500 Hz; rumble filter 0.85; ESC-50 never committed; WAV export not split. (A planned switch
  of the default to "auto + breath rule" for v2.0 lapsed when automatic sensitivity was
  removed in 1.24.0.)

Claude's recommendations (**[recommendation]**, not decided):
- Keep plain UMD files rather than ES modules (the `file://` build and Node `require`).
- Saved nights: IndexedDB behind `js/night-store.js`, written during recording, with
  recovery of an unfinished night; fix C4 first (§7).
- Before a native app, prototype locked-screen overnight recording on a real iPhone; the
  browser side of `js/recorder.js` is the part to replace.
- (Superseded on 2026-10-05: "High: 4.5 dB as the middle ground". The datasets put High's
  3–6 dB sounds at or below chance level for snoring, and the owner chose 6 dB.)

## 3. Detection rules in force (1.24.0)

Frames of ~43 ms (2048 samples at 48 kHz) → loudness and spectral shares → a sound starts
when a frame is `trigger` dB above the adaptive floor and above the absolute gate, and
ends when the level stays within `release` dB for 0.2 s. The floor follows the quiet
(falls with τ 0.5 s, rises with 8 s; 60 s during a sound).

| Sensitivity | Trigger / release | Gate | Breath rule |
| --- | --- | --- | --- |
| Low | 12 / 6 dB | −65 dBFS | 6 dB (since 1.21.0) |
| Normal (default) | 8 / 4 dB | −75 dBFS | 6 dB (since 1.17.0) |
| High | 5 / 3 dB | −85 dBFS | 6 dB (since 1.23.0) |

`classify` checks in this order (first failing rule names the reason): too long (> 4 s),
too short (< 0.25 s), rumble (20–60 Hz share > 0.85), too bright (1–4 kHz share > 0.2 or
centroid > 500 Hz), not low (50–800 Hz share < 0.55), **no breath** (150–1500 Hz rise
above its room noise < the sensitivity's rule), [test option only: sudden], choppy (> 2 bursts → rhythm candidate: counts when a snore accepted on its
own starts 2–12 s before or after it). A snore is **confirmed** (counted in the figures)
when another snore lies 2–12 s away, never across an interruption.

Background tests (extra detectors on the same audio that keep no audio; counts go into the
data file and one line of the report, never the headline). Since 1.22.1 each stores every feature of its
snores and of the sounds it set aside (its own rules' rejections and its choppy sounds no
snore rescued), so `npm run evaluate` can re-run it with other limits, rhythm rescue
included:

| Test | Settings | Keeps audio |
| --- | --- | --- |
| `knock` (1.18.0) | chosen sensitivity + sudden start: reject a rise > 20 dB within 20 ms (`onsetJump`) | no |

The `high` test (1.22.0–1.22.3: High without the breath rule, up to 30 clips of its snores
with 3–6 dB of breath noise) ended when High took the rule in 1.23.0; `npm run evaluate`
still re-counts it from 1.22.x files. The `auto` test (automatic sensitivity, 1.8.0–1.23.0,
with its snore-band and moment-before rules and test clips) was removed in 1.24.0; its
algorithm, parameters, results and how to restart it are in
[`docs/archive/auto-sensitivity.md`](archive/auto-sensitivity.md). `npm run evaluate` shows
its recorded counts from older files.

## 4. What changed and why

Review phase (details per finding in `REVIEW-RESPONSE.md`): 1.9.2 R2 failed restart ·
1.9.3 R7 locked sensitivity, R6 card queue · 1.9.4 R4 dev server · 1.9.5 R5 buffers wiped,
privacy wording · 1.9.6 R8 intervals, R9 evaluator · 1.10.0 R3 rhythm rule · 1.10.1–1.10.2
R1 interruptions · 1.10.3 workflows · 1.10.4 "Darken screen" moved · 1.10.5 ESLint +
Prettier · 1.11.0 data file schema 2 · 1.11.1 frozen night record · 1.11.2 recorder
controller · 1.11.3 stats/wav split · 1.12.0 storage interface · 1.12.1–1.12.4 second
review C1, C2, C3, C5.

Real-night phase (this session, owner's nights 4–6, §8):

| Version | PR | Change and reason |
| --- | --- | --- |
| 1.12.5 | #34 | Time zone in the data file; evaluator counts per hour in it |
| 1.12.6 | #35 | Clips turned up before the 16-bit conversion (were grainy) |
| 1.13.0 | #36 | Background test `breath6` (6 dB breath rule) after night 4's hum swells |
| 1.13.1 | #38 | Auto: a sound ends only back within the room's usual quiet range (auto missed loud snores) |
| 1.14.0 | #39 | Auto test clips (up to 60) to check by ear |
| 1.15.0 | #40 | Room noise per minute in the data file (levels only) |
| 1.16.0 | #41 | Night 5: `lowRise`; auto needs 8 dB in the snore band (it counted quiet breathing) |
| — | #42 | Room-noise findings logic (`summarize`/`describe`), in the evaluator |
| 1.17.0 | #43 | **Counting change:** Normal needs 6 dB of breath noise (night 4 961 → 661, night 5 76 → 73); breath background tests removed (re-computable offline) |
| 1.18.0 | #44 | Background test `knock` (`onsetJump`); ESC-50 clips faded in and out |
| 1.19.0 | #45 | Room-noise panel and heatmap in the report and shared HTML |
| 1.19.1 | #46 | Night 6: ignored sounds keep `lowRise`/`onsetJump`; mains hum recognised |
| 1.20.0 | #47 | Auto: 6 dB rise over the moment before (`preRise25/50/100`); tests hand over `setAside` |
| 1.21.0 | #48 | **Counting change:** Low needs 6 dB of breath noise |
| — | #49 | Handover notes (late sounds, High question) |
| 1.22.0 | #50 | Background test `high` with test clips; clip sampling per test |
| — | #51 | Review checkpoint 1.22.0: handover, review response, verification |
| 1.22.1 | #52 | Third review N2/N3: background tests store all features and choppy set-asides; the evaluator re-runs their rules with the rhythm rescue; "not evaluable" without breath values |
| 1.22.2 | #53 | Third review N1: room-noise findings follow clock minutes, never across a gap |
| 1.22.3 | #54 | Third review N4: the share image's coverage line wraps inside the margins |
| — | #55 | Third review saved, review response, verification 1.22.3, this handover |
| — | #56 | Verification 1.22.3: branch pushes, not merges, cancelled two deploys |
| — | #57 | Public-dataset study, rerunnable in `research/` (APSAA, PSG-Audio, Khan, YAMNet, the owner's nights); results in `research/RESULTS.md` |
| 1.23.0 | #58 | **Counting change:** High needs 6 dB of breath noise (the datasets put High's 3–6 dB sounds at or below chance); the `high` background test and its clips removed |
| — | #59 | Two-phone night: own sound or room without listening (`research/two-phone/`, `research/RESULTS.md` §10) |
| 1.24.0 | #60 | Automatic sensitivity removed with its snore-band and moment-before rules, `lowRiseDb`/`preRise*Db` and the test-clip download (did not beat Normal; less to port to Swift); restart log in `docs/archive/auto-sensitivity.md`; counts unchanged |

## 5. Architecture

```
mic or demo ─► js/recorder.js: AudioWorklet tap (ScriptProcessor fallback)
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
| `js/wav.js` | `encodeWav`, `clipFromAudio` |
| `js/noise.js` | `NoiseProfile` (per minute: median quiet level, p10/p90, octave bands 31.5 Hz–8 kHz, strongest 30–400 Hz tone); `summarize`/`describe` (findings: steady tone and mains hum, on/off cycles, mid/high stretches outside snoring, loud stretches) |
| `js/detector.js` | FFT, `FrameAnalyzer`, `SnoreDetector` (floor, events, features incl. `breathRise`, `onsetJump`, classification, clips, `release()`, `resumeAfterGap()`), `RhythmGate`, `classify`, `breathRuleDb`, `DEFAULTS`/`SENSITIVITY`/`REASONS`; facade `SnoreCore` |
| `js/synth.js` | Seeded synthetic sounds and rooms (snore, rattle, breath, swell, bump, knock, …) for the demo and tests |
| `js/charts.js` | Canvas drawing (live strip, timeline, clip waveform) |
| `js/share.js` | Star-map image, script-free HTML report, room-noise heatmap SVG (`noiseSvg`, also used by the app); runs in Node |
| `js/report-format.js` | Data file: `toReport` (schema 2), `fromReport` (reads schema 1 and 2) |
| `js/recorder.js` | Recording controller: audio graph, the two detectors, interruptions, wake lock, states, `finishNight`; browser APIs injected via `env` |
| `js/night-store.js` | Storage interface + in-memory implementation. **Not loaded by the page** |
| `js/app.js` | The page only; test hooks on `window.__snorewatch` |
| `scripts/serve.js` | Local static server (`npm start`, 127.0.0.1 unless `HOST`) |
| `scripts/evaluate.js` | Re-counts a downloaded night (current rules for its sensitivity, without the breath rule, background tests with stricter rules via `recount`, exact from 1.22.1 files (removed tests: recorded counts only), per hour with room noise, room findings) |
| `scripts/eval-public.js` | ESC-50 benchmark (downloads ~600 MB outside the repo; clips faded in/out) |
| `scripts/make-sample.js`, `scripts/build-standalone.js` | Synthetic sample WAV; single-file builds in `dist/` (not deployed, not maintained) |
| `tests/*.test.js` | `node:test`: detector, share, serve, evaluate, report-format, recorder, night-store, noise |
| `tests/e2e.js` | Playwright/Chromium at 390 × 844 with a fake microphone playing the synthetic night |
| `tests/fixtures/` | Synthetic reports only |
| `research/` | Dataset studies outside the app (APSAA, PSG-Audio, Khan, YAMNet, the owner's nights): rerunnable scripts, data under `~/.cache/snorewatch`, results in `research/RESULTS.md` |
| `docs/review-probes/` | Adapted probes from the first review, the second review's controller/store probe, the full demo run (1.22.0) and the third review's N1/N2 probe (C6 and N2 apply up to 1.23.0) |
| `docs/archive/` | Logs of removed features, enough to restart them: automatic sensitivity (1.24.0) |
| `.github/workflows/` | `ci.yml` (`CI tests`: unit, lint, e2e), `pages.yml` (`Tests before deploy` → deploy, `main` only), `release.yml` (`Tests before release` → tag `vX.Y.Z`) |

**How a night flows:**
- **Recording:** `recorder.start()` creates the audio context and microphone (or demo
  buffer), the two detectors and a wake lock (a refused or unsupported lock is shown).
- **Interruptions:** context `suspended`/`interrupted`, track `mute`/`ended`, or 2 s without
  audio open a gap; the status says so; `resume()` is retried every second and on
  visibility; audio during a gap is not analysed. On return each detector
  `resumeAfterGap()` (closes the open sound, rejects waiting candidates, drops anchors,
  shifts later events) and each `SessionStats.addGap()`.
- **Stop:** flush, wipe buffers (`release()`), build one
  frozen night record (wall times, time zone, gaps, configuration, summary, events, noise
  profile, background tests with their snores and set-aside sounds). The report, sharing
  and downloads read only this record; a new or failed Start cannot change it.
- **Exports:** JSON via `toReport` (schema 2; top level incl. `timeZone`, `interruptions`,
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
- **Second review leftovers:** C4 (night store hands out shared data; a clip survives its
  event turning rejected; record only shallowly frozen — fix before wiring storage in);
  C6 went with automatic sensitivity (1.24.0); the gap edge (partial
  frame and raw ring survive `resumeAfterGap`; `elapsed` read after `release()`).
- **[owner] decision needed:** should episodes split at an interruption?
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
  not yet met a real knock night after 1.18.0. Night 6's tonal late sounds.
- **Room noise:** findings not very informative yet (owner); the shared report's heatmap
  is 720 units wide, so its labels are small on a phone; the e2e run is too short for a
  heatmap (checked in unit tests and a one-off 3.5 min browser run).
- `npm run evaluate` reads features rounded to 3 decimals (6 night-4 sounds at exactly
  0.850 flip; for background tests the "own rules" line shows any such flip). Its
  background-test re-counts are exact only for files from 1.22.1; nights 4–6 (older files)
  get the labelled estimate, which can keep a rattle after the snore that rescued it is
  dropped (third review N2). No Content-Security-Policy; Google Fonts reveals the visitor's
  IP. No type checker. `dist/` builds not maintained. `eval:public` not in CI. Event times
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
npm run build                              # optional dist/ single-file builds
npm start                                  # http://localhost:8080
npm run eval:public                        # ESC-50 benchmark, before detection changes
npm run evaluate -- <report>.json          # re-count a downloaded night
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

**Done (2026-10-05):** the public-dataset study (APSAA 32 nights, PSG-Audio 6 nights, Khan, ESC-50
baseline, YAMNet, the owner's nights 4–6), rerunnable from [`research/`](../research/README.md);
results and limits in [`research/RESULTS.md`](../research/RESULTS.md). In short: High → 6 dB
(decided); Normal is precise where someone clearly snores; the 500 Hz pitch limit misses
higher-pitched snorers; labels without listening work with a second sensor (throat mic / snore
sensor; for the owner: two phones, near and far); YAMNet works best as a second opinion.
Then **High with the 6 dB breath rule** (1.23.0), which ended the High background trial; the
first two-phone night (#59, `research/RESULTS.md` §10).

**Done (2026-10-06):** 1.24.0 slims the app for the move to a native iPhone app: automatic
sensitivity, its two rules, the per-sound `lowRiseDb`/`preRise*Db` and the test-clip download
are gone; the counting detector and the room-noise check are unchanged (verified event by event
against 1.23.0). Restart log: [`docs/archive/auto-sensitivity.md`](archive/auto-sensitivity.md).

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

**Later / owner's decisions pending:** room-noise wording; episodes at interruptions; the
on-phone interruption check (a call or Siri with the screen dark).

**Future, separate from what is implemented:** saved nights with recovery and a history
(2.x, IndexedDB behind `js/night-store.js`; prerequisites C4, in-night checkpoints, a
persisted schema, a clip byte budget); room noise across nights (needs saved nights);
native iPhone recording prototype (locked screen), then possibly a native app; accounts or
sync only after that and with an explicit privacy decision.
