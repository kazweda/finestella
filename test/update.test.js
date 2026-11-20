const test = require('node:test');
const assert = require('node:assert/strict');
require('../update.js');
require('../timeline.js');
const { Update, Timeline } = globalThis;

const page = (id) => `<script src="forecast.js?v=${id}"></script>\n<script src="app.js?v=${id}"></script>`;
const fakeFetch = (body, ok = true) => async () => ({ ok, text: async () => body });

test('index.html から配信の版の ID を取り出す。手元の __BUILD__ は版がないものとして扱う', () => {
  assert.equal(Update.parseBuild(page('ec2f80b')), 'ec2f80b');
  assert.equal(Update.parseBuild('app.js?v=ec2f80b'), 'ec2f80b');
  assert.equal(Update.parseBuild(page('__BUILD__')), null);
  assert.equal(Update.parseBuild('<p>no script</p>'), null);
});

test('サーバーの版が今と違えば読み込み直し、同じなら何もしない', async () => {
  let reloaded = 0;
  const run = (body, current = 'aaa1111') => Update.reloadIfUpdated({
    current, fetch: fakeFetch(body), url: '/', reload: () => { reloaded++; },
  });
  assert.equal(await run(page('bbb2222')), true);
  assert.equal(reloaded, 1);
  assert.equal(await run(page('aaa1111')), false);
  assert.equal(await run(page('__BUILD__')), false, 'サーバーの版が読めなければ読み込み直さない');
  assert.equal(await run(page('bbb2222'), null), false, '手元で開いたときは確かめない');
  assert.equal(reloaded, 1);
});

test('確かめられないとき(通信の失敗・エラーの応答)は、今の版のまま使い続ける', async () => {
  const errors = [];
  const failing = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await Update.reloadIfUpdated({ current: 'aaa1111', fetch: failing, url: '/', reload: () => assert.fail(), logError: (e) => errors.push(e) }), false);
  assert.equal(errors.length, 1);
  assert.equal(await Update.reloadIfUpdated({ current: 'aaa1111', fetch: fakeFetch('', false), url: '/', reload: () => assert.fail() }), false);
});

test('タイムラインをタップした位置を時刻の番号にする(左端の層の名前の部分は最初の時刻)', () => {
  const n = 72;
  const width = Timeline.LABEL_W + 720; // 1時間 = 10px
  assert.equal(Timeline.indexAt(0, width, n), 0);
  assert.equal(Timeline.indexAt(Timeline.LABEL_W + 15, width, n), 1);
  assert.equal(Timeline.indexAt(width + 50, width, n), n - 1);
});
