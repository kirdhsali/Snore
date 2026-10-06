/*
 * Snorewatch session statistics: counts confirmed snores (another snore 2-12 s
 * before or after), episodes, intervals and timeline buckets from the events
 * the detector decides. No browser dependencies (window.SnoreStats / require);
 * js/detector.js re-exports it as part of SnoreCore.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreStats = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The breathing-rhythm window: snores this far apart (start to start) confirm
  // each other, and the detector's rhythm rescue uses the same window.
  const RHYTHM_MIN_SEC = 2;
  const RHYTHM_MAX_SEC = 12;

  function percentile(values, q) {
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  /**
   * Aggregates classified events into the live statistics and the report.
   * `snores` holds every detected snore; the figures count only confirmed
   * ones (another snore 2-12 s before or after), isolated ones are "possible".
   */
  // How much later than its start an event can reach the statistics: a rhythm
  // candidate waits up to rhythmMaxSec for a snore, which then has to end.
  const LATE_ARRIVAL_SEC = 30;

  class SessionStats {
    constructor(options = {}) {
      this.maxClips = options.maxClips || 1500;
      this.episodeGapSec = options.episodeGapSec || 60;
      this.rhythmMinSec = options.rhythmMinSec || RHYTHM_MIN_SEC;
      this.rhythmMaxSec = options.rhythmMaxSec || RHYTHM_MAX_SEC;
      this.snores = [];
      this.ignored = [];
      this.gaps = []; // interruptions {start, end} in event time; no confirmation across them
      this.clipCount = 0;
    }

    /** Records an interruption; snores on either side of it do not confirm each other. */
    addGap(start, end) {
      this.gaps.push({ start, end });
    }

    _acrossGap(a, b) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return this.gaps.some((g) => g.start >= lo && g.start < hi);
    }

    /**
     * Snores with a neighbour in breathing rhythm, in time order. Events can
     * arrive out of order: a rhythm candidate is decided when a later snore comes.
     */
    get confirmed() {
      return this.snores.filter((s) => s.confirmed).sort((a, b) => a.start - b.start);
    }

    add(ev) {
      if (ev.isSnore) {
        ev.confirmed = false;
        // Neighbours before or after: a rescued sound arrives only once a later
        // snore decided it, i.e. after snores that started later than itself.
        for (let i = this.snores.length - 1; i >= 0; i--) {
          const gap = Math.abs(ev.start - this.snores[i].start);
          if (ev.start - this.snores[i].start > this.rhythmMaxSec + LATE_ARRIVAL_SEC) break;
          if (gap >= this.rhythmMinSec && gap <= this.rhythmMaxSec && !this._acrossGap(ev.start, this.snores[i].start)) {
            ev.confirmed = true;
            this.snores[i].confirmed = true;
          }
        }
        this.snores.push(ev);
        if (ev.clip) this.clipCount++;
        if (this.clipCount > this.maxClips) this._dropQuietestClip();
      } else {
        // Only the verdict and sound features are kept for ignored sounds, never audio.
        this.ignored.push({
          id: ev.id,
          start: ev.start,
          duration: ev.duration,
          reason: ev.reason,
          relDb: ev.relDb,
          peakDb: ev.peakDb,
          lowRatio: ev.lowRatio,
          highRatio: ev.highRatio,
          centroid: ev.centroid,
          peaks: ev.peaks,
          subBass: ev.subBass,
          fill: ev.fill,
          breathRise: ev.breathRise,
          onsetJump: ev.onsetJump,
        });
      }
    }

    _dropQuietestClip() {
      let min = null;
      for (const s of this.snores) if (s.clip && (!min || s.relDb < min.relDb)) min = s;
      if (min) {
        min.clip = null;
        this.clipCount--;
      }
    }

    episodes() {
      const eps = [];
      let cur = null;
      for (const s of this.confirmed) {
        if (cur && s.start - cur.end <= this.episodeGapSec) {
          cur.end = Math.max(cur.end, s.end);
          cur.lastStart = s.start;
          cur.count++;
          cur.relDbSum += s.relDb;
        } else {
          cur = { start: s.start, lastStart: s.start, end: s.end, count: 1, relDbSum: s.relDb };
          eps.push(cur);
        }
      }
      return eps
        .filter((e) => e.count >= 3)
        .map((e) => ({
          start: e.start,
          end: e.end,
          duration: e.end - e.start,
          count: e.count,
          meanRelDb: e.relDbSum / e.count,
          // Mean time from one snore's start to the next one's.
          interval: (e.lastStart - e.start) / Math.max(1, e.count - 1),
        }));
    }

    summary(elapsedSec) {
      const snores = this.confirmed;
      const n = snores.length;
      const elapsed = Math.max(elapsedSec, 1e-9);
      let snoreSeconds = 0;
      let relSum = 0;
      let maxRel = 0;
      const intensity = { light: 0, moderate: 0, loud: 0 };
      for (const s of snores) {
        snoreSeconds += s.duration;
        relSum += s.relDb;
        if (s.relDb > maxRel) maxRel = s.relDb;
        if (s.relDb < 15) intensity.light++;
        else if (s.relDb < 25) intensity.moderate++;
        else intensity.loud++;
      }
      const intervals = [];
      for (let i = 1; i < n; i++) {
        const gap = snores[i].start - snores[i - 1].start;
        if (gap <= this.episodeGapSec) intervals.push(gap);
      }
      const ignoredByReason = {};
      for (const e of this.ignored) ignoredByReason[e.reason] = (ignoredByReason[e.reason] || 0) + 1;
      const episodes = this.episodes();
      return {
        elapsed: elapsedSec,
        snoreCount: n,
        snoresPerHour: elapsedSec > 0 ? (n / elapsed) * 3600 : 0,
        snoreSeconds,
        snorePercent: elapsedSec > 0 ? (100 * snoreSeconds) / elapsed : 0,
        meanRelDb: n ? relSum / n : 0,
        maxRelDb: maxRel,
        medianInterval: intervals.length ? percentile(intervals, 0.5) : null,
        intensity,
        possibleCount: this.snores.length - n,
        rhythmCount: snores.filter((s) => s.rhythm).length,
        ignoredCount: this.ignored.length,
        ignoredByReason,
        episodes,
        longestEpisode: episodes.reduce((m, e) => (e.duration > m ? e.duration : m), 0),
      };
    }

    /** Snore counts per time bucket for the timeline chart. */
    buckets(elapsedSec, bucketSec) {
      const count = Math.max(1, Math.ceil(elapsedSec / bucketSec));
      const out = Array.from({ length: count }, (_, i) => ({ start: i * bucketSec, count: 0, relDbSum: 0 }));
      for (const s of this.confirmed) {
        const b = out[Math.min(count - 1, Math.floor(s.start / bucketSec))];
        b.count++;
        b.relDbSum += s.relDb;
      }
      return out.map((b) => ({ start: b.start, count: b.count, meanRelDb: b.count ? b.relDbSum / b.count : 0 }));
    }
  }

  return { SessionStats, percentile, RHYTHM_MIN_SEC, RHYTHM_MAX_SEC };
});
