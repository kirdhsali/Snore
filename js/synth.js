/*
 * Synthetic night sounds for testing without sleeping next to the laptop.
 *
 * Generates snores plus the sounds a snore detector must ignore (speech,
 * knocking, a cough, a passing car) on top of quiet room noise. Used by the
 * app's demo mode, by the unit tests, and to write samples/snore-demo.wav.
 * Every scenario comes with ground truth so tests can score the detector.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreSynth = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Small seeded PRNG (mulberry32) so scenarios are reproducible. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TAU = Math.PI * 2;

  /** One-pole low-pass coefficient for a cutoff in Hz. */
  function lpCoef(hz, sr) {
    return 1 - Math.exp((-TAU * hz) / sr);
  }

  function addInto(out, src, at) {
    for (let i = 0; i < src.length && at + i < out.length; i++) if (at + i >= 0) out[at + i] += src[i];
  }

  /** Quiet, slightly low-heavy room noise. */
  function roomNoise(sr, n, level, rand) {
    const out = new Float32Array(n);
    const c = lpCoef(1200, sr);
    let y = 0;
    for (let i = 0; i < n; i++) {
      y += c * (rand() * 2 - 1 - y);
      out[i] = y * level * 3;
    }
    return out;
  }

  /**
   * A snore: soft-palate flutter at 40-80 Hz (a buzzy harmonic series with a
   * resonance near 250 Hz) plus low turbulence, shaped by a smooth breath envelope.
   */
  function snore(sr, rand, opts = {}) {
    const dur = opts.duration || 0.8 + rand() * 0.9;
    const f0 = opts.f0 || 40 + rand() * 40;
    const amp = opts.amp || 0.1 + rand() * 0.12;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    const res = 180 + rand() * 180;
    const weights = [];
    for (let k = 1; k <= 16; k++) {
      const f = k * f0;
      weights.push((1 / Math.pow(k, 0.7)) * (0.3 + Math.exp(-Math.pow((f - res) / 150, 2))));
    }
    const nc = lpCoef(350, sr);
    let noise = 0;
    let phase = 0;
    const wob = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.pow(Math.sin((Math.PI * t) / dur), 1.4);
      const f = f0 * (1 + 0.06 * Math.sin(TAU * 1.3 * t + wob)) * (1 + 0.02 * (rand() - 0.5));
      phase += (TAU * f) / sr;
      let h = 0;
      for (let k = 0; k < weights.length; k++) {
        if ((k + 1) * f >= sr / 2) break;
        h += weights[k] * Math.sin((k + 1) * phase);
      }
      noise += nc * (rand() * 2 - 1 - noise);
      out[i] = amp * env * (0.35 * h + 1.6 * noise);
    }
    return out;
  }

  /** Speech-like babble: voiced syllables with formants plus the odd fricative. */
  function speech(sr, rand, opts = {}) {
    const syllables = opts.syllables || 5 + Math.floor(rand() * 4);
    const pitch = opts.pitch || 100 + rand() * 120;
    const amp = opts.amp || 0.12;
    const vowels = [
      [730, 1090, 2440],
      [270, 2290, 3010],
      [530, 1840, 2480],
      [570, 840, 2410],
      [300, 870, 2240],
      [640, 1190, 2390],
    ];
    const parts = [];
    let total = 0;
    for (let s = 0; s < syllables; s++) {
      const dur = 0.16 + rand() * 0.14;
      const gap = 0.06 + rand() * 0.08;
      const n = Math.round(dur * sr);
      const buf = new Float32Array(n);
      const [F1, F2, F3] = vowels[Math.floor(rand() * vowels.length)];
      const p0 = pitch * (0.9 + rand() * 0.25);
      let phase = 0;
      const maxK = Math.floor(4500 / p0);
      const w = [];
      for (let k = 1; k <= maxK; k++) {
        const f = k * p0;
        const g = (c, bw) => Math.exp(-Math.pow((f - c) / bw, 2));
        w.push((g(F1, 120) + 0.8 * g(F2, 180) + 0.5 * g(F3, 250) + 0.02) / Math.sqrt(k));
      }
      const fric = rand() < 0.4;
      const hp = lpCoef(2500, sr);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * t) / dur);
        phase += (TAU * p0 * (1 - 0.1 * (t / dur))) / sr;
        let v = 0;
        for (let k = 0; k < w.length; k++) v += w[k] * Math.sin((k + 1) * phase);
        let x = amp * env * v;
        if (fric && t < 0.07) {
          const r = rand() * 2 - 1;
          lp += hp * (r - lp);
          x += amp * 0.8 * (r - lp) * (1 - t / 0.07);
        }
        buf[i] = x;
      }
      parts.push({ at: total, buf });
      total += n + Math.round(gap * sr);
    }
    const out = new Float32Array(total);
    for (const p of parts) addInto(out, p.buf, p.at);
    return out;
  }

  /** Knocking: a few short, low thuds. */
  function knock(sr, rand, opts = {}) {
    const count = opts.count || 3;
    const spacing = opts.spacing || 0.22;
    const amp = opts.amp || 0.4;
    const out = new Float32Array(Math.round((count * spacing + 0.1) * sr));
    for (let c = 0; c < count; c++) {
      const at = Math.round(c * spacing * sr);
      const f = 120 + rand() * 80;
      for (let i = 0; i < 0.08 * sr; i++) {
        const t = i / sr;
        const x = amp * Math.exp(-t / 0.018) * (Math.sin(TAU * f * t) + 0.3 * (rand() * 2 - 1));
        if (at + i < out.length) out[at + i] += x;
      }
    }
    return out;
  }

  /** Cough: a sharp broadband burst. */
  function cough(sr, rand, opts = {}) {
    const dur = opts.duration || 0.35;
    const amp = opts.amp || 0.3;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t / 0.12) * Math.min(1, t / 0.01);
      const r = rand() * 2 - 1;
      out[i] = amp * env * (r - 0.6 * prev);
      prev = r;
    }
    return out;
  }

  /** Passing car: low rumble that swells and fades over several seconds. */
  function car(sr, rand, opts = {}) {
    const dur = opts.duration || 7;
    const amp = opts.amp || 0.25;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    const c = lpCoef(300, sr);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      y += c * (rand() * 2 - 1 - y);
      out[i] = amp * Math.pow(Math.sin((Math.PI * t) / dur), 2) * y * 4;
    }
    return out;
  }

  const MAKERS = { snore, speech, knock, cough, car };

  /**
   * Places sounds on a timeline over room noise.
   * `plan` is a list of { type, at (seconds), ...opts }.
   * Returns { samples, sampleRate, truth: [{ type, start, end }] }.
   */
  function compose(sr, seconds, plan, seed = 1, noiseLevel = 0.002) {
    const rand = rng(seed);
    const n = Math.round(seconds * sr);
    const samples = roomNoise(sr, n, noiseLevel, rand);
    const truth = [];
    for (const item of plan) {
      const buf = MAKERS[item.type](sr, rand, item);
      const at = Math.round(item.at * sr);
      addInto(samples, buf, at);
      truth.push({ type: item.type, start: item.at, end: item.at + buf.length / sr });
    }
    return { samples, sampleRate: sr, truth };
  }

  /** Snores every few seconds, like breathing, starting at `from`. */
  function snoreRun(from, count, rand, interval = 3.8) {
    const out = [];
    let t = from;
    for (let i = 0; i < count; i++) {
      out.push({ type: 'snore', at: t });
      t += interval + (rand() - 0.5) * 1.0;
    }
    return out;
  }

  /**
   * The demo night, compressed into 90 seconds: snoring, someone talking,
   * knocking, a car outside, a cough, then snoring again.
   */
  function demoScenario(sr, seed = 7) {
    const rand = rng(seed * 31 + 1);
    const plan = [
      ...snoreRun(3, 6, rand),
      { type: 'speech', at: 27.5 },
      ...snoreRun(32, 5, rand, 3.4),
      { type: 'knock', at: 50.5 },
      { type: 'car', at: 53 },
      { type: 'cough', at: 62 },
      ...snoreRun(65, 5, rand, 4.2),
      { type: 'speech', at: 86, syllables: 6, pitch: 190 },
    ];
    return compose(sr, 90, plan, seed);
  }

  return { rng, compose, demoScenario, snoreRun, snore, speech, knock, cough, car, roomNoise };
});
