# Results: public datasets, automatic labels and YAMNet (October 2026)

Study of 2026-10-05, on Snorewatch 1.22.3 (`main` at `89f0e2e`), detection rules as in
`docs/HANDOVER.md` §3. All figures are aggregates. No audio, recording, per-sound result or
dataset file is in the repository. Every table can be re-run with the scripts named under it
(see [`README.md`](README.md)). Where the scripted re-run differed from the first run, both are
given and the reason is stated. The "auto test" rows describe the automatic-sensitivity
background test, removed from the app in 1.24.0; the scripts no longer run it (check out
`v1.23.0` to re-run those rows; see [`docs/archive/auto-sensitivity.md`](../docs/archive/auto-sensitivity.md)).

**Short version**
- **High should count with the 6 dB breath rule.** Three independent sources agree: APSAA
  (32 nights), PSG-Audio (6 nights) and the owner's night 4. Sounds that High accepts with only
  3–6 dB of breath noise are at or below chance level for snoring. With 6 dB, High is about as
  precise as Normal.
- **Normal works well when someone clearly snores.** On 5 of 6 PSG-Audio nights, 96–100% of its
  confirmed snores are the sleeper's own sound (chance 27–56%). It is weak on light snoring in a
  noisy room (PSG night 999, and APSAA's 4 kHz recordings).
- **The pitch limit (centroid ≤ 500 Hz) is a built-in bias.** It is the main reason
  higher-pitched snores (children, women, close recordings: Khan) are missed. 800 Hz would find
  about 13 points more of them, with roughly twice as many confirmed false alarms on ESC-50.
- **Labels without listening work** when a second, independent sensor is recorded at the same
  time: the throat microphone ("own sound") and the snore sensor in PSG-Audio. The owner's
  two-phone idea (one phone near, one far) uses the same principle.
- **YAMNet** (pretrained AI, Apache 2.0) is best as a **second opinion**, not as the sole judge:
  - Where Normal and YAMNet agree, 98.6–100% of sounds are the sleeper's own on PSG-Audio.
  - As the sole judge it also counts breathing.
  - It is excellent against knocks and other clearly different sounds.
  - It needs the sound above 2 kHz, and it judges absolute level, so each sound must be turned
    up first.

## 1. Methods in brief

- **Rule variants:** each runs as its own full detector pass over the audio:
  - Normal, Low;
  - High without the breath rule (today's High), and High with 3 / 4.5 / 6 dB;
  - the knock and auto background tests.

  A rule is never re-counted from stored sounds (third review, N2).
- **References:**
  - APSAA: technician-scored snore episodes (from a nasal-cannula snore sensor) and that
    sensor's 10 Hz signal.
  - PSG-Audio: a throat (tracheal) microphone (own sound: ≥ 6 dB above its night median during
    the sound) and a snore sensor (snoring: above its night p95 during the sound).
  - Khan and ESC-50: one human label per clip.
  - The owner's nights: the owner's listening verdicts (time windows, `docs/HANDOVER.md` §8).
- **Chance level:** the same measurement at random moments of the same length. Only the margin
  above chance shows skill.
- **YAMNet:**
  - Each sound is turned up to −20 dBFS (its loudest 50 ms), resampled to 16 kHz and scored in
    0.975 s windows; the "Snoring" score (0–1) is kept.
  - "YAMNet as judge" means: the candidates of the loosest detector (High without the rule),
    accepted when the score is ≥ 0.5, then the app's rhythm confirmation (another accepted sound
    2–12 s away).

## 2. APSAA: 32 hospital nights, 235 h

`research/apsaa/run.sh`. The audio is sampled at 4 kHz (nothing above 2 kHz), so the
"too bright" rule sees only up to 2 kHz. Annotated snoring covers 50.4 h (21.5% of the time).
Audio-to-polygraph offset is estimated per night (median −1.9 s). **Chance:** 27.9% in an
episode, 20.9% with the snore sensor above its p95.

| Rule variant | Confirmed | Per hour | In an episode | Sensor active | Episodes with a snore |
| --- | --- | --- | --- | --- | --- |
| Normal (today) | 82,407 | 351 | 44.4% | 49.6% | 78.4% |
| Low | 78,972 | 336 | 48.3% | 53.6% | 79.7% |
| High, no breath rule (today) | 127,812 | 544 | 31.1% | 34.0% | 81.9% |
| High, 3 dB | 103,146 | 439 | 35.9% | 40.4% | 78.9% |
| High, 4.5 dB | 97,852 | 416 | 37.3% | 42.0% | 78.4% |
| High, 6 dB | 90,914 | 387 | 39.3% | 44.4% | 77.5% |
| knock test | 76,348 | 325 | 44.3% | 49.2% | 74.9% |
| auto test | 79,002 | 336 | 46.6% | 52.9% | 78.8% |

High without the breath rule, confirmed snores by breath noise:

| Breath noise | Sounds | In an episode | Sensor active |
| --- | --- | --- | --- |
| < 3 dB | 22,262 | 11.3% | 5.6% |
| 3–4.5 dB | 5,038 | 8.0% | 7.7% |
| 4.5–6 dB | 6,514 | 11.0% | 9.2% |
| ≥ 6 dB | 93,998 | 38.4% | 43.8% |

- The 3–6 dB band is **below chance** and behaves like the < 3 dB sounds on 29 of 32 nights.
- The result does not change with 5 s tolerance or without the offset correction (summary.js
  prints all four combinations).
- Only "episodes with a snore" favours High without the rule (+4.4 points). That is the cost of
  the 6 dB rule, and it is small.

## 3. PSG-Audio: 6 nights, 25.8 h, automatic labels

`research/psg-audio/run.sh`. Sleep-lab nights of patients with suspected apnoea; room microphone
at 48 kHz about 1 m above the bed. Night 00001024 was left out because the mirror lacks its
third hour.

Each cell: **own sound % / snore sensor %** (sounds per hour).

| | 999 | 1006 | 1014 | 1016 | 1018 | 1026 |
| --- | --- | --- | --- | --- | --- | --- |
| *chance* | *12 / 23* | *44 / 15* | *47 / 13* | *27 / 20* | *55 / 15* | *56 / 19* |
| **Normal (today)** | 30 / 28 (33) | **100 / 87** (127) | **96 / 46** (419) | **98 / 82** (192) | **98 / 41** (497) | **97 / 43** (190) |
| Low | 53 / 48 (10) | – (0) | 100 / 53 (409) | 99 / 92 (92) | 100 / 44 (519) | 99 / 73 (113) |
| High, no rule (today) | 12 / 24 (117) | 89 / 72 (198) | 47 / 18 (761) | 52 / 43 (280) | 50 / 19 (805) | 86 / 35 (188) |
| High, 3 dB | 16 / 27 (70) | 99 / 84 (163) | 80 / 34 (406) | 84 / 70 (150) | 87 / 35 (436) | 91 / 39 (163) |
| High, 4.5 dB | 19 / 30 (49) | 99 / 88 (150) | 90 / 41 (335) | 92 / 77 (133) | 94 / 39 (392) | 92 / 40 (156) |
| **High, 6 dB** | 22 / 29 (34) | **99 / 90** (138) | **95 / 45** (300) | **97 / 83** (118) | **97 / 41** (370) | **95 / 42** (145) |
| YAMNet as judge (≥ 0.5, rhythm) | 51 / 50 (54) | 92 / 55 (373) | 89 / 44 (415) | 73 / 57 (425) | 87 / 37 (669) | 89 / 48 (290) |
| **Normal and YAMNet agree** | 90 / 68 (7) | **100 / 87** (116) | **99 / 52** (346) | **100 / 85** (174) | **100 / 43** (475) | **100 / 62** (82) |
| Normal, YAMNet disagrees | 13 / 17 (26) | 100 / 87 (12) | 81 / 14 (73) | 83 / 47 (18) | 60 / 3 (22) | 94 / 30 (108) |

High without the breath rule, confirmed snores by breath noise, all 6 nights:

| Breath noise | Sounds | Own sound | Snore sensor | YAMNet ≥ 0.5 |
| --- | --- | --- | --- | --- |
| < 3 dB | 3,561 | 4.7% | 1.3% | 4.9% |
| 3–4.5 dB | 653 | 21.3% | 6.4% | 15.8% |
| 4.5–6 dB | 465 | 35.9% | 13.3% | 24.9% |
| ≥ 6 dB | 5,167 | 91.8% | 51.5% | 78.6% |

Reading:
- **Night 999** (light snoring in a noisy room) is where the rules are weak and YAMNet helps most.
- **On the heavy-snoring nights**, YAMNet as sole judge counts 1.3–3 times more than Normal, but
  less precisely: it also calls breathing "snoring". As a **second opinion** it is the most
  precise combination and keeps most of Normal's count.
- "Own sound" is a loose label on heavy-snoring nights (chance 44–56%), so the snore sensor
  column carries more weight there.

## 4. Khan: 500 snoring + 500 other one-second clips (children, women, men)

`node research/khan/evaluate.js`. Each clip is faded into a −80 dBFS room. Results with the clip's
loudest 50 ms at −50 dBFS (Normal).

| | Snoring found | Others counted |
| --- | --- | --- |
| Normal | **62.8%** | **31.6%** |
| High with any breath rule | 62.6% | 31.6% (a clean room has no hum: the breath rule changes nothing) |
| knock test | 58.4% | 31.0% |

At −60 / −66 dBFS Normal finds 62.4% / 58.4% and counts 31.0% / 25.8% of the others. Low finds
nothing at −66 dBFS, because its −65 dBFS gate is above the clip.

- **Missed snores are 183 of 186 "too bright"**, all of them over the 500 Hz pitch (centroid)
  limit; the 1–4 kHz share is over 0.2 for only 61. Snoring centroids are 343 / 425 / 750 Hz
  (p25 / median / p75). ESC-50's snores sit lower, at a median of about 300 Hz.
- **False hits** mostly come from three groups of low, smooth sounds (centroid about 220–320 Hz;
  probably streetcar, rain/thunder and TV news, though the category order is not documented):
  33, 37 and 44 of 50. A one-second cut-out of rumble looks like a snore. In a real night such
  sounds are continuous or longer than 4 s, and the rhythm check stops isolated ones. Single 1 s
  clips cannot test either, so 31.6% is pessimistic.
- **Re-run note:** 378 of the 500 snoring clips are stereo. The first run read the left channel
  only (Normal 56.4% found, centroid median 455 Hz). The scripted re-run mixes both channels to
  mono, as a phone microphone hears. The conclusion is the same.

**What another pitch limit would trade** (Normal; Khan in the quiet room, ESC-50 in its
benchmark room; confirmed in brackets):

| Centroid limit | 500 Hz (today) | 650 Hz | 800 Hz | 1000 Hz |
| --- | --- | --- | --- | --- |
| Khan snoring found | 62.8% | 69.8% | 76.0% | 80.2% |
| Khan others counted | 31.6% | 36.0% | 39.6% | 45.2% |
| ESC-50 snoring | 72.5% (32.5%) | 72.5% (32.5%) | 72.5% (32.5%) | 72.5% (35.0%) |
| ESC-50 night sounds | 7.6% (1.4%) | 9.8% (2.0%) | 11.8% (2.5%) | 13.0% (2.7%) |

This is a counting rule and the owner's decision. It could be trialled as a background test,
or re-counted from the owner's data files, which keep every sound's centroid.

## 5. ESC-50 baseline (`npm run eval:public`, 1.22.3)

The figures are identical to 1.22.0:

| Rules | Snoring clips (confirmed) | Night sounds (confirmed) |
| --- | --- | --- |
| Normal | 29/40 (13) | 76/1000 (13) |
| No breath rule | 30/40 (14) | 100/1000 (22) |
| 3 dB breath rule | 29/40 (13) | 87/1000 (18) |
| knock rule | 28/40 (11) | 50/1000 (8) |

Normal also counts 158/1960 (31) of all other sounds.

## 6. YAMNet on labelled clips

`$SNOREWATCH_DATA/venv/bin/python research/yamnet/clips.py` (clips as recorded) and
`research/yamnet/inroom.sh` (the detector's in-room audio).

- **Sanity check:** YAMNet names ESC-50 categories correctly. For example, toilet flush 39/40,
  thunderstorm 34/40, crying baby 30/40, siren 19/40. ESC-50's snoring is mostly "Breathing"
  as top class, while still scoring high on "Snoring".
- **As recorded, no levelling:**

  | Set | AUC | Score ≥ 0.1: snoring found / others counted | Score ≥ 0.5 |
  | --- | --- | --- | --- |
  | Khan | 0.985 | 88.2% / 0.0% | 72.8% / 0.0% |
  | ESC-50, snoring vs night sounds | 0.998 | 100% / 4.9% | 95.0% / 1.3% |

- **Cut at a frequency** (levelled; score ≥ 0.5):

  | Band | ESC-50 snoring | Khan snoring (first 200 clips) |
  | --- | --- | --- |
  | Full band | 97.5% | 72.5% |
  | Up to 4 kHz | 100% | 68.0% |
  | **Up to 2 kHz** | **5.0%** | **0.0%** |

  APSAA's 4 kHz recordings stop at 2 kHz, so they cannot test YAMNet; its near-zero scores
  there say nothing about the app. The app's saved clips are 8 kHz, keeping sound up to 4 kHz.
- **The same in-room audio as the detector heard:**

  Each cell: snoring found / others counted (Khan: all 500 others; ESC-50: its 40 snoring clips
  against 1,000 night sounds). "Detector" means at least one snore-like sound (Normal).

  | Clip peak | Set | Detector | YAMNet as heard ≥ 0.1 | Levelled ≥ 0.1 | Levelled ≥ 0.3 | Levelled ≥ 0.5 |
  | --- | --- | --- | --- | --- | --- | --- |
  | −50 dBFS | Khan | 62.6 / 31.6 | 91.8 / 4.6 | 95.4 / 37.0 | 92.8 / 14.2 | 91.2 / 8.0 |
  | −50 dBFS | ESC-50 | 72.5 / 7.7 | 92.5 / 9.6 | 100 / 16.9 | 100 / 5.6 | 100 / 2.6 |
  | −60 dBFS | Khan | 62.4 / 31.0 | 61.6 / 3.0 | 93.8 / 12.0 | 89.8 / 3.8 | 85.6 / 1.8 |
  | −60 dBFS | ESC-50 | 75.0 / 6.9 | 62.5 / 3.7 | 100 / 14.8 | 100 / 5.3 | 97.5 / 3.3 |
  | −66 dBFS | Khan | 57.8 / 25.2 | 36.6 / 2.4 | 92.2 / 2.6 | 83.2 / 1.2 | 78.0 / 1.0 |
  | −66 dBFS | ESC-50 | 70.0 / 6.4 | 22.5 / 1.7 | 92.5 / 10.4 | 87.5 / 4.3 | 82.5 / 2.4 |

  ESC-50 night sounds YAMNet scores as snoring (as heard, ≥ 0.1, −50 dBFS): breathing 26 of
  40, vacuum cleaner 18, engine 10, crickets 8, door creaks 7, drinking 6, others ≤ 5.

  - YAMNet judges absolute level. As heard, quiet clips look like silence, and recognition
    collapses below about −60 dBFS.
  - Turned up to a fixed level first, it finds 78–100% of the snoring at every level. At ≥ 0.5 it
    counts 1–8% of the others, against 6–32% for the detector.
  - At a low threshold (≥ 0.1), levelling also raises false alarms: Khan others 37% at −50 dBFS.
    A second opinion needs a threshold of about 0.5.
  - Its main confusion is breathing, which is also the hardest boundary for a snoring app.
  - **Re-run note:** the first, scratch run scored the audio as heard only, with a simpler
    resampler, and read Khan's stereo clips from the left channel. Its figures as heard were
    within a few points: Khan 91.8 / 62.2 / 39.4% found and ESC-50 92.5 / 57.5 / 22.5% at −50 /
    −60 / −66 dBFS. The detector differed only on Khan (56.4% found at −50 dBFS, see §4).

## 7. The owner's nights 4–6 (private files, aggregate results)

`research/own-nights/clips.py`, `compare.py` and `groups.py`, on the owner's downloads in a
private folder. YAMNet only hears the saved clips: 8 kHz, the sound plus 0.4 s, turned up together
with the room noise.

| Comparison with the owner's own judgement | YAMNet | Rules |
| --- | --- | --- |
| Night 5: the 4 loudest counted sounds, which were knocks | all four score **0.00** ("Bouncing", "Wood", "Heartbeat", "Inside, small room") | counted (the knock test caught them) |
| Night 5: auto test clips (59 of 60 not snores by ear) | 13.3% scored ≥ 0.5; separation from confirmed snores AUC 0.78 | – |
| Night 6: auto test clips (room flicker by ear) | 23.3% scored ≥ 0.5; separation from the judged snoring AUC 0.79 | – |
| Night 6: counted sounds in the stretches judged snoring (186) | 54.8% scored ≥ 0.5 | counted |
| Night 4: judged snoring (512 counted sounds) vs hum swells after 07:30 (273), separation (AUC) | **0.68** | **0.94** (breath noise) |
| Night 4: what each filter keeps (judged snoring / hum swells) | ≥ 0.5: 255/512 / 72/273; ≥ 0.1: 358/512 / 105/273 | 6 dB rule: **505/512 / 80/273** |

- On the owner's real snoring, YAMNet on the saved clips is unsure. Only about half the counted
  sounds in real snoring stretches score ≥ 0.5, many of them "Vehicle" or "Roaring cats".
- Against night 4's hum, the 6 dB breath rule is far better.
- The clips (narrow band, very short, room noise turned up with them) may handicap YAMNet.
  PSG-Audio, with full-band context, shows it working much better.

**Grouping without labels** (`groups.py`, k-means on the stored measurements of all sounds,
counted and ignored):
- **Night 4** (2,391 sounds) splits into:
  - two hum groups (centroid 65–68 Hz, breath noise 2.7–3.6 dB, YAMNet median 0.01–0.20,
    mostly 05–08 h);
  - three snoring groups (centroid 102–251 Hz, breath noise 12–23 dB, loud; the strongest has
    YAMNet median 0.80 and sits in the 03:15–03:56 snoring stretch);
  - one bright group of other noises (about 1 kHz).
- **Night 6** separates a hum group (65 Hz, 2.5 dB breath noise, mostly 05–06 h, rarely counted)
  from the main snoring group (122 Hz, 24 dB, rhythm 70%).
- **Night 5** (hotel, no hum) shows a loud snoring group at 06 h (YAMNet median 0.97) and bright
  noise groups.

Naming a group still needs a rule, YAMNet, or a few clips listened to per group.

## 8. Conclusions and decisions

1. **High → 6 dB breath rule:** the owner decided on 2026-10-05, on the evidence of §2, §3 and
   night 4. The only counter-argument was that it costs some of High's quiet snores. On APSAA
   that is 81.9% → 77.5% of episodes found; on the ESC-50 quiet runs 31 → 28 snoring clips. That
   is small against the precision gained.
2. **Normal stays as it is.** It is the most precise rule wherever someone clearly snores.
3. **Pitch limit (500 Hz):** biased against higher-pitched snorers. Open; a background test
   would be needed before any change.
4. **YAMNet** is promising as a second opinion inside the app: a background test first, judging
   the detector's candidates on full-rate audio, with the score stored next to today's verdict.
   It needs a model of about 4 MB and a WebAssembly runtime, which is an exception to "no runtime
   dependencies". It is a separate piece of work for a new session.
5. **Labels without listening:** a two-phone night (one phone near the head, one 2–3 m away)
   would give the owner's bedroom the "own sound or room" label automatically. The first such
   night followed on 2026-10-05/06 (§10).

## 9. Limits

- APSAA and PSG-Audio are sleep-lab nights of patients with suspected apnoea, mostly heavy
  snorers. They are not a quiet bedroom with a phone at the bedside.
- APSAA is 4 kHz.
- PSG-Audio is 6 nights only (one mirror night unusable).
- The automatic labels are themselves imperfect. The throat mic also rises with breathing and
  movement, and the snore sensor misses some snoring.
- Khan and ESC-50 clips are short internet recordings placed in a synthetic room. For YAMNet's
  levelling target and threshold, the values were picked after seeing the clip results, so those
  figures are slightly optimistic.
- The owner's nights are one person; the judgements are time windows, not per-clip labels.

## 10. A two-phone night at home (2026-10-05/06, private files, aggregate results)

`node research/two-phone/compare.js <near.json> <far.json> [labels.json]`, then
`research/own-nights/clips.py` on the near phone's folder for YAMNet. Recorded with 1.23.0, both
phones on Normal, 23:53–06:45 (6.9 h). One phone lay near the owner's head; the other at the foot
end of the bed, "listening to the room".

**How the two phones were matched:**
- **Clock:** the phones' clocks agreed within 0.03 s. Sounds both heard at the start line up
  within 25 ms (23:53:01, 23:53:28, 23:53:38–40). The intended clap at 23:53:19 was handling
  noise at the near phone (−16 dBFS there, −72 dBFS at the far phone).
- **Gain:** in the octave bands 500–4000 Hz, the two backgrounds differ by −0.8 dB (p10/p90 −2.2 /
  3.3), so the microphones are about equally sensitive. The whole background differs by 4.7 dB,
  because the near phone hears a 50 Hz hum all night (63 Hz band +7 dB) and the far phone a
  40–48 Hz motor. The labels use −0.8 dB. The raw differences below do not depend on it.
- **Coverage:** the near phone counted 101 confirmed snores (15/h), the far phone 6 (1/h). The far
  phone heard 230 of the near phone's 881 sounds. On Normal its −75 dBFS gate hides most quiet
  sounds, so "unclear" below mostly means "not heard by the far phone".

**Labels:** a sound is "own" if it is ≥ 6 dB louder at the near phone, or if the far phone would
have heard it as a room sound and did not. It is "room" if it is less than 3 dB louder.

| Near phone's verdict | Sounds | Own | Room | Unclear | Median near − far (raw) |
| --- | --- | --- | --- | --- | --- |
| Confirmed snore | 101 | 50% | 6% | 45% | +7.3 dB |
| Possible snore (not confirmed) | 65 | 55% | 3% | 42% | +11.5 dB |
| Set aside: no breath noise | 102 | 9% | 16% | 75% | −0.1 dB |
| Ignored: rumble | 305 | 18% | 8% | 74% | +3.3 dB |
| Ignored: too long | 105 | 50% | 3% | 47% | +8.8 dB |
| Ignored: too short | 125 | 23% | 5% | 72% | +4.7 dB |
| Ignored: too bright | 25 | 52% | 4% | 44% | +7.6 dB |
| Ignored: choppy | 53 | 28% | 6% | 66% | +10.7 dB |

| Snore-like sounds by breath noise | Sounds | Own | Room | Median near − far (raw) |
| --- | --- | --- | --- | --- |
| < 3 dB | 61 | 11% | 10% | +1.8 dB |
| 3–4.5 dB | 23 | 9% | 22% | +0.4 dB |
| 4.5–6 dB | 18 | 0% | 28% | −0.8 dB |
| ≥ 6 dB | 166 | 52% | 5% | +10.9 dB |

- **The 6 dB breath rule matches the physical label at home.** Sounds with ≥ 6 dB of breath noise
  are about 11 dB louder at the head. Those with 3–6 dB are, in the median, equally loud at both
  phones, as a room sound would be; few are clearly the owner's (0–9%). This is the third
  independent confirmation, after APSAA and PSG-Audio.
- **Normal's count is mostly the owner's own sound, where it can be checked.** Of the confirmed
  snores the two phones could decide, 50 are own and 6 room (89% own).
- **The 6 room-labelled confirmed snores:** one at 04:25 and five between 06:12 and 06:30. They are
  quiet (−68 to −75 dBFS at the near phone, 9–17 dB above the room) and low (centroid 74–139 Hz),
  passed the breath rule, and were equally loud at both phones. Only listening can say whether they
  are a room sound or another sleeper.
- **The auto test's extra snores** (43, not counted by Normal): 23% own, 0% room. 88% were not
  heard by the far phone, so most stay unclear.
- **"Own" is not "snore".** The owner's own sounds also include breathing, movement and speech
  (too long 50% own, too bright 52%). The label says where a sound came from; the detector says
  what it sounds like.

**YAMNet on the near phone's saved clips** (8 kHz, the sound plus 0.4 s), against these labels:

| Label | Clips | YAMNet snoring ≥ 0.5 | Median score | Top classes |
| --- | --- | --- | --- | --- |
| Own | 86 | 28% | 0.02 | "Roaring cats" 24, "Breathing" 21, "Speech" 9, "Snoring" 7 |
| Room | 8 | 75% | 0.94 | "Snoring" 3, "Breathing" 3 |

Separation of own from room (AUC): YAMNet 0.21, breath noise 0.96 (8 room clips only). As on
nights 4–6, YAMNet does not recognise the owner's snoring in the saved clips. Here it even scores the
few room sounds higher. A second opinion in the app would have to judge the full-rate audio, and
this night cannot test that.

**For the next two-phone night:**
- Set the far phone to High (−85 dBFS gate, 5 dB trigger), so that it hears the quiet sounds and
  fewer stay unclear.
- Clap once in the middle of the room, not at the pillow.
- Keep both phones uncovered at about the same height.
