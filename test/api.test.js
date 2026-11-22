const test = require('node:test');
const assert = require('node:assert/strict');
require('../forecast.js');
require('../i18n.js');
require('../api.js');
const { Api, Forecast, I18n } = globalThis;

const { t } = I18n.create('ja');
const HOURS = ['2026-11-20T00:00', '2026-11-20T01:00'];
const NOW = 1_800_000_000_000;

// 中継と Open-Meteo の代わり。route(url) が { status, body, headers } か、例外(通信の失敗)を返す。
function fakeFetch(route) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const r = route(url);
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Map(Object.entries(r.headers || {})),
      json: async () => r.body,
    };
  };
  return { fetch, calls };
}

const center = { timezone: 'Asia/Tokyo', hourly: { time: HOURS, cloud_cover: [10, 20] } };
const gridBody = (n = 49) => Array.from({ length: n }, () => ({ hourly: { time: HOURS, cloud_cover: [0, 0] } }));
// latitude にカンマがあれば格子(49地点)、なければ目的地(1地点)。
const isGrid = (url) => new URL(url).searchParams.get('latitude').includes(',');

const client = (fetch, opts = {}) => Api.createClient({
  fetch, t, now: () => NOW,
  forecast: { days: 3, hourlyVars: ['cloud_cover'], maxAgeMs: 30 * 60 * 1000, buildGrid: Forecast.buildGrid },
  ...opts,
});

test('中継から目的地と格子の予報を取り、取得時刻は中継が返した時刻にする', async () => {
  const { fetch, calls } = fakeFetch((url) => ({
    status: 200, body: isGrid(url) ? gridBody() : center, headers: { 'X-Fetched-At': String(NOW - 5000) },
  }));
  const data = await client(fetch).fetchForecast({ lat: 35.95312, lon: 138.47123 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((u) => u.startsWith(Api.API_PROXY)));
  assert.equal(data.at, NOW - 5000);
  assert.equal(data.gridValues.length, 49);
});

test('目的地は小数点以下2桁に丸めて取得し、近くの地点ではアプリ内のキャッシュを使う(#68)', async () => {
  const { fetch, calls } = fakeFetch((url) => ({ status: 200, body: isGrid(url) ? gridBody() : center }));
  const c = client(fetch);
  await c.fetchForecast({ lat: 35.95312, lon: 138.47123 });
  const q = new URL(calls[0]).searchParams;
  assert.equal(q.get('latitude'), '35.95');
  assert.equal(q.get('longitude'), '138.47');
  await c.fetchForecast({ lat: 35.9549, lon: 138.4688 });
  assert.equal(calls.length, 2, '同じ2桁・同じ格子なら取り直さない');
});

test('中継が失敗したら Open-Meteo に直接取りに行く', async () => {
  const { fetch, calls } = fakeFetch((url) => {
    if (url.startsWith(Api.API_PROXY)) return { status: 429, body: {} };
    return { status: 200, body: isGrid(url) ? gridBody() : center };
  });
  const data = await client(fetch).fetchForecast({ lat: 35.95, lon: 138.47 });
  assert.equal(calls.filter((u) => u.startsWith(Api.API)).length, 2);
  assert.equal(data.at, NOW);
});

test('オフラインなら Open-Meteo に取りに行かず、オフラインのエラーにする', async () => {
  const { fetch, calls } = fakeFetch(() => new TypeError('Failed to fetch'));
  await assert.rejects(client(fetch, { isOffline: () => true }).fetchForecast({ lat: 35.95, lon: 138.47 }),
    (err) => err instanceof Api.NetworkError && err.offline);
  assert.equal(calls.length, 1);
});

test('配信元に届かなければ、オフラインではない通信のエラーにする', async () => {
  const { fetch } = fakeFetch(() => new TypeError('Failed to fetch'));
  await assert.rejects(client(fetch).fetchForecast({ lat: 35.95, lon: 138.47 }),
    (err) => err instanceof Api.NetworkError && !err.offline);
});

test('格子の地点の数が合わなければ、データの形式のエラーにする', async () => {
  const { fetch } = fakeFetch((url) => ({ status: 200, body: isGrid(url) ? gridBody(48) : center }));
  await assert.rejects(client(fetch).fetchForecast({ lat: 35.95, lon: 138.47 }),
    (err) => err instanceof Api.DataError && err.message === t('badGridData'));
});

test('「再読み込み」では URL の末尾に時刻を足して、前と別の URL にする', async () => {
  const { fetch, calls } = fakeFetch((url) => ({ status: 200, body: isGrid(url) ? gridBody() : center }));
  await client(fetch).fetchForecast({ lat: 35.95, lon: 138.47 }, undefined, { bust: true });
  assert.equal(new URL(calls[0]).searchParams.get('_'), String(NOW));
});

test('問い合わせごとに打ち切りの時間を変えられ、時間切れは通信の失敗として扱う', async () => {
  // signal で中断されるまで応答しない fetch
  const hang = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const { fetchJson } = client(hang, { timeoutMs: 60 * 1000 });
  const started = Date.now();
  await assert.rejects(fetchJson('https://example.com/', undefined, { timeoutMs: 20 }), (err) => err instanceof Api.NetworkError);
  assert.ok(Date.now() - started < 1000);
});
