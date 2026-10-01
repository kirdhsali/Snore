#!/usr/bin/env node
// Minimal static server so the microphone works (browsers require https or localhost).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const realRoot = fs.realpathSync(root);
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
};

// Only files inside the project are served, never hidden ones (.git, .github, …).
function resolve(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
  } catch {
    return { status: 400 };
  }
  if (pathname.includes('\0')) return { status: 400 };
  const file = path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { status: 403 };
  if (rel.split(path.sep).some((part) => part.startsWith('.'))) return { status: 404 };
  return { file };
}

const server = http.createServer((req, res) => {
  const { status, file } = resolve(req.url);
  if (status) {
    res.writeHead(status, { 'content-type': 'text/plain' }).end(status === 404 ? 'Not found' : 'Bad request');
    return;
  }
  fs.realpath(file, (err, real) => {
    // Symlinks may not lead outside the project either.
    if (err || path.relative(realRoot, real).startsWith('..')) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    fs.readFile(real, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

if (require.main === module) {
  // Only this computer can connect unless HOST is set, e.g. HOST=0.0.0.0 to test from a phone on the same network.
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Snorewatch running at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`));
}
module.exports = server;
module.exports.resolve = resolve;
