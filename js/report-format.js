/*
 * Snorewatch data file (the "Download data" JSON): the one place that writes
 * it and reads it back.
 *
 * toReport() turns a finished night into the JSON object the app downloads.
 * fromReport() reads any report the app has ever written back into events on
 * the detector's terms, for scripts/evaluate.js and the tests.
 *
 * Schema versions:
 *   1  (no `schemaVersion` field) up to 1.10.x. v1.8 wrote one `shadow` object
 *      instead of `shadows`; reports before 1.10.1 have no `interruptions`;
 *      older ones lack some features (subBassShare, loudFill, breathRiseDb).
 *   2  1.11.0: adds `schemaVersion`; fields otherwise as in 1.10.x.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreReport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;

  const round = (v, digits) => (v == null || !isFinite(v) ? null : +v.toFixed(digits));
  const byStart = (a, b) => a.start - b.start;

  /** Sound features stored for every event, snore or not. */
  function features(x) {
    return {
      lowFrequencyShare: round(x.lowRatio, 3),
      highFrequencyShare: round(x.highRatio, 3),
      centroidHz: Math.round(x.centroid),
      bursts: x.peaks,
      subBassShare: round(x.subBass, 3),
      loudFill: round(x.fill, 2),
      breathRiseDb: round(x.breathRise, 1),
    };
  }

  /**
   * night: {
   *   version, source, startWall, endWall (ms), capturedSeconds,
   *   gaps: [{start, end (ms), clock (s on the events' clock), reason}],
   *   screenWakeLock, sensitivity, summary,
   *   snores: [events], ignored: [ignored-sound records],
   *   wavStarts: Map(event -> seconds in the WAV download) (optional),
   *   shadows: {name: {options, summary, levels, snores}}
   * }
   * Event times (`start`) are seconds on the night's clock: analysed audio
   * plus interruptions, so startWall + start is the moment it happened.
   */
  function toReport(night) {
    const time = (sec) => new Date(night.startWall + sec * 1000).toISOString();
    const wavStarts = night.wavStarts || new Map();
    return {
      app: 'Snorewatch',
      schemaVersion: SCHEMA_VERSION,
      version: night.version,
      source: night.source,
      startedAt: new Date(night.startWall).toISOString(),
      endedAt: new Date(night.endWall).toISOString(),
      wallSeconds: round((night.endWall - night.startWall) / 1000, 1),
      capturedSeconds: round(night.capturedSeconds, 1),
      // Times the system paused or stopped the microphone; nothing was analysed then.
      interruptions: (night.gaps || []).map((g) => ({
        start: new Date(g.start).toISOString(),
        end: new Date(g.end).toISOString(),
        seconds: round((g.end - g.start) / 1000, 1),
        offsetSec: round(g.clock, 2), // on the same clock as the snores' offsetSec
        reason: g.reason,
      })),
      screenWakeLock: night.screenWakeLock,
      sensitivity: night.sensitivity,
      summary: night.summary,
      snores: [...night.snores].sort(byStart).map((x) => ({
        time: time(x.start),
        offsetSec: round(x.start, 2),
        durationSec: round(x.duration, 2),
        aboveRoomDb: round(x.relDb, 1),
        peakDbfs: round(x.peakDb, 1),
        confidence: round(x.score, 2),
        ...features(x),
        rhythmRescued: !!x.rhythm,
        confirmed: !!x.confirmed,
        wavStartSec: wavStarts.has(x) ? round(wavStarts.get(x), 2) : null,
      })),
      ignored: night.ignored.map((x) => ({
        time: time(x.start),
        offsetSec: round(x.start, 2),
        durationSec: round(x.duration, 2),
        reason: x.reason,
        aboveRoomDb: round(x.relDb, 1),
        peakDbfs: round(x.peakDb, 1),
        ...features(x),
      })),
      // Candidate rules running in the background on the same audio, for comparison.
      shadows: Object.fromEntries(
        Object.entries(night.shadows || {}).map(([name, sh]) => [
          name,
          {
            sensitivity: sh.options.sensitivity,
            minBreathRiseDb: sh.options.minBreathRiseDb,
            summary: {
              snoreCount: sh.summary.snoreCount,
              possibleCount: sh.summary.possibleCount,
              snoresPerHour: round(sh.summary.snoresPerHour, 1),
              ignoredCount: sh.summary.ignoredCount,
              ignoredByReason: sh.summary.ignoredByReason,
              episodes: sh.summary.episodes.length,
            },
            levels: sh.levels.map((l) => ({
              offsetSec: Math.round(l.t),
              triggerDb: round(l.triggerDb, 1),
              releaseDb: round(l.releaseDb, 1),
              spreadDb: round(l.spreadDb, 2),
              floorDbfs: round(l.floorDb, 1),
            })),
            snores: [...sh.snores].sort(byStart).map((x) => ({
              offsetSec: round(x.start, 2),
              durationSec: round(x.duration, 2),
              aboveRoomDb: round(x.relDb, 1),
              breathRiseDb: round(x.breathRise, 1),
              confirmed: !!x.confirmed,
            })),
          },
        ]),
      ),
    };
  }

  /** A stored event back on the detector's terms (field names as in SnoreDetector events). */
  function toEvent(x, isSnore) {
    return {
      start: x.offsetSec,
      duration: x.durationSec,
      relDb: x.aboveRoomDb,
      peakDb: x.peakDbfs ?? null,
      score: x.confidence ?? null,
      lowRatio: x.lowFrequencyShare ?? null,
      highRatio: x.highFrequencyShare ?? null,
      centroid: x.centroidHz ?? null,
      peaks: x.bursts ?? null,
      subBass: x.subBassShare ?? null,
      fill: x.loudFill ?? null,
      breathRise: x.breathRiseDb ?? null,
      isSnore,
      reason: isSnore ? null : x.reason,
      rhythm: !!x.rhythmRescued,
      confirmed: !!x.confirmed,
    };
  }

  /**
   * Reads a report of any schema version. Events come back in time order with
   * detector field names; `missing` lists features the file does not hold, so
   * callers can say which rules cannot be checked on it.
   */
  function fromReport(r) {
    if (!r || (r.app && r.app !== 'Snorewatch') || !Array.isArray(r.snores) || !Array.isArray(r.ignored)) {
      throw new Error('Not a Snorewatch data file');
    }
    const schemaVersion = r.schemaVersion || 1;
    if (schemaVersion > SCHEMA_VERSION)
      throw new Error(`Data file schema ${schemaVersion} is newer than this version understands (${SCHEMA_VERSION})`);
    const snores = r.snores.map((x) => toEvent(x, true));
    const ignored = r.ignored.map((x) => toEvent(x, false));
    const events = [...snores, ...ignored].filter((e) => e.start != null).sort(byStart);
    const has = (key) => events.some((e) => e[key] != null);
    const missing = [];
    if (!has('subBass')) missing.push('subBassShare');
    if (!has('fill')) missing.push('loudFill');
    if (!has('breathRise')) missing.push('breathRiseDb');
    if (!ignored.some((e) => e.lowRatio != null)) missing.push('ignoredFeatures');
    return {
      schemaVersion,
      version: r.version || null,
      source: r.source || null,
      startedAt: r.startedAt ? Date.parse(r.startedAt) : null,
      endedAt: r.endedAt ? Date.parse(r.endedAt) : null,
      sensitivity: r.sensitivity || null,
      summary: r.summary || null,
      elapsed: r.summary ? r.summary.elapsed : null,
      // Gaps on the events' clock; reports before 1.10.1 have none recorded.
      interruptions: (r.interruptions || [])
        .filter((g) => g.offsetSec != null)
        .map((g) => ({ start: g.offsetSec, end: g.offsetSec + (g.seconds || 0), reason: g.reason })),
      events,
      snores: events.filter((e) => e.isSnore),
      ignored: events.filter((e) => !e.isSnore),
      shadows: r.shadows || (r.shadow ? { auto: r.shadow } : {}),
      missing,
    };
  }

  return { SCHEMA_VERSION, toReport, fromReport };
});
