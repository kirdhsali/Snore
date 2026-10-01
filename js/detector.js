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
 *      are too short, traffic and music too long, deep rumble (traffic,
 *      building) has nearly all its energy below 60 Hz, speech and coughs are
 *      too bright or too choppy.
 *   3b. Breathing rhythm: a snore-like sound that is only rejected for being
 *      choppy (a rattling snore) still counts when an accepted snore lies
 *      2-12 s before or after it. It waits up to 12 s for that snore.
 *   3b'. Breath noise: a snore is air rushing through a narrowed throat, so the
 *      150-1500 Hz band rises above the room noise. `breathRise` measures that
 *      rise; with `minBreathRiseDb` set, sounds without it (hum, rumble, a lift)
 *      are ignored as 'no-breath'. Off by default, tested in the background.
 *   3c. Snores repeat with the breathing. SessionStats marks a snore as
 *      confirmed when another snore lies 2-12 s before or after it; isolated
 *      ones are only "possible" and left out of the headline figures.
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

  // triggerDb/releaseDb: margin above the room's noise floor.
  // minAbsDb: absolute level (dBFS) a sound must reach at all. Phones record
  // quiet bedrooms at around -80 dBFS, so this gate matters in practice.
  const SENSITIVITY = {
    low: { triggerDb: 12, releaseDb: 6, minAbsDb: -65 },
    normal: { triggerDb: 8, releaseDb: 4, minAbsDb: -75 },
    high: { triggerDb: 5, releaseDb: 3, minAbsDb: -85 },
    // Starts like normal, then sets the margins from how much the room noise
    // fluctuates (see _autoUpdate). The absolute gate only guards against silence.
    auto: { triggerDb: 8, releaseDb: 4, minAbsDb: -95 },
  };

  const DEFAULTS = {
    sensitivity: 'normal',
    minDuration: 0.25, // s, shorter events are clicks/knocks
    maxDuration: 4.0, // s, longer events are continuous sounds
    minLowRatio: 0.55, // share of energy 50-800 Hz
    maxHighRatio: 0.2, // share of energy 1-4 kHz
    maxCentroid: 500, // Hz (real snores measured 60-250 Hz; brighter sounds are mostly other things)
    maxPeaks: 2, // loudness bursts inside one event (syllables, knocks)
    peakDropDb: 6,
    maxSubBass: 0.85, // share of energy 20-60 Hz (of 20-4000 Hz); above = deep rumble
    minBreathRiseDb: null, // rise of 150-1500 Hz above the room noise a snore needs; null = not checked
    // Rhythm rescue of choppy but snore-like sounds
    rhythmMinSec: 2, // start-to-start distance to an accepted snore
    rhythmMaxSec: 12,
    rhythmMaxHighRatio: 0.05,
    rhythmMaxCentroid: 400, // Hz
    rhythmMinFill: 0.6, // share of frames within 15 dB of the peak (knocks are short thuds with gaps)
    hangoverSec: 0.2,
    calibrationSec: 1.0,
    minAbsDb: null, // overrides the sensitivity's absolute gate when set
    preRollSec: 0.25,
    postRollSec: 0.15,
    clipRate: 8000,
    keepClips: true, // false for a detector that only counts (the auto shadow)
    // Auto sensitivity: statistics of quiet frames (not during or right after a sound)
    autoWindowSec: 180,
    autoUpdateSec: 30,
    autoGuardSec: 1,
    autoMinIdleSec: 20,
    autoBlockSec: 0.5, // quiet stretches are averaged over this long before measuring their spread
    autoQuietRoomDb: -78, // below this floor (dBFS) the room counts as very quiet
    autoQuietMaxTriggerDb: 9, // ...and the trigger margin is capped there
    onFrame: null,
    onEvent: null,
  };

  const REASONS = {
    'too-short': 'Too short (click, knock)',
    'too-long': 'Too long (continuous noise)',
    'too-bright': 'Too bright (speech, cough)',
    'not-low': 'Not enough low-frequency energy',
    choppy: 'Choppy rhythm (speech, knocking)',
    rumble: 'Deep rumble (traffic, building)',
    'no-breath': 'No breath noise (hum, rumble)',
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
      this.mid = [bin(150), bin(Math.min(1500, nyq))]; // breath noise band
    }

    analyze(frame) {
      const n = this.n;
      const re = this.re;
      const im = this.im;
      let sumSq = 0;
      let crossings = 0;
      let wasUp = frame[0] >= 0;
      for (let i = 0; i < n; i++) {
        const x = frame[i];
        sumSq += x * x;
        const up = x >= 0;
        if (up !== wasUp) crossings++;
        wasUp = up;
        re[i] = x * this.window[i];
        im[i] = 0;
      }
      const rms = Math.sqrt(sumSq / n);
      const db = Math.max(-120, 20 * Math.log10(rms + 1e-12));
      this.fft.transform(re, im);

      let total = 0;
      let low = 0;
      let high = 0;
      let mid = 0;
      let weighted = 0;
      for (let k = this.total[0]; k < this.total[1]; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        total += p;
        weighted += p * k * this.binHz;
        if (k >= this.low[0] && k < this.low[1]) low += p;
        if (k >= this.high[0] && k < this.high[1]) high += p;
        if (k >= this.mid[0] && k < this.mid[1]) mid += p;
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
        midDb: 10 * Math.log10(mid / n + 1e-24),
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

  /** Share of frames within 15 dB of the peak: high for a sustained sound, low for thuds with gaps. */
  function bodyShare(track, peakDb) {
    if (!track.length) return 0;
    let n = 0;
    for (const db of track) if (db >= peakDb - 15) n++;
    return n / track.length;
  }

  const fftCache = new Map();

  /**
   * Share of energy at 20-60 Hz within 20-4000 Hz over a whole clip. Deep
   * rumble from traffic or the building sits almost entirely below 60 Hz;
   * snores have their fundamental and harmonics higher up.
   */
  function subBassShare(samples, rate) {
    if (samples.length < 64) return 0;
    const n = nextPow2(samples.length);
    if (!fftCache.has(n)) fftCache.set(n, new FFT(n));
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const len = samples.length;
    for (let i = 0; i < len; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
    fftCache.get(n).transform(re, im);
    const binHz = rate / n;
    let sub = 0;
    let total = 0;
    for (let k = Math.ceil(20 / binHz); k < Math.min(n / 2, 4000 / binHz); k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      total += p;
      if (k * binHz < 60) sub += p;
    }
    return total > 0 ? sub / total : 0;
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
      this.timeOffset = 0; // seconds of interruptions so far (see resumeAfterGap)

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
      this.emitted = [];
      this.gate = new RhythmGate(this.opts, (ev) => this._emit(ev));

      // Auto sensitivity: rolling record of how far quiet frames sit above the floor.
      // Quiet frames are averaged into blocks first: single 40 ms frames of a very
      // quiet room flicker by several dB without the room being restless.
      this.autoIdle = new Float32Array(Math.ceil(this.opts.autoWindowSec / this.opts.autoBlockSec));
      this.autoIdleCount = 0;
      this.autoBlock = { power: 0, n: 0, size: Math.max(1, Math.round(this.opts.autoBlockSec / this.hopSec)) };
      this.bgMid = null; // room noise level in the breath band (dB), tracked like the floor
      this.calibMid = [];
      this.lastEventEndFrame = -Infinity;
      this.levels = []; // history of auto margins: {t, triggerDb, releaseDb, spreadDb, floorDb}
    }

    setSensitivity(level) {
      const s = SENSITIVITY[level] || SENSITIVITY.normal;
      this.sensitivity = SENSITIVITY[level] ? level : 'normal';
      this.triggerDb = s.triggerDb;
      this.releaseDb = s.releaseDb;
      this.minAbsDb = this.opts.minAbsDb != null ? this.opts.minAbsDb : s.minAbsDb;
      this.auto = this.sensitivity === 'auto';
    }

    /** Averages quiet frames (not during or just after a sound) into blocks for the spread measurement. */
    _autoCollect(f, index) {
      const o = this.opts;
      const b = this.autoBlock;
      if ((index - this.lastEventEndFrame) * this.hopSec <= o.autoGuardSec) {
        b.power = 0;
        b.n = 0;
        return;
      }
      b.power += f.power;
      if (++b.n === b.size) {
        this.autoIdle[this.autoIdleCount++ % this.autoIdle.length] = 10 * Math.log10(b.power / b.n + 1e-24) - this.floor;
        b.power = 0;
        b.n = 0;
      }
    }

    /**
     * Auto sensitivity. The spread of quiet half-second blocks above the floor
     * (90th minus 50th percentile) says how restless the room is: a still bedroom
     * gets small margins, a fan or rain larger ones. In a very quiet room the
     * trigger is capped. Changes are limited to 2 dB per update.
     */
    _autoUpdate(t) {
      const o = this.opts;
      const n = Math.min(this.autoIdleCount, this.autoIdle.length);
      if (n * o.autoBlockSec < o.autoMinIdleSec) return;
      const v = Array.from(this.autoIdle.subarray(0, n)).sort((a, b) => a - b);
      const spread = v[Math.floor(0.9 * (n - 1))] - v[Math.floor(0.5 * (n - 1))];
      const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
      const step = (from, to) => from + clamp(to - from, -2, 2);
      // Lower limits as for "high": smaller margins let room noise dilute the sound's profile.
      // In a very quiet room a large spread is more likely microphone flicker than a restless room.
      const quiet = this.floor < o.autoQuietRoomDb;
      const release = clamp(1.5 * spread + 2, 3, quiet ? o.autoQuietMaxTriggerDb - 2 : 7);
      const trigger = clamp(release + 2 + spread, 5, quiet ? o.autoQuietMaxTriggerDb : 14);
      this.releaseDb = step(this.releaseDb, release);
      this.triggerDb = Math.max(this.releaseDb + 1, step(this.triggerDb, trigger));
      this.levels.push({ t, triggerDb: this.triggerDb, releaseDb: this.releaseDb, spreadDb: spread, floorDb: this.floor });
    }

    get elapsed() {
      return (this.frameIndex * this.frameSize + this.pendingLen) / this.sampleRate;
    }

    /** Time since the start of the recording including interruptions: the time base of all events. */
    get clock() {
      return this.elapsed + this.timeOffset;
    }

    /**
     * Continues after an interruption of `gapSec` with no audio. The sound that
     * was going on is closed, sounds waiting for a snore in rhythm are rejected
     * and earlier snores no longer anchor the rhythm: nothing is decided across
     * a gap. Later events are timed after the gap. Returns the events decided.
     */
    resumeAfterGap(gapSec) {
      if (this.event) this.gate.decide(this._finish());
      this.gate.breakRhythm();
      this.timeOffset += Math.max(0, gapSec);
      return this._takeEmitted();
    }

    get calibrating() {
      return this.floor === null;
    }

    /** Feed mono samples (Float32Array, -1..1). Returns events decided in this chunk. */
    process(samples) {
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
          this._frame(this.pending);
          this.pendingLen = 0;
        }
      }
      return this._takeEmitted();
    }

    /**
     * Ends everything still open, e.g. when recording stops: the current sound
     * and any sounds still waiting for a snore in rhythm. Returns those events.
     */
    flush() {
      if (this.event) this.gate.decide(this._finish());
      this.gate.flush();
      return this._takeEmitted();
    }

    /**
     * Wipes the audio this detector still holds (rolling buffer, current frame,
     * last spectrum) after the recording has ended. Clips already cut out of
     * accepted snores are separate arrays and stay.
     */
    release() {
      this.ring.fill(0);
      this.ringWritten = 0;
      this.pending.fill(0);
      this.pendingLen = 0;
      this.decimAcc = 0;
      this.decimCount = 0;
      this.analyzer.re.fill(0);
      this.analyzer.im.fill(0);
    }

    _takeEmitted() {
      const out = this.emitted;
      this.emitted = [];
      return out;
    }

    _emit(ev) {
      this.emitted.push(ev);
      if (this.opts.onEvent) this.opts.onEvent(ev);
    }

    _frame(frame) {
      const f = this.analyzer.analyze(frame);
      const index = this.frameIndex;
      const o = this.opts;
      let finished = null;

      if (this.floor === null) {
        this.calib.push(f.db);
        this.calibMid.push(f.midDb);
        if (this.calib.length * this.hopSec >= o.calibrationSec) {
          this.floor = Math.max(-100, percentile(this.calib, 0.3));
          this.bgMid = percentile(this.calibMid, 0.3);
          this.calib = [];
          this.calibMid = [];
        }
      } else if (!this.event) {
        if (f.db > this.floor + this.triggerDb && f.db > this.minAbsDb) {
          this.event = {
            startFrame: index,
            lastLoud: index,
            floor: this.floor,
            bgMid: this.bgMid,
            mid: 0,
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
          const tauMid = f.midDb < this.bgMid ? 0.5 : 8;
          this.bgMid += (this.hopSec / tauMid) * (f.midDb - this.bgMid);
          if (this.auto) this._autoCollect(f, index);
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
        this.bgMid += (this.hopSec / tau) * (f.midDb - this.bgMid);
        if ((index - ev.lastLoud) * this.hopSec >= o.hangoverSec) finished = this._finish();
      }
      if (this.auto && this.floor !== null && index % Math.round(o.autoUpdateSec / this.hopSec) === 0) {
        this._autoUpdate(index * this.hopSec);
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
      if (finished) this.gate.decide(finished);
      // A sound still in progress may yet be the snore that decides a waiting
      // candidate, so candidates only expire up to the start of an open sound.
      this.gate.expire((this.event ? this.event.startFrame * this.hopSec : index * this.hopSec) + this.timeOffset);
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
      ev.mid += Math.pow(10, f.midDb / 10);
      ev.loudFrames++;
      if (f.db > ev.peakDb) ev.peakDb = f.db;
      ev.track.push(f.db);
    }

    _finish() {
      const ev = this.event;
      const o = this.opts;
      this.event = null;
      this.lastEventEndFrame = ev.lastLoud;
      const hop = this.hopSec;
      const audioStart = ev.startFrame * hop;
      const audioEnd = (ev.lastLoud + 1) * hop;
      const duration = audioEnd - audioStart;
      const start = audioStart + this.timeOffset;
      const end = audioEnd + this.timeOffset;
      const w = ev.w || 1;
      const audio = ev.tooLong ? null : this._ringSegment(audioStart - o.preRollSec, audioEnd + o.postRollSec);
      const features = {
        lowRatio: ev.low / w,
        highRatio: ev.high / w,
        centroid: ev.centroid / w,
        zcr: ev.zcr / Math.max(1, ev.loudFrames),
        peaks: countPeaks(ev.track, o.peakDropDb),
        subBass: audio ? subBassShare(audio, this.clipRate) : null,
        fill: bodyShare(ev.track.slice(0, ev.lastLoud - ev.startFrame + 1), ev.peakDb),
        breathRise: ev.loudFrames ? 10 * Math.log10(ev.mid / ev.loudFrames + 1e-24) - ev.bgMid : null,
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
        rhythm: false,
        rhythmCandidate: verdict.reason === 'choppy' && isRhythmCandidate(features, o),
        clip: null,
        clipRate: this.clipRate,
      };
      // Candidates keep their audio only while they wait; it is dropped if no snore confirms them.
      if ((result.isSnore || result.rhythmCandidate) && o.keepClips)
        result.clip = Int16Array.from(audio, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
      return result;
    }

    /** Downsampled audio between two times, as far as the rolling buffer still holds it. */
    _ringSegment(fromSec, toSec) {
      const ringLen = this.ring.length;
      const oldest = Math.max(0, this.ringWritten - ringLen);
      const a = Math.max(oldest, Math.floor(fromSec * this.clipRate));
      const b = Math.min(this.ringWritten, Math.ceil(toSec * this.clipRate));
      const out = new Float32Array(Math.max(0, b - a));
      for (let i = a; i < b; i++) out[i - a] = this.ring[i % ringLen];
      return out;
    }
  }

  function classify(f, o) {
    const opts = Object.assign({}, DEFAULTS, o);
    let reason = null;
    if (f.tooLong || f.duration > opts.maxDuration) reason = 'too-long';
    else if (f.duration < opts.minDuration) reason = 'too-short';
    else if (f.subBass != null && f.subBass > opts.maxSubBass) reason = 'rumble';
    else if (f.highRatio > opts.maxHighRatio || f.centroid > opts.maxCentroid) reason = 'too-bright';
    else if (f.lowRatio < opts.minLowRatio) reason = 'not-low';
    else if (opts.minBreathRiseDb != null && f.breathRise != null && f.breathRise < opts.minBreathRiseDb) reason = 'no-breath';
    else if (f.peaks > opts.maxPeaks) reason = 'choppy';
    const margins = [
      (f.lowRatio - opts.minLowRatio) / (1 - opts.minLowRatio),
      1 - f.highRatio / opts.maxHighRatio,
      1 - f.centroid / opts.maxCentroid,
    ].map(clamp01);
    const score = reason ? 0 : 0.5 + 0.5 * (margins.reduce((a, b) => a + b, 0) / margins.length);
    return { isSnore: !reason, reason, score };
  }

  /** A choppy sound that looks like a rattling snore: low, dull and mostly sounding, not knocks with gaps. */
  function isRhythmCandidate(f, o) {
    const opts = Object.assign({}, DEFAULTS, o);
    return f.highRatio <= opts.rhythmMaxHighRatio && f.centroid <= opts.rhythmMaxCentroid && f.fill >= opts.rhythmMinFill;
  }

  /**
   * Breathing-rhythm rescue. Receives classified events in time order and
   * passes them on: snores and clear rejections at once, rhythm candidates
   * (choppy but snore-like) once a snore starting 2-12 s before or after them
   * decides them. Only snores accepted on their own count as anchors.
   * Used by the live detector and by scripts/evaluate.js.
   */
  class RhythmGate {
    constructor(options, emit) {
      this.opts = Object.assign({}, DEFAULTS, options);
      this.emit = emit;
      this.candidates = [];
      this.anchors = []; // starts of recent snores accepted on their own
    }

    _inRhythm(a, b) {
      const gap = Math.abs(a - b);
      return gap >= this.opts.rhythmMinSec && gap <= this.opts.rhythmMaxSec;
    }

    decide(ev) {
      if (ev.isSnore) {
        // A snore accepts the waiting candidates it is in rhythm with. One that
        // is too close keeps waiting: a later snore may still be in rhythm with it.
        this.candidates = this.candidates.filter((c) => {
          if (!this._inRhythm(ev.start, c.start)) return true;
          this._accept(c);
          return false;
        });
        this._pass(ev);
      } else if (ev.rhythmCandidate) {
        if (this.anchors.some((a) => this._inRhythm(ev.start, a))) this._accept(ev);
        else this.candidates.push(ev);
      } else {
        this._pass(ev);
      }
    }

    /** Rejects candidates that no snore can follow any more: `now` is past their window. */
    expire(now) {
      while (this.candidates.length && now - this.candidates[0].start > this.opts.rhythmMaxSec) {
        this._reject(this.candidates.shift());
      }
      while (this.anchors.length && now - this.anchors[0] > this.opts.rhythmMaxSec) this.anchors.shift();
    }

    flush() {
      for (const c of this.candidates.splice(0)) this._reject(c);
    }

    /** After an interruption: nothing waits and nothing anchors across it. */
    breakRhythm() {
      this.flush();
      this.anchors = [];
    }

    _accept(ev) {
      ev.isSnore = true;
      ev.reason = null;
      ev.rhythm = true;
      ev.score = classify(Object.assign({}, ev, { peaks: 1 }), this.opts).score;
      this._pass(ev);
    }

    _reject(ev) {
      ev.clip = null; // the audio of sounds that are not snores is dropped
      this._pass(ev);
    }

    _pass(ev) {
      // Only snores that passed on their own anchor the rhythm, so rescues cannot chain through noise.
      if (ev.isSnore && !ev.rhythm) this.anchors.push(ev.start);
      this.emit(ev);
    }
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
      this.rhythmMinSec = options.rhythmMinSec || DEFAULTS.rhythmMinSec;
      this.rhythmMaxSec = options.rhythmMaxSec || DEFAULTS.rhythmMaxSec;
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

  /**
   * Evens out clip volume for listening: scales the clip so its peak reaches
   * `targetPeak` (0..1), boosting by at most `maxGainDb`. Never turns it down.
   */
  function normalizeClip(clip, targetPeak = 0.7, maxGainDb = 60) {
    let peak = 1;
    for (let i = 0; i < clip.length; i++) peak = Math.max(peak, Math.abs(clip[i]));
    const gain = Math.min((targetPeak * 32767) / peak, Math.pow(10, maxGainDb / 20));
    if (gain <= 1) return clip;
    return Int16Array.from(clip, (x) => Math.max(-32768, Math.min(32767, Math.round(x * gain))));
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
    RhythmGate,
    SessionStats,
    classify,
    isRhythmCandidate,
    subBassShare,
    countPeaks,
    encodeWav,
    normalizeClip,
    nextPow2,
    DEFAULTS,
    SENSITIVITY,
    REASONS,
  };
});
