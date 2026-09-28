/* Canvas drawing for the live strip, the timeline and clip waveforms. */
(function (root) {
  'use strict';

  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /** Column with a 4px rounded top, square at the baseline. */
  function column(ctx, x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Scrolling loudness strip. `frames` holds {db, trigger, cls} with cls
   * q = quiet, p = sound being judged, s = snore, i = ignored.
   */
  function drawLive(canvas, frames, capacity, seconds) {
    const { ctx, w, h } = setup(canvas);
    const colors = { q: token('--quiet'), p: token('--pending'), s: token('--snore'), i: token('--ignored') };
    const padB = 16;
    const plotH = h - padB - 4;
    const last = frames[frames.length - 1];
    const ref = last && last.trigger != null ? last.trigger : -60;
    const lo = ref - 14;
    const hi = ref + 36;
    const y = (db) => 4 + plotH * (1 - Math.min(1, Math.max(0, (db - lo) / (hi - lo))));
    const step = w / capacity;
    const x0 = w - frames.length * step;

    ctx.strokeStyle = token('--line');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 4 + plotH + 0.5);
    ctx.lineTo(w, 4 + plotH + 0.5);
    ctx.stroke();

    const bw = Math.max(1, step - (step > 3 ? 1 : 0));
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const top = y(f.db);
      const bh = 4 + plotH - top;
      if (bh <= 0) continue;
      ctx.fillStyle = colors[f.cls] || colors.q;
      ctx.fillRect(x0 + i * step, top, bw, bh);
    }

    // Trigger level
    ctx.strokeStyle = token('--fg-2');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].trigger == null) continue;
      const px = x0 + i * step;
      const py = y(frames[i].trigger);
      if (!started) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      started = true;
    }
    ctx.stroke();

    ctx.fillStyle = token('--muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(`−${seconds} s`, 0, h - 2);
    ctx.textAlign = 'right';
    ctx.fillText('now', w, h - 2);
  }

  /** Smallest round axis maximum >= v that splits into 4 whole-number ticks. */
  function niceMax(v) {
    if (v <= 4) return 4;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 4, 6, 8, 10]) {
      const c = m * mag;
      if (c >= v && c % 4 === 0) return c;
    }
    return 20 * mag;
  }

  /**
   * Snores per time bucket. Returns the geometry the hover handler needs.
   * `label(bucketIndex)` formats x-axis labels.
   */
  function drawTimeline(canvas, buckets, label, hover = -1) {
    const { ctx, w, h } = setup(canvas);
    const padL = 30;
    const padR = 6;
    const padT = 10;
    const padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const max = niceMax(buckets.reduce((m, b) => Math.max(m, b.count), 0));
    const y = (v) => padT + plotH * (1 - v / max);

    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (max / ticks) * i;
      const py = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = i === 0 ? token('--line-strong') : token('--line');
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(w - padR, py);
      ctx.stroke();
      ctx.fillStyle = token('--muted');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v), padL - 8, py);
    }

    const slot = plotW / buckets.length;
    const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0;
    const bw = Math.max(1, Math.min(24, slot - gap));
    const snore = token('--snore');
    buckets.forEach((b, i) => {
      if (!b.count) return;
      const x = padL + i * slot + (slot - bw) / 2;
      ctx.globalAlpha = hover >= 0 && hover !== i ? 0.45 : 1;
      ctx.fillStyle = snore;
      column(ctx, x, y(b.count), bw, y(0) - y(b.count));
    });
    ctx.globalAlpha = 1;

    // x labels, spaced so they never collide
    ctx.fillStyle = token('--muted');
    ctx.textBaseline = 'alphabetic';
    const every = Math.max(1, Math.ceil(64 / slot));
    for (let i = 0; i < buckets.length; i += every) {
      const x = padL + i * slot;
      ctx.textAlign = i === 0 ? 'left' : 'center';
      if (x + 30 > w) break;
      ctx.fillText(label(i), x, h - 5);
    }

    if (!buckets.some((b) => b.count)) {
      ctx.fillStyle = token('--muted');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('No snores yet', padL + plotW / 2, padT + plotH / 2);
    }
    return { padL, slot, count: buckets.length, width: w };
  }

  /** Min/max waveform of an Int16 clip. */
  function drawClip(canvas, clip) {
    const { ctx, w, h } = setup(canvas);
    ctx.fillStyle = token('--snore');
    const mid = h / 2;
    const per = Math.max(1, Math.floor(clip.length / w));
    let peak = 1;
    for (let i = 0; i < clip.length; i++) peak = Math.max(peak, Math.abs(clip[i]));
    for (let x = 0; x < w; x++) {
      let mn = 0;
      let mx = 0;
      const a = Math.floor((x / w) * clip.length);
      for (let i = a; i < a + per && i < clip.length; i++) {
        if (clip[i] < mn) mn = clip[i];
        if (clip[i] > mx) mx = clip[i];
      }
      const top = mid - (mx / peak) * (mid - 1);
      const bot = mid - (mn / peak) * (mid - 1);
      ctx.fillRect(x, top, 1, Math.max(1, bot - top));
    }
  }

  root.SnoreCharts = { drawLive, drawTimeline, drawClip };
})(typeof self !== 'undefined' ? self : this);
