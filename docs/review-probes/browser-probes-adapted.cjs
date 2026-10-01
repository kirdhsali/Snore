'use strict';
/* global __snorewatch, __review */
// Usage: CHROMIUM_PATH=<chrome> node docs/review-probes/browser-probes-adapted.cjs "$PWD"
// The review's browser probes, adapted to the code after v1.11.2: the recorder owns
// audio (js/recorder.js), so state is read through the page's test hooks
// (window.__snorewatch) instead of the removed app.js internals. The only response
// modification exposes app.js's handleEvent/live for the 4000-event dark-queue probe.
const fs = require('node:fs'),
  path = require('node:path');
const repo = process.argv[2];
const { chromium } = require(path.join(repo, 'node_modules/playwright'));
const server = require(path.join(repo, 'scripts/serve.js'));
const { makeSampleWav } = require(path.join(repo, 'scripts/make-sample.js'));
const wav = path.join(require('node:os').tmpdir(), 'snorewatch-probe.wav');
fs.writeFileSync(wav, makeSampleWav(48000).wav);
const source = fs
  .readFileSync(path.join(repo, 'js/app.js'), 'utf8')
  .replace(/\}\)\(\);\s*$/, 'window.__review={handleEvent,get live(){return live}};})();');
const results = {};
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  results.browser = browser.version();
  async function pageFor(options = {}) {
    const p = await browser.newPage();
    await p.route('**/js/app.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: source }));
    if (options.rejectWake)
      await p.addInitScript(() =>
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: {
            request: async () => {
              throw new DOMException('Synthetic wake-lock denial', 'NotAllowedError');
            },
          },
        }),
      );
    await p.goto(url);
    await p.click('#rec');
    await p.waitForFunction(() => window.__snorewatch.running);
    await p.evaluate(() => window.__snorewatch.setDarkDelay(9999999));
    return p;
  }
  try {
    // R1: suspended context (resume blocked as during a call) and the reported end time.
    const p = await pageFor();
    await p.waitForTimeout(1600);
    const before = await p.evaluate(async () => {
      const ctx = __snorewatch.audio.ctx;
      window.__resume = ctx.resume.bind(ctx);
      ctx.resume = () => Promise.resolve();
      await ctx.suspend();
      return { wall: Date.now() };
    });
    await p.waitForTimeout(2200);
    results.suspended = await p.evaluate(
      (b) => ({
        running: __snorewatch.running,
        contextState: __snorewatch.audio.ctx.state,
        gapOpen: !!__snorewatch.audio.gap,
        wallElapsed: (Date.now() - b.wall) / 1000,
        status: document.querySelector('#status').textContent,
      }),
      before,
    );
    await p.evaluate(() => {
      __snorewatch.audio.ctx.resume = window.__resume;
    });
    await p.waitForFunction(() => !__snorewatch.audio.gap, null, { timeout: 5000 });
    const stopAt = await p.evaluate(() => {
      const t = Date.now();
      document.querySelector('#rec').click();
      return t;
    });
    await p.waitForSelector('#report:not([hidden])');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dl-json')]);
    const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    results.endTime = {
      actualStop: stopAt,
      reportedStop: Date.parse(json.endedAt),
      missingSeconds: (stopAt - Date.parse(json.endedAt)) / 1000,
      interruptions: json.interruptions,
      wallSeconds: json.wallSeconds,
      capturedSeconds: json.capturedSeconds,
      report: await p.textContent('#report-range'),
    };
    // R2: failed restart.
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Synthetic permission denial', 'NotAllowedError');
      };
    });
    await p.click('#rec');
    await p.waitForFunction(() => document.querySelector('#status').textContent.includes('blocked'));
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#dl-json')]);
    const json2 = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
    results.failedRestart = {
      reportVisible: await p.isVisible('#report'),
      sameNight: json2.startedAt === json.startedAt,
      snores: json2.snores.length,
      nightId: (await p.evaluate(() => __snorewatch.night)).id,
      pageErrors: errors,
    };
    await p.close();

    // R1 wake lock, R7 keyboard, R1 ended track.
    const p2 = await pageFor({ rejectWake: true });
    await p2.waitForTimeout(600);
    results.wakeDenied = await p2.evaluate(() => ({
      running: __snorewatch.running,
      status: document.querySelector('#status').textContent,
    }));
    await p2.locator('#sensitivity').focus();
    await p2.keyboard.press('ArrowUp');
    results.keyboardSensitivity = await p2.evaluate(() => ({
      controlDisabled: document.querySelector('#sensitivity').disabled,
      selected: document.querySelector('#sensitivity').value,
      detectors: __snorewatch.sensitivities,
    }));
    await p2.evaluate(() => {
      const t = __snorewatch.audio.stream.getTracks()[0];
      t.stop();
      t.dispatchEvent(new Event('ended'));
    });
    await p2.waitForTimeout(700);
    results.endedTrack = await p2.evaluate(() => ({
      running: __snorewatch.running,
      trackState: __snorewatch.audio.stream.getTracks()[0].readyState,
      gapOpen: !!__snorewatch.audio.gap,
      status: document.querySelector('#status').textContent,
    }));
    await p2.click('#rec');
    await p2.close();

    // R6: 4000 snore events while dark.
    const p3 = await pageFor();
    await p3.evaluate(() => {
      __snorewatch.setDarkDelay(1);
    });
    await p3.waitForFunction(() => __snorewatch.dark);
    results.darkQueue = await p3.evaluate(() => {
      const clip = new Int16Array(16);
      clip[0] = 100;
      for (let i = 0; i < 4000; i++)
        __review.handleEvent({
          isSnore: true,
          start: i * 4,
          end: i * 4 + 1,
          duration: 1,
          relDb: 20,
          clip: new Int16Array(clip),
          clipRate: 8000,
          score: 0.9,
          startFrame: 0,
          endFrame: 0,
        });
      return { queued: __review.live.newClips.length };
    });
    await p3.evaluate(() => {
      window.__cardCreates = 0;
      const make = document.createElement.bind(document);
      document.createElement = function (tag, ...args) {
        if (tag === 'button') window.__cardCreates++;
        return make(tag, ...args);
      };
    });
    const t = Date.now();
    await p3.click('#night');
    await p3.waitForFunction(() => __review.live.newClips.length === 0);
    results.darkQueue.wakeWallMilliseconds = Date.now() - t;
    Object.assign(
      results.darkQueue,
      await p3.evaluate(() => ({
        buttonsCreated: window.__cardCreates,
        remainingCards: document.querySelector('#live-clips').children.length,
      })),
    );
    await p3.close();
  } finally {
    await browser.close();
    server.close();
    console.log(JSON.stringify(results, null, 2));
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
