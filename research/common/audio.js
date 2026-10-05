'use strict';
// File readers for the research scripts: WAV (16-bit PCM), one-column CSV signals, APSAA
// annotations and EDF recordings (read one 1 s record at a time), plus the quiet-room placement
// used for single clips. Node only; no dependencies.
const fs = require('fs');
const { app } = require('./paths.js');

/** 16-bit PCM WAV as mono Float32 (channels averaged). */
function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') {
      data = b.subarray(off + 8, off + 8 + size);
      break;
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`${file}: not a 16-bit PCM WAV`);
  const n = Math.floor(data.length / 2 / fmt.ch);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2);
    x[i] = s / fmt.ch / 32768;
  }
  return { sr: fmt.sr, x };
}

/** A CSV with a header line and one number per line (APSAA polygraph signals). */
function readSignal(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = new Float64Array(lines.length);
  let n = 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() !== '') out[n++] = Number(lines[i]);
  return out.subarray(0, n);
}

/** APSAA annotations: Event_Name,Start_Time (hh:mm:ss),Duration (s). */
function readAnnotations(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const [name, t, d] = l.split(',');
      const [h, m, s] = t.split(':').map(Number);
      return { name, start: h * 3600 + m * 60 + s, dur: Number(d) };
    });
}

/** EDF header: labels, samples per record, scaling to physical units. */
function edfHeader(fd) {
  const h = Buffer.alloc(256);
  fs.readSync(fd, h, 0, 256, 0);
  const ns = Number(h.toString('latin1', 252, 256));
  const nrec = Number(h.toString('latin1', 236, 244));
  const recSec = Number(h.toString('latin1', 244, 252));
  if (!(ns > 0) || !(nrec > 0)) throw new Error('not an EDF file');
  const hh = Buffer.alloc(ns * 256);
  fs.readSync(fd, hh, 0, ns * 256, 256);
  const field = (off, w) => Array.from({ length: ns }, (_, i) => hh.toString('latin1', off + i * w, off + (i + 1) * w).trim());
  let o = 0;
  const labels = field(o, 16);
  o += (16 + 80 + 8) * ns;
  const pmin = field(o, 8).map(Number);
  o += 8 * ns;
  const pmax = field(o, 8).map(Number);
  o += 8 * ns;
  const dmin = field(o, 8).map(Number);
  o += 8 * ns;
  const dmax = field(o, 8).map(Number);
  o += 8 * ns + 80 * ns;
  const spr = field(o, 8).map(Number);
  const gain = pmax.map((p, i) => (p - pmin[i]) / (dmax[i] - dmin[i]));
  return { ns, nrec, recSec, labels, spr, gain, offset: pmin.map((p, i) => p - dmin[i] * gain[i]), dataStart: 256 + ns * 256 };
}

/** Calls onRecord({label: Float32Array}) for each record of an EDF file, for the labels asked for. */
function readEdf(file, wanted, onRecord) {
  const fd = fs.openSync(file, 'r');
  try {
    const H = edfHeader(fd);
    const idx = wanted.map((w) => {
      const i = H.labels.indexOf(w);
      if (i < 0) throw new Error(`${file}: no signal ${w} (has ${H.labels.join(', ')})`);
      return i;
    });
    const starts = [];
    let bytes = 0;
    for (const n of H.spr) (starts.push(bytes), (bytes += n * 2));
    const buf = Buffer.alloc(bytes);
    for (let r = 0; r < H.nrec; r++) {
      if (fs.readSync(fd, buf, 0, bytes, H.dataStart + r * bytes) < bytes) break;
      const rec = {};
      wanted.forEach((w, k) => {
        const i = idx[k];
        const x = new Float32Array(H.spr[i]);
        for (let j = 0; j < x.length; j++) x[j] = buf.readInt16LE(starts[i] + 2 * j) * H.gain[i] + H.offset[i];
        rec[w] = x;
      });
      onRecord(rec, r);
    }
    return H;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * A single clip in a quiet room: 3 s of synthetic room noise at `roomDb` dBFS, the clip faded in
 * and out over 0.1 s with its loudest 50 ms at `peakDb` dBFS, 3 s of room. roomDb null: the ESC-50
 * benchmark's room instead (the clip's own quietest 10 %, at least -80 dBFS; scripts/eval-public.js).
 */
function inRoom({ sr, x }, peakDb, roomDb, seed) {
  const Synth = app('synth.js');
  const win = Math.round(sr * 0.05);
  const frames = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let q = 0;
    for (let j = i; j < i + win; j++) q += x[j] * x[j];
    frames.push(Math.sqrt(q / win));
  }
  const peak = Math.max(...frames);
  const gain = peak > 0 ? Math.pow(10, peakDb / 20) / peak : 0;
  frames.sort((a, b) => a - b);
  const level =
    roomDb == null ? Math.max(Math.pow(10, -80 / 20), frames[Math.floor(frames.length * 0.1)] * gain) : Math.pow(10, roomDb / 20);
  const lead = Math.round(sr * 3);
  const room = Synth.roomNoise(sr, lead * 2 + x.length, 1, Synth.rng(seed));
  let rms = 0;
  for (const v of room) rms += v * v;
  rms = Math.sqrt(rms / room.length);
  for (let i = 0; i < room.length; i++) room[i] *= level / rms;
  const fade = Math.round(sr * 0.1);
  for (let i = 0; i < x.length; i++) {
    const f = Math.min(1, i / fade, (x.length - 1 - i) / fade);
    room[lead + i] = room[lead + i] * (1 - 0.7 * f) + x[i] * gain * f;
  }
  return room;
}

module.exports = { readWav, readSignal, readAnnotations, edfHeader, readEdf, inRoom };
