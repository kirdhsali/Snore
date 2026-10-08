# Snorewatch history (older handover sections)

Moved from [`docs/HANDOVER.md`](../HANDOVER.md) on 2026-10-08 (owner: keep the handover short).
Unchanged apart from relative links. The handover keeps the current state, the decisions still
in force (§2), the recent versions (§4) and the next steps (§10).

## Owner decisions, 2026-10-03 to 2026-10-05 (before the dataset study)

Most recent first, as they stood in HANDOVER §2.

- **2026-10-05, after the third review:** merge the 1.22.0 checkpoint docs (#51); fix the
  review's findings N1–N4 and write the review response **before** the public-dataset
  tests (the fixes are quick, the datasets slow). Dataset harnesses stay in a scratch
  directory at first; a data-free script may be proposed later.
- **2026-10-05, review preparation:** a background trial for High (1.22.0, keep its test
  clips). Public datasets for later tests: **APSAA** (Zenodo), **PSG-Audio** (Hugging Face /
  Science Data Bank) and the **Khan** clips (GitHub mirror, no clear licence) may be used
  locally, never committed; the owner added `zenodo.org`, `huggingface.co` and
  `www.scidb.cn` to the cloud environment's allowed domains. These dataset tests are **not
  run yet**; they are for a new session (§10). Tests with other people's nights are on hold.
- **2026-10-05, after night 6:** the late "tonal" sounds (06:39–06:44) are real snores for
  now (owner listened: snoring in the background, sometimes moaning). The breath rule for
  Low and High "if it made Normal better and makes sense, else explain": applied to
  **Low** (1.21.0); **High left without it** (it costs High's quiet snores; owner sees
  3–4.5 dB as a possible middle ground → background trial). The auto test gets the rise
  over the moment before (1.20.0); compare window lengths.
- **2026-10-04, after nights 4 and 5:** the 6 dB breath rule counts for **Normal**
  (1.17.0). A knock (sudden-start) rule as a background test first (1.18.0). Room-noise
  findings and heatmap go into the report as they are (1.19.0); the owner finds them not
  very informative yet, to be revisited.
- **2026-10-03, night 4:** time zone in the data file, clips at full 16-bit detail, the
  6 dB breath rule as a background test only (then).

Notes removed from the handover at the same time:
- A planned switch of the default sensitivity to "auto + breath rule" for v2.0 lapsed when
  automatic sensitivity was removed in 1.24.0.
- Claude's recommendation "High: 4.5 dB as the middle ground" was superseded on 2026-10-05: the
  datasets put High's 3–6 dB sounds at or below chance level for snoring, and the owner chose
  6 dB.
- Up to 1.23.0 the automatic-sensitivity test also kept up to 60 test clips (1.22.x: and the
  High test up to 30).
- The owner allowed `us.aws.cdn.hf.co` (Hugging Face's file host) in the cloud environment
  (2026-10-05; still listed in HANDOVER §9).

## Version history up to 1.22.3 (HANDOVER §4)

Review phase (details per finding in `REVIEW-RESPONSE.md`): 1.9.2 R2 failed restart ·
1.9.3 R7 locked sensitivity, R6 card queue · 1.9.4 R4 dev server · 1.9.5 R5 buffers wiped,
privacy wording · 1.9.6 R8 intervals, R9 evaluator · 1.10.0 R3 rhythm rule · 1.10.1–1.10.2
R1 interruptions · 1.10.3 workflows · 1.10.4 "Darken screen" moved · 1.10.5 ESLint +
Prettier · 1.11.0 data file schema 2 · 1.11.1 frozen night record · 1.11.2 recorder
controller · 1.11.3 stats/wav split · 1.12.0 storage interface · 1.12.1–1.12.4 second
review C1, C2, C3, C5.

Real-night phase (this session, owner's nights 4–6, §8):

| Version | PR | Change and reason |
| --- | --- | --- |
| 1.12.5 | #34 | Time zone in the data file; evaluator counts per hour in it |
| 1.12.6 | #35 | Clips turned up before the 16-bit conversion (were grainy) |
| 1.13.0 | #36 | Background test `breath6` (6 dB breath rule) after night 4's hum swells |
| 1.13.1 | #38 | Auto: a sound ends only back within the room's usual quiet range (auto missed loud snores) |
| 1.14.0 | #39 | Auto test clips (up to 60) to check by ear |
| 1.15.0 | #40 | Room noise per minute in the data file (levels only) |
| 1.16.0 | #41 | Night 5: `lowRise`; auto needs 8 dB in the snore band (it counted quiet breathing) |
| — | #42 | Room-noise findings logic (`summarize`/`describe`), in the evaluator |
| 1.17.0 | #43 | **Counting change:** Normal needs 6 dB of breath noise (night 4 961 → 661, night 5 76 → 73); breath background tests removed (re-computable offline) |
| 1.18.0 | #44 | Background test `knock` (`onsetJump`); ESC-50 clips faded in and out |
| 1.19.0 | #45 | Room-noise panel and heatmap in the report and shared HTML |
| 1.19.1 | #46 | Night 6: ignored sounds keep `lowRise`/`onsetJump`; mains hum recognised |
| 1.20.0 | #47 | Auto: 6 dB rise over the moment before (`preRise25/50/100`); tests hand over `setAside` |
| 1.21.0 | #48 | **Counting change:** Low needs 6 dB of breath noise |
| — | #49 | Handover notes (late sounds, High question) |
| 1.22.0 | #50 | Background test `high` with test clips; clip sampling per test |
| — | #51 | Review checkpoint 1.22.0: handover, review response, verification |
| 1.22.1 | #52 | Third review N2/N3: background tests store all features and choppy set-asides; the evaluator re-runs their rules with the rhythm rescue; "not evaluable" without breath values |
| 1.22.2 | #53 | Third review N1: room-noise findings follow clock minutes, never across a gap |
| 1.22.3 | #54 | Third review N4: the share image's coverage line wraps inside the margins |
| — | #55 | Third review saved, review response, verification 1.22.3, this handover |
| — | #56 | Verification 1.22.3: branch pushes, not merges, cancelled two deploys |

## Done notes from HANDOVER §10

**Done (2026-10-05):** the public-dataset study (APSAA 32 nights, PSG-Audio 6 nights, Khan, ESC-50
baseline, YAMNet, the owner's nights 4–6), rerunnable from [`research/`](../../research/README.md);
results and limits in [`research/RESULTS.md`](../../research/RESULTS.md). In short: High → 6 dB
(decided); Normal is precise where someone clearly snores; the 500 Hz pitch limit misses
higher-pitched snorers; labels without listening work with a second sensor (throat mic / snore
sensor; for the owner: two phones, near and far); YAMNet works best as a second opinion.
Then **High with the 6 dB breath rule** (1.23.0), which ended the High background trial; the
first two-phone night (#59, `research/RESULTS.md` §10).

**Done (2026-10-06):** 1.24.0 slims the app for the move to a native iPhone app: automatic
sensitivity, its two rules, the per-sound `lowRiseDb`/`preRise*Db` and the test-clip download
are gone; the counting detector and the room-noise check are unchanged (verified event by event
against 1.23.0). Restart log: [`docs/archive/auto-sensitivity.md`](auto-sensitivity.md).
