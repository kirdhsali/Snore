#!/usr/bin/env node
// Re-evaluates a downloaded night (the report .json) with the current rules,
// to compare nights or see what a rule change would do to a past night.
//
//   node scripts/evaluate.js snore-report_2026-09-30_0014.json [more.json ...]
//
// Uses the sound features stored per event, so no audio is needed. Reports
// from older versions lack some features: without subBassShare the rumble
// filter is skipped, without loudFill the knock check of the rhythm rule is.
'use strict';
const fs = require('fs');
const { classify, isRhythmCandidate, RhythmGate, SessionStats, DEFAULTS, REASONS } = require('../js/detector.js');

function eventsOf(report) {
  const toEvent = (x, isSnore) => ({
    start: x.offsetSec,
    duration: x.durationSec,
    relDb: x.aboveRoomDb,
    lowRatio: x.lowFrequencyShare,
    highRatio: x.highFrequencyShare,
    centroid: x.centroidHz,
    peaks: x.bursts,
    subBass: x.subBassShare ?? null,
    fill: x.loudFill ?? null,
    breathRise: x.breathRiseDb ?? null,
    wasSnore: isSnore,
    wasReason: isSnore ? null : x.reason,
    wasRhythm: !!x.rhythmRescued,
  });
  return [...report.snores.map((x) => toEvent(x, true)), ...report.ignored.map((x) => toEvent(x, false))]
    .filter((e) => e.start != null)
    .sort((a, b) => a.start - b.start);
}

/** Runs the stored features through the current rules, or through `options` to try a candidate rule set. */
function reevaluate(events, options = DEFAULTS) {
  const opts = { ...DEFAULTS, ...options };
  const out = [];
  const gate = new RhythmGate(opts, (ev) => out.push(ev));
  for (const e of events) {
    gate.expire(e.start);
    if (e.lowRatio == null) {
      // No features stored (older report): keep the original verdict.
      gate.decide({ ...e, isSnore: e.wasSnore, reason: e.wasReason });
      continue;
    }
    // The live detector flags "too long" while the sound lasts, which can include its fade-out.
    const v = classify({ ...e, tooLong: e.wasReason === 'too-long' || e.duration > opts.maxDuration }, opts);
    const rhythmCandidate = v.reason === 'choppy' && isRhythmCandidate({ ...e, fill: e.fill ?? 1 }, opts);
    gate.decide({ ...e, isSnore: v.isSnore, reason: v.reason, rhythmCandidate });
  }
  gate.flush();
  return out.sort((a, b) => a.start - b.start);
}

const pad = (v, n) => String(v).padStart(n);
const count = (list, f) => list.filter(f).length;

function report(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const events = eventsOf(r);
  const after = reevaluate(events);
  const hours = r.summary.elapsed / 3600;
  const start = Date.parse(r.startedAt);
  const missing = [];
  if (!events.some((e) => e.subBass != null)) missing.push('subBassShare (rumble filter skipped)');
  if (!events.some((e) => e.fill != null)) missing.push('loudFill (knock check of the rhythm rule skipped)');
  if (!events.some((e) => e.breathRise != null)) missing.push('breathRiseDb (breath-noise rule cannot be checked)');
  if (!r.ignored.some((x) => x.lowFrequencyShare != null)) missing.push('features of ignored sounds (no rhythm rescue possible)');

  console.log(`\n${file}`);
  const length = hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(hours * 60)} min`;
  console.log(`  ${r.startedAt} · ${length} · sensitivity ${r.sensitivity} · recorded with ${r.version || 'unknown version'}`);
  if (missing.length) console.log(`  missing: ${missing.join('; ')}`);
  const before = count(events, (e) => e.wasSnore);
  const now = count(after, (e) => e.isSnore);
  // Confirmed = another snore 2-12 s before or after (what the app counts since 1.5).
  const confirmedOf = (list) => {
    const stats = new SessionStats();
    list.forEach((e) => stats.add({ ...e, clip: null }));
    return stats.confirmed.length;
  };
  const confBefore = confirmedOf(events.filter((e) => e.wasSnore).map((e) => ({ ...e, isSnore: true })));
  const confNow = confirmedOf(after.filter((e) => e.isSnore));
  console.log('\n                     recorded   current rules');
  console.log(`  snore-like sounds  ${pad(before, 8)}   ${pad(now, 13)}`);
  console.log(`  confirmed snores   ${pad(confBefore, 8)}   ${pad(confNow, 13)}`);
  console.log(`  confirmed per hour ${pad((confBefore / hours).toFixed(0), 8)}   ${pad((confNow / hours).toFixed(0), 13)}`);
  console.log(`  via rhythm         ${pad(count(events, (e) => e.wasRhythm), 8)}   ${pad(count(after, (e) => e.rhythm), 13)}`);
  for (const k of Object.keys(REASONS)) {
    const b = count(events, (e) => e.wasReason === k);
    const a = count(after, (e) => e.reason === k);
    if (a || b) console.log(`  ${REASONS[k].padEnd(34).slice(0, 34)} ${pad(b, 4)}   ${pad(a, 13)}`);
  }
  const shadows = r.shadows || (r.shadow ? { auto: r.shadow } : {});
  for (const [name, sh] of Object.entries(shadows)) compareShadow(r, sh, name, hours);
  console.log('\n  hour    recorded  current   (snore-like sounds per clock hour)');
  const byHour = new Map();
  const hourOf = (e) => new Date(start + e.start * 1000).getHours();
  for (const e of events) if (e.wasSnore) byHour.set(hourOf(e), (byHour.get(hourOf(e)) || [0, 0]).map((v, i) => v + (i === 0)));
  for (const e of after) if (e.isSnore) byHour.set(hourOf(e), (byHour.get(hourOf(e)) || [0, 0]).map((v, i) => v + (i === 1)));
  const order = [...byHour.keys()].sort((a, b) => ((a + 12) % 24) - ((b + 12) % 24));
  for (const h of order) console.log(`  ${pad(h, 2)}:00  ${pad(byHour.get(h)[0], 8)}  ${pad(byHour.get(h)[1], 7)}`);
}

/** The recording's own detector against a candidate rule set that ran alongside it. */
function compareShadow(r, shadow, name, hours) {
  const main = r.snores.filter((x) => x.confirmed);
  const auto = shadow.snores.filter((x) => x.confirmed);
  const near = (a, list) => list.some((b) => Math.abs(a.offsetSec - b.offsetSec) < 0.6);
  const both = main.filter((x) => near(x, auto)).length;
  const trig = shadow.levels.map((l) => l.triggerDb).sort((a, b) => a - b);
  const q = (p) => (trig.length ? trig[Math.floor(p * (trig.length - 1))].toFixed(1) : '-');
  const label = `${name}: sensitivity ${shadow.sensitivity}${shadow.minBreathRiseDb != null ? `, breath-noise rule ${shadow.minBreathRiseDb} dB` : ''}`;
  console.log(`\n  background test ${label} vs ${r.sensitivity}:`);
  console.log(`    confirmed snores   ${r.sensitivity} ${main.length} (${(main.length / hours).toFixed(0)}/h)   ${name} ${auto.length} (${(auto.length / hours).toFixed(0)}/h)`);
  console.log(`    found by both ${both}, only ${r.sensitivity} ${main.length - both}, only ${name} ${auto.filter((x) => !near(x, main)).length}`);
  if (trig.length) console.log(`    trigger margin over the night: min ${q(0)}, median ${q(0.5)}, max ${q(1)} dB`);
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/evaluate.js report.json [more.json ...]');
    process.exit(1);
  }
  files.forEach(report);
}
module.exports = { eventsOf, reevaluate };
