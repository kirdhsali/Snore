#!/usr/bin/env node
// Runs the app's analysis (js/analysis.js: the counting detector, the background tests, the room
// noise) over a WAV file and writes what the app downloads after a night: the data file and the
// snores WAV. For testing the detector on recordings without the browser, e.g. a phone's voice
// memo saved as WAV, or the demo night from `npm run sample`. Everything stays on this machine.
//
//   npm run analyze -- recording.wav [--sensitivity low|normal|high] [--start <ISO time>]
//                                    [--time-zone <IANA name>] [--out <folder>]
//
// --start is when the recording began (default: the file's modification time minus its length);
// files are written to --out (default: next to the recording). Then `npm run evaluate` reads the
// data file like any night's.
'use strict';
const fs = require('fs');
const path = require('path');
const { createAnalysis } = require('../js/analysis.js');
const { toReport } = require('../js/report-format.js');
const { encodeWav, wavPositions, REASONS } = require('../js/detector.js');
const { version } = require('../js/version.js');

/**
 * Reads a PCM WAV file (8-bit unsigned, 16/24/32-bit integer or 32-bit float, any channel count)
 * as mono samples -1..1, averaging the channels as the app's audio tap does.
 */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null;
  let data = null;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { off: off + 8, size };
    else if (id === 'data') data = { off: off + 8, size: Math.min(size, buf.length - off - 8) };
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV file without fmt or data chunk');
  let format = buf.readUInt16LE(fmt.off);
  const channels = buf.readUInt16LE(fmt.off + 2);
  const sampleRate = buf.readUInt32LE(fmt.off + 4);
  const bits = buf.readUInt16LE(fmt.off + 14);
  if (format === 0xfffe && fmt.size >= 26) format = buf.readUInt16LE(fmt.off + 24); // WAVE_FORMAT_EXTENSIBLE
  const bytes = bits / 8;
  const read = {
    '1:8': (o) => (buf.readUInt8(o) - 128) / 128,
    '1:16': (o) => buf.readInt16LE(o) / 32768,
    '1:24': (o) => buf.readIntLE(o, 3) / 8388608,
    '1:32': (o) => buf.readInt32LE(o) / 2147483648,
    '3:32': (o) => buf.readFloatLE(o),
  }[`${format}:${bits}`];
  if (!read) throw new Error(`unsupported WAV encoding (format ${format}, ${bits} bit)`);
  const frames = Math.floor(data.size / (bytes * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read(data.off + (i * channels + c) * bytes);
    samples[i] = sum / channels;
  }
  return { sampleRate, samples, channels, bits };
}

const inTimeOrder = (list) => [...list].sort((a, b) => a.start - b.start);

/**
 * The app's analysis of `samples` (mono, -1..1) at `sampleRate`, fed in the audio tap's blocks of
 * 2048 samples. Returns the finished night record (as js/recorder.js builds it, without
 * interruptions) and its data file.
 */
function analyzeSamples(samples, sampleRate, { sensitivity = 'normal', startWall = 0, timeZone = 'UTC', version: v = version } = {}) {
  const analysis = createAnalysis(sampleRate, { sensitivity });
  for (let i = 0; i < samples.length; i += 2048) analysis.process(samples.subarray(i, i + 2048));
  const elapsed = analysis.finish();
  const night = Object.freeze({
    id: `night-${new Date(startWall).toISOString()}`,
    version: v,
    source: 'file',
    startWall,
    endWall: startWall + elapsed * 1000,
    timeZone,
    capturedSeconds: elapsed,
    clockSeconds: elapsed,
    gaps: [],
    screenWakeLock: null,
    microphone: null,
    audioClock: null,
    ...analysis.result(elapsed),
  });
  const report = toReport({ ...night, wavStarts: wavPositions(inTimeOrder(night.snores)) });
  return { night, report };
}

/** The snores WAV the app downloads: the kept clips in time order. Null without clips. */
function snoresWav(night) {
  const snores = inTimeOrder(night.snores).filter((x) => x.clip);
  return snores.length
    ? encodeWav(
        snores.map((x) => x.clip),
        snores[0].clipRate,
      )
    : null;
}

/** "YYYY-MM-DD_HHMM" in `timeZone`, as the app names its downloads. */
function stamp(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}`;
}

function main(argv) {
  const args = { sensitivity: 'normal', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sensitivity') args.sensitivity = argv[++i];
    else if (a === '--start') args.start = argv[++i];
    else if (a === '--time-zone') args.timeZone = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else files.push(a);
  }
  if (files.length !== 1 || !['low', 'normal', 'high'].includes(args.sensitivity)) {
    console.error(
      'usage: npm run analyze -- recording.wav [--sensitivity low|normal|high] [--start <ISO time>] [--time-zone <IANA name>] [--out <folder>]',
    );
    process.exit(1);
  }
  const file = files[0];
  const { sampleRate, samples, channels, bits } = readWav(fs.readFileSync(file));
  const seconds = samples.length / sampleRate;
  const startWall = args.start ? Date.parse(args.start) : fs.statSync(file).mtimeMs - seconds * 1000;
  if (!Number.isFinite(startWall)) throw new Error(`--start is not a time: ${args.start}`);
  const { night, report } = analyzeSamples(samples, sampleRate, { sensitivity: args.sensitivity, startWall, timeZone: args.timeZone });

  const out = args.out || path.dirname(file);
  fs.mkdirSync(out, { recursive: true });
  const name = stamp(startWall, args.timeZone);
  const jsonFile = path.join(out, `snore-report_${name}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
  const wav = snoresWav(night);
  const wavFile = path.join(out, `snores_${name}.wav`);
  if (wav) fs.writeFileSync(wavFile, Buffer.from(wav));

  const s = night.summary;
  console.log(
    `${file}: ${(seconds / 60).toFixed(1)} min at ${sampleRate} Hz (${channels} channel${channels > 1 ? 's' : ''}, ${bits} bit), sensitivity ${night.sensitivity}`,
  );
  console.log(
    `  ${s.snoreCount} confirmed snores (${s.snoresPerHour.toFixed(0)}/h), ${s.possibleCount} possible, ${s.ignoredCount} other sounds ignored`,
  );
  for (const [reason, n] of Object.entries(s.ignoredByReason)) console.log(`    ${(REASONS[reason] || reason).padEnd(34)} ${n}`);
  for (const [name, sh] of Object.entries(night.shadows)) console.log(`  background test ${name}: ${sh.summary.snoreCount} confirmed`);
  console.log(`  wrote ${jsonFile}${wav ? ` and ${wavFile}` : ' (no snore clips)'}`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { readWav, analyzeSamples, snoresWav };
