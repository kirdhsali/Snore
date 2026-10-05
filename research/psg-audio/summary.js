'use strict';
// PSG-Audio: all evaluated nights side by side (summary.json of each night folder).
//   node summary.js
const fs = require('fs');
const path = require('path');
const { DATA } = require('../common/paths.js');
const RES = path.join(DATA, 'results', 'psg-audio');
const nights = fs
  .readdirSync(RES)
  .filter((d) => fs.existsSync(path.join(RES, d, 'summary.json')))
  .sort()
  .map((d) => JSON.parse(fs.readFileSync(path.join(RES, d, 'summary.json'), 'utf8')));
const short = (n) => n.replace('-100507', '');
console.log(
  `PSG-Audio: ${nights.length} nights, ${nights.reduce((a, n) => a + n.hours, 0).toFixed(1)} h; cells: own sound % / snore sensor % (per hour)`,
);
console.log(''.padEnd(46) + nights.map((n) => short(n.night).padStart(18)).join(''));
for (const k of Object.keys(nights[0].rows)) {
  const cells = nights.map((n) => {
    const r = n.rows[k];
    if (!r || !r.n) return '0'.padStart(18);
    const s = `${((100 * r.own) / r.n).toFixed(0)}/${((100 * r.snoring) / r.n).toFixed(0)}`;
    return (k.startsWith('chance') ? s : `${s} (${r.perHour})`).padStart(18);
  });
  console.log(k.padEnd(46) + cells.join(''));
}
console.log('\nHigh without the breath rule, confirmed, by breath noise (all nights): own % / snore sensor % / YAMNet>=0.5 %');
for (const k of Object.keys(nights[0].highByBreath)) {
  const t = nights.reduce(
    (a, n) => ({
      n: a.n + n.highByBreath[k].n,
      own: a.own + n.highByBreath[k].own,
      sn: a.sn + n.highByBreath[k].snoring,
      y: a.y + n.highByBreath[k].yam,
    }),
    { n: 0, own: 0, sn: 0, y: 0 },
  );
  console.log(
    `  ${k.padEnd(6)} ${String(t.n).padStart(6)}   ${((100 * t.own) / t.n).toFixed(1)} / ${((100 * t.sn) / t.n).toFixed(1)} / ${((100 * t.y) / t.n).toFixed(1)}`,
  );
}
