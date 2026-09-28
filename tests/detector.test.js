'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/detector.js');
const Synth = require('../js/synth.js');

const { SnoreDetector, SessionStats, FFT, countPeaks, encodeWav } = Core;

function run(scenario, options) {
  const det = new SnoreDetector(scenario.sampleRate, options);
  const events = [];
  // Feed in browser-sized chunks to exercise the frame buffering.
  for (let i = 0; i < scenario.samples.length; i += 1024) {
    events.push(...det.process(scenario.samples.subarray(i, i + 1024)));
  }
  const last = det.flush();
  if (last) events.push(last);
  return { det, events };
}

function overlaps(ev, truth) {
  return ev.start < truth.end + 0.3 && ev.end > truth.start - 0.3;
}

test('FFT matches a naive DFT', () => {
  const n = 64;
  const rand = Synth.rng(3);
  const x = Array.from({ length: n }, () => rand() * 2 - 1);
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  new FFT(n).transform(re, im);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      sr += x[t] * Math.cos((2 * Math.PI * k * t) / n);
      si -= x[t] * Math.sin((2 * Math.PI * k * t) / n);
    }
    assert.ok(Math.abs(sr - re[k]) < 1e-9 && Math.abs(si - im[k]) < 1e-9, `bin ${k}`);
  }
});

test('countPeaks separates one smooth burst from syllables', () => {
  assert.equal(countPeaks([-60, -50, -40, -35, -40, -50], 6), 1);
  assert.equal(countPeaks([-40, -30, -45, -30, -45, -30, -45], 6), 3);
});

for (const sr of [48000, 44100, 16000]) {
  test(`demo night at ${sr} Hz: finds every snore and nothing else`, () => {
    const scenario = Synth.demoScenario(sr);
    const { events } = run(scenario);
    const snoreTruth = scenario.truth.filter((t) => t.type === 'snore');
    const detected = events.filter((e) => e.isSnore);

    for (const t of snoreTruth) {
      assert.ok(detected.some((e) => overlaps(e, t)), `missed snore at ${t.start.toFixed(1)} s`);
    }
    for (const e of detected) {
      const hit = scenario.truth.find((t) => overlaps(e, t));
      assert.equal(hit && hit.type, 'snore', `false snore at ${e.start.toFixed(1)} s`);
    }
    assert.equal(detected.length, snoreTruth.length);
  });
}

test('each distractor on its own is ignored', () => {
  const sr = 48000;
  for (const type of ['speech', 'knock', 'cough', 'car']) {
    for (let seed = 1; seed <= 4; seed++) {
      const scenario = Synth.compose(sr, 12, [{ type, at: 3 }], seed);
      const { events } = run(scenario);
      assert.ok(events.length >= 1, `${type} (seed ${seed}) should be heard`);
      assert.ok(events.every((e) => !e.isSnore), `${type} (seed ${seed}) was counted as a snore`);
    }
  }
});

test('snores with varied pitch and loudness are detected', () => {
  const sr = 44100;
  let found = 0;
  let total = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const rand = Synth.rng(seed);
    const plan = Synth.snoreRun(2, 4, rand);
    const scenario = Synth.compose(sr, 20, plan, seed);
    const { events } = run(scenario);
    total += plan.length;
    found += events.filter((e) => e.isSnore).length;
  }
  assert.ok(found / total >= 0.95, `detected ${found}/${total}`);
});

test('quiet room produces no events', () => {
  const scenario = Synth.compose(48000, 30, [], 5);
  const { events } = run(scenario);
  assert.equal(events.length, 0);
});

test('audio is kept for snores only', () => {
  const scenario = Synth.demoScenario(16000);
  const { events, det } = run(scenario);
  for (const e of events) {
    if (e.isSnore) {
      assert.ok(e.clip instanceof Int16Array && e.clip.length > 0.5 * det.clipRate);
    } else {
      assert.equal(e.clip, null);
    }
  }
  const stats = new SessionStats();
  events.forEach((e) => stats.add(e));
  for (const ig of stats.ignored) assert.deepEqual(Object.keys(ig).sort(), ['duration', 'reason', 'relDb', 'start']);
});

test('lower sensitivity ignores faint snores that high sensitivity catches', () => {
  const sr = 16000;
  const plan = [0, 1, 2, 3].map((i) => ({ type: 'snore', at: 2 + i * 4, amp: 0.009 }));
  const scenario = Synth.compose(sr, 20, plan, 11);
  const high = run(scenario, { sensitivity: 'high' }).events.filter((e) => e.isSnore).length;
  const low = run(scenario, { sensitivity: 'low' }).events.filter((e) => e.isSnore).length;
  assert.ok(high > low, `high=${high} low=${low}`);
});

test('session statistics and episodes', () => {
  const stats = new SessionStats();
  const snore = (start, relDb) => ({ isSnore: true, start, end: start + 1, duration: 1, relDb, clip: null });
  [10, 14, 18, 22, 500, 504, 1000].forEach((t, i) => stats.add(snore(t, [12, 18, 30, 14, 20, 22, 9][i])));
  stats.add({ isSnore: false, start: 30, duration: 0.1, reason: 'too-short', relDb: 20 });
  const s = stats.summary(3600);
  assert.equal(s.snoreCount, 7);
  assert.equal(Math.round(s.snoresPerHour), 7);
  assert.equal(s.snoreSeconds, 7);
  assert.equal(s.maxRelDb, 30);
  assert.deepEqual(s.intensity, { light: 3, moderate: 3, loud: 1 });
  assert.equal(s.ignoredCount, 1);
  assert.deepEqual(s.ignoredByReason, { 'too-short': 1 });
  assert.equal(s.episodes.length, 1, 'only runs of 3+ snores count as episodes');
  assert.equal(s.episodes[0].count, 4);
  assert.equal(s.medianInterval, 4);
  const b = stats.buckets(3600, 600);
  assert.equal(b.length, 6);
  assert.equal(b[0].count, 6);
  assert.equal(b[1].count, 1);
});

test('clip budget drops the quietest clips first', () => {
  const stats = new SessionStats({ maxClips: 2 });
  [5, 30, 10].forEach((relDb, i) =>
    stats.add({ isSnore: true, start: i, end: i + 1, duration: 1, relDb, clip: new Int16Array(4) }),
  );
  assert.deepEqual(
    stats.snores.map((s) => !!s.clip),
    [false, true, true],
  );
});

test('WAV encoder writes a valid header', () => {
  const buf = encodeWav([new Int16Array([1, 2, 3]), new Int16Array([4])], 8000, 0.001);
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(...new Uint8Array(buf, o, 4));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(v.getUint32(24, true), 8000);
  const samples = 3 + 8 + 1;
  assert.equal(v.getUint32(40, true), samples * 2);
  assert.equal(buf.byteLength, 44 + samples * 2);
  assert.equal(v.getInt16(44 + 2 * 11, true), 4);
});
