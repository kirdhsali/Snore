'use strict';
// APSAA summary over all evaluated nights: rule variants, High-without-rule's confirmed snores by
// breath noise (with other tolerances and without the clock offset), and the chance level.
//   node summary.js   (reads $SNOREWATCH_DATA/results/apsaa and the CSVs in datasets/apsaa)
const fs = require('fs');
const path = require('path');
const { DATA } = require('../common/paths.js');
const { readSignal, readAnnotations } = require('../common/audio.js');
const RES = path.join(DATA, 'results', 'apsaa');
const SRC = path.join(DATA, 'datasets', 'apsaa');
const outs = fs
  .readdirSync(RES)
  .filter((f) => /^out-.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8')));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-').padStart(6);
const episodesOf = (o, tol, useLag) => {
  const shift = useLag ? -o.lagSec : 0;
  return readAnnotations(path.join(SRC, o.id, `${o.id}_Annotations.csv`))
    .filter((e) => e.name === 'Snore')
    .map((e) => [e.start - shift - tol, e.start + e.dur - shift + tol]);
};
let hours = 0;
let epMin = 0;
for (const o of outs) ((hours += o.hours), (epMin += o.episodeMin));
console.log(
  `APSAA: ${outs.length} nights, ${hours.toFixed(1)} h of audio at 4 kHz; annotated snoring ${(epMin / 60).toFixed(1)} h (${((100 * epMin) / 60 / hours).toFixed(1)}% of the time)`,
);
console.log(`audio-to-polygraph offset per night (s): ${outs.map((o) => o.lagSec).join(' ')}`);

// Chance level: Normal's confirmed sounds (their durations) placed at random times, 5 times each.
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let cn = 0;
let cep = 0;
let ceg = 0;
for (const o of outs) {
  const eps = episodesOf(o, 1, true);
  const eg = readSignal(path.join(SRC, o.id, `${o.id}_Snore_EG.csv`));
  const shift = -o.lagSec;
  for (const s of o.runs.normal.sounds)
    for (let k = 0; k < 5; k++) {
      const t = rnd() * (o.hours * 3600 - s.d);
      cn++;
      cep += eps.some(([a, b]) => t + s.d >= a && t <= b);
      let m = -Infinity;
      for (let i = Math.max(0, Math.floor((t + shift) * 10)); i <= Math.min(eg.length - 1, Math.ceil((t + s.d + shift) * 10)); i++)
        m = Math.max(m, eg[i]);
      ceg += m >= o.egP95;
    }
}
console.log(`chance (random times): in an episode ${pct(cep, cn)}, snore sensor above its p95 ${pct(ceg, cn)}\n`);

console.log('rule variant   confirmed   per h   in episode   sensor>p95   episodes with a snore');
for (const v of Object.keys(outs[0].runs)) {
  let c = 0;
  let ep = 0;
  let eg = 0;
  let hit = 0;
  let eps = 0;
  for (const o of outs)
    ((c += o.runs[v].confirmed),
      (ep += o.runs[v].inEpisode),
      (eg += o.runs[v].egActive),
      (hit += o.runs[v].episodesHit),
      (eps += o.episodes));
  console.log(
    `  ${v.padEnd(10)} ${String(c).padStart(9)} ${(c / hours).toFixed(0).padStart(7)}     ${pct(ep, c)}       ${pct(eg, c)}         ${pct(hit, eps)}`,
  );
}

const B = [
  ['<3', (b) => b != null && b < 3],
  ['3-4.5', (b) => b >= 3 && b < 4.5],
  ['4.5-6', (b) => b >= 4.5 && b < 6],
  ['>=6', (b) => b >= 6],
];
for (const [tol, useLag] of [
  [1, true],
  [5, true],
  [1, false],
  [5, false],
]) {
  const tot = Object.fromEntries(B.map(([k]) => [k, { n: 0, ep: 0, eg: 0 }]));
  let closerToSnores = 0;
  let closerToNoise = 0;
  for (const o of outs) {
    const eps = episodesOf(o, tol, useLag);
    const night = Object.fromEntries(B.map(([k]) => [k, { n: 0, ep: 0 }]));
    for (const s of o.runs.high_none.sounds)
      for (const [k, test] of B)
        if (test(s.br)) {
          const e = eps.some(([a, b]) => s.t + s.d >= a && s.t <= b);
          (tot[k].n++, (tot[k].ep += e), (tot[k].eg += s.eg >= o.egP95), night[k].n++, (night[k].ep += e));
        }
    const r = (x) => x.ep / x.n;
    const mid = { n: night['3-4.5'].n + night['4.5-6'].n, ep: night['3-4.5'].ep + night['4.5-6'].ep };
    if (mid.n >= 20 && night['<3'].n >= 20 && night['>=6'].n >= 20) {
      if (Math.abs(r(mid) - r(night['>=6'])) < Math.abs(r(mid) - r(night['<3']))) closerToSnores++;
      else closerToNoise++;
    }
  }
  console.log(
    `\nHigh without the breath rule, confirmed snores by breath noise (${tol} s around an episode, ${useLag ? 'offset corrected' : 'no offset correction'}):`,
  );
  for (const [k] of B)
    console.log(
      `  ${k.padEnd(6)} ${String(tot[k].n).padStart(6)}   in an episode ${pct(tot[k].ep, tot[k].n)}   snore sensor above p95 ${pct(tot[k].eg, tot[k].n)}`,
    );
  console.log(
    `  per night, the 3-6 dB band is closer to the >=6 dB band in ${closerToSnores} nights, to the <3 dB band in ${closerToNoise}`,
  );
}
