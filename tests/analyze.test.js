'use strict';
// scripts/analyze.js runs the app's analysis over a WAV file and writes the night's downloads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Synth = require('../js/synth.js');
const { encodeWav, wavPositions, CLIP_GAP_SEC } = require('../js/wav.js');
const { createAnalysis } = require('../js/analysis.js');
const { toReport } = require('../js/report-format.js');
const { readWav, analyzeSamples, snoresWav } = require('../scripts/analyze.js');

/** A WAV file with one `fmt ` chunk (16 or 40 bytes), an extra chunk before the data, and `data`. */
function wavFile({ format = 1, channels = 1, sampleRate = 8000, bits = 16, extensible = false, data }) {
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE((sampleRate * channels * bits) / 8, 8);
  fmt.writeUInt16LE((channels * bits) / 8, 12);
  fmt.writeUInt16LE(bits, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(bits, 18);
    fmt.writeUInt16LE(format, 24); // first two bytes of the sub-format GUID
  }
  const chunk = (id, body) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, Buffer.alloc(body.length % 2)]);
  };
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('LIST', Buffer.from('odd')), chunk('data', data)]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

test('readWav reads 8-, 16-, 24- and 32-bit and float files as mono -1..1, averaging the channels', () => {
  const int16 = Buffer.alloc(8);
  [16384, -16384, 32767, 0].forEach((v, i) => int16.writeInt16LE(v, i * 2));
  const stereo = readWav(wavFile({ channels: 2, data: int16 }));
  assert.equal(stereo.sampleRate, 8000);
  assert.equal(stereo.channels, 2);
  assert.deepEqual(Array.from(stereo.samples), [0, 32767 / 65536], 'left and right averaged');

  const int24 = Buffer.alloc(6);
  int24.writeIntLE(4194304, 0, 3);
  int24.writeIntLE(-8388608, 3, 3);
  assert.deepEqual(Array.from(readWav(wavFile({ bits: 24, data: int24 })).samples), [0.5, -1]);

  const int32 = Buffer.alloc(4);
  int32.writeInt32LE(-1073741824, 0);
  assert.deepEqual(Array.from(readWav(wavFile({ bits: 32, data: int32 })).samples), [-0.5]);

  const float = Buffer.alloc(8);
  float.writeFloatLE(0.25, 0);
  float.writeFloatLE(-0.75, 4);
  assert.deepEqual(Array.from(readWav(wavFile({ format: 3, bits: 32, data: float })).samples), [0.25, -0.75]);
  assert.deepEqual(
    Array.from(readWav(wavFile({ format: 3, bits: 32, extensible: true, data: float })).samples),
    [0.25, -0.75],
    'WAVE_FORMAT_EXTENSIBLE',
  );

  assert.deepEqual(Array.from(readWav(wavFile({ bits: 8, data: Buffer.from([128, 192, 0]) })).samples), [0, 0.5, -1]);
});

test('readWav refuses what it cannot read', () => {
  assert.throws(() => readWav(Buffer.from('not a wave file at all, just text')), /not a WAV file/);
  assert.throws(() => readWav(wavFile({ format: 2, bits: 4, data: Buffer.alloc(4) })), /unsupported WAV encoding/);
});

test('analyzeSamples counts the demo night as the app does and places the clips in the snores WAV', () => {
  const sr = 16000;
  const { samples } = Synth.demoScenario(sr);
  const startWall = Date.parse('2026-10-01T22:00:00Z');
  const { night, report } = analyzeSamples(samples, sr, { startWall, timeZone: 'Europe/Berlin', version: 'test' });
  assert.ok(Object.isFrozen(night));
  assert.equal(night.source, 'file');
  assert.equal(night.summary.snoreCount, 16, 'as the recorder and detector tests count the demo night');
  assert.equal(night.summary.ignoredCount, 5);
  assert.equal(night.shadows.knock.summary.snoreCount, 16);
  assert.equal(report.startedAt, '2026-10-01T22:00:00.000Z');
  assert.equal(report.timeZone, 'Europe/Berlin');
  assert.equal(report.capturedSeconds, 90);
  assert.deepEqual(report.interruptions, []);

  // Each snore's wavStartSec is where its clip begins in the downloaded WAV.
  const wav = readWav(Buffer.from(snoresWav(night)));
  const clips = [...night.snores].sort((a, b) => a.start - b.start);
  assert.equal(wav.sampleRate, clips[0].clipRate);
  let at = 0;
  for (const [i, x] of clips.entries()) {
    assert.equal(report.snores[i].wavStartSec, Math.round((at / wav.sampleRate) * 100) / 100);
    const inWav = Array.from(wav.samples.subarray(at, at + x.clip.length), (v) => Math.round(v * 32768));
    assert.deepEqual(inWav, Array.from(x.clip), `snore ${i}: its clip starts there`);
    at += x.clip.length + Math.round(CLIP_GAP_SEC * wav.sampleRate);
  }
  assert.equal(wav.samples.length, at - Math.round(CLIP_GAP_SEC * wav.sampleRate));
});

test('the result does not depend on how the audio is cut into blocks (the app feeds 2048 or 4096 samples at a time)', () => {
  const sr = 16000;
  const { samples } = Synth.demoScenario(sr);
  const inBlocks = analyzeSamples(samples, sr).report;
  const odd = createAnalysis(sr);
  for (let i = 0; i < samples.length; i += 1000) odd.process(samples.subarray(i, i + 1000));
  const night = { startWall: 0, endWall: 90000, capturedSeconds: 90, gaps: [], ...odd.result(odd.finish()) };
  const report = toReport({ ...night, wavStarts: wavPositions([...night.snores].sort((a, b) => a.start - b.start)) });
  for (const key of ['summary', 'noise', 'snores', 'ignored', 'shadows']) assert.deepEqual(report[key], inBlocks[key], key);
});

test('npm run analyze writes the data file and the snores WAV, named like the app downloads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snorewatch-analyze-'));
  try {
    const sr = 16000;
    const { samples } = Synth.demoScenario(sr);
    const pcm = Int16Array.from(samples, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
    const input = path.join(dir, 'night.wav');
    fs.writeFileSync(input, Buffer.from(encodeWav([pcm], sr)));
    const out = path.join(dir, 'out');
    const script = path.join(__dirname, '..', 'scripts', 'analyze.js');
    const log = execFileSync(
      process.execPath,
      [script, input, '--start', '2026-10-01T22:00:00Z', '--time-zone', 'Europe/Berlin', '--out', out],
      {
        encoding: 'utf8',
      },
    );
    assert.match(log, /16 confirmed snores/);
    assert.deepEqual(fs.readdirSync(out).sort(), ['snore-report_2026-10-02_0000.json', 'snores_2026-10-02_0000.wav']);
    const report = JSON.parse(fs.readFileSync(path.join(out, 'snore-report_2026-10-02_0000.json'), 'utf8'));
    assert.equal(report.source, 'file');
    assert.equal(report.summary.snoreCount, 16);
    assert.equal(report.sensitivity, 'normal');
    assert.throws(() => execFileSync(process.execPath, [script, input, '--sensitivity', 'loud'], { stdio: 'pipe' }), /usage/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
