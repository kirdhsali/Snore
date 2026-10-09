/*
 * Snorewatch sharing: the "night sky" share image and the self-contained
 * report file.
 *
 * drawShareCard() paints a 1080 x 1350 image on a canvas: every snore is a
 * star, placed by time (x) and loudness above room noise (y).
 * buildReportHtml() returns one HTML document with no scripts: charts are
 * inline SVG, a few snores are embedded as WAV audio, so it opens and plays
 * in any browser, offline. It runs in Node too, which the tests use.
 */
(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./detector.js') : root.SnoreCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreShare = api;
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const CARD_W = 1080;
  const CARD_H = 1350;
  const DISPLAY = '"Bricolage Grotesque", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const INK = {
    top: '#090b15',
    bottom: '#171c33',
    fg: '#eef0f6',
    fg2: '#aab1c6',
    muted: '#6f7690',
    line: 'rgba(255, 255, 255, 0.08)',
    snore: '#ff7a3d',
    moon: '#c9d2ff',
  };

  // ---------- formatting ----------
  function fmtSpan(sec) {
    sec = Math.round(sec);
    if (sec < 60) return `${sec} s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (!h) return `${m} min${sec % 60 ? ` ${sec % 60} s` : ''}`;
    return `${h} h ${m} min`;
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    return `${m}:${String(sec % 60).padStart(2, '0')}`;
  }
  function fmtTime(ms, seconds) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });
  }
  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function round(v, d = 0) {
    return Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  }

  // ---------- shared data ----------

  /** Time axis ticks: [{t (seconds from start), label}], clock-aligned for long nights. */
  function timeTicks(startWall, elapsed) {
    const steps = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    const step = steps.find((s) => elapsed / s <= 8) || 7200;
    const ticks = [];
    if (elapsed >= 3600) {
      const first = new Date(startWall);
      first.setSeconds(0, 0);
      const stepMin = step / 60;
      first.setMinutes(Math.ceil(first.getMinutes() / stepMin) * stepMin);
      for (let ms = first.getTime(); ms <= startWall + elapsed * 1000; ms += step * 1000) {
        ticks.push({ t: (ms - startWall) / 1000, label: fmtTime(ms) });
      }
    } else {
      for (let t = 0; t <= elapsed; t += step) ticks.push({ t, label: fmtClock(t) });
    }
    return ticks;
  }

  /**
   * What was actually recorded. `elapsed` is the night on its clock (start to end);
   * `captured` the analysed time and `gaps` the interruptions ({start, end} in
   * seconds on that clock). Older callers pass neither: the night was continuous.
   */
  function coverage(d) {
    const gaps = d.gaps || [];
    const captured = d.captured == null ? d.elapsed : d.captured;
    const parts = gaps.length
      ? [`${fmtSpan(captured)} of ${fmtSpan(d.elapsed)} recorded`, `interrupted ${gaps.length}×`]
      : [fmtSpan(d.elapsed)];
    return { gaps, captured, span: parts.join(' · '), parts };
  }

  /** The busiest half hour (or tenth of a short session): {start, end, count}. */
  function busiest(snores, elapsed) {
    if (!snores.length) return null;
    const size = elapsed >= 3600 ? 1800 : Math.max(10, Math.ceil(elapsed / 10));
    const counts = new Map();
    for (const s of snores) {
      const b = Math.floor(s.start / size);
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    let best = null;
    for (const [b, n] of counts) if (!best || n > best.count) best = { start: b * size, end: (b + 1) * size, count: n };
    return best;
  }

  /** Loudest `nLoud` snores with audio, plus `nRandom` others picked at random, in time order. */
  function pickSamples(snores, nLoud = 8, nRandom = 5, rand = Math.random) {
    const withClip = snores.filter((s) => s.clip && s.clip.length);
    const loud = withClip
      .slice()
      .sort((a, b) => b.relDb - a.relDb)
      .slice(0, nLoud);
    const rest = withClip.filter((s) => !loud.includes(s));
    const random = [];
    while (random.length < nRandom && rest.length) random.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
    const byTime = (a, b) => a.start - b.start;
    return { loud: loud.sort(byTime), random: random.sort(byTime) };
  }

  // ---------- share image ----------

  /** Small deterministic PRNG so a night always gets the same sky. */
  function prng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
      a ^= a << 13;
      a ^= a >>> 17;
      a ^= a << 5;
      return (a >>> 0) / 4294967296;
    };
  }

  function mixColor(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
  }

  /** Moon disc minus an offset disc, clipped to the moon so the sky stays untouched. */
  function crescent(ctx, x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.45, y - r * 0.3, r * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = INK.moon;
    ctx.fill('evenodd');
    ctx.restore();
  }

  /** Joins `parts` with " · " into as few lines as fit in `maxWidth` (at the context's font). */
  function wrapParts(ctx, parts, maxWidth) {
    const lines = [];
    for (const part of parts) {
      const joined = lines.length ? `${lines[lines.length - 1]} · ${part}` : part;
      if (lines.length && ctx.measureText(joined).width <= maxWidth) lines[lines.length - 1] = joined;
      else lines.push(part);
    }
    return lines;
  }

  /**
   * Paints the share image.
   * d: { startWall, elapsed, captured, gaps (see coverage), snores: [{start, duration, relDb, score}], summary,
   *      version, sensitivity }
   */
  function drawShareCard(canvas, d) {
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    const sum = d.summary;
    const cov = coverage(d);
    const pad = 72;

    const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
    bg.addColorStop(0, INK.top);
    bg.addColorStop(1, INK.bottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Plot area
    const plot = { x: 150, y: 560, w: CARD_W - 150 - pad, h: 420 };
    // Areas where decorative stars would sit on text or be mistaken for data: [x0, y0, x1, y1]
    const keepClear = [
      [plot.x - 110, plot.y - 30, plot.x + plot.w + 20, plot.y + plot.h + 100],
      [pad - 10, 60, CARD_W - pad + 10, 215],
      [pad - 10, 200, 760, 470],
      [pad - 10, 1090, CARD_W - pad + 10, CARD_H - 20],
    ];
    const clear = (x, y) => keepClear.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);

    // Decorative background stars, only in empty sky so they never read as data.
    const rand = prng(Math.floor(d.startWall / 1000));
    for (let i = 0; i < 180; i++) {
      const x = rand() * CARD_W;
      const y = rand() * CARD_H;
      if (clear(x, y)) continue;
      ctx.fillStyle = `rgba(220, 228, 255, ${0.06 + rand() * 0.22})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.6 + rand() * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Header
    crescent(ctx, pad + 16, 92, 16);
    ctx.fillStyle = INK.fg;
    ctx.font = `700 34px ${DISPLAY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Snorewatch', pad + 46, 94);
    ctx.fillStyle = INK.fg2;
    ctx.font = `400 28px ${BODY}`;
    ctx.textAlign = 'right';
    ctx.fillText(fmtDate(d.startWall), CARD_W - pad, 94);

    ctx.textAlign = 'left';
    // Times and coverage; a long night with interruptions (AM/PM times) takes a second line.
    const header = [`${fmtTime(d.startWall)} – ${fmtTime(d.startWall + d.elapsed * 1000)}`, ...cov.parts];
    wrapParts(ctx, header, CARD_W - 2 * pad).forEach((text, i) => ctx.fillText(text, pad, 160 + i * 38, CARD_W - 2 * pad));

    // Hero number: the short-recording wording depends on the time actually recorded
    const shortSession = cov.captured < 600;
    const hero = shortSession ? String(sum.snoreCount) : round(sum.snoresPerHour);
    ctx.fillStyle = INK.fg;
    ctx.font = `700 190px ${DISPLAY}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(hero, pad - 6, 380);
    const heroW = ctx.measureText(hero).width;
    ctx.font = `500 40px ${DISPLAY}`;
    ctx.fillText(shortSession ? (sum.snoreCount === 1 ? 'snore' : 'snores') : 'snores', pad + heroW + 24, 318);
    ctx.fillStyle = INK.fg2;
    ctx.fillText(shortSession ? `in ${fmtSpan(cov.captured)}` : 'per hour', pad + heroW + 24, 368);

    const peak = busiest(d.snores, d.elapsed);
    ctx.font = `400 28px ${BODY}`;
    ctx.fillStyle = INK.fg2;
    const line = [
      shortSession ? null : `${sum.snoreCount} snores`,
      peak
        ? `busiest ${d.elapsed >= 3600 ? `${fmtTime(d.startWall + peak.start * 1000)}–${fmtTime(d.startWall + peak.end * 1000)}` : `${fmtClock(peak.start)}–${fmtClock(peak.end)}`}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (line) ctx.fillText(line, pad, 448);

    // Chart grid: loudness above room noise
    const maxDb = Math.max(30, Math.ceil(Math.max(0, ...d.snores.map((s) => s.relDb)) / 10) * 10);
    const yOf = (db) => plot.y + plot.h * (1 - Math.min(1, Math.max(0, db) / maxDb));
    const xOf = (t) => plot.x + plot.w * Math.min(1, Math.max(0, t / Math.max(1, d.elapsed)));
    ctx.font = `400 22px ${BODY}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let db = 0; db <= maxDb; db += 10) {
      const y = Math.round(yOf(db)) + 0.5;
      ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.18)' : INK.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      ctx.fillStyle = INK.muted;
      if (db > 0) ctx.fillText(`+${db} dB`, plot.x - 16, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = timeTicks(d.startWall, d.elapsed);
    let lastRight = -Infinity;
    for (const tk of ticks) {
      const x = xOf(tk.t);
      const w = ctx.measureText(tk.label).width;
      if (x - w / 2 < lastRight + 16 || x + w / 2 > CARD_W - 20) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(Math.round(x), plot.y + plot.h, 1, 8);
      ctx.fillStyle = INK.muted;
      ctx.fillText(tk.label, x, plot.y + plot.h + 16);
      lastRight = x + w / 2;
    }

    // Interruptions: hatched, so a missing stretch never reads as a quiet one
    for (const g of cov.gaps) {
      const x0 = xOf(g.start);
      const x1 = Math.max(x0 + 2, xOf(g.end));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, plot.y, x1 - x0, plot.h);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x0, plot.y, x1 - x0, plot.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      for (let x = x0 - plot.h; x < x1; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, plot.y + plot.h);
        ctx.lineTo(x + plot.h, plot.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Snoring episodes: faint nebula bands with a solid foot on the baseline
    for (const ep of sum.episodes) {
      const x0 = xOf(ep.start);
      const x1 = Math.max(x0 + 3, xOf(ep.end));
      const g = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
      g.addColorStop(0, 'rgba(255,122,61,0)');
      g.addColorStop(1, 'rgba(255,122,61,0.16)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, plot.y, x1 - x0, plot.h);
      ctx.fillStyle = 'rgba(255,122,61,0.55)';
      ctx.fillRect(x0, plot.y + plot.h - 4, x1 - x0, 4);
    }

    // Stars: louder snores are brighter and whiter, longer ones bigger
    const stars = d.snores.slice().sort((a, b) => a.relDb - b.relDb);
    for (const s of stars) {
      const x = xOf(s.start);
      const y = yOf(s.relDb);
      const loud = Math.min(1, Math.max(0, s.relDb / maxDb));
      const r = 3 + 4 * Math.min(1, s.duration / 2);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, s.score || 1);
      ctx.shadowColor = INK.snore;
      ctx.shadowBlur = 6 + 16 * loud;
      ctx.fillStyle = mixColor(INK.snore, '#fff3e6', loud * loud);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (!d.snores.length) {
      ctx.fillStyle = INK.fg2;
      ctx.font = `500 34px ${DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A quiet night. No snores detected.', plot.x + plot.w / 2, plot.y + plot.h / 2);
    }

    // Legend
    const ly = plot.y + plot.h + 76;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `400 22px ${BODY}`;
    ctx.save();
    ctx.shadowColor = INK.snore;
    ctx.shadowBlur = 10;
    ctx.fillStyle = INK.snore;
    ctx.beginPath();
    ctx.arc(pad + 8, ly, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = INK.fg2;
    ctx.fillText('one snore, higher = louder', pad + 24, ly);
    const lx = pad + 24 + ctx.measureText('one snore, higher = louder').width + 40;
    ctx.fillStyle = 'rgba(255,122,61,0.55)';
    ctx.fillRect(lx, ly - 2, 28, 4);
    ctx.fillStyle = INK.fg2;
    ctx.fillText('snoring episode', lx + 40, ly);
    if (cov.gaps.length) {
      const gx = lx + 40 + ctx.measureText('snoring episode').width + 40;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(gx, ly - 10, 28, 20);
      ctx.fillStyle = INK.fg2;
      ctx.fillText('not recorded', gx + 40, ly);
    }

    // Key figures
    const tiles = [
      ['Snores', round(sum.snoreCount), sum.possibleCount ? `+${round(sum.possibleCount)} possible` : 'in breathing rhythm'],
      ['Snoring time', fmtSpan(sum.snoreSeconds), `${round(sum.snorePercent, 1)}% of the recording`],
      ['Loudest', sum.snoreCount ? `+${round(sum.maxRelDb)} dB` : '–', 'above room noise'],
      ['Episodes', round(sum.episodes.length), sum.longestEpisode ? `longest ${fmtSpan(sum.longestEpisode)}` : ''],
    ];
    const gap = 20;
    const tw = (CARD_W - 2 * pad - 3 * gap) / 4;
    const ty = 1110;
    tiles.forEach(([label, value, note], i) => {
      const x = pad + i * (tw + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, ty, tw, 136, 16) : ctx.rect(x, ty, tw, 136);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = INK.muted;
      ctx.font = `400 22px ${BODY}`;
      ctx.fillText(label, x + 20, ty + 38);
      ctx.fillStyle = INK.fg;
      ctx.font = `700 40px ${DISPLAY}`;
      if (ctx.measureText(value).width > tw - 36) ctx.font = `700 32px ${DISPLAY}`;
      ctx.fillText(value, x + 20, ty + 88);
      ctx.fillStyle = INK.fg2;
      ctx.font = `400 19px ${BODY}`;
      if (note) ctx.fillText(note, x + 20, ty + 118);
    });

    // Footer
    ctx.font = `400 20px ${BODY}`;
    ctx.fillStyle = INK.muted;
    ctx.textAlign = 'left';
    ctx.fillText(`Snorewatch ${d.version} · sensitivity ${d.sensitivity}`, pad, CARD_H - 42);
    ctx.textAlign = 'right';
    ctx.fillText('Estimate from sound. Not a medical diagnosis.', CARD_W - pad, CARD_H - 42);
    return canvas;
  }

  // ---------- report file ----------

  function base64(buffer) {
    const bytes = new Uint8Array(buffer);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function clipDataUri(s) {
    return `data:audio/wav;base64,${base64(Core.encodeWav([s.clip], s.clipRate, 0))}`;
  }

  /** SVG waveform (min/max envelope) of an Int16 clip. */
  function waveSvg(clip, w = 240, h = 44) {
    const cols = 80;
    let peak = 1;
    for (let i = 0; i < clip.length; i++) peak = Math.max(peak, Math.abs(clip[i]));
    const top = [];
    const bot = [];
    for (let c = 0; c < cols; c++) {
      const a = Math.floor((c / cols) * clip.length);
      const b = Math.max(a + 1, Math.floor(((c + 1) / cols) * clip.length));
      let mn = 0;
      let mx = 0;
      for (let i = a; i < b; i++) {
        if (clip[i] < mn) mn = clip[i];
        if (clip[i] > mx) mx = clip[i];
      }
      const x = ((c + 0.5) / cols) * w;
      top.push(`${x.toFixed(1)},${(h / 2 - (mx / peak) * (h / 2 - 1)).toFixed(1)}`);
      bot.push(`${x.toFixed(1)},${(h / 2 - (mn / peak) * (h / 2 - 1) + 0.5).toFixed(1)}`);
    }
    return `<svg class="wave" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${top.join(' ')} ${bot
      .reverse()
      .join(' ')}"/></svg>`;
  }

  /** Snores-per-slot column chart as inline SVG. */
  function timelineSvg(d) {
    const sizes = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const size = sizes.find((b) => d.elapsed / b <= 48) || 3600;
    const n = Math.max(1, Math.ceil(d.elapsed / size));
    const counts = new Array(n).fill(0);
    for (const s of d.snores) counts[Math.min(n - 1, Math.floor(s.start / size))]++;
    const W = 720;
    const H = 200;
    const pl = 34;
    const pb = 24;
    const pt = 8;
    const ph = H - pb - pt;
    const max = Math.max(4, Math.ceil(Math.max(...counts) / 4) * 4);
    const slot = (W - pl) / n;
    const bw = Math.max(1, Math.min(24, slot - 2));
    let out = `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Snores per ${esc(fmtSpan(size))}">`;
    const xAt = (t) => pl + ((W - pl) * Math.min(Math.max(t, 0), d.elapsed)) / Math.max(1, d.elapsed);
    for (const g of d.gaps || []) {
      const x0 = xAt(g.start);
      const w = Math.max(1, xAt(g.end) - x0);
      out += `<rect class="gap" x="${x0.toFixed(1)}" y="${pt}" width="${w.toFixed(1)}" height="${ph}"><title>not recorded</title></rect>`;
    }
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = (pt + ph * (1 - v / max)).toFixed(1);
      out += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" class="${i ? 'grid' : 'base'}"/><text x="${pl - 6}" y="${y}" class="ytick">${v}</text>`;
    }
    counts.forEach((c, i) => {
      if (!c) return;
      const x = pl + i * slot + (slot - bw) / 2;
      const h = (ph * c) / max;
      const y = pt + ph - h;
      const r = Math.min(4, bw / 2, h);
      out += `<path class="bar" d="M${x.toFixed(1)},${(pt + ph).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(
        x + r
      ).toFixed(
        1,
      )},${y.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)},${y.toFixed(1)} ${(x + bw).toFixed(1)},${(y + r).toFixed(1)}V${(
        pt + ph
      ).toFixed(1)}Z"><title>${c} snore${c === 1 ? '' : 's'}</title></path>`;
    });
    let lastRight = -Infinity;
    for (const tk of timeTicks(d.startWall, d.elapsed)) {
      const x = pl + ((W - pl) * tk.t) / Math.max(1, d.elapsed);
      if (x - 20 < lastRight || x > W - 18) continue;
      out += `<text x="${x.toFixed(1)}" y="${H - 6}" class="xtick">${esc(tk.label)}</text>`;
      lastRight = x + 20;
    }
    return { svg: `${out}</svg>`, size };
  }

  /**
   * The room's noise over the night as a heatmap: one row per octave band (lowest at
   * the bottom), each minute shaded by how far that band sat above its own quiet level
   * (its 10th percentile over the night; full colour at 15 dB), the background level as
   * a line under it, snores as ticks and clock times along the bottom. Script-free SVG,
   * shown in the app and in the report file.
   * d: { startWall, elapsed, gaps, snores, noise: {minuteSec, bandsHz, minutes: [{t, backgroundDb, bandsDb}]},
   *      noiseBands (Hz to show; default all) }
   * `width`: drawing units across; the app passes the panel's width in pixels so the labels keep their size.
   */
  function noiseSvg(d, width = 720) {
    const noise = d.noise;
    const minuteSec = noise.minuteSec || 60;
    const minutes = noise.minutes || [];
    const rows = (d.noiseBands || noise.bandsHz).map((hz) => noise.bandsHz.indexOf(hz)).filter((i) => i >= 0);
    const W = Math.max(200, Math.round(width));
    const pl = 50;
    const pt = 4;
    const rowH = 16;
    const heatH = rows.length * rowH;
    const levelTop = pt + heatH + 8;
    const levelH = 28;
    const tickTop = levelTop + levelH + 6;
    const H = tickTop + 9 + 22;
    const xAt = (t) => pl + ((W - pl) * Math.min(Math.max(t, 0), d.elapsed)) / Math.max(1, d.elapsed);
    let out = `<svg class="noise" viewBox="0 0 ${W} ${H}" role="img" aria-label="Room noise by pitch over the night">`;
    out += `<rect class="heat-bg" x="${pl}" y="${pt}" width="${W - pl}" height="${heatH}"/>`;
    rows.forEach((b, r) => {
      const vals = minutes
        .map((m) => (m.bandsDb ? m.bandsDb[b] : null))
        .filter((v) => v != null)
        .sort((p, q) => p - q);
      const y = pt + (rows.length - 1 - r) * rowH;
      const hz = noise.bandsHz[b];
      out += `<text x="${pl - 6}" y="${y + rowH / 2}" class="ytick">${hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`}</text>`;
      if (!vals.length) return;
      const quiet = vals[Math.floor(vals.length * 0.1)];
      // Shades in eighths; neighbouring minutes with the same shade become one rectangle.
      let run = null;
      const flush = () => {
        if (run && run.k)
          out += `<rect class="cell" x="${xAt(run.from).toFixed(1)}" y="${y}" width="${Math.max(0.5, xAt(run.to) - xAt(run.from)).toFixed(
            1,
          )}" height="${rowH - 1}" fill-opacity="${run.k / 8}"/>`;
        run = null;
      };
      for (const m of minutes) {
        const v = m.bandsDb ? m.bandsDb[b] : null;
        const k = v == null ? 0 : Math.max(0, Math.min(8, Math.round(((v - quiet) / 15) * 8)));
        if (run && run.k === k && Math.abs(run.to - m.t) < 1) run.to = m.t + minuteSec;
        else {
          flush();
          run = { k, from: m.t, to: m.t + minuteSec };
        }
      }
      flush();
    });
    // The background level, scaled to the night's own range (at least 6 dB); broken where minutes are missing.
    const bgs = minutes.filter((m) => m.backgroundDb != null);
    if (bgs.length) {
      const lo = Math.min(...bgs.map((m) => m.backgroundDb));
      const hi = Math.max(lo + 6, ...bgs.map((m) => m.backgroundDb));
      let path = '';
      let prev = null;
      for (const m of bgs) {
        const x = xAt(m.t + minuteSec / 2);
        const y = levelTop + levelH - ((m.backgroundDb - lo) / (hi - lo)) * levelH;
        path += `${prev != null && m.t - prev <= minuteSec + 1 ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
        prev = m.t;
      }
      out += `<path class="level" d="${path}"/><text x="${pl - 6}" y="${levelTop + levelH / 2}" class="ytick">level</text>`;
    }
    for (const g of d.gaps || []) {
      const x0 = xAt(g.start);
      out += `<rect class="gap" x="${x0.toFixed(1)}" y="${pt}" width="${Math.max(1, xAt(g.end) - x0).toFixed(1)}" height="${
        levelTop + levelH - pt
      }"><title>not recorded</title></rect>`;
    }
    // Snores: one tick per pixel column at most.
    const cols = new Set((d.snores || []).map((x) => Math.round(xAt(x.start))));
    for (const x of cols) out += `<rect class="tick" x="${x - 0.75}" y="${tickTop}" width="1.5" height="9"/>`;
    let lastRight = -Infinity;
    for (const tk of timeTicks(d.startWall, d.elapsed)) {
      const x = xAt(tk.t);
      const half = tk.label.length * 3.3 + 4; // about half the label's width at 11 px
      if (x - half < lastRight || x < pl || x + half > W) continue;
      out += `<line class="grid" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pt}" y2="${pt + heatH}"/><text x="${x.toFixed(1)}" y="${
        H - 6
      }" class="xtick">${esc(tk.label)}</text>`;
      lastRight = x + half;
    }
    return `${out}</svg>`;
  }

  const REPORT_CSS = `
:root{--bg:#f6f7fa;--surface:#fff;--fg:#12141b;--fg2:#474d60;--muted:#767d91;--line:#e2e5ec;--snore:#e25f2a;--ignored:#a9aebd;--quiet:#dde1e9;--accent:#3448c2;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0e1016;--surface:#161922;--fg:#eef0f6;--fg2:#b3b8c9;--muted:#7a8196;--line:#262b38;--snore:#e8743f;--ignored:#5d6478;--quiet:#2f3544;--accent:#a5b4ff;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:820px;margin:0 auto;padding:28px 16px 48px;display:flex;flex-direction:column;gap:22px}
h1{font-size:32px;line-height:1.15;margin:4px 0;letter-spacing:-.02em}
h2{font-size:17px;margin:0 0 10px}
.eyebrow{margin:0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.meta{margin:0;color:var(--fg2)}
.tip{margin:0;font-size:13px;color:var(--muted);border-left:3px solid var(--line);padding-left:10px}
.verdict{font-size:17px;margin:0;max-width:64ch}
.hero{width:100%;height:auto;border-radius:14px;display:block}
section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px}
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.tile b{display:block;font-size:24px;line-height:1.3}
.tile span,.tile small{color:var(--fg2);font-size:13px}
.timeline{width:100%;height:auto;display:block}
.timeline .grid{stroke:var(--line)}.timeline .base{stroke:var(--muted)}
.timeline .bar{fill:var(--snore)}.timeline .gap{fill:var(--line);opacity:.7}
.timeline text{fill:var(--muted);font-size:11px}
.timeline .ytick{text-anchor:end;dominant-baseline:middle}.timeline .xtick{text-anchor:middle}
.noise{width:100%;height:auto;display:block}
.noise .heat-bg{fill:var(--quiet)}.noise .cell{fill:var(--accent)}.noise .level{fill:none;stroke:var(--accent);stroke-width:1.5}
.noise .tick{fill:var(--snore)}.noise .gap{fill:var(--line);opacity:.7}.noise .grid{stroke:var(--surface);stroke-width:1}
.noise text{fill:var(--muted);font-size:11px}.noise .ytick{text-anchor:end;dominant-baseline:middle}.noise .xtick{text-anchor:middle}
.findings{margin:0 0 12px;padding-left:20px;display:grid;gap:6px;max-width:72ch}
.sub{color:var(--muted);font-size:13px;margin:-6px 0 10px}
.clips{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.clip{border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px}
.clip .wave{width:100%;height:40px;display:block}.clip .wave polygon{fill:var(--snore)}
.clip p{margin:0;font-size:13px;color:var(--fg2);font-variant-numeric:tabular-nums}
.clip p b{color:var(--fg)}
audio{width:100%;height:36px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px}
th{text-align:left;color:var(--muted);font-weight:500;font-size:12.5px;border-bottom:1px solid var(--line);padding:6px 10px 6px 0}
td{border-bottom:1px solid var(--line);padding:7px 10px 7px 0}
tr:last-child td{border-bottom:0}
.scroll{overflow-x:auto}
.note{color:var(--muted);font-size:13px;margin:0;max-width:72ch}
@media (max-width:600px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media print{section{break-inside:avoid}audio{display:none}}`;

  /**
   * Builds the report file.
   * d: { startWall, elapsed, captured, gaps, snores, summary, version, sensitivity, sourceLabel,
   *      reasons (key -> label), heroImage (data URI or null), samples: {loud, random},
   *      noise, noiseBands, noiseLines (room noise: the night's profile and its findings; optional) }
   */
  function buildReportHtml(d) {
    const sum = d.summary;
    const cov = coverage(d);
    const end = d.startWall + d.elapsed * 1000;
    const long = d.elapsed >= 3600;
    const at = (t) => fmtTime(d.startWall + t * 1000, !long);
    const tl = timelineSvg(d);
    const tile = (label, value, note) => `<div class="tile"><span>${label}</span><b>${value}</b><small>${note || '&nbsp;'}</small></div>`;
    const clip = (s) =>
      `<div class="clip">${waveSvg(s.clip)}<p><b>${at(s.start)}</b> · +${round(s.relDb)} dB · ${round(s.duration, 1)} s</p><audio controls preload="metadata" src="${clipDataUri(
        s,
      )}"></audio></div>`;
    const verdict = sum.snoreCount
      ? `${sum.snoreCount} snores in ${fmtSpan(cov.captured)}${cov.gaps.length ? ' recorded' : ''}${
          cov.captured >= 600 ? `, about ${round(sum.snoresPerHour)} per hour` : ''
        }. Snoring filled ${round(
          sum.snorePercent,
          1,
        )}% of the recording${sum.longestEpisode ? ` and the longest episode lasted ${fmtSpan(sum.longestEpisode)}` : ''}.`
      : 'No snoring was detected.';
    const lost = cov.gaps.reduce((t, g) => t + g.end - g.start, 0);
    const interrupted = cov.gaps.length
      ? `The recording was interrupted ${cov.gaps.length}× (${fmtSpan(lost)} not recorded: ${cov.gaps
          .map((g) => `${at(g.start)}–${at(g.end)}`)
          .join(', ')}). Snores in those times are missing; per-hour figures use the recorded time only.`
      : '';
    const possible = sum.possibleCount
      ? `${sum.possibleCount} isolated snore-like sounds without a neighbour in breathing rhythm were not counted.`
      : '';
    const ignored = Object.keys(d.reasons)
      .filter((k) => sum.ignoredByReason[k])
      .map((k) => `<tr><td>${esc(d.reasons[k])}</td><td>${sum.ignoredByReason[k]}</td></tr>`)
      .join('');
    const episodes = sum.episodes
      .map(
        (e) =>
          `<tr><td>${at(e.start)}</td><td>${fmtSpan(e.duration)}</td><td>${e.count}</td><td>${round(e.interval, 1)} s</td><td>+${round(e.meanRelDb)} dB</td></tr>`,
      )
      .join('');
    const nClips = d.samples.loud.length + d.samples.random.length;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snore report ${esc(fmtDate(d.startWall))}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
<header>
<p class="eyebrow">Snorewatch report · ${esc(d.sourceLabel)}</p>
<h1>${esc(fmtDate(d.startWall))}</h1>
<p class="meta">${esc(fmtTime(d.startWall))} – ${esc(fmtTime(end))} · ${esc(cov.span)} · sensitivity ${esc(d.sensitivity)} · version ${esc(d.version)}</p>
</header>
${nClips ? '<p class="tip">This file contains ' + nClips + ' snore recordings you can play. If they do not play, open the file in a web browser (on iPhone: “Open in Safari”).</p>' : ''}
<p class="verdict">${esc(verdict)}</p>
${interrupted ? `<p class="tip interrupted">${esc(interrupted)}</p>` : ''}
${d.processingNote ? `<p class="tip interrupted">${esc(d.processingNote)}</p>` : ''}
${possible ? `<p class="note">${esc(possible)}</p>` : ''}
${d.heroImage ? `<img class="hero" src="${d.heroImage}" alt="The night as a star map: each snore is a dot, placed by time and loudness">` : ''}
<div class="tiles">
${tile('Snores', round(sum.snoreCount), sum.possibleCount ? `+${round(sum.possibleCount)} possible, not counted` : sum.medianInterval ? `typically every ${round(sum.medianInterval, 1)} s` : '')}
${tile('Snores per hour', cov.captured >= 600 ? round(sum.snoresPerHour) : '–', cov.captured < 600 ? 'recording too short' : '')}
${tile('Snoring time', fmtSpan(sum.snoreSeconds), `${round(sum.snorePercent, 1)}% of the recording`)}
${tile('Loudest snore', sum.snoreCount ? `+${round(sum.maxRelDb)} dB` : '–', sum.snoreCount ? `average +${round(sum.meanRelDb)} dB above room noise` : '')}
${tile('Snoring episodes', round(sum.episodes.length), sum.longestEpisode ? `longest ${fmtSpan(sum.longestEpisode)}` : '')}
${tile('Ignored sounds', round(sum.ignoredCount), 'heard, not recorded')}
</div>
<section>
<h2>Snores over time</h2>
<p class="sub">Snores per ${esc(fmtSpan(tl.size))}</p>
${tl.svg}
</section>
${
  d.samples.loud.length
    ? `<section><h2>Loudest snores</h2><p class="sub">The ${d.samples.loud.length} loudest, volume evened out for listening</p><div class="clips">${d.samples.loud
        .map(clip)
        .join('')}</div></section>`
    : ''
}
${
  d.samples.random.length
    ? `<section><h2>Random sample</h2><p class="sub">${d.samples.random.length} other snores picked at random, to show a typical one</p><div class="clips">${d.samples.random
        .map(clip)
        .join('')}</div></section>`
    : ''
}
<section>
<h2>Snoring episodes</h2>
<p class="sub">3 or more snores, less than a minute apart</p>
${
  episodes
    ? `<div class="scroll"><table><thead><tr><th>Start</th><th>Length</th><th>Snores</th><th>Every</th><th>Avg loudness</th></tr></thead><tbody>${episodes}</tbody></table></div>`
    : '<p class="note">No snoring episodes.</p>'
}
</section>
${
  d.noise && d.noise.minutes && d.noise.minutes.length
    ? `<section>
<h2>Room noise</h2>
<p class="sub">Levels per minute only; no sound of the room was kept.</p>
${
  d.noiseLines && d.noiseLines.length
    ? `<ul class="findings">${d.noiseLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '<p class="note">The room is described from 10 minutes of recording on.</p>'
}
${d.noise.minutes.length >= 3 ? noiseSvg(d) : ''}
<p class="note">Shading: how far each pitch rose above its own quiet level (full colour at 15 dB). Line: the room's overall level. Ticks: snores.</p>
</section>`
    : ''
}
<section>
<h2>Ignored sounds</h2>
<p class="sub">Heard during the night but not snoring. No audio of these was kept.</p>
${ignored ? `<table><tbody>${ignored}</tbody></table>` : '<p class="note">No other sounds were heard.</p>'}
</section>
<p class="note">How it works: the recording is split into short frames. A sound counts as a snore when it is a burst of 0.25–4 s rising above the room’s background noise, with most of its energy below 800 Hz and a dull sound (spectral centroid under 500 Hz), but not only deep rumble below 60 Hz${d.sensitivity === 'normal' || d.sensitivity === 'low' ? `; on ${d.sensitivity === 'low' ? 'Low' : 'Normal'} sensitivity it must also carry the rush of air of a snore (150–1500 Hz at least 6 dB above the room noise)` : ''}. A rattling snore made of several bursts counts when it fits the breathing rhythm of the snores around it. Only snores with another snore 2–12 s before or after them are counted; isolated ones are listed as possible. Loudness is given in dB above the room noise. Only short clips that sounded like snoring were kept (they can include sounds right around a snore, and the detection can be wrong); the audio of all other sounds was discarded on the device.</p>
<p class="note">Snorewatch estimates snoring from sound alone. It is not a medical device and cannot detect sleep apnea. If you stop breathing at night, wake up gasping or feel very tired during the day, talk to a doctor.</p>
</main>
</body>
</html>
`;
  }

  return { CARD_W, CARD_H, drawShareCard, buildReportHtml, pickSamples, timeTicks, busiest, coverage, waveSvg, noiseSvg, fmtSpan };
});
