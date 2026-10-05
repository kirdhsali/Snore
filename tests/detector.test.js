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
      assert.ok(
        detected.some((e) => overlaps(e, t)),
        `missed snore at ${t.start.toFixed(1)} s`,
      );
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
      assert.ok(
        events.every((e) => !e.isSnore),
        `${type} (seed ${seed}) was counted as a snore`,
      );
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
  assert.ok(
    det.ring.some((x) => x !== 0),
    'buffer held the speech before release',
  );
  det.release();
  assert.ok(
    det.ring.every((x) => x === 0),
    'rolling buffer wiped',
  );
  assert.ok(
    det.pending.every((x) => x === 0),
    'frame buffer wiped',
  );
  assert.ok(det.analyzer.re.every((x) => x === 0) && det.analyzer.im.every((x) => x === 0), 'last spectrum wiped');
  // Kept snore clips are separate arrays and survive the release.
  const demo = run(Synth.demoScenario(16000));
  const clips = demo.events.filter((e) => e.isSnore).map((e) => e.clip);
  const sums = clips.map((c) => c.reduce((a, b) => a + Math.abs(b), 0));
  demo.det.release();
  assert.deepEqual(
    clips.map((c) => c.reduce((a, b) => a + Math.abs(b), 0)),
    sums,
  );
});

test('rhythm intervals are measured between snore starts, whatever order snores arrive in', () => {
  const snore = (start, duration = 1) => ({ isSnore: true, start, end: start + duration, duration, relDb: 20, clip: null });
  // Starts exactly 4 s apart: the episode's rhythm is 4 s, not stretched by the last snore's length.
  const even = new SessionStats();
  [2, 6, 10].forEach((t) => even.add(snore(t)));
  const s1 = even.summary(30);
  assert.equal(s1.episodes[0].interval, 4);
  assert.equal(s1.episodes[0].duration, 9, 'the episode still lasts until the last snore ends');
  assert.equal(s1.medianInterval, 4);
  // A rescued rattle is decided only when a later snore arrives, so events can come as 2, 6, 3, 8.
  const late = new SessionStats();
  [2, 6, 3, 8].forEach((t) => late.add(snore(t, 0.6)));
  const s2 = late.summary(30);
  assert.deepEqual(
    late.confirmed.map((x) => x.start),
    [2, 3, 6, 8],
  );
  assert.equal(s2.medianInterval, 2, 'gaps 1, 3, 2 between starts in time order');
  assert.equal(s2.episodes[0].interval, 2);
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
  [5, 30, 10].forEach((relDb, i) => stats.add({ isSnore: true, start: i, end: i + 1, duration: 1, relDb, clip: new Int16Array(4) }));
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

test('clipFromAudio boosts quiet clips and caps the gain', () => {
  const peakOf = (clip) => Math.max(...clip.map(Math.abs));
  const step = 1 / 32767; // one 16-bit step
  const quiet = Core.clipFromAudio(Float32Array.from([10, -20, 5], (x) => x * step));
  assert.equal(peakOf(quiet), Math.round(20 * Math.pow(10, 60 / 20)), 'boost capped at 60 dB');
  const loud = Core.clipFromAudio(Float32Array.from([30000, -100], (x) => x * step));
  assert.deepEqual(Array.from(loud), [30000, -100], 'never turned down');
  const mid = Core.clipFromAudio(Float32Array.from([1000, -2000], (x) => x * step));
  assert.equal(peakOf(mid), Math.round(0.7 * 32767));
  assert.deepEqual(Array.from(Core.clipFromAudio(new Float32Array(3))), [0, 0, 0], 'silence stays silent');
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
  // Without the rumble gate (and the breath-noise rule) the same sound passes as a snore, as it did in real nights.
  const scenario = Synth.compose(48000, 10, [{ type: 'rumble', at: 3 }], 1);
  assert.ok(run(scenario, { maxSubBass: 1, minBreathRiseDb: null }).events[0].isSnore);
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
    assert.ok(
      rescued.every((e) => e.clip && e.clip.length),
      'rescued snores keep their audio',
    );
    const starts = events.filter((e) => e.isSnore).map((e) => e.start);
    assert.deepEqual(
      starts,
      starts.slice().sort((a, b) => a - b),
      'snores arrive in time order',
    );
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
      return {
        swellSnores: swells.filter((e) => e.isSnore).length,
        noBreath: swells.filter((e) => e.reason === 'no-breath').length,
        snores: snores.filter((e) => e.isSnore).length,
        swells,
      };
    };
    const without = count({ minBreathRiseDb: null });
    assert.ok(without.swellSnores >= 4, `without the rule the swells pass as snores (${without.swellSnores}/6 at ${sr} Hz)`);
    assert.ok(
      without.swells.every((e) => e.breathRise < 4),
      'swells have almost no breath noise',
    );
    const withRule = count({ minBreathRiseDb: 3 });
    assert.ok(withRule.noBreath >= 5, `rule rejects swells: ${withRule.noBreath}/6 at ${sr} Hz`);
    assert.equal(withRule.snores, 6, 'real snores keep counting');
    // Normal applies the 6 dB rule by itself (1.17.0), Low too (1.21.0), High too (1.23.0).
    for (const sensitivity of ['normal', 'high']) {
      const c = count({ sensitivity });
      assert.equal(c.swellSnores, 0, `${sensitivity} counts no swell at ${sr} Hz`);
      assert.ok(c.noBreath >= 5, `most for missing breath noise (${c.noBreath}/6; the rest is rumble)`);
      assert.equal(c.snores, 6, 'and keeps the snores');
    }
    assert.ok(
      count({ sensitivity: 'high', minBreathRiseDb: null }).swellSnores >= 4,
      'High without the rule (before 1.23.0) counted the swells',
    );
  }
});

test('Low applies the breath-noise rule too: hum swells between snore runs stop counting (1.21.0)', () => {
  // As night 4 at Low: snores, then hum swells 4 s apart that confirm each other.
  const r = Synth.rng(2);
  const plan = [];
  for (let t = 20; t < 140; t += 40) {
    plan.push(...Synth.snoreRun(t, 4, r).map((p) => ({ ...p, amp: 0.02 * (0.5 + r()) })));
    for (let k = 0; k < 4; k++) plan.push({ type: 'swell', at: t + 18 + k * 4 + r() });
  }
  const sc = Synth.compose(16000, 160, plan, 2, 0.002, 'still');
  const swellsCounted = (options) => {
    const st = new SessionStats();
    const det = new SnoreDetector(16000, { keepClips: false, sensitivity: 'low', ...options, onEvent: (e) => st.add(e) });
    det.process(sc.samples);
    det.flush();
    const swells = sc.truth.filter((t) => t.type === 'swell');
    return st.confirmed.filter((e) => swells.some((t) => e.start < t.end && e.end > t.start)).length;
  };
  assert.ok(swellsCounted({ minBreathRiseDb: null }) >= 6, 'without the rule Low counts the swells');
  assert.equal(swellsCounted({}), 0, 'Low with its rule counts none');
});

test('onset jump: a knock counts its full step wherever it starts; a swell rises slowly', () => {
  const rate = 8000;
  const room = (n, r) => Float32Array.from({ length: n }, () => (r() - 0.5) * 0.002);
  for (let shift = 0; shift < 80; shift += 7) {
    const r = Synth.rng(shift + 1);
    const x = room(2400 + shift, r);
    for (let i = 2000 + shift; i < x.length; i++) x[i] += 0.1 * Math.sin(i / 3) * Math.exp(-(i - 2000 - shift) / 2000);
    const jump = Core.onsetJump(x, rate);
    assert.ok(jump > 35, `40 dB knock starting ${shift} samples into a step: ${jump.toFixed(1)} dB`);
  }
  const r = Synth.rng(5);
  const swell = room(6000, r);
  // From the room's level to 40 dB above it over 0.3 s, evenly in dB.
  for (let i = 2000; i < 6000; i++) swell[i] += 0.1 * Math.pow(10, -2 * (1 - Math.min(1, (i - 2000) / 2400))) * Math.sin(i / 3);
  assert.ok(Core.onsetJump(swell, rate) < 10, `a sound that swells over 0.3 s: ${Core.onsetJump(swell, rate).toFixed(1)} dB`);
  assert.equal(Core.onsetJump(new Float32Array(0), rate), null);
});

test('sudden-start rule: bumps that pass every other rule are set aside, snores stay (knock background test)', () => {
  // Night 5: knocks reached full level at once, passed every rule and confirmed each other.
  for (const sr of [48000, 44100, 16000]) {
    for (let seed = 1; seed <= 3; seed++) {
      const r = Synth.rng(seed);
      const plan = [];
      for (let i = 0; i < 5; i++) plan.push({ type: 'bump', at: 3 + i * 4 + r(), amp: 0.04 });
      plan.push(...Synth.snoreRun(30, 8, r));
      const scenario = Synth.compose(sr, 65, plan, seed);
      const split = (options) => {
        const { events } = run(scenario, options);
        return { bumps: events.filter((e) => e.start < 28), snores: events.filter((e) => e.start >= 28) };
      };
      const normal = split({});
      const where = `at ${sr} Hz, seed ${seed}`;
      assert.ok(normal.bumps.filter((e) => e.isSnore).length >= 4, `Normal counts the bumps as snores ${where}`);
      assert.ok(
        normal.bumps.every((e) => e.onsetJump > 20) && normal.snores.every((e) => e.onsetJump < 15),
        `bumps jump, snores swell ${where}`,
      );
      const knock = split({ maxOnsetJumpDb: 20 });
      assert.ok(
        knock.bumps.every((e) => e.reason === 'sudden'),
        `the rule sets every bump aside ${where}`,
      );
      assert.equal(knock.snores.filter((e) => e.isSnore).length, normal.snores.filter((e) => e.isSnore).length, `snores stay ${where}`);
    }
  }
  const { events } = run(Synth.demoScenario(48000), { maxOnsetJumpDb: 20 });
  assert.equal(events.filter((e) => e.isSnore).length, 16, 'the demo night keeps its 16 snores');
});

test('rise over the moment before: measured over 0.25, 0.5 and 1 s; a rule uses the chosen window', () => {
  for (const sr of [48000, 16000]) {
    const r = Synth.rng(2);
    const sc = Synth.compose(sr, 45, [...Synth.snoreRun(5, 5, r), { type: 'swell', at: 30 }], 2);
    const { events } = run(sc, {});
    for (const e of events.filter((x) => x.start < 28)) {
      for (const k of ['preRise25', 'preRise50', 'preRise100']) assert.ok(e[k] > 20, `${k} of a snore at ${sr} Hz: ${e[k]}`);
      assert.ok(Math.abs(e.preRise100 - e.lowRise) < 3, 'in a still room the moment before is the room itself');
    }
    const swell = events.find((x) => x.start >= 28);
    assert.ok(swell.preRise25 <= swell.preRise100 + 0.5, 'a slow swell rises less over the shortest window');
  }
  const det = new Core.SnoreDetector(16000);
  det.process(Synth.compose(16000, 3, [], 1).samples);
  assert.ok(det.lowHistCount > 0);
  det.resumeAfterGap(2);
  assert.equal(det.lowHistCount, 0, 'nothing before an interruption counts as the moment before');
  const f = { duration: 1, lowRatio: 0.9, highRatio: 0.01, centroid: 150, peaks: 1, subBass: 0.2, breathRise: 20 };
  const g = { ...f, preRise25: 3, preRise50: 5, preRise100: 9 };
  assert.equal(Core.classify(g, { minPreRiseDb: 6, preRiseSec: 0.25 }).reason, 'no-pre-rise');
  assert.equal(Core.classify(g, { minPreRiseDb: 6, preRiseSec: 1 }).isSnore, true);
  assert.equal(Core.classify(g, {}).isSnore, true, 'off by default');
  assert.equal(
    Core.classify({ ...g, preRise100: null }, { minPreRiseDb: 6, preRiseSec: 1 }).isSnore,
    true,
    'not measured: no verdict from it',
  );
});

test('the breath-noise rule in force: the options set it, else the sensitivity (Normal 6 dB)', () => {
  assert.equal(Core.breathRuleDb({}), 6, 'default sensitivity is Normal');
  assert.equal(Core.breathRuleDb({ sensitivity: 'normal' }), 6);
  assert.equal(Core.breathRuleDb({ sensitivity: 'low' }), 6, 'Low too since 1.21.0');
  assert.equal(Core.breathRuleDb({ sensitivity: 'high' }), 6, 'High too since 1.23.0');
  assert.equal(Core.breathRuleDb({ sensitivity: 'auto' }), null);
  assert.equal(Core.breathRuleDb({ sensitivity: 'normal', minBreathRiseDb: null }), null, 'null switches it off');
  assert.equal(Core.breathRuleDb({ sensitivity: 'high', minBreathRiseDb: 3 }), 3);
  assert.equal(new Core.SnoreDetector(48000).opts.minBreathRiseDb, 6, 'the detector records the rule it uses');
  assert.equal(new Core.SnoreDetector(48000, { sensitivity: 'high' }).opts.minBreathRiseDb, 6);
  assert.equal(new Core.SnoreDetector(48000, { sensitivity: 'high', minBreathRiseDb: null }).opts.minBreathRiseDb, null);
  const f = { duration: 1, lowRatio: 0.9, highRatio: 0.01, centroid: 150, peaks: 1, subBass: 0.2, breathRise: 4 };
  assert.equal(Core.classify(f, {}).reason, 'no-breath', '4 dB of breath noise is not enough on Normal');
  assert.equal(Core.classify(f, { sensitivity: 'high' }).reason, 'no-breath', 'nor on High (1.23.0)');
  assert.equal(Core.classify(f, { sensitivity: 'high', minBreathRiseDb: 3 }).isSnore, true, 'unless a test sets a gentler rule');
  assert.equal(Core.classify({ ...f, breathRise: 6.5 }, {}).isSnore, true);
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
    assert.ok(
      a.det.levels.every((l) => l.triggerDb <= 9),
      'trigger capped in a very quiet room',
    );
  }
  assert.ok(auto >= 2 * normal, `auto ${auto} vs normal ${normal}`);
});

test('auto sensitivity over a wavering hum ends sounds in time and does not count breathing (night 4)', () => {
  // Night 4: a mains hum kept the usual quiet level 3-5 dB above the floor. With its
  // release inside that range, auto kept sounds open into the hum and the breathing
  // around them: loud two-burst snores came out choppy or too long, breaths as snores.
  const counts = { normal: 0, auto: 0, snores: 0, falseAlarms: 0 };
  for (let seed = 1; seed <= 3; seed++) {
    const r = Synth.rng(seed);
    const plan = [];
    for (let t = 40; t < 290; t += 9 + r() * 3) {
      plan.push({ type: r() < 0.5 ? 'snore' : 'rattle', at: t, amp: 0.004 * (0.6 + r()), bursts: 2, duration: 0.8 + r() * 0.5 });
      for (let b = t + 2.6; b < t + 8.5; b += 3.8 + r() * 0.8) plan.push({ type: 'breath', at: b, amp: 0.00004 * (0.7 + 0.6 * r()) });
    }
    const night = Synth.compose(16000, 300, plan, seed, 0.00005, 'hum'); // floor about -90 dBFS
    const snores = night.truth.filter((t) => t.type !== 'breath');
    const confirmed = (options) => {
      const stats = new SessionStats();
      const det = new SnoreDetector(16000, { ...options, onEvent: (e) => stats.add(e) });
      det.process(night.samples);
      det.flush();
      return { list: stats.confirmed, det };
    };
    const hits = (list) => snores.filter((t) => list.some((e) => overlaps(e, t))).length;
    const auto = confirmed({ sensitivity: 'auto', minBreathRiseDb: 3 });
    counts.normal += hits(confirmed({ sensitivity: 'normal' }).list);
    counts.auto += hits(auto.list);
    counts.snores += snores.length;
    counts.falseAlarms += auto.list.filter((e) => !snores.some((t) => overlaps(e, t))).length;
    const last = auto.det.levels[auto.det.levels.length - 1];
    assert.ok(last.releaseDb >= 4.5, `release above the hum's usual level: ${last.releaseDb.toFixed(1)} dB`);
  }
  assert.equal(counts.auto, counts.snores, `auto found ${counts.auto}/${counts.snores} (normal ${counts.normal})`);
  assert.equal(counts.falseAlarms, 0, 'no breath counted as a snore');
});

test('snore-band rule: quiet breathing over a room tone is not a snore, snores are (night 5)', () => {
  // Night 5 (hotel): auto counted 581 snores, Normal 76; its sampled extra snores were the
  // sleeper's quiet breathing over a motor's low tone. The tone makes any quiet sound look
  // low and snore-like, but breathing barely raises the 50-800 Hz band above its room noise.
  const auto = { sensitivity: 'auto', minBreathRiseDb: 3 };
  const counts = { plain: 0, rule: 0, snores: 0, hits: 0 };
  for (let seed = 1; seed <= 3; seed++) {
    const r = Synth.rng(seed);
    const plan = [];
    for (let t = 3; t < 590; t += 3.6 + r())
      if (t < 200 || t > 250) plan.push({ type: 'breath', at: t, dull: true, amp: 0.00005 * (0.7 + 0.6 * r()) });
    for (let k = 0; k < 10; k++) plan.push({ type: 'snore', at: 202 + k * 4.3, amp: 0.0025 * (0.6 + r()) });
    const night = Synth.compose(16000, 600, plan, seed, 0.00005, 'hum');
    const snores = night.truth.filter((t) => t.type === 'snore');
    const confirmed = (options) => {
      const stats = new SessionStats();
      const det = new SnoreDetector(16000, { ...options, keepClips: false, onEvent: (e) => stats.add(e) });
      det.process(night.samples);
      det.flush();
      return stats.confirmed;
    };
    const falseOnes = (list) => list.filter((e) => !snores.some((t) => overlaps(e, t))).length;
    counts.plain += falseOnes(confirmed(auto));
    const withRule = confirmed({ ...auto, minLowRiseDb: 8 });
    counts.rule += falseOnes(withRule);
    counts.snores += snores.length;
    counts.hits += snores.filter((t) => withRule.some((e) => overlaps(e, t))).length;
    assert.ok(
      withRule.every((e) => e.lowRise >= 8),
      'what counts rises in the snore band',
    );
  }
  assert.ok(counts.plain >= 20, `without the rule auto counts breaths: ${counts.plain}`);
  assert.equal(counts.rule, 0, 'with the rule no breath counts');
  assert.equal(counts.hits, counts.snores, `snores still count: ${counts.hits}/${counts.snores}`);
});

// Rhythm rule as documented: a choppy, snore-like sound counts when a snore that
// passed on its own starts 2-12 s before or after it.
const gateEvent = (start, candidate = false) => ({
  start,
  end: start + 0.6,
  duration: 0.6,
  isSnore: !candidate,
  rhythmCandidate: candidate,
  reason: candidate ? 'choppy' : null,
  lowRatio: 0.95,
  highRatio: 0.01,
  centroid: 180,
  peaks: candidate ? 4 : 1,
  relDb: 20,
  clip: null,
});
function gateRun(input) {
  const out = [];
  const gate = new Core.RhythmGate({}, (e) => out.push(e));
  for (const e of input) {
    gate.expire(e.start);
    gate.decide(e);
  }
  gate.flush();
  return Object.fromEntries(out.map((e) => [e.start, e.isSnore]));
}

test('rhythm rule: a snore too close does not cancel a later one that is in rhythm', () => {
  // Candidate at 2 s, snores at 3 s (1 s, too close) and 6 s (4 s, in rhythm).
  assert.deepEqual(gateRun([gateEvent(2, true), gateEvent(3), gateEvent(6)]), { 2: true, 3: true, 6: true });
});

test('rhythm rule: every recent snore counts as an anchor, not only the latest', () => {
  // Snores at 2 s and 5 s, candidate at 6 s: 1 s after the latest, but 4 s after the first.
  assert.deepEqual(gateRun([gateEvent(2), gateEvent(5), gateEvent(6, true)]), { 2: true, 5: true, 6: true });
});

test('rhythm rule: limits stay 2 and 12 s and rescued sounds never anchor', () => {
  assert.deepEqual(gateRun([gateEvent(2, true), gateEvent(14.5)]), { 2: false, 14.5: true }, '12.5 s is too far');
  assert.deepEqual(gateRun([gateEvent(2, true), gateEvent(3.5)]), { 2: false, 3.5: true }, '1.5 s is too close');
  // 2 s is rescued by the snore at 6 s, 9 s by the same snore 3 s before it.
  // 20 s is in rhythm only with the rescued sound at 9 s, so it stays rejected.
  assert.deepEqual(gateRun([gateEvent(2, true), gateEvent(6), gateEvent(9, true), gateEvent(20, true)]), {
    2: true,
    6: true,
    9: true,
    20: false,
  });
});

test('rhythm rule: a long snore still in progress can rescue a rattle 11 s before it, live and offline alike', () => {
  for (const at of [12, 12.5, 13, 13.5]) {
    const scenario = Synth.compose(
      16000,
      20,
      [
        { type: 'rattle', at: 2 },
        { type: 'snore', at, duration: 2 },
      ],
      1,
    );
    const { events } = run(scenario);
    const live = new SessionStats();
    events.forEach((e) => live.add(e));
    assert.equal(events.length, 2);
    assert.ok(
      events.every((e) => e.isSnore),
      `snore at ${at} s: ${events.map((e) => e.reason)}`,
    );
    assert.equal(live.confirmed.length, 2, `snore at ${at} s`);
  }
  // The same night as a downloaded report (made by the external review), re-evaluated offline.
  const { eventsOf, reevaluate } = require('../scripts/evaluate.js');
  const offline = reevaluate(eventsOf(require('./fixtures/rhythm-boundary-report.json')));
  assert.deepEqual(
    offline.map((e) => [e.start, e.isSnore, !!e.rhythm]),
    [
      [2.112, true, true],
      [13.120000000000001, true, false],
    ],
  );
});

test('confirmation looks both ways when a rescued sound arrives after later snores', () => {
  // Gate order 6, then 3 (rescued once 8 arrives), then 8: 3 and 6 are 3 s apart.
  const stats = new SessionStats();
  const snore = (start, rhythm) => ({ isSnore: true, rhythm, start, end: start + 0.6, duration: 0.6, relDb: 20, clip: null });
  [snore(6), snore(3, true), snore(20)].forEach((e) => stats.add(e));
  assert.deepEqual(
    stats.confirmed.map((x) => x.start),
    [3, 6],
  );
});

test('an interruption: later events keep wall time and nothing is decided or confirmed across it', () => {
  const sr = 16000;
  const before = Synth.compose(
    sr,
    12,
    [
      { type: 'snore', at: 2 },
      { type: 'snore', at: 6 },
    ],
    3,
  );
  const after = Synth.compose(sr, 6, [{ type: 'rattle', at: 1 }], 3);
  const events = [];
  const stats = new SessionStats();
  const det = new SnoreDetector(sr, { onEvent: (e) => (events.push(e), stats.add(e)) });
  for (let i = 0; i < before.samples.length; i += 1024) det.process(before.samples.subarray(i, i + 1024));
  // 1 s without audio (e.g. a call), then the room again.
  const gapStart = det.clock;
  stats.addGap(gapStart, gapStart + 1);
  det.resumeAfterGap(1);
  assert.ok(Math.abs(det.clock - det.elapsed - 1) < 1e-9);
  for (let i = 0; i < after.samples.length; i += 1024) det.process(after.samples.subarray(i, i + 1024));
  det.flush();
  const rattle = events.find((e) => e.start > gapStart);
  assert.ok(rattle, 'rattle heard after the gap');
  assert.ok(Math.abs(rattle.start - (12 + 1 + 1)) < 0.3, `timed after the gap: ${rattle.start}`);
  // 8 s after the snore at 6 s, which would rescue it without the gap.
  assert.equal(rattle.isSnore, false, 'not rescued by a snore from before the gap');
  assert.equal(rattle.clip, null);
  assert.deepEqual(
    stats.confirmed.map((e) => Math.round(e.start)),
    [2, 6],
  );

  // Two snores 4 s apart with a gap between them do not confirm each other.
  const s2 = new SessionStats();
  s2.addGap(10, 11);
  const snore = (start) => ({ isSnore: true, start, end: start + 0.8, duration: 0.8, relDb: 20, clip: null });
  [2, 6, 8, 12].forEach((t) => s2.add(snore(t)));
  assert.deepEqual(
    s2.confirmed.map((e) => e.start),
    [2, 6, 8],
  );
});

test('quiet snores keep full 16-bit detail in their clips', () => {
  // A bedside phone records snores near -70 dBFS (real night 4: median peak -69 dBFS).
  // Clips used to be cut at that level and only turned up when played, leaving about
  // 25 distinct sample values: grainy. They are now turned up before the 16-bit cut.
  const demo = Synth.demoScenario(16000);
  const quiet = { ...demo, samples: demo.samples.map((x) => x * 0.01) }; // 40 dB quieter
  const { events } = run(quiet, { minAbsDb: -120 });
  const snores = events.filter((e) => e.isSnore && e.clip);
  assert.ok(snores.length >= 10, `found ${snores.length} quiet snores`);
  for (const e of snores) {
    const peak = e.clip.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    assert.ok(Math.abs(peak - 0.7 * 32767) <= 2, `clip peak ${peak} at listening level`);
    assert.ok(new Set(e.clip).size > 1000, `clip has ${new Set(e.clip).size} distinct values`);
  }
  // Counting does not depend on the clip: the same snores as at full level.
  const loud = run(demo).events.filter((e) => e.isSnore);
  assert.deepEqual(
    snores.map((e) => e.start),
    loud.map((e) => e.start),
  );
});
