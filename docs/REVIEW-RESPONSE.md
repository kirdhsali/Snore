# Response to the reviews

Three independent reviews examined the app:
- **First review:** v1.9.1 (`e4eea25`), findings R1–R9 and advice on security, workflows and
  structure.
- **Second review:** the 1.12.0 checkpoint `a87c1f3`, findings C1–C6. Saved in
  [`reviews/2026-10-01-a87c1f3-review.md`](reviews/2026-10-01-a87c1f3-review.md).
- **Third review:** the 1.22.0 checkpoint `8e05d2b`, findings N1–N4. Saved in
  [`reviews/2026-10-05-8e05d2b-review.md`](reviews/2026-10-05-8e05d2b-review.md).

This file gives each finding's status at **1.25.0**. The full record (per finding: the change,
commits, tests, probe output, the re-check at 1.22.0) is in
[`archive/review-response.md`](archive/review-response.md). The probes that re-run the
reviews' checks are in [`review-probes/`](review-probes/).

Status values: fixed · partly fixed · moot (the code it concerned is gone) · deferred · open.

## Findings

| ID | Finding | Status at 1.25.0 |
| --- | --- | --- |
| R1 | Interruptions, real-clock gaps, wake-lock failure | **Partly fixed:** fixed in simulation (1.10.1–1.10.2, with C1–C3); untested on a physical iPhone (call, Siri, lock) |
| R2 | A failed restart broke the previous night's exports | **Fixed** (1.9.2; frozen night record since 1.11.1) |
| R3 | Rhythm rescue timing, too-close and earlier anchors, live against offline | **Fixed** (1.10.0, an owner-approved counting change); specified in [`DETECTOR.md`](DETECTOR.md) §6 |
| R4 | Dev server: traversal, hidden files, crash, all interfaces | **Fixed** (1.9.4). Cosmetic leftover: the 403 body says "Bad request" |
| R5 | Raw audio after Stop; privacy wording | **Fixed** (1.9.5). Since 1.24.0 only the counting detector's snores keep audio again: the test clips of the removed background tests are gone |
| R6 | Dark-screen card backlog; long-night memory and export cost | **Partly fixed:** the backlog is fixed (1.9.3). Open: a byte budget for clips (a count cap of 1,500 now), bounded event metadata, the WAV export's peak memory (third review: 338.82 MB of buffers in a worst-case Node fixture), a measured iPhone night |
| R7 | The keyboard bypassed the sensitivity lock | **Fixed** (1.9.3) |
| R8 | Interval statistics with out-of-order events | **Fixed** (1.9.6) |
| R9 | The evaluator dropped the breath rise | **Fixed** (1.9.6, reads every schema since 1.11.0) |
| C1 | High: an audio context in the iOS state `interrupted` was never resumed | **Fixed** in 1.12.1; simulated, device untested |
| C2 | Medium: the dark night screen kept saying "Recording" after the microphone ended | **Fixed** in 1.12.2 |
| C3 | Medium: the share image and HTML report showed an interrupted night as continuous | **Fixed** in 1.12.3 |
| C4 | Medium: the night store handed out shared nested data; the night record is only shallowly frozen | Night-store part **moot** (removed in 1.24.1; saved nights move to the native app). The shallow freeze remains (**deferred**) |
| C5 | Low: a slow wake-lock request could hold the screen on after Stop | **Fixed** in 1.12.4 |
| C6 | Low: sample time against the gap-aware clock after an interruption | Automatic-sensitivity part **moot** (removed in 1.24.0); the live pill **fixed** in 1.24.1 (frames carry the night's clock) |
| N1 | Medium: room-noise findings joined minutes across an hour not recorded | **Fixed** in 1.22.2. Leftover: gaps shorter than a minute are invisible to the summary (the heatmap shows them) |
| N2 | Medium: `npm run evaluate` re-counted background tests without the rhythm rescue | **Fixed** in 1.22.1 for files from 1.22.1. Older files get a labelled estimate, kept by owner decision (2026-10-08) |
| N3 | Low: files without breath measurements printed 0 | **Fixed** in 1.22.1 |
| N4 | Low: the share image's coverage line ran past the edge | **Fixed** in 1.22.3 |

## Other points of the reviews

| Point | Status at 1.25.0 |
| --- | --- |
| Episodes join across an interruption | **Fixed in 1.27.0** (owner decision 2026-10-09): episodes and the median interval stop at interruptions |
| Gap edge: the partial frame and the rolling buffer carry over an interruption; Stop reads `elapsed` after `release()` | **Deferred.** The behaviour is now specified ([`DETECTOR.md`](DETECTOR.md) §7), so the native app can match or change it deliberately |
| Saved-night recovery, history | **Moved to the native iPhone app** (owner, 2026-10-08) |
| Architecture for expansion | **Done** for the port: recorder controller, frozen night record, one data format, the night's analysis in `js/analysis.js` (1.25.0), the detector specification. Kept: plain UMD files, no ES modules |
| Browser and device coverage | **Open:** Chromium only; no physical iPhone run |
| Workflow permissions and gating | **Fixed** (1.10.3, #19 and #27). Hardening **deferred** to the owner: job-scoped permissions, the Pages trigger and concurrency only on `main`, the full suite before publishing, action pinning, up-to-date branches in the ruleset |
| `fromReport` is not a boundary for hostile input | **Noted:** revisit before the app reads arbitrary files |
| The e2e demo step uses a random seed | **Open** (the reference outputs of 1.25.0 are seeded) |
| Content-Security-Policy, self-hosted fonts | **Not done:** Google Fonts is the only external request |
| Third review's clip-rate note (44.1 kHz → 8,820 Hz) | **Disputed:** clips run at 7,350 Hz from 44.1 kHz (`round(44100 / 8000) = 6`); the conclusion on memory stands |
