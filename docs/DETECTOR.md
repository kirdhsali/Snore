# Snorewatch detector specification

What a port (the native iPhone app) has to do to count snores exactly as the web app does,
and how to check that it does. State: version 1.27.0. The code is the authority: when this
document and the code disagree, the code counts and this document gets fixed. Rules and their
history: [`HANDOVER.md`](HANDOVER.md) §3–4.

**What is covered:**
- the counting detector: [`js/detector.js`](../js/detector.js);
- the statistics: [`js/stats.js`](../js/stats.js);
- the per-minute room-noise profile: `NoiseProfile` in [`js/noise.js`](../js/noise.js);
- the clip helpers: [`js/wav.js`](../js/wav.js);
- how a night's analysis puts them together: [`js/analysis.js`](../js/analysis.js);
- the data file: [`js/report-format.js`](../js/report-format.js).

**Not covered:** the page and its charts; the share image; the room-noise findings
(`summarize`/`describe`, presentation only); `npm run evaluate`.

**Reference outputs:** the data files of four fixed synthetic nights (§12) are what a port
compares itself with.

## 1. Input audio

- **Channels.** The microphone, asked for one channel, with the system's echo cancellation,
  noise suppression and automatic gain switched off (web: `getUserMedia` constraints). Mono:
  the average of the channels.
- **Samples and rate.** Float samples −1..1 at the device's own sample rate, not resampled.
  Phones usually deliver 48 or 44.1 kHz; every rate gives its own frame size (§2).
- **Blocks.** Audio arrives in blocks of any size. The result does not depend on the block
  size: the tests compare 1,000 and 4,096 samples with 2,048. The web app's tap delivers
  2,048 samples; its ScriptProcessor fallback delivers 4,096.
- **Web app only.** The tap never delivers its last partial block (under 2,048 samples) at
  Stop. Samples arriving during an interruption are dropped. A port need not copy either; both
  only change the last fraction of a second, or what happens during a gap.
- **WAV files.** `npm run analyze` reads integer PCM as `int / 2^(bits−1)` (16-bit:
  `int / 32768`), the usual convention of audio libraries. 8-bit is read as
  `(u − 128) / 128`, and 32-bit float as it is.

## 2. Frames

| Sample rate | Frame N | Hop (= frame) | Bin width | Calibration | Hangover | Too long at | Clip rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 48,000 | 2048 | 42.67 ms | 23.44 Hz | 24 frames | 5 frames | 94th frame | 8,000 (÷6) |
| 44,100 | 2048 | 46.44 ms | 21.53 Hz | 22 frames | 5 frames | 87th frame | 7,350 (÷6) |
| 16,000 | 1024 | 64 ms | 15.63 Hz | 16 frames | 4 frames | 63rd frame | 8,000 (÷2) |

- **Size.** `N = nextPow2(round(0.04 · sampleRate))`. Frames do not overlap, so the hop is
  `N / sampleRate`. Frame `i` covers samples `i·N … i·N+N−1`; its time on the analysed audio
  is `i · hop`.
- **End of the night.** A partial frame left at the end is never analysed. It still counts in
  the seconds analysed: `elapsed = (frames · N + leftover samples) / sampleRate`.
- **Window.** Symmetric Hann: `w[i] = 0.5 − 0.5·cos(2πi / (N−1))`.
- **FFT.** Radix-2, in place, double precision, **unnormalised** (no 1/N): the absolute
  scale matters for `midDb`, the room-noise bands and the small constants added before a
  logarithm. A port that uses a scaled FFT (e.g. vDSP's real FFT) must undo the scaling.
  - **Structure in the web app:** bit-reversal permutation first, then decimation-in-time
    butterflies with twiddles `c = cos(2πk/N)`, `s = sin(2πk/N)`:
    - `tre = re[l]·c + im[l]·s`, `tim = im[l]·c − re[l]·s`;
    - `re[l] = re[j] − tre`, `im[l] = im[j] − tim`;
    - `re[j] += tre`, `im[j] += tim`.
  - **Power of bin `k`:** `re² + im²`.
  - Another FFT algorithm gives the same values up to the last bits, which §12's tolerances
    allow.
- **Bins.** `bin(hz) = min(N/2, max(1, round(hz / binHz)))`, with `binHz = sampleRate / N`.
  Bands are half-open `[bin(lo), bin(hi))`; `nyq` is half the sample rate.

| Band | Range | Bins at 48 kHz |
| --- | --- | --- |
| total | 50 – min(8000, nyq) Hz | 2–340 |
| low | 50–800 Hz | 2–33 |
| high | 1000 – min(4000, nyq) Hz | 43–170 |
| mid (breath noise) | 150 – min(1500, nyq) Hz | 6–63 |

**Per frame** (`x` = the frame's raw samples; `p_k` = the windowed spectrum's power; sums over
the band's bins):

| Feature | Formula |
| --- | --- |
| `rms` | `sqrt(Σx² / N)` (not windowed) |
| `db` | `max(−120, 20·log10(rms + 1e−12))` |
| `power` | `rms · rms`, the computed `rms` squared (not `Σx²/N`, which can differ in the last bit) |
| `lowRatio` | `Σlow p / T` |
| `highRatio` | `Σhigh p / T` |
| `centroid` | `Σtotal p·k·binHz / Σtotal p` (0 when that is 0) |
| `midDb` | `10·log10(Σmid p / N + 1e−24)` (a relative level: only differences to `bgMid` are used) |

`T` is `Σtotal p`, or 1 when that is 0.

## 3. Room floor and sound events

**Sensitivity** (fixed for the night):

| Sensitivity | trigger | release | gate (`minAbsDb`) |
| --- | --- | --- | --- |
| low | 12 dB | 6 dB | −65 dBFS |
| normal (default) | 8 dB | 4 dB | −75 dBFS |
| high | 5 dB | 3 dB | −85 dBFS |

**Each frame `i`, in this order:**

1. **Calibrating** (no floor yet). Collect `db` and `midDb`. When `count · hop ≥ 1.0 s`:
   - `floor = max(−100, P30(dbs))`;
   - `bgMid = P30(midDbs)`.

   No sound can start during calibration, including in the frame that completes it.
   `P30` is `percentile(values, 0.3)`: sort ascending and take element
   `min(n−1, floor(0.3·n))`, with no interpolation. `percentile` is null for no values.
2. **No sound open.**
   - If `db > floor + trigger` **and** `db > gate`, a sound opens at frame `i`. It stores the
     current `floor` and `bgMid` and accumulates this frame (step 4).
   - Otherwise the floor follows the room:
     - `τ = 0.5 s` if `db < floor`, else `8 s`;
     - `floor += (hop/τ)·(db − floor)`, then `floor = max(−100, floor)`.

     `bgMid` follows `midDb` the same way, with its own choice of τ and no −100 limit.
3. **A sound is open.**
   - If `db > floor + release`, accumulate (step 4). Otherwise, unless the sound is too
     long, append `db` to its level track.
   - If `(i − startFrame + 1)·hop > 4.0 s`, mark it **too long**.
   - Floor and `bgMid` follow the audio in both directions:
     - `τ = 60 s`, or `8 s` once the sound is too long;
     - `floor += (hop/τ)·(db − floor)`, the same for `bgMid`, and no −100 limit here.
   - If `(i − lastLoud)·hop ≥ 0.2 s` (the hangover), the sound **ends** (§4).
4. **Accumulate.** First set `lastLoud = i`. For a too-long sound, stop there. Otherwise:
   - `W += power`;
   - `L += power·lowRatio`, `H += power·highRatio`, `C += power·centroid`;
   - `M += 10^(midDb/10)` and `loudFrames += 1`;
   - `peakDb = max(peakDb, db)`;
   - append `db` to the level track.
5. **Room-noise profile** (counting detector only; §10). Add the frame at
   `t = i·hop + offset`. It counts as **quiet** when no sound is open after steps 2–3 and
   `(i − lastEventEnd)·hop > 1 s`. `lastEventEnd` is the `lastLoud` of the last sound that
   ended (−∞ at the start).
6. The live view gets the frame (UI only: `db`, `floor`, the trigger level, open or not).
7. If a sound ended in step 3, the rhythm gate decides it (§6).
8. The gate expires waiting sounds (§6) at `now = (open sound ? its startFrame : i)·hop + offset`.

`offset` is the seconds of interruptions so far (§7).

## 4. A sound's features

When a sound ends (hangover, interruption or end of the night):

**Times.**
- `audioStart = startFrame·hop`, `audioEnd = (lastLoud + 1)·hop`.
- `duration = audioEnd − audioStart`.
- `start` and `end` are these plus `offset`: the night's clock.

**Levels.**
- `peakDb` as accumulated.
- `relDb = peakDb − floor` (the floor stored when the sound opened). Shown as "above room".

**Spectrum** (power-weighted over the loud frames, with `W' = W` or 1 when `W` is 0):
- `lowRatio = L/W'`;
- `highRatio = H/W'`;
- `centroid = C/W'`.

**`peaks`.** The number of loudness bursts in the level track, from `countPeaks` with a 6 dB
drop. The track holds `db` for every frame from the start to the frame the sound ended in,
hangover included (for a too-long sound, only up to where it became too long).
- Start rising, with `hi = −∞`.
- While rising, `hi = max(hi, x)`. When `x < hi − 6`, count a burst and start falling with
  `lo = x`.
- While falling, `lo = min(lo, x)`. When `x > lo + 6`, start rising with `hi = x`.
- At the end, count one more if still rising and the track is not empty.

**`fill`.** The share of the track up to `lastLoud` (hangover excluded) with
`db ≥ peakDb − 15`; 0 for an empty track.

**`breathRise`** (dB). `10·log10(M / loudFrames + 1e−24) − bgMid`, using the `bgMid` stored
when the sound opened. It is null without loud frames. This is the mean breath-band power of
the loud frames, not power-weighted, above the room's breath-band level.

**Decimated audio.** Every sample also goes into a rolling buffer at the **clip rate**:
- `decim = max(1, round(sampleRate / 8000))`, and `clipRate = sampleRate / decim`.
- Each value is the plain average of `decim` consecutive input samples. Value `j` belongs to
  time `j / clipRate`.
- The buffer holds `ceil(clipRate · 6.45 s)` values (51,600 at 8 kHz) and is written sample
  by sample, before frames are analysed.
- **Values are stored as 32-bit floats.** A port must round them to Float32 too, or
  `subBass` and `onsetJump` differ in the last digits.

**Sound audio.** Unless the sound is too long, take the buffer's values `a … b−1` (the end
is exclusive), from 0.25 s before to 0.15 s after the sound:
- `a = max(oldest held, floor((audioStart − 0.25)·clipRate))`;
- `b = min(values received, ceil((audioEnd + 0.15)·clipRate))`.

At an interruption or the end of the night, the 0.15 s after may be cut short. One value more
or less changes the clip's length, and with it `subBass`, `onsetJump` and `wavStartSec`.

**`subBass`** (null for a too-long sound). The share of 20–60 Hz in 20–4000 Hz of the sound
audio:
- 0 if it has under 64 values.
- Otherwise apply a symmetric Hann window over its length `len`, zero-pad to
  `n = nextPow2(len)` and run the FFT (`binHz = clipRate / n`).
- Sum bins `k` from `ceil(20/binHz)` while `k < min(n/2, 4000/binHz)`; "sub" are the bins
  with `k·binHz < 60`. The result is 0 when the total is 0.

**`onsetJump`** (dB). How suddenly the sound starts. It is null for a too-long sound, and
whenever not one full window fits (`len ≤ 2·hop`). Taken on the sound audio:
1. `hop = round(0.01·clipRate)` (80 at 8 kHz, 74 at 7,350 Hz), and `win = 2·hop`.
2. Energies `e[j] = 10·log10(Σ x² / win + 1e−14)` over windows starting at `j·hop`, while
   `j·hop + win < len`.
3. `room` = the median of the first 20 energies, or of all of them when there are fewer
   (with an even count, the mean of the two middle values).
4. `peak` = the first index of the largest energy.
5. `start` = the first index with `e > room + 10`, or `peak` if there is none.
6. If `peak ≤ start`, the result is `e[peak] − room`.
7. Otherwise, the largest `e[j] − e[max(0, j−2)]` for `j` from `max(1, start−2)` to `peak`.

## 5. Verdict

The checks run in this order; the first that fails names the reason:

| Order | Reason | Fails when |
| --- | --- | --- |
| 1 | `too-long` | too long, or `duration > 4.0` |
| 2 | `too-short` | `duration < 0.25` |
| 3 | `rumble` | `subBass > 0.85` (not checked when null) |
| 4 | `too-bright` | `highRatio > 0.2` or `centroid > 500` |
| 5 | `not-low` | `lowRatio < 0.55` |
| 6 | `no-breath` | `breathRise < 6` (`BREATH_RULE_DB`, every sensitivity; not checked when the rule is null or the value null) |
| 7 | `sudden` | `onsetJump > maxOnsetJumpDb`. Only when that option is set (the knock background test, 20 dB) and `onsetJump` is not null. |
| 8 | `choppy` | `peaks > 2` |

- **Snore.** A sound with no reason is a snore.
- **Score** (`confidence`). 0 for any reason. For a snore it is
  `0.5 + 0.5 · mean(clamp01((lowRatio − 0.55)/(1 − 0.55)), clamp01(1 − highRatio/0.2), clamp01(1 − centroid/500))`.
  The divisor is computed as `1 − 0.55` (0.44999999999999996 in double precision), not
  written as 0.45.
- **Rhythm candidate.** A `choppy` sound with `highRatio ≤ 0.05`, `centroid ≤ 400` and
  `fill ≥ 0.6`.
- **Clip.** Snores and rhythm candidates keep their sound audio as a clip, unless the
  detector keeps no clips (the background test):
  - gain `= max(1, min(0.7 / peak, 10^(60/20)))`, where `peak` is the largest absolute value
    (gain 1 for silence);
  - 16-bit values `round(x·gain·32767)`, clamped to −32768…32767.

## 6. Rhythm rescue (`RhythmGate`)

Sounds reach the gate in the order they end. It passes them on ("emits") to the statistics:

- **Snore.** Every waiting candidate whose start lies **2–12 s** (inclusive) before or after
  the snore's start is accepted, in the order they began waiting. Then the snore is passed. A
  candidate closer than 2 s keeps waiting. The snore becomes an **anchor** (its start is
  remembered).
- **Rhythm candidate.**
  - If an anchor lies 2–12 s from its start, it is accepted at once.
  - Otherwise it waits. Its clip is kept while it waits.
- **Anything else.** Passed at once.
- **Accepting a candidate.** It becomes a snore with `rhythm = true` and no reason. Its score
  is recomputed as for a snore with `peaks = 1`, and it is passed. It keeps its own `peaks`,
  so a rescued snore's `bursts` is above 2. Rescued snores never become anchors, so rescues
  cannot chain.
- **Expiry.** At `now` (§3 step 8), a candidate with `now − start > 12` is rejected: passed
  as `choppy`, with its clip dropped. An anchor with `now − start > 12` is forgotten.
- **Interruption or end of the night.** The open sound is decided first. Then every waiting
  candidate is rejected; at an interruption the anchors are cleared too.

**Order consequences:**
- Events reach the statistics in **decision order**, not start order. An accepted candidate
  comes just before the snore that accepted it; a rejected one comes up to ~12 s late.
- The data file sorts snores by start but keeps ignored sounds in decision order.

## 7. Interruptions and the two clocks

- **Analysed audio.** The time inside the audio the detector received: frame `i` is at
  `i·hop`. Clip cutting and the rolling buffer use this clock.
- **The night's clock.** Analysed audio plus every interruption so far (`offset`). Event
  times, frame times, the room-noise minutes and interruption positions use it. So
  `startWall + start` is the moment a sound happened.

When audio stops (the system suspends it, the microphone is muted or ends, or 2 s pass
without samples):
- An interruption begins at the night's clock at that moment: `clock = elapsed + offset`,
  where `elapsed` includes the samples of the partial frame (§2).
- Its wall-clock start is where the analysed audio ended: the arrival of the last analysed
  block before it (web app since 1.27.0, for every reason).
- When audio returns, its length `sec` is the audio actually missing (web app since 1.27.0):
  the real time from the last analysed block's arrival to the last returning block's arrival,
  minus the returning audio. The returning audio is held for 0.5 s before this is decided; a new
  interruption event during the hold, or a held block after a pause longer than one block plus
  0.2 s, decides the gap so far and starts a new one. A
  backlog that only arrived late (the page was busy) leaves less than 0.2 s missing: no
  interruption, and the audio is analysed as if nothing happened. Real time is the longer of
  the monotonic clock (unaffected when the phone's clock is set) and the wall clock (keeps
  running while a phone sleeps), so a clock set back changes nothing, while a clock set forward
  during an interruption lengthens that gap (it looks like a sleeping phone). Before 1.27.0 `sec` was the wall-clock time until the first
  returning block arrived, which counted that block twice and a late backlog as both gap and
  audio. A port measures `sec` from its own audio timestamps; what matters is that
  `elapsed + Σ sec` equals the real length of the night.
- The statistics record a gap `[clock, clock + sec)`.
- The detector closes the open sound, rejects the waiting candidates, forgets the anchors and
  adds `sec` to `offset`.
- If the night ends during the interruption with no audio back, the gap runs to the end and is
  recorded, but the detector does not resume. Audio that had come back and is held is decided
  as above first (the detector resumes and the held audio is analysed).

The audio stream itself continues: the partial frame, the floor and the rolling buffer carry
over the gap. So a clip's 0.25 s before the sound can hold audio from before the gap.

## 8. Confirmation and the night's figures (`SessionStats`)

**Confirmed.** A snore (own or rescued) is confirmed when another snore starts **2–12 s**
(inclusive) before or after it. The pair does not count when an interruption lies between
them: a gap with `min ≤ gap.start < max` of the two starts. Only confirmed snores make the
headline figures; the others are "possible".

- The web app marks both partners when the later-arriving one comes in. It searches back
  through snores in arrival order while `newStart − otherStart ≤ 42 s`. This gives the same
  result as checking every pair, because a snore arrives at most about 17 s after its start.

**Clip cap.** At most 1,500 kept clips. On the 1,501st, the clip of the snore with the lowest
`relDb` is dropped (the first such in arrival order). The new snore is included in that
choice.

**Ignored sounds.** Only these are kept, never audio: `start`, `duration`, `reason`, `relDb`,
`peakDb` and the features of §4.

**Summary** (`summary(elapsed)`, with `elapsed` = seconds of audio analysed, not the night's
clock):

| Field | Definition |
| --- | --- |
| `elapsed` | as given |
| `snoreCount` | confirmed snores |
| `snoresPerHour` | `snoreCount / max(elapsed, 1e−9) · 3600`; 0 when `elapsed ≤ 0` |
| `snoreSeconds`, `snorePercent` | sum of their durations; `100 · sum / max(elapsed, 1e−9)`, 0 when `elapsed ≤ 0` |
| `meanRelDb`, `maxRelDb` | over confirmed snores (0 when none) |
| `intensity` | `relDb < 15` light, `< 25` moderate, else loud |
| `medianInterval` | `P50` of the start-to-start steps ≤ 60 s between consecutive confirmed snores with no interruption between their starts (as for confirmation), or null |
| `episodes` | confirmed snores in start order joined while `start − episodeEnd ≤ 60 s` and no interruption starts between the episode's last start and this start (`lastStart ≤ gap.start < start`; since 1.27.0, before which episodes spanned interruptions); kept with ≥ 3 snores. Each has `start`, `end`, `duration`, `count`, `meanRelDb` and `interval` (`(lastStart − start)/(count − 1)`) |
| `longestEpisode` | longest episode duration (0 when none) |
| `possibleCount` | snores − confirmed |
| `rhythmCount` | confirmed snores rescued by the rhythm |
| `ignoredCount`, `ignoredByReason` | ignored sounds, counted by reason |

`P50` uses the same `percentile` as §3: for an even count it takes the upper middle value.

## 9. Background test: knock

A second detector on the same audio, with the same sensitivity and `maxOnsetJumpDb = 20`.
- It keeps no clips and has no room-noise profile.
- It has its own statistics. Its counts go into the data file only, never the headline.
- It hands over its snores and its **set-aside** sounds: its ignored sounds with reason
  `sudden` or `choppy` (a choppy sound is ignored only when no snore rescued it). With these,
  `npm run evaluate` can re-run it with other limits, the rhythm rescue included.

## 10. Room-noise profile (`NoiseProfile`)

Per minute of the night's clock (`floor(t / 60)`), kept as numbers only.

**Bands.**
- **Octave bands:** centres 31.5, 63, …, 8000 Hz, those with `centre·√2 ≤ nyq`. A band
  covers bins `[bin(c/√2), max(lo+1, bin(c·√2)))`, with `bin` as in §2.
- **Hum range:** bins `[bin(30), bin(400))`.

**Every frame** adds its `db` to the minute's list.

**Quiet frames** (§3 step 5) also add:
- `db` to the minute's quiet list;
- each band's summed bin power to the band;
- each bin's power in the hum range to that bin.

The bin power is `re² + im²` of the frame's windowed spectrum, bins 0…N/2.

**A minute closes** when a frame belongs to a later minute, or at the end of the night (the
last minute may be partial). `nq` is its number of quiet frames.

| Field | Definition |
| --- | --- |
| `t` | `minute · 60` |
| `quietSec` | `nq · hop` |
| `backgroundDb` | `P50` of the quiet list (null without quiet frames) |
| `p10Db`, `p90Db` | `P10`, `P90` of all frames |
| `bandsDb` | `10·log10(bandSum / nq · 16/(3N²) + 1e−24)`: the mean square in the band (null without quiet frames) |
| `humHz`, `humDb` | see below (null without quiet frames) |

**Hum.** "dB" here is `10·log10(p + 1e−24)` of a summed bin power `p`.
1. `k` = the first bin with the largest summed power in the hum range.
2. `prominence` = its dB minus the dB of the element at index `len >> 1` of the sorted hum
   powers.
3. If `prominence < 10`, or `k` is the first or last bin of the range, there is no hum (null).
4. Otherwise apply parabolic interpolation on the dB values of `k−1, k, k+1`:
   - `shift = 0.5·(a − c) / (a − 2b + c)` (with the divisor 1 when it is 0);
   - `humHz = (firstBin + k + shift)·binHz`;
   - `humDb = prominence`.

## 11. The data file (schema 2)

[`js/report-format.js`](../js/report-format.js) writes it. Its header comment lists the
changes per version.

**Rounding.** Numbers are rounded with `+v.toFixed(d)`: half away from zero, on the exact
binary value. Non-finite numbers and null become null.

**Times.** `time`, `startedAt`, `endedAt` and the interruptions' `start` and `end` are ISO
times from JavaScript's `Date`, which **truncates** to whole milliseconds. For example, a sound
at 10.28267 s after a midnight start reads `00:00:10.282Z`.

**Key order.** `ignoredByReason` lists reasons in the order they first occurred (decision
order). This only matters when comparing files as text.

**Top level.**

| Field | Content |
| --- | --- |
| `app`, `schemaVersion` | `"Snorewatch"`, 2 |
| `version`, `source` | app version; `mic`, `demo` or `file` (`npm run analyze`) |
| `startedAt`, `endedAt`, `timeZone` | ISO times, IANA zone |
| `wallSeconds`, `capturedSeconds` | 1 decimal |
| `interruptions` | `start` (where the analysed audio ended), `end` (`start` plus the missing audio, §7; since 1.27.0), `seconds` (1 decimal), `offsetSec` (night's clock, 2 decimals), `reason` |
| `screenWakeLock` | web only |
| `audioClock` | web only (since 1.27.0): `sampleRate` (the context's), `ratio` (analysed audio per real second over all continuous recording, 4 decimals), `worstRatio` (the 5-minute window furthest from 1, 4 decimals; a rate change partway through shows here), each null before 150 s of continuous recording, `checkedSeconds` (0 decimals). Far from 1 means the browser delivered audio at another rate than it said; every time and duration is then off by that factor. null for `file` |
| `microphone` | web only (since 1.26.0): what the browser applied to the microphone, read back with `getSettings()`: `echoCancellation`, `noiseSuppression`, `autoGainControl` (true/false, a mode string such as `"all"`, or null when not reported), `channelCount`, `sampleRate` (null when not reported); null for `demo` and `file` |
| `sensitivity`, `minBreathRiseDb` | the night's settings |
| `summary` | as §8, **not rounded** |
| `noise` | `minuteSec`, `bandsHz`, `minutes[]`: `offsetSec` (not rounded: a multiple of 60), `quietSec` (0 decimals), then 1 decimal each: `backgroundDbfs`, `p10Dbfs`, `p90Dbfs`, `bandsDbfs[]`, `humHz`, `humDb` |
| `snores[]` | by start: `time`, `offsetSec` (2), `durationSec` (2), `aboveRoomDb` (1), `peakDbfs` (1), `confidence` (2), features, `rhythmRescued`, `confirmed`, `wavStartSec` (2; null without a clip) |
| `ignored[]` | in decision order: `time`, `offsetSec`, `durationSec`, `reason`, `aboveRoomDb`, `peakDbfs`, features |
| `shadows.knock` | `sensitivity`, `minBreathRiseDb`, `maxOnsetJumpDb`; `summary` with `snoreCount`, `possibleCount`, `snoresPerHour` (1), `ignoredCount`, `ignoredByReason`, `episodes` (a count); `snores[]` as above without `time`, `confidence` and `wavStartSec`; `setAside[]` like `ignored` without `time` |

**Features** (every sound):

| Field | Source |
| --- | --- |
| `lowFrequencyShare` | `lowRatio`, 3 decimals |
| `highFrequencyShare` | `highRatio`, 3 decimals |
| `centroidHz` | `round(centroid)` |
| `bursts` | `peaks` |
| `subBassShare` | `subBass`, 3 decimals |
| `loudFill` | `fill`, 2 decimals |
| `breathRiseDb` | `breathRise`, 1 decimal |
| `onsetJumpDb` | `onsetJump`, 1 decimal |

**Snores WAV.** The kept clips in start order: 16-bit mono at the clip rate, with 0.4 s of
silence between clips. `wavStartSec` is where each clip begins.

## 12. Reference outputs: checking a port

[`scripts/reference.js`](../scripts/reference.js) builds four fixed nights from
[`js/synth.js`](../js/synth.js) (seeded, so the same every time):

| Night | Rate, sensitivity | What it exercises |
| --- | --- | --- |
| `demo-48000` | 48 kHz, normal | the demo night: snore runs, speech, a knock, a car, a cough |
| `demo-44100` | 44.1 kHz, normal | the same at the clip rate 7,350 Hz |
| `busy-hum-48000` | 48 kHz, normal | over a mains hum: two rattles rescued by the rhythm and a lone one rejected 12 s later (decision order), deep swells (`rumble`), a knock (`choppy`), a bump (a possible snore), speech and a cough (`too-bright`), a car (`too-long`), rumble, a two-tone sound (`not-low`); the knock test's `sudden` |
| `quiet-rumble-high-48000` | 48 kHz, high | a very quiet room with deep rumble near the gate: many small sounds (`too-short`, `no-breath`, `choppy`, …) and quiet snores |

**Inputs and outputs.**
- Each night's audio is rounded to 16-bit, as a WAV file stores it.
- The output is the data file `npm run analyze` would write:
  - `version` `"reference"`, `source` `"file"`;
  - start at 0 (1970-01-01T00:00:00Z), time zone UTC, no interruptions.
- The files are stored in [`tests/fixtures/reference/`](../tests/fixtures/reference/).
- `tests/reference.test.js` fails when the code no longer gives them exactly. It also checks
  that the four nights together exercise every reason, a rescue, a possible snore, both rates
  and two sensitivities.

```bash
npm run reference                   # check: the code still gives the stored files
npm run reference -- --wav <dir>    # also write each night's input as <name>.wav for a port's tests
npm run reference -- --update       # after an intended detection change (review the diff)
npm run analyze -- night.wav        # any WAV: data file + snores WAV, readable by npm run evaluate
```

**For a port**, feed each `<name>.wav` with the night's sensitivity, write the data file in
this format and compare it with the stored one.

**Must match exactly:**
- the count of snores, confirmed and possible, and `ignoredByReason`, also for the knock test;
- each sound's `reason`, `confirmed`, `rhythmRescued` and `bursts`;
- the list of sounds itself (same starts).

**May differ by one unit of the last stored digit.** Double-precision maths in a different
order, another maths library (`log10`, `pow`, `cos` can differ in the last bit) and rounding
at an exact half all cause such differences:
- `offsetSec`, `durationSec`, the shares, `loudFill`, the dB values, `confidence`;
- `centroidHz` (±1) and `wavStartSec`;
- the room-noise minutes;
- the ISO times (±1 ms);
- the 16-bit clip samples (±1).

**Fields that need care.**
- The unrounded `summary` fields: compare with a relative tolerance of about 1e−9.
- `snoresPerHour` and the other derived figures follow from the counts.

**When a verdict differs,** look at the feature that decided it. A value within the tolerance
of its limit (e.g. `lowFrequencyShare` 0.550) is a borderline case; report it rather than
tuning the port. Anything else is a port bug.

[recommendation] Port in double precision (Swift `Double`). Keep these as 32-bit floats as in
the web app:
- the input samples;
- the rolling buffer of decimated audio (§4);
- the sound audio cut from it.

## 13. Notes for a Swift port

- **Events are changed after they are made.** The rhythm gate turns a waiting candidate into
  a snore (`isSnore`, `reason`, `rhythm`, `score`) or drops its clip. The statistics later set
  `confirmed` on stored snores and drop clips at the cap. Use reference types (classes) for
  events, or update them by index; with value types the stored copies go stale.
- **Rounding.** JavaScript's `Math.round` rounds a half up (towards +∞). Swift's `rounded()`
  rounds a half away from zero. They differ only for negative halves.
  - The frame size, `decim`, the onset hop, the band bins and `centroidHz` are positive, so
    either works.
  - The 16-bit clip samples (§5) can be negative: −2.5 becomes −2 in JavaScript and −3 with
    `rounded()`. `(x + 0.5).rounded(.down)` matches JavaScript. Only the snores WAV is
    affected, not any count or feature.
- **Ties.** On ties the first maximum wins: the loudest onset window, the strongest hum bin,
  the quietest clip to drop.
- **Sorting.** `percentile` sorts numbers ascending, with no interpolation.
- **Callbacks.** In the web app the statistics hear an event before the page does. The page
  only reads the statistics.
- **No other state.** No randomness, wall clock or locale enters the analysis. Wall times
  only label the data file.
