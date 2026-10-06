'use strict';
// Two phones, one night: one near the sleeper's head, one 2-3 m away. A sound the sleeper makes is
// much louder at the near phone; a room sound is about as loud at both. That labels every sound
// the near phone heard as "own" or "room" without listening.
//   node research/two-phone/compare.js <near snore-report.json> <far snore-report.json> [out.json] [--gain=<dB>]
// Both files from the app (any version with peakDbfs, 1.11+; room-noise bands from 1.15). The
// optional output keeps the label of every sound; it holds no audio but belongs in the private
// folder, never in the repository. --gain sets the microphones' difference instead of measuring it.
const fs = require('fs');

const args = process.argv.slice(2);
const [nearFile, farFile, outFile] = args.filter((a) => !a.startsWith('--'));
const gainArg = args.find((a) => a.startsWith('--gain='));
if (!nearFile || !farFile) {
  console.error('usage: node research/two-phone/compare.js <near.json> <far.json> [out.json] [--gain=<dB>]');
  process.exit(1);
}
const OWN_DB = 6; // at least this much louder at the near phone (after the gain correction): own sound
const ROOM_DB = 3; // less than this: a room sound
const MATCH_SEC = 0.25; // onsets this close count as the same sound
const median = (xs) => {
  const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '–');

function load(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const t0 = Date.parse(r.startedAt) / 1000;
  const sounds = [
    ...r.snores.map((x) => ({ ...x, kind: x.confirmed ? 'confirmed snore' : 'possible snore' })),
    ...r.ignored.map((x) => ({ ...x, kind: `ignored: ${x.reason}` })),
  ]
    .map((x) => ({ ...x, t: t0 + x.offsetSec }))
    .sort((a, b) => a.t - b.t);
  const minutes = new Map();
  for (const m of (r.noise && r.noise.minutes) || []) if (m.backgroundDbfs != null) minutes.set(Math.round((t0 + m.offsetSec) / 60), m);
  const shadows = {};
  for (const [name, sh] of Object.entries(r.shadows || {}))
    shadows[name] = sh.snores.filter((x) => x.confirmed).map((x) => ({ ...x, t: t0 + x.offsetSec }));
  return { r, t0, sounds, minutes, shadows };
}

const near = load(nearFile);
const far = load(farFile);
const clock = (t) => new Date(t * 1000).toLocaleTimeString('de-CH', { timeZone: near.r.timeZone || 'UTC', hourCycle: 'h23' });

// Gain: the room's quiet background is about equally loud at both places, so the median difference
// of the per-minute levels is the difference between the two microphones. Only the octave bands
// 500-4000 Hz count: a hum or a motor next to one phone raises its low bands (the whole background
// level is shown for comparison).
const diffs = [];
const bandDiffs = [];
const bands = (near.r.noise && near.r.noise.bandsHz) || [];
for (const [m, x] of near.minutes) {
  const y = far.minutes.get(m);
  if (!y) continue;
  diffs.push(x.backgroundDbfs - y.backgroundDbfs);
  bands.forEach((hz, i) => {
    if (hz >= 500 && hz <= 4000 && x.bandsDbfs && y.bandsDbfs && x.bandsDbfs[i] != null && y.bandsDbfs[i] != null)
      bandDiffs.push(x.bandsDbfs[i] - y.bandsDbfs[i]);
  });
}
const gain = gainArg ? Number(gainArg.slice(7)) : (median(bandDiffs) ?? median(diffs));

// Clock: phone clocks and audio clocks differ by up to seconds over a night. Loud, sudden sounds
// (the clap at the start, knocks, doors) reach both phones at once; find the lag that lines most
// of them up, first over the whole night, then per hour around it.
const loud = (s) => s.sounds.filter((x) => x.aboveRoomDb >= 15 && (x.onsetJumpDb ?? 0) >= 10);
function bestLag(a, b, from, to, step) {
  const fits = [];
  for (let lag = from; lag <= to + 1e-9; lag += step) {
    let n = 0;
    let j = 0;
    for (const x of a) {
      while (j < b.length && b[j].t + lag < x.t - 0.1) j++;
      if (j < b.length && Math.abs(b[j].t + lag - x.t) <= 0.1) n++;
    }
    fits.push({ lag, n });
  }
  // Several lags line up the same sounds (within 0.1 s): take the middle of the best ones.
  const n = Math.max(...fits.map((f) => f.n));
  return { lag: median(fits.filter((f) => f.n === n).map((f) => f.lag)), n };
}
const loudNear = loud(near);
const loudFar = loud(far);
const night = bestLag(loudNear, loudFar, -60, 60, 0.02);
const hours = new Map();
for (let h = Math.floor(near.sounds[0].t / 3600); h * 3600 < near.sounds[near.sounds.length - 1].t; h++) {
  const inHour = (x) => x.t >= h * 3600 && x.t < (h + 1) * 3600;
  const fit = bestLag(loudNear.filter(inHour), loudFar.filter(inHour), night.lag - 2, night.lag + 2, 0.02);
  hours.set(h, fit.n >= 4 ? fit : { lag: night.lag, n: fit.n, fallback: true });
}
const lagAt = (t) => (hours.get(Math.floor(t / 3600)) || night).lag;

// Match a near sound with the far sound starting closest to it and label it.
const farT = far.sounds.map((x) => x.t);
function judge(x) {
  const want = x.t - lagAt(x.t);
  // The same sound: the far sound starting closest to it among those starting within MATCH_SEC or
  // overlapping it in time (each phone's detector starts and ends a sound at its own level, and the
  // near phone hears its own sounds start sooner). When they only overlap, the far peak may belong to
  // another part of a longer sound, so the difference can only come out too small (towards "room").
  let lo = 0;
  let hi = farT.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (farT[mid] < want - 60) lo = mid + 1;
    else hi = mid;
  }
  let best = null;
  for (let k = lo; k < farT.length && farT[k] <= want + x.durationSec + 0.1; k++) {
    const y = far.sounds[k];
    const together = Math.abs(y.t - want) <= MATCH_SEC || y.t + y.durationSec + 0.1 >= want;
    if (together && (!best || Math.abs(y.t - want) < Math.abs(best.t - want))) best = y;
  }
  if (best) x.inside = Math.abs(best.t - want) > MATCH_SEC;
  if (best) {
    x.far = best;
    x.deltaDb = x.peakDbfs - best.peakDbfs - gain;
  } else {
    // The far phone did not trigger: the sound stayed below its threshold there. That threshold is
    // taken high on purpose: the loudest of its background plus Normal's 8 dB margin, the minute's
    // 90th percentile and the sensitivity's gate (its floor moves within a minute).
    const m = far.minutes.get(Math.round(want / 60));
    const bg = m ? m.backgroundDbfs : median([...far.minutes.values()].map((v) => v.backgroundDbfs));
    const gate = { low: -65, normal: -75, high: -85 }[far.r.sensitivity] ?? -95;
    const threshold = Math.max(bg + 8, m && m.p90Dbfs != null ? m.p90Dbfs : -Infinity, gate);
    x.deltaAtLeastDb = x.peakDbfs - gain - threshold;
  }
  const d = x.deltaDb ?? x.deltaAtLeastDb;
  x.label = d >= OWN_DB ? 'own' : x.deltaDb != null && x.deltaDb < ROOM_DB ? 'room' : 'unclear';
  return x;
}
near.sounds.forEach(judge);
for (const xs of Object.values(near.shadows)) xs.forEach(judge);

console.log(`near: ${nearFile}\n  ${near.r.version}, ${near.r.sensitivity}, ${clock(near.t0)}, ${near.sounds.length} sounds`);
console.log(`far:  ${farFile}\n  ${far.r.version}, ${far.r.sensitivity}, ${clock(far.t0)}, ${far.sounds.length} sounds`);
const spread = (xs) =>
  xs.length ? [0.1, 0.5, 0.9].map((q) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))].toFixed(1)).join(' / ') : '–';
console.log(
  `\ngain used: ${gain.toFixed(1)} dB (${gainArg ? 'set by --gain' : bandDiffs.length ? 'measured in the bands 500-4000 Hz' : 'measured on the whole background'})`,
);
console.log(
  `  near minus far, p10 / median / p90 over ${diffs.length} minutes: bands 500-4000 Hz ${spread(bandDiffs)}; whole background ${spread(diffs)}`,
);
console.log(`clock: far + ${night.lag.toFixed(2)} s lines up ${night.n} of ${loudNear.length} loud sudden near sounds`);
console.log(
  `  per hour: ${[...hours]
    .map(([h, f]) => `${clock(h * 3600).slice(0, 2)}h ${f.lag.toFixed(2)} s (${f.n}${f.fallback ? ', night value' : ''})`)
    .join(', ')}`,
);
const first = near.sounds.filter((x) => x.t < near.t0 + 300 && x.far).sort((a, b) => b.peakDbfs - a.peakDbfs)[0];
if (first)
  console.log(
    `  loudest shared sound in the first 5 min (the clap?): ${clock(first.t)}, near ${first.peakDbfs} / far ${first.far.peakDbfs} dBFS`,
  );

const matched = near.sounds.filter((x) => x.deltaDb != null);
console.log(`\nmatched ${matched.length} of ${near.sounds.length} near sounds; level difference near - far - gain, 2 dB bins (count):`);
const bins = new Map();
for (const x of matched) {
  const b = Math.max(-10, Math.min(30, 2 * Math.floor(x.deltaDb / 2)));
  bins.set(b, (bins.get(b) || 0) + 1);
}
console.log(
  '  ' +
    [...bins]
      .sort((a, b) => a[0] - b[0])
      .map(([b, n]) => `${b}:${n}`)
      .join('  '),
);
console.log(`  labels: own >= ${OWN_DB} dB (or not heard far although it would have been), room < ${ROOM_DB} dB, unclear between`);

function table(title, groups) {
  console.log(`\n${title}`);
  console.log('  group                                   sounds   own    room   unclear  only near  median delta  (raw)');
  for (const [name, xs] of groups) {
    if (!xs.length) continue;
    const c = (l) => xs.filter((x) => x.label === l).length;
    const d = median(xs.map((x) => x.deltaDb));
    const raw = d == null ? '' : `  (${(median(xs.map((x) => x.deltaDb)) + gain).toFixed(1)})`;
    console.log(
      `  ${name.padEnd(38)} ${String(xs.length).padStart(6)}  ${pct(c('own'), xs.length).padStart(4)}  ${pct(c('room'), xs.length).padStart(5)}  ${pct(c('unclear'), xs.length).padStart(7)}  ${pct(xs.filter((x) => !x.far).length, xs.length).padStart(9)}  ${d == null ? '–' : d.toFixed(1).padStart(8)}${raw}`,
    );
  }
}
const kinds = [...new Set(near.sounds.map((x) => x.kind))].sort();
table(
  'Near phone, by verdict',
  kinds.map((k) => [k, near.sounds.filter((x) => x.kind === k)]),
);
const snoreLike = near.sounds.filter((x) => x.kind.endsWith('snore') || x.kind === 'ignored: no-breath');
table('Snore-like sounds (counted or set aside by the breath rule), by breath noise', [
  ['breath noise < 3 dB', snoreLike.filter((x) => x.breathRiseDb != null && x.breathRiseDb < 3)],
  ['breath noise 3-4.5 dB', snoreLike.filter((x) => x.breathRiseDb >= 3 && x.breathRiseDb < 4.5)],
  ['breath noise 4.5-6 dB', snoreLike.filter((x) => x.breathRiseDb >= 4.5 && x.breathRiseDb < 6)],
  ['breath noise >= 6 dB', snoreLike.filter((x) => x.breathRiseDb >= 6)],
]);

// Background tests: their confirmed snores, labelled the same way.
const mainConfirmed = near.sounds.filter((x) => x.kind === 'confirmed snore');
const isMain = (x) => mainConfirmed.some((m) => Math.abs(m.t - x.t) < 0.5);
const shadowGroups = [];
for (const [name, xs] of Object.entries(near.shadows)) {
  shadowGroups.push([`${name}: confirmed`, xs]);
  shadowGroups.push([`${name}: confirmed, not counted by the main`, xs.filter((x) => !isMain(x))]);
  shadowGroups.push([`main: confirmed, not by ${name}`, mainConfirmed.filter((m) => !xs.some((x) => Math.abs(m.t - x.t) < 0.5))]);
}
table('Background tests on the near phone', shadowGroups);

table(
  'Confirmed snores per clock hour',
  [...new Set(near.sounds.map((x) => clock(x.t).slice(0, 2)))].map((h) => [
    `${h}:00`,
    near.sounds.filter((x) => x.kind === 'confirmed snore' && clock(x.t).slice(0, 2) === h),
  ]),
);

const farConfirmed = far.sounds.filter((x) => x.kind === 'confirmed snore');
console.log(
  `\nfar phone: ${farConfirmed.length} confirmed snores (near: ${near.sounds.filter((x) => x.kind === 'confirmed snore').length})`,
);

if (outFile) {
  const keep = [
    'time',
    'offsetSec',
    'durationSec',
    'kind',
    'peakDbfs',
    'aboveRoomDb',
    'breathRiseDb',
    'centroidHz',
    'deltaDb',
    'deltaAtLeastDb',
    'label',
  ];
  fs.writeFileSync(
    outFile,
    JSON.stringify({
      gainDb: gain,
      lagSec: night.lag,
      sounds: near.sounds.map((x) => Object.fromEntries(keep.map((k) => [k, x[k] ?? null]))),
    }),
  );
  console.log(`labels written to ${outFile}`);
}
