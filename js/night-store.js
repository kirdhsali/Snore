/*
 * Snorewatch night store: the interface for keeping nights on the device,
 * plus an in-memory implementation. Not wired into the page yet; a browser
 * implementation (IndexedDB) and saved-night history build on this contract.
 *
 * Contract (every method is async, so a database-backed store fits):
 *   create(meta)                     → id   start a night (meta: startWall, source, version, sensitivity, …)
 *   appendEvents(id, events)                 add or update decided events by their `id`; a snore's
 *                                            confirmation can change when a later neighbour arrives
 *   appendClip(id, eventId, clip, clipRate)  keep the audio of an accepted snore
 *   finalize(id, record)                     the finished night (summary, endWall, gaps, …); then read only
 *   list()                           → [{id, startWall, endWall, source, complete, snoreCount}], newest first
 *   load(id)                         → {meta, events, clips: Map(eventId → {clip, clipRate}), complete, record} or null
 *   delete(id)                               remove the night and its audio
 *
 * Privacy rule (the app's promise): only accepted snores keep audio. Events are
 * stored without audio, and appendClip refuses anything that is not a stored
 * snore. A night that was never finalized (crash, reload) stays listed with
 * complete: false, so it can be recovered.
 * No browser dependencies (window.SnoreStore / require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoreStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** An event as stored: its own fields, never audio. */
  function stripAudio(ev) {
    const out = {};
    for (const [k, v] of Object.entries(ev)) {
      if (k === 'clip' || ArrayBuffer.isView(v)) continue;
      out[k] = v;
    }
    return out;
  }

  function createMemoryStore() {
    const nights = new Map();
    let counter = 0;

    function get(id) {
      const n = nights.get(id);
      if (!n) throw new Error(`No night ${id}`);
      return n;
    }
    function writable(id) {
      const n = get(id);
      if (n.complete) throw new Error(`Night ${id} is finalized`);
      return n;
    }

    return {
      async create(meta) {
        const id = meta.id || `night-${new Date(meta.startWall).toISOString()}-${++counter}`;
        if (nights.has(id)) throw new Error(`Night ${id} exists`);
        nights.set(id, { meta: { ...meta, id }, events: new Map(), clips: new Map(), complete: false, record: null });
        return id;
      },

      async appendEvents(id, events) {
        const n = writable(id);
        for (const ev of events) {
          if (ev.id == null) throw new Error('Events need an id');
          n.events.set(ev.id, stripAudio(ev));
        }
      },

      async appendClip(id, eventId, clip, clipRate) {
        const n = writable(id);
        const ev = n.events.get(eventId);
        if (!ev || !ev.isSnore) throw new Error('Only accepted snores keep audio');
        n.clips.set(eventId, { clip: Int16Array.from(clip), clipRate });
      },

      async finalize(id, record) {
        const n = writable(id);
        n.record = stripRecord(record);
        n.complete = true;
      },

      async list() {
        return [...nights.values()]
          .map((n) => ({
            id: n.meta.id,
            startWall: n.meta.startWall,
            endWall: n.record ? n.record.endWall : null,
            source: n.meta.source,
            complete: n.complete,
            snoreCount: [...n.events.values()].filter((e) => e.isSnore && e.confirmed).length,
          }))
          .sort((a, b) => b.startWall - a.startWall);
      },

      async load(id) {
        const n = nights.get(id);
        if (!n) return null;
        return {
          meta: { ...n.meta },
          events: [...n.events.values()].map((e) => ({ ...e })).sort((a, b) => a.start - b.start),
          clips: new Map([...n.clips].map(([k, v]) => [k, { clip: Int16Array.from(v.clip), clipRate: v.clipRate }])),
          complete: n.complete,
          record: n.record && { ...n.record },
        };
      },

      async delete(id) {
        nights.delete(id);
      },
    };
  }

  /** The finished-night fields worth keeping: plain data only, no event lists or audio (those are stored separately). */
  function stripRecord(record) {
    const keep = {};
    for (const [k, v] of Object.entries(record || {})) {
      if (k === 'snores' || k === 'ignored' || k === 'stats' || typeof v === 'function') continue;
      keep[k] = v;
    }
    return JSON.parse(JSON.stringify(keep));
  }

  return { createMemoryStore, stripAudio };
});
