# Verification record

Run on 2026-10-01 for version **1.9.1** (this checkpoint), in a Linux container with
Node v22.22.2, npm 10.9.7, Playwright 1.63.0 (from `package-lock.json`) and a
preinstalled Chromium headless shell passed via `CHROMIUM_PATH`.

## Automated checks

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

## Not run or not available

- **Lint / format / type check:** none configured. An ad-hoc ESLint run with core
  correctness rules (`no-undef`, `no-unused-vars`, `no-unreachable`, …) found only
  6 unused `catch (e)` variables in `js/app.js` and one false positive (`URL` in
  `scripts/serve.js`, a Node global missing from the ad-hoc config).
- **Other browsers:** Safari/WebKit and Firefox are not automated; iPhone behaviour
  is known only from the owner's nights (Safari, iOS).
- **Device checks:** iOS share sheet, iOS clip playback after the v1.2 fix, CPU and
  battery with three detectors (v1.9) over a full night.

## Extra checks made for the handover

- Dev server path handling: `GET /..%2FSnore-probe/probe.txt` returned a file from a
  sibling directory (`Snore-probe`) → known issue, see `docs/HANDOVER.md` §7.
- `file:///…/index.html#demo` in Chromium: AudioWorklet is blocked for `file://`,
  the ScriptProcessor fallback took over and the demo recorded snores.
- `samples/snore-demo.wav` was stale (old synthetic snores; current detector found
  6/16). Regenerated with `npm run sample`; now 16/16 snores, 5 ignored.

## Manual smoke test (synthetic data only)

1. **Start screen.** Open the app (`npm start` → `http://localhost:8080`, or the Pages URL).
   Expect: Start button, Sensitivity *Normal*, "Before you sleep" checklist, footer
   `Snorewatch 1.9.1 (dev)` locally or `(<commit>)` on Pages.
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

## Phase A review fixes

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

## Phase B

| Version | Check | Result |
| --- | --- | --- |
| 1.10.4 | E2E now runs at 390 × 844 (iPhone-sized); samples the "Darken screen" box 12× over 4.8 s while the pill changes (measuring → listening → sound heard) | old layout: two positions (x 247 and 16); new: one position; full e2e passed; \`npm test\` 47/47 |
| 1.10.5 | `npm run lint` (ESLint 10 + Prettier 3.9), detector events on the demo night at 48/44.1/16 kHz × 3 seeds compared field by field with `main` | lint clean; events identical; `npm test` 47/47; full e2e passed; `npm run build` OK |
| 1.11.0 | New `tests/report-format.test.js`: demo night with a 5 s gap through `toReport` → JSON → `fromReport` (events, flags, gap, background test); all fields of a 1.9.1 file still written; 1.8 and 1.9 fixtures (synthetic) read; foreign/newer files refused; re-evaluation does not rescue across a gap. E2E: download has `schemaVersion: 2`. `npm run evaluate` on the 1.9 demo fixture: 16/16 as before | `npm test` 52/52; lint clean; full e2e passed |
