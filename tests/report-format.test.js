'use strict';
// js/report-format.js writes the "Download data" file and reads every version of it back.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/detector.js');
const Synth = require('../js/synth.js');
const { SCHEMA_VERSION, toReport, fromReport, shadowEvents } = require('../js/report-format.js');
const { eventsOf, reevaluate } = require('../scripts/evaluate.js');

/** A finished demo night as the app holds it: main detector, one background test, one interruption. */
function demoNight() {
  const sr = 16000;
  const sc = Synth.demoScenario(sr);
  const stats = new Core.SessionStats();
  const shadowStats = new Core.SessionStats();
  const det = new Core.SnoreDetector(sr, { noiseProfile: true, onEvent: (e) => stats.add(e) });
  const shadow = new Core.SnoreDetector(sr, {
    sensitivity: 'normal',
    maxOnsetJumpDb: 20,
    keepClips: false,
    onEvent: (e) => shadowStats.add(e),
  });
  const half = Math.floor(sc.samples.length / 2);
  for (const d of [det, shadow]) d.process(sc.samples.subarray(0, half));
  // 5 s without audio halfway through.
  const clock = det.clock;
  for (const [d, s] of [
    [det, stats],
    [shadow, shadowStats],
  ]) {
    s.addGap(clock, clock + 5);
    d.resumeAfterGap(5);
    d.process(sc.samples.subarray(half));
    d.flush();
  }
  const startWall = Date.parse('2026-10-01T22:00:00Z');
  return {
    version: '1.11.0 (test)',
    source: 'demo',
    startWall,
    endWall: startWall + (det.clock + 0.4) * 1000,
    timeZone: 'Europe/Berlin',
    noise: { minuteSec: 60, bandsHz: det.noise.bandsHz, minutes: det.noise.finish() },
    capturedSeconds: det.elapsed,
    gaps: [{ start: startWall + clock * 1000, end: startWall + (clock + 5) * 1000, clock, reason: 'suspended' }],
    screenWakeLock: 'on',
    sensitivity: det.sensitivity,
    config: { ...det.opts },
    summary: stats.summary(det.elapsed),
    snores: stats.snores,
    ignored: stats.ignored,
    shadows: {
      knock: {
        options: { sensitivity: 'normal', maxOnsetJumpDb: 20 },
        config: { ...shadow.opts },
        summary: shadowStats.summary(det.elapsed),
        snores: shadowStats.snores,
        setAside: shadowStats.ignored.slice(0, 2),
      },
    },
  };
}

test('a finished night survives the round trip through the data file', () => {
  const night = demoNight();
  const json = JSON.parse(JSON.stringify(toReport(night)));
  assert.equal(json.schemaVersion, SCHEMA_VERSION);
  assert.equal(json.interruptions.length, 1);
  assert.equal(json.timeZone, 'Europe/Berlin');
  assert.equal(json.minBreathRiseDb, 6, 'the breath-noise rule Normal counted with (1.17.0)');
  assert.equal(json.noise.minutes.length, night.noise.minutes.length);
  assert.ok(json.noise.minutes.every((m) => typeof m.backgroundDbfs === 'number' && m.bandsDbfs.length === json.noise.bandsHz.length));
  const back = fromReport(json);
  assert.equal(back.timeZone, 'Europe/Berlin');
  assert.equal(back.minBreathRiseDb, 6);
  assert.equal(back.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(back.missing, []);
  assert.equal(back.snores.length, night.snores.length);
  assert.equal(back.ignored.length, night.ignored.length);
  // Ignored sounds keep the newer measures too (they were left out before 1.19.1).
  assert.ok(
    back.ignored.filter((e) => e.reason !== 'too-long').every((e) => typeof e.onsetJump === 'number'),
    'onset jump of ignored sounds (too-long ones have no audio to measure)',
  );
  const inOrder = [...night.snores].sort((a, b) => a.start - b.start);
  back.snores.forEach((e, i) => {
    const x = inOrder[i];
    assert.ok(Math.abs(e.start - x.start) < 0.006, `start ${e.start} vs ${x.start}`);
    assert.equal(e.confirmed, !!x.confirmed);
    assert.equal(e.rhythm, !!x.rhythm);
    assert.equal(e.peaks, x.peaks);
    assert.ok(Math.abs(e.breathRise - x.breathRise) < 0.06);
    assert.ok(Math.abs(e.onsetJump - x.onsetJump) < 0.06, 'onset jump kept (1.18.0)');
  });
  assert.deepEqual(
    back.interruptions.map((g) => g.reason),
    ['suspended'],
  );
  assert.ok(Math.abs(back.interruptions[0].end - back.interruptions[0].start - 5) < 0.06);
  assert.equal(back.shadows.knock.sensitivity, 'normal');
  assert.equal(back.shadows.knock.snores.length, night.shadows.knock.snores.length);
  assert.equal(json.shadows.knock.minBreathRiseDb, 6, 'the rule in force (the configuration), not only the options');
  assert.equal(json.shadows.knock.maxOnsetJumpDb, 20);
  assert.deepEqual(Object.keys(json.shadows.knock), ['sensitivity', 'minBreathRiseDb', 'maxOnsetJumpDb', 'summary', 'snores', 'setAside']);
  // The automatic-sensitivity test's measurements were removed in 1.24.0.
  for (const key of ['lowRiseDb', 'preRise25Db', 'preRise50Db', 'preRise100Db'])
    assert.ok(!(key in json.snores[0]) && !(key in json.ignored[0]) && !(key in json.shadows.knock.snores[0]), key);
  assert.equal(json.shadows.knock.setAside.length, 2, 'sounds a background test set aside');
  // Every sound feature, as for the counting detector's sounds (1.22.1), so the test's rules can be re-run.
  const featureKeys = [
    'peakDbfs',
    'lowFrequencyShare',
    'highFrequencyShare',
    'centroidHz',
    'bursts',
    'subBassShare',
    'loudFill',
    'breathRiseDb',
    'onsetJumpDb',
  ];
  assert.deepEqual(Object.keys(json.shadows.knock.setAside[0]), ['offsetSec', 'durationSec', 'reason', 'aboveRoomDb', ...featureKeys]);
  assert.deepEqual(Object.keys(json.shadows.knock.snores[0]), [
    'offsetSec',
    'durationSec',
    'aboveRoomDb',
    ...featureKeys,
    'rhythmRescued',
    'confirmed',
  ]);
  const shadowBack = shadowEvents(json.shadows.knock);
  assert.equal(shadowBack.length, night.shadows.knock.snores.length + 2);
  assert.ok(
    shadowBack.every((e) => typeof e.lowRatio === 'number' && typeof e.fill === 'number'),
    'read back with features',
  );
  assert.ok(json.shadows.knock.snores.every((x) => typeof x.onsetJumpDb === 'number'));
});

test('the data file keeps every field earlier versions wrote', () => {
  const old = require('./fixtures/v1.9-demo-report.json');
  const now = toReport(demoNight());
  for (const key of Object.keys(old)) assert.ok(key in now, `top-level ${key}`);
  for (const key of Object.keys(old.snores[0])) assert.ok(key in now.snores[0], `snore ${key}`);
  for (const key of Object.keys(old.ignored[0])) assert.ok(key in now.ignored[0], `ignored ${key}`);
  // Background tests keep their fields, except the automatic-sensitivity test's margins (removed in 1.24.0).
  for (const key of Object.keys(old.shadows.auto)) if (key !== 'levels') assert.ok(key in now.shadows.knock, `shadow ${key}`);
});

test('reports written by 1.8 and 1.9 still read', () => {
  const v19 = fromReport(require('./fixtures/v1.9-demo-report.json'));
  assert.equal(v19.schemaVersion, 1);
  assert.equal(v19.snores.length, 16);
  assert.equal(v19.ignored.length, 5);
  assert.deepEqual(v19.interruptions, []);
  assert.deepEqual(Object.keys(v19.shadows).sort(), ['auto', 'breath']);
  const v18 = fromReport(require('./fixtures/v1.8-report.json'));
  assert.equal(v18.schemaVersion, 1);
  assert.deepEqual(v18.missing, ['breathRiseDb']);
  assert.deepEqual(Object.keys(v18.shadows), ['auto'], 'the single v1.8 `shadow` becomes shadows.auto');
  assert.equal(v18.snores[0].breathRise, null);
});

test('files that are not a Snorewatch report, or come from a newer schema, are refused', () => {
  assert.throws(() => fromReport({ app: 'Other', snores: [], ignored: [] }), /Not a Snorewatch/);
  assert.throws(() => fromReport({ snores: [] }), /Not a Snorewatch/);
  assert.throws(() => fromReport({ app: 'Snorewatch', schemaVersion: SCHEMA_VERSION + 1, snores: [], ignored: [] }), /newer/);
});

test('re-evaluation respects interruptions as the live detector does', () => {
  // A snore, a 1 s gap, then a rattle 8 s after the snore: live it is not rescued across the gap.
  const f = (offsetSec, extra) => ({
    offsetSec,
    durationSec: 0.8,
    aboveRoomDb: 20,
    lowFrequencyShare: 0.95,
    highFrequencyShare: 0.01,
    centroidHz: 150,
    bursts: 1,
    subBassShare: 0.2,
    loudFill: 0.9,
    breathRiseDb: 15,
    ...extra,
  });
  const report = {
    app: 'Snorewatch',
    snores: [f(2), f(6)],
    ignored: [f(14, { bursts: 4, reason: 'choppy' })],
    interruptions: [{ offsetSec: 10, seconds: 1, reason: 'suspended' }],
  };
  const night = fromReport(report);
  const across = reevaluate(eventsOf(report), undefined, night.interruptions);
  assert.equal(across.find((e) => e.start === 14).isSnore, false);
  // Without the interruption the snore at 6 s rescues it.
  const without = reevaluate(eventsOf(report));
  assert.equal(without.find((e) => e.start === 14).isSnore, true);
});
