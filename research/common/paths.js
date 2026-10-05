'use strict';
// Where the research scripts find the app's code and keep downloaded data and results.
// Data and results never go into the repository: they live under SNOREWATCH_DATA
// (default ~/.cache/snorewatch), next to the ESC-50 checkout of `npm run eval:public`.
const os = require('os');
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const DATA = process.env.SNOREWATCH_DATA || path.join(os.homedir(), '.cache', 'snorewatch');

/** A folder under the data directory, created when missing. */
function dataDir(...parts) {
  const dir = path.join(DATA, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The app's own modules (the detector exactly as the page runs it). */
const app = (name) => require(path.join(REPO, 'js', name));

module.exports = { REPO, DATA, dataDir, app };
