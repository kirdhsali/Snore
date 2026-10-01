'use strict';
// scripts/evaluate.js re-runs a downloaded night's stored features through the rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventsOf, reevaluate } = require('../scripts/evaluate.js');

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
  assert.deepEqual(events.map((e) => e.breathRise), [12, 10, 1.2]);
  // Current rules (breath rule off): all three stay snores.
  assert.equal(reevaluate(events).filter((e) => e.isSnore).length, 3);
  // Candidate rule, as in the background test: the hum swell is rejected.
  const withRule = reevaluate(eventsOf(report), { minBreathRiseDb: 3 });
  assert.deepEqual(withRule.map((e) => e.reason), [null, null, 'no-breath']);
});

test('evaluator keeps working with reports that lack newer features', () => {
  const old = feature(2, undefined);
  delete old.breathRiseDb;
  delete old.subBassShare;
  const events = eventsOf({ snores: [old], ignored: [] });
  assert.equal(events[0].breathRise, null);
  assert.equal(reevaluate(events, { minBreathRiseDb: 3 })[0].isSnore, true, 'no data, no verdict from that rule');
});
