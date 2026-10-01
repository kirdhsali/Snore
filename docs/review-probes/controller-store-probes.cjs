/*
 * Appendix B of docs/reviews/2026-10-01-a87c1f3-review.md, unchanged apart from
 * formatting (Prettier). Reproduces C1, C3, C4, C5 and C6 with the fake browser from
 * tests/recorder.test.js. Run: node docs/review-probes/controller-store-probes.cjs "$PWD"
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = process.argv[2];
const get = (name) => require(path.join(repo, name));
const { createRecorder } = get('js/recorder.js');
const { createMemoryStore } = get('js/night-store.js');
const Core = get('js/detector.js');
const Synth = get('js/synth.js');
const Share = get('js/share.js');
const Report = get('js/report-format.js');

const helperPath = path.join(repo, 'tests/recorder.test.js');
const box = { require: createRequire(helperPath), module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(helperPath, 'utf8').split("test('a night goes")[0] + '\nmodule.exports = fakeBrowser;', box);
const fake = box.module.exports;

(async () => {
  for (const state of ['suspended', 'interrupted']) {
    const b = fake();
    let resumes = 0;
    b.env.AudioContext.prototype.resume = async () => {
      resumes++;
    };
    const rec = createRecorder({ env: b.env });
    await rec.start();
    rec.session.ctx.state = state;
    rec.session.ctx.onstatechange();
    for (let i = 0; i < 4; i++) {
      b.advance(1000);
      b.tick();
    }
    b.env.document.dispatch('visibilitychange');
    console.log('C1', state, resumes);
    rec.stop();
  }

  const b = fake();
  let finishRequest,
    releases = 0;
  b.env.navigator.wakeLock = {
    request: () =>
      new Promise((r) => {
        finishRequest = r;
      }),
  };
  const rec = createRecorder({ env: b.env });
  await rec.start();
  rec.stop();
  finishRequest({
    addEventListener() {},
    async release() {
      releases++;
    },
  });
  await Promise.resolve();
  console.log('C5', rec.state, rec.wakeLockState, releases);

  const audio = fake();
  const r = createRecorder({ env: audio.env, version: 'review' });
  await r.start();
  audio.feed(Synth.demoScenario(16000).samples.subarray(0, 30 * 16000));
  audio.track.readyState = 'ended';
  audio.track.dispatch('ended');
  audio.advance(3600000);
  const night = r.stop();
  const html = Share.buildReportHtml({
    startWall: night.startWall,
    elapsed: night.clockSeconds,
    snores: night.stats.confirmed,
    summary: night.summary,
    version: 'review',
    sensitivity: night.sensitivity,
    sourceLabel: 'Synthetic review',
    reasons: Core.REASONS,
    samples: { loud: [], random: [] },
  });
  console.log('C3', Report.toReport(night).interruptions, html.match(/<p class="verdict">([^<]*)/)[1]);

  const store = createMemoryStore();
  const id = await store.create({ startWall: 0 });
  await store.appendEvents(id, [{ id: 1, start: 2, isSnore: true }]);
  await store.appendClip(id, 1, new Int16Array([9, -9]), 8000);
  await store.appendEvents(id, [{ id: 1, start: 2, isSnore: false }]);
  await store.finalize(id, { summary: { snoreCount: 0 } });
  const loaded = await store.load(id);
  loaded.record.summary.snoreCount = 999;
  const again = await store.load(id);
  console.log('C4', again.events[0].isSnore, again.clips.size, again.record.summary.snoreCount);

  const d = new Core.SnoreDetector(16000, { sensitivity: 'auto' });
  const quiet = Synth.compose(16000, 30, [], 4).samples;
  d.process(quiet);
  const before = d.levels.length;
  d.resumeAfterGap(3600);
  d.process(quiet);
  console.log('C6', d.clock, d.levels[before].t);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
