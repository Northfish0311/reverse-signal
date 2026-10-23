const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const KEY = 'reverse-signal:v1';
const sample = (extra = {}) => ({ id: 'old1', time: '2026-10-22 10:30', kol: '测试账号', asset: 'BTC', dir: '多', entry: '65000', note: '原话', result: 'pending', ...extra });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function app(t, stored = [], fetcher) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'https://local.test/', runScripts: 'outside-only' });
  const w = dom.window;
  w.localStorage.setItem(KEY, typeof stored === 'string' ? stored : JSON.stringify(stored));
  w.confirm = () => true;
  w.fetch = fetcher || (() => Promise.reject(new Error('offline')));
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  t.after(() => w.close());
  const $ = id => w.document.getElementById(id);
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event('change', { bubbles: true })); };
  const submit = () => $('add-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const input = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); };
  return { w, $, change, submit, input, data: () => JSON.parse(w.localStorage.getItem(KEY)) };
}
test('legacy data renders as text, not executable HTML', t => {
  const { w, $, data } = app(t, [sample({ kol: '<img src=x onerror=bad()>', note: '<script>bad()</script>' })]);
  assert.equal($('stat-total').textContent, '1');
  assert.equal(w.document.querySelectorAll('#signal-body img, #signal-body script').length, 0);
  assert.match($('signal-body').textContent, /<script>bad/);
  assert.equal(data()[0].kol, '<img src=x onerror=bad()>');
});
test('create, edit, mark result and reset to pending preserve ID and original time', t => {
  const { w, $, input, submit, data } = app(t);
  input('f-kol', '账号 A'); input('f-asset', 'ETH'); input('f-dir', '多'); input('f-note', '测试原文'); submit();
  const original = data()[0]; assert.ok(original.id); assert.equal($('stat-total').textContent, '1');
  const result = w.document.querySelector('.result-select'); result.value = 'lose'; result.dispatchEvent(new w.Event('change'));
  assert.equal($('stat-confidence').textContent, '100%'); assert.equal($('stat-stars').textContent, '--');
  w.document.querySelector('.row-btn').click(); input('f-note', '已补充依据'); submit();
  assert.equal(data()[0].id, original.id); assert.equal(data()[0].time, original.time); assert.equal(data()[0].result, 'lose');
  assert.equal(data()[0].note, '已补充依据');
  const pending = w.document.querySelector('.result-select'); pending.value = 'pending'; pending.dispatchEvent(new w.Event('change'));
  assert.equal($('stat-confidence').textContent, '--');
});
test('failed persistence retains original data and unsaved form', t => {
  const { w, $, input, submit, data } = app(t, [sample()]);
  w.Storage.prototype.setItem = () => { throw new Error('quota'); };
  input('f-kol', 'new'); input('f-asset', 'ETH'); input('f-dir', '空'); submit();
  assert.equal(data().length, 1); assert.equal($('f-kol').value, 'new');
  assert.match($('notice').textContent, /保存失败/); assert.equal($('stat-total').textContent, '1');
});
test('corrupt storage is preserved until explicit clear', t => {
  const { w, $, input, submit } = app(t, '{broken');
  input('f-kol', 'new'); input('f-asset', 'ETH'); input('f-dir', '空'); submit();
  assert.equal(w.localStorage.getItem(KEY), '{broken'); assert.match($('notice').textContent, /停止写入/);
  $('btn-clear').click(); assert.equal(w.localStorage.getItem(KEY), '[]');
});
test('delete and undo preserve changes made to surviving records', t => {
  const { w, $, data } = app(t, [sample(), sample({ id: 'second', kol: '账号 B' })]);
  w.document.querySelector('.row-btn.danger').click(); assert.equal(data().length, 1);
  const select = w.document.querySelector('.result-select'); select.value = 'win'; select.dispatchEvent(new w.Event('change'));
  $('btn-undo').click(); assert.equal(data().length, 2); assert.equal(data().find(s => s.id === 'old1').result, 'win');
});
test('certificate updates after a result change and resets on KOL selection', t => {
  const { w, $, change } = app(t, [sample()]);
  change('cert-kol', '测试账号'); $('btn-cert').click(); assert.equal($('cert-output').hidden, false);
  const select = w.document.querySelector('.result-select'); select.value = 'lose'; select.dispatchEvent(new w.Event('change'));
  assert.match($('cert-output').textContent, /100%/); assert.match($('cert-output').textContent, /暂不评级/);
  change('cert-kol', ''); assert.equal($('cert-output').hidden, true);
});
test('new tweet clears old fields when direction and asset are unknown', async t => {
  const { $, input } = app(t, [], async () => ({ ok: true, json: async () => ({ tweet: { text: '风景不错' } }) }));
  input('f-asset', 'BTC'); input('f-dir', '多'); input('f-entry', '99');
  $('x-url').value = 'https://x.com/name/status/123'; $('btn-fetch-x').click(); await tick();
  assert.equal($('f-asset').value, ''); assert.equal($('f-dir').value, ''); assert.equal($('f-entry').value, '');
  assert.equal($('f-note').value, '风景不错'); assert.equal($('btn-fetch-x').disabled, false);
});
test('late response cannot overwrite manual edits', async t => {
  let resolve;
  const { $, input } = app(t, [], () => new Promise(r => { resolve = r; }));
  $('x-url').value = 'https://x.com/name/status/123'; $('btn-fetch-x').click(); input('f-kol', '手动账号');
  resolve({ ok: true, json: async () => ({ text: '看多 BTC' }) }); await tick();
  assert.equal($('f-kol').value, '手动账号'); assert.equal($('f-note').value, '');
});
test('invalid API payload falls back and fails visibly without stale data', async t => {
  let calls = 0;
  const { $, input } = app(t, [], async () => { calls++; return { ok: true, json: async () => ({ error: 'not found' }) }; });
  input('f-asset', 'BTC'); input('f-dir', '多'); $('x-url').value = 'https://x.com/name/status/123'; $('btn-fetch-x').click(); await tick();
  assert.equal(calls, 2); assert.match($('x-status').textContent, /读取失败/); assert.equal($('f-asset').value, '');
  assert.equal($('f-source').value, 'https://x.com/name/status/123');
});
test('imports are atomic and duplicate imports are skipped', async t => {
  const { w, $, data } = app(t, [sample()]);
  async function importText(text) {
    Object.defineProperty($('file-import'), 'files', { configurable: true, value: [{ size: text.length, text: async () => text }] });
    $('file-import').dispatchEvent(new w.Event('change')); await tick();
  }
  await importText(JSON.stringify([sample(), sample({ id: 'new', kol: 'new' })]));
  assert.equal(data().length, 2); assert.match($('notice').textContent, /新增 1 条，跳过重复 1 条/);
  await importText(JSON.stringify([sample({ id: 'valid' }), sample({ id: '<unsafe>' })]));
  assert.equal(data().length, 2); assert.match($('notice').textContent, /导入失败/);
});
test('other-tab changes block writes until reload', t => {
  const { w, $, input, submit, data } = app(t, [sample()]);
  w.dispatchEvent(new w.StorageEvent('storage', { key: KEY }));
  input('f-kol', 'new'); input('f-asset', 'ETH'); input('f-dir', '空'); submit();
  assert.equal(data().length, 1); assert.match($('notice').textContent, /停止写入/);
});
test('result filters do not bias the KOL historical proportions', t => {
  const { $, change } = app(t, [sample({ result: 'win' }), sample({ id: 'b', result: 'lose' })]);
  change('filter-result', 'lose');
  assert.equal($('record-count').textContent, '1 条');
  assert.equal($('stat-confidence').textContent, '50%');
  assert.equal($('stat-total').textContent, '2');
});
test('oversized new backups are rejected before changing stored data', t => {
  const records = Array.from({ length: 70 }, (_, i) => sample({ id: 'id' + i, note: '测'.repeat(10000) }));
  const { $, input, submit, data } = app(t, records);
  input('f-kol', 'new'); input('f-asset', 'BTC'); input('f-dir', '多'); submit();
  assert.equal(data().length, 70);
  assert.match($('notice').textContent, /备份容量上限/);
  assert.equal($('f-kol').value, 'new');
});
