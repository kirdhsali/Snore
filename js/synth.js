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
   * resonance near 200 Hz) plus low turbulence, shaped by a smooth breath
   * envelope. Tuned to real bedside recordings: spectral centroid about 100-300 Hz.
   */
  function snore(sr, rand, opts = {}) {
    const dur = opts.duration || 0.8 + rand() * 0.9;
    const f0 = opts.f0 || 40 + rand() * 40;
    const amp = opts.amp || 0.1 + rand() * 0.12;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    const res = 130 + rand() * 140;
    const weights = [];
    for (let k = 1; k <= 16; k++) {
      const f = k * f0;
      weights.push((1 / Math.pow(k, 1.1)) * (0.2 + Math.exp(-Math.pow((f - res) / 120, 2))));
    }
    const nc = lpCoef(260, sr);
    let noise = 0;
    let noise2 = 0;
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
      noise2 += nc * (noise - noise2);
      out[i] = amp * env * (0.35 * h + 2.4 * noise2);
    }
    return out;
  }

  /**
   * A rattling snore: one long, dull snore broken into several bursts by the
   * fluttering airway, with dips of about 12 dB between them. Darker than
   * snore() to match real recordings (spectral centroid around 100-250 Hz).
   */
  function rattle(sr, rand, opts = {}) {
    const duration = opts.duration || 1.4 + rand() * 0.6;
    const bursts = opts.bursts || 4 + Math.floor(rand() * 2);
    const out = snore(sr, rand, { duration, f0: opts.f0, amp: opts.amp || 0.25 + rand() * 0.1 });
    const c = lpCoef(160, sr);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      a += c * (out[i] - a);
      b += c * (a - b);
      const m = Math.abs(Math.sin((Math.PI * bursts * i) / out.length));
      out[i] = b * (0.25 + 0.75 * Math.pow(m, 1.5));
    }
    return out;
  }

  /** Deep rumble (a truck outside, the building, heating): almost all energy below 60 Hz. */
  function rumble(sr, rand, opts = {}) {
    const dur = opts.duration || 0.6 + rand() * 0.6;
    const amp = opts.amp || 2.5;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    const c = lpCoef(30, sr);
    const y = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      let v = rand() * 2 - 1;
      for (let k = 0; k < 4; k++) v = y[k] += c * (v - y[k]);
      out[i] = amp * Math.pow(Math.sin((Math.PI * i) / n), 2) * v;
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

  /**
   * A hum swell: a deep, smooth rise of low noise (60-150 Hz) without any breath
   * noise above it, like a lift, ventilation or the building at night.
   */
  function swell(sr, rand, opts = {}) {
    const dur = opts.duration || 0.7 + rand() * 0.8;
    const amp = opts.amp || 0.3;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    const c = lpCoef(100, sr);
    const y = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      let v = rand() * 2 - 1;
      for (let k = 0; k < 5; k++) v = y[k] += c * (v - y[k]);
      out[i] = amp * Math.pow(Math.sin((Math.PI * i) / n), 2) * v;
    }
    return out;
  }

  /**
   * A very quiet room whose noise is mostly deep rumble below 60 Hz (heating,
   * the building): measured frame by frame it flickers by several dB.
   */
  function deepRoomNoise(sr, n, level, rand) {
    const out = roomNoise(sr, n, level * 0.4, rand);
    const c = lpCoef(35, sr);
    const y = [0, 0];
    for (let i = 0; i < n; i++) {
      let v = rand() * 2 - 1;
      for (let k = 0; k < 2; k++) v = y[k] += c * (v - y[k]);
      out[i] += v * level * 40;
    }
    return out;
  }

  /**
   * Restless background (wind, a fan changing speed, rain on and off): room
   * noise whose level wanders by several dB over a few seconds.
   */
  function gustyNoise(sr, n, level, rand, depthDb = 12) {
    const out = roomNoise(sr, n, level, rand);
    let g = 0;
    let target = 0;
    for (let i = 0; i < n; i++) {
      if (i % Math.round(sr * 0.5) === 0) target = (rand() - 0.5) * depthDb;
      g += (target - g) / (sr * 0.8);
      out[i] *= Math.pow(10, g / 20);
    }
    return out;
  }

  /**
   * Soft breathing between snores: band noise around 200-1500 Hz, a few dB above
   * a very quiet room, rising and falling over 1-2 s.
   */
  function breath(sr, rand, opts = {}) {
    const dur = opts.duration || 1.2 + rand() * 0.8;
    const amp = opts.amp || 0.0001;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    const lo = lpCoef(1500, sr);
    const hi = lpCoef(200, sr);
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      a += lo * (rand() * 2 - 1 - a);
      b += hi * (a - b);
      out[i] = amp * 3 * (a - b) * Math.pow(Math.sin((Math.PI * i) / n), 1.5);
    }
    return out;
  }

  /**
   * A very quiet room with a mains hum (night 4): two close tones near 50 Hz beat,
   * so 40 ms frames flicker while half-second averages stay steady, and the usual
   * level sits a few dB above the quietest moments.
   */
  function humRoomNoise(sr, n, level, rand) {
    const out = roomNoise(sr, n, level * 0.25, rand);
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < n; i++) {
      p1 += (TAU * 50) / sr;
      p2 += (TAU * 51.5) / sr;
      out[i] += level * (Math.sin(p1) + 0.45 * Math.sin(p2));
    }
    return out;
  }

  const MAKERS = { snore, rattle, rumble, swell, speech, knock, cough, car, breath };

  /**
   * Places sounds on a timeline over room noise.
   * `plan` is a list of { type, at (seconds), ...opts }.
   * Returns { samples, sampleRate, truth: [{ type, start, end }] }.
   */
  function compose(sr, seconds, plan, seed = 1, noiseLevel = 0.002, background = 'still') {
    const rand = rng(seed);
    const n = Math.round(seconds * sr);
    const samples =
      background === 'gusty'
        ? gustyNoise(sr, n, noiseLevel, rand)
        : background === 'deep'
          ? deepRoomNoise(sr, n, noiseLevel, rand)
          : background === 'hum'
            ? humRoomNoise(sr, n, noiseLevel, rand)
            : roomNoise(sr, n, noiseLevel, rand);
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

  return {
    rng,
    compose,
    demoScenario,
    snoreRun,
    snore,
    rattle,
    rumble,
    speech,
    knock,
    cough,
    car,
    roomNoise,
    gustyNoise,
    deepRoomNoise,
    swell,
  };
});
