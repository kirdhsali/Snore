'use strict';
// Writes the exact in-room audio the detector hears for each labelled clip (Khan in a -80 dBFS room,
// ESC-50 in its benchmark room) at -50, -60 and -66 dBFS, plus the detector's verdict, so that
// inroom.py can let YAMNet judge the same audio. Run through inroom.sh (which deletes the audio).
//   node inroom.js <work dir>
const fs = require('fs');
const path = require('path');
const { app, DATA } = require('../common/paths.js');
const { readWav, inRoom } = require('../common/audio.js');
const { SnoreDetector, SessionStats } = app('detector.js');
const W = process.argv[2];
fs.mkdirSync(path.join(W, 'audio'), { recursive: true });
const K = path.join(DATA, 'datasets', 'khan', 'Snoring_Dataset_@16000');
const E = process.env.ESC50_DIR || path.join(DATA, 'esc-50');
const items = [];
for (const [label, folder] of [
  ['snore', 'snoring'],
  ['other', 'no_snoring'],
])
  for (const f of fs.readdirSync(path.join(K, folder)))
    items.push({ id: `khan_${folder}_${f}`, set: 'khan', label, file: path.join(K, folder, f), room: -80 });
for (const r of fs
  .readFileSync(path.join(E, 'meta', 'esc50.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => l.split(',')))
  items.push({
    id: `esc50_${r[0]}`,
    set: 'esc50',
    label: r[3] === 'snoring' ? 'snore' : 'other',
    cat: r[3],
    file: path.join(E, 'audio', r[0]),
    room: null,
  });
const meta = [];
items.forEach((it, i) => {
  const clip = readWav(it.file);
  for (const level of [-50, -60, -66]) {
    const audio = inRoom(clip, level, it.room, i + 1);
    const det = new SnoreDetector(clip.sr, { keepClips: false });
    const st = new SessionStats();
    [...det.process(audio), ...det.flush()].forEach((e) => st.add(e));
    const raw = `${it.id}_${-level}.f32`;
    fs.writeFileSync(path.join(W, 'audio', raw), Buffer.from(audio.buffer));
    meta.push({ id: it.id, set: it.set, label: it.label, cat: it.cat, level, sr: clip.sr, raw, detFound: st.snores.length > 0 });
  }
});
fs.writeFileSync(path.join(W, 'meta.json'), JSON.stringify(meta));
console.log(`${meta.length} pieces of in-room audio written`);
