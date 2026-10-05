'use strict';
// scripts/evaluate.js re-runs a downloaded night's stored features through the rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventsOf, reevaluate, recount, canRecount, stricterBreath, preRiseVariant } = require('../scripts/evaluate.js');
const { toReport } = require('../js/report-format.js');

const feature = (offsetSec, breathRiseDb, extra = {}) => ({
  offsetSec,
  durationSec: 1,
  aboveRoomDb: 20,
  peakDbfs: -30,
  lowFrequencyShare: 0.95,
  highFrequencyShare: 0.01,
  centroidHz: 180,
  bursts: 1,
  subBassShare: 0.1,
  loudFill: 0.9,
  breathRiseDb,
  ...extra,
});

test('evaluator reads the breath noise of each sound and can apply the breath-noise rule', () => {
  // A breathy snore run and a hum swell without breath noise.
  const report = { snores: [feature(2, 12), feature(6, 10), feature(10, 1.2)], ignored: [] };
  const events = eventsOf(report);
  assert.deepEqual(
    events.map((e) => e.breathRise),
    [12, 10, 1.2],
  );
  // Without a breath rule (Low, High, Normal before 1.17.0) all three stay snores.
  assert.equal(reevaluate(events, { minBreathRiseDb: null }).filter((e) => e.isSnore).length, 3);
  // Current rules for Normal (6 dB since 1.17.0): the hum swell is rejected.
  assert.deepEqual(
    reevaluate(events).map((e) => e.reason),
    [null, null, 'no-breath'],
  );
  assert.equal(reevaluate(events, { sensitivity: 'high' }).filter((e) => e.isSnore).length, 3, 'High has no breath rule');
  // Candidate rule, as in the background test: the hum swell is rejected.
  const withRule = reevaluate(eventsOf(report), { minBreathRiseDb: 3 });
  assert.deepEqual(
    withRule.map((e) => e.reason),
    [null, null, 'no-breath'],
  );
});

test('the stricter breath-noise rule (6 dB) also drops sounds with only a little breath noise', () => {
  // Night 4: hum swells with 3-6 dB of breath noise passed the 3 dB rule and confirmed each other.
  const report = {
    snores: [feature(2, 14), feature(6, 11), feature(10, 4.5), feature(14, 3.8), feature(18, 5.2)],
    ignored: [],
  };
  const reasons = (min) => reevaluate(eventsOf(report), { minBreathRiseDb: min }).map((e) => e.reason);
  assert.deepEqual(reasons(3), [null, null, null, null, null]);
  assert.deepEqual(reasons(6), [null, null, 'no-breath', 'no-breath', 'no-breath']);
});

test('evaluator shows the room background and hum per hour when the file has them (1.15.0)', () => {
  const minute = (offsetSec, backgroundDbfs, humHz) => ({
    offsetSec,
    quietSec: 50,
    backgroundDbfs,
    p10Dbfs: -92,
    p90Dbfs: -80,
    bandsDbfs: [],
    humHz,
    humDb: humHz ? 25 : null,
  });
  const report = {
    app: 'Snorewatch',
    startedAt: '2026-10-01T23:00:00.000Z',
    timeZone: 'UTC',
    sensitivity: 'normal',
    summary: { elapsed: 7200 },
    snores: [feature(2, 12), feature(6, 10), feature(10, 11)],
    ignored: [],
    noise: {
      minuteSec: 60,
      bandsHz: [],
      minutes: [minute(0, -89, 50), minute(60, -88, 50), minute(3600, -79.5, null), minute(3660, -80, 50.4)],
    },
  };
  const out = evaluateOutput(report, 'UTC');
  assert.match(out, /room: background dBFS, hum/);
  assert.match(out, /\n\s+23:00\s+3\s+3\s+-88\.0\s+50 Hz in 100% of minutes/, out);
  assert.match(out, /\n\s+0:00\s+0\s+0\s+-79\.5\s+50 Hz in 50% of minutes/, out);
});

test('a background test can be re-counted with the 6 dB breath rule from its stored sounds', () => {
  const sh = { snores: [2, 6, 10, 14].map((t, i) => ({ offsetSec: t, durationSec: 1, aboveRoomDb: 12, breathRiseDb: [14, 11, 4, 9][i] })) };
  assert.equal(stricterBreath(sh, 3), 4);
  assert.equal(stricterBreath(sh, 6), 3, 'the 4 dB sound drops out; 2, 6 and 14 s still confirm each other');
  assert.equal(stricterBreath(sh, 6, [{ start: 7, end: 13 }]), 2, 'nothing confirms across an interruption');
});

test('evaluator keeps working with reports that lack newer features', () => {
  const old = feature(2, undefined);
  delete old.breathRiseDb;
  delete old.subBassShare;
  const events = eventsOf({ snores: [old], ignored: [] });
  assert.equal(events[0].breathRise, null);
  assert.equal(reevaluate(events, { minBreathRiseDb: 3 })[0].isSnore, true, 'no data, no verdict from that rule');
});

/** Runs the evaluator on a report as a separate process, with this computer's clock set to `tz`. */
function evaluateOutput(report, tz) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'snorewatch-')), 'night.json');
  fs.writeFileSync(file, JSON.stringify(report));
  return execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'evaluate.js'), file], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
}

test("evaluator counts per hour in the night's own time zone", () => {
  const report = {
    app: 'Snorewatch',
    startedAt: '2026-10-01T23:34:00.000Z',
    timeZone: 'Asia/Kathmandu', // UTC+5:45, so 23:34 UTC is 05:19 there
    sensitivity: 'normal',
    summary: { elapsed: 600 },
    snores: [feature(2, 12), feature(6, 10), feature(10, 11)],
    ignored: [],
  };
  const out = evaluateOutput(report, 'UTC');
  assert.match(out, /\n\s+5:00\s+3\s+3\b/, out);
  assert.doesNotMatch(out, /23:00/);
  assert.match(out, /Asia\/Kathmandu/);
  // Files without a time zone (before 1.12.5) use this computer's and say so.
  delete report.timeZone;
  const old = evaluateOutput(report, 'UTC');
  assert.match(old, /\n\s+23:00\s+3\s+3\b/, old);
  assert.match(old, /this computer's time zone/);
});

test("evaluator applies the breath-noise rule of the night's sensitivity and shows what it takes away (1.17.0)", () => {
  // Recorded before 1.17.0 on Normal: two snores and three hum swells that confirmed each other.
  const report = {
    app: 'Snorewatch',
    startedAt: '2026-10-01T23:00:00.000Z',
    timeZone: 'UTC',
    sensitivity: 'normal',
    summary: { elapsed: 3600 },
    snores: [feature(2, 12), feature(6, 10), feature(30, 2), feature(34, 4), feature(38, 1.5)].map((x) => ({ ...x, confirmed: true })),
    ignored: [],
  };
  const out = evaluateOutput(report, 'UTC');
  assert.match(out, /breath-noise rule: recorded none, current rules 6 dB/, out);
  assert.match(out, /confirmed snores\s+5\s+2\n/, out);
  assert.match(out, /without the breath-noise rule: 5 confirmed/, out);
  // High has no breath rule: nothing changes and there is nothing to compare.
  const high = evaluateOutput({ ...report, sensitivity: 'high' }, 'UTC');
  assert.match(high, /breath-noise rule: recorded none, current rules none/, high);
  assert.match(high, /confirmed snores\s+5\s+5\n/, high);
  assert.doesNotMatch(high, /without the breath-noise rule/);
});

test('the sudden-start (knock) rule can be re-run on stored sounds (1.18.0)', () => {
  // Night 5: knocks at full level at once confirmed each other; a snore run swells.
  const report = {
    snores: [
      feature(41.6, 36, { onsetJumpDb: 36.7 }),
      feature(45.3, 20, { onsetJumpDb: 24.2 }),
      feature(47.7, 28, { onsetJumpDb: 21.4 }),
      feature(300, 15, { onsetJumpDb: 9.8 }),
      feature(304, 14, { onsetJumpDb: 16.3 }),
    ],
    ignored: [],
  };
  const events = eventsOf(report);
  assert.equal(reevaluate(events).filter((e) => e.isSnore).length, 5, 'current rules count them all');
  assert.deepEqual(
    reevaluate(events, { maxOnsetJumpDb: 20 }).map((e) => e.reason),
    ['sudden', 'sudden', 'sudden', null, null],
  );
  delete report.snores[0].onsetJumpDb;
  assert.equal(reevaluate(eventsOf(report), { maxOnsetJumpDb: 20 })[0].isSnore, true, 'files before 1.18.0: no verdict from that rule');
});

test('evaluator lists the counted snores the knock test drops, with their place in the WAV', () => {
  const report = {
    app: 'Snorewatch',
    startedAt: '2026-10-03T23:10:22.000Z',
    timeZone: 'Europe/Paris',
    sensitivity: 'normal',
    summary: { elapsed: 3600 },
    snores: [
      feature(41.6, 36, { onsetJumpDb: 36.7, time: '2026-10-03T23:11:03.600Z', wavStartSec: 0, confirmed: true }),
      feature(45.3, 20, { onsetJumpDb: 12.1, time: '2026-10-03T23:11:07.300Z', wavStartSec: 1.5, confirmed: true }),
    ],
    ignored: [],
    shadows: {
      knock: { sensitivity: 'normal', minBreathRiseDb: 6, maxOnsetJumpDb: 20, summary: {}, levels: [], snores: [] },
    },
  };
  const out = evaluateOutput(report, 'UTC');
  assert.match(out, /knock: sensitivity normal, breath-noise rule 6 dB, sudden-start rule 20 dB/, out);
  assert.match(out, /normal's snores that start suddenly: 01:11:03 \(WAV 0 s\) \+36\.7 dB\n/, out);
});

test('the auto test can be re-counted with another window or limit for the rise over the moment before (1.20.0)', () => {
  const rise = (r25, r100) => ({ preRise25Db: r25, preRise50Db: (r25 + r100) / 2, preRise100Db: r100 });
  const shadow = {
    snores: [2, 6].map((t) => ({ offsetSec: t, durationSec: 1, aboveRoomDb: 12, ...rise(9, 9) })),
    setAside: [
      { offsetSec: 10, durationSec: 1, aboveRoomDb: 9, reason: 'no-pre-rise', bursts: 1, ...rise(4, 7) },
      { offsetSec: 14, durationSec: 1, aboveRoomDb: 9, reason: 'no-pre-rise', bursts: 1, ...rise(4, 7) },
      { offsetSec: 18, durationSec: 1, aboveRoomDb: 9, reason: 'no-pre-rise', bursts: 4, ...rise(4, 7) },
    ],
  };
  assert.equal(preRiseVariant(shadow, 1, 6).length, 4, 'over 1 s the two set-aside sounds pass; the choppy one does not count');
  assert.equal(preRiseVariant(shadow, 0.25, 6).length, 2);
  assert.equal(preRiseVariant(shadow, 1, 8).length, 2);
  assert.equal(preRiseVariant(shadow, 1, 6, [{ start: 7, end: 9 }]).length, 4, 'pairs on each side of a gap still confirm');
  assert.equal(preRiseVariant(shadow, 1, 6, [{ start: 3, end: 5 }]).length, 3, '2 s loses its partner across the gap');
});

test('the High test is re-counted with 3, 4.5 and 6 dB breath-noise rules from its stored snores (1.22.0)', () => {
  const report = {
    app: 'Snorewatch',
    startedAt: '2026-10-05T23:00:00.000Z',
    timeZone: 'UTC',
    sensitivity: 'normal',
    summary: { elapsed: 3600 },
    snores: [],
    ignored: [],
    shadows: {
      high: {
        sensitivity: 'high',
        minBreathRiseDb: null,
        summary: {},
        levels: [],
        snores: [2, 6, 10, 14].map((t, i) => ({
          offsetSec: t,
          durationSec: 1,
          aboveRoomDb: 8,
          breathRiseDb: [12, 5, 4, 3.5][i],
          confirmed: true,
        })),
      },
    },
  };
  const out = evaluateOutput(report, 'UTC');
  assert.match(out, /background test high: sensitivity high vs normal/, out);
  assert.match(
    out,
    /with a breath-noise rule of 3 dB: 4 \(4\/h\), 4\.5 dB: 2 \(2\/h\), 6 dB: 0 \(0\/h\) \(approximate: this file is older than 1\.22\.1, so rhythm rescues are not redone\)/,
    out,
  );
});

/** The review's case (2026-10-05, N2): two rattles at 2 and 6 s that only a smooth snore at 10 s rescues. */
function rescuedRattlesShadow() {
  const sound = (start, peaks, breathRise, preRise100) => ({
    start,
    end: start + 1,
    duration: 1,
    relDb: 20,
    peakDb: -35,
    lowRatio: 0.95,
    highRatio: 0.03,
    centroid: 200,
    subBass: 0.1,
    fill: 0.85,
    peaks,
    breathRise,
    lowRise: 15,
    preRise100,
    onsetJump: 10,
    wasSnore: true,
    wasReason: null,
  });
  const options = { sensitivity: 'auto', minBreathRiseDb: 3, minLowRiseDb: 8, minPreRiseDb: 6, preRiseSec: 1 };
  const events = [sound(2, 4, 8, 10), sound(6, 4, 8, 10), sound(10, 1, 4, 7)];
  const stats = new (require('../js/stats.js').SessionStats)();
  for (const e of reevaluate(events, options)) stats.add({ ...e, clip: null });
  const summary = { ...stats.summary(60), episodes: [] };
  // Written as the app writes it (1.22.1), so the test covers the data file too.
  const report = toReport({
    version: 'test',
    source: 'demo',
    startWall: Date.parse('2026-10-05T23:00:00Z'),
    endWall: Date.parse('2026-10-05T23:01:00Z'),
    timeZone: 'UTC',
    capturedSeconds: 60,
    gaps: [],
    sensitivity: 'normal',
    summary: { ...summary, elapsed: 60 },
    snores: [],
    ignored: [],
    shadows: { auto: { options, summary, levels: [], snores: stats.snores, setAside: stats.ignored } },
  });
  return JSON.parse(JSON.stringify(report));
}

test('a background test re-counted with a stricter rule loses the rattles its dropped snore rescued (review N2)', () => {
  const report = rescuedRattlesShadow();
  const auto = report.shadows.auto;
  assert.deepEqual(
    auto.snores.map((x) => [x.offsetSec, x.rhythmRescued, x.bursts]),
    [
      [2, true, 4],
      [6, true, 4],
      [10, false, 1],
    ],
    'the file keeps each sound and whether a snore rescued it',
  );
  assert.ok(canRecount(auto));
  assert.equal(recount(auto).length, 3, 'its own rules give its own count back');
  // The smooth snore has 4 dB of breath noise and 7 dB of rise over the second before.
  assert.equal(recount(auto, { minBreathRiseDb: 6 }).length, 0, 'no snore of its own is left to rescue the rattles');
  assert.equal(recount(auto, { minPreRiseDb: 8 }).length, 0);
  // The estimate for older files keeps them: why it is labelled approximate.
  assert.equal(stricterBreath(auto, 6), 2);
  assert.equal(preRiseVariant(auto, 1, 8).length, 2);
  const out = evaluateOutput(report, 'UTC');
  assert.match(out, /re-counted from its stored sounds with its own rules: 3 confirmed/, out);
  assert.match(out, /with a breath-noise rule of 4\.5 dB: 0 \(0\/h\), 6 dB: 0 \(0\/h\) \(re-counted from its stored sounds\)/, out);
  assert.match(out, /rise over the moment before \(confirmed, of them also normal's\), re-counted from the stored sounds:/, out);
  assert.match(out, /\n\s+1 s\s+3 \(0\)\s+3 \(0\)\s+0 \(0\)\s*\n/, out);
});

test('a looser limit lets a set-aside sound in and redoes the rescue it makes possible (1.22.1)', () => {
  const sound = (offsetSec, reason, bursts, preRise100Db) => ({
    ...feature(offsetSec, 9, { bursts, lowRiseDb: 15, preRise100Db }),
    ...(reason ? { reason } : { rhythmRescued: false, confirmed: false }),
  });
  const auto = {
    sensitivity: 'auto',
    minBreathRiseDb: 3,
    minLowRiseDb: 8,
    minPreRiseDb: 6,
    preRiseSec: 1,
    snores: [sound(2, null, 1, 9)],
    // 20 s rose too little over the second before; the rattle at 24 s then had no snore to rescue it.
    setAside: [sound(20, 'no-pre-rise', 1, 5), sound(24, 'choppy', 4, 9)],
  };
  assert.equal(recount(auto).length, 0);
  assert.deepEqual(
    recount(auto, { minPreRiseDb: 4 }).map((x) => [x.start, !!x.rhythm]),
    [
      [20, false],
      [24, true],
    ],
  );
  assert.equal(preRiseVariant(auto, 1, 4).length, 0, 'the estimate leaves choppy sounds out');
});

test("old files without breath measurements say a background test's breath re-count cannot be made (review N3)", () => {
  const fs = require('fs');
  const path = require('path');
  const out = evaluateOutput(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1.8-report.json'), 'utf8')), 'UTC');
  assert.match(out, /missing: breathRiseDb/, out);
  assert.match(out, /with a stricter breath-noise rule: not evaluable \(this file has no breath-noise measurements for it\)/, out);
  assert.doesNotMatch(out, /3 dB: 0/, out);
});
