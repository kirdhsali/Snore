#!/usr/bin/env node
// Minimal static server so the microphone works (browsers require https or localhost).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(port, () => console.log(`Snorewatch running at http://localhost:${port}`));
}
module.exports = server;
