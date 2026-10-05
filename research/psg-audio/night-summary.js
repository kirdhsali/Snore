'use strict';
// PSG-Audio night, pass 3: rules, High variants and YAMNet against two automatic labels, with the
// chance level: "the sleeper's own sound" (throat microphone >= 6 dB above its night median during
// the sound) and "snoring" (snore sensor above its night p95 during the sound).
//   node night-summary.js <night dir>       writes summary.json and prints a table
const fs = require('fs');
const path = require('path');
const { app } = require('../common/paths.js');
const { SessionStats } = app('detector.js');

const D = process.argv[2];
const env = (f) =>
  Float32Array.from(new Float32Array(fs.readFileSync(path.join(D, `env-${f}.f32`)).buffer.slice(0)), (v) => 20 * Math.log10(v + 1e-9));
const throat = env('trach');
const snore = env('snore');
const quantile = (a, p) => Float32Array.from(a).sort()[Math.floor(p * (a.length - 1))];
const throatMedian = quantile(throat, 0.5);
const snoreP95 = quantile(snore, 0.95);
const maxOver = (a, t, d) => {
  let m = -Infinity;
  for (let i = Math.max(0, Math.floor(t * 10)); i <= Math.min(a.length - 1, Math.ceil((t + d) * 10)); i++) m = Math.max(m, a[i]);
  return m;
};
const own = (e) => maxOver(throat, e.t, e.d) - throatMedian >= 6;
const snoring = (e) => maxOver(snore, e.t, e.d) >= snoreP95;
const ev = JSON.parse(fs.readFileSync(path.join(D, 'events-ai.json'), 'utf8'));
const hours = ev.seconds / 3600;
const confirmedOf = (list) => {
  const st = new SessionStats();
  list.forEach((e) => st.add({ isSnore: true, start: e.t, end: e.t + e.d, duration: e.d, relDb: e.rel, clip: null, _e: e }));
  return st.confirmed.map((s) => s._e);
};
const rows = {};
const row = (name, list) =>
  (rows[name] = {
    n: list.length,
    perHour: +(list.length / hours).toFixed(0),
    own: list.filter(own).length,
    snoring: list.filter(snoring).length,
  });
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const random = Array.from({ length: 20000 }, () => ({ t: rnd() * (ev.seconds - 2), d: 0.6 + rnd() }));
row('chance (random moments)', random);
for (const v of ['normal', 'low', 'high', 'high_3', 'high_4_5', 'high_6'])
  row(
    v,
    ev.events[v].filter((e) => e.snore && e.conf),
  );
const cand = ev.events.high.filter((e) => e.yam != null && e.d <= 4);
row('YAMNet >= 0.5 on candidates, rhythm-confirmed', confirmedOf(cand.filter((e) => e.yam >= 0.5)));
row(
  'Normal and YAMNet >= 0.5',
  ev.events.normal.filter((e) => e.snore && e.conf && e.yam != null && e.yam >= 0.5),
);
row(
  'Normal but YAMNet < 0.5',
  ev.events.normal.filter((e) => e.snore && e.conf && e.yam != null && e.yam < 0.5),
);
const buckets = {};
const hc = ev.events.high.filter((e) => e.snore && e.conf && e.br != null);
for (const [k, f] of [
  ['<3', (b) => b < 3],
  ['3-4.5', (b) => b >= 3 && b < 4.5],
  ['4.5-6', (b) => b >= 4.5 && b < 6],
  ['>=6', (b) => b >= 6],
]) {
  const l = hc.filter((e) => f(e.br));
  buckets[k] = { n: l.length, own: l.filter(own).length, snoring: l.filter(snoring).length, yam: l.filter((e) => e.yam >= 0.5).length };
}
const summary = { night: path.basename(D), hours: +hours.toFixed(2), rows, highByBreath: buckets };
fs.writeFileSync(path.join(D, 'summary.json'), JSON.stringify(summary, null, 1));
const p = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-').padStart(6);
console.log(`${summary.night}: ${summary.hours} h`);
for (const [k, r] of Object.entries(rows))
  console.log(
    `  ${k.padEnd(46)} ${String(r.n).padStart(6)} ${String(r.perHour).padStart(6)}/h   own ${p(r.own, r.n)}   snore sensor ${p(r.snoring, r.n)}`,
  );
for (const [k, b] of Object.entries(buckets))
  console.log(
    `  High, breath noise ${k.padEnd(6)} ${String(b.n).padStart(5)}   own ${p(b.own, b.n)}   snore sensor ${p(b.snoring, b.n)}   YAMNet>=0.5 ${p(b.yam, b.n)}`,
  );
