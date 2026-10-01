'use strict';
// The review's server probe (evidence bundle of the v1.9.1 review), adapted: the
// original waits for the server to exit after a malformed URL, which no longer
// happens, so it now waits at most 2 s and then checks the server still answers.
// Usage: node docs/review-probes/server-probes-adapted.cjs "$PWD"
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const repo = process.argv[2] || path.resolve(__dirname, '../Snore-review');
const fixture = repo + '-review-fixture';
fs.mkdirSync(fixture, { recursive: true });
const marker = 'harmless-snore-review-marker';
fs.writeFileSync(path.join(fixture, 'marker.txt'), marker);
const child = spawn(
  process.execPath,
  [
    '-e',
    `const s=require(${JSON.stringify(path.join(repo, 'scripts/serve.js'))});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let stderr = '';
child.stderr.on('data', (c) => (stderr += c));
const request = (port, url) =>
  new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: url }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ error: e.code }));
  });
(async () => {
  const port = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(Number(String(d).trim()))));
  const traversal = await request(port, '/..%2f' + path.basename(fixture) + '/marker.txt');
  const metadata = await request(port, '/.git/HEAD');
  const closed = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const malformed = await request(port, '/%E0%A4%A');
  const exit = await Promise.race([closed, new Promise((r) => setTimeout(() => r('still running after 2 s'), 2000))]);
  const after = await request(port, '/index.html');
  child.kill();
  console.log(
    JSON.stringify(
      { traversal, metadata, malformed, exit, afterMalformed: after.status, crash: stderr.split('\n').slice(0, 7).join('\n') },
      null,
      2,
    ),
  );
  fs.rmSync(fixture, { recursive: true });
})().catch((e) => {
  child.kill();
  throw e;
});
