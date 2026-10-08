'use strict';
// The reference outputs (scripts/reference.js, docs/DETECTOR.md): the analysis must still give
// exactly the stored data files, and together they must exercise every rule a port has to match.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { REASONS } = require('../js/detector.js');
const { SCENARIOS, referenceReport, fileOf } = require('../scripts/reference.js');

const stored = (sc) => JSON.parse(fs.readFileSync(fileOf(sc), 'utf8'));

for (const sc of SCENARIOS) {
  test(`reference ${sc.name}: the analysis gives the stored data file (npm run reference -- --update after an intended change)`, () => {
    assert.deepEqual(referenceReport(sc), stored(sc));
  });
}

test('the reference nights cover every verdict, the rhythm rescue, possible snores and both sample rates', () => {
  const files = SCENARIOS.map(stored);
  const reasons = new Set();
  for (const f of files) {
    for (const e of f.ignored) reasons.add(e.reason);
    for (const sh of Object.values(f.shadows)) for (const e of sh.setAside) reasons.add(e.reason);
  }
  assert.deepEqual([...reasons].sort(), Object.keys(REASONS).sort(), 'each reason decides at least one sound');
  const snores = files.flatMap((f) => f.snores);
  assert.ok(
    snores.some((x) => x.rhythmRescued && x.confirmed),
    'a choppy sound rescued by the rhythm',
  );
  assert.ok(
    snores.some((x) => !x.confirmed),
    'a possible (unconfirmed) snore',
  );
  assert.deepEqual(new Set(SCENARIOS.map((sc) => sc.sampleRate)), new Set([44100, 48000]));
  assert.deepEqual(new Set(files.map((f) => f.sensitivity)), new Set(['normal', 'high']));
  assert.ok(
    files.every((f) => f.noise.minutes.length >= 2),
    'every night has room-noise minutes',
  );
});
