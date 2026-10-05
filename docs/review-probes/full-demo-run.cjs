// Full demo night in the browser, for checkpoint verification (added at 1.22.0).
// The original review's full-demo.cjs was not available any more; this replaces it.
// It plays the 90 s simulated night through #demo, waits for the report, saves the data
// file, the snores WAV, the test clips (if any), the shared report and image under the
// file names the app suggests, and prints the counts.
//
//   CHROMIUM_PATH=<chrome> node docs/review-probes/full-demo-run.cjs <repo dir> <output dir>
//
// Then: npm run evaluate -- <output dir>/<the saved snore-report_….json>
'use strict';
const fs = require('fs');
const path = require('path');

const repo = path.resolve(process.argv[2] || '.');
const out = path.resolve(process.argv[3] || 'demo-run');
const { chromium } = require(path.join(repo, 'node_modules', 'playwright'));
const server = require(path.join(repo, 'scripts', 'serve.js'));

async function save(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const file = path.join(out, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/#demo`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const pageErrors = [];
  const consoleErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    await page.goto(url);
    await page.click('#rec');
    await page.waitForSelector('#report:not([hidden])', { timeout: 180000 });
    await page.waitForSelector('#share-report:not([disabled])', { timeout: 20000 });
    const files = { json: await save(page, '#dl-json'), wav: await save(page, '#dl-wav') };
    if (await page.isVisible('#dl-test-wav')) files.testWav = await save(page, '#dl-test-wav');
    files.report = await save(page, '#share-report');
    files.image = await save(page, '#share-image');
    const r = JSON.parse(fs.readFileSync(files.json, 'utf8'));
    const summary = {
      version: r.version,
      schemaVersion: r.schemaVersion,
      source: r.source,
      sensitivity: r.sensitivity,
      minBreathRiseDb: r.minBreathRiseDb,
      snoreCount: r.summary.snoreCount,
      possibleCount: r.summary.possibleCount,
      ignoredByReason: r.summary.ignoredByReason,
      shadows: Object.fromEntries(Object.entries(r.shadows).map(([k, s]) => [k, s.summary.snoreCount])),
      noiseMinutes: r.noise ? r.noise.minutes.length : null,
      interruptions: r.interruptions.length,
      files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, `${path.basename(f)} (${fs.statSync(f).size} bytes)`])),
      verdict: await page.textContent('#verdict'),
      pageErrors,
      consoleErrors,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
