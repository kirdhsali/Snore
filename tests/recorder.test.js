'use strict';
// js/recorder.js: the recording controller's states and interruption handling,
// driven with fake browser audio objects (no browser needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const Synth = require('../js/synth.js');
const { createRecorder, browserProcessing, audioClockOff } = require('../js/recorder.js');
const { SessionStats } = require('../js/stats.js');
const { toReport } = require('../js/report-format.js');
const { recount } = require('../scripts/evaluate.js');
const { analyzeSamples } = require('../scripts/analyze.js');

/**
 * Minimal stand-ins for AudioContext, a microphone stream and the page. The context says
 * 16 kHz; `realRate` is the rate the fake microphone really delivers per second of the clock
 * (another value models a browser that reports the wrong rate). `env.mono` is the monotonic
 * clock, `env.now` the phone's clock, which `shiftWall` can set forward or back.
 */
function fakeBrowser({ denyMic = false, realRate = 16000 } = {}) {
  let now = Date.parse('2026-10-01T22:00:00Z');
  let wallShift = 0;
  let tick = null;
  let processor = null;
  const listeners = (obj) => {
    obj.handlers = {};
    obj.addEventListener = (type, fn) => (obj.handlers[type] = obj.handlers[type] || []).push(fn);
    obj.dispatch = (type) => (obj.handlers[type] || []).forEach((fn) => fn());
    return obj;
  };
  const track = listeners({ readyState: 'live', muted: false, stop() {} });
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const node = () => ({ connect() {}, disconnect() {} });
  class FakeContext {
    constructor() {
      this.sampleRate = 16000;
      this.state = 'running';
      this.destination = node();
      this.onstatechange = null;
    }
    createGain() {
      return { ...node(), gain: { value: 1 } };
    }
    createMediaStreamSource() {
      return node();
    }
    createScriptProcessor() {
      processor = { ...node(), onaudioprocess: null };
      return processor;
    }
    async resume() {}
    async close() {
      this.state = 'closed';
    }
  }
  const env = {
    AudioContext: FakeContext,
    AudioWorkletNode: undefined, // forces the ScriptProcessor path
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          if (denyMic) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
          return stream;
        },
      },
    },
    document: listeners({ visibilityState: 'visible' }),
    now: () => now + wallShift,
    mono: () => now,
    setInterval: (fn) => ((tick = fn), 1),
    clearInterval: () => (tick = null),
    timeZone: () => 'Europe/Berlin',
  };
  return {
    env,
    track,
    advance: (ms) => (now += ms),
    /** The microphone starts delivering at another rate (a Bluetooth route change). */
    setRealRate: (r) => (realRate = r),
    /** The phone's clock is set (or the phone slept): only `env.now` moves. */
    shiftWall: (ms) => (wallShift += ms),
    tick: () => tick && tick(),
    /** Plays samples into the recorder, as the audio graph would, in 4096-sample blocks; a block arrives once its audio has been captured. */
    feed(samples) {
      for (let i = 0; i < samples.length; i += 4096) {
        now += (Math.min(4096, samples.length - i) / realRate) * 1000;
        processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples.subarray(i, i + 4096) } });
      }
    },
    /** Delivers samples all at once, as a page that was busy receives its backlog. */
    burst(samples) {
      for (let i = 0; i < samples.length; i += 4096) {
        processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples.subarray(i, i + 4096) } });
      }
    },
  };
}

test('a night goes idle → requesting → recording → stopping → completed and ends as one frozen record', async () => {
  const b = fakeBrowser();
  const states = [];
  const rec = createRecorder({ version: 'test', env: b.env, onState: (s) => states.push(s) });
  assert.equal(rec.state, 'idle');
  await rec.start({ source: 'mic', sensitivity: 'normal' });
  assert.equal(rec.state, 'recording');
  assert.equal(rec.wakeLockState, 'unsupported', 'no wake lock API in this fake browser');
  b.feed(Synth.demoScenario(16000).samples);
  const night = rec.stop();
  assert.deepEqual(states, ['requesting', 'recording', 'stopping', 'completed']);
  assert.equal(rec.session, null);
  assert.equal(rec.night, night);
  assert.ok(Object.isFrozen(night));
  assert.equal(night.timeZone, 'Europe/Berlin');
  assert.equal(night.sampleRate, 16000);
  assert.equal(night.summary.snoreCount, 16, 'the demo night counts as in the detector tests');
  assert.equal(night.summary.ignoredCount, 5);
  assert.equal(night.config.minBreathRiseDb, 6, 'Normal counts with the 6 dB breath-noise rule (1.17.0)');
  assert.ok(night.summary.snoreCount === 16 && !night.summary.ignoredByReason['no-breath'], 'the demo snores have clear breath noise');
  // The breath-noise background tests ended when Normal took the rule over; the data file holds what they showed.
  // The High trial ended in 1.23.0 (High took the breath rule); automatic sensitivity was removed in 1.24.0.
  assert.deepEqual(Object.keys(night.shadows), ['knock'], 'one background test is left');
  assert.deepEqual(night.shadows.knock.options, { sensitivity: 'normal', maxOnsetJumpDb: 20 });
  assert.equal(night.shadows.knock.config.minBreathRiseDb, 6, 'the knock test counts like Normal otherwise');
  assert.equal(night.shadows.knock.summary.snoreCount, 16, 'the demo snores swell; none starts suddenly');
  assert.ok(
    night.shadows.knock.snores.every((x) => !x.clip),
    'the knock test keeps no audio',
  );
  assert.ok(Array.isArray(night.shadows.knock.setAside), 'the sounds its own rules set aside are handed over');
  for (const [name, sh] of Object.entries(night.shadows)) {
    assert.ok(
      sh.setAside.every((e) => ['sudden', 'choppy'].includes(e.reason)),
      `${name}: set aside by its own rules, or choppy without a rescue`,
    );
  }
  // From the data file, each background test's own rules give its own count back (1.22.1).
  const file = JSON.parse(JSON.stringify(toReport(night)));
  for (const [name, sh] of Object.entries(file.shadows)) assert.equal(recount(sh).length, night.shadows[name].summary.snoreCount, name);
  assert.deepEqual(night.noise.bandsHz, [31.5, 63, 125, 250, 500, 1000, 2000, 4000]); // 16 kHz: up to the 4 kHz octave
  assert.deepEqual(
    night.noise.minutes.map((m) => m.t),
    [0, 60],
    'the 90 s demo night has two minutes of room noise',
  );
  assert.ok(night.noise.minutes.every((m) => m.quietSec > 10 && m.bandsDb.length === 8 && m.p90Db > m.backgroundDb));
  assert.ok(
    Object.values(night.shadows).every((sh) => !('noise' in sh)),
    'only the counting detector keeps the profile',
  );
  assert.equal(night.gaps.length, 0);
});

test("the recorder's night is the analysis of the audio it was fed, as npm run analyze gives it from a file", async () => {
  const b = fakeBrowser();
  const rec = createRecorder({ version: 'test', env: b.env });
  await rec.start({ source: 'mic', sensitivity: 'high' });
  const { samples } = Synth.demoScenario(16000);
  b.feed(samples);
  const night = rec.stop();
  const fromFile = analyzeSamples(samples, 16000, { sensitivity: 'high', startWall: night.startWall }).night;
  const file = (n) => JSON.parse(JSON.stringify(toReport(n)));
  for (const key of ['sensitivity', 'minBreathRiseDb', 'summary', 'noise', 'snores', 'ignored', 'shadows']) {
    assert.deepEqual(file(night)[key], file(fromFile)[key], key);
  }
});

test('the night records the processing the browser actually applied to the microphone', async () => {
  const b = fakeBrowser();
  // The app asks for all processing off; this browser keeps noise suppression on. Only the
  // processing settings are kept, not the device's id or name.
  b.track.getSettings = () => ({
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48000,
    deviceId: 'abc',
  });
  const rec = createRecorder({ version: 'test', env: b.env });
  await rec.start({ source: 'mic' });
  b.feed(new Float32Array(16000));
  const night = rec.stop();
  const applied = { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1, sampleRate: 48000 };
  assert.deepEqual(night.microphone, applied);
  assert.deepEqual(browserProcessing(night.microphone), ['noise suppression']);
  assert.deepEqual(JSON.parse(JSON.stringify(toReport(night))).microphone, applied, 'the data file holds it');

  // A browser that reports nothing (or throws) gives nulls, not a guess.
  const silent = fakeBrowser();
  silent.track.getSettings = () => {
    throw new Error('not supported');
  };
  const rec2 = createRecorder({ version: 'test', env: silent.env });
  await rec2.start({ source: 'mic' });
  silent.feed(new Float32Array(16000));
  const unknown = { echoCancellation: null, noiseSuppression: null, autoGainControl: null, channelCount: null, sampleRate: null };
  assert.deepEqual(rec2.stop().microphone, unknown);
  assert.deepEqual(browserProcessing(unknown), []);

  // The demo and WAV files have no microphone: null in the data file.
  assert.equal(JSON.parse(JSON.stringify(toReport({ ...night, microphone: null }))).microphone, null);
  assert.equal(analyzeSamples(new Float32Array(16000), 16000).report.microphone, null);
});

test('browserProcessing names the processing a browser kept on', () => {
  assert.deepEqual(browserProcessing(null), []);
  assert.deepEqual(browserProcessing({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }), []);
  assert.deepEqual(browserProcessing({ echoCancellation: 'all', noiseSuppression: true, autoGainControl: true }), [
    'noise suppression',
    'automatic volume',
    'echo cancellation',
  ]);
  assert.deepEqual(
    browserProcessing({ echoCancellation: 'remote-only', noiseSuppression: null, autoGainControl: null }),
    [],
    'only remote audio',
  );
});

test('a failed start leaves the state and the last night as they were', async () => {
  const ok = fakeBrowser();
  const rec = createRecorder({ env: ok.env });
  await rec.start();
  ok.feed(Synth.demoScenario(16000).samples.subarray(0, 16000 * 10));
  const first = rec.stop();
  const denied = fakeBrowser({ denyMic: true });
  const rec2 = createRecorder({ env: denied.env });
  await assert.rejects(rec2.start(), { name: 'NotAllowedError' });
  assert.equal(rec2.state, 'idle');
  assert.equal(rec2.night, null);
  // Same recorder: a refused second start keeps the first night.
  ok.env.navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  };
  await assert.rejects(rec.start(), { name: 'NotAllowedError' });
  assert.equal(rec.state, 'completed');
  assert.equal(rec.night, first);
});

test('interruptions: suspended audio, silence from the system and a switched-off microphone', async () => {
  const b = fakeBrowser();
  const states = [];
  const rec = createRecorder({ env: b.env, onState: (s) => states.push(s) });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  b.feed(audio.subarray(0, 16000 * 5));

  // The system suspends the audio (a call): interrupted until audio flows again.
  const ctx = rec.session.ctx;
  ctx.state = 'suspended';
  ctx.onstatechange();
  assert.equal(rec.state, 'interrupted');
  assert.equal(rec.gapReason, 'suspended');
  b.advance(3000);
  ctx.state = 'running';
  b.feed(audio.subarray(16000 * 5, 16000 * 8));
  assert.equal(rec.state, 'recording');

  // No audio at all for more than 2 s: noticed by the watchdog.
  b.advance(2500);
  b.tick();
  assert.equal(rec.state, 'interrupted');
  assert.equal(rec.gapReason, 'stalled');
  b.feed(audio.subarray(16000 * 8, 16000 * 9));
  assert.equal(rec.state, 'recording');

  // The microphone is switched off for good.
  b.track.readyState = 'ended';
  b.track.dispatch('ended');
  assert.equal(rec.gapReason, 'ended');
  b.feed(audio.subarray(16000 * 9, 16000 * 10)); // stray audio is not analysed
  assert.equal(rec.state, 'interrupted');
  b.advance(1000);
  const night = rec.stop();

  assert.deepEqual(
    night.gaps.map((g) => g.reason),
    ['suspended', 'stalled', 'ended'],
  );
  assert.ok(Math.abs((night.gaps[0].end - night.gaps[0].start) / 1000 - 3) < 0.01);
  assert.ok(Math.abs(night.capturedSeconds - 9) < 0.05, `analysed ${night.capturedSeconds} s`);
  const lost = night.gaps.reduce((s, g) => s + (g.end - g.start) / 1000, 0);
  assert.ok(Math.abs(night.clockSeconds - night.capturedSeconds - lost) < 1e-9);
  assert.ok(states.includes('interrupted'));
});

test("resume is tried for 'suspended' and iOS 'interrupted' audio, not for 'closed' or a switched-off microphone", async () => {
  async function attempts(ctxState, { endTrack = false, failResume = false } = {}) {
    const b = fakeBrowser();
    let calls = 0;
    b.env.AudioContext.prototype.resume = function () {
      calls++;
      return failResume ? Promise.reject(new Error('needs a gesture')) : Promise.resolve();
    };
    const rec = createRecorder({ env: b.env });
    await rec.start();
    calls = 0; // only attempts during the gap count
    if (endTrack) {
      b.track.readyState = 'ended';
      b.track.dispatch('ended');
    }
    rec.session.ctx.state = ctxState;
    rec.session.ctx.onstatechange();
    assert.equal(rec.state, 'interrupted');
    for (let i = 0; i < 3; i++) {
      b.advance(1000);
      b.tick();
    }
    b.env.document.dispatch('visibilitychange');
    await Promise.resolve();
    rec.stop();
    return calls;
  }
  assert.ok((await attempts('suspended')) >= 4);
  assert.ok((await attempts('interrupted')) >= 4, 'the iOS state is resumed too');
  assert.ok((await attempts('interrupted', { failResume: true })) >= 4, 'a refused resume is retried, not thrown');
  assert.equal(await attempts('closed'), 0);
  assert.equal(await attempts('interrupted', { endTrack: true }), 0);
});

test('a screen lock that arrives after Stop, or for an earlier night, is released at once', async () => {
  const b = fakeBrowser();
  const pending = [];
  const released = [];
  b.env.navigator.wakeLock = { request: () => new Promise((resolve) => pending.push(resolve)) };
  const sentinel = (name) => {
    const handlers = [];
    return {
      name,
      addEventListener: (type, fn) => handlers.push(fn),
      release: async () => {
        released.push(name);
        handlers.forEach((fn) => fn());
      },
    };
  };
  const rec = createRecorder({ env: b.env });

  // Stop before the browser answers.
  await rec.start();
  rec.stop();
  pending.shift()(sentinel('late'));
  await new Promise((r) => setImmediate(r));
  assert.equal(rec.state, 'completed');
  assert.equal(rec.wakeLockState, 'off');
  assert.deepEqual(released, ['late']);

  // An answer for the first night arrives during the second one.
  await rec.start(); // request A
  rec.stop();
  await rec.start(); // request B
  pending.shift()(sentinel('old night'));
  pending.shift()(sentinel('this night'));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(released, ['late', 'old night']);
  assert.equal(rec.wakeLockState, 'on');
  rec.stop();
  assert.deepEqual(released, ['late', 'old night', 'this night']);
});

const wallSec = (n) => (n.endWall - n.startWall) / 1000;
const lostSec = (n) => n.gaps.reduce((t, g) => t + (g.end - g.start) / 1000, 0);

test('audio that only arrived late is analysed and leaves no interruption: the night is not longer than it was', async () => {
  const b = fakeBrowser();
  const rec = createRecorder({ env: b.env });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  b.feed(audio.subarray(0, 16000 * 20));
  // The page is busy for 3 s: no blocks arrive, the watchdog notices a stall …
  b.advance(3000);
  b.tick();
  assert.equal(rec.gapReason, 'stalled');
  // … then the 3 s of audio the browser kept arrive at once, and audio flows on.
  b.burst(audio.subarray(16000 * 20, 16000 * 23));
  b.feed(audio.subarray(16000 * 23, 16000 * 40));
  assert.equal(rec.state, 'recording');
  const night = rec.stop();
  assert.equal(night.gaps.length, 0, 'nothing was missing');
  assert.ok(Math.abs(night.capturedSeconds - 40) < 0.3, `analysed ${night.capturedSeconds} s`);
  assert.ok(Math.abs(night.clockSeconds - wallSec(night)) < 0.3, `clock ${night.clockSeconds} s, wall ${wallSec(night)} s`);
});

test('an interruption is the audio actually missing: recorded plus not recorded equals the night', async () => {
  const b = fakeBrowser();
  const rec = createRecorder({ env: b.env });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  b.feed(audio.subarray(0, 16000 * 10));
  for (let k = 0; k < 20; k++) {
    // 5 s without audio (lost, not late), noticed by the watchdog, then 10 s of audio.
    b.advance(5000);
    b.tick();
    b.feed(audio.subarray(0, 16000 * 10));
  }
  const night = rec.stop();
  assert.equal(night.gaps.length, 20);
  for (const g of night.gaps) assert.ok(Math.abs((g.end - g.start) / 1000 - 5) < 0.01, `gap ${(g.end - g.start) / 1000} s`);
  // Before 1.27.0 each gap also counted its first returning block (here 0.256 s) twice: 5.1 s in all.
  // What is left is the analysis's last partial frame at Stop (16 ms here).
  const sum = night.capturedSeconds + lostSec(night);
  assert.ok(Math.abs(sum - wallSec(night)) < 0.05, `captured ${night.capturedSeconds} + lost ${lostSec(night)} vs wall ${wallSec(night)}`);
  assert.ok(Math.abs(night.clockSeconds - wallSec(night)) < 0.05);
});

test("the phone's clock being set does not change any length; a phone asleep during a gap still counts the gap", async () => {
  const b = fakeBrowser();
  const rec = createRecorder({ env: b.env });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  b.feed(audio.subarray(0, 16000 * 10));
  // The clock is set back an hour during an interruption of 4 s.
  b.advance(4000);
  b.tick();
  b.shiftWall(-3600 * 1000);
  b.feed(audio.subarray(0, 16000 * 10));
  // The phone sleeps during an interruption: its monotonic clock pauses, the wall clock runs 60 s.
  b.tick();
  b.advance(2500);
  b.tick();
  assert.equal(rec.gapReason, 'stalled');
  b.shiftWall(60 * 1000);
  b.feed(audio.subarray(0, 16000 * 10));
  const night = rec.stop();
  const secs = night.gaps.map((g) => (g.end - g.start) / 1000);
  assert.equal(secs.length, 2);
  assert.ok(Math.abs(secs[0] - 4) < 0.01, `first gap ${secs[0]} s, not negative`);
  assert.ok(Math.abs(secs[1] - 62.5) < 0.01, `second gap ${secs[1]} s: the wall clock's 60 s of sleep count`);
  assert.ok(night.gaps.every((g) => g.end >= g.start));
  assert.ok(Math.abs(night.clockSeconds - (30 + 4 + 62.5)) < 0.05, `clock ${night.clockSeconds}`);
  // Known limit: a clock set forward during an interruption looks like a sleeping phone, so the
  // gap gets longer by the shift (here the 60 s above would be the same if the clock had been set).
});

test('a browser that delivers audio at another rate than it says is caught by the audio clock check', async () => {
  // The context says 16 kHz, the microphone delivers 17,440 samples per second: audio runs 9 % fast.
  const b = fakeBrowser({ realRate: 17440 });
  const seen = [];
  const rec = createRecorder({ env: b.env, onAudioClock: (r) => seen.push(audioClockOff(r.audioClock, 'recent')) });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  for (let k = 0; k < 4; k++) b.feed(audio.subarray(0, 16000 * 30));
  b.tick();
  assert.equal(rec.audioClock.ratio, null, 'not judged before 150 s of real time (110 s so far)');
  assert.equal(seen.length, 0);
  for (let k = 0; k < 6; k++) b.feed(audio.subarray(0, 16000 * 30));
  b.tick();
  assert.ok(Math.abs(rec.audioClock.recentRatio - 1.09) < 0.002, `ratio ${rec.audioClock.recentRatio}`);
  assert.equal(seen.length, 1, 'the page is told once');
  assert.ok(Math.abs(seen[0] - 0.09) < 0.002);
  const night = rec.stop();
  const file = JSON.parse(JSON.stringify(toReport(night)));
  assert.equal(file.audioClock.sampleRate, 16000);
  assert.ok(Math.abs(file.audioClock.ratio - 1.09) < 0.002);
  assert.ok(Math.abs(file.audioClock.worstRatio - 1.09) < 0.002);
  assert.ok(file.audioClock.checkedSeconds >= 270);
  assert.ok(Math.abs(audioClockOff(night.audioClock) - 0.09) < 0.002);
  assert.equal(audioClockOff(null), 0);
  assert.equal(audioClockOff({ ratio: null, worstRatio: null }), 0);
});

test('a rate change partway through the night is caught by its window, not averaged away', async () => {
  const b = fakeBrowser();
  const seen = [];
  const rec = createRecorder({ env: b.env, onAudioClock: (r) => seen.push(audioClockOff(r.audioClock, 'recent')) });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  for (let k = 0; k < 40; k++) b.feed(audio.subarray(0, 16000 * 30)); // 20 min as it should be
  b.tick();
  assert.equal(seen.length, 0);
  b.setRealRate(17440); // Bluetooth headphones connect: audio now runs 9 % fast
  for (let k = 0; k < 20; k++) b.feed(audio.subarray(0, 16000 * 30));
  b.tick();
  assert.equal(seen.length, 1, 'warned while recording');
  const night = rec.stop();
  assert.ok(night.audioClock.ratio < 1.04, `the whole night averages to ${night.audioClock.ratio}`);
  assert.ok(Math.abs(night.audioClock.worstRatio - 1.09) < 0.005, `worst window ${night.audioClock.worstRatio}`);
  assert.ok(Math.abs(audioClockOff(night.audioClock) - 0.09) < 0.005, 'the report names the audio clock');
});

test('a correct audio clock with interruptions raises no warning', async () => {
  const b = fakeBrowser();
  const seen = [];
  const rec = createRecorder({ env: b.env, onAudioClock: () => seen.push(1) });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  for (let k = 0; k < 12; k++) {
    b.feed(audio.subarray(0, 16000 * 30));
    b.advance(5000); // 5 s lost
    b.tick();
  }
  b.feed(audio.subarray(0, 16000 * 30));
  const night = rec.stop();
  assert.equal(night.gaps.length, 12);
  assert.ok(Math.abs(night.audioClock.ratio - 1) < 0.005, `ratio ${night.audioClock.ratio}`);
  assert.equal(audioClockOff(night.audioClock), 0);
  assert.deepEqual(seen, [], 'the gaps are not taken for slow audio');
});

test('an interruption right after audio came back opens its own gap; the silence of a muted microphone is not analysed', async () => {
  for (const event of ['mute', 'ended']) {
    const b = fakeBrowser();
    const rec = createRecorder({ env: b.env });
    await rec.start();
    const audio = Synth.demoScenario(16000).samples;
    b.feed(audio.subarray(0, 16000 * 20));
    b.advance(3000);
    b.tick(); // stalled
    b.feed(audio.subarray(0, 4096)); // one block comes back and is held …
    if (event === 'mute')
      b.track.muted = true; // … and the microphone goes quiet before the gap is decided
    else b.track.readyState = 'ended';
    b.track.dispatch(event);
    assert.equal(rec.state, 'interrupted');
    for (let k = 0; k < 60; k++) {
      b.feed(new Float32Array(16000)); // the silence a muted or ended track renders
      b.tick();
    }
    assert.equal(rec.state, 'interrupted', `still interrupted after '${event}'`);
    const night = rec.stop();
    assert.deepEqual(
      night.gaps.map((g) => g.reason),
      ['stalled', event === 'mute' ? 'muted' : 'ended'],
    );
    assert.ok(Math.abs(night.capturedSeconds - 20.256) < 0.05, `${event}: analysed ${night.capturedSeconds} s`);
    assert.ok(Math.abs(night.clockSeconds - wallSec(night)) < 0.05);
  }
});

test('a page that is busy twice after an interruption leaves no false gap', async () => {
  const b = fakeBrowser();
  const rec = createRecorder({ env: b.env });
  await rec.start();
  const audio = Synth.demoScenario(16000).samples;
  b.feed(audio.subarray(0, 16000 * 20));
  b.advance(3000);
  b.tick(); // stalled: the page was busy for 3 s
  b.burst(audio.subarray(0, 16000 * 3)); // its backlog arrives and is held
  b.advance(3000); // busy again for 3 s before the gap was decided
  b.burst(audio.subarray(0, 16000 * 3)); // the second backlog
  b.feed(audio.subarray(0, 16000 * 20));
  const night = rec.stop();
  assert.equal(night.gaps.length, 0, `gaps ${JSON.stringify(night.gaps.map((g) => (g.end - g.start) / 1000))}`);
  assert.ok(Math.abs(night.clockSeconds - wallSec(night)) < 0.3, `clock ${night.clockSeconds} s, wall ${wallSec(night)} s`);
});

test('episodes and the typical interval do not span an interruption', () => {
  const stats = new SessionStats();
  const snore = (start) => ({ isSnore: true, start, end: start + 1, duration: 1, relDb: 20 });
  for (const t of [0, 4, 8]) stats.add(snore(t));
  stats.addGap(10, 30);
  for (const t of [31, 35, 39]) stats.add(snore(t));
  const sum = stats.summary(40);
  assert.equal(sum.snoreCount, 6);
  assert.deepEqual(
    sum.episodes.map((e) => [e.start, e.end, e.count]),
    [
      [0, 9, 3],
      [31, 40, 3],
    ],
    'two episodes, split at the interruption (one of 40 s before 1.27.0)',
  );
  assert.equal(sum.longestEpisode, 9);
  assert.equal(sum.medianInterval, 4, 'the 23 s across the gap is not an interval');
});
