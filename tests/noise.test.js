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
  // Night 6: a real mains hum read as 46-55 Hz from minute to minute (coarse FFT bins), median 50.
  const readings = [50, 49, 52, 50, 51, 53, 50, 48, 54, 50, 49, 52];
  const home = summarize(minutes(120, (i, m) => (m.humHz = readings[i % readings.length])));
  assert.ok(home.tone && home.tone.mains, 'scattered readings around 50 Hz are still mains hum');
  assert.match(describe(home, at)[0], /mains hum/);
  const near = summarize(minutes(120, (i, m) => (m.humHz = 54 + (i % 2))));
  assert.ok(near.tone && !near.tone.mains, 'a motor near 54 Hz is not mains hum');
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

/** The same minutes with `gapMinutes` not recorded before minute `from` (an interruption). */
function withGap(noise, from, gapMinutes) {
  return { ...noise, minutes: noise.minutes.map((m, i) => (i >= from ? { ...m, offsetSec: m.offsetSec + gapMinutes * 60 } : m)) };
}

test('findings never join minutes across an hour that was not recorded (review N1)', () => {
  // The review's case: 20 quiet minutes, 6 louder, an hour not recorded, 6 louder, 20 quiet.
  const noise = withGap(
    minutes(52, (i, m) => {
      if (i >= 20 && i < 32) {
        m.backgroundDbfs = -81;
        m.p90Dbfs = -79;
        m.bandsDbfs = m.bandsDbfs.map((v, k) => (BANDS[k] >= 500 ? -97 : v));
      }
    }),
    26,
    60,
  );
  const s = summarize(noise);
  assert.equal(s.complete, false);
  assert.deepEqual(s.stretches, [], 'two 6-minute stretches are each too short for a finding');
  assert.deepEqual(s.masked, []);
  assert.equal(s.cycles, null, 'a stretch cut by the gap has no known start or end');
  assert.deepEqual(describe(s, at), ['The room stayed quiet and steady while it was recorded.']);
  // Long enough on both sides: two findings, each ending or starting at the gap, none across it.
  const longer = summarize(
    withGap(
      minutes(70, (i, m) => (m.backgroundDbfs = i >= 20 && i < 50 ? -81 : -89)),
      35,
      60,
    ),
  );
  assert.deepEqual(
    longer.masked.map((x) => [x.start / 60, x.end / 60]),
    [
      [20, 35],
      [95, 110],
    ],
  );
  assert.equal(longer.cycles, null);
});

test('minutes without a background measurement are not treated as neighbours of the minutes around them', () => {
  // 30 louder minutes, 15 recorded minutes with no quiet moment (no background), 30 louder.
  const noise = minutes(120, (i, m) => {
    if (i >= 20 && i < 95) m.backgroundDbfs = i >= 50 && i < 65 ? null : -81;
  });
  const s = summarize(noise);
  assert.equal(s.complete, true, 'those minutes were recorded');
  assert.deepEqual(
    s.masked.map((x) => [x.start / 60, x.end / 60]),
    [
      [20, 50],
      [65, 95],
    ],
    'not one stretch from 20 to 95 min',
  );
  // A few such minutes inside a stretch do not split it (as a few quieter minutes do not).
  const short = summarize(
    minutes(120, (i, m) => {
      if (i >= 20 && i < 95) m.backgroundDbfs = i >= 50 && i < 53 ? null : -81;
    }),
  );
  assert.deepEqual(
    short.masked.map((x) => [x.start / 60, x.end / 60]),
    [[20, 95]],
  );
});

test('a steady tone needs 7 of 10 clock minutes, not 10 minutes either side of a gap', () => {
  const hum = (from, to) => (i, m) => (m.humHz = i >= from && i < to ? 50 : null);
  assert.ok(summarize(minutes(50, hum(20, 30))).tone, '10 minutes of hum in a row');
  assert.equal(summarize(withGap(minutes(50, hum(20, 30)), 25, 60)).tone, null, '5 minutes, an hour not recorded, 5 minutes');
  // With a gap, the share is of the time recorded and says so.
  const s = summarize(withGap(minutes(120, hum(0, 120)), 60, 30));
  assert.ok(s.tone && s.tone.share > 0.9);
  assert.match(describe(s, at)[0], /for 100% of the recorded time: typical of mains hum/);
  assert.match(describe(summarize(minutes(120, hum(0, 120))), at)[0], /for 100% of the night:/);
});
