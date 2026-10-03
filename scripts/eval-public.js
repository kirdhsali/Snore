#!/usr/bin/env node
// Checks the detector against ESC-50, a public collection of 2,000 labelled
// 5-second sound clips (50 classes, 40 of them snoring):
// https://github.com/karolpiczak/ESC-50
//
//   npm run eval:public            # downloads ESC-50 (~600 MB) on first run
//   ESC50_DIR=/path/to/ESC-50 npm run eval:public
//
// Each clip is placed in 3 s of room noise at the clip's own quietest level
// (at least -80 dBFS, like a quiet bedroom) with its loudest moment at
// -50 dBFS, then run through the detector with default settings.
// The dataset is licensed CC BY-NC 3.0: it is only downloaded for testing and
// never added to this repository.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SnoreDetector, SessionStats } = require('../js/detector.js');
const Synth = require('../js/synth.js');

const DIR = process.env.ESC50_DIR || path.join(os.homedir(), '.cache', 'snorewatch', 'esc-50');
const PEAK_DB = -50;
// Sounds that can plausibly happen in a bedroom at night.
const NIGHT = [
  'breathing',
  'coughing',
  'sneezing',
  'laughing',
  'crying_baby',
  'footsteps',
  'door_wood_creaks',
  'door_wood_knock',
  'clock_tick',
  'clock_alarm',
  'mouse_click',
  'keyboard_typing',
  'water_drops',
  'drinking_sipping',
  'toilet_flush',
  'washing_machine',
  'vacuum_cleaner',
  'wind',
  'rain',
  'thunderstorm',
  'dog',
  'cat',
  'crickets',
  'engine',
  'car_horn',
];

function ensureDataset() {
  if (fs.existsSync(path.join(DIR, 'meta', 'esc50.csv'))) return;
  console.log(`Downloading ESC-50 to ${DIR} (about 600 MB, once)…`);
  fs.mkdirSync(path.dirname(DIR), { recursive: true });
  execFileSync('git', ['clone', '--depth', '1', 'https://github.com/karolpiczak/ESC-50', DIR], { stdio: 'inherit' });
}

function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmt;
  let data;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(off + 10), sampleRate: b.readUInt32LE(off + 12) };
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  const n = Math.floor(data.length / 2 / fmt.channels);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * fmt.channels) / 32768;
  return { sampleRate: fmt.sampleRate, x };
}

/** The clip in the middle of room noise, levelled like a bedside recording. */
function inRoom({ sampleRate: sr, x }, seed) {
  const win = Math.round(sr * 0.05);
  const frames = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let q = 0;
    for (let j = i; j < i + win; j++) q += x[j] * x[j];
    frames.push(Math.sqrt(q / win));
  }
  const peak = Math.max(...frames);
  const gain = peak > 0 ? Math.pow(10, PEAK_DB / 20) / peak : 0;
  frames.sort((a, b) => a - b);
  const quiet = Math.max(Math.pow(10, -80 / 20), frames[Math.floor(frames.length * 0.1)] * gain);
  const room = Synth.roomNoise(sr, Math.round(sr * 3) * 2 + x.length, 1, Synth.rng(seed));
  let rms = 0;
  for (const v of room) rms += v * v;
  rms = Math.sqrt(rms / room.length);
  for (let i = 0; i < room.length; i++) room[i] *= quiet / rms;
  const at = Math.round(sr * 3);
  for (let i = 0; i < x.length; i++) room[at + i] = room[at + i] * 0.3 + x[i] * gain;
  return room;
}

function main() {
  ensureDataset();
  const rows = fs
    .readFileSync(path.join(DIR, 'meta', 'esc50.csv'), 'utf8')
    .trim()
    .split('\n')
    .slice(1);
  // Current rules and the candidate breath-noise rules (tested in the background in the app).
  const variants = {
    'current rules': {},
    'with breath-noise rule': { minBreathRiseDb: 3 },
    'with the stricter breath-noise rule (6 dB)': { minBreathRiseDb: 6 },
  };
  const results = {};
  rows.forEach((line, i) => {
    const [file, , , category] = line.split(',');
    const clip = readWav(path.join(DIR, 'audio', file));
    const audio = inRoom(clip, i + 1);
    for (const [name, options] of Object.entries(variants)) {
      const det = new SnoreDetector(clip.sampleRate, options);
      const stats = new SessionStats();
      [...det.process(audio), ...det.flush()].forEach((e) => stats.add(e));
      const byClass = (results[name] ||= {});
      const c = (byClass[category] ||= { n: 0, detected: 0, confirmed: 0, missed: {} });
      c.n++;
      if (stats.snores.length) c.detected++;
      else for (const e of stats.ignored) c.missed[e.reason] = (c.missed[e.reason] || 0) + 1;
      if (stats.confirmed.length) c.confirmed++;
    }
  });
  for (const [name, byClass] of Object.entries(results)) printResults(name, byClass);
}

function printResults(title, byClass) {
  const sum = (classes, key) => classes.reduce((a, k) => a + byClass[k][key], 0);
  const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
  const snoring = byClass.snoring;
  const night = NIGHT.filter((k) => byClass[k]);
  const other = Object.keys(byClass).filter((k) => k !== 'snoring');
  const nNight = sum(night, 'n');
  const nOther = sum(other, 'n');

  console.log(`\nESC-50, ${title}\n`);
  console.log('                                 any snore-like sound   confirmed snore*');
  console.log(
    `  snoring clips recognised       ${`${snoring.detected}/${snoring.n}`.padEnd(8)} ${pct(snoring.detected, snoring.n).padStart(6)}        ${`${snoring.confirmed}/${snoring.n}`.padEnd(7)} ${pct(snoring.confirmed, snoring.n).padStart(6)}`,
  );
  console.log(
    `  night sounds counted as snore  ${`${sum(night, 'detected')}/${nNight}`.padEnd(8)} ${pct(sum(night, 'detected'), nNight).padStart(6)}        ${`${sum(night, 'confirmed')}/${nNight}`.padEnd(7)} ${pct(sum(night, 'confirmed'), nNight).padStart(6)}`,
  );
  console.log(
    `  all other sounds               ${`${sum(other, 'detected')}/${nOther}`.padEnd(8)} ${pct(sum(other, 'detected'), nOther).padStart(6)}        ${`${sum(other, 'confirmed')}/${nOther}`.padEnd(7)} ${pct(sum(other, 'confirmed'), nOther).padStart(6)}`,
  );
  console.log('  * a second snore 2-12 s away within the same 5 s clip; strict, since most clips hold one or two snores');
  console.log(`\n  missed snoring clips by reason: ${JSON.stringify(snoring.missed)}`);
  console.log('\n  night sounds counted as snore (clips of 40):');
  for (const k of night.sort((a, b) => byClass[b].detected - byClass[a].detected)) {
    if (byClass[k].detected)
      console.log(`    ${k.padEnd(18)} ${String(byClass[k].detected).padStart(2)}  (confirmed ${byClass[k].confirmed})`);
  }
}

main();
