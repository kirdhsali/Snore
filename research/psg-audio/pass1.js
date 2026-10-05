'use strict';
// PSG-Audio night, pass 1: streams the hourly EDF parts once, runs every rule variant as its own
// detector on the room microphone (48 kHz), keeps 10 Hz envelopes of the room microphone, the
// throat (tracheal) microphone, the snore sensor and the airflow, and writes the room microphone at
// 16 kHz for YAMNet (mic16k.f32, deleted again by night.sh).
//   node pass1.js <out dir> part1.edf part2.edf ...
// PSG-Audio: Korompili et al. 2021, CC BY 4.0 (Science Data Bank 10.11922/sciencedb.00345).
const fs = require('fs');
const path = require('path');
const { app } = require('../common/paths.js');
const { readEdf } = require('../common/audio.js');
const { SnoreDetector, SessionStats } = app('detector.js');

const [outDir, ...parts] = process.argv.slice(2);
const VARIANTS = {
  normal: { sensitivity: 'normal' },
  low: { sensitivity: 'low' },
  high: { sensitivity: 'high', minBreathRiseDb: null }, // also the candidate list for YAMNet
  high_3: { sensitivity: 'high', minBreathRiseDb: 3 },
  high_4_5: { sensitivity: 'high', minBreathRiseDb: 4.5 },
  high_6: { sensitivity: 'high', minBreathRiseDb: 6 },
};
const SR = 48000;
const stats = {};
const dets = {};
for (const [k, o] of Object.entries(VARIANTS)) {
  stats[k] = new SessionStats();
  dets[k] = new SnoreDetector(SR, { ...o, keepClips: false, onEvent: (e) => stats[k].add(e) });
}
const env = { mic: [], trach: [], snore: [], flow: [] };
const out16 = fs.openSync(path.join(outDir, 'mic16k.f32'), 'w');
// 48 -> 16 kHz: windowed-sinc low-pass at 7.2 kHz, then every third sample.
const TAPS = 63;
const h = [];
for (let i = 0; i < TAPS; i++) {
  const n = i - (TAPS - 1) / 2;
  const fc = 7200 / SR;
  h.push((n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (TAPS - 1))));
}
const hSum = h.reduce((a, b) => a + b, 0);
for (let i = 0; i < TAPS; i++) h[i] /= hSum;
let hist = new Float32Array(TAPS - 1);
let phase = 0;
let seconds = 0;
const rms = (x, n, k) => {
  let s = 0;
  for (let j = k * n; j < (k + 1) * n; j++) s += x[j] * x[j];
  return Math.sqrt(s / n);
};
for (const file of parts) {
  const H = readEdf(file, ['Mic', 'Tracheal', 'Snore', 'Flow Patient'], (rec) => {
    const mic = rec.Mic;
    if (mic.length !== SR) throw new Error(`${file}: Mic at ${mic.length} Hz, expected ${SR}`);
    for (const d of Object.values(dets)) d.process(mic);
    for (let k = 0; k < 10; k++) {
      env.mic.push(rms(mic, 4800, k));
      env.trach.push(rms(rec.Tracheal, rec.Tracheal.length / 10, k));
      env.snore.push(rms(rec.Snore, rec.Snore.length / 10, k));
      const f = rec['Flow Patient'];
      const n = f.length / 10;
      env.flow.push(f.slice(k * n, (k + 1) * n).reduce((a, b) => a + b, 0) / n);
    }
    const ext = new Float32Array(TAPS - 1 + mic.length);
    ext.set(hist);
    ext.set(mic, TAPS - 1);
    const y = new Float32Array(Math.ceil(mic.length / 3));
    let m = 0;
    for (let j = phase; j < mic.length; j += 3) {
      let v = 0;
      for (let k = 0; k < TAPS; k++) v += ext[j + k] * h[k];
      y[m++] = v;
    }
    phase = (phase + 3 - (mic.length % 3)) % 3;
    hist = ext.slice(ext.length - (TAPS - 1));
    fs.writeSync(out16, Buffer.from(y.buffer, 0, m * 4));
    seconds++;
  });
  console.log(`${path.basename(file)}: ${H.nrec} s, ${seconds} s so far`);
}
fs.closeSync(out16);
for (const d of Object.values(dets)) d.flush();
const events = {};
for (const [k, st] of Object.entries(stats))
  events[k] = [...st.snores.map((e) => ({ ...e, snore: true })), ...st.ignored.map((e) => ({ ...e, snore: false }))]
    .sort((a, b) => a.start - b.start)
    .map((e) => ({
      t: +e.start.toFixed(3),
      d: +e.duration.toFixed(3),
      snore: e.snore,
      conf: !!e.confirmed,
      reason: e.reason || null,
      rel: +(e.relDb || 0).toFixed(1),
      br: e.breathRise == null ? null : +e.breathRise.toFixed(1),
    }));
fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify({ seconds, events }));
for (const [k, a] of Object.entries(env)) fs.writeFileSync(path.join(outDir, `env-${k}.f32`), Buffer.from(Float32Array.from(a).buffer));
console.log(
  Object.entries(events)
    .map(([k, v]) => `${k} ${v.filter((e) => e.snore && e.conf).length} confirmed`)
    .join(', '),
);
