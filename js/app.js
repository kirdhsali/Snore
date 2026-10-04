/* Snorewatch page: live view, night screen, report, sharing and downloads. Recording itself is js/recorder.js. */
(function () {
  'use strict';

  const { encodeWav, REASONS } = window.SnoreCore;
  const Charts = window.SnoreCharts;
  const Share = window.SnoreShare;
  const Report = window.SnoreReport;
  const Recorder = window.SnoreRecorder;
  const EMBED = !!window.SNOREWATCH_EMBED;
  const LIVE_SECONDS = 30;
  let liveClipLimit = 6; // snore cards shown while recording
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
    shadowNote: $('shadow-note'),
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
    dlTestWav: $('dl-test-wav'),
    copy: $('copy-summary'),
    sharePreview: $('share-preview'),
    shareImage: $('share-image'),
    shareReport: $('share-report'),
    shareHint: $('share-hint'),
    goDark: $('go-dark'),
    night: $('night'),
    nightInfo: $('night-info'),
    nightClock: $('night-clock'),
    nightMeta: $('night-meta'),
    intro: $('intro'),
    checklist: $('checklist'),
  };

  const HINTS = {
    mic: 'Uses your microphone. Put the device within 1–2 m of your head and plug it in. The screen stays on while recording but turns black after 20 s.',
    demo: 'Demo: plays a simulated 90-second night through the speakers (snoring mixed with talking, knocking, a passing car and a cough). Only the snores should be counted.',
  };
  const SOURCE_NAMES = { mic: 'Microphone recording', demo: 'Demo night (simulated sounds)' };

  // The recorder (js/recorder.js) owns audio, detectors, interruptions and the wake lock.
  // The page keeps only what it shows: the live view state and the last finished night.
  let session = null; // the recorder's night in progress (read only here)
  let live = null; // live view state: last 30 s of frames, the pill's last verdict, cards to draw
  let night = null; // the last finished night (frozen record); the report, sharing and downloads read only this
  let clockStart = 0; // wall time (ms) of second 0 of the night on screen, live or in the report
  let running = false; // recording or interrupted
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
    return new Date(clockStart + sec * 1000);
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

  window.addEventListener('beforeunload', (e) => {
    if (running) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- session ----------
  const recorder = Recorder.createRecorder({
    version: VERSION_TEXT,
    onState,
    onFrame: handleFrame,
    onEvent: handleEvent,
    onWakeLock: showRecordingStatus,
  });

  function onState(state, rec) {
    const wasRunning = running;
    running = rec.recording;
    session = rec.session;
    if (running && !wasRunning) {
      clockStart = session.startWall;
      live = { frames: [], frameCap: Math.ceil(LIVE_SECONDS / session.detector.hopSec), lastFrame: null, lastVerdict: null, newClips: [] };
      showLive();
      loop();
    }
    if (running) showRecordingStatus();
    if (state === 'completed') {
      night = rec.night;
      endNight();
      showReport();
    }
  }

  async function start() {
    if (recorder.state === 'requesting' || running) return;
    stopClip();
    const source = currentSource();
    el.rec.disabled = true;
    setStatus(source === 'mic' ? 'Waiting for microphone permission…' : 'Preparing audio…');
    try {
      await recorder.start({ source, sensitivity: el.sensitivity.value });
    } catch (err) {
      // The last finished night stays as it was: the report and its downloads keep working.
      console.error(err);
      let msg = err && err.message ? err.message : String(err);
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        msg = 'Microphone access was blocked. Allow it in the browser’s site settings, then tap Start again.';
      } else if (err && err.name === 'NotFoundError') {
        msg = 'No microphone found. Connect one, then tap Start again.';
      }
      setStatus(msg, true);
    } finally {
      el.rec.disabled = false;
    }
  }

  function stop() {
    recorder.stop(); // the 'completed' state shows the report
  }

  el.rec.addEventListener('click', () => (running ? stop() : start()));

  // ---------- interruptions ----------
  // The recorder notices when the system pauses or stops the microphone and
  // keeps trying to resume; the page says so.
  const RECORDING_TEXT = {
    mic: 'Recording. Everything stays on this device; only short snore clips are kept. The screen darkens after 20 s; tap it to look. Tap Stop in the morning.',
    demo: 'Playing the demo night. The report appears when it ends, or tap Stop.',
  };

  function gapSeconds(n) {
    return n.gaps.reduce((sum, g) => sum + (g.end - g.start) / 1000, 0);
  }

  function showRecordingStatus() {
    if (!running || !session) return;
    if (dark) nightText();
    const s = session;
    const wakeLockState = recorder.wakeLockState;
    if (s.gap && s.gap.reason === 'ended') {
      setStatus('The system switched the microphone off, so nothing is being recorded. Tap Stop for the report of the night so far.', true);
    } else if (s.gap) {
      setStatus('Recording interrupted: the system paused the microphone. Trying to resume…', true);
    } else if (s.source === 'mic' && (wakeLockState === 'failed' || wakeLockState === 'unsupported')) {
      setStatus(
        'Recording, but this browser did not let the app keep the screen on. If the screen locks, recording stops: set Auto-Lock to Never for tonight.',
        true,
      );
    } else {
      setStatus(RECORDING_TEXT[s.source]);
    }
  }

  // ---------- live ----------
  function handleFrame(f) {
    const v = live;
    v.lastFrame = f;
    v.frames.push({ index: f.index, db: f.db, trigger: f.trigger, cls: f.active ? 'p' : 'q' });
    if (v.frames.length > v.frameCap) v.frames.splice(0, v.frames.length - v.frameCap);
  }

  /** A decided event (the recorder has already counted it). */
  function handleEvent(ev) {
    const v = live;
    const det = recorder.session.detector;
    const cls = ev.isSnore ? 's' : 'i';
    // Sounds waiting for a snore in rhythm are decided later, so recolor only this event's frames.
    const lastFrame = ev.endFrame + Math.ceil(det.opts.hangoverSec / det.hopSec) + 1;
    for (let i = v.frames.length - 1; i >= 0 && v.frames[i].index >= ev.startFrame; i--) {
      if (v.frames[i].index <= lastFrame && v.frames[i].cls === 'p') v.frames[i].cls = cls;
    }
    v.lastVerdict = { ev, t: ev.end };
    if (ev.isSnore) {
      // Only the newest cards are ever shown, so a long dark night queues no more than that.
      v.newClips.push(ev);
      if (v.newClips.length > liveClipLimit) v.newClips.splice(0, v.newClips.length - liveClipLimit);
    }
  }

  function showLive() {
    el.report.hidden = true;
    el.intro.hidden = true;
    el.checklist.hidden = true;
    el.live.hidden = false;
    el.rec.classList.add('is-on');
    el.rec.setAttribute('aria-pressed', 'true');
    el.recLabel.textContent = 'Stop';
    el.goDark.hidden = false;
    el.controls.classList.add('is-locked');
    // Locked for keyboards too: the background tests start with the same setting and must keep it.
    el.sensitivity.disabled = true;
    el.liveClips.innerHTML = '<p class="empty">Snores appear here as soon as they are detected.</p>';
    renderLiveTiles();
    renderTimeline(session.stats, el.liveTimeline, el.liveBucket, session.detector.clock);
    scheduleDark();
  }

  // ---------- night screen ----------
  // The page cannot record with the screen off (iOS stops the microphone), so
  // while recording it turns the screen black instead. A tap shows the app again.
  let darkDelay = 20000;
  let darkTimer = null;
  let nightTimer = null;
  let dark = false;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const themeColor = themeMeta ? themeMeta.content : null;

  function scheduleDark() {
    clearTimeout(darkTimer);
    // Only real recordings darken on their own; a demo shown to someone stays visible.
    if (running && !dark && session.source === 'mic') darkTimer = setTimeout(goDark, darkDelay);
  }

  function goDark() {
    if (!running || dark) return;
    dark = true;
    el.night.hidden = false;
    if (themeMeta) themeMeta.content = '#000000';
    updateNight();
    nightTimer = setInterval(updateNight, 60000);
    el.night.focus({ preventScroll: true });
  }

  function wake() {
    if (!dark) return;
    dark = false;
    el.night.hidden = true;
    if (themeMeta) themeMeta.content = themeColor;
    clearInterval(nightTimer);
    scheduleDark();
  }

  function endNight() {
    clearTimeout(darkTimer);
    wake();
    clearTimeout(darkTimer);
  }

  /** The night screen's line follows the recorder, so a dark screen never claims a recording that has stopped. */
  function nightText() {
    if (!session) return;
    const n = session.stats.summary(session.detector.elapsed).snoreCount;
    const count = `${fmtNum(n)} snore${n === 1 ? '' : 's'}`;
    const g = session.gap;
    el.nightMeta.textContent = !g
      ? `Recording · ${count}`
      : g.reason === 'ended'
        ? 'Microphone off · tap, then Stop'
        : `Interrupted · trying to resume · ${count}`;
  }

  /** Dim clock and count, moved a little each minute so nothing burns into an OLED screen. */
  function updateNight() {
    el.nightClock.textContent = fmtTime(new Date());
    nightText();
    el.nightInfo.style.left = `${8 + Math.random() * 40}%`;
    el.nightInfo.style.top = `${10 + Math.random() * 65}%`;
  }

  // A tap on the black screen only wakes it; it never reaches the buttons underneath.
  el.night.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wake();
  });
  el.night.addEventListener('keydown', (e) => {
    e.preventDefault();
    wake();
  });
  el.goDark.addEventListener('click', goDark);
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) {
    document.addEventListener(type, () => running && !dark && scheduleDark(), { passive: true });
  }

  let lastSlow = 0;
  function loop(now) {
    if (!running) return;
    if (dark) {
      // Nothing is visible: skip drawing to save battery. Detection keeps running.
      requestAnimationFrame(loop);
      return;
    }
    const s = session;
    Charts.drawLive(el.liveCanvas, live.frames, live.frameCap, LIVE_SECONDS);
    updatePill();
    if (live.newClips.length) {
      const empty = el.liveClips.querySelector('.empty');
      if (empty) empty.remove();
      for (const ev of live.newClips) {
        const card = clipCard(ev, true);
        el.liveClips.prepend(card);
      }
      while (el.liveClips.children.length > liveClipLimit) el.liveClips.lastChild.remove();
      live.newClips = [];
      lastSlow = 0;
    }
    if (!now || now - lastSlow > 1000) {
      lastSlow = now || 0;
      renderLiveTiles();
      renderTimeline(s.stats, el.liveTimeline, el.liveBucket, s.detector.clock, el.liveTip);
    }
    requestAnimationFrame(loop);
  }

  function updatePill() {
    const s = session;
    const f = live.lastFrame;
    let state = 'listening';
    let text = 'Listening';
    const v = live.lastVerdict;
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
      tile(
        'Snores',
        fmtNum(sum.snoreCount),
        possibleNote(sum) || (sum.medianInterval ? `about every ${sum.medianInterval.toFixed(1)} s` : 'in breathing rhythm'),
        true,
      ),
      tile(
        'Snores per hour',
        sum.elapsed >= 30 ? fmtNum(sum.snoresPerHour) : '–',
        sum.elapsed < 600 ? 'estimate, still settling' : 'average so far',
      ),
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

  function renderTimeline(stats, canvas, subEl, elapsed, tipEl) {
    const size = bucketSize(elapsed);
    // Show at least 12 slots so a short session doesn't draw one giant column.
    const buckets = stats.buckets(Math.max(elapsed, size * 12), size);
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
    } catch {}
    const wav = encodeWav([ev.clip], ev.clipRate, 0);
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
    const n = night;
    const sum = n.summary;
    clockStart = n.startWall;
    el.live.hidden = true;
    el.goDark.hidden = true;
    el.report.hidden = false;
    el.rec.classList.remove('is-on', 'is-snore');
    el.rec.setAttribute('aria-pressed', 'false');
    el.rec.style.setProperty('--lvl', 0);
    el.recLabel.textContent = 'Start';
    el.controls.classList.remove('is-locked');
    el.sensitivity.disabled = false;
    setStatus('Recording stopped. Your report is below. Tap Start for a new recording.');

    el.reportSource.textContent = SOURCE_NAMES[n.source];
    const start = at(0);
    const end = new Date(n.endWall);
    const day = start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const lost = gapSeconds(n);
    el.reportRange.textContent =
      `${day}, ${fmtTime(start)} – ${fmtTime(end)} · ${fmtSpan(n.capturedSeconds)}` +
      (n.gaps.length ? ` recorded · interrupted ${n.gaps.length}× (${fmtSpan(lost)} not recorded)` : '');
    el.verdict.textContent = verdictText(sum);
    el.shadowNote.hidden = false;
    el.shadowNote.textContent = `Background tests, not counted yet: with the breath-noise rule ${fmtNum(
      n.shadows.breath.summary.snoreCount,
    )} snores (stricter rule: ${fmtNum(n.shadows.breath6.summary.snoreCount)}); with automatic sensitivity (breath-noise and snore-band rules) ${fmtNum(
      n.shadows.auto.summary.snoreCount,
    )} (this recording, ${n.sensitivity}: ${fmtNum(sum.snoreCount)}). Details are in the data file.`;

    el.reportTiles.innerHTML = [
      tile(
        'Snores',
        fmtNum(sum.snoreCount),
        possibleNote(sum) || (sum.medianInterval ? `typically every ${sum.medianInterval.toFixed(1)} s` : ''),
        true,
      ),
      tile(
        'Snores per hour',
        n.capturedSeconds >= 30 ? fmtNum(sum.snoresPerHour) : '–',
        n.capturedSeconds < 600 ? 'short recording, rough estimate' : '',
      ),
      tile('Snoring time', fmtSpan(sum.snoreSeconds), `${fmtNum(sum.snorePercent, 1)}% of the recording`),
      tile(
        'Loudest snore',
        sum.snoreCount ? `+${fmtNum(sum.maxRelDb)}<small>dB</small>` : '–',
        sum.snoreCount ? `average +${fmtNum(sum.meanRelDb)} dB above room noise` : '',
      ),
      tile('Snoring episodes', fmtNum(sum.episodes.length), sum.longestEpisode ? `longest ${fmtSpan(sum.longestEpisode)}` : ''),
      tile('Ignored sounds', fmtNum(sum.ignoredCount), 'not recorded'),
    ].join('');

    requestAnimationFrame(() => renderTimeline(n.stats, el.reportTimeline, el.reportBucket, n.clockSeconds, el.reportTip));

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
              `<tr><td>${fmtTime(at(e.start), n.clockSeconds < 3600)}</td><td>${fmtSpan(e.duration)}</td><td>${e.count}</td><td>${e.interval.toFixed(
                1,
              )} s</td><td>+${e.meanRelDb.toFixed(0)} dB</td></tr>`,
          )
          .join('')}</tbody>`
      : '<tbody><tr><td class="empty">No snoring episodes.</td></tr></tbody>';

    el.reportClips.innerHTML = '';
    const loudest = n.stats.confirmed
      .filter((x) => x.clip)
      .sort((a, b) => b.relDb - a.relDb)
      .slice(0, 8);
    if (loudest.length) loudest.forEach((ev) => el.reportClips.append(clipCard(ev, false)));
    else el.reportClips.innerHTML = '<p class="empty">No snores were recorded.</p>';

    el.dlWav.disabled = !n.snores.some((x) => x.clip);
    el.dlTestWav.hidden = EMBED || !testClips(n).length;
    prepareShare(n);
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
  async function prepareShare(n) {
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
        startWall: n.startWall,
        elapsed: n.clockSeconds, // the image and report draw the night on its clock
        captured: n.capturedSeconds, // … and say how much of it was actually recorded
        gaps: n.gaps.map((g) => ({ start: g.clock, end: g.clock + (g.end - g.start) / 1000 })),
        snores: n.stats.confirmed,
        summary: n.summary,
        version: n.version,
        sensitivity: n.sensitivity,
        sourceLabel: SOURCE_NAMES[n.source],
        reasons: REASONS,
      };
      const canvas = Share.drawShareCard(document.createElement('canvas'), data);
      const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      data.heroImage = canvas.toDataURL('image/jpeg', 0.82);
      data.samples = Share.pickSamples(n.stats.confirmed, 8, 5);
      const html = Share.buildReportHtml(data);
      if (night !== n) return;
      shareFiles = {
        image: new File([png], `snore-night_${stamp()}.png`, { type: 'image/png' }),
        report: new File([html], `snore-report_${stamp()}.html`, { type: 'text/html' }),
      };
      if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl);
      sharePreviewUrl = URL.createObjectURL(png);
      el.sharePreview.src = sharePreviewUrl;
      el.shareImage.disabled = false;
      el.shareReport.disabled = false;
      const playable = data.samples.loud.length + data.samples.random.length;
      if (EMBED) {
        el.shareHint.textContent = 'Open the app from its own address to share the image or the full report.';
        return;
      }
      el.shareHint.textContent = `The report is one file (${Math.max(1, Math.round(shareFiles.report.size / 1024))} KB)${
        playable ? ` with ${playable} snores to play` : ''
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
    const sum = night.summary;
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
  // Snores in time order; they can be decided out of order (rhythm rescue).
  const inTimeOrder = (list) => [...list].sort((a, b) => a.start - b.start);

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

  // Downloads and the summary always describe the last finished night.
  const finished = () => night !== null;

  el.dlWav.addEventListener('click', () => {
    if (!finished()) return;
    const snores = inTimeOrder(night.snores).filter((x) => x.clip);
    if (!snores.length) return;
    // Clips come with their volume evened out (clipFromAudio); the JSON keeps the real levels.
    const wav = encodeWav(
      snores.map((x) => x.clip),
      snores[0].clipRate,
      WAV_GAP_SEC,
    );
    download(`snores_${stamp()}.wav`, new Blob([wav], { type: 'audio/wav' }));
  });

  /** The auto test's sample of snores the counting detector did not find, in time order. */
  const testClips = (n) => inTimeOrder(Object.values(n.shadows).flatMap((sh) => sh.snores.filter((x) => x.clip)));

  el.dlTestWav.addEventListener('click', () => {
    if (!finished()) return;
    const clips = testClips(night);
    if (!clips.length) return;
    const wav = encodeWav(
      clips.map((x) => x.clip),
      clips[0].clipRate,
      WAV_GAP_SEC,
    );
    download(`test-clips_${stamp()}.wav`, new Blob([wav], { type: 'audio/wav' }));
  });

  el.dlJson.addEventListener('click', () => {
    if (!finished()) return;
    const data = Report.toReport({
      ...night,
      wavStarts: wavPositions(inTimeOrder(night.snores)),
      testWavStarts: wavPositions(testClips(night)),
    });
    download(`snore-report_${stamp()}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  });

  el.copy.addEventListener('click', () => {
    if (!finished()) return;
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
      } catch {}
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
    summary: () => (running ? session.stats.summary(session.detector.elapsed) : night && night.summary),
    stop,
    get dark() {
      return dark;
    },
    setDarkDelay(ms) {
      darkDelay = ms;
      scheduleDark();
    },
    setLiveClipLimit(n) {
      liveClipLimit = n;
    },
    get pendingCards() {
      return live ? live.newClips.length : 0;
    },
    get night() {
      return (
        night && {
          id: night.id,
          frozen: Object.isFrozen(night),
          sampleRate: night.sampleRate,
          timeZone: night.timeZone,
          clockSeconds: night.clockSeconds,
          snores: night.snores.length,
        }
      );
    },
    get audio() {
      return session && { ctx: session.ctx, stream: session.stream, gap: session.gap, gaps: session.gaps.length };
    },
    get sensitivities() {
      return (
        session && {
          main: session.detector.sensitivity,
          ...Object.fromEntries(Object.entries(session.shadows).map(([k, sh]) => [k, sh.detector.sensitivity])),
        }
      );
    },
  };

  $('app-version').textContent = `Snorewatch ${VERSION_TEXT}`;
  updateSourceUI();
})();
