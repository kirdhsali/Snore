'use strict';
// js/noise.js: the per-minute room noise profile the counting detector keeps (numbers only).
const test = require('node:test');
const assert = require('node:assert/strict');
const Synth = require('../js/synth.js');
const { SnoreDetector } = require('../js/detector.js');

/** Runs a detector with the noise profile over `samples` and returns its minutes. */
function profile(samples, sr = 16000, gapAt = null, gapSec = 0) {
  const det = new SnoreDetector(sr, { noiseProfile: true, keepClips: false });
  const cut = gapAt == null ? samples.length : Math.round(gapAt * sr);
  for (let i = 0; i < cut; i += 4096) det.process(samples.subarray(i, Math.min(cut, i + 4096)));
  if (gapAt != null) {
    det.resumeAfterGap(gapSec);
    for (let i = cut; i < samples.length; i += 4096) det.process(samples.subarray(i, i + 4096));
  }
  det.flush();
  return det.noise.finish();
}

const tone = (sr, seconds, hz, amp, rand) =>
  Float32Array.from({ length: sr * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr) + 1e-5 * (rand() * 2 - 1));

test('a steady 50 Hz hum shows in the right band, at its level, as the room tone', () => {
  for (const sr of [48000, 16000]) {
    const minutes = profile(tone(sr, 150, 50, 0.01, Synth.rng(1)), sr); // RMS 0.0071 = -43 dBFS
    assert.equal(minutes.length, 3, `${minutes.length} minutes at ${sr} Hz`);
    for (const m of minutes) {
      const loudest = m.bandsDb.indexOf(Math.max(...m.bandsDb));
      assert.equal([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000][loudest], 63, 'the hum is in the 63 Hz octave');
      assert.ok(Math.abs(m.bandsDb[loudest] + 43) < 1.5, `band level ${m.bandsDb[loudest].toFixed(1)} dBFS`);
      assert.ok(Math.abs(m.backgroundDb + 43) < 1, `background ${m.backgroundDb.toFixed(1)} dBFS`);
      assert.ok(Math.abs(m.humHz - 50) < 3, `hum at ${m.humHz.toFixed(1)} Hz`);
      assert.ok(m.humDb >= 20, `hum stands out by ${m.humDb.toFixed(0)} dB`);
    }
  }
});

test('snores do not count as background; a device switching on does', () => {
  const sr = 16000;
  const plan = [];
  for (let t = 5; t < 175; t += 4) plan.push({ type: 'snore', at: t, amp: 0.02 });
  const quiet = Synth.compose(sr, 180, [], 2, 0.002).samples;
  const snoring = Synth.compose(sr, 180, plan, 2, 0.002).samples;
  const a = profile(quiet);
  const b = profile(snoring);
  a.forEach((m, i) => {
    assert.ok(
      Math.abs(b[i].backgroundDb - m.backgroundDb) < 1.5,
      `minute ${i}: background ${b[i].backgroundDb.toFixed(1)} vs ${m.backgroundDb.toFixed(1)}`,
    );
    assert.ok(b[i].p90Db > m.p90Db + 6, 'the loud moments of the minute show the snores');
    assert.equal(m.humHz, null, 'no tone in plain room noise');
  });
  // Minutes 2 and 3 with a fan 10 dB above the room.
  const fan = Synth.compose(sr, 240, [], 3, 0.002).samples;
  const extra = Synth.compose(sr, 240, [], 4, 0.002 * Math.sqrt(9)).samples;
  for (let i = 60 * sr; i < 180 * sr; i++) fan[i] += extra[i];
  const c = profile(fan);
  const step = c[1].backgroundDb - c[0].backgroundDb;
  assert.ok(step > 8 && step < 12, `background rises ${step.toFixed(1)} dB while the device runs`);
  assert.ok(Math.abs(c[3].backgroundDb - c[0].backgroundDb) < 1.5, 'and falls back when it stops');
});

test('no minutes are made up during an interruption', () => {
  const sr = 16000;
  const minutes = profile(Synth.compose(sr, 150, [], 5, 0.002).samples, sr, 70, 200); // 200 s without audio after 70 s
  assert.deepEqual(
    minutes.map((m) => m.t),
    [0, 60, 240, 300],
    'minutes on the night clock: 0-70 s, then 270-350 s',
  );
  assert.ok(minutes[1].quietSec < 12 && minutes[2].quietSec < 32, 'partly recorded minutes say so');
});

// ----- findings from the per-minute profile -----
const { summarize, describe } = require('../js/noise.js');
const at = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000];
/** A night of `n` minutes: background -89 dBFS, quiet bands, no tone; `edit(i, m)` changes minute i. */
function minutes(n, edit = () => {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = {
      offsetSec: i * 60,
      quietSec: 55,
      backgroundDbfs: -89,
      p10Dbfs: -91,
      p90Dbfs: -87,
      bandsDbfs: BANDS.map(() => -105),
      humHz: null,
      humDb: null,
    };
    edit(i, m);
    out.push(m);
  }
  return { minuteSec: 60, bandsHz: BANDS, minutes: out };
}

test('a device switching on at a steady rhythm is one finding, with when, how often and how much', () => {
  const noise = minutes(300, (i, m) => {
    if (i >= 30 && i < 260 && (i - 30) % 52 < 22) m.backgroundDbfs = -79; // on for 22 min every 52 min
  });
  const s = summarize(noise);
  assert.equal(s.cycles.count, 5);
  assert.ok(s.cycles.regular && Math.abs(s.cycles.period - 52) <= 1 && Math.abs(s.cycles.minutes - 22) <= 2, JSON.stringify(s.cycles));
  assert.ok(Math.abs(s.cycles.stepDb - 10) < 1);
  assert.deepEqual(s.masked, [], 'its loud stretches are part of the cycle sentence');
  const text = describe(s, at);
  assert.match(
    text[0],
    /switched on 5 times between 00:30 and 04:20, about every 52 min, for about 2\d min each time, and made the room 10 dB louder/,
  );
});

test('a steady tone is reported only when its pitch holds; mains hum is told apart from a motor', () => {
  const mains = summarize(minutes(120, (i, m) => (m.humHz = 50 + (i % 3) * 0.4)));
  assert.ok(mains.tone && mains.tone.mains && mains.tone.share > 0.9);
  assert.match(describe(mains, at)[0], /about 50 Hz .* mains hum/);
  const motor = summarize(minutes(120, (i, m) => (m.humHz = 74 + (i % 5))));
  assert.ok(motor.tone && !motor.tone.mains);
  assert.match(describe(motor, at)[0], /motor or fan/);
  // Readings that jump around (no real tone) are not a finding.
  const scattered = summarize(minutes(120, (i, m) => (m.humHz = 55 + ((i * 37) % 45))));
  assert.equal(scattered.tone, null);
});

test("the sleeper's own sounds are not blamed on the room; a quiet night says so", () => {
  const noisy = (i, m) => {
    if (i >= 60 && i < 90) m.bandsDbfs = m.bandsDbfs.map((v, k) => (BANDS[k] >= 500 && BANDS[k] <= 4000 ? v + 8 : v));
  };
  const s = summarize(minutes(180, noisy));
  assert.equal(s.stretches.length, 1, 'mid and high pitches raised for 30 min');
  assert.match(describe(s, at).join(' '), /01:00–01:30: a steady sound in the middle and high pitches \(8 dB/);
  const snoreTimes = [];
  for (let t = 3600; t < 5400; t += 40) snoreTimes.push(t);
  assert.deepEqual(summarize(minutes(180, noisy), snoreTimes).stretches, [], 'snoring then: the sound was the sleeper');
  assert.deepEqual(describe(summarize(minutes(180)), at), ['The room stayed quiet and steady all night.']);
});

test('a loud stretch that is not a cycle says when quiet snores could be missed', () => {
  const s = summarize(minutes(240, (i, m) => (m.backgroundDbfs = i >= 120 && i < 180 ? -81 : -89)));
  assert.equal(s.masked.length, 1);
  assert.match(
    describe(s, at).join(' '),
    /02:00–03:00: the room was 8 dB louder than at its quietest; quiet snores could be missed then\./,
  );
});
