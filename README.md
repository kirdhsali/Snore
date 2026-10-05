# Snorewatch

Record and analyze snoring in the browser. One button starts and stops the
recording; while it runs you see a live loudness strip with snores highlighted,
live statistics, and each extracted snore as a waveform. When you stop, you get
a report.

**Only snore clips are kept.** Audio is analyzed on the device and never uploaded.
Sounds that are not snores (talking, knocking, traffic, coughs) are discarded
within a few seconds; only snore clips stay in memory until you close the page.
A clip includes a moment before and after the snore, so it can contain other
sounds right around it, and a sound the rules mistook for a snore is kept too.

No build step and no runtime dependencies: plain HTML, CSS and JavaScript.

## Try it

| Way | How |
| --- | --- |
| On your phone | Open <https://kirdhsali.github.io/Snore/> (GitHub Pages, see below). |
| On a computer | `npm start`, then open <http://localhost:8080>. Microphones need https or localhost. |
| Demo, no microphone | Add `#demo` to either address, or open `index.html#demo` directly as a file, and tap **Start**. |

## Run from a fresh checkout

Requirements: **Node.js ≥ 18** (CI uses 22) and npm; Git. The app itself has no
dependencies and no build step. The browser test needs Playwright (pinned in
`package-lock.json`) and a Chromium build. There is **no database and no
backend**: all data lives in the browser tab and disappears when it is closed.

```bash
git clone https://github.com/kirdhsali/Snore.git
cd Snore
npm start                        # serves the app on http://localhost:8080
npm test                         # unit tests, no install needed
npm ci                           # installs the dev tools: Playwright, ESLint, Prettier
npm run lint                     # ESLint + Prettier check (Node ≥ 20.19)
npx playwright install chromium  # downloads the browser (needs internet)
npm run test:e2e                 # real page in Chromium with a fake microphone
```

Optional environment variables (examples; none are required):

```bash
PORT=8080                              # port for npm start
HOST=0.0.0.0                           # let other devices reach npm start (default: this computer only)
CHROMIUM_PATH=/path/to/chromium        # use an existing Chromium for npm run test:e2e
ESC50_DIR=/path/to/ESC-50              # existing ESC-50 checkout for npm run eval:public
```

No secrets, API keys or credentials are needed anywhere. `npm start` is a
development server only; it serves the project's own files to this computer.

### Settings outside Git (GitHub repository)

Needed once per repository for deployment; they are not stored in the code:

1. **Settings → General → Default branch:** `main` (only the default branch deploys).
2. **Settings → Pages → Build and deployment → Source:** *GitHub Actions*.
3. **Settings → Environments → `github-pages` → Deployment branches and tags:** allow `main`.
4. **Settings → Actions → General → Workflow permissions:** must allow
   `contents: write` requested by `release.yml` (used to create version tags).
5. **Settings → Rules → Rulesets** (set for this repository): on the default
   branch, require a pull request (0 approvals) and the status check `CI tests`,
   block deletions and force pushes, no bypass list.

The site is then served at `https://<owner>.github.io/<repository>/`.

### Microphone and demo

- **Microphone** (default): the real thing. Put the device within 1–2 m of your
  head and plug it in. A web page cannot record with the screen off (iOS stops
  the microphone), so the screen is kept awake but turns black after 20 s
  without touch (night screen: black pixels are off on OLED displays; a dim
  clock and snore count drift slightly to avoid burn-in). A tap shows the app
  again; it never triggers the buttons underneath. Drawing pauses while dark,
  detection keeps running.
- **Demo night**: add `#demo` to the address
  (<https://kirdhsali.github.io/Snore/#demo>). It plays a 90-second simulated
  night through the speakers: 16 snores mixed with talking, knocking, a passing
  car and a cough. The report should show 16 snores and 5 ignored sounds. A
  “Demo” label marks this mode; it is meant for showing the app or checking it
  during the day.

To test the real microphone path without snoring, play
`samples/snore-demo.wav` from another device next to the microphone, or just
fake a few snores.

### Before you sleep (iPhone)

A web page can only listen while the phone stays unlocked and the page stays in
front, so the start screen shows this checklist:

1. Plug in the charger (the screen stays on all night).
2. Turn Low Power Mode off (it locks the screen after 30 s, which stops the recording).
3. Turn the brightness down; switch on Do Not Disturb or Sleep focus.
4. Tap Start, put the phone within 1–2 m of your head; don't press the side button or switch apps.
5. If the phone locks anyway: Settings → Display & Brightness → Auto-Lock → Never for the night.
6. In the morning, tap the black screen, then Stop.

## What you get

Live, while recording:
- status: measuring room noise / listening / sound heard / snore detected / ignored (with reason)
- loudness of the last 30 s, snores in orange, ignored sounds in grey, trigger level as a line
- recording time, snores, snores per hour, snoring time and %, loudest snore, ignored sounds
- snores over time (per 5 s … per hour, depending on length)
- the latest extracted snores as waveforms (tap to listen)

Report, after Stop:
- summary sentence and key figures
- snores over time, loudness classes (light / moderate / loud above room noise)
- ignored sounds by reason
- **room noise** (since 1.19.0): plain findings about the room (from 10 minutes of
  recording) and a heatmap. The findings cover a steady low tone (mains hum or a motor),
  a device switching on and off, a steady or restless sound in the middle and high pitches
  outside the snoring minutes, and stretches loud enough to hide quiet snores. In the
  heatmap each row is an octave band, shaded by how far it rose above its own quiet level
  (full colour at 15 dB), with the overall level and the snores under it. It uses levels
  per minute only; no sound of the room is kept
- snoring episodes (3+ snores less than a minute apart)
- the 8 loudest snores to listen to
- **Share this night**: an image of the night as a star map (1080 × 1350 PNG;
  each snore a dot by time and loudness) and the **full report** as one HTML
  file with charts, the room noise and the 8 loudest + 5 random snores to play. The report has
  no scripts, works offline in any browser (on iPhone: “Open in Safari”). On
  phones both open the share sheet; elsewhere they download.
- downloads: all snores as one `.wav` (volume evened out per clip so quiet
  snores are audible), all data as `.json` (each snore's position in the WAV as
  `wavStartSec`; ignored sounds with their features but no audio); copy a text summary.
  The JSON also holds the **room noise per minute** under `noise` (since 1.15.0): the
  usual background level, the quietest and loudest moments, octave bands from 31.5 Hz
  and the strongest low tone (a mains hum or a fan), all as levels, never as sound.
  When the background tests heard snores the counting detector did not, a random sample
  can be downloaded as **test clips** (`.wav`) to check by ear: up to 60 from the
  automatic-sensitivity test and (since 1.22.0) up to 30 from the High test, only those
  with 3–6 dB of breath noise. The JSON gives their place as `wavStartSec` under
  `shadows.auto.snores` and `shadows.high.snores`

## How detection works

`js/detector.js` (pure JS, also runs in Node):

1. Audio is cut into ~40 ms frames. For each frame: loudness (dBFS) and, via
   FFT, the share of energy below 800 Hz, the share between 1 and 4 kHz, the
   spectral centroid.
2. An adaptive noise floor follows the room's background level. A sound event
   starts when a frame is louder than the floor by the trigger margin and also
   above an absolute minimum level, and ends after 0.2 s back near the floor:

   | Sensitivity | Margin above room noise | Minimum level |
   | --- | --- | --- |
   | Low (noisy room) | 12 dB | −65 dBFS |
   | Normal | 8 dB | −75 dBFS |
   | High (quiet snorer or quiet room) | 5 dB | −85 dBFS |

   Phones record a quiet bedroom at about −80 dBFS, so in a quiet room the
   minimum level is often what decides; use High there.
3. Each finished event is classified. A **snore** is a burst of 0.25–4 s with
   ≥ 55 % of its energy below 800 Hz, ≤ 20 % between 1–4 kHz and a centroid
   under 500 Hz. Otherwise it is ignored as *too short* (clicks, knocks),
   *too long* (traffic, music, fans switching on), *deep rumble* (more than 85 %
   of the energy below 60 Hz: trucks, the building, heating), *too bright*
   (speech, coughs), *not low enough*, or *choppy* (several bursts: syllables,
   knocking).
   **Breathing rhythm:** real snores often rattle and break into several
   bursts. A choppy sound still counts when it is clearly snore-like (almost
   nothing above 1 kHz, centroid under 400 Hz, sustained rather than separate
   thuds) and a snore accepted on its own lies 2–12 s before or after it. It
   waits up to 12 s for that snore; rescued snores do not anchor further rescues.
   **Breath noise (Normal since 1.17.0, Low since 1.21.0):** a snore is air rushing through a
   narrowed throat, so the 150–1500 Hz band rises above the room noise. Every
   sound gets `breathRiseDb`; on Normal a snore needs at least 6 dB, so deep
   hums, rumble and machinery without breath noise are ignored as “no breath
   noise”. It ran as a background test on two real nights first: in night 4
   swells of a room hum (3–6 dB of breath noise) confirmed each other as snores
   (961 confirmed without the rule, 661 with it: 214 of the 300 dropped after
   07:30, where the clips held no snore, while the clear snoring stretches kept
   499 of 510); in night 5 it changed 76 to 73; in night 6, its first night
   counting, 290 to 223, setting aside quiet sounds of about 72 Hz. **Low** checks it
   too since 1.21.0: it lost no snore in ESC-50 (30/40 either way) or in simulated
   rooms except where hum swells sat between snores (64 → 56 of 140 found, but 127
   false snores → 0). **High** does not check it: there it would also cost quiet
   snores (ESC-50 snoring clips 29 → 27, confirmed 11 → 8; a simulated quiet snorer
   49 → 43 of 210) while removing many false ones (night sounds 120 → 74 of 1000).
   **Automatic sensitivity (testing in the background):** every 30 s it measures
   how much quiet half-second stretches fluctuate above the room noise and sets
   its margins from that: 5 dB in a still room, up to 14 dB when restless (fan,
   wind, rain), at most 2 dB change per step, capped at 9 dB in a very quiet
   room (floor below −78 dBFS) where flicker is not restlessness. A sound ends
   only once the level is back within the room's usual quiet range (since 1.13.1:
   a wavering hum keeps that range a few dB above the quietest moments). Its
   absolute gate only guards against silence (−95 dBFS). Because its margins are
   small, a sound must also raise the snore band (50–800 Hz) at least 8 dB above
   that band's own room noise (since 1.16.0): in a quiet room with a motor's low
   tone, quiet breathing otherwise passed as snoring. Since 1.20.0 a sound must also
   rise 6 dB above **the moment before it** (the median of the snore band over the
   second before the sound): at home (night 6) auto still counted the room's own
   flicker, about 2–3 dB above the moment before, while real snores rose 13–22 dB.
   Every sound gets this rise over 0.25, 0.5 and 1 s (`preRise25Db`, `preRise50Db`,
   `preRise100Db`); the auto test also hands over the sounds this rule set aside, so
   `npm run evaluate` can re-count the night with each window and with 4, 6 or 8 dB.
   **Sudden start (testing in the background, since 1.18.0):** a knock or a bump
   reaches its full level at once and dies away; a snore swells with the breath.
   Every sound gets `onsetJumpDb`, the largest rise over 20 ms at its start (from
   the downsampled audio, 20 ms windows every 10 ms). The test ignores sounds
   above 20 dB as “sudden start”. In night 5 four knocks passed every rule and
   confirmed each other (21–42 dB); real snores of nights 4 and 5 rose at most
   23 dB (99 % under 17); the rule would have dropped 2 of night 4's 955.
   The app runs three extra detectors on the same audio: **knock** (chosen
   sensitivity + sudden-start rule 20 dB), **auto** (automatic sensitivity +
   3 dB breath rule + 8 dB snore-band rule + 6 dB over the second before) and,
   since 1.22.0, **high** (High sensitivity without the breath rule: would a gentler
   rule of 3–4.5 dB suit High's quiet snorers better than 6 dB?). Every sound also
   gets `lowRiseDb` in the JSON. Their counts, margins and snore times go into the
   JSON under `shadows`, the report shows one line, and `npm run evaluate` compares
   them with the recorded result (and re-counts auto and high with stricter breath
   rules from their stored sounds: 4.5 / 6 dB and 3 / 4.5 / 6 dB). Since 1.22.1 each
   test stores every feature of its sounds and its choppy sounds no snore rescued, so
   these re-counts run the same rules and rhythm rescue as live; for older files they
   are marked approximate (a rattle could stay counted after the snore that rescued it
   dropped out). Auto and high keep audio for the test clips described above. The
   breath-rule background tests of 1.13–1.16 (**breath**, 3 dB; **breath6**, 6 dB)
   ended when Normal took the rule over; `npm run evaluate` shows any night with
   and without the rule from the stored sounds.
   **Confirmed snores:** snores come in runs with the breathing. The figures,
   charts and share outputs count a snore only when another snore lies 2–12 s
   before or after it. Isolated snore-like sounds (a footstep, a door, a single
   cough) are listed as “possible” and not counted.
4. Only sounds classified as snores keep their audio (downsampled to 8 kHz, 16-bit): the
   counting detector's snores, plus at most 60 test clips of snores only the automatic-
   sensitivity background test heard and at most 30 of the High test's (3–6 dB of breath
   noise). A rolling buffer
   of a few seconds exists only to capture the start of a snore; it is
   continuously overwritten and wiped when the recording stops.

### Checked against public data

`npm run eval:public` runs the detector on [ESC-50](https://github.com/karolpiczak/ESC-50)
(CC BY-NC; downloaded for testing only, never committed). Each 5-second clip is
placed in quiet room noise at bedside level, faded in and out over 0.1 s (since 1.18: the
clips often start mid-sound, which looked like a knock). Results for version 1.18 (Normal
with the 6 dB breath-noise rule):

| | any snore-like sound | confirmed snore |
| --- | --- | --- |
| snoring clips recognised | 29/40 (72.5 %) | 13/40 (32.5 %)* |
| night sounds counted as snore (25 classes) | 76/1000 (7.6 %) | 13/1000 (1.3 %) |
| … without the breath-noise rule (Normal before 1.17, Low before 1.21; High) | 100/1000 (10.0 %) | 22/1000 (2.2 %); snoring 30/40, 14 confirmed |
| … with a 3 dB breath-noise rule | 87/1000 (8.7 %) | 18/1000 (1.8 %); snoring 29/40, 13 confirmed |
| … with the sudden-start rule (knock background test) | 50/1000 (5.0 %) | 8/1000 (0.8 %); snoring 28/40, 11 confirmed |

\* Confirmation needs a second snore 2–12 s away inside the same 5-second
clip, which most clips do not contain; over a real night snores come in runs,
so nearly all are confirmed. Missed snoring clips are mostly brighter
(mouth) snores recorded close up.

This is a heuristic, not a trained model. If it misses your snoring, raise the
sensitivity; if it counts other things, lower it.

**Not a medical device.** It cannot detect sleep apnea. If you stop breathing at
night, wake up gasping or are very tired during the day, see a doctor.

## Development

```bash
npm test            # unit tests (Node ≥ 18, no install needed)
npm ci              # dev tools for the browser test and linting (pinned in package-lock.json)
npm run lint        # ESLint + Prettier check (Node ≥ 20.19); npm run format fixes formatting
npx playwright install chromium
npm run test:e2e    # real page in Chromium with a fake microphone playing the demo night
npm run sample      # regenerate samples/snore-demo.wav
npm run build       # dist/snorewatch.html: everything inlined into one file
npm run evaluate -- snore-report.json   # re-evaluate a downloaded night with the current rules
npm run eval:public # check against ESC-50, a public set of 2,000 labelled sounds (downloads ~600 MB once)
npm start           # local server on http://localhost:8080 (PORT to change)
for f in js/*.js scripts/*.js tests/*.js; do node --check "$f"; done   # syntax check
```

ESLint (correctness rules) and Prettier (JavaScript only) run in CI; there is no
type checker. Agent instructions: `CLAUDE.md` / `AGENTS.md`; general working rules:
`docs/WORKING-RULES.md`.

| File | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | page and styles (dark by default for night use) |
| `js/detector.js` | FFT, features, snore detector, rhythm rule; one entry point (`SnoreCore`) that also exports the two below |
| `js/stats.js` | session statistics: confirmed snores, episodes, intervals, timeline |
| `js/wav.js` | WAV encoder and clip loudness |
| `js/noise.js` | room noise per minute: background level, octave bands, the strongest low tone (numbers only) |
| `js/synth.js` | synthetic snores and distractor sounds for demo mode and tests |
| `js/charts.js` | canvas drawing for the live strip, timeline and waveforms |
| `js/share.js` | share image (star map), the self-contained report file and the room-noise heatmap (SVG) |
| `js/version.js` | version shown in the footer |
| `js/recorder.js` | recording: microphone or `#demo`, detectors and background tests, interruptions, wake lock, the finished night |
| `js/report-format.js` | the downloaded data file (JSON), writing and reading every version |
| `js/night-store.js` | interface for saving nights on the device (not used by the page yet) |
| `js/app.js` | the page: live view, night screen, report, sharing, downloads |
| `scripts/` | dev server, evaluation scripts, sample generator, single-file build |
| `tests/` | unit tests (`node --test`) and the browser test |
| `docs/HANDOVER.md` | state of the project, decisions, known issues, next task |
| `docs/VERIFICATION.md` | verification commands, results and a manual smoke test |
| `docs/REVIEW-RESPONSE.md` | answer to the review of v1.9.1, finding by finding |
| `docs/review-probes/` | scripts that re-run the review's checks and the full demo night (see `docs/VERIFICATION.md`) |

### How changes are made

- `main` is the live version: every push to `main` deploys to GitHub Pages.
- Changes are made on a separate branch and go to `main` through a pull
  request. CI (unit tests, lint and the browser test, check `CI tests`) runs on the
  pull request; it is merged only when CI is green.
- To go back, revert the pull request's merge commit on `main`; the older
  version is redeployed automatically. Every released version is also tagged.

### Versions

The footer shows `Snorewatch <version> (<build>)`. Bump the version in both
`package.json` and `js/version.js` (a test checks they match). On GitHub Pages
the build is the short commit hash, and script URLs carry it too, so a phone
loads the new code right after a deploy; locally it shows `dev`.
When a new version reaches `main`, `.github/workflows/release.yml` tags it
(`v1.2.0`, …) and creates a GitHub release.

### GitHub Pages

`.github/workflows/pages.yml` deploys on every push to the default branch. Enable it once
under **Settings → Pages → Source: GitHub Actions**. Pages is served over https,
so the microphone works on phones too.
