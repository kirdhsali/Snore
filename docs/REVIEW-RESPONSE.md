# Response to the review of v1.9.1

The independent review (2026-10-01) examined v1.9.1, commit
`e4eea25e9844dbf393b942bdc6e6d29f54b178e6`, and reported findings R1–R9 plus advice on
security, workflows and structure. This file records, per finding, what was done,
where, how it was checked, and what remains. All results below were measured on
the code of `main` at `827d6ca`. The review branch adds only documentation, the two
adapted probe scripts and one lint-config line (`*.cjs` is linted too); application
and test code are unchanged. Environment and full results:
[`VERIFICATION.md`](VERIFICATION.md).

Evidence used: the review report and its evidence bundle (probe scripts
`core-probes.cjs`, `server-probes.cjs`, `browser-probes.cjs`, `full-demo.cjs` and
their outputs). The bundle is not in the repository. Two probes needed adapting to
run against the current code; the adapted copies are in
[`docs/review-probes/`](review-probes/) with the changes stated at their top.

Status values: fixed · partly fixed · unresolved · deliberately deferred · disputed.

## Summary

| ID | Topic | Status |
| --- | --- | --- |
| R1 | Interruptions, real-clock gaps, wake-lock failure | **Partly fixed** per the second review; its gaps C1–C3 are fixed since in 1.12.1–1.12.3 (simulated); untested on a physical iPhone |
| R2 | Failed restart broke the previous night's exports | **Fixed** |
| R3 | Rhythm rescue timing, too-close and earlier anchors, live/offline | **Fixed** (owner-approved counting change) |
| R4 | Dev server traversal, hidden files, crash, all interfaces | **Fixed** (one cosmetic leftover) |
| R5 | Raw audio after Stop; privacy wording | **Fixed** |
| R6 | Dark-screen card backlog; long-night memory and export cost | **Partly fixed**: backlog fixed; byte budget and export memory not addressed |
| R7 | Keyboard bypassed the sensitivity lock | **Fixed** |
| R8 | Interval statistics, out-of-order events | **Fixed** |
| R9 | Evaluator dropped breath rise | **Fixed** |
| — | Architecture for expansion | **Partly done** (recorder, night record, report format, module split, storage interface); persistence deferred |
| — | Saved-night recovery | **Deliberately deferred** to 2.x (owner); interface only |
| — | Browser/device coverage | **Unresolved**: Chromium only; no physical iPhone run |
| — | Workflow permissions, deploy/tag gating | **Fixed** |

## Second review of a87c1f3

An independent review of the checkpoint `a87c1f3` (1.12.0), saved as
[`reviews/2026-10-01-a87c1f3-review.md`](reviews/2026-10-01-a87c1f3-review.md),
confirmed R2–R5 and R7–R9, R6 as partly fixed, no counting or WAV regression (27
demo combinations identical), and the benchmark. It rated R1 partly fixed and added
C1–C6. Its Appendix B reproduces C1 and C3–C6; the unchanged script is
[`review-probes/controller-store-probes.cjs`](review-probes/controller-store-probes.cjs).
Before any fix it printed: C1 `suspended 6` / `interrupted 0` resume calls; C5
`completed on 0`; C3 a 3600 s gap in the JSON but the HTML verdict "6 snores in 1 h
0 min, about 721 per hour" with no gap; C4 `false 1 999`; C6 `3660 30.016`.
After 1.12.1–1.12.4: C1 `interrupted 6`; C5 `completed off 1`; C3 (with the fields the
app now passes) "6 snores in 30 s recorded." plus the gap; C4 and C6 unchanged
(deferred). Each fix is one PR with a test that fails on the old code; results in
[`VERIFICATION.md`](VERIFICATION.md), checkpoint 1.12.4.

| ID | Finding | Status |
| --- | --- | --- |
| C1 | High: an audio context in the iOS state `interrupted` was never resumed | **Fixed** in 1.12.1 (#29); simulated, device untested |
| C2 | Medium: the dark night screen kept saying "Recording" after the microphone ended | **Fixed** in 1.12.2 (#30) |
| C3 | Medium: share image and HTML report showed an interrupted night as continuous | **Fixed** in 1.12.3 (#31); rates unchanged (recorded time) |
| C4 | Medium: night store hands out shared nested data; a clip survives its event turning rejected; night record only shallowly frozen | **Deliberately deferred** to the 2.x storage work (module not loaded by the page) |
| C5 | Low: a slow wake-lock request could hold the screen on after Stop | **Fixed** in 1.12.4 (#32) |
| C6 | Low: auto-sensitivity history after a gap uses sample time, events use the gap-aware clock (also the live pill) | **Deliberately deferred** to 2.x (no effect on counts) |
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

### R7 — Keyboard bypassed the sensitivity lock · fixed

- **Change:** the select is `disabled` while recording; the mid-night change path is
  removed (**owner decision**: truly locked).
- **Commit:** `067e6e8` (#12, 1.9.3). File: `js/app.js`.
- **Tests:** `tests/e2e.js` (focus + ArrowUp while recording; main, breath and auto
  detectors keep their settings; JSON records `normal` for main and breath).
- **Original probe:** v1.9.1: main switched to `low`, breath stayed `normal`; now
  control disabled, all detectors unchanged.

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

## Other recommendations

- **Architecture for expansion · partly done.** Recording controller with explicit
  states and injected browser APIs (`js/recorder.js`, #24); frozen night record
  (#23); one versioned data format (#22); `js/stats.js` / `js/wav.js` split (#25);
  storage interface with contract tests (`js/night-store.js`, #26); ESLint and
  Prettier in CI (#21). Kept: plain UMD files rather than ES modules, to keep the
  `file://` build and Node `require` working (**recommendation**, not an owner
  decision). Not done: folder reorganisation, type checking.
- **Saved-night recovery · deliberately deferred.** The owner decided saving nights,
  history and accounts belong to version 2.x in a new session. Only the interface
  exists (not loaded by the page). A reload or crash still loses the night.
- **Browser/device coverage · unresolved.** Automated tests run in Chromium only
  (unit tests in Node). No physical iPhone was used in this session: no overnight
  run, no real call/Siri/lock interruption, no share-sheet or playback check, no
  battery/CPU or memory measurement. The e2e demo step still uses a random seed.
- **Workflow permissions and gating · fixed.** `ci.yml` has `permissions: contents:
  read` (#19); `pages.yml` and `release.yml` run unit tests and syntax checks before
  deploy and tag (#19); job names are distinct (`CI tests`, `Tests before deploy`,
  `Tests before release`, #27). The owner set a ruleset on `main`: PR required with
  0 approvals, required check `CI tests`, deletions and force pushes blocked, no
  bypass; a merge attempt while `CI tests` was running was refused (#27).
- **CSP and self-hosted fonts · not done.** Still no Content-Security-Policy; Google
  Fonts remains the only external request.

## Readiness for expansion (author's assessment, to be checked)

Ready for: comparing real nights (evaluator, versioned data file), adding an
on-device store behind `js/night-store.js`, and replacing the browser audio side of
`js/recorder.js`. Not ready for unattended overnight use without persistence, and
the iPhone-specific behaviour of interruptions and long nights is unverified.
