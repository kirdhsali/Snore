# Snorewatch

Record and analyze snoring in the browser. One button starts and stops the
recording; while it runs you see a live loudness strip with snores highlighted,
live statistics, and each extracted snore as a waveform. When you stop, you get
a report.

**Only snores are kept.** Audio is analyzed on the device and never uploaded.
Sounds that are not snores (talking, knocking, traffic, coughs) are discarded
within a few seconds; only snore clips stay in memory until you close the page.

No build step and no runtime dependencies: plain HTML, CSS and JavaScript.

## Try it

| Way | How |
| --- | --- |
| Quickest | Open `index.html` in Chrome/Edge/Firefox, choose **Demo night**, tap **Start**. |
| With your microphone | `npm start`, then open <http://localhost:8080>. Microphones need https or localhost. |
| On your phone | Open <https://kirdhsali.github.io/Snore/> (GitHub Pages, see below). |

### Three test sources

- **Microphone** – the real thing. Put the device within 1–2 m of your head and
  plug it in. The screen is kept awake while recording.
- **Demo night** – a 90-second simulated night: 16 snores mixed with talking,
  knocking, a passing car and a cough. The report should show 16 snores and 5
  ignored sounds.
- **Audio file** – analyzes any recording in real time (e.g. a snoring clip from
  the internet, or `samples/snore-demo.wav`).

To test the real microphone path without snoring: play
`samples/snore-demo.wav` from your phone next to the computer while recording
with **Microphone**.

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
- snoring episodes (3+ snores less than a minute apart)
- the 8 loudest snores to listen to
- downloads: all snores as one `.wav` (volume evened out per clip so quiet
  snores are audible), all data as `.json` (each snore's position in the WAV as
  `wavStartSec`; ignored sounds with their features but no audio); copy a text summary

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
3. Each finished event is classified. A **snore** is one smooth burst of
   0.25–4 s with ≥ 55 % of its energy below 800 Hz, ≤ 20 % between 1–4 kHz, and a
   centroid under 1 kHz. Otherwise it is ignored as *too short* (clicks, knocks),
   *too long* (traffic, music, fans switching on), *too bright* (speech, coughs),
   *not low enough*, or *choppy* (several bursts: syllables, knocking).
4. Only snores keep their audio (downsampled to 8 kHz, 16-bit). A rolling buffer
   of a few seconds exists only to capture the start of a snore and is
   continuously overwritten.

This is a heuristic, not a trained model. If it misses your snoring, raise the
sensitivity; if it counts other things, lower it.

**Not a medical device.** It cannot detect sleep apnea. If you stop breathing at
night, wake up gasping or are very tired during the day, see a doctor.

## Development

```bash
npm test            # unit tests for detector + stats (Node ≥ 18, no install needed)
npm install         # only for the browser test
npx playwright install chromium
npm run test:e2e    # real page in Chromium with a fake microphone playing the demo night
npm run sample      # regenerate samples/snore-demo.wav
npm run build       # dist/snorewatch.html: everything inlined into one file
npm start           # local server on http://localhost:8080 (PORT to change)
```

| File | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | page and styles (dark by default for night use) |
| `js/detector.js` | FFT, features, snore detector, session statistics, WAV encoder |
| `js/synth.js` | synthetic snores and distractor sounds for demo mode and tests |
| `js/charts.js` | canvas drawing for the live strip, timeline and waveforms |
| `js/app.js` | audio input (microphone / demo / file), live view and report |
| `tests/` | unit tests (`node --test`) and the browser test |

### How changes are made

- `main` is the live version: every push to `main` deploys to GitHub Pages.
- Changes are made on a separate branch and go to `main` through a pull
  request. CI (unit tests and the browser test) runs on the pull request; it is
  merged only when CI is green.
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
