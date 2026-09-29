'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/detector.js');
const Share = require('../js/share.js');
const Synth = require('../js/synth.js');

function demoSession() {
  const sc = Synth.demoScenario(16000);
  const det = new Core.SnoreDetector(16000);
  const stats = new Core.SessionStats();
  det.process(sc.samples).forEach((e) => stats.add(e));
  const elapsed = sc.samples.length / 16000;
  return { stats, elapsed, summary: stats.summary(elapsed) };
}

function reportFor(s, overrides = {}) {
  return Share.buildReportHtml({
    startWall: Date.UTC(2026, 8, 28, 21, 2),
    elapsed: s.elapsed,
    snores: s.stats.snores,
    summary: s.summary,
    version: '9.9.9 (test)',
    sensitivity: 'high',
    sourceLabel: 'Audio file: <night> & "dreams".wav',
    reasons: Core.REASONS,
    heroImage: null,
    samples: Share.pickSamples(s.stats.snores, 8, 5, Synth.rng(1)),
    ...overrides,
  });
}

test('pickSamples takes the loudest plus distinct random snores, in time order', () => {
  const snores = Array.from({ length: 30 }, (_, i) => ({ start: i, relDb: (i * 7) % 30, clip: new Int16Array(10) }));
  snores[3].clip = null;
  const { loud, random } = Share.pickSamples(snores, 8, 5, Synth.rng(2));
  assert.equal(loud.length, 8);
  assert.equal(random.length, 5);
  const loudest = snores.filter((s) => s.clip).sort((a, b) => b.relDb - a.relDb).slice(0, 8);
  assert.deepEqual(new Set(loud), new Set(loudest));
  assert.ok(random.every((s) => !loud.includes(s) && s.clip));
  assert.equal(new Set(random).size, 5);
  for (const list of [loud, random]) assert.deepEqual(list, list.slice().sort((a, b) => a.start - b.start));
});

test('report file is self-contained, script-free and plays the samples', () => {
  const s = demoSession();
  const html = reportFor(s);
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script/i, 'no scripts, so it works in restrictive viewers');
  assert.doesNotMatch(html, /(src|href)="https?:/, 'no external resources');
  const audio = html.match(/<audio controls preload="metadata" src="data:audio\/wav;base64,[A-Za-z0-9+/=]+"><\/audio>/g) || [];
  assert.equal(audio.length, 13, '8 loudest + 5 random of the 16 demo snores');
  assert.ok(html.includes('9.9.9 (test)'));
  assert.ok(html.includes('Audio file: &lt;night&gt; &amp; &quot;dreams&quot;.wav'), 'file names are escaped');
  assert.ok(html.length < 600 * 1024, `report is ${Math.round(html.length / 1024)} KB`);
});

test('report embeds WAV audio that decodes back to the clip length', () => {
  const s = demoSession();
  const html = reportFor(s);
  const b64 = html.match(/data:audio\/wav;base64,([A-Za-z0-9+/=]+)/)[1];
  const wav = Buffer.from(b64, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  const rate = wav.readUInt32LE(24);
  const seconds = wav.readUInt32LE(40) / 2 / rate;
  assert.ok(seconds > 0.5 && seconds < 5, `clip lasts ${seconds.toFixed(2)} s`);
});

test('report for a night without snores says so', () => {
  const stats = new Core.SessionStats();
  const html = reportFor({ stats, elapsed: 3600, summary: stats.summary(3600) });
  assert.match(html, /No snoring was detected/);
  assert.doesNotMatch(html, /<audio/);
});

test('time axis uses clock times for long nights and m:ss for short sessions', () => {
  const start = new Date(2026, 8, 28, 23, 2).getTime();
  const long = Share.timeTicks(start, 7.7 * 3600);
  assert.ok(long.length >= 4 && long.length <= 9);
  assert.equal(new Date(start + long[0].t * 1000).getMinutes(), 0, 'ticks sit on full hours');
  const short = Share.timeTicks(start, 90);
  assert.deepEqual(
    short.map((t) => t.label),
    ['0:00', '0:15', '0:30', '0:45', '1:00', '1:15', '1:30'],
  );
});

test('busiest period is found', () => {
  const snores = [100, 2000, 2010, 2020, 5000].map((start) => ({ start }));
  assert.deepEqual(Share.busiest(snores, 7200), { start: 1800, end: 3600, count: 3 });
  assert.equal(Share.busiest([], 7200), null);
});
