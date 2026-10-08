#!/usr/bin/env node
// Reference outputs of the detector: fixed synthetic nights (js/synth.js, seeded) at a phone's
// sample rates, stored as 16-bit audio as a WAV file holds it, run through the app's analysis
// (scripts/analyze.js) into the data file. tests/reference.test.js checks that the code still
// gives exactly these files; a port (the Swift app) checks its own output against them on the
// same audio (docs/DETECTOR.md, "Reference outputs").
//
//   npm run reference                 checks the stored files (as the test does)
//   npm run reference -- --update     rewrites tests/fixtures/reference/*.json after an intended change
//   npm run reference -- --wav <dir>  also writes each night's audio as <name>.wav for a port's tests
'use strict';
const fs = require('fs');
const path = require('path');
const Synth = require('../js/synth.js');
const { encodeWav } = require('../js/detector.js');
const { analyzeSamples } = require('./analyze.js');

const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'reference');

/** A busy night: every kind of sound the detector must count or set aside, over a mains hum. */
function busyNight(sr) {
  const r = Synth.rng(11);
  const plan = [];
  for (const from of [10, 70, 130]) plan.push(...Synth.snoreRun(from, 8, r).map((p) => ({ ...p, amp: 0.003 * (0.6 + r()) })));
  plan.push({ type: 'rattle', at: 40.5 }, { type: 'rattle', at: 101.5 }); // rescued by the snores around them
  plan.push({ type: 'rattle', at: 190 }); // alone: waits for a snore in rhythm, rejected 12 s later
  for (const at of [195, 199, 203, 207]) plan.push({ type: 'swell', at, amp: 0.02 }); // deep swells: 'rumble'
  plan.push({ type: 'knock', at: 212 }, { type: 'bump', at: 216 }, { type: 'speech', at: 220 }, { type: 'cough', at: 226 }); // bump: a possible snore
  plan.push({ type: 'car', at: 230 }, { type: 'rumble', at: 240 });
  const night = Synth.compose(sr, 270, plan, 11, 0.0004, 'hum');
  addTones(night.samples, sr, 250, 1, 0.005, [120, 850]); // dull but half above 800 Hz: 'not-low'
  return night;
}

/** Adds equal sine tones at `hz` with a smooth envelope (no js/synth.js sound reaches 'not-low'). */
function addTones(samples, sr, at, seconds, amp, hz) {
  const from = Math.round(at * sr);
  const n = Math.round(seconds * sr);
  for (let i = 0; i < n; i++) {
    const env = Math.sin((Math.PI * i) / n) ** 2;
    for (const f of hz) samples[from + i] += amp * env * Math.sin((2 * Math.PI * f * i) / sr);
  }
}

/** A quiet bedroom with deep rumble, recorded on High: quiet snores and rumble near the gate. */
function quietRumbleNight(sr) {
  const r = Synth.rng(5);
  const plan = [];
  for (const from of [20, 90]) plan.push(...Synth.snoreRun(from, 8, r).map((p) => ({ ...p, amp: 0.0004 * (0.6 + r()) })));
  plan.push({ type: 'rumble', at: 60 }, { type: 'knock', at: 75, amp: 0.002 });
  return Synth.compose(sr, 150, plan, 5, 0.00006, 'deep');
}

const SCENARIOS = [
  { name: 'demo-48000', sampleRate: 48000, sensitivity: 'normal', build: (sr) => Synth.demoScenario(sr) },
  { name: 'demo-44100', sampleRate: 44100, sensitivity: 'normal', build: (sr) => Synth.demoScenario(sr) },
  { name: 'busy-hum-48000', sampleRate: 48000, sensitivity: 'normal', build: busyNight },
  { name: 'quiet-rumble-high-48000', sampleRate: 48000, sensitivity: 'high', build: quietRumbleNight },
];

/** The scenario's audio as 16-bit samples, the way a WAV file stores it. */
function pcm16(scenario) {
  const { samples } = scenario.build(scenario.sampleRate);
  return Int16Array.from(samples, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
}

/** The data file the analysis writes for the scenario (read back from 16-bit as scripts/analyze.js reads a WAV). */
function referenceReport(scenario) {
  const pcm = pcm16(scenario);
  const samples = Float32Array.from(pcm, (x) => x / 32768);
  const { report } = analyzeSamples(samples, scenario.sampleRate, { sensitivity: scenario.sensitivity, version: 'reference' });
  return JSON.parse(JSON.stringify(report));
}

const fileOf = (scenario) => path.join(DIR, `${scenario.name}.json`);

function main(argv) {
  const update = argv.includes('--update');
  const wavDir = argv.includes('--wav') ? argv[argv.indexOf('--wav') + 1] : null;
  let changed = 0;
  for (const sc of SCENARIOS) {
    const report = referenceReport(sc);
    const text = `${JSON.stringify(report, null, 1)}\n`;
    const old = fs.existsSync(fileOf(sc)) ? fs.readFileSync(fileOf(sc), 'utf8') : null;
    const same = old === text;
    if (!same) changed++;
    if (update) {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(fileOf(sc), text);
    }
    if (wavDir) {
      fs.mkdirSync(wavDir, { recursive: true });
      fs.writeFileSync(path.join(wavDir, `${sc.name}.wav`), Buffer.from(encodeWav([pcm16(sc)], sc.sampleRate)));
    }
    const s = report.summary;
    console.log(
      `${sc.name.padEnd(26)} ${same ? 'same' : update ? 'updated' : 'DIFFERENT'}: ${s.snoreCount} confirmed, ${s.possibleCount} possible, ${s.ignoredCount} ignored ${JSON.stringify(s.ignoredByReason)}`,
    );
  }
  if (changed && !update) {
    console.error(`${changed} reference file(s) differ: if the change is intended, run npm run reference -- --update`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { SCENARIOS, referenceReport, pcm16, fileOf };
