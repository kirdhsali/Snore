'use strict';
// One APSAA night (unpacked subject folder): every rule variant as its own full detector pass over
// the audio, against the technicians' snore episodes and the cannula snore sensor.
//   node evaluate.js <subject dir> <out.json>
// APSAA: Zenodo 10.5281/zenodo.14096541; academic and non-commercial use only, no redistribution.
const fs = require('fs');
const path = require('path');
const { app } = require('../common/paths.js');
const { readWav, readSignal, readAnnotations } = require('../common/audio.js');
const { SnoreDetector, SessionStats } = app('detector.js');

// The High question and today's rules, and the background tests as js/recorder.js runs them.
const VARIANTS = {
  normal: { sensitivity: 'normal' },
  low: { sensitivity: 'low' },
  high_none: { sensitivity: 'high', minBreathRiseDb: null },
  high_3: { sensitivity: 'high', minBreathRiseDb: 3 },
  high_4_5: { sensitivity: 'high', minBreathRiseDb: 4.5 },
  high_6: { sensitivity: 'high', minBreathRiseDb: 6 },
  knock: { sensitivity: 'normal', maxOnsetJumpDb: 20 },
  auto: { sensitivity: 'auto', minBreathRiseDb: 3, minLowRiseDb: 8, minPreRiseDb: 6, preRiseSec: 1 },
};
const TOL = 1; // s around an annotated episode

const [dir, outFile] = process.argv.slice(2);
const id = path.basename(dir);
const { sr, x } = readWav(path.join(dir, `${id}.wav`));
const eg = readSignal(path.join(dir, `${id}_Snore_EG.csv`)); // 10 Hz
const ann = readAnnotations(path.join(dir, `${id}_Annotations.csv`));

// Offset between the audio and the polygraph clock: best correlation (within +-10 s) of the audio's
// loudness with the snore sensor, both as logs at 10 Hz.
const step = sr / 10;
const n10 = Math.min(eg.length, Math.floor(x.length / step));
const X = new Float64Array(n10);
const Y = new Float64Array(n10);
for (let i = 0; i < n10; i++) {
  let s = 0;
  for (let k = 0; k < step; k++) s += x[i * step + k] ** 2;
  X[i] = Math.log10(Math.sqrt(s / step) + 1e-9);
  Y[i] = Math.log10(Math.max(1, eg[i]));
}
for (const a of [X, Y]) {
  let m = 0;
  let v = 0;
  for (const q of a) m += q;
  m /= a.length;
  for (const q of a) v += (q - m) ** 2;
  const sd = Math.sqrt(v / a.length) || 1;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - m) / sd;
}
let lag = 0;
let lagCorr = -1;
for (let L = -100; L <= 100; L++) {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, L); i < n10 + Math.min(0, L); i++) ((s += X[i] * Y[i - L]), c++);
  if (s / c > lagCorr) ((lagCorr = s / c), (lag = L));
}
const shift = -lag / 10; // polygraph time = audio time + shift
const episodes = ann.filter((e) => e.name === 'Snore').map((e) => ({ start: e.start - shift, end: e.start + e.dur - shift }));
const inEpisode = (t0, t1) => episodes.some((e) => t1 >= e.start - TOL && t0 <= e.end + TOL);
const sorted = Float64Array.from(eg).sort();
const egP95 = sorted[Math.floor(0.95 * sorted.length)];
const egMax = (t0, t1) => {
  let m = -Infinity;
  for (let i = Math.max(0, Math.floor((t0 + shift) * 10)); i <= Math.min(eg.length - 1, Math.ceil((t1 + shift) * 10)); i++)
    m = Math.max(m, eg[i]);
  return m;
};

const runs = {};
for (const [name, opts] of Object.entries(VARIANTS)) {
  const stats = new SessionStats();
  const det = new SnoreDetector(sr, { ...opts, keepClips: false, onEvent: (e) => stats.add(e) });
  for (let i = 0; i < x.length; i += 4096) det.process(x.subarray(i, Math.min(x.length, i + 4096)));
  det.flush();
  const conf = stats.confirmed;
  runs[name] = {
    snoreLike: stats.snores.length,
    confirmed: conf.length,
    inEpisode: conf.filter((s) => inEpisode(s.start, s.start + s.duration)).length,
    egActive: conf.filter((s) => egMax(s.start, s.start + s.duration) >= egP95).length,
    episodesHit: episodes.filter((e) => conf.some((s) => s.start + s.duration >= e.start - TOL && s.start <= e.end + TOL)).length,
    ignoredByReason: stats.summary(x.length / sr).ignoredByReason,
    // Per confirmed sound, for the breath-noise buckets and the chance level.
    sounds: ['normal', 'high_none'].includes(name)
      ? conf.map((s) => ({
          t: +s.start.toFixed(2),
          d: +s.duration.toFixed(2),
          br: s.breathRise == null ? null : +s.breathRise.toFixed(1),
          ep: inEpisode(s.start, s.start + s.duration),
          eg: egMax(s.start, s.start + s.duration),
        }))
      : undefined,
  };
}
const out = {
  id,
  sr,
  hours: +(x.length / sr / 3600).toFixed(3),
  lagSec: lag / 10,
  lagCorr: +lagCorr.toFixed(3),
  episodes: episodes.length,
  episodeMin: +(episodes.reduce((a, e) => a + e.end - e.start, 0) / 60).toFixed(1),
  egP95,
  runs,
};
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(
  `${id}: ${out.hours} h, offset ${out.lagSec} s, ${out.episodes} episodes; ` +
    Object.entries(runs)
      .map(([k, v]) => `${k} ${v.confirmed}`)
      .join(' '),
);
