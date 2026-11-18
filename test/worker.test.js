const test = require('node:test');
const assert = require('node:assert/strict');

// 予報の中継(worker/src/proxy.js)を、キャッシュと Open-Meteo を差し替えて確かめる。
const load = () => import('../worker/src/proxy.js');

const ORIGIN = 'https://finestella.com';
const BASE = 'https://api.finestella.com/v1/forecast';

function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(req) { return store.get(req.url)?.clone(); },
    async put(req, res) { store.set(req.url, res.clone()); },
  };
}

function setup({ upstream = () => new Response('{"ok":1}', { headers: { 'Content-Type': 'application/json' } }) } = {}) {
  const cache = memoryCache();
  const calls = [];
  let time = 1_000_000_000;
  const pending = [];
  const env = {
    cache,
    fetch: async (url, init) => { calls.push(url); return upstream(url, init, calls.length); },
    waitUntil: (p) => pending.push(p),
    now: () => time,
  };
  return {
    cache, calls, env,
    advance: (ms) => { time += ms; },
    settle: () => Promise.all(pending.splice(0)),
  };
}

const get = (query, origin = ORIGIN) => new Request(`${BASE}?${query}`, { headers: origin ? { Origin: origin } : {} });

test('同じ予報は2回目からキャッシュで返し、Open-Meteo には1回しか問い合わせない', async () => {
  const { handle } = await load();
  const s = setup();
  const first = await handle(get('latitude=36&longitude=138'), s.env);
  await s.settle();
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  assert.equal(await first.text(), '{"ok":1}');
  s.advance(60 * 1000);
  const second = await handle(get('latitude=36&longitude=138'), s.env);
  assert.equal(second.headers.get('X-Cache'), 'HIT');
  assert.equal(await second.text(), '{"ok":1}');
  assert.equal(s.calls.length, 1);
});

test('取得した時刻を X-Fetched-At で返し、キャッシュから返すときも最初に取得した時刻のまま', async () => {
  const { handle } = await load();
  const s = setup();
  const first = await handle(get('latitude=36&longitude=138'), s.env);
  await s.settle();
  const fetchedAt = first.headers.get('X-Fetched-At');
  s.advance(5 * 60 * 1000);
  const second = await handle(get('latitude=36&longitude=138'), s.env);
  assert.equal(second.headers.get('X-Fetched-At'), fetchedAt);
  assert.equal(second.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(second.headers.get('Access-Control-Expose-Headers'), /X-Fetched-At/);
});

test('「再読み込み」で足す _ とパラメーターの順番は、キャッシュの鍵にも Open-Meteo への URL にも含めない', async () => {
  const { handle } = await load();
  const s = setup();
  await handle(get('longitude=138&latitude=36&_=1'), s.env);
  await s.settle();
  const res = await handle(get('latitude=36&longitude=138&_=2'), s.env);
  assert.equal(res.headers.get('X-Cache'), 'HIT');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0], 'https://api.open-meteo.com/v1/forecast?latitude=36&longitude=138');
});

test('キャッシュが古くなったら Open-Meteo に取り直す', async () => {
  const { handle, FRESH_MS } = await load();
  const s = setup();
  await handle(get('latitude=36&longitude=138'), s.env);
  await s.settle();
  s.advance(FRESH_MS + 1);
  const res = await handle(get('latitude=36&longitude=138'), s.env);
  assert.equal(res.headers.get('X-Cache'), 'MISS');
  assert.equal(s.calls.length, 2);
});

test('Open-Meteo が応答しないときは、2回試してから古いキャッシュを返す', async () => {
  const { handle, FRESH_MS } = await load();
  let down = false;
  const s = setup({
    upstream: () => {
      if (down) throw new Error('timeout');
      return new Response('{"old":1}');
    },
  });
  const first = await handle(get('latitude=36&longitude=138'), s.env);
  await s.settle();
  const fetchedAt = first.headers.get('X-Fetched-At');
  down = true;
  s.advance(FRESH_MS + 1);
  const res = await handle(get('latitude=36&longitude=138'), s.env);
  assert.equal(res.headers.get('X-Cache'), 'STALE');
  assert.equal(res.headers.get('X-Fetched-At'), fetchedAt);
  assert.equal(await res.text(), '{"old":1}');
  assert.equal(s.calls.length, 3);
});

test('1回目が応答しなくても、2回目で取れれば予報を返す', async () => {
  const { handle } = await load();
  const s = setup({
    upstream: (url, init, n) => {
      if (n === 1) throw new Error('timeout');
      return new Response('{"ok":2}');
    },
  });
  const res = await handle(get('latitude=36&longitude=138'), s.env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"ok":2}');
});

test('Open-Meteo につながらず、使えるキャッシュもなければ 504 を返す', async () => {
  const { handle, STALE_MS } = await load();
  let down = false;
  const s = setup({ upstream: () => { if (down) throw new Error('timeout'); return new Response('{}'); } });
  await handle(get('latitude=36&longitude=138'), s.env);
  await s.settle();
  down = true;
  s.advance(STALE_MS + 1);
  const res = await handle(get('latitude=36&longitude=138'), s.env);
  assert.equal(res.status, 504);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('失敗の応答(429 など)はキャッシュせず、そのまま返す', async () => {
  const { handle } = await load();
  const s = setup({ upstream: () => new Response('{"error":true}', { status: 429 }) });
  const res = await handle(get('latitude=36&longitude=138'), s.env);
  await s.settle();
  assert.equal(res.status, 429);
  assert.equal(s.cache.store.size, 0);
});

test('FineStella と手元の開発環境以外からの利用は断る', async () => {
  const { handle } = await load();
  const s = setup();
  assert.equal((await handle(get('latitude=36', 'https://example.com'), s.env)).status, 403);
  assert.equal((await handle(get('latitude=36', null), s.env)).status, 403);
  assert.equal((await handle(get('latitude=36', 'http://localhost:8000'), s.env)).status, 200);
  assert.equal(s.calls.length, 1);
});

test('予報以外の API は中継しない', async () => {
  const { handle } = await load();
  const s = setup();
  const res = await handle(new Request('https://api.finestella.com/v1/archive?latitude=36', { headers: { Origin: ORIGIN } }), s.env);
  assert.equal(res.status, 404);
  assert.equal(s.calls.length, 0);
});
