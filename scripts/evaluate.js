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
const { classify, isRhythmCandidate, RhythmGate, SessionStats, DEFAULTS, REASONS, breathRuleDb } = require('../js/detector.js');
const { fromReport } = require('../js/report-format.js');
const Noise = require('../js/noise.js');

/** The night's events in time order, each with the verdict it got when recorded (was*). */
function eventsOf(report) {
  return fromReport(report).events.map((e) => ({ ...e, wasSnore: e.isSnore, wasReason: e.reason, wasRhythm: e.rhythm }));
}

/**
 * Runs the stored features through the current rules, or through `options` to try a candidate rule set.
 * `gaps` are interruptions ({start, end} on the events' clock): as live, nothing waits or anchors across them.
 */
function reevaluate(events, options = DEFAULTS, gaps = []) {
  const opts = { ...DEFAULTS, ...options };
  const out = [];
  const gate = new RhythmGate(opts, (ev) => out.push(ev));
  const pending = [...gaps].sort((a, b) => a.start - b.start);
  for (const e of events) {
    while (pending.length && pending[0].start <= e.start) {
      gate.expire(pending.shift().start);
      gate.breakRhythm();
    }
    gate.expire(e.start);
    if (e.lowRatio == null) {
      // No features stored (older report): keep the original verdict.
      gate.decide({ ...e, isSnore: e.wasSnore, reason: e.wasReason });
      continue;
    }
    // The live detector flags "too long" while the sound lasts, which can include its fade-out.
    const v = classify({ ...e, tooLong: e.wasReason === 'too-long' || e.duration > opts.maxDuration }, opts);
    const rhythmCandidate = v.reason === 'choppy' && isRhythmCandidate({ ...e, fill: e.fill ?? 1 }, opts);
    gate.decide({ ...e, isSnore: v.isSnore, reason: v.reason, rhythm: false, rhythmCandidate });
  }
  gate.flush();
  return out.sort((a, b) => a.start - b.start);
}

const pad = (v, n) => String(v).padStart(n);

/**
 * Clock hour (0-23) of a moment, in the night's time zone when the file names a
 * valid one (from 1.12.5), else in this computer's. Returns the hour function and its label.
 */
function hourClock(timeZone) {
  if (timeZone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone });
      return { hourOf: (ms) => Number(fmt.format(ms)), label: timeZone };
    } catch {
      return { hourOf: (ms) => new Date(ms).getHours(), label: `this computer's time zone (unknown zone ${timeZone})` };
    }
  }
  return { hourOf: (ms) => new Date(ms).getHours(), label: "this computer's time zone (the file names none)" };
}
const count = (list, f) => list.filter(f).length;

function report(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const night = fromReport(r);
  const events = eventsOf(r);
  // Classification rules depend on the sensitivity only through the breath-noise rule (Normal 6 dB since 1.17.0).
  const current = { sensitivity: night.sensitivity || DEFAULTS.sensitivity };
  const after = reevaluate(events, current, night.interruptions);
  const hours = r.summary.elapsed / 3600;
  const start = night.startedAt;
  const explain = {
    subBassShare: 'subBassShare (rumble filter skipped)',
    loudFill: 'loudFill (knock check of the rhythm rule skipped)',
    breathRiseDb: 'breathRiseDb (breath-noise rule cannot be checked)',
    ignoredFeatures: 'features of ignored sounds (no rhythm rescue possible)',
  };
  const missing = night.missing.map((k) => explain[k]);

  console.log(`\n${file}`);
  const length = hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(hours * 60)} min`;
  console.log(`  ${r.startedAt} · ${length} · sensitivity ${r.sensitivity} · recorded with ${r.version || 'unknown version'}`);
  const rule = (db) => (db == null ? 'none' : `${db} dB`);
  console.log(`  breath-noise rule: recorded ${rule(night.minBreathRiseDb)}, current rules ${rule(breathRuleDb(current))}`);
  if (missing.length) console.log(`  missing: ${missing.join('; ')}`);
  const before = count(events, (e) => e.wasSnore);
  const now = count(after, (e) => e.isSnore);
  // Confirmed = another snore 2-12 s before or after (what the app counts since 1.5).
  const confirmedOf = (list) => {
    const stats = new SessionStats();
    for (const g of night.interruptions) stats.addGap(g.start, g.end);
    list.forEach((e) => stats.add({ ...e, clip: null }));
    return stats.confirmed.length;
  };
  const confBefore = confirmedOf(events.filter((e) => e.wasSnore).map((e) => ({ ...e, isSnore: true })));
  const confNow = confirmedOf(after.filter((e) => e.isSnore));
  console.log('\n                     recorded   current rules');
  console.log(`  snore-like sounds  ${pad(before, 8)}   ${pad(now, 13)}`);
  console.log(`  confirmed snores   ${pad(confBefore, 8)}   ${pad(confNow, 13)}`);
  console.log(`  confirmed per hour ${pad((confBefore / hours).toFixed(0), 8)}   ${pad((confNow / hours).toFixed(0), 13)}`);
  console.log(
    `  via rhythm         ${pad(
      count(events, (e) => e.wasRhythm),
      8,
    )}   ${pad(
      count(after, (e) => e.rhythm),
      13,
    )}`,
  );
  for (const k of Object.keys(REASONS)) {
    const b = count(events, (e) => e.wasReason === k);
    const a = count(after, (e) => e.reason === k);
    if (a || b) console.log(`  ${REASONS[k].padEnd(34).slice(0, 34)} ${pad(b, 4)}   ${pad(a, 13)}`);
  }
  if (breathRuleDb(current) != null && !night.missing.includes('breathRiseDb')) {
    // What the breath-noise rule takes away: the same night without it (Normal before 1.17.0).
    const none = confirmedOf(reevaluate(events, { ...current, minBreathRiseDb: null }, night.interruptions).filter((e) => e.isSnore));
    console.log(`  without the breath-noise rule: ${none} confirmed (${(none / hours).toFixed(0)}/h)`);
  }
  const shadows = r.shadows || (r.shadow ? { auto: r.shadow } : {});
  for (const [name, sh] of Object.entries(shadows)) compareShadow(r, sh, name, hours, night.interruptions);
  const clock = hourClock(night.timeZone);
  const noiseByHour = new Map();
  for (const m of (night.noise && night.noise.minutes) || []) {
    if (m.backgroundDbfs == null) continue;
    const h = clock.hourOf(start + m.offsetSec * 1000);
    (noiseByHour.get(h) || noiseByHour.set(h, []).get(h)).push(m);
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  console.log(
    `\n  hour    recorded  current   (snore-like sounds per clock hour, ${clock.label})${noiseByHour.size ? '   room: background dBFS, hum' : ''}`,
  );
  const byHour = new Map();
  const hourOf = (e) => clock.hourOf(start + e.start * 1000);
  for (const e of events)
    if (e.wasSnore)
      byHour.set(
        hourOf(e),
        (byHour.get(hourOf(e)) || [0, 0]).map((v, i) => v + (i === 0)),
      );
  for (const e of after)
    if (e.isSnore)
      byHour.set(
        hourOf(e),
        (byHour.get(hourOf(e)) || [0, 0]).map((v, i) => v + (i === 1)),
      );
  for (const h of noiseByHour.keys()) if (!byHour.has(h)) byHour.set(h, [0, 0]);
  const order = [...byHour.keys()].sort((a, b) => ((a + 12) % 24) - ((b + 12) % 24));
  for (const h of order) {
    const mins = noiseByHour.get(h) || [];
    const hums = mins.filter((m) => m.humHz != null);
    const room = mins.length
      ? `   ${pad(median(mins.map((m) => m.backgroundDbfs)).toFixed(1), 6)}  ${hums.length ? `${median(hums.map((m) => m.humHz)).toFixed(0)} Hz in ${Math.round((100 * hums.length) / mins.length)}% of minutes` : '-'}`
      : '';
    console.log(`  ${pad(h, 2)}:00  ${pad(byHour.get(h)[0], 8)}  ${pad(byHour.get(h)[1], 7)}${room}`);
  }
  if (night.noise) {
    // The room's noise in plain findings, as the report will show them (js/noise.js).
    const fmt = (sec) => {
      const opts = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
      try {
        return new Date(start + sec * 1000).toLocaleTimeString('en-GB', { ...opts, timeZone: night.timeZone || undefined });
      } catch {
        return new Date(start + sec * 1000).toLocaleTimeString('en-GB', opts);
      }
    };
    const snoreTimes = events.filter((e) => e.wasSnore && e.confirmed).map((e) => e.start);
    console.log('\n  room noise:');
    for (const line of Noise.describe(Noise.summarize(night.noise, snoreTimes), fmt)) console.log(`    - ${line}`);
  }
}

/**
 * A background test's confirmed snores under a stricter breath-noise rule, from its stored
 * snore-like sounds (each keeps its breath noise). Approximate: rhythm rescues are not redone.
 */
function stricterBreath(shadow, minDb, gaps = []) {
  const stats = new SessionStats();
  for (const g of gaps) stats.addGap(g.start, g.end);
  for (const x of shadow.snores)
    if (x.breathRiseDb != null && x.breathRiseDb >= minDb)
      stats.add({
        isSnore: true,
        start: x.offsetSec,
        end: x.offsetSec + x.durationSec,
        duration: x.durationSec,
        relDb: x.aboveRoomDb,
        clip: null,
      });
  return stats.confirmed.length;
}

/**
 * A background test's confirmed snores with another limit or window for the rise over the
 * moment before, from its stored snores and the sounds that rule set aside (from 1.20.0).
 * Approximate like stricterBreath: rhythm rescues are not redone, choppy sounds do not count.
 */
function preRiseVariant(shadow, windowSec, minDb, gaps = []) {
  const key = `preRise${Math.round(windowSec * 100)}Db`;
  const stats = new SessionStats();
  for (const g of gaps) stats.addGap(g.start, g.end);
  const others = (shadow.setAside || []).filter((x) => x.reason === 'no-pre-rise' && !(x.bursts > DEFAULTS.maxPeaks));
  for (const x of [...shadow.snores, ...others].sort((a, b) => a.offsetSec - b.offsetSec))
    if (x[key] == null || x[key] >= minDb)
      stats.add({
        isSnore: true,
        start: x.offsetSec,
        end: x.offsetSec + x.durationSec,
        duration: x.durationSec,
        relDb: x.aboveRoomDb,
        clip: null,
      });
  return stats.confirmed;
}

/** The recording's own detector against a candidate rule set that ran alongside it. */
function compareShadow(r, shadow, name, hours, gaps = []) {
  const main = r.snores.filter((x) => x.confirmed);
  const auto = shadow.snores.filter((x) => x.confirmed);
  const near = (a, list) => list.some((b) => Math.abs(a.offsetSec - b.offsetSec) < 0.6);
  const both = main.filter((x) => near(x, auto)).length;
  const trig = shadow.levels.map((l) => l.triggerDb).sort((a, b) => a - b);
  const q = (p) => (trig.length ? trig[Math.floor(p * (trig.length - 1))].toFixed(1) : '-');
  const label = `${name}: sensitivity ${shadow.sensitivity}${shadow.minBreathRiseDb != null ? `, breath-noise rule ${shadow.minBreathRiseDb} dB` : ''}${shadow.minLowRiseDb != null ? `, snore-band rule ${shadow.minLowRiseDb} dB` : ''}${shadow.maxOnsetJumpDb != null ? `, sudden-start rule ${shadow.maxOnsetJumpDb} dB` : ''}${
    shadow.minPreRiseDb != null ? `, ${shadow.minPreRiseDb} dB over the ${shadow.preRiseSec} s before` : ''
  }`;
  console.log(`\n  background test ${label} vs ${r.sensitivity}:`);
  console.log(
    `    confirmed snores   ${r.sensitivity} ${main.length} (${(main.length / hours).toFixed(0)}/h)   ${name} ${auto.length} (${(auto.length / hours).toFixed(0)}/h)`,
  );
  console.log(
    `    found by both ${both}, only ${r.sensitivity} ${main.length - both}, only ${name} ${auto.filter((x) => !near(x, main)).length}`,
  );
  if (trig.length) console.log(`    trigger margin over the night: min ${q(0)}, median ${q(0.5)}, max ${q(1)} dB`);
  if (shadow.minBreathRiseDb != null && shadow.minBreathRiseDb < 6) {
    const n = stricterBreath(shadow, 6, gaps);
    console.log(`    with a 6 dB breath-noise rule instead (from its stored sounds): ${n} (${(n / hours).toFixed(0)}/h)`);
  }
  if (shadow.maxOnsetJumpDb != null) {
    // The counted snores this rule drops, to check by ear in the snores WAV.
    const sudden = r.snores.filter((x) => x.onsetJumpDb != null && x.onsetJumpDb > shadow.maxOnsetJumpDb);
    const clock = (x) => {
      const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
      try {
        return new Date(x.time).toLocaleTimeString('en-GB', { ...opts, timeZone: r.timeZone || undefined });
      } catch {
        return new Date(x.time).toLocaleTimeString('en-GB', opts);
      }
    };
    const where = (x) => `${clock(x)}${x.wavStartSec != null ? ` (WAV ${x.wavStartSec} s)` : ''} +${x.onsetJumpDb} dB`;
    if (sudden.length)
      console.log(
        `    ${r.sensitivity}'s snores that start suddenly: ${sudden.slice(0, 20).map(where).join(', ')}${sudden.length > 20 ? `, … (${sudden.length} in all)` : ''}`,
      );
  }
  if (shadow.minPreRiseDb != null && shadow.setAside) {
    // Other lengths of "the moment before" and other limits, from the stored sounds.
    console.log(`    rise over the moment before (confirmed, of them also ${r.sensitivity}'s), re-counted from the stored sounds:`);
    console.log(`      ${'before'.padEnd(8)}${[4, 6, 8].map((db) => `>= ${db} dB`.padEnd(16)).join('')}`);
    for (const sec of [0.25, 0.5, 1]) {
      const cells = [4, 6, 8].map((db) => {
        const c = preRiseVariant(shadow, sec, db, gaps);
        return `${c.length} (${c.filter((x) => near({ offsetSec: x.start }, main)).length})`.padEnd(16);
      });
      console.log(`      ${`${sec} s`.padEnd(8)}${cells.join('')}`);
    }
  }
  const clips = shadow.snores.filter((x) => x.wavStartSec != null).length;
  if (clips) console.log(`    ${clips} of its snores that ${r.sensitivity} missed are in the test-clip WAV (wavStartSec)`);
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/evaluate.js report.json [more.json ...]');
    process.exit(1);
  }
  files.forEach(report);
}
module.exports = { eventsOf, reevaluate, stricterBreath, preRiseVariant };
