/*
 * Snorewatch recording controller: owns the microphone (or the demo night),
 * the audio graph, interruption handling and the screen wake lock, and feeds
 * the audio to the night's analysis (js/analysis.js: the detectors and their
 * statistics). The page subscribes through callbacks and only reads
 * `recorder.session`; it never touches the audio objects.
 *
 * States:  idle → requesting → recording ⇄ interrupted → stopping → completed
 *          (a failed start goes back to the previous state; Start again from
 *          completed begins a new night)
 *
 * Browser APIs come in through `env` (defaults: the page's globals), so the
 * state machine also runs in Node with fakes (tests/recorder.test.js).
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./analysis.js') : root.SnoreAnalysis, node ? require('./synth.js') : root.SnoreSynth);
  if (node) module.exports = api;
  else root.SnoreRecorder = api;
})(typeof self !== 'undefined' ? self : this, function (Analysis, Synth) {
  'use strict';

  const STALL_MS = 2000; // no audio for this long while recording counts as an interruption

  const TAP_CODE = `class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
    process(inputs) {
      const inp = inputs[0];
      if (inp && inp.length) {
        const a = inp[0], c = inp.length;
        for (let i = 0; i < a.length; i++) {
          let s = a[i];
          for (let k = 1; k < c; k++) s += inp[k][i];
          this.buf[this.n++] = s / c;
          if (this.n === this.buf.length) {
            this.port.postMessage(this.buf, [this.buf.buffer]);
            this.buf = new Float32Array(2048);
            this.n = 0;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('snore-tap', Tap);`;

  /** Streams raw mono samples from `input` to `onSamples`. */
  async function createTap(env, ctx, input, onSamples) {
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    if (ctx.audioWorklet && env.AudioWorkletNode) {
      try {
        const url = env.URL.createObjectURL(new env.Blob([TAP_CODE], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        env.URL.revokeObjectURL(url);
        const node = new env.AudioWorkletNode(ctx, 'snore-tap', { numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (e) => onSamples(e.data);
        input.connect(node);
        node.connect(sink);
        return node;
      } catch (err) {
        console.warn('AudioWorklet unavailable, using ScriptProcessor', err);
      }
    }
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
    input.connect(sp);
    sp.connect(sink);
    return sp;
  }

  /** A fresh simulated night (a different one each time) as an audio buffer. */
  function demoBuffer(ctx) {
    const rate = 22050;
    const sc = Synth.demoScenario(rate, 1 + Math.floor(Math.random() * 1000));
    const buf = ctx.createBuffer(1, sc.samples.length, rate);
    buf.copyToChannel(sc.samples, 0);
    return buf;
  }

  function browserEnv() {
    const g = globalThis;
    return {
      AudioContext: g.AudioContext || g.webkitAudioContext,
      AudioWorkletNode: g.AudioWorkletNode,
      URL: g.URL,
      Blob: g.Blob,
      navigator: g.navigator,
      document: g.document,
      now: () => Date.now(),
      setInterval: (f, ms) => g.setInterval(f, ms),
      clearInterval: (id) => g.clearInterval(id),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      random: () => Math.random(),
    };
  }

  /**
   * opts: {
   *   version,                       stamped into each finished night
   *   onState(state, recorder),      every state change
   *   onFrame(frame), onEvent(ev),   the main detector's frames and decided events (already counted)
   *   onWakeLock(state),             'on' | 'failed' | 'unsupported'
   *   env                            browser APIs (tests pass fakes)
   * }
   */
  function createRecorder(opts = {}) {
    const env = Object.assign(browserEnv(), opts.env);
    const notify = (fn, ...args) => fn && fn(...args);
    let state = 'idle';
    let session = null;
    let night = null;
    let wakeLock = null;
    let wakeLockState = 'off';

    const live = () => state === 'recording' || state === 'interrupted';
    function setState(next) {
      if (state === next) return;
      state = next;
      notify(opts.onState, state, api);
    }

    // ----- screen wake lock -----
    // A request belongs to the night that asked for it: a lock that arrives after Stop,
    // or for an earlier night, is let go at once, and only the current lock's release counts.
    async function requestWakeLock() {
      const owner = session;
      const current = () => live() && session === owner;
      const nav = env.navigator;
      if (!nav || !('wakeLock' in nav)) {
        wakeLockState = 'unsupported';
      } else {
        let lock;
        try {
          lock = await nav.wakeLock.request('screen');
        } catch {
          if (!current()) return;
          if (!wakeLock) wakeLockState = 'failed';
        }
        if (lock) {
          if (!current()) {
            Promise.resolve(lock.release()).catch(() => {});
            return;
          }
          if (wakeLock && wakeLock !== lock) Promise.resolve(wakeLock.release()).catch(() => {});
          wakeLock = lock;
          wakeLockState = 'on';
          lock.addEventListener('release', () => {
            if (wakeLock !== lock) return;
            wakeLock = null;
            // The system can drop the lock (e.g. low battery); ask again while the page is visible.
            if (current() && env.document && env.document.visibilityState === 'visible') requestWakeLock();
          });
        }
      }
      if (owner) owner.wakeLock = wakeLockState;
      notify(opts.onWakeLock, wakeLockState);
    }
    if (env.document) {
      env.document.addEventListener('visibilitychange', () => {
        if (!live() || env.document.visibilityState !== 'visible') return;
        if (!wakeLock) requestWakeLock();
        if (session.gap) tryResume(session);
      });
    }

    // ----- interruptions -----
    // The system can pause the microphone (a call, Siri, another app taking the
    // audio) or stop it. Such gaps are recorded and never counted as silence;
    // the recorder keeps trying to resume.
    function audioLive(s) {
      return s.ctx.state === 'running' && (!s.stream || s.stream.getAudioTracks().every((t) => t.readyState === 'live' && !t.muted));
    }

    // 'suspended' and iOS Safari's 'interrupted' both need an explicit resume();
    // 'closed' and a switched-off microphone track cannot come back.
    function tryResume(s) {
      const st = s.ctx.state;
      if (st === 'running' || st === 'closed' || (s.gap && s.gap.reason === 'ended')) return;
      try {
        Promise.resolve(s.ctx.resume()).catch(() => {});
      } catch {}
    }

    function watchAudio(s) {
      s.ctx.onstatechange = () => {
        if (s.ctx.state !== 'running') beginGap(s, 'suspended');
      };
      if (s.stream) {
        for (const t of s.stream.getAudioTracks()) {
          t.addEventListener('ended', () => beginGap(s, 'ended'));
          t.addEventListener('mute', () => beginGap(s, 'muted'));
        }
      }
      s.watch = env.setInterval(() => {
        if (!live() || session !== s) return;
        if (!s.gap && env.now() - s.lastSampleWall > STALL_MS) beginGap(s, 'stalled', s.lastSampleWall);
        if (s.gap) tryResume(s);
      }, 1000);
    }

    function beginGap(s, reason, at = env.now()) {
      if (!live() || session !== s) return;
      if (s.gap) {
        if (reason === 'ended') s.gap.reason = 'ended'; // the worst case decides what the page says
      } else {
        s.gap = { start: Math.min(at, env.now()), reason, clock: s.detector.clock };
      }
      tryResume(s);
      if (state === 'interrupted')
        notify(opts.onState, state, api); // the reason may have changed
      else setState('interrupted');
    }

    function endGap(s, at = env.now()) {
      const g = s.gap;
      const sec = Math.max(0, (at - g.start) / 1000);
      s.gaps.push({ start: g.start, end: at, reason: g.reason, clock: g.clock });
      s.gap = null;
      // Events are timed on the night's clock: after the gap they continue `sec` later,
      // and nothing is decided or confirmed across it.
      s.analysis.addGap(g.clock, sec, state !== 'stopping');
      if (state === 'interrupted') setState('recording');
    }

    // ----- start and stop -----
    /** Starts a night. Rejects (and leaves the previous state and night untouched) if audio cannot start. */
    async function start({ source = 'mic', sensitivity = 'normal' } = {}) {
      if (state === 'requesting' || live() || state === 'stopping') return;
      const before = state;
      setState('requesting');
      try {
        if (env.navigator && env.navigator.audioSession) env.navigator.audioSession.type = 'auto';
      } catch {}
      const AC = env.AudioContext;
      let ctx = null;
      let stream = null;
      let s = null;
      try {
        if (!AC) throw new Error('This browser cannot process audio. Try a current Chrome, Firefox or Safari.');
        // Create the context inside the click so browsers let it start.
        ctx = new AC();
        let input;
        let player = null;
        if (source === 'mic') {
          const media = env.navigator && env.navigator.mediaDevices;
          if (!media || !media.getUserMedia) {
            throw new Error('Microphone access needs a secure page. Open the app over https, or on localhost via npm start.');
          }
          stream = await media.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
          });
          input = ctx.createMediaStreamSource(stream);
        } else {
          player = ctx.createBufferSource();
          player.buffer = demoBuffer(ctx);
          input = player;
          player.connect(ctx.destination); // the demo is meant to be heard
          player.onended = () => stop();
        }
        if (ctx.state === 'suspended') await ctx.resume();

        s = {
          source,
          startWall: env.now(),
          endWall: null,
          ctx,
          stream,
          player,
          tap: null,
          analysis: null,
          // The analysis's parts the page reads (js/app.js): live statistics and the detectors.
          stats: null,
          detector: null,
          shadows: null,
          gaps: [], // interruptions: {start, end} in ms since the epoch, the reason, and `clock` (events' time base)
          gap: null, // the interruption going on now
          lastSampleWall: env.now(),
          wakeLock: 'off',
          watch: null,
        };
        s.analysis = Analysis.createAnalysis(ctx.sampleRate, {
          sensitivity,
          onFrame: (f) => notify(opts.onFrame, f),
          onEvent: (ev) => notify(opts.onEvent, ev),
        });
        s.stats = s.analysis.stats;
        s.detector = s.analysis.detector;
        s.shadows = s.analysis.shadows;
        s.tap = await createTap(env, ctx, input, (samples) => {
          if (!live() || session !== s) return;
          s.lastSampleWall = env.now();
          if (s.gap) {
            // Audio that arrives while the microphone is muted or the audio is suspended is not the room.
            if (!audioLive(s)) return;
            endGap(s);
          }
          s.analysis.process(samples);
        });
        session = s;
        if (player) player.start();
      } catch (err) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (ctx) ctx.close().catch(() => {});
        if (session === s) session = null;
        setState(before);
        throw err;
      }
      watchAudio(s);
      setState('recording');
      requestWakeLock();
    }

    /** Ends the night and returns it as a finished record (see finishNight). */
    function stop() {
      if (!live()) return null;
      const s = session;
      setState('stopping');
      // Decides the open sounds (they arrive through onEvent) and wipes the audio the
      // detectors still hold: no audio other than the kept snore clips remains.
      s.elapsed = s.analysis.finish(); // seconds of audio actually analysed
      s.endWall = env.now();
      env.clearInterval(s.watch);
      s.ctx.onstatechange = null;
      if (s.gap) endGap(s, s.endWall);
      s.wallElapsed = s.elapsed + gapSeconds(s); // the night's clock: analysed audio plus interruptions
      night = finishNight(s);
      try {
        s.tap.disconnect();
        if (s.tap.port) s.tap.port.onmessage = null;
      } catch {}
      if (s.player) {
        s.player.onended = null;
        try {
          s.player.stop();
        } catch {}
      }
      if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
      s.ctx.close().catch(() => {});
      if (wakeLock) Promise.resolve(wakeLock.release()).catch(() => {});
      wakeLock = null;
      wakeLockState = 'off';
      session = null;
      setState('completed');
      return night;
    }

    function gapSeconds(s) {
      return s.gaps.reduce((sum, g) => sum + (g.end - g.start) / 1000, 0);
    }

    /**
     * The finished night as one frozen record, separate from the recorder: the
     * report, sharing and downloads read only this, so a new recording (or a
     * failed start) cannot change it. Field names follow js/report-format.js.
     */
    function finishNight(s) {
      return Object.freeze({
        id: `night-${new Date(s.startWall).toISOString()}`,
        version: opts.version,
        source: s.source,
        startWall: s.startWall,
        endWall: s.endWall,
        timeZone: env.timeZone(),
        capturedSeconds: s.elapsed, // audio actually analysed
        clockSeconds: s.wallElapsed, // the events' clock: analysed audio plus interruptions
        gaps: s.gaps.slice(),
        screenWakeLock: s.wakeLock,
        ...s.analysis.result(s.elapsed),
      });
    }

    const api = {
      start,
      stop,
      /** 'idle' | 'requesting' | 'recording' | 'interrupted' | 'stopping' | 'completed' */
      get state() {
        return state;
      },
      /** True while a night is being recorded, interrupted or not. */
      get recording() {
        return live();
      },
      /** The night in progress (read only for the page), or null. */
      get session() {
        return session;
      },
      /** The last finished night, or null. */
      get night() {
        return night;
      },
      /** Why the current interruption happened ('suspended', 'muted', 'stalled', 'ended'), or null. */
      get gapReason() {
        return session && session.gap ? session.gap.reason : null;
      },
      get wakeLockState() {
        return wakeLockState;
      },
    };
    return api;
  }

  return { createRecorder, STALL_MS };
});
