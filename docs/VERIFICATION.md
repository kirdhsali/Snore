# Verification record

The latest checkpoints, newest first, and a manual smoke test. Older checkpoints (1.23.0 back to
1.9.1) are in [`archive/verification-history.md`](archive/verification-history.md).

## Checkpoint 1.25.0 (detector specification for the Swift port, 2026-10-08)

**Tested code revision:** the PR branch of 1.25.0 on top of `main` (`4b2aa8e`, 1.24.1). **No
counting change.** What the port to a native iPhone app needs (owner, 2026-10-08):
- `docs/DETECTOR.md`: the detector's specification, with how a port checks itself.
- `js/analysis.js`: the night's analysis (counting detector with room noise, the knock test, their
  statistics), moved out of `js/recorder.js`. `wavPositions` moved to `js/wav.js`.
- `npm run analyze`: a WAV file through it, writing the data file and the snores WAV.
- `npm run reference` with `tests/fixtures/reference/`: the data files of four seeded synthetic
  nights, which `tests/reference.test.js` checks and a port compares itself with.

**Environment:** as for 1.24.0.

| Command | Result |
| --- | --- |
| `npm test` | **passed**, 96/96: 84 + 5 `analyze` (WAV reading, demo night, clip positions, block sizes, CLI) + 5 `reference` (four nights, coverage of every reason) + 1 recorder test (the recorder's night equals `npm run analyze` on the same audio) + 1 detector test (the counting constants as `docs/DETECTOR.md` gives them) |
| `npm run lint` | **passed** |
| `node --check` over `js/ scripts/ tests/ docs/review-probes/ research/` (`*.js`, `*.cjs`) | **passed**, 43 files |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed** |
| `CHROMIUM_PATH=… node docs/review-probes/full-demo-run.cjs "$PWD" <out>` | **passed**: "1.25.0 (dev)", 16 confirmed, 0 possible, 5 ignored (too bright 3, choppy 1, too long 1); knock 16; no page errors (the two console errors, an external font and a 404, as at 1.24.1) |
| Recorder of v1.24.1 against this checkout, fake browser (scratch script): 10 synthetic nights (demo and 4 rooms, at 16 and 48 kHz) × Low / Normal / High × without and with two interruptions (suspended 3 s, stalled 2.5 s) | **identical**: 60 night records, 1,797 sounds, every field of the night record and the data file, every live frame and event callback. A changed knock rule in a copy is caught at once |
| Reference outputs against threshold changes (scratch script, each on its own) | Caught: centroid limit 450/550, low share 0.5/0.6, high share 0.15/0.25, rumble 0.8/0.9, breath rule 5/7 dB, choppy 3 bursts, too short 0.3 s, too long 3.5 s, rhythm fill 0.7, hangover 0.25 s, pre-roll 0.3 s, burst drop 6.5 dB. Not caught: centroid 498 Hz, low share 0.545: no sound lies that close to the limit. So a new detector test pins every counting constant |
| Independent review of `docs/DETECTOR.md` against the code (subagent, every claim and number) | no formula or constant wrong. One false statement: clip samples can be negative, so `Math.round` and Swift's `rounded()` differ (§13). It also found 16 places that were imprecise or missing (FFT scale, exclusive clip end, `rms·rms`, the gap clock, ms truncation, …). All corrected |
| `npm run reference` on Node 20.20, 21.7 and 22.22 | **same** files on all three (the stored outputs do not depend on the Node version) |
| `npm run evaluate` on `tests/fixtures/reference/busy-hum-48000.json` | reads it (`source: "file"`), recorded = current rules |
| `npm run eval:public` | **identical to 1.24.1** |

**Not run / not available:** physical iPhone, Safari/WebKit, Firefox; a real night on 1.25.0; a
port (none exists yet).

## Checkpoint 1.24.1 (cleanup for the Swift port, 2026-10-08)

**Tested code revision:** the PR branch of 1.24.1 on top of `main` (`b5d0bd6`). **No counting
change.** After a code review for the port to a native iPhone app (owner, 2026-10-08):
- Removed:
  - the detector's unused zero-crossing rate, mean level, `floorDb`, event `id`, `calibrating`
    getter and `setSensitivity`;
  - the embed mode and the single-file build (`scripts/build-standalone.js`, `npm run build`);
  - the committed demo WAV (no longer deployed; `npm run sample` writes it locally);
  - `js/night-store.js` and its test.
- Changed:
  - one `percentile` (in `js/stats.js`);
  - one breath-rule constant (`BREATH_RULE_DB`) instead of one per sensitivity;
  - the room-noise profile is fed the frame's power spectrum instead of the FFT arrays;
  - frames carry the night's clock like events, which fixes the live pill after an interruption.

**Environment:** as for 1.24.0.

| Command | Result |
| --- | --- |
| `npm test` | **passed**, 84/84 (89 at 1.24.0 minus the 5 night-store tests). The breath-rule test also checks the single constant; the interruption test also checks that frames and events share one clock. Both fail on 1.24.0's code |
| `npm run lint` | **passed** |
| `node --check` over `js/ scripts/ tests/ docs/review-probes/ research/` (`*.js`, `*.cjs`) | **passed**, 38 files |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed** |
| `CHROMIUM_PATH=… node docs/review-probes/full-demo-run.cjs "$PWD" <out>` | **passed**: "1.24.1 (dev)", 16 confirmed, 0 possible, 5 ignored (too bright 3, choppy 1, too long 1); knock 16; no page errors |
| Counting detector of v1.24.0 against this checkout (scratch script): 2 demo nights (48 and 16 kHz) and 8 synthetic rooms × Low / Normal / High, and × the knock rule, the breath rule off, 3 dB and High's own | **identical**: 998 and 1,590 sounds, every feature, verdict, confirmation and room-noise minute |
| `npm run evaluate` on the owner's nights 4–7, the far phone of night 7 and the v1.8 and v1.9 fixtures, old against new evaluator | **identical** (0 differing lines) |
| Review probes | C1, C3, C5 and N1 as before; C4 now prints "not applicable from 1.24.1" (night store removed), C6 and N2 as at 1.24.0 |
| `npm run eval:public` | **identical to 1.24.0**: Normal snoring 29/40 (13 confirmed), night sounds 76/1000 (13), other 158/1960 (31); without the breath rule 30/40 (14), 100/1000 (22); 3 dB 29/40 (13), 87/1000 (18) |

**Not run / not available:** physical iPhone, Safari/WebKit, Firefox; a real night on 1.24.1.

## Checkpoint 1.24.0 (automatic sensitivity removed, 2026-10-06)

**Tested code revision:** the PR branch of 1.24.0 on top of `main` (`2421fd5`). **No counting
change.** Owner's decision (preparing the move to an iPhone app):
- Removed: the automatic-sensitivity background test, with its snore-band and moment-before
  rules; the per-sound measurements `lowRiseDb` and `preRise25/50/100Db`; the test-clip
  download.
- Kept: the room-noise check and the knock test.
- Restart log: [`archive/auto-sensitivity.md`](archive/auto-sensitivity.md).

**Environment:** as for 1.23.0 (Node v22.22.0, npm 10.9.4; Chromium 141.0.7390.37 via
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). ESC-50 checkout
`33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6` outside the repository.

| Command | Result |
| --- | --- |
| `npm test` | **passed**, 89/89 (98 at 1.23.0: 9 tests of the removed features gone; the review N2 and 1.22.1 re-count tests now use a 3 dB breath test and the knock test; new: older files' auto section shows its recorded counts only) |
| `npm run lint` | **passed** |
| `node --check` over `js/ scripts/ tests/ docs/review-probes/ research/` (`*.js`, `*.cjs`) | **passed**, 41 files |
| `CHROMIUM_PATH=… npm run test:e2e` | **passed**: one background test (knock), no test-clip button, no `lowRiseDb`/`preRise*Db` in the data file, room-noise panel as before |
| `CHROMIUM_PATH=… node docs/review-probes/full-demo-run.cjs "$PWD" <out>` | **passed**: "1.24.0 (dev)", 16 confirmed, 0 possible, 5 ignored (too bright 3, choppy 1, too long 1); background test knock 16; JSON 20,118 bytes (36,001 at 1.23.0); no page errors |
| Counting detector of v1.23.0 against this checkout (scratch script): 2 demo nights (48 and 16 kHz) and 8 synthetic rooms (hum, deep rumble, gusts, plain; breaths and knocks) × Low / Normal / High | **identical**: 998 sounds, every feature, verdict, confirmation and room-noise minute |
| `npm run evaluate` on the owner's nights 4–7 and the far phone of night 7, old against new evaluator | **identical** except each file's auto section, which now reads "recorded counts only" |
| `node docs/review-probes/controller-store-probes.cjs` / `noise-evaluator-probes.cjs` | C1, C3, C4, C5 and N1 as before; C6 and N2 print "not applicable from 1.24.0" (they used the automatic-sensitivity test; run them against a checkout up to 1.23.0) |
| `node research/khan/evaluate.js` | **identical** to its rerun on 1.23.0 apart from the three removed "auto" rows (Normal 62.8 % snoring found, 31.6 % others at −50 dBFS) |
| `npm run eval:public` | **identical to 1.23.0**: Normal snoring 29/40 (13 confirmed), night sounds 76/1000 (13), other 158/1960 (31); without the breath rule 30/40 (14), 100/1000 (22); 3 dB 29/40 (13), 87/1000 (18) |

**Not run / not available:** physical iPhone, Safari/WebKit, Firefox; a real night on 1.24.0.

## Manual smoke test (synthetic data only)

1. **Start screen.** Open the app (`npm start` → `http://localhost:8080`, or the Pages URL).
   Expect: Start button, Sensitivity *Normal*, "Before you sleep" checklist, footer
   `Snorewatch <version> (dev)` locally or `(<commit>)` on Pages.
2. **Demo night.** Open `/#demo`. Expect a *Demo* label. Tap Start and wait 90 s (or
   tap Stop). Expect orange bars in the live strip and clip cards; at the end the
   verdict reads "16 snores …" and "5 other sounds were ignored"; the background
   line shows 16 for the knock test.
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
   `ignored[]`, `noise`, `shadows.knock`. "Download snores (.wav)": plays.
   `npm run evaluate -- <file>.json` prints the comparison table. `npm run analyze` on
   `samples/snore-demo.wav` (`npm run sample`) gives 16 confirmed snores and 5 ignored sounds.
7. **Share.** "Share image": PNG 1080 × 1350 star map. "Share full report": one
   HTML file without scripts; for the demo it holds 13 playable snores (8 loudest
   + 5 random) and opens offline.
8. **Permission denied.** Block the microphone and tap Start. Expect the red message
   "Microphone access was blocked …".
9. **Darken screen and interruptions (phone).** While recording, "Darken screen"
   sits under Stop and does not move. Receive a call or invoke Siri: expect
   "Recording interrupted …", then automatic resume; the report says "interrupted 1×"
   and the JSON lists the gap. **Not yet done on a physical iPhone.**
