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

  // ----- findings: the night's noise in a few plain statements -----

  const SHOWN_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000]; // the 8 kHz octave is mostly microphone noise
  const median = (xs) => percentile(xs, 0.5);

  /** Minutes in one shape, from a night record (`t`, `backgroundDb`…) or a data file (`offsetSec`, `backgroundDbfs`…). */
  function normalise(noise) {
    return (noise.minutes || []).map((m) => ({
      t: m.t ?? m.offsetSec,
      bg: m.backgroundDb ?? m.backgroundDbfs ?? null,
      p90: m.p90Db ?? m.p90Dbfs ?? null,
      bands: m.bandsDb ?? m.bandsDbfs ?? null,
      hum: m.humHz ?? null,
    }));
  }

  /** Runs of consecutive minutes where `test(i)` holds, allowing `gap` missing minutes inside a run. */
  function runs(n, test, minLen, gap = 1) {
    const out = [];
    let start = -1;
    let last = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && test(i)) {
        if (start < 0) start = i;
        last = i;
      } else if (start >= 0 && (i === n || i - last > gap)) {
        if (last - start + 1 >= minLen) out.push([start, last]);
        start = -1;
      }
    }
    return out;
  }

  /**
   * The night's noise as findings, from the per-minute profile (`noise` of a night
   * record or data file). `snoreTimes` (seconds, the night's clock): minutes with
   * snoring, and the minute either side, are left out of the mid/high-pitch
   * stretches, so the sleeper's own breathing is not blamed on the room. Times
   * are seconds on the night's clock. Returns { background, tone, cycles,
   * stretches, masked } (null or [] when not found).
   */
  function summarize(noise, snoreTimes = []) {
    const minuteSec = (noise && noise.minuteSec) || 60;
    const M = normalise(noise || {}).filter((m) => m.bg != null);
    if (M.length < 10) return null;
    const snoring = new Set();
    for (const t of snoreTimes) for (const d of [-1, 0, 1]) snoring.add(Math.floor(t / minuteSec) + d);
    const ownSounds = (i) => snoring.has(Math.floor(M[i].t / minuteSec));
    const bgs = M.map((m) => m.bg);
    const background = { median: median(bgs), quietest: percentile(bgs, 0.1), loudest: percentile(bgs, 0.9) };

    // A steady tone: in a 10-minute window, 7 or more minutes within 6 Hz of the window's median pitch.
    const marked = new Array(M.length).fill(false);
    const pitches = [];
    for (let i = 0; i + 10 <= M.length; i++) {
      const hs = M.slice(i, i + 10)
        .map((m) => m.hum)
        .filter((h) => h != null);
      if (hs.length < 7) continue;
      const mid = median(hs);
      if (hs.filter((h) => Math.abs(h - mid) <= 6).length < 7) continue;
      pitches.push(mid);
      for (let k = i; k < i + 10; k++) if (M[k].hum != null && Math.abs(M[k].hum - mid) <= 6) marked[k] = true;
    }
    const toneMinutes = marked.filter(Boolean).length;
    let tone = null;
    if (toneMinutes >= 10) {
      // Mains hum sits at exactly 50 or 60 Hz, but the readings scatter by a few Hz (FFT bins of
      // about 23 Hz; night 6: 46-55 Hz around 50.0). A motor's tone drifts away from it.
      const mid = median(pitches);
      const net = [50, 60].find((f) => Math.abs(mid - f) <= 1.5);
      const mains = net != null && pitches.filter((h) => Math.abs(h - net) <= 4).length >= 0.8 * pitches.length;
      tone = { lowHz: percentile(pitches, 0.1), highHz: percentile(pitches, 0.9), share: toneMinutes / M.length, mains };
    }

    // A device switching on and off: the background steps up by 4 dB or more for 5+ minutes.
    const smooth = M.map((_, i) => median(bgs.slice(Math.max(0, i - 1), i + 2)));
    const base = percentile(smooth, 0.2);
    const onRuns = runs(M.length, (i) => smooth[i] >= base + 4, 5, 1);
    const minutesOf = ([a, b]) => (M[b].t - M[a].t) / minuteSec + 1;
    // The longest chain of 3+ switch-ons at a steady rhythm (gaps within 25% of their median).
    let chain = null;
    for (let a = 0; a < onRuns.length; a++) {
      for (let b = a + 2; b < onRuns.length; b++) {
        const part = onRuns.slice(a, b + 1);
        const gaps = part.slice(1).map((r, k) => (M[r[0]].t - M[part[k][0]].t) / minuteSec);
        const g = median(gaps);
        const lens = part.map(minutesOf);
        const l = median(lens);
        const steady = gaps.every((x) => Math.abs(x - g) <= 0.25 * g) && lens.every((x) => Math.abs(x - l) <= 0.5 * l);
        if (steady && (!chain || part.length > chain.length)) chain = part;
      }
    }
    let cycles = null;
    const cycleRuns = chain || (onRuns.length >= 2 ? onRuns : []);
    if (cycleRuns.length) {
      const starts = cycleRuns.map(([a]) => M[a].t);
      cycles = {
        count: cycleRuns.length,
        minutes: median(cycleRuns.map(minutesOf)),
        period: chain ? median(starts.slice(1).map((x, k) => (x - starts[k]) / minuteSec)) : null,
        regular: !!chain,
        stepDb: median(cycleRuns.flatMap(([a, b]) => smooth.slice(a, b + 1))) - base,
        from: starts[0],
        to: M[cycleRuns[cycleRuns.length - 1][1]].t + minuteSec,
        on: cycleRuns.map(([a, b]) => [M[a].t, M[b].t + minuteSec]),
      };
    }
    const inCycle = (i) => !!cycles && cycles.on.some(([a, b]) => M[i].t >= a && M[i].t < b);

    // Mid and high pitches (500 Hz-4 kHz) against their own quiet level: steady (ventilation) or restless
    // (doors, water, voices). The 8 kHz octave is left out: in a quiet room it is mostly the microphone's own noise.
    const bandsHz = (noise && noise.bandsHz) || OCTAVES;
    const hiIdx = bandsHz.map((hz, i) => (hz >= 500 && hz <= 4000 ? i : -1)).filter((i) => i >= 0);
    const hiDb = M.map((m) => (m.bands ? 10 * Math.log10(hiIdx.reduce((sum, i) => sum + Math.pow(10, m.bands[i] / 10), 0) + 1e-24) : null));
    const hiBase = percentile(
      hiDb.filter((v) => v != null),
      0.2,
    );
    const stretches = [];
    if (hiBase != null) {
      const raised = (i) => hiDb[i] != null && hiDb[i] >= hiBase + 5 && !ownSounds(i);
      for (const [a, b] of runs(M.length, raised, 10, 3)) {
        const seg = M.slice(a, b + 1);
        const jumpy = median(seg.map((m) => (m.p90 != null ? m.p90 - m.bg : 0)));
        stretches.push({
          start: M[a].t,
          end: M[b].t + minuteSec,
          riseDb: median(hiDb.slice(a, b + 1)) - hiBase,
          kind: jumpy >= 4 ? 'restless' : 'steady',
        });
      }
    }

    // Other stretches where the background stood 6 dB or more above the night's quiet level (a
    // cycling device is described above): quiet snores could be missed then. Close ones are merged.
    const masked = runs(M.length, (i) => smooth[i] >= background.quietest + 6 && !inCycle(i), 10, 10).map(([a, b]) => ({
      start: M[a].t,
      end: M[b].t + minuteSec,
      riseDb: median(smooth.slice(a, b + 1)) - background.quietest,
    }));

    return { minutes: M.length, background, tone, cycles, stretches, masked };
  }

  /** The findings as short sentences; `at(sec)` formats a time on the night's clock. */
  function describe(summary, at) {
    if (!summary) return [];
    const out = [];
    const min = (x) => `${Math.round(x)} min`;
    const { tone, cycles, stretches, masked } = summary;
    if (tone) {
      const pitch =
        tone.lowHz === tone.highHz || tone.highHz - tone.lowHz < 6
          ? `about ${Math.round(tone.lowHz)} Hz`
          : `${Math.round(tone.lowHz)}–${Math.round(tone.highHz)} Hz`;
      const what = tone.mains
        ? 'mains hum from an electrical device (a charger, fridge or lamp)'
        : 'a motor or fan (ventilation, a fridge, a pump)';
      out.push(`A steady low tone at ${pitch} for ${Math.round(tone.share * 100)}% of the night: typical of ${what}.`);
    }
    if (cycles) {
      const often = cycles.regular ? ` between ${at(cycles.from)} and ${at(cycles.to)}, about every ${min(cycles.period)}` : '';
      out.push(
        `Something switched on ${cycles.count} times${often}, for about ${min(cycles.minutes)} each time, and made the room ${Math.round(cycles.stepDb)} dB louder (a fridge, heating or a pump?). While it ran, quiet snores could be missed.`,
      );
    }
    const list = (items) => {
      const spans = items.map((x) => `${at(x.start)}–${at(x.end)}`);
      return spans.length > 1 ? `${spans.slice(0, -1).join(', ')} and ${spans[spans.length - 1]}` : spans[0];
    };
    const steady = stretches.filter((x) => x.kind === 'steady');
    const restless = stretches.filter((x) => x.kind !== 'steady');
    if (steady.length) {
      const rise = Math.round(median(steady.map((x) => x.riseDb)));
      out.push(
        `${list(steady)}: a steady sound in the middle and high pitches (${rise} dB above their quiet level), such as breathing, ventilation or air conditioning.`,
      );
    }
    if (restless.length) out.push(`${list(restless)}: restless, with many short sounds (doors, water, voices or traffic).`);
    for (const m of masked)
      out.push(
        `${at(m.start)}–${at(m.end)}: the room was ${Math.round(m.riseDb)} dB louder than at its quietest; quiet snores could be missed then.`,
      );
    if (!out.length) out.push('The room stayed quiet and steady all night.');
    return out;
  }

  return { NoiseProfile, OCTAVES, SHOWN_BANDS, summarize, describe };
});
