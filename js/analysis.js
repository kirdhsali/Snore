/*
 * Snorewatch analysis of one night: the counting detector with the room-noise profile, the
 * background tests on the same audio, their statistics and the night's result. No browser
 * dependencies (window.SnoreAnalysis / require): js/recorder.js feeds it the microphone or the
 * demo night, scripts/analyze.js a WAV file. With js/detector.js, js/stats.js and js/noise.js
 * this is the part a native app ports (docs/DETECTOR.md).
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./detector.js') : root.SnoreCore);
  if (node) module.exports = api;
  else root.SnoreAnalysis = api;
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const { SnoreDetector, SessionStats } = Core;

  // Knock test: night 5's report counted knocks as snores. A knock reaches its full level at
  // once (night 5: 21-42 dB within 20 ms), a snore swells (nights 4 and 5: 99 % under 17 dB).
  const KNOCK_RULE_DB = 20;

  // Background tests of candidate rules: extra detectors on the same audio that keep no audio.
  // They change nothing on screen; their counts go into the data file. The High trial (1.22.0)
  // ended in 1.23.0, when High took the 6 dB rule; the automatic-sensitivity test (1.8.0-1.23.0)
  // was removed in 1.24.0 (docs/archive/auto-sensitivity.md).
  const BACKGROUND_TESTS = {
    knock: (sensitivity) => ({ sensitivity, maxOnsetJumpDb: KNOCK_RULE_DB }),
  };

  // Background tests also hand over the sounds their own rules set aside and their choppy
  // sounds no snore rescued (features only), so other limits can be tried on a night
  // afterwards with the rhythm rescue redone (choppy ones since 1.22.1).
  const SET_ASIDE_REASONS = new Set(['sudden', 'choppy']);

  /** The detector's options as a plain record (no callbacks), for the night and its data file. */
  const config = (det) => Object.fromEntries(Object.entries(det.opts).filter(([, v]) => typeof v !== 'function'));

  /**
   * One night's analysis at `sampleRate`.
   * options: { sensitivity, onFrame(frame), onEvent(event) } (the counting detector's frames
   * and decided events; the event is already counted when onEvent sees it).
   */
  function createAnalysis(sampleRate, options = {}) {
    const sensitivity = options.sensitivity || 'normal';
    const stats = new SessionStats();
    const detector = new SnoreDetector(sampleRate, {
      sensitivity,
      noiseProfile: true,
      onFrame: options.onFrame || null,
      onEvent: (ev) => {
        stats.add(ev);
        if (options.onEvent) options.onEvent(ev);
      },
    });
    const shadows = {};
    for (const [name, rules] of Object.entries(BACKGROUND_TESTS)) {
      const testOptions = rules(sensitivity);
      const testStats = new SessionStats();
      shadows[name] = {
        options: testOptions,
        stats: testStats,
        detector: new SnoreDetector(sampleRate, { ...testOptions, keepClips: false, onEvent: (e) => testStats.add(e) }),
      };
    }
    const all = () => [{ detector, stats }, ...Object.values(shadows)];

    return {
      sampleRate,
      detector,
      stats,
      shadows,
      /** Feeds mono samples (-1..1) to every detector. */
      process(samples) {
        for (const a of all()) a.detector.process(samples);
      },
      /**
       * An interruption of `sec` seconds that began at `clock` (the night's clock): events after
       * it are timed `sec` later, and nothing is decided or confirmed across it. `resume: false`
       * when the night ends during the interruption.
       */
      addGap(clock, sec, resume = true) {
        for (const a of all()) {
          a.stats.addGap(clock, clock + sec);
          if (resume) a.detector.resumeAfterGap(sec);
        }
      },
      /**
       * Ends the night: decides the open sounds and wipes the audio the detectors still hold
       * (kept snore clips stay). Returns the seconds of audio analysed.
       */
      finish() {
        for (const a of all()) a.detector.flush();
        for (const a of all()) a.detector.release();
        return detector.elapsed;
      },
      /**
       * The analysis part of a finished night record (field names as in js/report-format.js):
       * the counting detector's events, summary and room noise, and each background test.
       * `elapsed`: seconds of audio analysed.
       */
      result(elapsed) {
        return {
          sampleRate,
          // Room noise per minute (levels only), on the events' clock.
          noise: detector.noise && {
            minuteSec: detector.noise.minuteSec,
            bandsHz: detector.noise.bandsHz,
            minutes: detector.noise.finish(),
          },
          sensitivity: detector.sensitivity,
          config: config(detector),
          summary: stats.summary(elapsed),
          stats, // derived views of the events: confirmed snores, timeline buckets
          snores: stats.snores,
          ignored: stats.ignored,
          shadows: Object.fromEntries(
            Object.entries(shadows).map(([name, sh]) => [
              name,
              Object.freeze({
                options: { ...sh.options },
                config: config(sh.detector),
                summary: sh.stats.summary(elapsed),
                snores: sh.stats.snores,
                setAside: sh.stats.ignored.filter((e) => SET_ASIDE_REASONS.has(e.reason)),
              }),
            ]),
          ),
        };
      },
    };
  }

  return { createAnalysis, BACKGROUND_TESTS, KNOCK_RULE_DB, SET_ASIDE_REASONS };
});
