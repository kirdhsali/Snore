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
