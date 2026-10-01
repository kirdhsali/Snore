/*
 * Snorewatch WAV helpers: 16-bit mono WAV encoding and loudness evening for
 * playback. No browser dependencies (window.SnoreWav / require); js/detector.js
 * re-exports them as part of SnoreCore.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreWav = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Evens out clip volume for listening: scales the clip so its peak reaches
   * `targetPeak` (0..1), boosting by at most `maxGainDb`. Never turns it down.
   */
  function normalizeClip(clip, targetPeak = 0.7, maxGainDb = 60) {
    let peak = 1;
    for (let i = 0; i < clip.length; i++) peak = Math.max(peak, Math.abs(clip[i]));
    const gain = Math.min((targetPeak * 32767) / peak, Math.pow(10, maxGainDb / 20));
    if (gain <= 1) return clip;
    return Int16Array.from(clip, (x) => Math.max(-32768, Math.min(32767, Math.round(x * gain))));
  }

  /** 16-bit mono WAV from Int16 chunks, with `gapSec` of silence between them. */
  function encodeWav(chunks, sampleRate, gapSec = 0.4) {
    const rate = Math.round(sampleRate);
    const gap = Math.round(gapSec * rate);
    let samples = 0;
    chunks.forEach((c, i) => (samples += c.length + (i ? gap : 0)));
    const buf = new ArrayBuffer(44 + samples * 2);
    const v = new DataView(buf);
    const str = (off, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    v.setUint32(4, 36 + samples * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, samples * 2, true);
    let off = 44;
    chunks.forEach((c, i) => {
      if (i) off += gap * 2;
      for (let j = 0; j < c.length; j++, off += 2) v.setInt16(off, c[j], true);
    });
    return buf;
  }

  return { encodeWav, normalizeClip };
});
