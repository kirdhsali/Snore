/* Snorewatch UI: audio input, live view and report. */
(function () {
  'use strict';

  const { SnoreDetector, SessionStats, encodeWav, normalizeClip, REASONS } = window.SnoreCore;
  const Synth = window.SnoreSynth;
  const Charts = window.SnoreCharts;
  const Share = window.SnoreShare;
  const EMBED = !!window.SNOREWATCH_EMBED;
  const LIVE_SECONDS = 30;
  const V = window.SNOREWATCH_VERSION || { version: '?', build: 'dev' };
  const VERSION_TEXT = `${V.version} (${V.build})`;

  const $ = (id) => document.getElementById(id);
  const el = {
    rec: $('rec'),
    recLabel: $('rec-label'),
    status: $('status'),
    controls: $('controls'),
    sensitivity: $('sensitivity'),
    hint: $('source-hint'),
    demoBadge: $('demo-badge'),
    live: $('live'),
    pill: $('pill'),
    pillText: $('pill-text'),
    levelText: $('level-text'),
    liveCanvas: $('live-canvas'),
    liveTiles: $('live-tiles'),
    liveTimeline: $('live-timeline'),
    liveTip: $('live-tip'),
    liveBucket: $('live-bucket'),
    liveClips: $('live-clips'),
    report: $('report'),
    reportSource: $('report-source'),
    reportRange: $('report-range'),
    verdict: $('verdict'),
    reportTiles: $('report-tiles'),
    reportTimeline: $('report-timeline'),
    reportTip: $('report-tip'),
    reportBucket: $('report-bucket'),
    intensity: $('intensity'),
    ignored: $('ignored'),
    episodes: $('episodes'),
    reportClips: $('report-clips'),
    dlWav: $('dl-wav'),
    dlJson: $('dl-json'),
    copy: $('copy-summary'),
    sharePreview: $('share-preview'),
    shareImage: $('share-image'),
    shareReport: $('share-report'),
    shareHint: $('share-hint'),
    intro: $('intro'),
  };

  const HINTS = {
    mic: 'Uses your microphone. Put the device within 1–2 m of your head and plug it in; the screen stays on while recording.',
    demo: 'Demo: plays a simulated 90-second night through the speakers (snoring mixed with talking, knocking, a passing car and a cough). Only the snores should be counted.',
  };
  const SOURCE_NAMES = { mic: 'Microphone recording', demo: 'Demo night (simulated sounds)' };

  let session = null; // current or last session
  let running = false;
  let starting = false;
  let wakeLock = null;
  let playing = null;

  // ---------- formatting ----------
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function fmtSpan(sec) {
    sec = Math.round(sec);
    if (sec < 60) return `${sec} s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (!h) return `${m} min ${sec % 60 ? `${sec % 60} s` : ''}`.trim();
    return `${h} h ${m} min`;
  }
  function fmtTime(date, withSeconds) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined });
  }
  function at(sec) {
    return new Date(session.startWall + sec * 1000);
  }
  function fmtNum(v, digits = 0) {
    return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // ---------- source ----------
  // The app records from the microphone. Adding #demo to the address plays a
  // simulated night instead, to show the app or check it during the day.
  function currentSource() {
    return EMBED || location.hash === '#demo' ? 'demo' : 'mic';
  }
  function updateSourceUI() {
    const src = currentSource();
    el.demoBadge.hidden = src !== 'demo';
    el.hint.textContent = HINTS[src];
    if (!running) setStatus('Tap Start to begin.');
  }
  window.addEventListener('hashchange', () => !running && updateSourceUI());
  el.sensitivity.addEventListener('change', () => {
    if (session && running) session.detector.setSensitivity(el.sensitivity.value);
  });

  if (EMBED) {
    HINTS.demo += ' The microphone is not available in this preview; open the app from its own address to record yourself.';
    el.dlWav.hidden = true;
    el.dlJson.hidden = true;
    el.shareImage.hidden = true;
    el.shareReport.hidden = true;
  }

  function setStatus(text, isError) {
    el.status.textContent = text;
    el.status.classList.toggle('is-error', !!isError);
  }

  // ---------- audio plumbing ----------
  const TAP_CODE = `class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
    process(inputs) {
      const inp = inputs[0];
      if (inp && inp.length) {
        const a = inp[0], c = inp.length;
        for (let i = 0; i < a.length; i++) {
          let s = a[i];
          for (let k = 1; k < c; k++) s += inp[k][i];
          this.buf[this.n++] = s / c;
          if (this.n === this.buf.length) {
            this.port.postMessage(this.buf, [this.buf.buffer]);
            this.buf = new Float32Array(2048);
            this.n = 0;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('snore-tap', Tap);`;

  /** Streams raw mono samples from `input` to `onSamples`. */
  async function createTap(ctx, input, onSamples) {
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try {
        const url = URL.createObjectURL(new Blob([TAP_CODE], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, 'snore-tap', { numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (e) => onSamples(e.data);
        input.connect(node);
        node.connect(sink);
        return node;
      } catch (err) {
        console.warn('AudioWorklet unavailable, using ScriptProcessor', err);
      }
    }
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
    input.connect(sp);
    sp.connect(sink);
    return sp;
  }

  function demoBuffer(ctx) {
    const rate = 22050;
    const sc = Synth.demoScenario(rate, 1 + Math.floor(Math.random() * 1000));
    const buf = ctx.createBuffer(1, sc.samples.length, rate);
    buf.copyToChannel(sc.samples, 0);
    return buf;
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      }
    } catch (err) {
      wakeLock = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (running && document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
  });
  window.addEventListener('beforeunload', (e) => {
    if (running) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- session ----------
  async function start() {
    if (starting || running) return;
    stopClip();
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'auto';
    } catch (e) {}
    const source = currentSource();
    starting = true;
    el.rec.disabled = true;
    setStatus(source === 'mic' ? 'Waiting for microphone permission…' : 'Preparing audio…');

    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let stream = null;
    try {
      if (!AC) throw new Error('This browser cannot process audio. Try a current Chrome, Firefox or Safari.');
      // Create the context inside the click so browsers let it start.
      ctx = new AC();
      let input;
      let player = null;
      if (source === 'mic') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Microphone access needs a secure page. Open the app over https, or on localhost via npm start.');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
        input = ctx.createMediaStreamSource(stream);
      } else {
        player = ctx.createBufferSource();
        player.buffer = demoBuffer(ctx);
        input = player;
        player.connect(ctx.destination); // the demo is meant to be heard
        player.onended = () => stop('ended');
      }
      if (ctx.state === 'suspended') await ctx.resume();

      const stats = new SessionStats();
      session = {
        source,
        startWall: Date.now(),
        endWall: null,
        ctx,
        stream,
        player,
        tap: null,
        stats,
        frames: [],
        frameCap: 0,
        lastFrame: null,
        lastVerdict: null,
        newClips: [],
        detector: null,
      };
      const det = new SnoreDetector(ctx.sampleRate, {
        sensitivity: el.sensitivity.value,
        onFrame: handleFrame,
        onEvent: handleEvent,
      });
      session.detector = det;
      session.frameCap = Math.ceil(LIVE_SECONDS / det.hopSec);
      session.tap = await createTap(ctx, input, (samples) => running && det.process(samples));
      if (player) player.start();

      running = true;
      requestWakeLock();
      showLive();
      setStatus(
        source === 'mic'
          ? 'Recording. Only snores are kept. Tap Stop in the morning.'
          : 'Playing the demo night. The report appears when it ends, or tap Stop.',
      );
      loop();
    } catch (err) {
      console.error(err);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
      session = null;
      let msg = err && err.message ? err.message : String(err);
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        msg = 'Microphone access was blocked. Allow it in the browser’s site settings, then tap Start again.';
      } else if (err && err.name === 'NotFoundError') {
        msg = 'No microphone found. Connect one, then tap Start again.';
      }
      setStatus(msg, true);
    } finally {
      starting = false;
      el.rec.disabled = false;
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    const s = session;
    s.detector.flush(); // decides open sounds; they arrive through handleEvent
    s.elapsed = s.detector.elapsed;
    s.endWall = s.startWall + s.elapsed * 1000;
    try {
      s.tap.disconnect();
      if (s.tap.port) s.tap.port.onmessage = null;
    } catch (e) {}
    if (s.player) {
      s.player.onended = null;
      try {
        s.player.stop();
      } catch (e) {}
    }
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    s.ctx.close().catch(() => {});
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    showReport();
  }

  el.rec.addEventListener('click', () => (running ? stop() : start()));

  // ---------- live ----------
  function handleFrame(f) {
    const s = session;
    s.lastFrame = f;
    s.frames.push({ index: f.index, db: f.db, trigger: f.trigger, cls: f.active ? 'p' : 'q' });
    if (s.frames.length > s.frameCap) s.frames.splice(0, s.frames.length - s.frameCap);
  }

  function handleEvent(ev) {
    const s = session;
    s.stats.add(ev);
    const cls = ev.isSnore ? 's' : 'i';
    // Sounds waiting for a snore in rhythm are decided later, so recolor only this event's frames.
    const lastFrame = ev.endFrame + Math.ceil(s.detector.opts.hangoverSec / s.detector.hopSec) + 1;
    for (let i = s.frames.length - 1; i >= 0 && s.frames[i].index >= ev.startFrame; i--) {
      if (s.frames[i].index <= lastFrame && s.frames[i].cls === 'p') s.frames[i].cls = cls;
    }
    s.lastVerdict = { ev, t: ev.end };
    if (ev.isSnore) s.newClips.push(ev);
  }

  function showLive() {
    el.report.hidden = true;
    el.intro.hidden = true;
    el.live.hidden = false;
    el.rec.classList.add('is-on');
    el.rec.setAttribute('aria-pressed', 'true');
    el.recLabel.textContent = 'Stop';
    el.controls.classList.add('is-locked');
    el.liveClips.innerHTML = '<p class="empty">Snores appear here as soon as they are detected.</p>';
    renderLiveTiles();
    renderTimeline(el.liveTimeline, el.liveBucket, session.detector.elapsed);
  }

  let lastSlow = 0;
  function loop(now) {
    if (!running) return;
    const s = session;
    Charts.drawLive(el.liveCanvas, s.frames, s.frameCap, LIVE_SECONDS);
    updatePill();
    if (s.newClips.length) {
      const empty = el.liveClips.querySelector('.empty');
      if (empty) empty.remove();
      for (const ev of s.newClips) {
        const card = clipCard(ev, true);
        el.liveClips.prepend(card);
      }
      while (el.liveClips.children.length > 6) el.liveClips.lastChild.remove();
      s.newClips = [];
      lastSlow = 0;
    }
    if (!now || now - lastSlow > 1000) {
      lastSlow = now || 0;
      renderLiveTiles();
      renderTimeline(el.liveTimeline, el.liveBucket, s.detector.elapsed, el.liveTip);
    }
    requestAnimationFrame(loop);
  }

  function updatePill() {
    const s = session;
    const f = s.lastFrame;
    let state = 'listening';
    let text = 'Listening';
    const v = s.lastVerdict;
    if (!f || f.calibrating) {
      state = 'calibrating';
      text = 'Measuring room noise';
    } else if (f.active) {
      state = 'sound';
      text = 'Sound heard, checking…';
    } else if (v && f.t - v.t < 2.5) {
      state = v.ev.isSnore ? 'snore' : 'ignored';
      text = v.ev.isSnore ? 'Snore detected' : `Ignored: ${REASONS[v.ev.reason].toLowerCase()}`;
    }
    if (el.pill.dataset.state !== state || el.pillText.textContent !== text) {
      el.pill.dataset.state = state;
      el.pillText.textContent = text;
    }
    const lvl = f && f.trigger != null ? Math.max(0, Math.min(1, (f.db - (f.trigger - s.detector.triggerDb)) / 30)) : 0;
    el.rec.style.setProperty('--lvl', lvl.toFixed(3));
    el.rec.classList.toggle('is-snore', state === 'snore');
    el.levelText.textContent = f ? `Level ${f.db.toFixed(0)} dBFS · room ${f.floor != null ? f.floor.toFixed(0) : '…'} dBFS` : '';
  }

  function tile(label, value, note, key) {
    return `<div class="tile${key ? ' is-key' : ''}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${
      note ? `<div class="tile-note">${note}</div>` : ''
    }</div>`;
  }

  function renderLiveTiles() {
    const s = session;
    const sum = s.stats.summary(s.detector.elapsed);
    el.liveTiles.innerHTML = [
      tile('Recording time', fmtClock(sum.elapsed), s.source === 'mic' ? `since ${fmtTime(at(0))}` : SOURCE_NAMES[s.source]),
      tile('Snores', fmtNum(sum.snoreCount), possibleNote(sum) || (sum.medianInterval ? `about every ${sum.medianInterval.toFixed(1)} s` : 'in breathing rhythm'), true),
      tile('Snores per hour', sum.elapsed >= 30 ? fmtNum(sum.snoresPerHour) : '–', sum.elapsed < 600 ? 'estimate, still settling' : 'average so far'),
      tile('Snoring time', fmtSpan(sum.snoreSeconds), `${fmtNum(sum.snorePercent, 1)}% of the recording`),
      tile('Loudest snore', sum.snoreCount ? `+${fmtNum(sum.maxRelDb)}<small>dB</small>` : '–', 'above room noise'),
      tile('Ignored sounds', fmtNum(sum.ignoredCount), 'heard, not kept'),
    ].join('');
  }

  // ---------- timeline ----------
  const BUCKETS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  /** Bucket size that gives at most 60 columns. */
  function bucketSize(elapsed) {
    return BUCKETS.find((b) => elapsed / b <= 60) || 3600;
  }

  function renderTimeline(canvas, subEl, elapsed, tipEl) {
    const s = session;
    const size = bucketSize(elapsed);
    // Show at least 12 slots so a short session doesn't draw one giant column.
    const buckets = s.stats.buckets(Math.max(elapsed, size * 12), size);
    const long = elapsed >= 3600;
    const label = (i) => (long ? fmtTime(at(i * size)) : fmtClock(i * size));
    subEl.textContent = `Snores per ${
      size < 60 ? `${size} seconds` : size === 60 ? 'minute' : size === 3600 ? 'hour' : `${size / 60} minutes`
    }`;
    const draw = (hover) => Charts.drawTimeline(canvas, buckets, label, hover);
    const geo = draw(-1);
    canvas._timeline = { buckets, size, long, geo, draw, tipEl };
  }

  function attachTooltip(canvas, tipEl) {
    const hide = () => {
      tipEl.hidden = true;
      if (canvas._timeline) canvas._timeline.draw(-1);
    };
    canvas.addEventListener('pointermove', (e) => {
      const t = canvas._timeline;
      if (!t) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const i = Math.floor((x - t.geo.padL) / t.geo.slot);
      if (i < 0 || i >= t.buckets.length) return hide();
      const b = t.buckets[i];
      t.draw(i);
      const range = t.long
        ? `${fmtTime(at(b.start))}–${fmtTime(at(b.start + t.size))}`
        : `${fmtClock(b.start)}–${fmtClock(b.start + t.size)}`;
      tipEl.innerHTML = `<strong>${b.count} snore${b.count === 1 ? '' : 's'}</strong>${range}${
        b.count ? ` · avg +${b.meanRelDb.toFixed(0)} dB` : ''
      }`;
      tipEl.hidden = false;
      const cx = t.geo.padL + (i + 0.5) * t.geo.slot;
      const w = tipEl.offsetWidth;
      tipEl.style.left = `${Math.max(0, Math.min(rect.width - w, cx - w / 2))}px`;
      tipEl.style.top = '-8px';
    });
    canvas.addEventListener('pointerleave', hide);
  }
  attachTooltip(el.liveTimeline, el.liveTip);
  attachTooltip(el.reportTimeline, el.reportTip);

  // ---------- clips ----------
  function clipCard(ev, isNew) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clip' + (isNew ? ' is-new' : '');
    btn.setAttribute('aria-label', `Play snore at ${fmtTime(at(ev.start), true)}`);
    btn.innerHTML = `<canvas aria-hidden="true"></canvas><span class="clip-meta"><b>${fmtTime(at(ev.start), true)}</b><span>+${ev.relDb.toFixed(0)} dB · ${ev.duration.toFixed(1)} s</span></span>`;
    btn.addEventListener('click', () => playClip(ev, btn));
    requestAnimationFrame(() => ev.clip && Charts.drawClip(btn.querySelector('canvas'), ev.clip));
    return btn;
  }

  function stopClip() {
    if (!playing) return;
    const p = playing;
    playing = null;
    p.audio.pause();
    p.done();
  }

  /**
   * Plays a snore through an <audio> element rather than Web Audio: on iPhones
   * Web Audio is muted by the silent switch and, after the microphone was used,
   * may come out of the earpiece. Media elements play through the speaker.
   */
  function playClip(ev, btn) {
    if (!ev.clip) return;
    const wasThis = playing && playing.btn === btn;
    stopClip();
    if (wasThis) return; // second tap stops
    try {
      if (!running && navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}
    const wav = encodeWav([normalizeClip(ev.clip)], ev.clipRate, 0);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const audio = new Audio(url);
    const done = () => {
      btn.classList.remove('is-playing');
      URL.revokeObjectURL(url);
      if (playing && playing.audio === audio) playing = null;
    };
    const fail = () => {
      done();
      setStatus('This snore could not be played. Check that the volume is up.', true);
    };
    audio.onended = done;
    audio.onerror = fail;
    btn.classList.add('is-playing');
    playing = { audio, btn, done };
    const p = audio.play();
    if (p && p.catch) p.catch(fail);
  }

  // ---------- report ----------
  function showReport() {
    const s = session;
    const sum = s.stats.summary(s.elapsed);
    s.summary = sum;
    el.live.hidden = true;
    el.report.hidden = false;
    el.rec.classList.remove('is-on', 'is-snore');
    el.rec.setAttribute('aria-pressed', 'false');
    el.rec.style.setProperty('--lvl', 0);
    el.recLabel.textContent = 'Start';
    el.controls.classList.remove('is-locked');
    setStatus('Recording stopped. Your report is below. Tap Start for a new recording.');

    el.reportSource.textContent = SOURCE_NAMES[s.source];
    const start = at(0);
    const end = new Date(s.endWall);
    const day = start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    el.reportRange.textContent = `${day}, ${fmtTime(start)} – ${fmtTime(end)} · ${fmtSpan(s.elapsed)}`;
    el.verdict.textContent = verdictText(sum);

    el.reportTiles.innerHTML = [
      tile('Snores', fmtNum(sum.snoreCount), possibleNote(sum) || (sum.medianInterval ? `typically every ${sum.medianInterval.toFixed(1)} s` : ''), true),
      tile('Snores per hour', s.elapsed >= 30 ? fmtNum(sum.snoresPerHour) : '–', s.elapsed < 600 ? 'short recording, rough estimate' : ''),
      tile('Snoring time', fmtSpan(sum.snoreSeconds), `${fmtNum(sum.snorePercent, 1)}% of the recording`),
      tile('Loudest snore', sum.snoreCount ? `+${fmtNum(sum.maxRelDb)}<small>dB</small>` : '–', sum.snoreCount ? `average +${fmtNum(sum.meanRelDb)} dB above room noise` : ''),
      tile('Snoring episodes', fmtNum(sum.episodes.length), sum.longestEpisode ? `longest ${fmtSpan(sum.longestEpisode)}` : ''),
      tile('Ignored sounds', fmtNum(sum.ignoredCount), 'not recorded'),
    ].join('');

    requestAnimationFrame(() => renderTimeline(el.reportTimeline, el.reportBucket, s.elapsed, el.reportTip));

    const inten = [
      ['Light, < +15 dB', sum.intensity.light],
      ['Moderate, +15–25 dB', sum.intensity.moderate],
      ['Loud, > +25 dB', sum.intensity.loud],
    ];
    el.intensity.innerHTML = bars(inten, false);
    const ign = Object.keys(REASONS)
      .map((k) => [REASONS[k], sum.ignoredByReason[k] || 0])
      .filter((r) => r[1] > 0);
    el.ignored.innerHTML = ign.length ? bars(ign, true) : '<p class="empty">No other sounds were heard.</p>';

    el.episodes.innerHTML = sum.episodes.length
      ? `<thead><tr><th>Start</th><th>Length</th><th>Snores</th><th>Every</th><th>Avg loudness</th></tr></thead><tbody>${sum.episodes
          .map(
            (e) =>
              `<tr><td>${fmtTime(at(e.start), s.elapsed < 3600)}</td><td>${fmtSpan(e.duration)}</td><td>${e.count}</td><td>${e.interval.toFixed(
                1,
              )} s</td><td>+${e.meanRelDb.toFixed(0)} dB</td></tr>`,
          )
          .join('')}</tbody>`
      : '<tbody><tr><td class="empty">No snoring episodes.</td></tr></tbody>';

    el.reportClips.innerHTML = '';
    const loudest = s.stats.confirmed.filter((x) => x.clip).sort((a, b) => b.relDb - a.relDb).slice(0, 8);
    if (loudest.length) loudest.forEach((ev) => el.reportClips.append(clipCard(ev, false)));
    else el.reportClips.innerHTML = '<p class="empty">No snores were recorded.</p>';

    el.dlWav.disabled = !s.stats.snores.some((x) => x.clip);
    prepareShare(s);
    el.report.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // ---------- sharing ----------
  let shareFiles = null;
  let sharePreviewUrl = null;

  /**
   * Renders the share image and builds the report file as soon as the report
   * shows, so the share buttons can open the share sheet right away (iPhones
   * only allow that directly inside the tap).
   */
  async function prepareShare(s) {
    shareFiles = null;
    el.shareImage.disabled = true;
    el.shareReport.disabled = true;
    el.shareHint.textContent = 'Preparing…';
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.race([
          Promise.all([document.fonts.load('700 100px "Bricolage Grotesque"'), document.fonts.load('500 40px "Bricolage Grotesque"')]),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      }
      const data = {
        startWall: s.startWall,
        elapsed: s.elapsed,
        snores: s.stats.confirmed,
        summary: s.summary,
        version: VERSION_TEXT,
        sensitivity: s.detector.sensitivity,
        sourceLabel: SOURCE_NAMES[s.source],
        reasons: REASONS,
      };
      const canvas = Share.drawShareCard(document.createElement('canvas'), data);
      const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      data.heroImage = canvas.toDataURL('image/jpeg', 0.82);
      data.samples = Share.pickSamples(s.stats.confirmed, 8, 5);
      const html = Share.buildReportHtml(data);
      if (session !== s) return;
      shareFiles = {
        image: new File([png], `snore-night_${stamp()}.png`, { type: 'image/png' }),
        report: new File([html], `snore-report_${stamp()}.html`, { type: 'text/html' }),
      };
      if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl);
      sharePreviewUrl = URL.createObjectURL(png);
      el.sharePreview.src = sharePreviewUrl;
      el.shareImage.disabled = false;
      el.shareReport.disabled = false;
      const n = data.samples.loud.length + data.samples.random.length;
      if (EMBED) {
        el.shareHint.textContent = 'Open the app from its own address to share the image or the full report.';
        return;
      }
      el.shareHint.textContent = `The report is one file (${Math.max(1, Math.round(shareFiles.report.size / 1024))} KB)${
        n ? ` with ${n} snores to play` : ''
      }. It opens in any browser; on iPhone choose “Open in Safari” to play the sounds.`;
    } catch (err) {
      console.error(err);
      el.shareHint.textContent = 'Sharing is not available in this browser.';
    }
  }

  async function shareFile(file, title) {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // the user closed the share sheet
      }
    }
    download(file.name, file);
  }

  el.shareImage.addEventListener('click', () => shareFiles && shareFile(shareFiles.image, 'My night with Snorewatch'));
  el.shareReport.addEventListener('click', () => shareFiles && shareFile(shareFiles.report, 'Snorewatch report'));

  function bars(rows, ignored) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows
      .map(
        ([label, n]) =>
          `<div class="bar-row"><span class="bar-label">${esc(label)}</span><span class="bar-track"><span class="bar-fill${
            ignored ? ' is-ignored' : ''
          }" style="display:block;width:${n ? (100 * n) / max : 0}%"></span></span><span class="bar-value">${n}</span></div>`,
      )
      .join('');
  }

  /** "+3 possible": snore-like sounds without a neighbour in breathing rhythm, not counted. */
  function possibleNote(sum) {
    return sum.possibleCount ? `+${fmtNum(sum.possibleCount)} possible, not counted` : '';
  }

  function verdictText(sum) {
    const possible = sum.possibleCount
      ? ` ${sum.possibleCount} isolated snore-like sound${sum.possibleCount === 1 ? ' was' : 's were'} not counted because no other snore followed in breathing rhythm.`
      : '';
    if (!sum.snoreCount) {
      return (
        (sum.ignoredCount
          ? `No snoring detected. ${sum.ignoredCount} other sound${sum.ignoredCount === 1 ? ' was' : 's were'} heard and ignored.`
          : 'No snoring detected, and the room stayed quiet.') + possible
      );
    }
    let t = `${sum.snoreCount} snore${sum.snoreCount === 1 ? '' : 's'} in ${fmtSpan(sum.elapsed)}`;
    if (sum.elapsed >= 30) t += `, about ${fmtNum(sum.snoresPerHour)} per hour`;
    t += `. Snoring filled ${fmtNum(sum.snorePercent, 1)}% of the recording`;
    if (sum.longestEpisode) t += ` and the longest episode lasted ${fmtSpan(sum.longestEpisode)}`;
    t += '.';
    if (sum.ignoredCount) t += ` ${sum.ignoredCount} other sound${sum.ignoredCount === 1 ? ' was' : 's were'} ignored.`;
    return t + possible;
  }

  function summaryText() {
    const s = session;
    const sum = s.summary;
    return [
      `Snorewatch report – ${el.reportSource.textContent}`,
      el.reportRange.textContent,
      verdictText(sum),
      `Snores: ${sum.snoreCount} (${fmtNum(sum.snoresPerHour)} per hour)${sum.possibleCount ? `, plus ${sum.possibleCount} possible` : ''}`,
      `Snoring time: ${fmtSpan(sum.snoreSeconds)} (${fmtNum(sum.snorePercent, 1)}%)`,
      `Loudest: +${fmtNum(sum.maxRelDb)} dB, average +${fmtNum(sum.meanRelDb)} dB above room noise`,
      `Episodes: ${sum.episodes.length}${sum.longestEpisode ? `, longest ${fmtSpan(sum.longestEpisode)}` : ''}`,
      `Ignored sounds: ${sum.ignoredCount}`,
    ].join('\n');
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function stamp() {
    const d = at(0);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  const WAV_GAP_SEC = 0.4;

  /** Where each kept snore starts in the downloaded WAV, in seconds. */
  function wavPositions(snores) {
    const pos = new Map();
    let t = 0;
    for (const x of snores) {
      if (!x.clip) continue;
      pos.set(x, t);
      t += x.clip.length / x.clipRate + WAV_GAP_SEC;
    }
    return pos;
  }

  el.dlWav.addEventListener('click', () => {
    const snores = session.stats.snores.filter((x) => x.clip);
    if (!snores.length) return;
    // Volume is evened out per clip so quiet snores are audible; the JSON keeps the real levels.
    const wav = encodeWav(
      snores.map((x) => normalizeClip(x.clip)),
      snores[0].clipRate,
      WAV_GAP_SEC,
    );
    download(`snores_${stamp()}.wav`, new Blob([wav], { type: 'audio/wav' }));
  });

  el.dlJson.addEventListener('click', () => {
    const s = session;
    const wavPos = wavPositions(s.stats.snores);
    const data = {
      app: 'Snorewatch',
      version: VERSION_TEXT,
      source: s.source,
      startedAt: new Date(s.startWall).toISOString(),
      endedAt: new Date(s.endWall).toISOString(),
      sensitivity: s.detector.sensitivity,
      summary: s.summary,
      snores: s.stats.snores.map((x) => ({
        time: at(x.start).toISOString(),
        offsetSec: +x.start.toFixed(2),
        durationSec: +x.duration.toFixed(2),
        aboveRoomDb: +x.relDb.toFixed(1),
        peakDbfs: +x.peakDb.toFixed(1),
        confidence: +x.score.toFixed(2),
        lowFrequencyShare: +x.lowRatio.toFixed(3),
        highFrequencyShare: +x.highRatio.toFixed(3),
        centroidHz: Math.round(x.centroid),
        bursts: x.peaks,
        subBassShare: x.subBass == null ? null : +x.subBass.toFixed(3),
        loudFill: +x.fill.toFixed(2),
        rhythmRescued: !!x.rhythm,
        confirmed: !!x.confirmed,
        wavStartSec: wavPos.has(x) ? +wavPos.get(x).toFixed(2) : null,
      })),
      ignored: s.stats.ignored.map((x) => ({
        time: at(x.start).toISOString(),
        offsetSec: +x.start.toFixed(2),
        durationSec: +x.duration.toFixed(2),
        reason: x.reason,
        aboveRoomDb: +x.relDb.toFixed(1),
        peakDbfs: +x.peakDb.toFixed(1),
        lowFrequencyShare: +x.lowRatio.toFixed(3),
        highFrequencyShare: +x.highRatio.toFixed(3),
        centroidHz: Math.round(x.centroid),
        bursts: x.peaks,
        subBassShare: x.subBass == null ? null : +x.subBass.toFixed(3),
        loudFill: +x.fill.toFixed(2),
      })),
    };
    download(`snore-report_${stamp()}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  });

  el.copy.addEventListener('click', () => {
    const text = summaryText();
    const done = () => {
      el.copy.textContent = 'Copied';
      setTimeout(() => (el.copy.textContent = 'Copy summary'), 1600);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {}
      ta.remove();
      if (ok) done();
      else setStatus('Copying is blocked here. Select the text of the report instead.', true);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });

  window.addEventListener('resize', () => {
    for (const c of [el.liveTimeline, el.reportTimeline]) if (c._timeline && c.offsetParent) c._timeline.geo = c._timeline.draw(-1);
  });

  // Test hook: lets automated tests read the state of the page.
  window.__snorewatch = {
    get running() {
      return running;
    },
    summary: () => (session ? session.stats.summary(running ? session.detector.elapsed : session.elapsed) : null),
    stop,
  };

  $('app-version').textContent = `Snorewatch ${VERSION_TEXT}`;
  updateSourceUI();
})();
