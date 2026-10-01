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
  const loudest = snores
    .filter((s) => s.clip)
    .sort((a, b) => b.relDb - a.relDb)
    .slice(0, 8);
  assert.deepEqual(new Set(loud), new Set(loudest));
  assert.ok(random.every((s) => !loud.includes(s) && s.clip));
  assert.equal(new Set(random).size, 5);
  for (const list of [loud, random])
    assert.deepEqual(
      list,
      list.slice().sort((a, b) => a.start - b.start),
    );
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

test('report states how many isolated snores were not counted', () => {
  const stats = new Core.SessionStats();
  [10, 14, 18, 300].forEach((start) => stats.add({ isSnore: true, start, end: start + 1, duration: 1, relDb: 12, clip: null }));
  const html = reportFor({ stats, elapsed: 3600, summary: stats.summary(3600) });
  assert.match(html, /1 isolated snore-like sounds without a neighbour in breathing rhythm were not counted/);
  assert.match(html, /\+1 possible, not counted/);
});

/** A canvas that records the text drawn on it. */
function textCanvas() {
  const texts = [];
  const ctx = new Proxy(
    {
      fillText: (t) => texts.push(String(t)),
      measureText: (t) => ({ width: String(t).length * 12 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    },
    { get: (o, k) => (k in o ? o[k] : typeof k === 'string' && /^[a-z]/.test(k) ? () => {} : undefined), set: () => true },
  );
  return { canvas: { getContext: () => ctx }, texts };
}

test('an interrupted night says so in the report file and the image; an uninterrupted one is unchanged', () => {
  const s = demoSession(); // about 90 s of audio
  const lost = 3600;
  const night = { ...s, elapsed: s.elapsed + lost };
  const gaps = [{ start: 30, end: 30 + lost }];
  const html = reportFor(night, { captured: s.elapsed, gaps });
  const verdict = html.match(/<p class="verdict">([^<]*)/)[1];
  assert.match(verdict, new RegExp(`^${s.summary.snoreCount} snores in 1 min \\d+ s recorded\\.`), verdict);
  assert.doesNotMatch(verdict, /per hour|1 h/, 'no hourly figure from 90 s, and not "in 1 h"');
  assert.match(html, /<p class="meta">[^<]* of 1 h 1 min recorded · interrupted 1×/);
  assert.match(html, /interrupted 1× \(1 h 0 min not recorded: /);
  assert.match(html, /<rect class="gap"/);
  assert.match(html, /recording too short/);

  // The same night uninterrupted reads as before, with or without the new fields.
  const plain = reportFor(s);
  assert.equal(reportFor(s, { captured: s.elapsed, gaps: [] }), plain);
  assert.doesNotMatch(plain, /interrupted|class="gap"/);

  const card = (d) => {
    const c = textCanvas();
    Share.drawShareCard(c.canvas, {
      startWall: Date.UTC(2026, 8, 28, 21, 2),
      snores: s.stats.snores,
      summary: s.summary,
      version: 't',
      sensitivity: 'normal',
      ...d,
    });
    return c.texts;
  };
  const cut = card({ elapsed: night.elapsed, captured: s.elapsed, gaps });
  assert.ok(
    cut.some((t) => /of 1 h 1 min recorded · interrupted 1×$/.test(t)),
    cut.join(' | '),
  );
  assert.ok(cut.includes('not recorded'), 'legend explains the hatched gap');
  assert.ok(
    cut.some((t) => /^in 1 min \d+ s$/.test(t)),
    'hero counts the recorded time, not the hour',
  );
  const whole = card({ elapsed: s.elapsed });
  assert.ok(!whole.some((t) => /interrupted|not recorded/.test(t)));
  assert.deepEqual(card({ elapsed: s.elapsed, captured: s.elapsed, gaps: [] }), whole);
});
