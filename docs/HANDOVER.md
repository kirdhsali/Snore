# Snorewatch handover

State at version **1.11.0** (1.9.1 was the documentation and reproducibility checkpoint,
2026-10-01; later versions fix findings of an external review, see §9).
Statements marked **[verified]** were checked against this repository or by running
it; **[assumption]** marks beliefs not proven; **[suspected]** marks probable problems.
Verification commands and results: [`docs/VERIFICATION.md`](VERIFICATION.md).

## 1. Purpose and users

A browser app that records a night with the phone microphone, keeps **only snores**,
and gives a live view plus a morning report. Built for one person (the repository
owner) who uses an iPhone at the bedside; it should stay general enough for other
people and rooms later (explicit owner request: do not overfit to their bedroom).
Not a medical device; it cannot detect sleep apnea (stated in the UI).

Main user journeys:
1. **Record a night:** open `https://kirdhsali.github.io/Snore/`, follow the
   "Before you sleep" checklist, tap **Start**. Screen turns black after 20 s
   (night screen). In the morning tap the screen, then **Stop**.
2. **Read the report:** summary sentence, tiles, snores-over-time chart, loudness
   classes, ignored sounds by reason, episodes, 8 loudest snores (tap to play).
3. **Share:** star-map PNG (1080 × 1350) and a self-contained HTML report with
   8 loudest + 5 random snores, via the share sheet (phones) or download.
4. **Hand data to a developer:** download JSON (all events and features) and WAV
   (all snore clips); `npm run evaluate -- report.json` re-evaluates a night.
5. **Demo:** `…/Snore/#demo` plays a simulated 90 s night (16 snores, 5 distractors).

## 2. Requirements, constraints, intentional limitations

- One-button UI; live visual and live statistics; report on stop. **[verified]**
- **No other sounds than snores may be kept.** Non-snore audio exists only in a
  rolling buffer of about 6.5 s and as a short-lived candidate (≤ 12 s) for the
  rhythm rule; ignored sounds keep features only, never audio; the buffers are
  wiped on Stop (1.9.5). Kept clips include 0.25 s before and 0.15 s after the
  snore and can be misclassified sounds, so the UI promises "only short snore
  clips", not "only snores". **[verified in code and tests]**
- Everything runs on the device; no backend, no uploads, no accounts. **[verified]**
- Static site, no build step, no runtime dependencies; deployed by GitHub Pages.
- iOS stops the microphone for web pages when the screen locks or the tab goes to
  the background. The app keeps the screen awake (Wake Lock) and covers it with
  black. Background recording with the screen off is only possible as a native
  app (deferred, see §3).
- Default sensitivity is **Normal** and is intentionally not remembered across
  reloads (owner decision).
- File upload and the visible demo switch were removed on purpose (v1.6).
- Repository is public by owner decision; ESC-50 (CC BY-NC) must never be committed.

## 3. Status

**Implemented [verified]:** microphone recording (AudioWorklet, ScriptProcessor
fallback); detector with adaptive floor, rule-based classification, rumble filter,
breathing-rhythm rescue, confirmed vs possible snores; live strip, tiles, timeline,
clip cards; report; WAV/JSON download; copy summary; share image and HTML report;
night screen; before-you-sleep checklist; hidden demo; version and build hash in
the footer; CI, Pages deploy, automatic version tags; offline evaluation scripts;
detection and display of microphone interruptions with real-clock gaps (1.10.1–2).
Deploy and tagging run the unit tests first (1.10.3).

**Partly implemented (background tests, not counted in the headline figures):**
- Breath-noise rule (`minBreathRiseDb: 3`) — runs as shadow detector `breath`.
- Automatic sensitivity + breath rule — shadow detector `auto`. The v1.8 auto
  version failed on night 3 (see §6); the v1.9 fix is tested only on synthetic data.

**Planned / ideas (owner-agreed, not started):** switch the default to Auto +
breath rule after 2–3 real nights (v2.0); WAV export only behind a toggle;
"learn your snore" (per-user limits after a few nights); native wrapper
(Capacitor) for screen-off recording, once the app is more mature.

## 4. Architecture

```
mic ─► AudioWorklet tap (mono, 2048-sample chunks; ScriptProcessor fallback)
        ├─► SnoreDetector (chosen sensitivity) ─► SessionStats ─► live UI / report / share / downloads
        ├─► SnoreDetector (shadow "breath")    ─► SessionStats ─► JSON `shadows.breath`
        └─► SnoreDetector (shadow "auto")      ─► SessionStats ─► JSON `shadows.auto`
   (each SnoreDetector contains its own RhythmGate; shadows keep no audio)
```

| Path | Role |
| --- | --- |
| `index.html`, `css/style.css` | Page, dark-first design, night screen overlay |
| `js/version.js` | Version + build (`dev`, replaced by commit hash on deploy) |
| `js/detector.js` | FFT, `FrameAnalyzer`, `SnoreDetector`, `RhythmGate`, `SessionStats`, `classify`, WAV encoder. UMD: browser global `SnoreCore`, Node `require` |
| `js/synth.js` | Seeded synthetic sounds (snore, rattle, rumble, swell, speech, knock, cough, car; still/gusty/deep rooms). Used by demo and tests |
| `js/charts.js` | Canvas drawing (live strip, timeline, clip waveform) |
| `js/share.js` | Star-map image, script-free HTML report builder (also runs in Node) |
| `js/report-format.js` | The data file (JSON): `toReport` for the download, `fromReport` reads every schema version (UMD: `SnoreReport`) |
| `js/app.js` | Audio plumbing, UI, sessions, night screen, downloads, sharing, shadows |
| `scripts/serve.js` | Zero-dependency local static server (`npm start`) |
| `scripts/evaluate.js` | Re-evaluate a downloaded night JSON with current rules; compares shadows |
| `scripts/eval-public.js` | ESC-50 benchmark (downloads on demand outside the repo) |
| `scripts/make-sample.js` | Writes `samples/snore-demo.wav` from the synth |
| `scripts/build-standalone.js` | Optional single-file builds into `dist/` (not deployed) |
| `tests/*.test.js` | `node:test` unit tests (detector, stats, share) |
| `tests/e2e.js` | Playwright: real page, fake microphone fed with the synthetic night |
| `samples/snore-demo.wav` | Synthetic 90 s night (16 snores, 5 distractors) for manual microphone tests |
| `package-lock.json` | Pins Playwright for reproducible browser tests (`npm ci`) |
| `CLAUDE.md`, `AGENTS.md`, `docs/WORKING-RULES.md` | Agent instructions; general working rules |
| `.github/workflows/` | `ci.yml` (tests on every push/PR), `pages.yml` (deploy default branch), `release.yml` (tag `vX.Y.Z` + release) |

Detection pipeline (defaults in `DEFAULTS`/`SENSITIVITY` of `js/detector.js`):
frames of a power-of-two length ≥ 40 ms (2048 samples ≈ 43 ms at 48 kHz) → loudness and spectral shares → event when `floor + trigger` is
crossed (Normal: 8 dB, absolute gate −75 dBFS) → on end, `classify`: duration
0.25–4 s, ≥ 55 % energy 50–800 Hz, ≤ 20 % at 1–4 kHz, centroid ≤ 500 Hz,
20–60 Hz share ≤ 0.85 (rumble), ≤ 2 bursts (else rhythm candidate), optional
breath rise → `RhythmGate` (choppy but snore-like sounds count if a regular snore
lies 2–12 s away) → `SessionStats` counts a snore only when another snore lies
2–12 s before or after it (else "possible").

External services: GitHub Pages (hosting), GitHub Actions, Google Fonts
(stylesheet + font files; the only network request the app makes) **[verified by
grep: no fetch/XHR/storage in `js/`]**. No database; all state is in memory.

Data formats: report JSON (`app`, `version`, `startedAt`, `endedAt`,
`wallSeconds`, `capturedSeconds`, `interruptions[]`, `screenWakeLock`,
`sensitivity`, `summary`, `snores[]`, `ignored[]`, `shadows{breath,auto}`).
`offsetSec` of snores and interruptions is on the night's clock (analysed audio
plus interruptions). v1.8 wrote a single `shadow` object; `evaluate.js` reads
both. Since 1.11.0 the file carries `schemaVersion: 2` (older files count as 1);
`js/report-format.js` is the only code that writes (`toReport`) and reads
(`fromReport`) it, so a format change happens in one place.

## 5. Decisions and reasons

- **Rules, not a trained model:** no labelled data from the owner's room, needs to
  run offline on a phone, decisions must be explainable per sound (reason codes).
- **Confirmation by breathing rhythm (2–12 s):** isolated sounds (doors, coughs,
  steps) were the main false alarms on ESC-50; real snoring comes in runs.
- **Centroid limit 500 Hz (was 1000):** owner's snores measured 60–340 Hz; on
  ESC-50 it cut false alarms by about a third.
- **Rumble filter 0.85 (not 0.6):** chosen from the owner's listening test of 10
  clips; 0.6 would have removed snores the owner judged real.
- **New rules ship as shadows first:** compare on the same real night before they
  change the owner's numbers.
- **Night screen instead of screen-off:** web pages cannot record while locked on iOS.
- **`<audio>` element for clip playback:** Web Audio was muted by the iOS silent
  switch / routed to the earpiece after recording.
- **Workflow:** GitHub Flow; Claude may merge its own PRs when CI is green and
  tags come from `release.yml` (the Claude session cannot push to `main` or tags).

## 6. Rejected or failed approaches

- Fixed absolute gate −70 dBFS: phones record quiet bedrooms near −80 dBFS; missed soft snores.
- Strict "choppy = not a snore": rejected about one in three real (rattling) snores.
- Minimum duration 0.4 s: would have dropped 17 % of the owner's clear snores.
- Web Audio clip playback on iPhone: silent (see §5).
- Auto sensitivity on 40 ms frames (v1.8): in very quiet rooms frame flicker
  looked like restlessness → 12–13 dB margins, fewer snores than Normal (night 3).
- Audio-file analysis mode: iOS picker would not select WAV; re-analysing the
  exported snore WAV is meaningless; removed in v1.6.
- Splitting the WAV export: owner prefers zipping manually for now.
- Remembering the sensitivity across reloads: owner declined.

## 7. Known issues, shortcuts, assumptions, untested areas

Verified issues:
- **No persistence:** a tab reload, crash or iOS memory eviction during the night
  loses all data.
- `dist/` builds and the old Claude preview artifact (v1.0) are not maintained.

Shortcuts and assumptions:
- **[assumption]** Thresholds generalise: tuned on 3 real nights of one person,
  synthetic sounds and ESC-50 (40 snoring clips; 72.5 % recognised; misses are
  mostly bright mouth snores). Fake snores made while awake are often rejected
  as too bright.
- **[assumption]** Breath-noise rule (3 dB) is right: supported by night 3
  (removes 85 % of suspicious detections, loses 5.5 % of clear snores) and ESC-50
  (no snoring clips lost); not yet run live on a real night.
- **[suspected]** Running three detectors may cost noticeable CPU/battery on a
  phone over a full night (v1.9 adds the third; not measured on a device).
- Event times come from the audio sample count plus the length of interruptions
  (1.10.2), not directly from the wall clock; start, end and interruptions use the real clock.
- No Content-Security-Policy; Google Fonts request reveals the visitor's IP to Google.
- No type checker. ESLint and Prettier (JS only) run in CI since 1.10.5.
- Interruption handling is verified only with simulated events in Chromium; how
  iOS Safari reports a call, Siri or a locked screen is untested on a device.

Untested:
- iOS share sheet (Chromium tests take the download fallback).
- iOS clip playback after the v1.2 fix — not explicitly confirmed by the owner.
- Safari/WebKit and Firefox in automation (only Chromium). The ScriptProcessor
  fallback was exercised once in Chromium from `file://` (AudioWorklet blocked
  there) and recorded the demo correctly; it is not covered by a test.
- Auto sensitivity v1.9 on real audio; long nights with v1.9 on a device.
- `eval:public` is not part of CI (600 MB download); run manually before detection changes.

## 8. Next intended task

Phase A of the review fixes is complete (§9). Phase B (restructuring for saved
nights, history and a native app; no behaviour change) waits for the owner's
"go". Independently: collect 2–3 real nights with 1.10 or later (JSON, optionally the zipped WAV), run
`npm run evaluate` on each, compare Normal vs `breath` vs `auto`, and decide whether
"Auto + breath-noise rule" becomes the default (v2.0). Check against `npm run
eval:public` before switching. Keep the owner informed and ask before changing
the counting rules.

## 9. External review of 1.9.1 and fixes (Phase A)

An independent review of v1.9.1 (2026-10-01) reported nine findings R1–R9; all
were checked against the code and confirmed. Owner decisions (2026-10-01): fix the
rhythm rescue to the documented 2–12 s start-to-start rule (before/after numbers
before merge); sensitivity truly locked while recording; on a microphone
interruption show it, try to resume, use real clock times, list the gaps and never
confirm snores across a gap; precise privacy wording. Plan: one small PR per fix,
then a report to the owner and a "go" before any restructuring (Phase B).

| Version | Finding | Fix |
| --- | --- | --- |
| 1.9.2 | R2: a failed Start (e.g. microphone blocked) after a finished night discarded the session, so the still visible report's JSON/WAV/copy buttons threw | The new session is only adopted once its audio runs; on failure the previous night stays; downloads check for a finished night. E2E covers it |
| 1.9.3 | R7: the sensitivity control was only locked for touch/mouse (CSS); a keyboard could change the main detector mid-night while the breath background test kept the old setting. R6: snores found while the screen was black were all queued and drawn as cards on waking, then trimmed to 6 | The select is `disabled` while recording and the mid-night change path is removed; the dark-screen queue keeps only the newest cards that will be shown |
| 1.9.4 | R4: the local server (`npm start`) served files from sibling folders whose name starts with the project's (`startsWith` without separator), served `.git/`, crashed on a malformed URL and listened on all interfaces | Containment via `path.relative` plus a symlink check, hidden files refused, 400 on malformed URLs, binds 127.0.0.1 unless `HOST` is set (e.g. `HOST=0.0.0.0 npm start` to test from a phone). New `tests/serve.test.js` |
| 1.9.5 | R5: after Stop the last ~6.5 s of microphone audio (any sound, e.g. speech) stayed in each detector's rolling buffer while the finished session was kept; "Only snores are kept" promised more than a classifier can (clips include a moment around the snore, and mistakes are kept too) | `SnoreDetector.release()` wipes the rolling buffer, frame buffer and last spectrum; Stop calls it for the main detector and both background tests; kept clips are untouched. Wording (owner decision): "Everything stays on this device; only short snore clips are kept", with the caveat on the start page, in the shared report and the README |
| 1.9.6 | R8: an episode's "Every" divided the episode length (incl. the last snore's duration) by the gaps — starts 4 s apart showed 4.5 s; rhythm rescue delivers snores out of order (2, 6, 3, 8), so the median interval included negative gaps. R9: `evaluate.js` dropped `breathRiseDb`, so the breath-noise rule could not be checked offline | Interval = mean start-to-start gap; `confirmed` is in time order; JSON/WAV list snores in time order. `evaluate.js` maps `breathRiseDb`, warns when it is missing, accepts a candidate rule set (`reevaluate(events, options)`) and is testable; short nights show minutes. Counts unchanged |
| 1.10.0 | R3 (counting change, owner-approved rule): the rhythm rescue missed sounds the documented 2–12 s rule covers — a waiting rattle expired while a long snore that started 11 s later was still in progress; a snore too close (< 2 s) rejected a candidate that a later snore would have rescued; a candidate was checked only against the latest snore. Live and offline evaluation disagreed. The statistics also missed confirmations between a late-decided sound and snores that arrived before it | `RhythmGate` keeps all recent anchors, leaves too-close candidates waiting, and the live detector expires candidates only up to the start of a sound still in progress; `SessionStats` confirms in both directions. Limits (2 s, 12 s) unchanged; rescued sounds still never anchor |
| 1.10.1 | R1 part 1: a suspended audio context, a muted or ended microphone, or audio simply stopping left the app saying "Recording"; the end time was computed from analysed audio, so gaps vanished; a refused screen wake lock was silent | Interruptions are detected (context `statechange`, track `mute`/`ended`, no audio for 2 s), shown in the status, and the app keeps trying to resume. Audio arriving during a gap is not analysed. `endedAt` is the real clock; the JSON adds `wallSeconds`, `capturedSeconds`, `interruptions[]` and `screenWakeLock`; the report line says "interrupted N×". A refused or unsupported wake lock is shown. Event times inside the night are still analysed-audio time (fixed in 1.10.2) |
| 1.10.2 | R1 part 2: after an interruption, event times were analysed-audio time (early by the gap), a sound in progress and rhythm candidates spanned the gap, and snores on both sides could confirm each other | `SnoreDetector.resumeAfterGap(sec)` closes the open sound, rejects waiting candidates, drops the rhythm anchors and times later events after the gap (`clock` = analysed audio + interruptions); `SessionStats.addGap` prevents confirmation across a gap (owner decision). Timelines, share image and HTML report use the night's clock; per-hour figures still use analysed time. JSON interruptions carry `offsetSec` on the snores' clock |
| 1.10.3 | Workflows and docs: CI had no explicit permissions; deploy and tagging ran without tests for that commit; `WORKING-RULES.md` named lint gates and tag rights that differ from this project; handover claims on retention, wake lock and data format were out of date | `ci.yml` `contents: read`; `pages.yml` and `release.yml` run `npm test` + syntax checks before deploy/tag; `CLAUDE.md`/`AGENTS.md` state that they take precedence and use the new privacy wording; handover status, data format, known issues and next task updated. Repository settings (branch protection, required checks) are for the owner |

## 10. Phase B: readiness for expansion (owner's go 2026-10-01)

Restructuring without behaviour change (plan: B0 button fix, B1 lint/format,
B2 versioned report format, B3 completed-night record, B4 recording controller,
B5 split detector.js, B6 storage interface).

| Version | Step | Change |
| --- | --- | --- |
| 1.10.4 | B0 (owner's bug report) | "Darken screen" jumped on phones: it shared a wrapping row with the status pill and level text, whose widths change with every sound. It now sits under the Stop button (fixed size), shown only while recording. E2E checks its position at 390 × 844 while the status changes |
| 1.10.5 | B1 | ESLint (recommended correctness rules) and Prettier (JavaScript only, single quotes, width 140) as dev dependencies; `npm run lint` in CI, `npm run format` to fix. The 7 unused `catch` bindings became `catch {}`; the code was formatted once (about 330 lines in 10 files). Linting needs Node ≥ 20.19; the app and unit tests still run on Node 18 |
| 1.11.0 | B2 | One versioned data file: `js/report-format.js` writes (`toReport`, used by the download) and reads (`fromReport`, used by `evaluate.js`) it; `schemaVersion: 2`, every earlier field kept, 1.8 (`shadow`) and 1.9 files still read. `evaluate.js` now respects recorded interruptions (no rescue or confirmation across a gap, as live) and refuses files from a newer schema |
