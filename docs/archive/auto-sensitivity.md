# Automatic sensitivity: what was tried (1.8.0–1.23.0), and how to restart it

Removed in 1.24.0 (owner, 2026-10-06), to slim the web app before the move to a native
iPhone app. It never ran as the counting detector, only as a background test (a second
detector on the same audio whose results went into the data file). It never became better
than Normal. This page keeps what is needed to pick it up again.

**Last version with the code:** `v1.23.0` (`496710c`). Restore any file with
`git show v1.23.0:js/detector.js` (or `git checkout v1.23.0 -- <file>` on a branch).

## What it did

A detector whose margins follow the room instead of a fixed sensitivity:

- **Margins from the room's restlessness.** Quiet frames (no sound going on, more than 1 s
  after one) were averaged into 0.5 s blocks. The last 180 s of blocks were kept as levels
  above the noise floor. Every 30 s, with at least 20 s of blocks:
  - usual = median, spread = p90 − median;
  - base = clamp(1.5·spread + 2, 3, maxRelease);
  - release = clamp(max(base, usual + spread + 1), 3, maxRelease);
  - trigger = clamp(max(base + 2 + spread, release + 1), 5, maxTrigger);
  - limits: release 3–7 dB, trigger 5–14 dB; in a very quiet room (floor below −78 dBFS),
    release ≤ 7 and trigger ≤ 9 dB;
  - each update moved the margins by at most 2 dB, and the trigger always stayed at least
    1 dB above the release.
- It started at 8 / 4 dB like Normal. Its absolute gate only guarded against silence
  (−95 dBFS).
- The margins over the night went into the data file (`shadows.auto.levels`: `t`,
  `triggerDb`, `releaseDb`, `spreadDb`, `floorDb`).
- Options in `js/detector.js` `DEFAULTS`: `autoWindowSec: 180`, `autoUpdateSec: 30`,
  `autoGuardSec: 1`, `autoMinIdleSec: 20`, `autoBlockSec: 0.5`, `autoQuietRoomDb: -78`,
  `autoQuietMaxTriggerDb: 9`. Code: `SnoreDetector._autoCollect`, `SnoreDetector._autoUpdate`,
  `SENSITIVITY.auto = { triggerDb: 8, releaseDb: 4, minAbsDb: -95 }`.

**Extra rules of the background test** (`js/recorder.js`, `shadows.auto.options`): small margins
let quiet room sounds through, so the test added three rules of its own:

1. **Breath noise ≥ 3 dB** (150–1500 Hz above its tracked room noise; Normal uses 6 dB).
2. **Snore band ≥ 8 dB** (1.16.0): the sound's 50–800 Hz level above that band's own
   tracked room noise (`lowRise`, reason `no-low-rise`). Night 5 counted quiet breathing over
   a motor's 70–83 Hz tone without it.
3. **Rise over the moment before ≥ 6 dB over 1 s** (1.20.0): the sound's 50–800 Hz level above
   the median of that band over the 0.25, 0.5 or 1 s before the sound (`preRise25/50/100`,
   reason `no-pre-rise`; `preRiseSec` chose the window). Night 6's room flicker rose only
   2–3 dB over the moment before; real snores rose 13–22 dB.

**Per-sound measurements** (in every data file 1.16.0–1.23.0, for every sound of every
detector): `lowRiseDb`; `preRise25Db`, `preRise50Db`, `preRise100Db`. The snore band's room
level was tracked like the floor: it fell with τ 0.5 s, rose with τ 8 s, and followed with
τ 60 s during a sound. The moment before was a ring of the last 1 s of per-frame 50–800 Hz
levels, emptied at every interruption.

**Test clips** (1.14.0): the auto test kept a random sample (reservoir, up to 60 per night) of
its snores that the counting detector did not find, as a second WAV to check by ear
(`test-clips_<stamp>.wav`; positions as `wavStartSec` under `shadows.auto.snores`).

`npm run evaluate` printed its own table: auto's count compared with the recorded one, its
margins over the night, re-counts with a 4.5 / 6 dB breath rule, and the
moment-before window (0.25 / 0.5 / 1 s) × 4 / 6 / 8 dB.

## History

| Version | PR | Change and reason |
| --- | --- | --- |
| 1.8.0 | #8 | Auto sensitivity as a background test (margins from single 40 ms frames) |
| 1.9.0 | — | 0.5 s blocks and the quiet-room cap (single frames flickered in a quiet room) |
| 1.13.1 | #38 | A sound ends only back within the room's usual quiet range (it missed loud snores) |
| 1.14.0 | #39 | Test clips (up to 60) to check it by ear; 6 dB re-count |
| 1.16.0 | #41 | Night 5: snore-band rule 8 dB (`lowRise`), because it counted quiet breathing over a motor tone |
| 1.20.0 | #47 | Night 6: rise over the moment before, 6 dB over 1 s (`preRise*`), because it counted room flicker |
| 1.22.1 | #52 | Background tests store all features and set-aside sounds; exact re-counts |
| 1.24.0 | — | Removed, with its rules, measurements and the test-clip download |

## What it showed

| Night or data | Normal (counting) | Auto test | Notes |
| --- | --- | --- | --- |
| Night 5 (hotel, 1.15.0) | 76 confirmed | 581 | 59 of its 60 test clips were not snores (quiet breathing over a motor's 70–83 Hz tone) → 1.16.0 |
| Night 6 (home, 1.19.0) | 223 | 757 | its test clips matched the moment before them (room flicker) → 1.20.0 |
| Night 7, two phones (home, 1.23.0, first night with the 1.20.0 rules) | 101 | 70 | found by both 29, only Normal 72, only auto 41; margins trigger 5.5–8.6 dB (median 5.9) |
| Night 7, two-phone labels | 45% own, 8% room (of the 74 only Normal confirmed) | its 43 extra snores: 23% own, 0% room, 77% unclear | the far phone heard few of them, so most stay unclear |
| APSAA, 32 hospital nights | 351/h; 44.4% in a snoring episode, 49.6% with the snore sensor active | 336/h; 46.6%, 52.9% | slightly more precise than Normal, on 4 kHz audio |
| Khan clips, −50 / −66 dBFS | 62.8 / 58.4% snoring found, 31.6 / 25.8% others | 62.8 / 58.6%, 31.6 / 28.6% | as Normal |

Night 7, the moment-before table (auto's confirmed snores, of them also Normal's):
≥ 4 / 6 / 8 dB over 0.25 s: 389 (39), 150 (31), 36 (24); over 0.5 s: 415 (41), 105 (31),
31 (22); over 1 s: 371 (38), 73 (29), 30 (22).

**Why it was removed:**
- At home it either counted room noise as snores (nights 5 and 6) or, with the two extra
  rules, missed most of Normal's snores (night 7).
- Every fix added a rule and per-sound measurements, all to be ported to Swift.
- The public datasets gave no reason to expect it to beat Normal.

## Rejected along the way (do not repeat)

- Margins from single 40 ms frames (v1.8): a quiet room's frames flicker by several dB.
- The snore-band rule against the tracked floor alone (1.16.0): at home the floor sits in
  the troughs of the 50 Hz hum, so flicker passed. Hence the rise over the moment before.
- Measuring that rise over only 0.25 s for the live test: it catches the snore's slow start.
- A simulated "flickering room" as evidence: it never fooled auto; real clips were the
  evidence.

## If it is restarted

- Start from the v1.23.0 code. As a background test, first on the owner's two-phone nights:
  the own/room labels (`research/two-phone/compare.js`) show whether its extra snores are the
  sleeper's own.
- Open questions it left: whether the 180 s window and 0.5 s blocks are right (the adjustment
  may be too slow for a fridge switching on); which moment-before window is best; whether a
  louder margin plus the 6 dB breath rule would do the same job with fewer rules.
- A native app could measure the room differently (for example, a calibration minute before
  sleep); the numbers above remain the baseline to beat.
