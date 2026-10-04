'use strict';
// js/recorder.js: the recording controller's states and interruption handling,
// driven with fake browser audio objects (no browser needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const Synth = require('../js/synth.js');
const { createRecorder } = require('../js/recorder.js');

/** Minimal stand-ins for AudioContext, a microphone stream and the page. */
function fakeBrowser({ denyMic = false } = {}) {
  let now = Date.parse('2026-10-01T22:00:00Z');
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
    now: () => now,
    setInterval: (fn) => ((tick = fn), 1),
    clearInterval: () => (tick = null),
    timeZone: () => 'Europe/Berlin',
  };
  return {
    env,
    track,
    advance: (ms) => (now += ms),
    tick: () => tick && tick(),
    /** Plays samples into the recorder, as the audio graph would, in 4096-sample blocks. */
    feed(samples) {
      for (let i = 0; i < samples.length; i += 4096) {
        processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples.subarray(i, i + 4096) } });
        now += (4096 / 16000) * 1000;
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
  assert.deepEqual(Object.keys(night.shadows), ['auto']);
  assert.deepEqual(night.shadows.auto.options, { sensitivity: 'auto', minBreathRiseDb: 3, minLowRiseDb: 8 });
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

test('the auto test keeps a random sample of clips of snores the counting detector missed', async () => {
  // A very quiet bedroom: automatic sensitivity finds soft snores that Normal misses.
  const r = Synth.rng(1);
  const plan = [];
  for (let t = 30; t < 280; t += 40) plan.push(...Synth.snoreRun(t, 6, r).map((p) => ({ ...p, amp: 0.0004 * (0.5 + r()) })));
  const samples = Synth.compose(16000, 300, plan, 1, 0.00006).samples;
  const overlapsMain = (night, x) => night.snores.some((m) => m.start < x.end + 0.2 && m.end > x.start - 0.2);
  const record = async (testClips) => {
    const b = fakeBrowser();
    const rand = Synth.rng(9);
    const rec = createRecorder({ version: 'test', env: { ...b.env, random: rand }, testClips });
    await rec.start({ source: 'mic', sensitivity: 'normal' });
    b.feed(samples);
    return rec.stop();
  };
  const all = await record(1000);
  const missed = all.shadows.auto.snores.filter((x) => x.isSnore && !overlapsMain(all, x));
  assert.ok(missed.length >= 8, `auto found ${missed.length} snores Normal missed`);
  assert.deepEqual(
    all.shadows.auto.snores.filter((x) => x.clip),
    missed,
    'without a cap: a clip for each of them and nothing else',
  );
  const night = await record(5);
  const kept = night.shadows.auto.snores.filter((x) => x.clip);
  assert.equal(kept.length, 5, 'capped');
  assert.ok(kept.every((x) => !overlapsMain(night, x) && x.clip instanceof Int16Array && x.clip.length > 0));
  assert.ok(
    Object.entries(night.shadows).every(([k, sh]) => k === 'auto' || sh.snores.every((x) => !x.clip)),
    'the other background tests keep no audio',
  );
});
