#!/usr/bin/env node
// Writes samples/snore-demo.wav: the 90 s demo night (snores + distractors).
// Use it with "Audio file" mode, or play it from a phone next to your
// computer's microphone to test the real recording path.
'use strict';
const fs = require('fs');
const path = require('path');
const Synth = require('../js/synth.js');
const { encodeWav } = require('../js/detector.js');

function makeSampleWav(sampleRate = 16000, seed = 7) {
  const sc = Synth.demoScenario(sampleRate, seed);
  const pcm = Int16Array.from(sc.samples, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
  return { wav: Buffer.from(encodeWav([pcm], sampleRate)), truth: sc.truth };
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'samples', 'snore-demo.wav');
  const { wav, truth } = makeSampleWav();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, wav);
  const counts = truth.reduce((m, t) => ((m[t.type] = (m[t.type] || 0) + 1), m), {});
  console.log(`Wrote ${path.relative(process.cwd(), out)} (${(wav.length / 1e6).toFixed(1)} MB):`, counts);
}
module.exports = { makeSampleWav };
