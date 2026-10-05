# Verification record

## Checkpoint 1.22.3 (third review fixes, 2026-10-05)

**Tested code revision:** `7095f5f567a850147684d1a7a696640d761f0046` (`main` after PR #54, version 1.22.3; checked in a clean worktree). The third
review of `8e05d2b` (saved in [`reviews/2026-10-05-8e05d2b-review.md`](reviews/2026-10-05-8e05d2b-review.md))
found N1–N4; each fix was its own PR, tested before merging and again on `main` at the end:
#52 (1.22.1, N2/N3), #53 (1.22.2, N1), #54 (1.22.3, N4). Response per finding:
[`REVIEW-RESPONSE.md`](REVIEW-RESPONSE.md), "Third review of 8e05d2b".

**Environment:** as for 1.22.0 (Linux container, Claude cloud session; Node v22.22.0, npm
10.9.4; Playwright 1.63.0, ESLint 10.11.0, Prettier 3.9.9; Chromium 141.0.7390.37 via
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; `npx playwright install`
not run). No ESC-50 checkout in this container.

| Command | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | passed, 82 packages |
| `npm test` | **passed**, 99/99 (92 at 1.22.0 + 3 evaluator, 3 room noise, 1 share; recorder and report-format tests extended) |
| `npm run lint` | **passed** |
| `node --check` over `js/*.js scripts/*.js tests/*.js docs/review-probes/*.cjs` | **passed**, 30 files on `main` (31 with this docs PR's probe) |
| `npm audit` | 0 vulnerabilities |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed**, incl. the new step: share image of a 22:00–06:00 night (en-US, Europe/Berlin) with 3 interruptions, header "10:00 PM – 06:00 AM · 7 h 30 min of 8 h 0 min recorded" at 72–856 px and "interrupted 3×" at 72–280 px; every text inside 0–1080 px |
| Same e2e step with `js/share.js` of 1.22.2 | **fails** as expected: one header line at 72–1090.4 px on the 1080 px image (the review measured 72–1092.6 px with one interruption) |
| `CHROMIUM_PATH=… node docs/review-probes/full-demo-run.cjs "$PWD" <out>` | **passed**: version "1.22.3 (dev)", 16 confirmed, 0 possible, 5 ignored (too bright 3, choppy 1, too long 1); background tests knock 16, auto 16, high 16; JSON 46,800 bytes, WAV 434,948, HTML 513,697, PNG 344,514; no page errors; console: the blocked Google Fonts request and the `/favicon.ico` 404 |
| `npm run evaluate -- <out>/snore-report_….json` | 16 → 16 confirmed; each background test "re-counted from its stored sounds with its own rules: 16 confirmed"; High 16 at 3 / 4.5 / 6 dB, auto 16 at 4.5 / 6 dB and in every pre-rise cell, all "re-counted from its stored sounds" |
| `node docs/review-probes/noise-evaluator-probes.cjs <checkout>` at 1.22.0 (`2ea0749`) | N1: stretches `[[1200,5520]]`, masked `[[1200,5520]]`, text "0:20–1:32: a steady sound…", "0:20–1:32: the room was 8 dB louder…"; N2: estimate / full rules `2 0` (breath 6 dB) and `2 0` (pre-rise 8 dB) |
| the same on `main` (`7095f5f`) | N1: none, "The room stayed quiet and steady while it was recorded."; N2: estimate `2`, full rules `0`, `recount` own rules 3, breath 6 dB 0, pre-rise 8 dB 0 (the estimate is kept, labelled approximate, for files before 1.22.1) |
| `npm run evaluate -- tests/fixtures/v1.8-report.json` | 1.22.0: "with a breath-noise rule of 3 dB: 0 (0/h), 4.5 dB: 0 (0/h), 6 dB: 0 (0/h)"; now: "with a stricter breath-noise rule: not evaluable (this file has no breath-noise measurements for it)" |
| `npm run evaluate -- tests/fixtures/rhythm-boundary-report.json` | unchanged: 1 → 2 snore-like, 0 → 2 confirmed |
| New tests against the old code (each fix's code stashed) | N2/N3: the 3 new evaluator tests fail (and the 1.22.0 High test, whose label changed); N1: the 3 new room-noise tests fail; N4: the new share test and the e2e step fail |
| Old vs new `summarize`/`describe`, 400 random nights without gaps (scratch script) | identical output; 399 of the nights had findings |

**CI and deployment:** on `main` at `7095f5f`, `CI` (`CI tests`), `Tag release` (`v1.22.3`)
and `Deploy to GitHub Pages` passed; tags `v1.22.1` (`146e586`) and `v1.22.2` (`3851896`)
were created by their merges. Their Pages deploys were **cancelled** by the next merge to
`main` (one concurrency group), so 1.22.1 and 1.22.2 were never live; 1.22.3 is. Pages
finished at 14:50:31Z and CI at 14:51:34Z: publishing again did not wait for the full suite
(third review, workflow leftovers). The live site was not opened from this container.

**Counts:** no detection rule, threshold or default changed in 1.22.1–1.22.3; the counting
detector, the background tests' live counts and the demo night (16 confirmed, 5 ignored)
are unchanged. The ESC-50 benchmark was not re-run (no detection change; the dataset tests
will start with a fresh run).

**Not run / not available:** physical iPhone, Safari/WebKit, Firefox; long-night memory on
a phone; the public-dataset tests (next task, HANDOVER §10); the owner's real-night files
(not in the repository), so nights 4–6 were not re-evaluated with the new evaluator (their
files are older than 1.22.1 and would get the labelled estimate anyway).

## Checkpoint 1.22.0 (review and fresh-session handover, 2026-10-05)

**Tested code revision:** `687b1f7780e1cfe19b62ff5f2ffce094dcfc21c5` (`main` after PR #50,
version 1.22.0, tagged `v1.22.0`, deployed). The review branch
`claude/review-checkpoint-1.22` adds documentation (`docs/HANDOVER.md`,
`docs/REVIEW-RESPONSE.md`, this file, two lines of `README.md`) and one verification script,
`docs/review-probes/full-demo-run.cjs` (linted); application and test code are unchanged:
`git diff 687b1f7 -- js scripts tests index.html css package.json package-lock.json .github eslint.config.js`
is empty.

**Environment:** Linux 6.18 container (Claude cloud session); Node v22.22.0, npm 10.9.4;
Playwright 1.63.0, ESLint 10.11.0, Prettier 3.9.9 (from `package-lock.json`). Browser:
preinstalled Chromium **141.0.7390.37** at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
via `CHROMIUM_PATH`; `npx playwright install chromium` was **not run** (this environment
provides its browser and forbids downloading one; at 1.12.0 the download was blocked).
ESC-50 checkout `33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6` outside the repository.

| Command | Result |
| --- | --- |
| `git status --short --branch`, `git diff --stat`, `git diff --cached --stat` | clean before the checks (branch at the handover commit `d28940c` on top of `687b1f7`) |
| `npm ci --no-audit --no-fund` | passed, 82 packages |
| `npm test` | **passed**, 92/92 (detector, share, serve, evaluate, report-format, recorder, night-store, noise) |
| `npm run lint` | **passed** (ESLint and Prettier clean) |
| `node --check` over `js/*.js scripts/*.js tests/*.js docs/review-probes/*.cjs` | **passed**, 29 files |
| `npm run build` | **passed**, `dist/snorewatch.html` and `dist/snorewatch-embed.html` (208 KB each; not committed) |
| `npm audit` | **passed**, 0 vulnerabilities (dev dependencies only) |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed**: fake mic 30 s → 6 snores, 1 ignored; Darken screen fixed; keyboard lock (main normal, knock normal, auto auto, high high); night screen; room-noise panel; background tests 6/6/6; playback 1.33 s at peak 0.70; PNG 297 KB + HTML 284 KB, first clip plays 1.79 s; failed restart keeps the night; wake lock refused + mic switched off shown and in the JSON; demo suspended 3 s → gap 4 s, nothing confirmed across it |
| `CHROMIUM_PATH=… node docs/review-probes/full-demo-run.cjs "$PWD" <out>` (full 90 s `#demo` night) | **passed**: 16 confirmed, 0 possible, 5 ignored (too bright 3, choppy 1, too long 1); background tests knock 16, auto 16, high 16; schema 2, `minBreathRiseDb` 6, 2 noise minutes; saved `snore-report_2026-10-05_1244.json`, `snores_2026-10-05_1244.wav` (456 790 bytes), `snore-report_2026-10-05_1244.html`, `snore-night_2026-10-05_1244.png`; no test clips (no background test heard a snore Normal missed); no page errors; console: the blocked Google Fonts request and a 404 for `/favicon.ico` |
| `npm run evaluate -- <out>/snore-report_2026-10-05_1244.json` | **passed**: 16 → 16 snore-like, 16 → 16 confirmed; without the breath rule 16; each background test 16, found by both 16; High re-count 16 at 3 / 4.5 / 6 dB; auto pre-rise table 16 in every cell |
| `npm run evaluate -- tests/fixtures/rhythm-boundary-report.json` | 1 → 2 snore-like, 0 → 2 confirmed (the R3 fix) |
| `ESC50_DIR=… npm run eval:public` | **passed**, identical to 1.18.0: Normal snoring 29/40 (13 confirmed), night sounds 76/1000 (13), other 158/1960 (31); without the breath rule 30/40 (14), 100/1000 (22); 3 dB 29/40 (13), 87/1000 (18); knock rule 28/40 (11), 50/1000 (8) |
| R5 ring check (command under 1.12.0 below) | 51 600 non-zero samples after `flush()`, **0 after `release()`** |
| `node docs/review-probes/server-probes-adapted.cjs "$PWD"` | traversal 403 (body "Bad request"), `/.git/HEAD` 404, malformed 400, still running, next request 200 |
| `CHROMIUM_PATH=… node docs/review-probes/browser-probes-adapted.cjs "$PWD"` | suspended → "Recording interrupted: the system paused the microphone. Trying to resume…"; reported stop 1 ms after the real stop, gap 2.4 s, wall 4 s = 1.7 s analysed + gap; failed restart: same night id, no page errors; wake lock refused shown; keyboard: control disabled, detectors unchanged (main/knock normal, auto, high); ended track shown; 4000 dark-screen snores → 6 queued, 6 cards, 48 ms |
| `node docs/review-probes/controller-store-probes.cjs "$PWD"` | unchanged from 1.12.4: C1 `suspended 6` / `interrupted 6`; C5 `completed off 1`; C3 old-call verdict (the probe omits the fields the app passes); C4 `false 1 999`, C6 `3660 30.016` (deferred) |
| Targeted regression tests, `node --test --test-name-pattern …` | R1 7/7, R2 1/1, R3 10/10, R4 1/1, R5 6/6 (incl. both test-clip samples), R6 1/1 (+ e2e card queue), R8 1/1, R9 11/11 (test names in `REVIEW-RESPONSE.md`) |

**Counts against the original baseline (v1.9.1, `e4eea25`):**
- Demo night unchanged: 16 confirmed, 5 ignored.
- ESC-50 (current harness, clips faded since 1.18.0): snoring clips 29/40 (13 confirmed), night sounds 76/1000 (13 confirmed).
- Baseline: 29/40 (13), 100/1000 (22, old harness).
- Explained by three changes:
  - the rhythm fix (R3, 1.10.0, owner-approved): night sounds 22 → 23;
  - the fade in the benchmark (1.18.0, harness only): the same rules give 30/40 (14), 100/1000 (22);
  - the 6 dB breath rule on Normal (1.17.0, owner-approved): 30 → 29 snoring clips (14 → 13 confirmed), 100 → 76 night sounds (22 → 13 confirmed).

**CI and deployment:** on `main` at `687b1f7` the workflows `CI` (`CI tests`), `Tag release`
(`v1.22.0`) and `Deploy to GitHub Pages` passed, so the deployed site should be that commit
(the deploy stamps the footer `Snorewatch 1.22.0 (687b1f7)`). The live site itself was not
opened: outbound requests to `kirdhsali.github.io` are blocked in this container.

**Found during this verification (not fixed here, cosmetic):**
- the page requests `/favicon.ico`, which does not exist (404 in the console);
- `npm run evaluate` prints an empty "room noise:" heading for recordings shorter than 10 minutes;
- `scripts/serve.js` still answers a refused path with 403 and the body "Bad request".

**Not run / not available:**
- **Physical iPhone: not tested in this session.** No overnight run, no real call, Siri or
  screen-lock interruption, no share sheet or clip playback, no battery/CPU/memory
  measurement with four detectors.
- Safari/WebKit and Firefox: not automated.
- Long nights: memory (clip byte budget, event metadata of four detectors, two clip
  reservoirs) and WAV export peak memory not measured.
- The original review's `core-probes.cjs` and `full-demo.cjs` are not available in this
  environment (the evidence bundle was never in the repository); replaced by the
  targeted tests above and `full-demo-run.cjs`.
- Public-dataset tests (APSAA, PSG-Audio, Khan clips): **not run**, by the owner's choice,
  for a new session (HANDOVER §10).
- The real-night analyses of nights 4–6 (HANDOVER §8) used the owner's files, which are
  not in the repository; they cannot be re-run from it.

## Checkpoint 1.13.0 (real night 4 follow-up, 2026-10-03)

**Tested code revision:** `45c507d8597e715035fdffd4d5e078113cac0fd3` (`main` after PR #36, version 1.13.0; tested on the
identical PR tree). The docs PR that adds this section changes no application or test code.
Environment as for 1.12.0 (Node v22.22.0, npm 10.9.4, Chromium 141.0.7390.37 via
`CHROMIUM_PATH`); ESC-50 checkout `33c8ce9` outside the repository.

| Command | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | passed, 82 packages |
| `npm test` | **passed**, 66/66 (new: evaluator time zone, clip detail ×2, 6 dB rule) |
| `npm run lint` | **passed** |
| `node --check` over `js/ scripts/ tests/` | **passed**, 24 files |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed**; JSON names the time zone; background tests breath 6, breath6 6, auto 6; playback peak 0.70 |
| Demo night at 48 / 44.1 / 16 kHz, main detector and the three background tests | **unchanged**: 16 confirmed, 0 possible, 5 ignored each |
| `ESC50_DIR=… npm run eval:public` | current rules **unchanged** since 1.12.0 (snoring 29/40, 13 confirmed; night sounds 100/1000, 23 confirmed); breath 3 dB 29/40, 13; 87/1000, 19; breath 6 dB 29/40, 12; 78/1000, 14 |
| `node docs/review-probes/controller-store-probes.cjs "$PWD"` | unchanged from 1.12.4: C1 `suspended 6` / `interrupted 6`; C5 `completed off 1`; C3 old-call verdict as noted there; C4 `false 1 999`, C6 `3660 30.016` (deferred) |
| `node docs/review-probes/server-probes-adapted.cjs "$PWD"`, `CHROMIUM_PATH=… node docs/review-probes/browser-probes-adapted.cjs "$PWD"` | unchanged |
| `npm run evaluate -- <night 4>.json` (real night, not committed) | 1053 → 1061 snore-like, 955 → 961 confirmed (feature rounding, see HANDOVER §6); the file predates 1.12.5, so the hours fall back to this computer's zone and say so |
| Night 4 offline re-scoring with `reevaluate` (scratch script, not committed) | figures in HANDOVER §6a |

**Not run / not available:** as for 1.12.4; nothing in 1.12.5–1.13.0 was tried on an
iPhone. The clip change is verified on synthetic audio only (same snores, same playback
level); its effect on real clips shows with the next recorded night.

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
| 1.13.1 | Night 4 clips: quiet level just before each snore sits a median 3.2 dB (5.0 dB at 03:15–03:46) above the floor, auto's release was 3.2 dB. New detector test (hum room, loud two-burst snores every ~10 s, breathing between): auto finds all snores, no false ones, release ≥ 4.5 dB. Synthetic rooms, 5 seeds, auto before → after: still 207 → 207/210, very quiet 51 → 51, gusty 210 → 210, deep rumble 156 → 186, wavering hum 114 (14 false) → 122/122 (0 false); Normal 208/18/208/71/120, no false alarms anywhere. Real night-4 snores (03:15–04:00) replayed over a simulated hum room: before 128–133/150, after 131–136, Normal 132–135. Demo night unchanged for all detectors at 48/44.1/16 kHz | old code: new test fails (release 3.0 dB); `npm test` 67/67; lint clean; full e2e passed |
| 1.14.0 | New recorder test (very quiet bedroom, auto hears snores Normal misses): without a cap exactly those snores keep clips; with a cap of 5, 5 clips, none overlapping a counted snore; `breath`/`breath6` keep no audio. New report-format test: `wavStartSec` of sampled background-test snores, `null` otherwise. New evaluator test: 6 dB re-count from stored sounds, also across an interruption. E2E: the test-clip button is shown exactly when the JSON lists test clips (0 in the demo run). One-off browser run (not committed) with a quiet bedroom on the fake mic: Normal 2, auto 9 confirmed, 6 test clips, button shown, WAV positions match the JSON, no page errors. Night 4 evaluator: breath 3 dB → 6 dB 667, auto 3 dB → 6 dB 743 | old code: new recorder test fails (no clips); `npm test` 70/70; lint clean; full e2e passed |
| 1.15.0 | New `tests/noise.test.js` (added to `npm test`): a 50 Hz tone at −43 dBFS reads −43 dB in the 63 Hz octave and as background, hum 50 ± 3 Hz at 48 and 16 kHz; snores leave the background within 1.5 dB but raise the minute's loud moments; a device 10 dB above the room raises the background 8–12 dB while it runs and not after; no minutes during a 200 s interruption. Simulated rooms: hum room 50.5 Hz (30 dB above its surroundings), background −87.9 dBFS; still, gusty and deep-rumble rooms no tone. Recorder test: the demo night has 2 minutes, 8 octaves at 16 kHz, shadows keep no profile. Evaluator test: background and hum per hour. E2E: the JSON has `noise` with bands per minute. Demo counts unchanged | old code: new tests fail (no `noise`); `npm test` 74/74; lint clean; full e2e passed |
| 1.16.0 | Night 5 test clips (offline, against the minute's room noise in the 63–500 Hz octaves): auto's extra snores rise a median 1.2 dB (none ≥ 5 dB), Normal's confirmed snores 15.8 dB. New detector test (hum room, muffled breathing every ~4 s, a snore run): auto + 3 dB breath rule counts ≥ 20 breaths over 3 seeds, + 8 dB snore-band rule none, all snores kept. Simulated rooms, auto today → with the rule, 5 seeds: still 207 → 207/210, very quiet 51 → 51, gusty 210 → 210, deep rumble 186 → 175, hum 122 → 122; no false alarms. Demo night unchanged for all detectors at 48/44.1/16 kHz | old code: new test fails (no `lowRise`); `npm test` 75/75; lint clean; full e2e passed |
| 1.17.0 | Detector tests: Normal (the default) counts none of 6 hum swells (≥ 5 "no breath noise", the rest rumble) and keeps the 6 snores, at 48 and 16 kHz; Low does not check breath noise; `breathRuleDb`: Normal 6, Low/High/auto none, an option overrides it (`null` switches it off); a sound with 4 dB of breath noise is "no breath noise" on Normal and a snore on High. Evaluator: Normal applies 6 dB, High none; the command prints the recorded and current rule and the count without it. Recorder: `config.minBreathRiseDb` 6, background tests only `auto`. Data file: `minBreathRiseDb` 6 survives the round trip. E2E: the JSON names the rule, only `auto` runs in the background, the note names the rule. Night 4 (`npm run evaluate`): 955 recorded → 661 confirmed (961 without the rule); night 5 76 → 73. `npm run eval:public` (ESC-50 `33c8ce9`): Normal snoring 29/40, 12 confirmed, night sounds 78/1000, 14 confirmed; without the rule 29/40, 13; 100/1000, 23; 3 dB 29/40, 13; 87/1000, 19. Demo night: 16 snores, none set aside for breath noise | old code: 6 new or changed tests fail (plus the version check); `npm test` 81/81 (share test: the shared report explains the rule on Normal only); lint clean; `node --check` all files; full e2e passed |
| 1.18.0 | `onsetJump` matches the analysis script on 200 random signals (difference 0). Real clips: night 5's four knocks rise 21.4–41.6 dB over 20 ms, real snores at most 18.4 dB (night 5) and 23.1 dB (night 4; 2 of 955 confirmed above 20 dB). New detector tests: a 40 dB knock reads > 35 dB wherever it starts in the 10 ms grid, a swell of 40 dB over 0.3 s < 10 dB, no audio → null; synthetic bumps (new `bump`) pass every Normal rule and count as snores, the 20 dB rule sets all of them aside and keeps every snore (48/44.1/16 kHz, 3 seeds; snores ≤ 11 dB, bumps > 20 dB); the demo night keeps 16 snores. Evaluator: the rule re-runs on stored `onsetJumpDb`, files without it keep their verdict; the knock test's line lists the counted snores it drops with clock time and WAV position. Recorder: background tests `knock` (Normal + 20 dB, breath rule 6 dB from the sensitivity) and `auto`; the knock test counts the demo's 16 snores. Data file: `onsetJumpDb` per sound and per background-test snore, `maxOnsetJumpDb` per test. E2E: `knock` locked to Normal, in the JSON with its rules, the note names it. `npm run eval:public` (ESC-50 `33c8ce9`, clips now faded in/out over 0.1 s): current 29/40, 13 confirmed; night sounds 76/1000, 13; without breath rule 30/40, 14; 100/1000, 22; 3 dB 29/40, 13; 87/1000, 18; knock rule 28/40, 11; 50/1000, 8. Without the fade the knock rule lost 4 snoring clips: 6 of its 9 dropped snores started exactly where the clip was cut in | old code: 6 new or changed tests fail (plus the version check); `npm test` 85/85; lint clean; `node --check` all files; full e2e passed |
| 1.19.0 | New share tests: the heatmap has one row per shown band (8 kHz left out) plus the level line; minutes 15 dB above a band's quiet level are full colour, three loud minutes in a row are one rectangle three minutes wide, quiet minutes draw nothing; a gap is marked; two snores 4 s apart share a tick; the level line runs through all 60 minutes. The report file has a "Room noise" section with the findings (escaped) and a 720-wide heatmap; for 2 minutes it says the room is described from 10 minutes on and draws no heatmap; nights without a profile have no section; still no scripts. E2E (31 s): panel shown with that sentence, no heatmap and no legend; the report file has the section. One-off browser run (not committed, 3.5 min through the fake mic, 390 px): heatmap drawn 326 units wide, hour labels and snore ticks readable, redrawn 736 wide after resizing to 800 px; no page errors besides the blocked font request. Night 5 rendered offline at phone width (dark) and as a report file (light): both findings and the heatmap show the 70–83 Hz tone and the mid/high stretches | old code: the 2 new share tests fail (plus the version check); `npm test` 87/87; lint clean; `node --check` all files; full e2e passed |
| 1.19.1 | Night 6 (`npm run evaluate`, offline spectrograms and features; files not committed): ignored sounds had `lowRiseDb`/`onsetJumpDb` = null; the hum's readings were 46–55 Hz (median 50.0) and the findings said "motor or fan". Report-format test: ignored sounds now keep a numeric `lowRise`, and `onsetJump` unless too long (fails on the old `js/stats.js`). Noise test: readings scattered around 50 Hz like night 6 are mains hum, a tone near 54 Hz is not. Night 6 findings now say mains hum; night 5 still "a motor or fan" at 70–83 Hz | old code: the changed report-format test fails; `npm test` 87/87; lint clean; `node --check` all files; full e2e passed |
| 1.20.0 | Night 6 clips: rise of the snore band over the quarter second before, per ~43 ms frames as the detector measures it: Normal's confirmed snores median 12.7 dB (night 5: 17.4), auto's test clips 3.5 (2.5); at 6 dB Normal keeps 78 % (92 %), test clips pass 18 % (12 %). Simulated rooms, auto today vs with 6 dB over 0.25 / 0.5 / 1 s (5 seeds): unchanged except deep rumble 175 → 109 / 131 / 163 of 210 and hum swells 111 → 103 / 111 / 111 of 140; no false snores anywhere; a simulated flickering room (±3–6 dB) gave auto no false snores either. New detector test: snores rise > 20 dB over each window, a slow swell less over 0.25 s, the history is cleared at an interruption, the rule uses the chosen window and gives no verdict without a measurement. New evaluator test: re-count with another window or limit from snores and set-aside sounds, across a gap. Recorder: auto options include `minPreRiseDb: 6, preRiseSec: 1`, `setAside` handed over. Data file: `preRise25/50/100Db` per sound, `setAside` fields. E2E: the auto test's new rule and `setAside` in the JSON, `preRise100Db` per snore | old code: the new and changed tests fail; `npm test` 89/89; lint clean; `node --check` all files; full e2e passed |
| 1.21.0 | ESC-50 (`33c8ce9`, faded clips), Low without → with the 6 dB rule: snoring 30/40 → 30/40 (confirmed 12 → 12), night sounds 73 → 70 (19 → 17), other sounds 132 → 126; High: snoring 29 → 27 (11 → 8), night sounds 120 → 74 (25 → 13). Simulated rooms (5 seeds), Low without → with: still 183 → 183/210, gusty 210 → 210, hum swells 64 → 56/140 with false snores 127 → 0, others unchanged; High: quiet snorer 49 → 43/210, deep rumble 135 → 129 with false 42 → 0, hum swells 110 → 107 with false 128 → 0; High with 3 or 4.5 dB kept every quiet snore and removed the false ones. New detector test: Low counts ≥ 6 hum swells without the rule and none with its own; `breathRuleDb` Low 6; High still does not check. Share test: the report explains the rule on Low | old code: the new Low test and changed checks fail; `npm test` 90/90; lint clean; `node --check` all files; full e2e passed |
| 1.22.0 | New recorder test (quiet bedroom, High finds 9 snores Normal misses, breath noise 5.8–8.7 dB): with no cap the High test keeps a clip for exactly those in the 3–6 dB band (and none outside it), none when switched off; the knock test keeps no audio; the auto sample is unchanged. Recorder: background tests `knock`, `auto`, `high` (High, `minBreathRiseDb: null`). New evaluator test: the High test re-counted with 3 / 4.5 / 6 dB from its stored snores (4 / 2 / 0 confirmed). E2E: `high` locked to High while recording, in the JSON without a breath rule, named in the report note | old code: the new and changed tests fail; `npm test` 92/92; lint clean; `node --check` all files; full e2e passed |
