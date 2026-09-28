/*
 * Snorewatch core: signal analysis, snore detection and session statistics.
 *
 * Pure JavaScript with no browser dependencies, so the same file runs in the
 * page (as window.SnoreCore) and in Node for tests (via require).
 *
 * How detection works
 *   1. Audio is cut into ~40 ms frames. Each frame gets a loudness (dBFS) and
 *      spectral features from an FFT: share of energy below 800 Hz, share of
 *      energy between 1 and 4 kHz, spectral centroid and zero-crossing rate.
 *   2. An adaptive noise floor tracks the room's background level. A sound
 *      event starts when a frame is `triggerDb` above the floor and ends when
 *      the level stays within `releaseDb` of the floor for `hangoverSec`.
 *   3. When an event ends it is classified. A snore is a single smooth burst
 *      of 0.25-4 s whose energy sits mostly below 800 Hz. Clicks and knocks
 *      are too short, traffic and music too long, speech and coughs too
 *      bright or too choppy.
 *   4. Only events classified as snores keep their audio (downsampled to
 *      ~8 kHz). Everything else is dropped from the short rolling buffer
 *      that exists only to capture the start of a snore.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SENSITIVITY = {
    low: { triggerDb: 12, releaseDb: 6 },
    normal: { triggerDb: 8, releaseDb: 4 },
    high: { triggerDb: 5, releaseDb: 3 },
  };

  const DEFAULTS = {
    sensitivity: 'normal',
    minDuration: 0.25, // s, shorter events are clicks/knocks
    maxDuration: 4.0, // s, longer events are continuous sounds
    minLowRatio: 0.55, // share of energy 50-800 Hz
    maxHighRatio: 0.2, // share of energy 1-4 kHz
    maxCentroid: 1000, // Hz
    maxPeaks: 2, // loudness bursts inside one event (syllables, knocks)
    peakDropDb: 6,
    hangoverSec: 0.2,
    calibrationSec: 1.0,
    minAbsDb: -70, // ignore anything quieter than this, whatever the floor
    preRollSec: 0.25,
    postRollSec: 0.15,
    clipRate: 8000,
    onFrame: null,
    onEvent: null,
  };

  const REASONS = {
    'too-short': 'Too short (click, knock)',
    'too-long': 'Too long (continuous noise)',
    'too-bright': 'Too bright (speech, cough)',
    'not-low': 'Not enough low-frequency energy',
    choppy: 'Choppy rhythm (speech, knocking)',
  };

  function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  /** In-place iterative radix-2 FFT. */
  class FFT {
    constructor(n) {
      if (n & (n - 1)) throw new Error('FFT size must be a power of two');
      this.n = n;
      this.cos = new Float64Array(n / 2);
      this.sin = new Float64Array(n / 2);
      for (let k = 0; k < n / 2; k++) {
        this.cos[k] = Math.cos((2 * Math.PI * k) / n);
        this.sin[k] = Math.sin((2 * Math.PI * k) / n);
      }
      this.rev = new Uint32Array(n);
      const bits = Math.log2(n);
      for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        this.rev[i] = r;
      }
    }

    transform(re, im) {
      const n = this.n;
      for (let i = 0; i < n; i++) {
        const j = this.rev[i];
        if (j > i) {
          let t = re[i];
          re[i] = re[j];
          re[j] = t;
          t = im[i];
          im[i] = im[j];
          im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const c = this.cos[k];
            const s = this.sin[k];
            const tre = re[l] * c + im[l] * s;
            const tim = im[l] * c - re[l] * s;
            re[l] = re[j] - tre;
            im[l] = im[j] - tim;
            re[j] += tre;
            im[j] += tim;
          }
        }
      }
    }
  }

  /** Loudness and spectral features for one frame of audio. */
  class FrameAnalyzer {
    constructor(sampleRate, frameSize) {
      this.sampleRate = sampleRate;
      this.n = frameSize;
      this.fft = new FFT(frameSize);
      this.re = new Float64Array(frameSize);
      this.im = new Float64Array(frameSize);
      this.window = new Float64Array(frameSize);
      for (let i = 0; i < frameSize; i++) {
        this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
      }
      const binHz = sampleRate / frameSize;
      const nyq = sampleRate / 2;
      const bin = (hz) => Math.min(frameSize / 2, Math.max(1, Math.round(hz / binHz)));
      this.binHz = binHz;
      this.total = [bin(50), bin(Math.min(8000, nyq))];
      this.low = [bin(50), bin(800)];
      this.high = [bin(1000), bin(Math.min(4000, nyq))];
    }

    analyze(frame) {
      const n = this.n;
      const re = this.re;
      const im = this.im;
      let sumSq = 0;
      let crossings = 0;
      let prev = frame[0];
      for (let i = 0; i < n; i++) {
        const x = frame[i];
        sumSq += x * x;
        if ((x >= 0) !== (prev >= 0)) crossings++;
        prev = x;
        re[i] = x * this.window[i];
        im[i] = 0;
      }
      const rms = Math.sqrt(sumSq / n);
      const db = Math.max(-120, 20 * Math.log10(rms + 1e-12));
      this.fft.transform(re, im);

      let total = 0;
      let low = 0;
      let high = 0;
      let weighted = 0;
      for (let k = this.total[0]; k < this.total[1]; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        total += p;
        weighted += p * k * this.binHz;
        if (k >= this.low[0] && k < this.low[1]) low += p;
        if (k >= this.high[0] && k < this.high[1]) high += p;
      }
      const safe = total > 0 ? total : 1;
      return {
        rms,
        db,
        power: rms * rms,
        lowRatio: low / safe,
        highRatio: high / safe,
        centroid: total > 0 ? weighted / total : 0,
        zcr: crossings / n,
      };
    }
  }

  /**
   * Counts loudness bursts in a dB track: a burst is a rise followed by a drop
   * of at least `dropDb`. One smooth snore gives 1, spoken syllables give many.
   */
  function countPeaks(track, dropDb) {
    let count = 0;
    let rising = true;
    let hi = -Infinity;
    let lo = Infinity;
    for (const x of track) {
      if (rising) {
        if (x > hi) hi = x;
        if (x < hi - dropDb) {
          count++;
          rising = false;
          lo = x;
        }
      } else {
        if (x < lo) lo = x;
        if (x > lo + dropDb) {
          rising = true;
          hi = x;
        }
      }
    }
    if (rising && track.length) count++;
    return count;
  }

  function percentile(values, q) {
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  class SnoreDetector {
    constructor(sampleRate, options = {}) {
      this.sampleRate = sampleRate;
      this.opts = Object.assign({}, DEFAULTS, options);
      this.setSensitivity(this.opts.sensitivity);

      this.frameSize = nextPow2(Math.round(sampleRate * 0.04));
      this.hopSec = this.frameSize / sampleRate;
      this.analyzer = new FrameAnalyzer(sampleRate, this.frameSize);
      this.pending = new Float32Array(this.frameSize);
      this.pendingLen = 0;
      this.frameIndex = 0;

      // Rolling buffer of downsampled audio, only long enough to cut out the
      // snore that is currently happening. Older audio is overwritten.
      this.decim = Math.max(1, Math.round(sampleRate / this.opts.clipRate));
      this.clipRate = sampleRate / this.decim;
      const ringSec = this.opts.maxDuration + this.opts.preRollSec + this.opts.hangoverSec + 2;
      this.ring = new Float32Array(Math.ceil(this.clipRate * ringSec));
      this.ringWritten = 0;
      this.decimAcc = 0;
      this.decimCount = 0;

      this.floor = null;
      this.calib = [];
      this.event = null;
      this.eventCount = 0;
    }

    setSensitivity(level) {
      const s = SENSITIVITY[level] || SENSITIVITY.normal;
      this.sensitivity = SENSITIVITY[level] ? level : 'normal';
      this.triggerDb = s.triggerDb;
      this.releaseDb = s.releaseDb;
    }

    get elapsed() {
      return (this.frameIndex * this.frameSize + this.pendingLen) / this.sampleRate;
    }

    get calibrating() {
      return this.floor === null;
    }

    /** Feed mono samples (Float32Array, -1..1). Returns events finished in this chunk. */
    process(samples) {
      const out = [];
      const ring = this.ring;
      const ringLen = ring.length;
      for (let i = 0; i < samples.length; i++) {
        const x = samples[i];
        this.decimAcc += x;
        if (++this.decimCount === this.decim) {
          ring[this.ringWritten % ringLen] = this.decimAcc / this.decim;
          this.ringWritten++;
          this.decimAcc = 0;
          this.decimCount = 0;
        }
        this.pending[this.pendingLen++] = x;
        if (this.pendingLen === this.frameSize) {
          const ev = this._frame(this.pending);
          this.pendingLen = 0;
          if (ev) out.push(ev);
        }
      }
      return out;
    }

    /** Ends a sound event that is still open, e.g. when recording stops. */
    flush() {
      if (!this.event) return null;
      return this._finish();
    }

    _frame(frame) {
      const f = this.analyzer.analyze(frame);
      const index = this.frameIndex;
      const o = this.opts;
      let finished = null;

      if (this.floor === null) {
        this.calib.push(f.db);
        if (this.calib.length * this.hopSec >= o.calibrationSec) {
          this.floor = Math.max(-100, percentile(this.calib, 0.3));
          this.calib = [];
        }
      } else if (!this.event) {
        if (f.db > this.floor + this.triggerDb && f.db > o.minAbsDb) {
          this.event = {
            startFrame: index,
            lastLoud: index,
            floor: this.floor,
            w: 0,
            low: 0,
            high: 0,
            centroid: 0,
            zcr: 0,
            energy: 0,
            loudFrames: 0,
            peakDb: -Infinity,
            track: [],
            tooLong: false,
          };
          this._accumulate(f, index);
        } else {
          // Fast to follow the room getting quieter, slow to follow it getting louder.
          const tau = f.db < this.floor ? 0.5 : 8;
          this.floor += (this.hopSec / tau) * (f.db - this.floor);
          this.floor = Math.max(-100, this.floor);
        }
      } else {
        const ev = this.event;
        if (f.db > this.floor + this.releaseDb) this._accumulate(f, index);
        else if (!ev.tooLong) ev.track.push(f.db);
        const dur = (index - ev.startFrame + 1) * this.hopSec;
        if (dur > o.maxDuration) ev.tooLong = true;
        // Let a lasting change in background noise become the new floor.
        const tau = ev.tooLong ? 8 : 60;
        this.floor += (this.hopSec / tau) * (f.db - this.floor);
        if ((index - ev.lastLoud) * this.hopSec >= o.hangoverSec) finished = this._finish();
      }

      this.frameIndex++;
      if (o.onFrame) {
        o.onFrame({
          index,
          t: index * this.hopSec,
          db: f.db,
          floor: this.floor,
          trigger: this.floor === null ? null : this.floor + this.triggerDb,
          active: !!this.event,
          calibrating: this.floor === null,
          lowRatio: f.lowRatio,
        });
      }
      if (finished && o.onEvent) o.onEvent(finished);
      return finished;
    }

    _accumulate(f, index) {
      const ev = this.event;
      ev.lastLoud = index;
      if (ev.tooLong) return;
      const w = f.power;
      ev.w += w;
      ev.low += w * f.lowRatio;
      ev.high += w * f.highRatio;
      ev.centroid += w * f.centroid;
      ev.zcr += f.zcr;
      ev.energy += f.power;
      ev.loudFrames++;
      if (f.db > ev.peakDb) ev.peakDb = f.db;
      ev.track.push(f.db);
    }

    _finish() {
      const ev = this.event;
      const o = this.opts;
      this.event = null;
      const hop = this.hopSec;
      const start = ev.startFrame * hop;
      const end = (ev.lastLoud + 1) * hop;
      const duration = end - start;
      const w = ev.w || 1;
      const features = {
        lowRatio: ev.low / w,
        highRatio: ev.high / w,
        centroid: ev.centroid / w,
        zcr: ev.zcr / Math.max(1, ev.loudFrames),
        peaks: countPeaks(ev.track, o.peakDropDb),
      };
      const verdict = classify(Object.assign({ duration, tooLong: ev.tooLong }, features), o);
      const result = {
        id: ++this.eventCount,
        start,
        end,
        duration,
        peakDb: ev.peakDb,
        meanDb: 10 * Math.log10(ev.energy / Math.max(1, ev.loudFrames) + 1e-24),
        floorDb: ev.floor,
        relDb: ev.peakDb - ev.floor,
        ...features,
        isSnore: verdict.isSnore,
        score: verdict.score,
        reason: verdict.reason,
        startFrame: ev.startFrame,
        endFrame: ev.lastLoud,
        clip: null,
        clipRate: this.clipRate,
      };
      if (result.isSnore) result.clip = this._cutClip(start - o.preRollSec, end + o.postRollSec);
      return result;
    }

    _cutClip(fromSec, toSec) {
      const ringLen = this.ring.length;
      const oldest = Math.max(0, this.ringWritten - ringLen);
      const a = Math.max(oldest, Math.floor(fromSec * this.clipRate));
      const b = Math.min(this.ringWritten, Math.ceil(toSec * this.clipRate));
      const clip = new Int16Array(Math.max(0, b - a));
      for (let i = a; i < b; i++) {
        const x = this.ring[i % ringLen];
        clip[i - a] = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
      }
      return clip;
    }
  }

  function classify(f, o) {
    const opts = Object.assign({}, DEFAULTS, o);
    let reason = null;
    if (f.tooLong || f.duration > opts.maxDuration) reason = 'too-long';
    else if (f.duration < opts.minDuration) reason = 'too-short';
    else if (f.highRatio > opts.maxHighRatio || f.centroid > opts.maxCentroid) reason = 'too-bright';
    else if (f.lowRatio < opts.minLowRatio) reason = 'not-low';
    else if (f.peaks > opts.maxPeaks) reason = 'choppy';
    const margins = [
      (f.lowRatio - opts.minLowRatio) / (1 - opts.minLowRatio),
      1 - f.highRatio / opts.maxHighRatio,
      1 - f.centroid / opts.maxCentroid,
    ].map(clamp01);
    const score = reason ? 0 : 0.5 + 0.5 * (margins.reduce((a, b) => a + b, 0) / margins.length);
    return { isSnore: !reason, reason, score };
  }

  /** Aggregates classified events into the live statistics and the report. */
  class SessionStats {
    constructor(options = {}) {
      this.maxClips = options.maxClips || 400;
      this.episodeGapSec = options.episodeGapSec || 60;
      this.snores = [];
      this.ignored = [];
      this.clipCount = 0;
    }

    add(ev) {
      if (ev.isSnore) {
        this.snores.push(ev);
        if (ev.clip) this.clipCount++;
        if (this.clipCount > this.maxClips) this._dropQuietestClip();
      } else {
        // Only the verdict is kept for ignored sounds, never audio.
        this.ignored.push({ start: ev.start, duration: ev.duration, reason: ev.reason, relDb: ev.relDb });
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
      for (const s of this.snores) {
        if (cur && s.start - cur.end <= this.episodeGapSec) {
          cur.end = s.end;
          cur.count++;
          cur.relDbSum += s.relDb;
        } else {
          cur = { start: s.start, end: s.end, count: 1, relDbSum: s.relDb };
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
          interval: (e.end - e.start) / Math.max(1, e.count - 1),
        }));
    }

    summary(elapsedSec) {
      const n = this.snores.length;
      const elapsed = Math.max(elapsedSec, 1e-9);
      let snoreSeconds = 0;
      let relSum = 0;
      let maxRel = 0;
      const intensity = { light: 0, moderate: 0, loud: 0 };
      for (const s of this.snores) {
        snoreSeconds += s.duration;
        relSum += s.relDb;
        if (s.relDb > maxRel) maxRel = s.relDb;
        if (s.relDb < 15) intensity.light++;
        else if (s.relDb < 25) intensity.moderate++;
        else intensity.loud++;
      }
      const intervals = [];
      for (let i = 1; i < n; i++) {
        const gap = this.snores[i].start - this.snores[i - 1].start;
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
      for (const s of this.snores) {
        const b = out[Math.min(count - 1, Math.floor(s.start / bucketSec))];
        b.count++;
        b.relDbSum += s.relDb;
      }
      return out.map((b) => ({ start: b.start, count: b.count, meanRelDb: b.count ? b.relDbSum / b.count : 0 }));
    }
  }

  /** 16-bit mono WAV from Int16 chunks, with `gapSec` of silence between them. */
  function encodeWav(chunks, sampleRate, gapSec = 0.4) {
    const rate = Math.round(sampleRate);
    const gap = Math.round(gapSec * rate);
    let samples = 0;
    chunks.forEach((c, i) => (samples += c.length + (i ? gap : 0)));
    const buf = new ArrayBuffer(44 + samples * 2);
    const v = new DataView(buf);
    const str = (off, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    v.setUint32(4, 36 + samples * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, samples * 2, true);
    let off = 44;
    chunks.forEach((c, i) => {
      if (i) off += gap * 2;
      for (let j = 0; j < c.length; j++, off += 2) v.setInt16(off, c[j], true);
    });
    return buf;
  }

  return {
    FFT,
    FrameAnalyzer,
    SnoreDetector,
    SessionStats,
    classify,
    countPeaks,
    encodeWav,
    nextPow2,
    DEFAULTS,
    SENSITIVITY,
    REASONS,
  };
});
