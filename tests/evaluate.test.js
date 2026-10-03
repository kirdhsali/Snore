'use strict';
// scripts/evaluate.js re-runs a downloaded night's stored features through the rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventsOf, reevaluate, stricterBreath } = require('../scripts/evaluate.js');

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
  // Current rules (breath rule off): all three stay snores.
  assert.equal(reevaluate(events).filter((e) => e.isSnore).length, 3);
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
