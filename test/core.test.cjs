const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const sample = (extra = {}) => ({ id: 'old-a1', time: '2026-10-22 10:30', kol: '测试账号', asset: 'BTC', dir: '多', entry: '65000', note: '原话', result: 'pending', ...extra });

test('legacy arrays migrate without losing content', () => {
  const records = core.parseRecords([sample()]);
  assert.equal(records[0].id, 'old-a1');
  assert.equal(records[0].note, '原话');
  assert.equal(records[0].sourceUrl, '');
  assert.deepEqual(core.parseRecords({ version: 2, signals: records }), records);
});
test('invalid input is rejected atomically with record index', () => {
  for (const bad of [null, 3, [], { dir: '中立' }, { result: 'unknown' }, { kol: '' }, { time: 'yesterday' }, { note: {} }, { id: '" onclick="bad' }, { sourceUrl: 'javascript:alert(1)' }]) {
    assert.throws(() => core.parseRecords([sample(), bad === null || typeof bad !== 'object' || Array.isArray(bad) ? bad : sample(bad)]), /第 2 条/);
  }
  assert.throws(() => core.parseRecords({ version: 3, signals: [] }));
  assert.throws(() => core.parseRecords(Array(core.MAX_RECORDS + 1).fill(sample())));
  assert.throws(() => core.normalize(sample({ note: 'a'.repeat(10001) })));
});
test('imports deduplicate IDs and content while preserving current results', () => {
  const a = core.normalize(sample({ result: 'win' }));
  const b = core.normalize(sample({ result: 'lose' }));
  const c = core.normalize(sample({ id: 'copy', result: 'lose' }));
  const d = core.normalize(sample({ id: 'new', note: 'different' }));
  const merged = core.mergeRecords([a], [b, c, d, d]);
  assert.equal(merged.added, 1); assert.equal(merged.skipped, 3);
  assert.equal(merged.records[0].result, 'win');
  assert.equal(merged.records.length, 2);
});
test('imports enforce total record limit without changing existing records', () => {
  const existing = Array.from({ length: core.MAX_RECORDS }, (_, i) => core.normalize(sample({ id: 'a' + i, note: String(i) })));
  assert.throws(() => core.mergeRecords(existing, [core.normalize(sample({ id: 'new', note: 'new' }))]), /总数/);
  assert.equal(existing.length, core.MAX_RECORDS);
});

test('undo restores positions without reverting later verification changes or imports', () => {
  const before = ['a', 'b', 'c'].map(id => core.normalize(sample({ id, note: id })));
  const current = [{ ...before[1], result: 'lose' }, before[2], core.normalize(sample({ id: 'd', note: 'd' }))];
  const restored = core.restoreRecords(current, before);
  assert.deepEqual(restored.map(s => s.id), ['a', 'b', 'c', 'd']);
  assert.equal(restored[1].result, 'lose');
  assert.deepEqual(current.map(s => s.id), ['b', 'c', 'd']);
});

test('undo clear keeps newer values when a restored ID already exists', () => {
  const old = core.normalize(sample());
  const restored = core.restoreRecords([{ ...old, result: 'win' }], [old]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].result, 'win');
});
test('pending records do not affect historical proportions', () => {
  const c = core.compute([sample(), sample({ result: 'win' }), sample({ result: 'lose' })]);
  assert.equal(c.total, 3); assert.equal(c.decided, 2); assert.equal(c.pending, 1);
  assert.equal(c.wrongRate, .5); assert.equal(c.winRate, .5); assert.equal(c.stars, null);
  assert.equal(core.compute([]).wrongRate, null);
  assert.equal(core.compute([sample({ result: 'lose' })]).stars, null);
});
test('entertainment rating is withheld below 20 verified samples', () => {
  assert.equal(core.compute(Array(19).fill(sample({ result: 'lose' }))).stars, null);
  assert.equal(core.compute(Array(20).fill(sample({ result: 'lose' }))).stars, 18);
  assert.equal(core.compute(Array(20).fill(sample({ result: 'win' }))).stars, 0);
});
test('only exact Twitter and X post URLs are accepted', () => {
  assert.equal(core.tweetUrl('https://twitter.com/name/status/123?s=20').url, 'https://x.com/name/status/123');
  assert.equal(core.tweetUrl('x.com/name/status/123').id, '123');
  for (const url of ['https://evil.test/x.com/name/status/123', 'https://x.com.evil.test/name/status/123', 'https://name@x.com/name/status/123', 'javascript:alert(1)', 'https://x.com/name/status/123/anything', 'https://x.com/name/status/nope']) assert.equal(core.tweetUrl(url), null);
});
test('ambiguous and unknown tweet fields remain empty instead of reusing defaults', () => {
  const parsed = core.tweetUrl('https://x.com/name/status/123');
  const known = core.parseTweet({ tweet: { text: '看多 BTC', author: { screen_name: 'author' } } }, parsed);
  assert.equal(known.dir, '多'); assert.equal(known.asset, 'BTC'); assert.equal(known.entry, '');
  const unknown = core.parseTweet({ text: '今天的风景很好' }, parsed);
  assert.equal(unknown.dir, ''); assert.equal(unknown.asset, '');
  const ambiguous = core.parseTweet({ text: 'BTC 看多，ETH 看空' }, parsed);
  assert.equal(ambiguous.dir, ''); assert.equal(ambiguous.asset, '');
  assert.throws(() => core.parseTweet({ error: 'not found' }, parsed));
  assert.throws(() => core.parseTweet({ text: 123 }, parsed));
});
