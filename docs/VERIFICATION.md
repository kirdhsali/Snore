# Verification record

## Checkpoint 1.12.4 (answer to the second review, 2026-10-01)

**Tested code revision:** `077174be1a8bce2fe8c207e13a097ad5cb7824c2` (`main` after PR #32, version 1.12.4; tested on the identical PR tree).
The docs PR that adds this section changes no application or test code. The
1.12.0 section below stays as the record of the reviewed checkpoint `a87c1f3`.
Environment as for 1.12.0 (Node v22.22.0, npm 10.9.4, Chromium 141.0.7390.37 via
`CHROMIUM_PATH`, Playwright download blocked here).

| Command | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | passed, 82 packages |
| `npm test` | **passed**, 63/63 (three new: C1 resume, C5 wake lock, C3 share) |
| `npm run lint` | **passed** |
| `node --check` over `js/ scripts/ tests/` | **passed**, 24 files |
| `npm run build` / `npm audit` | **passed** (164 KB each) / 0 vulnerabilities |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed**, now also: night screen "Recording · …" → "Microphone off · tap, then Stop" when the mic is switched off in the dark; the shared report of that night says "recorded · interrupted 1×" |
| Full demo night (review's `full-demo.cjs`, unchanged) | **unchanged**: 16 confirmed, 0 possible, 5 ignored; background tests 16/16; no page errors |
| `node docs/review-probes/controller-store-probes.cjs "$PWD"` (second review's Appendix B) | C1 `suspended 6` / `interrupted 6` (was 0); C5 `completed off 1` (was `on 0`); C4 `false 1 999` and C6 `3660 30.016` unchanged (deferred). Its C3 line calls the HTML builder without the new fields and so still prints the old verdict; with the fields the app now passes: "6 snores in 30 s recorded." |
| `node docs/review-probes/server-probes-adapted.cjs "$PWD"` | unchanged (403/404/400, server keeps running) |
| `CHROMIUM_PATH=… node docs/review-probes/browser-probes-adapted.cjs "$PWD"` | unchanged: suspended / wake lock refused / ended track shown, failed restart keeps the night |

Detection, thresholds and defaults are untouched in 1.12.1–1.12.4, so
`npm run eval:public` was not re-run; the unchanged demo night confirms it.

**Not run / not available:** as for 1.12.0. In particular the iOS `interrupted`
state, the night screen during a real call and the wake-lock race are verified with
simulated browser objects only, **not on an iPhone**.

## Checkpoint 1.12.0 (review and handover, 2026-10-01)

**Tested code revision:** `827d6ca7bfd80a1e4f7461f584ba4cf19ad84232` (`main` after
PR #27; version 1.12.0). The review branch adds documentation on top
(`docs/HANDOVER.md`, `docs/REVIEW-RESPONSE.md`, this file, `docs/review-probes/`) and
one tooling line (`eslint.config.js` also lints `*.cjs`, so the probe scripts are
checked); `git diff 827d6ca -- js scripts tests index.html css package.json
package-lock.json .github` is empty, i.e. application and test code are unchanged.

**Environment:** Linux 6.18 container; Node v22.22.0, npm 10.9.4; Playwright 1.63.0
(from `package-lock.json`); ESLint 10.11.0; Prettier 3.9.9. Browser: preinstalled
Chromium **141.0.7390.37** at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
passed via `CHROMIUM_PATH`, because `npx playwright install chromium` failed here
(`Download failure, code=1`: this container's network policy blocks the download).
ESC-50 checkout `33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6` (outside the repository,
same commit as the original review).

| Command | Result |
| --- | --- |
| `git status --short --branch`, `git diff --stat`, `git diff --cached --stat` | clean working tree before the checks |
| `npm ci --no-audit --no-fund` | passed, 82 packages |
| `npm test` | **passed**, 60/60 (detector, share, serve, evaluate, report-format, recorder, night-store) |
| `npm run lint` | **passed** (ESLint clean, Prettier clean) |
| `for f in js/*.js scripts/*.js tests/*.js; do node --check "$f"; done` | **passed**, 24 files |
| `npm run build` | **passed**, `dist/snorewatch.html` and `dist/snorewatch-embed.html` (160 KB each; not committed) |
| `npm audit` | **passed**, 0 vulnerabilities (dev dependencies only) |
| `npx playwright install chromium` | **blocked** (download failure, network policy); replaced by `CHROMIUM_PATH` above |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed**: 390 × 844; fake mic 30 s → 6 snores, background tests 6/6; Darken screen fixed in place; keyboard lock; night screen; playback (peak 0.70); PNG + HTML report; failed restart keeps JSON and WAV; wake lock refused + mic switched off shown and gap in JSON; demo suspended 3 s → gap 4 s, nothing confirmed across it |
| Full demo night in the browser (review's `full-demo.cjs`, unchanged), JSON download | **passed**: 16 snores, 0 possible, 5 ignored (too-bright 3, choppy 1, too-long 1); background tests breath 16, auto 16; `schemaVersion` 2; no page errors |
| `npm run evaluate -- <that download>.json` | **passed**: 16 → 16 snore-like, 16 → 16 confirmed; both background tests found the same 16 |
| `npm run evaluate -- tests/fixtures/rhythm-boundary-report.json` | 1 → 2 snore-like sounds (the rhythm fix, R3) |
| `ESC50_DIR=… npm run eval:public` | **passed**: snoring clips 29/40 any, 13/40 confirmed; night sounds 100/1000 any, 23/1000 confirmed; breath rule 87/1000 and 19/1000 |
| `node <bundle>/core-probes.cjs "$PWD"` (review's probe, unchanged) | rhythm cases all confirmed; boundary audio live 2 = offline 2 at 12/12.5/13/13.5 s; intervals 4 s and median 2 s; demo 16/16/5 (details in `REVIEW-RESPONSE.md`) |
| Speech night: ring after `flush()` vs after `release()` (`node -e` with `js/detector.js`, see below) | 51 600 non-zero samples after `flush()`, **0 after `release()`** (the Stop path) |
| `node docs/review-probes/server-probes-adapted.cjs "$PWD"` | traversal 403, `/.git/HEAD` 404, malformed 400, server still running (next request 200) |
| `CHROMIUM_PATH=… node docs/review-probes/browser-probes-adapted.cjs "$PWD"` | suspended → "Recording interrupted…", end time within 2 ms of the real stop, gap 2.3 s recorded; failed restart keeps the same night; wake-lock denial shown; keyboard cannot change sensitivity; ended track shown; 4000 dark-screen snores → 6 queued, 6 cards, 47 ms |

R5 check command:
```bash
node -e "const C=require('./js/detector.js'),S=require('./js/synth.js');const sc=S.compose(16000,12,[{type:'speech',at:8}],1);const d=new C.SnoreDetector(16000);d.process(sc.samples);d.flush();const nz=()=>d.ring.reduce((n,x)=>n+(x!==0),0);console.log(nz());d.release();console.log(nz())"
```

**Counts against the original baseline (v1.9.1):** demo night unchanged
(16 confirmed, 5 ignored); ESC-50 confirmed night sounds 22 → 23 / 1000 and
18 → 19 with the breath rule; snoring clips unchanged. The change comes from the
owner-approved rhythm fix in 1.10.0 (R3); it is explained in `REVIEW-RESPONSE.md`.

**CI and deployment:** on `main` at `827d6ca`, the workflows `CI` (`CI tests`),
`Deploy to GitHub Pages` and `Tag release` passed; the deployed site is that commit
(footer `Snorewatch 1.12.0 (827d6ca)`). Not checked from this container: the live
site itself (outbound requests to `kirdhsali.github.io` are blocked here).

**Found during verification (not fixed here):** `scripts/serve.js` answers a refused
path with status 403 but the body "Bad request" (cosmetic).

**Not run / not available:**
- **Physical iPhone: not tested in this session.** No overnight run, no real call,
  Siri or screen-lock interruption, no share sheet or clip playback check, no
  battery, CPU or memory measurement over a full night.
- Safari/WebKit and Firefox: not automated.
- Long-night memory (byte budget, WAV export peak memory): not measured.

## Manual smoke test (synthetic data only)

1. **Start screen.** Open the app (`npm start` → `http://localhost:8080`, or the Pages URL).
   Expect: Start button, Sensitivity *Normal*, "Before you sleep" checklist, footer
   `Snorewatch 1.12.4 (dev)` locally or `(<commit>)` on Pages.
2. **Demo night.** Open `/#demo`. Expect a *Demo* label. Tap Start and wait 90 s (or
   tap Stop). Expect orange bars in the live strip and clip cards; at the end the
   verdict reads "16 snores …" and "5 other sounds were ignored"; the background
   line shows 16 for both tests.
3. **Microphone path.** On a computer, `npm start`, allow the microphone, tap Start,
   and play `samples/snore-demo.wav` from another device about 1 m away. Expect
   snores counted (up to 16, fewer if quiet or far) and talking/knocking/car/cough
   shown as "Ignored: …" in the status pill.
4. **Night screen.** While recording from the microphone, do not touch for 20 s.
   Expect a black screen with a dim clock. Tap it: the app returns, recording
   continues; the tap does not stop it. Then tap Stop.
5. **Report and playback.** Tap a clip under "Loudest snores". Expect audible
   playback (on iPhone also with the silent switch on); a second tap stops it.
6. **Downloads.** "Download data (.json)": contains `version`, `snores[]`,
   `ignored[]`, `shadows.breath`, `shadows.auto`. "Download snores (.wav)": plays.
   `npm run evaluate -- <file>.json` prints the comparison table.
7. **Share.** "Share image": PNG 1080 × 1350 star map. "Share full report": one
   HTML file without scripts; for the demo it holds 13 playable snores (8 loudest
   + 5 random) and opens offline.
8. **Permission denied.** Block the microphone and tap Start. Expect the red message
   "Microphone access was blocked …".
9. **Darken screen and interruptions (phone).** While recording, "Darken screen"
   sits under Stop and does not move. Receive a call or invoke Siri: expect
   "Recording interrupted …", then automatic resume; the report says "interrupted 1×"
   and the JSON lists the gap. **Not yet done on a physical iPhone.**

## History

### Checkpoint 1.9.1 (before the review)

Run on 2026-10-01 for version **1.9.1**, in a Linux container with
Node v22.22.2, npm 10.9.7, Playwright 1.63.0 (from `package-lock.json`) and a
preinstalled Chromium headless shell passed via `CHROMIUM_PATH`.

#### Automated checks

| Command | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | exit 0, 2 packages |
| `npm audit` | exit 0, 0 vulnerabilities (possible since the lockfile was added) |
| `for f in js/*.js scripts/*.js tests/*.js; do node --check "$f"; done` | exit 0, 14 files |
| `npm test` | exit 0, 36 tests, 36 pass, 0 fail |
| `CHROMIUM_PATH=… npm run test:e2e` | exit 0: fake microphone 30 s → 6 snores, report, both background tests 6, clip plays (peak 0.70), PNG + HTML report download and play, `#demo` 3 snores in 12 s |
| `npm run build` | exit 0, `dist/snorewatch.html` and `dist/snorewatch-embed.html` (136 KB each; not deployed) |
| `ESC50_DIR=… npm run eval:public` | exit 0: snoring clips 29/40; night sounds counted 100/1000 (current rules), 87/1000 (breath rule) |
| Demo night end to end in Chromium (`/#demo`, 90 s) + `npm run evaluate -- demo-report.json` | 16 snores, 5 ignored; background tests 16/16; evaluate exit 0 |

CI (`.github/workflows/ci.yml`) runs `npm test`, `npm ci`, Playwright Chromium
install and `npm run test:e2e` on every push and pull request.

#### Not run or not available

- **Lint / format / type check:** none configured. An ad-hoc ESLint run with core
  correctness rules (`no-undef`, `no-unused-vars`, `no-unreachable`, …) found only
  6 unused `catch (e)` variables in `js/app.js` and one false positive (`URL` in
  `scripts/serve.js`, a Node global missing from the ad-hoc config).
- **Other browsers:** Safari/WebKit and Firefox are not automated; iPhone behaviour
  is known only from the owner's nights (Safari, iOS).
- **Device checks:** iOS share sheet, iOS clip playback after the v1.2 fix, CPU and
  battery with three detectors (v1.9) over a full night.

#### Extra checks made for the handover

- Dev server path handling: `GET /..%2FSnore-probe/probe.txt` returned a file from a
  sibling directory (`Snore-probe`) → known issue, see `docs/HANDOVER.md` §7.
- `file:///…/index.html#demo` in Chromium: AudioWorklet is blocked for `file://`,
  the ScriptProcessor fallback took over and the demo recorded snores.
- `samples/snore-demo.wav` was stale (old synthetic snores; current detector found
  6/16). Regenerated with `npm run sample`; now 16/16 snores, 5 ignored.

### Per-step records, Phase A (1.9.2–1.10.3)

Each fix is checked with `npm test`, `node --check` on all files and
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`
(Node 22.22.0, Playwright Chromium 1194). New regression tests were run against
the old code first and failed there.

| Version | Check | Result |
| --- | --- | --- |
| 1.9.2 | E2E "failed restart": finished 30 s night, `getUserMedia` rejected with `NotAllowedError`, Start, then JSON + WAV download | old code: download never happens (page error); new code: JSON has the previous `startedAt` and snores, WAV valid; full e2e passed; `npm test` 36/36 |
| 1.9.3 | E2E: focus + ArrowUp on the sensitivity while recording; card limit 2 during the dark phase | old code fails (`sensitivity disabled while recording`); new: main/breath stay `normal`, ≤ 2 cards queued and drawn; JSON `sensitivity` and `shadows.breath.sensitivity` both `normal`; full e2e passed; `npm test` 36/36 |
| 1.9.4 | `tests/serve.test.js` (now part of `npm test`): sibling traversal in three spellings, `/.git/HEAD`, `/.github/…`, `/%E0%A4%A`, then a normal request | old server: traversal returned 200 with the outside file; new: refused, 404/400, server keeps running; `npm test` 37/37; full e2e passed |
| 1.9.5 | New unit test: speech just before Stop is rejected without audio, then `release()` leaves no non-zero sample in the ring, frame buffer or spectrum; demo snore clips unchanged by `release()` | `npm test` 38/38; full e2e passed |
| 1.9.6 | New unit tests: starts 2/6/10 → episode interval 4 s (old 4.5); arrival 2,6,3,8 → median 2 s (old 4); `tests/evaluate.test.js`: breath rise read, rule applied with `minBreathRiseDb: 3`, old reports without the field | old code fails both; `npm test` 41/41; full e2e passed; `npm run evaluate` on the review's synthetic demo report: 16/16 confirmed, unchanged |
| 1.10.0 | New unit tests: the review's three gate cases, limits 1.5/12.5 s, no chaining through rescued sounds, the long-snore boundary audio (snore at 12/12.5/13/13.5 s) live, its report re-evaluated offline (`tests/fixtures/rhythm-boundary-report.json`, synthetic, from the review), two-way confirmation. Before/after on synthetic nights (demo at 48/44.1/16 kHz × 8 seeds, auto/normal + breath, 20 mixed rattle runs): demo counts identical; mixed runs 761 → 766 snore-like, 756 → 762 confirmed, all 5 newly counted sounds are rattles, distractors counted 0 → 0. `npm run eval:public`: snoring 29/40 and 13/40 unchanged; night sounds 100/1000 unchanged, confirmed 22 → 23 (current) and 18 → 19 (breath rule), one more washing-machine clip confirmed through two-way confirmation | old code fails 4 of the new tests; `npm test` 46/46; full e2e passed (6 snores, background tests 6/6) |
| 1.10.1 | E2E: wake lock refused → warning; microphone track ended → status, report "interrupted 1×", JSON gap `ended` ≥ 1.2 s, wall = analysed + gap, `endedAt` = real clock; demo audio suspended 3 s with resume blocked → "interrupted", app resumes by itself once possible, gap 4 s in the JSON (detection within 1 s) | old code: times out waiting for the status; new: full e2e passed; `npm test` 46/46 |
| 1.10.2 | New unit test: snores, 1 s gap, rattle after it → rattle timed after the gap, not rescued by a snore 8 s earlier, audio dropped; snores 4 s apart across a gap not confirmed. E2E demo with a 3–4 s suspension: snores after the gap lie after it, none confirmed across it (3 runs) | old code: the new unit test fails (no `resumeAfterGap`); `npm test` 47/47; full e2e passed 3×; demo without gaps unchanged (16 snores) |
| 1.10.3 | Workflow YAML parsed (jobs: ci `test`; pages `test` → `deploy`; release `test` → `tag`); `npm test`, `node --check`, full e2e | `npm test` 47/47; e2e passed; deploy/tag jobs verified on the merge to `main` |

### Per-step records, Phase B and second review (1.10.4–1.12.4)

| Version | Check | Result |
| --- | --- | --- |
| 1.10.4 | E2E now runs at 390 × 844 (iPhone-sized); samples the "Darken screen" box 12× over 4.8 s while the pill changes (measuring → listening → sound heard) | old layout: two positions (x 247 and 16); new: one position; full e2e passed; `npm test` 47/47 |
| 1.10.5 | `npm run lint` (ESLint 10 + Prettier 3.9), detector events on the demo night at 48/44.1/16 kHz × 3 seeds compared field by field with `main` | lint clean; events identical; `npm test` 47/47; full e2e passed; `npm run build` OK |
| 1.11.0 | New `tests/report-format.test.js`: demo night with a 5 s gap through `toReport` → JSON → `fromReport` (events, flags, gap, background test); all fields of a 1.9.1 file still written; 1.8 and 1.9 fixtures (synthetic) read; foreign/newer files refused; re-evaluation does not rescue across a gap. E2E: download has `schemaVersion: 2`. `npm run evaluate` on the 1.9 demo fixture: 16/16 as before | `npm test` 52/52; lint clean; full e2e passed |
| 1.11.1 | E2E: after Stop the night is one frozen record with id, sample rate and time zone, its snore count matches the download; a failed restart keeps the same night id; all report, share and download steps unchanged | `npm test` 52/52; lint clean; full e2e passed |
| 1.11.2 | New `tests/recorder.test.js` (fake AudioContext, microphone and clock): state sequence, demo night 16 snores / 5 ignored through the recorder, failed start keeps state and night, suspended / stalled / switched-off interruptions with gap lengths and clock. E2E unchanged | `npm test` 55/55; lint clean; full e2e passed; `npm run build` includes the recorder |
| 1.11.3 | Compared with `main` before the split: detector events on the demo night (48/44.1/16 kHz × 3 seeds) identical; `SnoreCore` exports and `DEFAULTS` identical; summary and WAV bytes identical. `npm run eval:public`: 29/40 · 13/40 · 100/1000 · 23/1000 (breath rule 87 · 19), unchanged | `npm test` 55/55; lint clean; full e2e passed; `npm run build` OK |
| 1.12.0 | New `tests/night-store.test.js`: contract tests (create/list/load/delete, events updated by id and stored without audio, clips only for accepted snores, finalized nights read only, unfinished nights listed for recovery, a full demo night in and out) run against the in-memory store | `npm test` 60/60; lint clean; full e2e passed |
| 1.12.1 | New recorder unit test: resume attempts for `suspended` and `interrupted` (also when resume is refused), none for `closed` or an ended track. Review probe C1: `interrupted` 0 → 6 resume calls | old code: new test fails; `npm test` 61/61; lint clean; full e2e passed |
| 1.12.2 | E2E: screen darkened before the system switches the microphone off; the night screen first says "Recording · …", then "Microphone off · tap, then Stop" | old code: e2e fails ("Recording · 0 snores"); `npm test` 61/61; lint clean; full e2e passed |
| 1.12.3 | New share unit test: an interrupted night (90 s recorded, 1 h gap) → HTML meta "… of 1 h 1 min recorded · interrupted 1×", verdict "in 1 min … recorded" without an hourly figure, gap times listed, gap band in the timeline; image text likewise with a "not recorded" legend; uninterrupted output byte-identical with and without the new fields. E2E: the shared report of the switched-off night says "interrupted 1×". Review probe C3 with the fields the app now passes: "6 snores in 30 s recorded." | old code: new unit test fails; `npm test` 62/62; lint clean; full e2e passed |
| 1.12.4 | New recorder unit test: lock resolved after Stop → released, state `off`; lock for the first night arriving during the second → released, the second night's lock kept and released on Stop. Review probe C5: `completed on 0` → `completed off 1` | old code: new test fails; `npm test` 63/63; lint clean; full e2e passed |

### Per-step records, real night 4 follow-up (1.12.5–)

| Version | New or changed check | Result |
| --- | --- | --- |
| 1.12.5 | New evaluator test: a report with `timeZone: "Asia/Kathmandu"` evaluated on a computer set to UTC counts its 23:34 UTC snores under 5:00 and names the zone; without `timeZone` it uses the computer's zone and says so. Round-trip test: `timeZone` written and read back. E2E: the downloaded JSON names the night's zone | old code: new test fails (`23:00`); `npm test` 64/64; lint clean; full e2e passed |
| 1.12.6 | New detector tests: the demo night 40 dB quieter gives the same 16 snores, each clip at 0.7 of full scale with > 1000 distinct sample values; `clipFromAudio` boosts quiet audio, caps at 60 dB, never turns down, keeps silence. Old vs new clips of the demo night at full, −40 dB and −54 dB level: same snores, same playback peaks, differences only the old rounding noise (≤ 2.2 % of full scale) | old code: new tests fail (clip peak 40 steps); `npm test` 65/65; lint clean; full e2e passed (playback peak 0.70) |
| 1.13.0 | Recorder test: the night has background tests `breath`, `breath6`, `auto`; `breath6` runs the chosen sensitivity with a 6 dB breath rule and counts the demo night's 16 snores. New evaluator test: sounds with 3.8–5.2 dB of breath noise pass the 3 dB rule and fail the 6 dB rule. E2E: `breath6` locked to Normal while recording, in the JSON with `minBreathRiseDb: 6`. Demo night at 48/44.1/16 kHz: 16 confirmed, 0 possible, 5 ignored for the main detector and all three background tests. `ESC50_DIR=… npm run eval:public` (ESC-50 `33c8ce9`): current rules unchanged (snoring 29/40, 13 confirmed; night sounds 100/1000, 23 confirmed); 3 dB 29/40, 13; 87/1000, 19; 6 dB 29/40, 12; 78/1000, 14 | old code: recorder test fails (no `breath6`); `npm test` 66/66; lint clean; full e2e passed |
