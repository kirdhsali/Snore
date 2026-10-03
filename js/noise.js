/*
 * Snorewatch room noise: a per-minute profile of the background, for telling
 * users which noises their room has (a steady hum, a device switching on and
 * off, a restless morning) and for checking detection against them.
 *
 * Only numbers are kept, never sound: per minute the usual background level,
 * how quiet and how loud the minute got, the level in octave bands and the
 * strongest low tone (a mains hum or a fan). No browser dependencies
 * (window.SnoreNoise / require); js/detector.js feeds it its analysed frames.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreNoise = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000]; // band centre frequencies (Hz)
  const HUM_RANGE = [30, 400]; // where mains hum, fans and pumps put their tone (Hz)
  const HUM_MIN_DB = 10; // a tone counts when it stands this far above its neighbourhood

  function percentile(values, q) {
    if (!values.length) return null;
    const s = Float64Array.from(values).sort();
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  const dB = (p) => 10 * Math.log10(p + 1e-24);

  class NoiseProfile {
    /**
     * sampleRate and frameSize as in the detector's FrameAnalyzer; frames come
     * every hopSec seconds. Octave bands above the Nyquist limit are left out.
     */
    constructor(sampleRate, frameSize, minuteSec = 60) {
      this.minuteSec = minuteSec;
      this.hopSec = frameSize / sampleRate;
      const binHz = sampleRate / frameSize;
      const half = frameSize / 2;
      const bin = (hz) => Math.min(half, Math.max(1, Math.round(hz / binHz)));
      this.bandsHz = OCTAVES.filter((c) => c * Math.SQRT2 <= sampleRate / 2);
      this.bands = this.bandsHz.map((c) => {
        const lo = bin(c / Math.SQRT2);
        return [lo, Math.max(lo + 1, bin(c * Math.SQRT2))];
      });
      this.binHz = binHz;
      this.hum = [bin(HUM_RANGE[0]), bin(HUM_RANGE[1])];
      // One-sided FFT power of a Hann-windowed frame -> mean square of the signal.
      this.scale = 16 / (3 * frameSize * frameSize);
      this.minutes = [];
      this.cur = null;
    }

    /**
     * One analysed frame at `t` seconds on the night's clock. `quiet` frames
     * (no sound going on or just ended) count as background; `re`/`im` hold
     * the frame's spectrum.
     */
    add(t, db, quiet, re, im) {
      const m = Math.floor(t / this.minuteSec);
      if (!this.cur || this.cur.m !== m) {
        this._close();
        this.cur = {
          m,
          all: [],
          quiet: [],
          bands: new Float64Array(this.bands.length),
          low: new Float64Array(this.hum[1] - this.hum[0]),
        };
      }
      const c = this.cur;
      c.all.push(db);
      if (!quiet) return;
      c.quiet.push(db);
      for (let b = 0; b < this.bands.length; b++) {
        const [lo, hi] = this.bands[b];
        let p = 0;
        for (let k = lo; k < hi; k++) p += re[k] * re[k] + im[k] * im[k];
        c.bands[b] += p;
      }
      for (let k = this.hum[0]; k < this.hum[1]; k++) c.low[k - this.hum[0]] += re[k] * re[k] + im[k] * im[k];
    }

    _close() {
      const c = this.cur;
      this.cur = null;
      if (!c || !c.all.length) return;
      const nq = c.quiet.length;
      this.minutes.push({
        t: c.m * this.minuteSec,
        quietSec: nq * this.hopSec,
        backgroundDb: percentile(c.quiet, 0.5),
        p10Db: percentile(c.all, 0.1),
        p90Db: percentile(c.all, 0.9),
        bandsDb: nq ? Array.from(c.bands, (p) => dB((p / nq) * this.scale)) : null,
        ...(nq ? this._hum(c.low) : { humHz: null, humDb: null }),
      });
    }

    /** The strongest low tone of the minute's quiet spectrum, if it stands out. */
    _hum(low) {
      let k = 0;
      for (let i = 1; i < low.length; i++) if (low[i] > low[k]) k = i;
      const around = Float64Array.from(low).sort()[low.length >> 1];
      const prominence = dB(low[k]) - dB(around);
      if (prominence < HUM_MIN_DB || k === 0 || k === low.length - 1) return { humHz: null, humDb: null };
      // Parabolic interpolation on the log spectrum: the peak lies between bins.
      const [a, b, c] = [dB(low[k - 1]), dB(low[k]), dB(low[k + 1])];
      const shift = (0.5 * (a - c)) / (a - 2 * b + c || 1);
      return { humHz: (this.hum[0] + k + shift) * this.binHz, humDb: prominence };
    }

    /** The finished minutes so far, including the one in progress. */
    finish() {
      this._close();
      return this.minutes;
    }
  }

  return { NoiseProfile, OCTAVES };
});
