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
  assert.doesNotMatch(html, /rush of air/, 'High does not check breath noise');
  assert.match(
    reportFor(s, { sensitivity: 'normal' }),
    /on Normal sensitivity it must also carry the rush of air/,
    'Normal explains its breath rule',
  );
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

/** A room-noise profile as the recorder keeps it: `count` minutes, 9 octave bands, one band louder in `loud` minutes. */
function noiseProfile(count, loud = new Set(), band = 6) {
  const bandsHz = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000];
  const minutes = [];
  for (let i = 0; i < count; i++) {
    const bandsDb = bandsHz.map(() => -95);
    if (loud.has(i)) bandsDb[band] += 15;
    minutes.push({ t: i * 60, quietSec: 55, backgroundDb: loud.has(i) ? -85 : -90, bandsDb });
  }
  return { minuteSec: 60, bandsHz, minutes };
}

test('room noise heatmap: one row per shown band, loud minutes shaded and merged, snores and gaps marked', () => {
  const noise = noiseProfile(60, new Set([10, 11, 12, 40]));
  const svg = Share.noiseSvg(
    {
      startWall: Date.UTC(2026, 9, 3, 23, 0),
      elapsed: 3600,
      gaps: [{ start: 1800, end: 1900 }],
      snores: [{ start: 600 }, { start: 604 }, { start: 2400 }],
      noise,
      noiseBands: [31.5, 63, 125, 250, 500, 1000, 2000, 4000],
    },
    360,
  );
  assert.match(svg, /^<svg class="noise" viewBox="0 0 360 \d+"/);
  const labels = [...svg.matchAll(/class="ytick">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ['31.5 Hz', '63 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', 'level'], '8 kHz left out');
  const cells = [...svg.matchAll(/<rect class="cell" x="([\d.]+)" y="\d+" width="([\d.]+)"[^>]*fill-opacity="([\d.]+)"/g)];
  assert.equal(cells.length, 2, 'minutes 10-12 are one rectangle, minute 40 another; quiet minutes draw nothing');
  assert.deepEqual(
    cells.map((c) => c[3]),
    ['1', '1'],
    '15 dB above the quiet level is full colour',
  );
  assert.ok(Math.abs(Number(cells[0][2]) - 3 * ((360 - 50) / 60)) < 0.2, 'three minutes wide');
  assert.equal((svg.match(/class="gap"/g) || []).length, 1);
  assert.equal((svg.match(/class="tick"/g) || []).length, 2, 'snores 4 s apart share a tick');
  assert.match(svg, /<path class="level" d="M[\d.,]+(L[\d.,]+){59}"/, 'one level line through all 60 minutes');
});

test('the report file has a room noise section with the findings, when the night has a profile', () => {
  const s = demoSession();
  const noise = noiseProfile(30, new Set([5, 6, 7]));
  const html = reportFor(s, { noise, noiseBands: [63, 1000, 2000], noiseLines: ['A steady low tone at <50> Hz & more.'] });
  assert.match(html, /<h2>Room noise<\/h2>/);
  assert.ok(html.includes('<li>A steady low tone at &lt;50&gt; Hz &amp; more.</li>'), 'findings are escaped');
  assert.match(html, /<svg class="noise" viewBox="0 0 720 /);
  assert.doesNotMatch(html, /<script/i);
  const short = reportFor(s, { noise: noiseProfile(2), noiseBands: [63], noiseLines: [] });
  assert.match(short, /described from 10 minutes of recording on/);
  assert.doesNotMatch(short, /<svg class="noise"/, 'no heatmap for two minutes');
  assert.doesNotMatch(reportFor(s), /Room noise/, 'nights without a profile (before 1.15.0) have no section');
});
