'use strict';
// The night store contract (js/night-store.js). `contract()` is written against
// the interface only, so a later IndexedDB store can run the same tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/detector.js');
const Synth = require('../js/synth.js');
const { createMemoryStore } = require('../js/night-store.js');

const snore = (id, start, extra) => ({
  id,
  start,
  end: start + 1,
  duration: 1,
  isSnore: true,
  confirmed: false,
  relDb: 20,
  clip: new Int16Array([1, 2, 3]),
  ...extra,
});

function contract(name, makeStore) {
  test(`${name}: nights are created, listed newest first, loaded and deleted`, async () => {
    const store = makeStore();
    const a = await store.create({ startWall: Date.parse('2026-10-01T22:00:00Z'), source: 'mic', version: 'test' });
    const b = await store.create({ startWall: Date.parse('2026-10-02T22:00:00Z'), source: 'demo', version: 'test' });
    assert.deepEqual(
      (await store.list()).map((n) => n.id),
      [b, a],
    );
    const loaded = await store.load(a);
    assert.equal(loaded.meta.source, 'mic');
    assert.equal(loaded.complete, false);
    await store.delete(a);
    assert.equal(await store.load(a), null);
    assert.deepEqual(
      (await store.list()).map((n) => n.id),
      [b],
    );
  });

  test(`${name}: events are stored without audio and updated by id`, async () => {
    const store = makeStore();
    const id = await store.create({ startWall: 0, source: 'mic' });
    await store.appendEvents(id, [snore(1, 2), snore(2, 6)]);
    // Confirmation arrives later, as in SessionStats: the same events again, now confirmed.
    await store.appendEvents(id, [snore(1, 2, { confirmed: true }), snore(2, 6, { confirmed: true })]);
    const n = await store.load(id);
    assert.equal(n.events.length, 2);
    assert.ok(n.events.every((e) => e.confirmed));
    assert.ok(
      n.events.every((e) => !('clip' in e)),
      'no audio inside events',
    );
    assert.equal((await store.list())[0].snoreCount, 2);
    await assert.rejects(store.appendEvents(id, [{ start: 1 }]), /id/);
  });

  test(`${name}: only accepted snores keep audio`, async () => {
    const store = makeStore();
    const id = await store.create({ startWall: 0, source: 'mic' });
    await store.appendEvents(id, [snore(1, 2), { id: 2, start: 5, isSnore: false, reason: 'too-bright', clip: null }]);
    await store.appendClip(id, 1, new Int16Array([5, -5]), 8000);
    await assert.rejects(store.appendClip(id, 2, new Int16Array([9]), 8000), /Only accepted snores/);
    await assert.rejects(store.appendClip(id, 99, new Int16Array([9]), 8000), /Only accepted snores/);
    const n = await store.load(id);
    assert.deepEqual([...n.clips.keys()], [1]);
    assert.deepEqual(Array.from(n.clips.get(1).clip), [5, -5]);
  });

  test(`${name}: a finalized night is read only; an unfinished one stays listed for recovery`, async () => {
    const store = makeStore();
    const done = await store.create({ startWall: 1000, source: 'mic' });
    const crashed = await store.create({ startWall: 2000, source: 'mic' });
    await store.appendEvents(crashed, [snore(1, 2)]);
    await store.finalize(done, { endWall: 5000, summary: { snoreCount: 0 }, snores: [snore(1, 2)], stats: {} });
    await assert.rejects(store.appendEvents(done, [snore(3, 4)]), /finalized/);
    const list = await store.list();
    assert.deepEqual(
      list.map((n) => [n.id, n.complete]),
      [
        [crashed, false],
        [done, true],
      ],
    );
    const rec = (await store.load(done)).record;
    assert.equal(rec.endWall, 5000);
    assert.ok(!('snores' in rec) && !('stats' in rec), 'events and derived views are not duplicated in the record');
  });

  test(`${name}: a whole demo night goes in and comes back`, async () => {
    const sc = Synth.demoScenario(16000);
    const stats = new Core.SessionStats();
    const det = new Core.SnoreDetector(16000, { onEvent: (e) => stats.add(e) });
    det.process(sc.samples);
    det.flush();
    const store = makeStore();
    const id = await store.create({ startWall: 0, source: 'demo' });
    const all = [...stats.snores, ...stats.ignored];
    await store.appendEvents(id, all);
    for (const s of stats.snores) if (s.clip) await store.appendClip(id, s.id, s.clip, s.clipRate);
    await store.finalize(id, { endWall: 90000, summary: stats.summary(90) });
    const n = await store.load(id);
    assert.equal(n.events.length, all.length);
    assert.equal(n.events.filter((e) => e.isSnore && e.confirmed).length, 16);
    assert.equal(n.clips.size, stats.snores.filter((s) => s.clip).length);
    assert.equal(n.record.summary.snoreCount, 16);
  });
}

contract('memory store', createMemoryStore);
