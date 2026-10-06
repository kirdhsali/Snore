# Research: datasets, automatic labels and an AI second opinion

Tools for testing Snorewatch's detection outside the app: public sleep datasets, your own nights,
and YAMNet, a pretrained sound classifier. Nothing here is part of the app. The page still loads
no AI and has no dependencies. The results of the October 2026 study are in
[`RESULTS.md`](RESULTS.md).

**Data never goes into the repository.** Every script downloads to, and writes its results under,
`$SNOREWATCH_DATA` (default `~/.cache/snorewatch`, next to the ESC-50 checkout of
`npm run eval:public`). Your own nights stay in a private folder there (default
`~/.cache/snorewatch/nights`). Several datasets do not allow redistribution, so never commit
anything derived from them except aggregate figures (see Licences).

## Setup

```bash
npm ci                      # the repository's dev tools (also needed for npm run eval:public)
research/setup.sh           # Python venv in $SNOREWATCH_DATA/venv (numpy, LiteRT) and YAMNet, checksum-checked
npm run eval:public         # ESC-50 (about 600 MB once), also the baseline benchmark
research/khan/fetch.sh      # Khan clips (about 100 MB), pinned commit
```

Needs Node >= 18, Python >= 3.10, `curl`, `unzip`, `git`. In a Claude cloud session, the
environment must allow `zenodo.org`, `huggingface.co`, `us.aws.cdn.hf.co` (Hugging Face's file
host), `registry.npmjs.org` and `pypi.org`.

## What to run

| Command | What it does | Time and data |
| --- | --- | --- |
| `research/apsaa/run.sh [subject ...]` | APSAA, 32 hospital nights (4 kHz audio). Each rule variant runs as its own detector against the technicians' snore episodes and the nasal snore sensor, with the chance level. | 3.9 GB once, about 15 min |
| `research/psg-audio/run.sh [subject ...]` | PSG-Audio, 6 nights (room mic at 48 kHz, throat mic, snore sensor). Runs the rule variants and YAMNet on every candidate sound against two automatic labels: "the sleeper's own sound" from the throat mic and "snoring" from the snore sensor. | 2.5-4.3 GB per night (deleted after use), about 10 min per night |
| `node research/khan/evaluate.js` | Khan's 1 s clips (snoring from children, women and men, plus 10 other sound categories) in a quiet room at 3 levels. Shows why snores are missed and what a higher pitch limit would trade, also on ESC-50. | about 5 min |
| `$SNOREWATCH_DATA/venv/bin/python research/yamnet/clips.py` | YAMNet on the labelled clips as recorded: AUC, thresholds, a sanity check, and band-limiting to 4 and 2 kHz | about 3 min |
| `research/yamnet/inroom.sh` | YAMNet and the detector on exactly the same in-room audio, as heard and turned up to a fixed level | 5 GB temporary, about 15 min |
| `$SNOREWATCH_DATA/venv/bin/python research/own-nights/clips.py [folder]` | YAMNet on every clip of your downloaded nights: the snores WAV and the test-clip WAV, matched to the data file | seconds |
| `$SNOREWATCH_DATA/venv/bin/python research/own-nights/compare.py [folder]` | YAMNet compared with your listening judgements (`judgements.json` in the folder; see `own-nights/judgements.example.json`) and with the breath rule | seconds |
| `$SNOREWATCH_DATA/venv/bin/python research/own-nights/groups.py <stamp> [k] [folder]` | Sorts all sounds of a night into groups and describes each group without labels | seconds |
| `node research/two-phone/compare.js <near.json> <far.json> [labels.json]` | A night recorded with two phones, one near the head and one 2-3 m away: labels every sound of the near phone "own" (at least 6 dB louder there, after a gain correction from the room's background) or "room", per verdict, breath noise, background test and hour | seconds |

For your own nights, put the app's downloads into the folder: `snore-report_<stamp>.json`,
`snores_<stamp>.wav` and `test-clips_<stamp>.wav`. For a two-phone night, record on both phones at once,
clap once near the pillow at the start (it lines the phones up), and keep each phone's downloads in
its own subfolder.

## How the measurements work

- **Each rule variant is its own full detector pass** over the audio, like `scripts/eval-public.js`.
  Stored sounds are never re-counted, because a stricter rule also changes which rattles get
  rescued (third review, N2).
- **Chance level.** Every agreement figure comes with the share that random moments of the same
  length reach. A detector is only better than guessing by the amount it beats that.
- **Automatic labels.** Labels come from independent sensors recorded at the same time, so nobody
  has to listen:
  - APSAA: the technicians' snore episodes, scored from a nasal-cannula snore sensor, and that
    sensor's own signal.
  - PSG-Audio: a throat (tracheal) microphone for "the sleeper's own sound" and a snore sensor for
    "snoring".

  The throat microphone is the near/far principle of a two-phone night: a microphone close to
  the sleeper hears their sounds much louder than room sounds.
- **YAMNet** (`common/yamnet.py`):
  - Each candidate sound, plus 0.2 s either side, is turned up so that its loudest 50 ms sit at
    −20 dBFS. YAMNet judges absolute level, so quiet bedside snores would otherwise look like
    silence.
  - It is resampled to 16 kHz and scored in 0.975 s windows; the "Snoring" class score
    (0 to 1) is kept.
  - It needs the sound above 2 kHz. APSAA's 4 kHz recordings therefore cannot test it.

## Licences and sources

| Source | Licence | Use here |
| --- | --- | --- |
| [APSAA](https://doi.org/10.5281/zenodo.14096541) (Gonzalez-Martinez et al., J. Audio Speech Music Proc. 2025, 24) | Labelled CC BY 4.0, but its description says academic and non-commercial use only, no redistribution, and acknowledge it in publications | Local evaluation; aggregate figures only |
| [PSG-Audio](https://doi.org/10.11922/sciencedb.00345) (Korompili et al. 2021; partial mirror on Hugging Face `dust-systems/psg-audio`) | CC BY 4.0 | Local evaluation; aggregate figures with citation |
| ESC-50 (Piczak 2015) | CC BY-NC | Local evaluation (`npm run eval:public`) |
| Khan snoring dataset (T. H. Khan, Electronics 8 (2019) 987; GitHub mirror `adrianagaler/Snoring-Detection`) | No licence stated | Local testing only |
| YAMNet (Google; TFLite export; class map and ONNX conversion from `audiomagic/yamnet-onnx`) | Apache 2.0 | Measuring instrument; commercial use allowed with licence and attribution |

If the app is ever commercial, none of these datasets may be used to train anything that ships.
The non-commercial ones (APSAA, ESC-50) also conflict with evaluating a commercial product.
