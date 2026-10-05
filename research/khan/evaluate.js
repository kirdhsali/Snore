'use strict';
// Khan clips through the detector: each 1 s clip faded into a quiet room (-80 dBFS) at three
// levels, every rule variant as its own detector; why snores were missed; the loudest sound's
// measurements; and what a higher pitch (centroid) limit would trade, also on ESC-50.
//   research/khan/fetch.sh first; then: node research/khan/evaluate.js
// ESC-50 is the checkout of `npm run eval:public` (ESC50_DIR or $SNOREWATCH_DATA/esc-50).
const fs = require('fs');
const path = require('path');
const { app, DATA } = require('../common/paths.js');
const { readWav, inRoom } = require('../common/audio.js');
const { SnoreDetector, SessionStats } = app('detector.js');

const K = path.join(DATA, 'datasets', 'khan', 'Snoring_Dataset_@16000');
const E = process.env.ESC50_DIR || path.join(DATA, 'esc-50');
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
const NIGHT =
  'breathing coughing sneezing laughing crying_baby footsteps door_wood_creaks door_wood_knock clock_tick clock_alarm mouse_click keyboard_typing water_drops drinking_sipping toilet_flush washing_machine vacuum_cleaner wind rain thunderstorm dog cat crickets engine car_horn'.split(
    ' ',
  );
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`.padStart(6);
const run = (audio, sr, opts) => {
  const det = new SnoreDetector(sr, { ...opts, keepClips: false });
  const st = new SessionStats();
  const events = [...det.process(audio), ...det.flush()];
  events.forEach((e) => st.add(e));
  return { st, events };
};

const clips = [];
for (const [label, folder] of [
  ['snore', 'snoring'],
  ['other', 'no_snoring'],
])
  for (const f of fs.readdirSync(path.join(K, folder)).filter((x) => x.endsWith('.wav')))
    clips.push({ label, idx: Number(f.match(/_(\d+)\.wav$/)[1]), file: path.join(K, folder, f) });
clips.sort((a, b) => (a.label === b.label ? a.idx - b.idx : a.label < b.label ? 1 : -1));
const nSnore = clips.filter((c) => c.label === 'snore').length;
const nOther = clips.length - nSnore;

// 1. Every variant at three levels.
console.log(`Khan: ${nSnore} snoring + ${nOther} other 1 s clips in a -80 dBFS room; "found" = at least one snore-like sound`);
const res = {};
const loudest = [];
clips.forEach((c, i) => {
  const clip = readWav(c.file);
  for (const level of [-50, -60, -66]) {
    const audio = inRoom(clip, level, -80, i + 1);
    for (const [name, opts] of Object.entries(VARIANTS)) {
      const { st, events } = run(audio, clip.sr, opts);
      const r = ((res[level] ||= {})[name] ||= { snore: { found: 0, miss: {} }, other: { found: 0, blocks: Array(10).fill(0) } })[c.label];
      const found = st.snores.length > 0;
      if (found) {
        r.found++;
        if (c.label === 'other') r.blocks[Math.floor(c.idx / 50)]++;
      } else if (c.label === 'snore') {
        const near = events.filter((e) => !e.isSnore && e.start < 4.2 && e.start + e.duration > 2.9).sort((a, b) => b.relDb - a.relDb);
        const why = near.length ? near[0].reason : 'no sound';
        r.miss[why] = (r.miss[why] || 0) + 1;
      }
      if (level === -50 && name === 'normal') loudest.push({ label: c.label, idx: c.idx, e: events.sort((a, b) => b.relDb - a.relDb)[0] });
    }
  }
});
for (const level of Object.keys(res).sort((a, b) => b - a)) {
  console.log(
    `\nclip peak ${level} dBFS (${Number(level) + 80} dB above the room)\n  variant      snoring found   others found   missed snoring by reason`,
  );
  for (const [name, r] of Object.entries(res[level]))
    console.log(
      `  ${name.padEnd(10)}  ${pct(r.snore.found, nSnore)}         ${pct(r.other.found, nOther)}       ${JSON.stringify(r.snore.miss)}`,
    );
  console.log(
    `  others found by Normal per block of 50 (the ten categories; their order is not documented): ${res[level].normal.other.blocks.join(' ')}`,
  );
}

// 2. The loudest sound of each clip (Normal, -50 dBFS): pitch and brightness.
const q = (xs, p) => {
  const s = xs.filter((v) => v != null).sort((a, b) => a - b);
  return s.length ? Math.round(100 * s[Math.floor(p * (s.length - 1))]) / 100 : null;
};
const describe = (label, list) => {
  const ev = list.map((x) => x.e).filter(Boolean);
  const tb = ev.filter((e) => e.reason === 'too-bright');
  console.log(
    `  ${label}: centroid Hz p25/50/75 ${q(
      ev.map((e) => e.centroid),
      0.25,
    )}/${q(
      ev.map((e) => e.centroid),
      0.5,
    )}/${q(
      ev.map((e) => e.centroid),
      0.75,
    )}; too bright ${tb.length} (centroid > 500 Hz ${tb.filter((e) => e.centroid > 500).length}, 1-4 kHz share > 0.2 ${tb.filter((e) => e.highRatio > 0.2).length})`,
  );
};
console.log('\nLoudest sound per clip (Normal, -50 dBFS):');
describe(
  'Khan snoring',
  loudest.filter((x) => x.label === 'snore'),
);
for (let b = 0; b < 10; b++)
  describe(
    `Khan other, block ${b}`,
    loudest.filter((x) => x.label === 'other' && Math.floor(x.idx / 50) === b),
  );

// 3. What a higher centroid limit would trade (Normal), Khan in the quiet room, ESC-50 in its benchmark room.
if (fs.existsSync(path.join(E, 'meta', 'esc50.csv'))) {
  const rows = fs
    .readFileSync(path.join(E, 'meta', 'esc50.csv'), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','));
  const sets = {
    'Khan snoring': { files: clips.filter((c) => c.label === 'snore').map((c) => c.file), room: -80 },
    'Khan other': { files: clips.filter((c) => c.label === 'other').map((c) => c.file), room: -80 },
    'ESC-50 snoring': { files: rows.filter((r) => r[3] === 'snoring').map((r) => path.join(E, 'audio', r[0])), room: null },
    'ESC-50 night sounds': { files: rows.filter((r) => NIGHT.includes(r[3])).map((r) => path.join(E, 'audio', r[0])), room: null },
  };
  const limits = [500, 650, 800, 1000];
  console.log('\nNormal with another centroid limit: share of clips with a snore-like sound (confirmed in brackets)');
  console.log('  ' + ''.padEnd(22) + limits.map((l) => `<= ${l} Hz`.padEnd(18)).join(''));
  for (const [name, s] of Object.entries(sets)) {
    const cells = limits.map(() => ({ found: 0, conf: 0 }));
    s.files.forEach((file, i) => {
      const clip = readWav(file);
      const audio = inRoom(clip, -50, s.room, i + 1);
      limits.forEach((lim, k) => {
        const { st } = run(audio, clip.sr, { maxCentroid: lim });
        cells[k].found += st.snores.length > 0;
        cells[k].conf += st.confirmed.length > 0;
      });
    });
    console.log(
      `  ${name.padEnd(22)}` +
        cells.map((c) => `${pct(c.found, s.files.length)} (${pct(c.conf, s.files.length).trim()})`.padEnd(18)).join('') +
        `n ${s.files.length}`,
    );
  }
} else console.log(`\n(ESC-50 not found at ${E}: run npm run eval:public once for the centroid comparison)`);
