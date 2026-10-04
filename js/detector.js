/*
 * Snorewatch core: signal analysis and snore detection. Also the one entry
 * point (window.SnoreCore / require) that re-exports the session statistics
 * (js/stats.js), the WAV helpers (js/wav.js) and the room noise profile
 * (js/noise.js), which load before it.
 *
 * Pure JavaScript with no browser dependencies, so the same file runs in the
 * page and in Node for tests.
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
 *      rise; sounds without it (hum, rumble, a lift) are ignored as 'no-breath'.
 *      Normal sensitivity requires 6 dB (since 1.17.0, after background tests on
 *      real nights); Low and High do not check it unless `minBreathRiseDb` is set.
 *   3b''. Snore band: a snore's flutter raises the 50-800 Hz band above that
 *      band's own room noise. `lowRise` measures it; with `minLowRiseDb` set,
 *      sounds that barely change it (quiet breathing over a room's hum) are
 *      ignored as 'no-low-rise'. Off by default; the auto background test uses it.
 *   3c. Snores repeat with the breathing. SessionStats marks a snore as
 *      confirmed when another snore lies 2-12 s before or after it; isolated
 *      ones are only "possible" and left out of the headline figures.
 *   4. Only events classified as snores keep their audio (downsampled to
 *      ~8 kHz). Everything else is dropped from the short rolling buffer
 *      that exists only to capture the start of a snore.
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(
    node ? require('./stats.js') : root.SnoreStats,
    node ? require('./wav.js') : root.SnoreWav,
    node ? require('./noise.js') : root.SnoreNoise,
  );
  if (node) module.exports = api;
  else root.SnoreCore = api;
})(typeof self !== 'undefined' ? self : this, function (Stats, Wav, Noise) {
  'use strict';

  const { SessionStats, percentile } = Stats;
  const { encodeWav, clipFromAudio } = Wav;

  // triggerDb/releaseDb: margin above the room's noise floor.
  // minAbsDb: absolute level (dBFS) a sound must reach at all. Phones record
  // quiet bedrooms at around -80 dBFS, so this gate matters in practice.
  const SENSITIVITY = {
    low: { triggerDb: 12, releaseDb: 6, minAbsDb: -65 },
    // minBreathRiseDb: the breath-noise rule of this sensitivity (see 3b' above), unless the options set one.
    normal: { triggerDb: 8, releaseDb: 4, minAbsDb: -75, minBreathRiseDb: 6 },
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
    minBreathRiseDb: undefined, // rise of 150-1500 Hz above the room noise a snore needs; undefined = the sensitivity's, null = not checked
    minLowRiseDb: null, // rise of 50-800 Hz above that band's room noise a snore needs; null = not checked
    // Rhythm rescue of choppy but snore-like sounds
    rhythmMinSec: Stats.RHYTHM_MIN_SEC, // start-to-start distance to an accepted snore (js/stats.js)
    rhythmMaxSec: Stats.RHYTHM_MAX_SEC,
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
    noiseProfile: false, // true: keep a per-minute room noise profile (numbers only; the counting detector)
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
    'no-low-rise': 'No rise in the snore band (breathing, room hum)',
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
        lowDb: 10 * Math.log10(low / n + 1e-24), // the snore band, 50-800 Hz
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

  class SnoreDetector {
    constructor(sampleRate, options = {}) {
      this.sampleRate = sampleRate;
      this.opts = Object.assign({}, DEFAULTS, options);
      this.setSensitivity(this.opts.sensitivity);
      this.opts.minBreathRiseDb = breathRuleDb(this.opts);

      this.frameSize = nextPow2(Math.round(sampleRate * 0.04));
      this.hopSec = this.frameSize / sampleRate;
      this.analyzer = new FrameAnalyzer(sampleRate, this.frameSize);
      this.noise = this.opts.noiseProfile ? new Noise.NoiseProfile(sampleRate, this.frameSize) : null;
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
      this.bgLow = null; // room noise level in the snore band (dB), tracked like the floor
      this.calibLow = [];
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
     * gets small margins, a fan or rain larger ones. A sound ends only once the
     * level is back within the room's usual quiet range (median + spread + 1 dB):
     * the floor follows the quietest moments, and a wavering hum keeps the usual
     * level several dB above it (night 4: 3-5 dB), where a lower release kept
     * sounds open until the hum made them look choppy or too long. In a very quiet
     * room the trigger is capped. Changes are limited to 2 dB per update.
     */
    _autoUpdate(t) {
      const o = this.opts;
      const n = Math.min(this.autoIdleCount, this.autoIdle.length);
      if (n * o.autoBlockSec < o.autoMinIdleSec) return;
      const v = Array.from(this.autoIdle.subarray(0, n)).sort((a, b) => a - b);
      const usual = v[Math.floor(0.5 * (n - 1))];
      const spread = v[Math.floor(0.9 * (n - 1))] - usual;
      const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
      const step = (from, to) => from + clamp(to - from, -2, 2);
      // Lower limits as for "high": smaller margins let room noise dilute the sound's profile.
      // In a very quiet room a large spread is more likely microphone flicker than a restless room.
      const quiet = this.floor < o.autoQuietRoomDb;
      const maxRelease = quiet ? o.autoQuietMaxTriggerDb - 2 : 7;
      const base = clamp(1.5 * spread + 2, 3, maxRelease);
      const release = clamp(Math.max(base, usual + spread + 1), 3, maxRelease);
      // The trigger keeps its margin over the spread; it only rises to stay above the release.
      const trigger = clamp(Math.max(base + 2 + spread, release + 1), 5, quiet ? o.autoQuietMaxTriggerDb : 14);
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
        this.calibLow.push(f.lowDb);
        if (this.calib.length * this.hopSec >= o.calibrationSec) {
          this.floor = Math.max(-100, percentile(this.calib, 0.3));
          this.bgMid = percentile(this.calibMid, 0.3);
          this.bgLow = percentile(this.calibLow, 0.3);
          this.calib = [];
          this.calibMid = [];
          this.calibLow = [];
        }
      } else if (!this.event) {
        if (f.db > this.floor + this.triggerDb && f.db > this.minAbsDb) {
          this.event = {
            startFrame: index,
            lastLoud: index,
            floor: this.floor,
            bgMid: this.bgMid,
            mid: 0,
            bgLow: this.bgLow,
            lowBand: 0,
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
          const tauLow = f.lowDb < this.bgLow ? 0.5 : 8;
          this.bgLow += (this.hopSec / tauLow) * (f.lowDb - this.bgLow);
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
        this.bgLow += (this.hopSec / tau) * (f.lowDb - this.bgLow);
        if ((index - ev.lastLoud) * this.hopSec >= o.hangoverSec) finished = this._finish();
      }
      if (this.auto && this.floor !== null && index % Math.round(o.autoUpdateSec / this.hopSec) === 0) {
        this._autoUpdate(index * this.hopSec);
      }

      if (this.noise) {
        // Background: no sound going on and none just ended (the same guard as auto's statistics).
        const quiet = !this.event && (index - this.lastEventEndFrame) * this.hopSec > o.autoGuardSec;
        this.noise.add(index * this.hopSec + this.timeOffset, f.db, quiet, this.analyzer.re, this.analyzer.im);
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
      ev.lowBand += Math.pow(10, f.lowDb / 10);
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
        lowRise: ev.loudFrames ? 10 * Math.log10(ev.lowBand / ev.loudFrames + 1e-24) - ev.bgLow : null,
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
      if ((result.isSnore || result.rhythmCandidate) && o.keepClips) result.clip = clipFromAudio(audio);
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

  /** The breath-noise rule in force (dB, or null when not checked): the options' own, else the sensitivity's. */
  function breathRuleDb(o) {
    if (o.minBreathRiseDb !== undefined) return o.minBreathRiseDb;
    const s = SENSITIVITY[o.sensitivity || DEFAULTS.sensitivity];
    return s && s.minBreathRiseDb != null ? s.minBreathRiseDb : null;
  }

  function classify(f, o) {
    const opts = Object.assign({}, DEFAULTS, o);
    const minBreathRiseDb = breathRuleDb(opts);
    let reason = null;
    if (f.tooLong || f.duration > opts.maxDuration) reason = 'too-long';
    else if (f.duration < opts.minDuration) reason = 'too-short';
    else if (f.subBass != null && f.subBass > opts.maxSubBass) reason = 'rumble';
    else if (f.highRatio > opts.maxHighRatio || f.centroid > opts.maxCentroid) reason = 'too-bright';
    else if (f.lowRatio < opts.minLowRatio) reason = 'not-low';
    else if (minBreathRiseDb != null && f.breathRise != null && f.breathRise < minBreathRiseDb) reason = 'no-breath';
    else if (opts.minLowRiseDb != null && f.lowRise != null && f.lowRise < opts.minLowRiseDb) reason = 'no-low-rise';
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

  return {
    FFT,
    FrameAnalyzer,
    SnoreDetector,
    RhythmGate,
    SessionStats,
    classify,
    breathRuleDb,
    isRhythmCandidate,
    subBassShare,
    countPeaks,
    encodeWav,
    clipFromAudio,
    nextPow2,
    DEFAULTS,
    SENSITIVITY,
    REASONS,
  };
});
