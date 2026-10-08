# Response to the reviews: full record (v1.9.1, a87c1f3, 8e05d2b)

Moved from [`docs/REVIEW-RESPONSE.md`](../REVIEW-RESPONSE.md) on 2026-10-08 (owner: keep the
current documents short); that file now holds the status of every finding at the current
version. This is the full record as written at 1.22.0–1.24.1, unchanged apart from relative
links: per finding what was done, where, how it was checked and what remained then. The
verification checkpoints it cites are in [`verification-history.md`](verification-history.md)
(1.22.0 and older) and [`../VERIFICATION.md`](../VERIFICATION.md) (1.24.0 and newer).

The independent review (2026-10-01) examined v1.9.1, commit
`e4eea25e9844dbf393b942bdc6e6d29f54b178e6`, and reported findings R1–R9 plus advice on
security, workflows and structure. This file records, per finding, what was done,
where, how it was checked, and what remains.

**Re-checked at 1.22.0** (`main` at `687b1f7`, 2026-10-05; review branch
`claude/review-checkpoint-1.22`, documentation and one verification script only). The
sections below first give the original fix (measured at 1.12.0, `827d6ca`), then a
"**At 1.22.0**" line with the result now and any change since. Since 1.12.4 the app
gained real-night follow-ups (1.12.5–1.22.0, see `HANDOVER.md` §4): two owner-approved
counting changes (the breath rule on Normal and Low) and four background tests' worth of
changes; none of them touched the code paths of R1, R2, R4, R7 or R8 except where noted.
Environment and full results: [`VERIFICATION.md`](verification-history.md), "Checkpoint 1.22.0".
A third review of that checkpoint (N1–N4) and the fixes in 1.22.1–1.22.3 are in
[Third review of 8e05d2b](#third-review-of-8e05d2b).

Evidence used: the review report and, at 1.12.0, its evidence bundle (probe scripts
`core-probes.cjs`, `server-probes.cjs`, `browser-probes.cjs`, `full-demo.cjs` and their
outputs). The bundle was never in the repository and is **not available** for the
1.22.0 re-check: `core-probes.cjs` and `full-demo.cjs` could not be re-run; their checks
are covered by the named unit tests below and by
[`review-probes/full-demo-run.cjs`](../review-probes/full-demo-run.cjs) (a replacement
written at 1.22.0). The adapted server and browser probes and the second review's
controller/store probe are in [`docs/review-probes/`](../review-probes/) and were re-run.

Status values: fixed · partly fixed · unresolved · deliberately deferred · disputed.

## Summary

| ID | Topic | Status at 1.22.0 | Evidence at 1.22.0 |
| --- | --- | --- | --- |
| R1 | Interruptions, real-clock gaps, wake-lock failure | **Partly fixed**: fixed in simulation (incl. C1–C3); untested on a physical iPhone | 7 targeted tests, e2e, browser probe |
| R2 | Failed restart broke the previous night's exports | **Fixed** | 1 test, e2e, browser probe |
| R3 | Rhythm rescue timing, too-close and earlier anchors, live/offline | **Fixed** (owner-approved counting change) | 10 tests, boundary fixture 1 → 2; `core-probes.cjs` unavailable |
| R4 | Dev server traversal, hidden files, crash, all interfaces | **Fixed** (cosmetic leftover: 403 body) | 1 test, server probe |
| R5 | Raw audio after Stop; privacy wording | **Fixed**; kept audio widened by owner decision to test clips (≤ 60 auto, ≤ 30 high) | 6 tests, ring 51 600 → 0 |
| R6 | Dark-screen card backlog; long-night memory and export cost | **Partly fixed**: backlog fixed; byte budget, metadata bounds and export memory not addressed (more detectors since) | 1 test, e2e, browser probe 6 cards / 48 ms |
| R7 | Keyboard bypassed the sensitivity lock | **Fixed** (now four detectors) | e2e, browser probe |
| R8 | Interval statistics, out-of-order events | **Fixed** | 1 test |
| R9 | Evaluator dropped breath rise | **Fixed** (evaluator since extended) | 11 tests, demo JSON 16 → 16 |
| — | Architecture for expansion | **Partly done** (recorder, night record, report format, module split, storage interface, `js/noise.js`); persistence deferred | — |
| — | Saved-night recovery | **Deliberately deferred** to 2.x (owner); interface only | night-store tests |
| — | Browser/device coverage | **Unresolved**: Chromium only; no physical iPhone run | — |
| — | Workflow permissions, deploy/tag gating | **Fixed** (hardening items deferred) | workflows passed on `687b1f7` |

## Second review of a87c1f3

An independent review of the checkpoint `a87c1f3` (1.12.0), saved as
[`reviews/2026-10-01-a87c1f3-review.md`](../reviews/2026-10-01-a87c1f3-review.md),
confirmed R2–R5 and R7–R9, R6 as partly fixed, no counting or WAV regression (27
demo combinations identical), and the benchmark. It rated R1 partly fixed and added
C1–C6. Its Appendix B reproduces C1 and C3–C6; the unchanged script is
[`review-probes/controller-store-probes.cjs`](../review-probes/controller-store-probes.cjs).
Before any fix it printed: C1 `suspended 6` / `interrupted 0` resume calls; C5
`completed on 0`; C3 a 3600 s gap in the JSON but the HTML verdict "6 snores in 1 h
0 min, about 721 per hour" with no gap; C4 `false 1 999`; C6 `3660 30.016`.
After 1.12.1–1.12.4: C1 `interrupted 6`; C5 `completed off 1`; C3 (with the fields the
app now passes) "6 snores in 30 s recorded." plus the gap; C4 and C6 unchanged
(deferred). Each fix is one PR with a test that fails on the old code; results in
[`VERIFICATION.md`](verification-history.md), checkpoint 1.12.4.

## Third review of 8e05d2b

An independent review of the 1.22.0 checkpoint `8e05d2b` (2026-10-05), saved as
[`reviews/2026-10-05-8e05d2b-review.md`](../reviews/2026-10-05-8e05d2b-review.md),
agreed with the status recorded here for R1–R9 and C1–C6 (R1 and R6 partly fixed; C4, C6
and the gap edge deferred), found no automatic upload of audio or night data, and reported
four new findings, N1–N4. Its appendix reproductions of N1 and N2 are in
[`review-probes/noise-evaluator-probes.cjs`](../review-probes/noise-evaluator-probes.cjs)
(takes the checkout as an argument). The owner chose to fix them before the public-dataset
tests. Each fix is one PR with tests that fail on the old code; no detection rule,
threshold or default changed. Results: [`VERIFICATION.md`](verification-history.md), checkpoint
1.22.3.

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| N1 | Medium: room-noise findings joined minutes across an hour not recorded | **Fixed** in 1.22.2 (#53) | probe: `[[1200,5520]]` → none; 3 tests; 400 random gap-free nights give the same findings as before |
| N2 | Medium: `npm run evaluate` re-counted background tests without redoing the rhythm rescue | **Fixed** in 1.22.1 (#52) for data files from 1.22.1; older files get the estimate, labelled approximate | probe: estimate 2, full rules 0, `recount` 0; demo night: every test's re-count equals its live count |
| N3 | Low: files without breath measurements printed 0 at 3 / 4.5 / 6 dB | **Fixed** in 1.22.1 (#52) | v1.8 file: "not evaluable" |
| N4 | Low: the share image's coverage line ran past the right edge | **Fixed** in 1.22.3 (#54) | Chromium e2e: 72–1090 px of 1080 → two lines, 72–856 and 72–280 px |

### N1 — Room-noise findings across a gap · fixed

- **Change:** `summarize` in `js/noise.js` works on clock minutes instead of list
  neighbours. Runs, the 3-minute smoothing and the 10-minute tone windows never join
  across a minute the recording did not cover. A minute without a background measurement
  counts as recorded but not qualifying, as minutes below a threshold already did. A run
  that borders either kind of minute has no known start or end, so it is not counted as a
  device switching on. With minutes missing, the text says "of the recorded time" and
  "while it was recorded" instead of "of the night" and "all night"; the summary carries
  `complete`.
- **Files:** `js/noise.js`; consumers unchanged (`js/app.js`, the shared HTML,
  `scripts/evaluate.js`).
- **Tests:** `tests/noise.test.js`: "findings never join minutes across an hour that was
  not recorded (review N1)" (the review's fixture, and 15 + 15 louder minutes giving two
  findings at 20–35 and 95–110 min), "minutes without a background measurement are not
  treated as neighbours…", "a steady tone needs 7 of 10 clock minutes…". All three fail on
  1.22.1.
- **Probe:** before, one stretch and one loud period `1200–5520 s` with the text
  "0:20–1:32: …"; after, none, and "The room stayed quiet and steady while it was
  recorded." Old and new `summarize`/`describe` gave identical output on 400 random nights
  without gaps (399 with findings).
- **Remaining:** gaps shorter than a minute leave no missing minute, so they are not
  visible to the summary (the heatmap still marks every gap).

### N2 — Background-test re-counts without the rhythm rescue · fixed (from 1.22.1 files)

- **Change:** background tests now store every sound feature of their snores and set-aside
  sounds (as the counting detector's) plus `rhythmRescued`, and hand over their choppy
  sounds no snore rescued. `recount()` in `scripts/evaluate.js` re-runs classification,
  `RhythmGate` and confirmation on them with the changed limit, so stricter and looser
  breath and pre-rise limits give the live answer. A check line shows each test's own rules
  giving its count back. Files from 1.22.0 and earlier (all of the owner's nights so far)
  lack the features: they keep the old estimate, now labelled "approximate: … rhythm rescues
  are not redone".
- **Files:** `js/recorder.js`, `js/report-format.js` (`shadowEvents`), `scripts/evaluate.js`.
- **Tests:** `tests/evaluate.test.js`: the review's case written through `toReport`
  (own rules 3, breath 6 dB → 0, pre-rise 8 dB → 0; the estimate still 2), a looser limit
  that needs a stored choppy sound (exact 2, estimate 0); `tests/recorder.test.js`: the
  demo night's data file re-counts every test to its live count;
  `tests/report-format.test.js`: the stored fields.
- **Remaining:** stored features are rounded (3 decimals), so a borderline sound can still
  flip; the check line shows it. The data file grows by about 150 bytes per background-test
  sound. New nights must be recorded with 1.22.1 or later for exact High re-counts.

### N3 — False zeroes for old files · fixed

- **Change:** when a background test's snores have no breath measurement, the stricter
  breath line says "not evaluable (this file has no breath-noise measurements for it)". In
  the estimate, a single sound without a measurement now passes, as live.
- **Test:** "old files without breath measurements say a background test's breath re-count
  cannot be made (review N3)" on `tests/fixtures/v1.8-report.json`.

### N4 — Share image coverage line · fixed

- **Change:** `drawShareCard` in `js/share.js` joins the times and coverage parts at
  " · " into as many lines as fit the margins (a second line at y = 198, kept clear of
  decorative stars) and passes `maxWidth` to `fillText` as a last guard.
- **Tests:** `tests/share.test.js` (header-wide text, 8 h night, 3 interruptions: every
  header line inside the margins, nothing left out); `tests/e2e.js` draws the card in
  Chromium with real font metrics (en-US, 22:00–06:00, 3 interruptions) and checks every
  text lies inside the image. Both fail on 1.22.2 (Chromium: 72–1090 px).

### Other points of the third review

- **R6 measurements (recorded, still unresolved):** in a Node fixture of 1,501 four-second
  clips at 8,820 Hz, 1,500 clips held 105.84 MB of PCM, the WAV 116.42 MB, the Blob another
  116.42 MB, ArrayBuffers 338.82 MB in all. A clip byte budget, bounded event metadata, a
  smaller export peak and a measured iPhone night are still needed (HANDOVER §7).
  **Correction (disputed in detail):** the review says clips from a 44.1 kHz input run at
  8,820 Hz; `js/detector.js` decimates by `round(44100 / 8000) = 6`, i.e. 7,350 Hz (48 kHz
  and 16 kHz give exactly 8,000 Hz). The fixture is therefore a slightly larger case than a
  real night; the conclusion stands.
- **Workflows (deferred, owner):** on `main` at `687b1f7` Pages finished at 12:27:40Z and
  CI at 12:28:40Z: publishing does not wait for the full suite. Permissions are
  workflow-wide; Pages listens to all branches with one concurrency group; actions are
  pinned by tag. The ruleset does not require branches to be up to date. Changing these
  touches permissions and repository settings, so they wait for the owner.
- **E2E demo seed (open):** the demo step uses a random seed and wall-clock timing; making
  it deterministic would help diagnosis.
- **Imported JSON (noted):** `fromReport` checks only a small part of a file's shape; it
  is not a boundary for hostile input. To be revisited before the app reads arbitrary
  files (saved nights, imports).
- **Architecture (agreed):** the review's order matches HANDOVER §2: C4 and a persisted
  schema before saved nights; a byte budget and device measurements before unattended use;
  a capture adapter separating browser audio from the recorder before native work; an
  explicit privacy decision before accounts or sync.

| ID | Finding | Status |
| --- | --- | --- |
| C1 | High: an audio context in the iOS state `interrupted` was never resumed | **Fixed** in 1.12.1 (#29); simulated, device untested |
| C2 | Medium: the dark night screen kept saying "Recording" after the microphone ended | **Fixed** in 1.12.2 (#30) |
| C3 | Medium: share image and HTML report showed an interrupted night as continuous | **Fixed** in 1.12.3 (#31); rates unchanged (recorded time) |
| C4 | Medium: night store hands out shared nested data; a clip survives its event turning rejected; night record only shallowly frozen | **Deliberately deferred** to the 2.x storage work (module not loaded by the page); the night-store parts are **moot since 1.24.1** (`js/night-store.js` removed; saved nights move to the native app); the shallow freeze of the night record remains |
| C5 | Low: a slow wake-lock request could hold the screen on after Stop | **Fixed** in 1.12.4 (#32) |
| C6 | Low: auto-sensitivity history after a gap uses sample time, events use the gap-aware clock (also the live pill) | **Deliberately deferred** to 2.x (no effect on counts); the auto-sensitivity part is moot since 1.24.0 (removed). The live pill was still affected (1.24.0's "moot" note was wrong): after an interruption it kept the last verdict for the rest of the night. **Fixed in 1.24.1**: frames carry the night's clock like events (unit test) |
| — | Episodes still join across a gap | **Owner decision needed**; unchanged |
| — | Gap edge keeps the partial frame and raw ring; Stop reads `elapsed` after `release()` (sub-frame) | Deferred to 2.x; define "captured time" first |
| — | Workflow hardening: job-scoped permissions, Pages trigger and concurrency only on `main`, full suite before publish, action pinning | Deferred; repository settings need the owner |

## Findings

### R1 — Interruptions, real-clock gaps, wake lock · partly fixed, device untested

The second review (a87c1f3) agreed for the suspended and ended paths but found three
gaps: C1–C3 in [Second review](#second-review-of-a87c1f3).

- **Change:** the recorder detects a suspended/interrupted audio context, a muted or
  ended microphone track, and 2 s without audio; the status says so, `resume()` is
  retried every second and on visibility; audio during a gap is not analysed. On
  resume each detector closes the open sound, rejects waiting rhythm candidates and
  drops anchors (`resumeAfterGap`), and statistics never confirm across a gap
  (`addGap`) — **owner decision**. `endedAt` is the real clock; the JSON adds
  `wallSeconds`, `capturedSeconds`, `interruptions[]` (with `offsetSec` on the events'
  clock) and `screenWakeLock`; the report says "interrupted N×". A refused or
  unsupported wake lock is shown; a released lock is requested again.
- **Commits:** `0c6ec3e` (#17, 1.10.1), `ebe5dbd` (#18, 1.10.2); since `cd25c7a`
  (#24) the logic lives in `js/recorder.js`. Files: `js/recorder.js`,
  `js/detector.js` (`resumeAfterGap`, `clock`), `js/stats.js` (`addGap`),
  `js/app.js` (status, report), `js/report-format.js`.
- **Tests:** `tests/e2e.js` (wake lock refused → warning; track ended → status,
  report "interrupted 1×", gap `ended`, wall = analysed + gap, real `endedAt`; demo
  context suspended 3 s with resume blocked → "interrupted", automatic resume, gap in
  JSON, no confirmation across the gap); `tests/recorder.test.js` (suspended,
  stalled, switched-off with gap lengths and clock); `tests/detector.test.js`
  ("an interruption: later events keep wall time…").
- **Original probe** (`docs/review-probes/browser-probes-adapted.cjs`):
  v1.9.1: suspended 2.2 s → still "Recording", end time 2.276 s early; ended track →
  "Recording"; wake-lock denial silent.
  Now: status "Recording interrupted: the system paused the microphone. Trying to
  resume…"; reported end = actual stop (within 2 ms); interruption 2.3 s recorded,
  wall 4.1 s = analysed 1.8 s + 2.3 s; ended track → "The system switched the
  microphone off…"; denied wake lock → "…did not let the app keep the screen on…".
- **Remaining:** verified with simulated events in Chromium only. How iOS Safari
  signals a phone call, Siri or a locked screen, and whether resume works there, is
  untested. Per-hour figures use analysed time (a deliberate reading of "per hour
  recorded").
- **At 1.22.0:** targeted tests pass (`interruptions: suspended…`, `resume is tried…`,
  `a screen lock that arrives after Stop…`, `an interruption: later events…`,
  `re-evaluation respects interruptions…`, `an interrupted night says so…`, `no minutes are
  made up during an interruption`: 7/7); browser probe: "Recording interrupted…", stop
  within 1 ms, gap 2.4 s, wall 4 s = 1.7 s + gap; ended track shown; wake-lock refusal
  shown. Since 1.12.4 the gap also clears the pre-rise history (1.20.0) and the room-noise
  profile makes no minutes during a gap (1.15.0). Real-night data: night 6 ended with two
  gaps at the stop (muted 23 s, stalled 6 s) that were recorded; no in-night interruption
  has happened on the owner's iPhone yet.

### R2 — Failed restart · fixed

- **Change:** a new recording becomes current only once its audio runs; since
  1.11.1 the finished night is a separate frozen record that the report, sharing,
  downloads and "copy summary" read, so a failed Start cannot touch it.
- **Commits:** `3d03dc6` (#11, 1.9.2), generalised in `a0e9e3c` (#23, 1.11.1) and
  `cd25c7a` (#24). Files: `js/app.js`, `js/recorder.js`.
- **Tests:** `tests/e2e.js` "Failed restart" (finished night, `getUserMedia` rejects
  with `NotAllowedError`, Start, then JSON and WAV downloads describe the previous
  night; night id unchanged); `tests/recorder.test.js` (failed start keeps state and
  night).
- **Original probe:** v1.9.1: `Cannot read properties of null (reading 'stats')`.
  Now: report visible, JSON has the previous `startedAt` and snores, same night id,
  no page errors.
- **At 1.22.0:** `a failed start leaves the state and the last night as they were` passes;
  e2e "Failed restart" passes; browser probe: same night id, no page errors.

### R3 — Rhythm rescue · fixed (owner-approved counting change)

- **Change:** the documented rule is implemented exactly (**owner decision**): a
  choppy, snore-like candidate counts when a snore accepted on its own starts 2–12 s
  before or after it. `RhythmGate` keeps all anchors from the last 12 s; a snore less
  than 2 s away leaves a candidate waiting instead of rejecting it; candidates expire
  only up to the start of a sound still in progress (window-end timing); the
  evaluator uses the same semantics; `SessionStats` confirms in both directions
  because rescued events arrive late. Limits unchanged; rescued sounds never anchor.
- **Commit:** `727b0fd` (#16, 1.10.0). Files: `js/detector.js`, `js/stats.js` (since
  #25), `scripts/evaluate.js`.
- **Tests:** `tests/detector.test.js` "rhythm rule: …" (too-close snore, earlier
  anchor, limits 1.5/12.5 s, no chaining via rescued sounds, long snore 12–13.5 s
  live and offline with fixture `tests/fixtures/rhythm-boundary-report.json` from the
  review), "confirmation looks both ways…".
- **Original probe** (`core-probes.cjs`, unchanged): candidate 2 / snores 3, 6 →
  all three confirmed (v1.9.1: candidate rejected); snores 2, 5 / candidate 6 →
  rescued (was rejected); boundary audio with the snore at 12, 12.5, 13, 13.5 s →
  live 2 confirmed = offline 2 (was live 0, offline 2).
- **Count change against the baseline** (shown to and approved by the owner before
  merge): demo night unchanged (16/16, 5 ignored, at 48/44.1/16 kHz × 8 seeds);
  20 synthetic mixed runs 756 → 762 confirmed (all 5 newly counted sounds are real
  rattles, distractors 0 → 0; this one-off harness was not committed, so the exact
  numbers cannot be re-run — the second review could not reproduce them and
  corroborated the rule by other means); ESC-50 snoring clips 29/40 and 13/40 unchanged; night
  sounds confirmed 22 → 23 / 1000 (breath rule 18 → 19), the extra one a washing-
  machine clip confirmed by the two-way confirmation.
- **At 1.22.0:** the rhythm rule is unchanged since 1.10.0; 10 targeted tests pass (the four
  "rhythm rule: …" tests, "confirmation looks both ways…", rattles, knocks/speech in rhythm,
  summary via rhythm); the review's boundary fixture still re-counts 1 → 2 snore-like
  (0 → 2 confirmed). `core-probes.cjs` is not available any more. Later owner-approved
  counting changes (the breath rule, 1.17.0 Normal and 1.21.0 Low) are checked before the
  choppy test, so a choppy sound without breath noise is no longer a rhythm candidate.

### R4 — Development server · fixed (cosmetic leftover)

- **Change:** path containment with `path.relative` plus a symlink (`realpath`)
  check, hidden files and folders refused, 400 on malformed URLs, binds 127.0.0.1
  unless `HOST` is set.
- **Commit:** `0816905` (#13, 1.9.4). File: `scripts/serve.js`.
- **Tests:** `tests/serve.test.js` (sibling traversal in three spellings,
  `/.git/HEAD`, `/.github/…`, `/%E0%A4%A`, server still answering afterwards).
- **Original probe** (`server-probes.cjs`; adapted copy with a 2 s exit timeout,
  because the original waits for the crash that no longer happens): traversal 403,
  `/.git/HEAD` 404, malformed 400, server still running, next request 200
  (v1.9.1: 200 with the outside file, `.git` served, crash with `URIError`).
- **Remaining (cosmetic, found in this verification):** the 403 response body reads
  "Bad request" instead of "Forbidden". Not fixed in this documentation checkpoint.
- **At 1.22.0:** `scripts/serve.js` unchanged since 1.9.4; `tests/serve.test.js` passes; the
  adapted probe gives 403 / 404 / 400, still running, next request 200. The 403 body is
  still "Bad request".

### R5 — Raw audio after Stop; privacy wording · fixed

- **Change:** `SnoreDetector.release()` wipes the rolling buffer, frame buffer and
  last spectrum; Stop calls it on all three detectors; kept clips are untouched. UI,
  shared report and README now say "Everything stays on this device; only short snore
  clips are kept" and that clips can include nearby sounds and mistakes (**owner
  decision** on wording).
- **Commit:** `c891d2d` (#14, 1.9.5); `release()` is called from `js/recorder.js`
  since #24. Files: `js/detector.js`, `js/recorder.js`, `index.html`, `js/share.js`,
  `README.md`.
- **Tests:** `tests/detector.test.js` "no audio of other sounds remains once the
  recording ends".
- **Original probe:** `core-probes.cjs` still reports 24 000 retained samples,
  because it calls only `flush()`. The Stop path calls `release()`: the same speech
  night gives 51 600 non-zero ring samples after `flush()` and **0 after
  `release()`** (command in `VERIFICATION.md`).
- **Remaining:** a clip classified as a snore may still contain other sounds or be a
  misclassification; the wording now says so.
- **At 1.22.0:** `release()` is called on all four detectors (main, knock, auto, high); the
  ring check gives 51 600 → 0. **Owner-approved change of scope:** besides the counting
  detector's snores, background tests now keep *test clips* so their snores can be checked
  by ear: up to 60 of the auto test's snores the counting detector missed (1.14.0) and up
  to 30 of the High test's with 3–6 dB of breath noise (1.22.0). They are snore-like clips
  of the same kind, held in a reservoir (twice the cap) until Stop. Tests: `audio is kept
  for snores only`, `no audio of other sounds remains once the recording ends`, `a
  counting-only detector keeps no audio`, both test-clip sample tests, night store `only
  accepted snores keep audio` (6/6). The README and HANDOVER state the test clips.

### R6 — Dark-screen backlog; long-night memory · partly fixed

- **Change:** the card queue built while the screen is black keeps only the newest
  cards that will be shown (6).
- **Commit:** `067e6e8` (#12, 1.9.3). File: `js/app.js`.
- **Tests:** `tests/e2e.js` (card limit 2 during the dark phase → at most 2 queued
  and drawn).
- **Original probe:** 4000 injected snores while dark → v1.9.1: 4000 queued, 4000
  buttons built, ~550 ms; now 6 queued, 6 buttons, 47 ms.
- **Not addressed:** a byte budget for clips (still a 1500-clip count cap), bounded
  event metadata over very long nights, and peak memory of the WAV export. Phone
  memory and CPU over a full night are not measured.
- **At 1.22.0:** browser probe: 4000 dark-screen snores → 6 queued, 6 cards, 48 ms; e2e
  card-limit check passes; `clip budget drops the quietest clips first` passes. The load
  has grown since: four detectors on the same audio (was three), two test-clip reservoirs
  (up to 120 + 60 clips until Stop), a per-minute room-noise profile, and `setAside`
  feature lists. Still **unmeasured on a phone**.

### R7 — Keyboard bypassed the sensitivity lock · fixed

- **Change:** the select is `disabled` while recording; the mid-night change path is
  removed (**owner decision**: truly locked).
- **Commit:** `067e6e8` (#12, 1.9.3). File: `js/app.js`.
- **Tests:** `tests/e2e.js` (focus + ArrowUp while recording; main, breath and auto
  detectors keep their settings; JSON records `normal` for main and breath).
- **Original probe:** v1.9.1: main switched to `low`, breath stayed `normal`; now
  control disabled, all detectors unchanged.
- **At 1.22.0:** the background tests are now `knock` (chosen sensitivity), `auto` and
  `high` (fixed sensitivities); e2e and the browser probe confirm the control is disabled
  and the detectors stay main normal, knock normal, auto auto, high high.

### R8 — Interval statistics · fixed

- **Change:** episode interval is the mean start-to-start gap; confirmed snores and
  downloads are in time order, so late-delivered (rescued) events no longer create
  negative gaps.
- **Commit:** `f615ee3` (#15, 1.9.6). Files: `js/stats.js` (then `js/detector.js`),
  `js/app.js`.
- **Tests:** `tests/detector.test.js` "rhythm intervals are measured between snore
  starts…".
- **Original probe:** starts 2/6/10 → interval 4 s (was 4.5 s); delivery order
  2, 6, 3, 8 → median 2 s (was 4 s).
- **At 1.22.0:** `js/stats.js` interval code unchanged; the test passes (the original probe
  is not available).

### R9 — Evaluator dropped breath rise · fixed

- **Change:** the evaluator reads `breathRiseDb`, warns when a file lacks it, and
  can apply a candidate rule set; since 1.11.0 it reads files through
  `js/report-format.js` (schema 1 and 2) and respects recorded interruptions.
- **Commits:** `f615ee3` (#15), `773c97c` (#22). Files: `scripts/evaluate.js`,
  `js/report-format.js`.
- **Tests:** `tests/evaluate.test.js`, `tests/report-format.test.js` (incl.
  re-evaluation does not rescue across a gap; 1.8 and 1.9 fixtures).
- **Check:** `npm run evaluate` on a freshly exported demo night: 16/16 confirmed,
  same as recorded; on the review's boundary report: 1 → 2 snore-like sounds as the
  live detector now decides.
- **At 1.22.0:** the evaluator also reads `lowRiseDb`, `onsetJumpDb`, `preRise*Db`, the
  night's sensitivity and breath rule, background tests' `setAside`, and the room noise;
  11 targeted tests pass; `npm run evaluate` on the demo JSON exported at this checkpoint:
  16 → 16 confirmed, every background test 16. Ignored sounds keep `lowRise` and
  `onsetJump` since 1.19.1 (they were `null` in files from 1.16.0–1.19.0).

## Other recommendations

- **Architecture for expansion · partly done.** Recording controller with explicit
  states and injected browser APIs (`js/recorder.js`, #24); frozen night record
  (#23); one versioned data format (#22); `js/stats.js` / `js/wav.js` split (#25);
  storage interface with contract tests (`js/night-store.js`, #26); ESLint and
  Prettier in CI (#21); room noise in its own module `js/noise.js` (#40, #42). Kept: plain
  UMD files rather than ES modules, to keep the `file://` build and Node `require` working
  (**recommendation**, not an owner decision). Not done: folder reorganisation, type
  checking. `js/detector.js` keeps growing with each measure (about 800 lines).
- **Saved-night recovery · deliberately deferred.** The owner decided saving nights,
  history and accounts belong to version 2.x in a new session. Only the interface
  exists (not loaded by the page). A reload or crash still loses the night.
- **Browser/device coverage · unresolved.** Automated tests run in Chromium only
  (unit tests in Node). Claude has not used a physical iPhone: no automated or
  instrumented overnight run, no real call/Siri/lock interruption, no share-sheet or
  playback check, no battery/CPU or memory measurement. The owner has recorded six real
  nights on an iPhone (three with the current line of versions, 1.12.4–1.19.0) and sent the
  files; those show the app recorded whole nights with the screen kept awake, but they are
  not a controlled device test. The e2e demo step still uses a random seed.
- **Workflow permissions and gating · fixed.** `ci.yml` has `permissions: contents:
  read` (#19); `pages.yml` and `release.yml` run unit tests and syntax checks before
  deploy and tag (#19); job names are distinct (`CI tests`, `Tests before deploy`,
  `Tests before release`, #27). The owner set a ruleset on `main`: PR required with
  0 approvals, required check `CI tests`, deletions and force pushes blocked, no
  bypass; a merge attempt while `CI tests` was running was refused (#27). Unchanged at
  1.22.0. Deferred hardening (second review): job-scoped permissions, Pages trigger and
  concurrency only on `main` (a PR-branch push can cancel a `main` deploy), the full suite
  before publishing, action pinning.
- **CSP and self-hosted fonts · not done.** Still no Content-Security-Policy; Google
  Fonts remains the only external request.

## Readiness for expansion (author's assessment, to be checked)

Ready for: comparing real nights (evaluator, versioned data file with rich per-sound
features), trying candidate rules as background tests, adding an on-device store behind
`js/night-store.js` (after C4), and replacing the browser audio side of `js/recorder.js`.
Not ready for unattended overnight use without persistence; the iPhone-specific behaviour
of interruptions, phone load with four detectors and long-night memory are unverified;
the detection thresholds rest on six nights of one person plus synthetic and public
sounds.
