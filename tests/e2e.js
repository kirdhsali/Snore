#!/usr/bin/env node
// Browser test: runs the real page in Chromium with a fake microphone that
// plays the synthetic demo night, then checks the live stats and the report.
//   npm install && npx playwright install chromium && npm run test:e2e
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const server = require('../scripts/serve.js');
const { makeSampleWav } = require('../scripts/make-sample.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wavPath = path.join(os.tmpdir(), 'snorewatch-fake-mic.wav');
  fs.writeFileSync(wavPath, makeSampleWav(48000).wav);

  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);

    console.log('Microphone: recording 30 s of the demo night through a fake mic…');
    await page.click('#rec');
    await page.waitForFunction(() => window.__snorewatch.running, null, { timeout: 10000 });
    await sleep(30000);
    const live = await page.evaluate(() => window.__snorewatch.summary());
    console.log(`  live: ${live.snoreCount} snores, ${live.ignoredCount} ignored after ${live.elapsed.toFixed(1)} s`);
    // The first 30 s hold 6 snores and one stretch of speech.
    assert.ok(live.snoreCount >= 4 && live.snoreCount <= 7, `expected ~6 snores, got ${live.snoreCount}`);
    assert.ok(await page.isVisible('#live-tiles .tile'), 'live tiles visible');

    await page.click('#rec');
    await page.waitForSelector('#report:not([hidden])');
    const verdict = await page.textContent('#verdict');
    console.log(`  report: ${verdict}`);
    assert.match(verdict, /snore/);
    assert.ok((await page.$$('#report-clips .clip')).length >= 4, 'report lists snore clips');

    console.log('Demo mode: playing 12 s of the simulated night…');
    await page.check('#src-demo', { force: true });
    await page.click('#rec');
    await page.waitForFunction(() => window.__snorewatch.running, null, { timeout: 10000 });
    await sleep(12000);
    await page.click('#rec');
    await page.waitForSelector('#report:not([hidden])');
    const demo = await page.evaluate(() => window.__snorewatch.summary());
    console.log(`  demo: ${demo.snoreCount} snores after ${demo.elapsed.toFixed(1)} s`);
    assert.ok(demo.snoreCount >= 1, 'demo produced snores');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('E2E passed');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
