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
    // Phone-sized, like the owner's iPhone, where the layout is tightest.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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

    console.log('Darken screen button stays put while the status and level change…');
    const spots = new Set();
    const pills = new Set();
    for (let i = 0; i < 12; i++) {
      const box = await page.locator('#go-dark').boundingBox();
      spots.add(box ? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}` : 'hidden');
      pills.add(await page.textContent('#pill-text'));
      await sleep(400);
    }
    assert.ok(pills.size >= 2, `status changed meanwhile: ${[...pills]}`);
    assert.deepEqual([...spots].length, 1, `button positions: ${[...spots].join(' | ')} while the status read ${[...pills].join(' / ')}`);
    assert.ok(!spots.has('hidden'), 'button shown while recording');

    console.log('Sensitivity is locked while recording, also for the keyboard…');
    assert.ok(await page.isDisabled('#sensitivity'), 'sensitivity disabled while recording');
    await page.evaluate(() => document.querySelector('#sensitivity').focus());
    await page.keyboard.press('ArrowUp');
    assert.deepEqual(await page.evaluate(() => window.__snorewatch.sensitivities), {
      main: 'normal',
      knock: 'normal',
      auto: 'auto',
    });

    console.log('Night screen: darkens when left alone, a tap only wakes it…');
    await page.evaluate(() => window.__snorewatch.setDarkDelay(500));
    await page.waitForFunction(() => window.__snorewatch.dark, null, { timeout: 5000 });
    assert.ok(await page.isVisible('#night'), 'black night screen shown');
    await page.click('#night', { position: { x: 200, y: 180 } }); // right over the Stop button
    assert.equal(await page.evaluate(() => window.__snorewatch.dark), false, 'tap wakes the screen');
    assert.ok(await page.evaluate(() => window.__snorewatch.running), 'the tap did not stop the recording');
    await page.evaluate(() => window.__snorewatch.setLiveClipLimit(2)); // shows that the dark-screen queue is bounded
    await page.evaluate(() => window.__snorewatch.setDarkDelay(1500));
    await page.waitForFunction(() => window.__snorewatch.dark, null, { timeout: 5000 });
    await sleep(21000); // most of the recording happens with the screen dark (about 30 s in all)
    const pending = await page.evaluate(() => window.__snorewatch.pendingCards);
    assert.ok(pending >= 1 && pending <= 2, `cards queued while dark: ${pending}`);
    await page.click('#night');
    await sleep(300);
    assert.ok((await page.$$('#live-clips .clip')).length <= 2, 'only the newest cards are drawn');
    await page.evaluate(() => window.__snorewatch.setLiveClipLimit(6));
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

    console.log('Room noise panel: shown, too short to describe the room, no heatmap for half a minute…');
    assert.ok(await page.isVisible('#noise-panel'), 'room noise panel shown');
    assert.match(await page.textContent('#noise-findings'), /described from 10 minutes of recording on/);
    assert.equal(await page.isVisible('#noise-legend'), false, 'no heatmap legend without a heatmap');
    assert.equal(await page.$$eval('#noise-chart svg', (x) => x.length), 0);

    assert.match(
      await page.textContent('#shadow-note'),
      /start suddenly \(knocks\) \d+ snores; with automatic sensitivity .* breath-noise rule set aside \d+ sound/,
    );
    const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-json')]);
    const report = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
    assert.equal(report.schemaVersion, 2, 'data file carries its schema version');
    const first = await page.evaluate(() => window.__snorewatch.night);
    assert.ok(first.frozen && /^night-/.test(first.id), `finished night is one frozen record: ${JSON.stringify(first)}`);
    assert.equal(first.snores, report.snores.length);
    assert.ok(first.sampleRate > 0 && first.timeZone);
    assert.equal(report.timeZone, first.timeZone, 'data file names the time zone of the night');
    assert.equal(report.sensitivity, 'normal');
    assert.equal(report.minBreathRiseDb, 6, 'Normal counts with the 6 dB breath-noise rule');
    assert.ok(await page.isEnabled('#sensitivity'), 'sensitivity can be changed again after Stop');
    assert.deepEqual(Object.keys(report.shadows), ['knock', 'auto']);
    assert.equal(report.shadows.knock.sensitivity, 'normal');
    assert.equal(report.shadows.knock.minBreathRiseDb, 6, 'the knock test counts like Normal otherwise');
    assert.equal(report.shadows.knock.maxOnsetJumpDb, 20);
    assert.ok(
      report.snores.every((x) => typeof x.onsetJumpDb === 'number'),
      'onset jump saved per snore',
    );
    assert.equal(report.shadows.auto.sensitivity, 'auto');
    assert.equal(report.shadows.auto.minBreathRiseDb, 3);
    assert.equal(report.shadows.auto.minLowRiseDb, 8, 'auto test: snore-band rule');
    assert.equal(report.shadows.auto.minPreRiseDb, 6, 'auto test: rise over the moment before');
    assert.equal(report.shadows.auto.preRiseSec, 1);
    assert.ok(Array.isArray(report.shadows.auto.setAside));
    assert.ok(
      report.snores.every((x) => typeof x.preRise100Db === 'number'),
      'rise over the moment before saved per snore',
    );
    assert.ok(
      report.snores.every((x) => typeof x.lowRiseDb === 'number'),
      'snore-band rise saved per snore',
    );
    for (const sh of Object.values(report.shadows)) {
      assert.ok(sh.summary.snoreCount >= 4, `background test counted ${sh.summary.snoreCount}`);
      assert.ok(sh.snores.every((x) => typeof x.offsetSec === 'number' && !('clip' in x)));
    }
    assert.ok(
      report.snores.every((x) => typeof x.breathRiseDb === 'number'),
      'breath noise saved per snore',
    );
    assert.ok(report.noise && report.noise.minutes.length >= 1, 'the data file has the room noise per minute');
    assert.ok(
      report.noise.minutes.every((m) => typeof m.backgroundDbfs === 'number' && m.bandsDbfs.length === report.noise.bandsHz.length),
      'background level and octave bands for each minute',
    );
    const testClipsInFile = report.shadows.auto.snores.filter((x) => x.wavStartSec != null).length;
    assert.equal(await page.isVisible('#dl-test-wav'), testClipsInFile > 0, 'test clips offered exactly when the auto test kept some');
    if (testClipsInFile) {
      const [testDl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-test-wav')]);
      assert.ok(fs.statSync(await testDl.path()).size > 44 + testClipsInFile * 1000, 'test-clip WAV holds the clips');
    }
    console.log(`  test clips (auto snores Normal missed): ${testClipsInFile}`);
    console.log(
      `  background tests: knock rule ${report.shadows.knock.summary.snoreCount}, auto + breath + snore band ${report.shadows.auto.summary.snoreCount} snores; no breath noise ${report.summary.ignoredByReason['no-breath'] || 0}`,
    );

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
    console.log(
      `  image ${Math.round(png.length / 1024)} KB, report ${Math.round(html.length / 1024)} KB with ${nAudio} snores; first plays ${clipSeconds.toFixed(2)} s`,
    );
    assert.ok(nAudio >= 6, 'report embeds the snores');
    assert.match(html, /<h2>Room noise<\/h2>[\s\S]*described from 10 minutes/, 'report file: room noise section (too short for findings)');

    console.log('Failed restart: the previous night stays downloadable…');
    await page.evaluate(() => {
      window.__realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await page.click('#rec');
    await page.waitForFunction(() => /blocked/.test(document.querySelector('#status').textContent), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__snorewatch.running), false);
    assert.ok(await page.isVisible('#report'), 'previous report still shown');
    const [again] = await Promise.all([page.waitForEvent('download'), page.click('#dl-json')]);
    const kept = JSON.parse(fs.readFileSync(await again.path(), 'utf8'));
    assert.equal(kept.startedAt, report.startedAt, 'JSON still describes the previous night');
    assert.equal(kept.snores.length, report.snores.length);
    assert.equal((await page.evaluate(() => window.__snorewatch.night)).id, first.id, 'the failed start did not replace the night');
    const [wavAgain] = await Promise.all([page.waitForEvent('download'), page.click('#dl-wav')]);
    assert.equal(fs.readFileSync(await wavAgain.path()).toString('ascii', 0, 4), 'RIFF');
    await page.evaluate(() => (navigator.mediaDevices.getUserMedia = window.__realGetUserMedia));

    console.log('Screen lock refused, then the microphone switched off by the system: both shown, the gap is in the report…');
    await page.evaluate(() => {
      window.__wakeLockRequest = navigator.wakeLock && navigator.wakeLock.request;
      if (navigator.wakeLock) navigator.wakeLock.request = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));
    });
    await page.click('#rec');
    await page.waitForFunction(() => window.__snorewatch.running, null, { timeout: 10000 });
    await page.waitForFunction(() => /did not let the app keep the screen on/.test(document.querySelector('#status').textContent), null, {
      timeout: 5000,
    });
    await sleep(2000);
    await page.evaluate(() => window.__snorewatch.setDarkDelay(300)); // the switch-off happens with the screen dark
    await page.waitForFunction(() => window.__snorewatch.dark, null, { timeout: 5000 });
    assert.match(await page.textContent('#night-meta'), /^Recording · /);
    await page.evaluate(() => {
      const track = window.__snorewatch.audio.stream.getAudioTracks()[0];
      track.stop(); // stop() alone fires no event; the system's switch-off does
      track.dispatchEvent(new Event('ended'));
    });
    await page.waitForFunction(() => /switched the microphone off/.test(document.querySelector('#status').textContent), null, {
      timeout: 5000,
    });
    assert.match(await page.textContent('#night-meta'), /^Microphone off/, 'the dark screen says the microphone is off');
    await page.evaluate(() => window.__snorewatch.setDarkDelay(600000));
    await page.click('#night');
    await sleep(1500);
    await page.click('#rec');
    await page.waitForSelector('#report:not([hidden])');
    assert.match(await page.textContent('#report-range'), /interrupted 1×/);
    await page.waitForSelector('#share-report:not([disabled])', { timeout: 10000 });
    const [offRep] = await Promise.all([page.waitForEvent('download'), page.click('#share-report')]);
    assert.match(fs.readFileSync(await offRep.path(), 'utf8'), /recorded · interrupted 1×/, 'the shared report shows the interruption');
    const [offDl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-json')]);
    const off = JSON.parse(fs.readFileSync(await offDl.path(), 'utf8'));
    assert.equal(off.interruptions.length, 1);
    assert.equal(off.interruptions[0].reason, 'ended');
    assert.match(off.screenWakeLock, /failed|unsupported/);
    await page.evaluate(() => navigator.wakeLock && (navigator.wakeLock.request = window.__wakeLockRequest));
    assert.ok(off.interruptions[0].seconds >= 1.2, `gap ${off.interruptions[0].seconds} s`);
    assert.ok(Math.abs(off.wallSeconds - off.capturedSeconds - off.interruptions[0].seconds) < 0.6, JSON.stringify(off));
    assert.ok(Math.abs(Date.parse(off.endedAt) - Date.parse(off.startedAt) - off.wallSeconds * 1000) < 60, 'end time is the real clock');

    console.log('Demo mode (#demo in the address): playing about 20 s of the simulated night…');
    assert.ok(await page.isHidden('#demo-badge'), 'no demo label while recording from the microphone');
    await page.evaluate(() => (location.hash = 'demo'));
    await page.waitForSelector('#demo-badge:not([hidden])');
    assert.equal(await page.$('input[type="file"]'), null, 'no file upload any more');
    await page.click('#rec');
    await page.waitForFunction(() => window.__snorewatch.running, null, { timeout: 10000 });
    await sleep(4000);
    console.log('  audio suspended by the system for 3 s…');
    // Like an iPhone call: the audio is suspended and cannot be resumed until it ends.
    await page.evaluate(async () => {
      const ctx = window.__snorewatch.audio.ctx;
      window.__resume = ctx.resume.bind(ctx);
      ctx.resume = () => Promise.resolve();
      await ctx.suspend();
    });
    await page.waitForFunction(() => /interrupted/.test(document.querySelector('#status').textContent), null, { timeout: 5000 });
    assert.ok(await page.evaluate(() => window.__snorewatch.running), 'still recording');
    await sleep(3000);
    await page.evaluate(() => {
      const ctx = window.__snorewatch.audio.ctx;
      ctx.resume = window.__resume;
    });
    // The app keeps trying to resume on its own.
    await page.waitForFunction(() => !window.__snorewatch.audio.gap && window.__snorewatch.audio.gaps === 1, null, { timeout: 5000 });
    assert.doesNotMatch(await page.textContent('#status'), /interrupted/);
    await sleep(9000); // at least two snores after the gap, which cannot be confirmed by those before it
    await page.click('#rec');
    await page.waitForSelector('#report:not([hidden])');
    const demo = await page.evaluate(() => window.__snorewatch.summary());
    console.log(`  demo: ${demo.snoreCount} snores (${demo.possibleCount} possible) after ${demo.elapsed.toFixed(1)} s`);
    assert.ok(demo.snoreCount >= 1, 'demo produced snores');
    assert.match(await page.textContent('#report-range'), /interrupted 1×/);
    const [demoDl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-json')]);
    const demoJson = JSON.parse(fs.readFileSync(await demoDl.path(), 'utf8'));
    const gap = demoJson.interruptions[0];
    console.log(`  gap ${gap.seconds} s (${gap.reason}); ${demoJson.capturedSeconds} s analysed of ${demoJson.wallSeconds} s`);
    console.log(
      `  snores at ${demoJson.snores.map((x) => `${x.offsetSec} s${x.confirmed ? '' : ' (possible)'}`).join(', ')}; gap from ${gap.offsetSec} s`,
    );
    assert.ok(gap.seconds >= 2.5 && gap.seconds <= 6, `gap ${gap.seconds} s`);
    assert.ok(Math.abs(demoJson.wallSeconds - demoJson.capturedSeconds - gap.seconds) < 0.6, 'missing time is the gap, not silence');
    // Snores after the gap are timed on the night's clock, so the last ones lie beyond the analysed seconds.
    const lastSnore = Math.max(...demoJson.snores.map((x) => x.offsetSec));
    const gapAt = gap.offsetSec;
    if (lastSnore > gapAt) assert.ok(lastSnore >= gapAt + gap.seconds - 0.5, `snore at ${lastSnore} s after the gap at ${gapAt} s`);
    // No snore is confirmed by one on the other side of the gap.
    const sameSide = (a, b) => a.offsetSec < gapAt === b.offsetSec < gapAt;
    for (const x of demoJson.snores) {
      const partner = demoJson.snores.some(
        (y) => y !== x && sameSide(x, y) && Math.abs(x.offsetSec - y.offsetSec) >= 2 && Math.abs(x.offsetSec - y.offsetSec) <= 12,
      );
      assert.equal(
        x.confirmed,
        partner,
        `snore at ${x.offsetSec} s: ${JSON.stringify(demoJson.snores.map((y) => [y.offsetSec, y.durationSec, y.confirmed]))} gap ${gapAt}+${gap.seconds}`,
      );
    }

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
