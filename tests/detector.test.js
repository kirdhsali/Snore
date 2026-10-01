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
  events.push(...det.flush());
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
  assert.ok(stats.ignored.length > 0);
  for (const ig of stats.ignored) {
    for (const v of Object.values(ig)) assert.ok(!ArrayBuffer.isView(v), 'ignored sounds must not keep audio');
  }
});

test('no audio of other sounds remains once the recording ends', () => {
  // Speech near the end of a recording is still in the rolling buffer when Stop is pressed.
  const scenario = Synth.compose(16000, 12, [{ type: 'speech', at: 8 }], 1);
  const { det, events } = run(scenario);
  assert.ok(events.length && events.every((e) => !e.isSnore && e.clip === null), 'speech is rejected without audio');
  assert.ok(det.ring.some((x) => x !== 0), 'buffer held the speech before release');
  det.release();
  assert.ok(det.ring.every((x) => x === 0), 'rolling buffer wiped');
  assert.ok(det.pending.every((x) => x === 0), 'frame buffer wiped');
  assert.ok(det.analyzer.re.every((x) => x === 0) && det.analyzer.im.every((x) => x === 0), 'last spectrum wiped');
  // Kept snore clips are separate arrays and survive the release.
  const demo = run(Synth.demoScenario(16000));
  const clips = demo.events.filter((e) => e.isSnore).map((e) => e.clip);
  const sums = clips.map((c) => c.reduce((a, b) => a + Math.abs(b), 0));
  demo.det.release();
  assert.deepEqual(clips.map((c) => c.reduce((a, b) => a + Math.abs(b), 0)), sums);
});

test('lower sensitivity ignores faint snores that high sensitivity catches', () => {
  const sr = 16000;
  const plan = [0, 1, 2, 3].map((i) => ({ type: 'snore', at: 2 + i * 4, amp: 0.02 }));
  const scenario = Synth.compose(sr, 20, plan, 11);
  const high = run(scenario, { sensitivity: 'high' }).events.filter((e) => e.isSnore).length;
  const low = run(scenario, { sensitivity: 'low' }).events.filter((e) => e.isSnore).length;
  assert.ok(high > low, `high=${high} low=${low}`);
});

test('session statistics and episodes', () => {
  const stats = new SessionStats();
  const snore = (start, relDb) => ({ isSnore: true, start, end: start + 1, duration: 1, relDb, clip: null });
  // A run of four, a pair, and one isolated snore.
  [10, 14, 18, 22, 500, 504, 1000].forEach((t, i) => stats.add(snore(t, [12, 18, 30, 14, 20, 22, 9][i])));
  stats.add({ isSnore: false, start: 30, duration: 0.1, reason: 'too-short', relDb: 20 });
  const s = stats.summary(3600);
  assert.equal(s.snoreCount, 6, 'only snores with a neighbour 2-12 s away count');
  assert.equal(s.possibleCount, 1);
  assert.equal(Math.round(s.snoresPerHour), 6);
  assert.equal(s.snoreSeconds, 6);
  assert.equal(s.maxRelDb, 30);
  assert.deepEqual(s.intensity, { light: 2, moderate: 3, loud: 1 });
  assert.equal(s.ignoredCount, 1);
  assert.deepEqual(s.ignoredByReason, { 'too-short': 1 });
  assert.equal(s.episodes.length, 1, 'only runs of 3+ snores count as episodes');
  assert.equal(s.episodes[0].count, 4);
  assert.equal(s.medianInterval, 4);
  const b = stats.buckets(3600, 600);
  assert.equal(b.length, 6);
  assert.equal(b[0].count, 6);
  assert.equal(b[1].count, 0, 'the isolated snore is not charted');
  assert.deepEqual(
    stats.snores.map((x) => x.confirmed),
    [true, true, true, true, true, true, false],
  );
});

test('snores closer than 2 s or further than 12 s apart do not confirm each other', () => {
  const stats = new SessionStats();
  [0, 1.5, 20, 40].forEach((start) => stats.add({ isSnore: true, start, end: start + 1, duration: 1, relDb: 10, clip: null }));
  assert.equal(stats.summary(60).snoreCount, 0);
  assert.equal(stats.summary(60).possibleCount, 4);
  // A later snore in rhythm confirms the earlier one.
  stats.add({ isSnore: true, start: 45, end: 46, duration: 1, relDb: 10, clip: null });
  assert.equal(stats.summary(60).snoreCount, 2);
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

test('high sensitivity hears snores below the normal absolute gate', () => {
  // A very quiet bedroom: room noise near -90 dBFS, snores peaking around -79 dBFS.
  const sr = 16000;
  const plan = [0, 1, 2, 3].map((i) => ({ type: 'snore', at: 2 + i * 4, amp: 0.0003 }));
  const scenario = Synth.compose(sr, 20, plan, 4, 0.00003);
  const normal = run(scenario, { sensitivity: 'normal' }).events.filter((e) => e.isSnore);
  const high = run(scenario, { sensitivity: 'high' }).events.filter((e) => e.isSnore);
  assert.equal(normal.length, 0, 'normal ignores sounds under -75 dBFS');
  assert.equal(high.length, 4);
  assert.ok(high.every((e) => e.peakDb < -75));
});

test('page version matches package.json', () => {
  const pkg = require('../package.json');
  const v = require('../js/version.js');
  assert.equal(v.version, pkg.version);
});

test('normalizeClip boosts quiet clips and caps the gain', () => {
  const quiet = Core.normalizeClip(new Int16Array([10, -20, 5]));
  assert.equal(Math.max(...quiet.map(Math.abs)), Math.round(20 * Math.pow(10, 60 / 20)));
  const loud = new Int16Array([30000, -100]);
  assert.equal(Core.normalizeClip(loud), loud);
  const mid = Core.normalizeClip(new Int16Array([1000, -2000]));
  assert.equal(Math.max(...mid.map(Math.abs)), Math.round(0.7 * 32767));
});

test('deep rumble is rejected although it is low and smooth', () => {
  for (const sr of [48000, 16000]) {
    for (let seed = 1; seed <= 4; seed++) {
      const scenario = Synth.compose(sr, 10, [{ type: 'rumble', at: 3 }], seed);
      const { events } = run(scenario);
      assert.equal(events.length, 1);
      assert.equal(events[0].reason, 'rumble', `seed ${seed} at ${sr} Hz`);
      assert.ok(events[0].subBass > 0.85);
    }
  }
  // Without the rumble gate the same sound passes as a snore, as it did in real nights.
  const scenario = Synth.compose(48000, 10, [{ type: 'rumble', at: 3 }], 1);
  assert.ok(run(scenario, { maxSubBass: 1 }).events[0].isSnore);
});

test('rattling snores within a run of snores count through the breathing rhythm', () => {
  for (const sr of [48000, 44100, 16000]) {
    // A rattle first (confirmed by the snore after it), then alternating.
    const types = ['rattle', 'snore', 'rattle', 'rattle', 'snore', 'rattle', 'snore'];
    const plan = types.map((type, i) => ({ type, at: 2 + i * 4.2 }));
    const scenario = Synth.compose(sr, 34, plan, 5);
    const { events } = run(scenario);
    for (const t of scenario.truth) {
      const ev = events.find((e) => overlaps(e, t));
      assert.ok(ev && ev.isSnore, `${t.type} at ${t.start.toFixed(1)} s (${sr} Hz): ${ev ? ev.reason : 'not heard'}`);
    }
    const rescued = events.filter((e) => e.rhythm);
    assert.ok(rescued.length >= 2, `rhythm rescued ${rescued.length} at ${sr} Hz`);
    assert.ok(rescued.every((e) => e.clip && e.clip.length), 'rescued snores keep their audio');
    const starts = events.filter((e) => e.isSnore).map((e) => e.start);
    assert.deepEqual(starts, starts.slice().sort((a, b) => a - b), 'snores arrive in time order');
  }
});

test('a rattle with no snore around it is not counted and its audio is dropped', () => {
  const scenario = Synth.compose(48000, 30, [{ type: 'rattle', at: 3 }], 2);
  const det = new SnoreDetector(48000);
  const early = det.process(scenario.samples.subarray(0, 48000 * 8));
  assert.equal(early.length, 0, 'it waits for a snore in rhythm');
  const events = [...early, ...det.process(scenario.samples.subarray(48000 * 8)), ...det.flush()];
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'choppy');
  assert.equal(events[0].clip, null);
});

test('knocking and speech in the rhythm of snoring stay ignored', () => {
  for (const sr of [48000, 16000]) {
    const types = ['snore', 'knock', 'snore', 'speech', 'snore', 'knock', 'snore'];
    const plan = types.map((type, i) => ({ type, at: 2 + i * 4.5 }));
    const scenario = Synth.compose(sr, 36, plan, 9);
    const { events } = run(scenario);
    for (const t of scenario.truth) {
      const ev = events.find((e) => overlaps(e, t));
      assert.ok(ev, `${t.type} at ${t.start.toFixed(1)} s heard`);
      assert.equal(ev.isSnore, t.type === 'snore', `${t.type} at ${t.start.toFixed(1)} s (${sr} Hz): ${ev.reason}`);
    }
  }
});

test('summary counts snores found through the rhythm', () => {
  const stats = new SessionStats();
  stats.add({ isSnore: true, start: 1, end: 2, duration: 1, relDb: 10, clip: null });
  stats.add({ isSnore: true, start: 5, end: 6, duration: 1, relDb: 10, clip: null, rhythm: true });
  assert.equal(stats.summary(60).rhythmCount, 1);
});

function snoreNight(background, noiseLevel, amp, seed) {
  const r = Synth.rng(seed);
  const plan = [];
  for (let t = 60; t < 280; t += 70) plan.push(...Synth.snoreRun(t, 8, r).map((p) => ({ ...p, amp: amp * (0.5 + r()) })));
  return Synth.compose(16000, 300, plan, seed, noiseLevel, background);
}

function confirmedSnores(scenario, options) {
  const det = new SnoreDetector(scenario.sampleRate, options);
  const stats = new SessionStats();
  [...det.process(scenario.samples), ...det.flush()].forEach((e) => stats.add(e));
  const truth = scenario.truth.filter((t) => t.type === 'snore');
  const hits = stats.confirmed.filter((e) => truth.some((t) => overlaps(e, t))).length;
  return { hits, falseAlarms: stats.confirmed.length - hits, det };
}

test('auto sensitivity: small margins in a still room, larger in a restless one', () => {
  const still = confirmedSnores(snoreNight('still', 0.002, 0.035, 1), { sensitivity: 'auto' }).det;
  const gusty = confirmedSnores(snoreNight('gusty', 0.004, 0.25, 1), { sensitivity: 'auto' }).det;
  assert.ok(still.levels.length >= 8, 'margins are re-measured every 30 s');
  const last = (d) => d.levels[d.levels.length - 1];
  assert.ok(last(still).triggerDb <= 6, `still room trigger ${last(still).triggerDb}`);
  assert.ok(last(gusty).triggerDb >= 8, `restless room trigger ${last(gusty).triggerDb}`);
  for (const d of [still, gusty]) {
    assert.ok(d.levels.every((l) => l.triggerDb >= 5 && l.triggerDb <= 14 && l.releaseDb >= 3 && l.releaseDb < l.triggerDb));
  }
});

test('auto sensitivity finds soft snores in a very quiet bedroom that normal misses', () => {
  let normal = 0;
  let auto = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const night = snoreNight('still', 0.00006, 0.0004, seed); // room about -86 dBFS, snores about -77 to -73 dBFS
    normal += confirmedSnores(night, { sensitivity: 'normal' }).hits;
    const a = confirmedSnores(night, { sensitivity: 'auto' });
    auto += a.hits;
    assert.equal(a.falseAlarms, 0);
  }
  assert.ok(auto >= 2 * normal, `auto ${auto} vs normal ${normal}`);
});

test('auto sensitivity keeps up in a restless room', () => {
  const night = snoreNight('gusty', 0.004, 0.25, 2);
  const auto = confirmedSnores(night, { sensitivity: 'auto' });
  const normal = confirmedSnores(night, { sensitivity: 'normal' });
  assert.ok(auto.hits >= normal.hits - 1, `auto ${auto.hits} vs normal ${normal.hits}`);
  assert.equal(auto.falseAlarms, 0);
});

test('a counting-only detector keeps no audio', () => {
  const { events } = run(Synth.demoScenario(16000), { keepClips: false });
  assert.ok(events.some((e) => e.isSnore));
  assert.ok(events.every((e) => e.clip === null));
});

test('breath-noise rule: hum swells without breath noise stop counting, snores stay', () => {
  for (const sr of [48000, 16000]) {
    const r = Synth.rng(3);
    const plan = [];
    for (let i = 0; i < 6; i++) plan.push({ type: 'swell', at: 3 + i * 4 });
    plan.push(...Synth.snoreRun(40, 6, r));
    const scenario = Synth.compose(sr, 70, plan, 3);
    const count = (options) => {
      const { events } = run(scenario, options);
      const swells = events.filter((e) => e.start < 30);
      const snores = events.filter((e) => e.start >= 38);
      return { swellSnores: swells.filter((e) => e.isSnore).length, noBreath: swells.filter((e) => e.reason === 'no-breath').length, snores: snores.filter((e) => e.isSnore).length, swells };
    };
    const without = count({});
    assert.ok(without.swellSnores >= 4, `without the rule the swells pass as snores (${without.swellSnores}/6 at ${sr} Hz)`);
    assert.ok(without.swells.every((e) => e.breathRise < 4), 'swells have almost no breath noise');
    const withRule = count({ minBreathRiseDb: 3 });
    assert.ok(withRule.noBreath >= 5, `rule rejects swells: ${withRule.noBreath}/6 at ${sr} Hz`);
    assert.equal(withRule.snores, 6, 'real snores keep counting');
  }
});

test('breath-noise rule keeps every snore of the demo night', () => {
  const { events } = run(Synth.demoScenario(48000), { minBreathRiseDb: 3 });
  assert.equal(events.filter((e) => e.isSnore).length, 16);
  assert.ok(events.filter((e) => e.isSnore).every((e) => e.breathRise > 10));
});

test('auto sensitivity in a very quiet room full of deep rumble stays sensitive', () => {
  let normal = 0;
  let auto = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const r = Synth.rng(seed);
    const plan = [];
    for (let t = 60; t < 280; t += 70) plan.push(...Synth.snoreRun(t, 8, r).map((p) => ({ ...p, amp: 0.0004 * (0.5 + r()) })));
    const night = Synth.compose(16000, 300, plan, seed, 0.00006, 'deep'); // about -82 dBFS, mostly below 60 Hz
    normal += confirmedSnores(night, { sensitivity: 'normal' }).hits;
    // The smaller margin lets rumble flicker through; the breath-noise rule removes it.
    const a = confirmedSnores(night, { sensitivity: 'auto', minBreathRiseDb: 3 });
    auto += a.hits;
    assert.equal(a.falseAlarms, 0);
    assert.ok(a.det.levels.every((l) => l.triggerDb <= 9), 'trigger capped in a very quiet room');
  }
  assert.ok(auto >= 2 * normal, `auto ${auto} vs normal ${normal}`);
});
