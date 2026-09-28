#!/usr/bin/env node
// Inlines CSS and JS into one self-contained HTML file: dist/snorewatch.html.
// Pass --embed to build the variant for sandboxed previews (no microphone,
// no downloads) that starts in Demo mode.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const embed = process.argv.includes('--embed');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, href) => {
  return `<style>\n${fs.readFileSync(path.join(root, href), 'utf8')}</style>`;
});
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n${code}</script>`;
});
if (embed) {
  // The preview host adds its own document shell.
  html = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<\/?html[^>]*>\s*/gi, '')
    .replace(/<\/?head>\s*/gi, '')
    .replace(/<\/?body>\s*/gi, '')
    .replace(/<meta (charset|name="viewport")[^>]*>\s*/gi, '')
    .replace('<script>', '<script>window.SNOREWATCH_EMBED = true;</script>\n<script>');
}
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, embed ? 'snorewatch-embed.html' : 'snorewatch.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
