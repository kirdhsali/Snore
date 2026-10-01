'use strict';
// The local development server (npm start) must only serve the project's own public files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const server = require('../scripts/serve.js');

const root = path.resolve(__dirname, '..');

function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    // Raw request path, so nothing normalises it before the server sees it.
    const req = http.request({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('dev server serves project files and refuses everything else', async (t) => {
  // A sibling directory whose name starts with the project's name, as in the reported traversal.
  const sibling = root + '-servetest';
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'marker.txt'), 'outside');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    fs.rmSync(sibling, { recursive: true, force: true });
  });
  const port = server.address().port;
  const name = path.basename(root);

  const index = await get(port, '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /<html/i);
  assert.equal((await get(port, '/js/version.js')).status, 200);

  for (const p of [`/..%2F${name}-servetest/marker.txt`, `/../${name}-servetest/marker.txt`, `/%2e%2e/${name}-servetest/marker.txt`]) {
    const r = await get(port, p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.body, /outside/, p);
  }
  assert.equal((await get(port, '/.git/HEAD')).status, 404);
  assert.equal((await get(port, '/.github/workflows/ci.yml')).status, 404);
  assert.equal((await get(port, '/%E0%A4%A')).status, 400);
  // Still running after the malformed request.
  assert.equal((await get(port, '/index.html')).status, 200);
});
