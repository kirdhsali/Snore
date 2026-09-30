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
    // Record every media element the page plays, and how loud its audio is.
    await page.addInitScript(() => {
      window.__played = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const rec = { ok: false, error: null, ended: false, duration: 0, peak: 0 };
        window.__played.push(rec);
        this.addEventListener('ended', () => {
          rec.ended = true;
          rec.duration = this.duration;
        });
        fetch(this.src)
          .then((r) => r.arrayBuffer())
          .then((b) => {
            const v = new DataView(b);
            for (let i = 44; i + 1 < b.byteLength; i += 2) rec.peak = Math.max(rec.peak, Math.abs(v.getInt16(i, true)) / 32768);
          });
        return play.call(this).then(
          () => (rec.ok = true),
          (err) => {
            rec.error = `${err.name}: ${err.message}`;
            throw err;
          },
        );
      };
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);

    console.log('Microphone: recording 30 s of the demo night through a fake mic…');
    await page.click('#rec');
    await page.waitForFunction(() => window.__snorewatch.running, null, { timeout: 10000 });

    console.log('Night screen: darkens when left alone, a tap only wakes it…');
    await page.evaluate(() => window.__snorewatch.setDarkDelay(500));
    await page.waitForFunction(() => window.__snorewatch.dark, null, { timeout: 5000 });
    assert.ok(await page.isVisible('#night'), 'black night screen shown');
    await page.click('#night', { position: { x: 200, y: 180 } }); // right over the Stop button
    assert.equal(await page.evaluate(() => window.__snorewatch.dark), false, 'tap wakes the screen');
    assert.ok(await page.evaluate(() => window.__snorewatch.running), 'the tap did not stop the recording');
    await page.evaluate(() => window.__snorewatch.setDarkDelay(1500));
    await page.waitForFunction(() => window.__snorewatch.dark, null, { timeout: 5000 });
    await sleep(26000); // most of the recording happens with the screen dark
    await page.click('#night');
    await page.evaluate(() => window.__snorewatch.setDarkDelay(600000));
    await sleep(2000);
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

    assert.match(await page.textContent('#shadow-note'), /automatic sensitivity/);
    const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-json')]);
    const report = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
    assert.equal(report.shadow.sensitivity, 'auto');
    assert.ok(report.shadow.summary.snoreCount >= 4, `shadow counted ${report.shadow.summary.snoreCount}`);
    assert.ok(report.shadow.snores.every((x) => typeof x.offsetSec === 'number' && !('clip' in x)));
    console.log(`  shadow (auto): ${report.shadow.summary.snoreCount} snores, ${report.shadow.levels.length} margin updates`);

    console.log('Playback: tapping the loudest snore…');
    await page.click('#report-clips .clip');
    // play() resolves asynchronously; wait until it either started or failed.
    await page.waitForFunction(() => window.__played.length && (window.__played[0].ok || window.__played[0].error), null, {
      timeout: 5000,
    });
    const played = await page.evaluate(() => window.__played);
    assert.ok(played.length === 1 && played[0].ok, `clip started playing: ${JSON.stringify(played)}`);
    await page.waitForFunction(() => !document.querySelector('#report-clips .clip.is-playing'), null, { timeout: 8000 });
    const ended = await page.evaluate(() => window.__played[0]);
    console.log(`  played ${ended.duration.toFixed(2)} s, peak ${ended.peak.toFixed(2)} of full scale`);
    assert.ok(ended.ended, 'clip played to the end');
    assert.ok(ended.peak > 0.5, 'clip is loud enough to hear');
    assert.doesNotMatch(await page.textContent('#status'), /could not be played/);
    assert.match(await page.textContent('#app-version'), /^Snorewatch \d+\.\d+\.\d+ \(/);

    console.log('Sharing: image and full report…');
    await page.waitForSelector('#share-image:not([disabled])', { timeout: 10000 });
    const [img] = await Promise.all([page.waitForEvent('download'), page.click('#share-image')]);
    const png = fs.readFileSync(await img.path());
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1350], 'image is 1080 x 1350');
    const [rep] = await Promise.all([page.waitForEvent('download'), page.click('#share-report')]);
    assert.match(rep.suggestedFilename(), /^snore-report_.*\.html$/);
    const reportPath = path.join(os.tmpdir(), 'snorewatch-report.html');
    fs.copyFileSync(await rep.path(), reportPath);
    const html = fs.readFileSync(reportPath, 'utf8');
    assert.doesNotMatch(html, /<script/i);
    const nAudio = (html.match(/<audio/g) || []).length;
    const reportPage = await browser.newPage();
    await reportPage.goto('file://' + reportPath);
    const clipSeconds = await reportPage.evaluate(async () => {
      const a = document.querySelector('audio');
      a.muted = true;
      await a.play();
      return a.duration;
    });
    await reportPage.close();
    console.log(`  image ${Math.round(png.length / 1024)} KB, report ${Math.round(html.length / 1024)} KB with ${nAudio} snores; first plays ${clipSeconds.toFixed(2)} s`);
    assert.ok(nAudio >= 6, 'report embeds the snores');

    console.log('Demo mode (#demo in the address): playing 12 s of the simulated night…');
    assert.ok(await page.isHidden('#demo-badge'), 'no demo label while recording from the microphone');
    await page.evaluate(() => (location.hash = 'demo'));
    await page.waitForSelector('#demo-badge:not([hidden])');
    assert.equal(await page.$('input[type="file"]'), null, 'no file upload any more');
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
