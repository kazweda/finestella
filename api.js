// 予報と地名の取得(#74)。画面には触らないので、fetch などを渡せば Node のテストからも使える。
// 予報は中継(worker/)から取り、だめなら Open-Meteo に直接取りに行く(#57)。
// ブラウザでは globalThis.Api として使う。
(function (root) {
  'use strict';

  const API_PROXY = 'https://api.finestella.com/v1/forecast';
  const API = 'https://api.open-meteo.com/v1/forecast';

  // 通信の失敗だけを NetworkError にする。プログラムの不具合(TypeError など)を通信エラーと取り違えないため。
  // offline: 端末がオフラインか。そうでなければ、配信元に届かないか応答がない。
  class NetworkError extends Error {
    constructor(offline) {
      super(offline ? 'offline' : 'unreachable');
      this.offline = offline;
    }
  }
  // 画面に出してよい、想定どおりのエラー
  class DataError extends Error {}

  // 配信元が接続を受けたまま応答しないことがあるため、一定時間で打ち切る。
  const FETCH_TIMEOUT_MS = 20 * 1000;

  // fetch: 使う fetch。t: 文言(エラーの文に使う)。isOffline: 端末がオフラインかを返す関数。
  // forecast: { days, hourlyVars, maxAgeMs, buildGrid }。now: 今の時刻(テストで差し替える)。
  function createClient({ fetch, t, isOffline = () => false, forecast, now = () => Date.now(), timeoutMs = FETCH_TIMEOUT_MS }) {
    // signal で中断されたときだけ AbortError を投げる。時間切れは通信の失敗として扱う。
    async function requestJson(url, signal) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer = setTimeout(onAbort, timeoutMs);
      try {
        let res;
        try {
          res = await fetch(url, { signal: controller.signal });
        } catch (err) {
          if (signal?.aborted) throw err;
          throw new NetworkError(isOffline());
        }
        if (res.status === 429) throw new DataError(t('tooManyRequests'));
        if (!res.ok) throw new DataError(t('httpError', res.status));
        try {
          return { data: await res.json(), headers: res.headers };
        } catch (err) {
          if (signal?.aborted) throw err;
          if (controller.signal.aborted) throw new NetworkError(isOffline());
          throw new DataError(t('badData'));
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }

    const fetchJson = async (url, signal) => (await requestJson(url, signal)).data;

    // bust: URL の末尾に時刻を足し、前と別の URL にする(「再読み込み」用)。
    // 配信元で応答しなくなったリクエストと同じ URL を送ると、同じように応答しないことがあるため。
    function forecastQuery(latitude, longitude, hourly, timezone, bust = false) {
      const params = new URLSearchParams({
        latitude, longitude, hourly: hourly.join(','), timezone,
        forecast_days: forecast.days, wind_speed_unit: 'ms',
      });
      if (bust) params.set('_', now());
      return params.toString();
    }

    // 返す at は予報を取得した時刻。中継がキャッシュから返したときは、中継が Open-Meteo から取得した時刻。
    // 中継の失敗(429 を含む)では Open-Meteo に直接取りに行く。中継の送信元は他の利用者と共用で、回数制限に当たることがあるため。
    async function fetchForecastJson(query, signal) {
      try {
        const { data, headers } = await requestJson(`${API_PROXY}?${query}`, signal);
        const at = Number(headers.get('X-Fetched-At'));
        return { data, at: at > 0 ? Math.min(at, now()) : now() };
      } catch (err) {
        if (signal?.aborted || (err instanceof NetworkError && err.offline)) throw err;
      }
      return { data: await fetchJson(`${API}?${query}`, signal), at: now() };
    }

    // 目的地(1地点)と周辺の雲(格子の49地点)は別々にキャッシュする。
    // 格子は目的地が近ければ共通なので、目的地を少し動かしても取得するのは目的地の1地点だけで済む。
    // 返す at は古いほうの取得時刻。古くなったほうだけを取り直す。
    const centerCache = new Map();
    const gridCache = new Map();
    const isFresh = (entry) => entry && now() - entry.at < forecast.maxAgeMs;

    async function fetchForecast(place, signal, { bust = false } = {}) {
      // 目的地は小数点以下2桁(約1km)に丸めて取得する(#68)。近くをタップした利用者どうしで同じ URL になり、
      // 中継のキャッシュが当たる。気象モデルのマス目は数kmなので、雲量の値はほとんど変わらない。
      // 丸めるのは取得だけで、ピン・表示・URL・太陽と月の計算は選んだ座標のまま。
      const lat = place.lat.toFixed(2);
      const lon = place.lon.toFixed(2);
      const centerKey = `${lat},${lon}`;
      let centerEntry = centerCache.get(centerKey);
      if (!isFresh(centerEntry)) {
        centerEntry = await fetchForecastJson(forecastQuery(lat, lon, forecast.hourlyVars, 'auto', bust), signal);
        centerCache.set(centerKey, centerEntry);
      }
      const center = centerEntry.data;
      const { time } = center.hourly;

      // 全地点の時刻軸を揃えるため、目的地のタイムゾーンで周辺を取得する。
      // 日付が変わると時刻軸の始まりがずれるので、目的地と揃っていなければ取り直す。
      const grid = forecast.buildGrid(place.lat, place.lon);
      const gridKey = `${grid.key},${center.timezone}`;
      let gridEntry = gridCache.get(gridKey);
      if (!isFresh(gridEntry) || gridEntry.time[0] !== time[0] || gridEntry.time.length !== time.length) {
        const { data: list, at: gridAt } = await fetchForecastJson(forecastQuery(
          grid.points.map((p) => p.lat).join(','),
          grid.points.map((p) => p.lon).join(','),
          ['cloud_cover'], center.timezone, bust,
        ), signal);
        if (!Array.isArray(list) || list.length !== grid.points.length
          || list.some((p) => p.hourly.time.length !== time.length || p.hourly.time[0] !== time[0])) {
          throw new DataError(t('badGridData'));
        }
        gridEntry = { values: list.map((p) => p.hourly.cloud_cover), time: list[0].hourly.time, at: gridAt };
        gridCache.set(gridKey, gridEntry);
      }
      return { center, grid, gridValues: gridEntry.values, at: Math.min(centerEntry.at, gridEntry.at) };
    }

    return { fetchJson, fetchForecast };
  }

  root.Api = { NetworkError, DataError, createClient, API_PROXY, API };
})(globalThis);
