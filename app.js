(function () {
  'use strict';

  const { buildGrid, valueAt, sampleGrid, windFlow, localToEpoch, sunAltitude, moonAltitude, moonIllumination, moonCondition, findCrossings, intervalsBelow, findObservingWindows, wrapLon, currentIndex, reindexTime } = window.Forecast;
  const {
    rankGsiResults, parsePlaceUrl, placeQuery, formatCoords, parseCoords, googleMapsUrl, parseHome, serializeHome, isSamePlace,
  } = window.Places;

  // --- Startup flow (#88) ---
  // The details of each step are moved into functions under "Parts" at the bottom of this file
  // (function declarations are hoisted, so they can be called before they appear).
  // 1. Decide the language first, since the constants below use t().
  // 2. Declare the constants and the state shared by the parts.
  // 3. Set up each part.
  // 4. Open the first place (openInitialPlace() at the end of this flow, after everything is ready).
  const { LANG, URL_LANG, i18n } = setupLanguage();
  const { t, coordName } = i18n;

  const FORECAST_DAYS = 3;
  const MAX_ZOOM = 11; // 市全体を一望できる範囲まで
  const OVERLAY_PX = 180;
  // named: 地名を持つ地点か。地図のタップなど緯度・経度だけの地点は false で、URL に地名を入れない。
  const DEFAULT_PLACE = { name: t('defaultPlace'), lat: 35.953, lon: 138.473, named: true };
  const DEFAULT_ZOOM = 8; // 周りの雲の範囲(約±130km)がおおよそ画面に収まる
  // 地名検索で選んだときは、その場所がわかるよう町の大きさまで拡大する。周りの雲は縮小して確かめる。
  const SEARCH_ZOOM = 10;
  const MAX_AGE_MS = 30 * 60 * 1000; // これより古い予報は取り直す

  const LAYERS = [
    { key: 'cloud_cover_low', label: t('layerLow'), windLevel: '850hPa' },
    { key: 'cloud_cover_mid', label: t('layerMid'), windLevel: '500hPa' },
    { key: 'cloud_cover_high', label: t('layerHigh'), windLevel: '300hPa' },
  ];
  const HOURLY_VARS = ['cloud_cover', ...LAYERS.map((l) => l.key),
    ...LAYERS.flatMap((l) => [`wind_speed_${l.windLevel}`, `wind_direction_${l.windLevel}`])];

  // Fetching forecasts and places (api.js), shared by loading, refreshing and searching.
  const { NetworkError, DataError } = window.Api;
  const api = window.Api.createClient({
    fetch: (...args) => fetch(...args),
    t,
    isOffline: () => navigator.onLine === false,
    forecast: { days: FORECAST_DAYS, hourlyVars: HOURLY_VARS, maxAgeMs: MAX_AGE_MS, buildGrid },
  });
  const { fetchForecast } = api;

  const $ =(id) => document.getElementById(id);
  const el = {
    place: $('place'), time: $('time'), status: $('status'), statusText: $('status-text'), retry: $('retry'), total: $('total'), layers: $('layers'),
    flow: $('flow'), windows: $('windows'), timeline: $('timeline'),
    slider: $('slider'), play: $('play'), now: $('now'),
    search: $('search'), searchInput: $('search-input'), searchResults: $('search-results'),
    fetched: $('fetched'),
    placeActions: $('place-actions'), gmap: $('gmap'), copyCoords: $('copy-coords'), homeToggle: $('home-toggle'),
  };

  const state = {
    place: null, loadedPlace: null, center: null, grid: null, gridValues: null,
    t: 0, nowIndex: 0, epochs: [], sky: [], dark: [], moonDown: [], moonUp: [], timer: null,
    fetchedAt: 0, refreshing: false, refreshFailed: false,
  };
  let loadController = null;
  let debounceTimer = null;

  // setupUpdateCheck() also follows the current time and refreshes a stale forecast
  // when the page comes back to the foreground, so it takes them from setupAutoRefresh().
  const autoRefresh = setupAutoRefresh();
  setupUpdateCheck(autoRefresh);
  setupCopyCoords();
  // selectPlace() stops the playback when another place is chosen.
  const { stopPlayback } = setupTimeControls();
  const home = setupHome();
  setupSearch();

  // --- 地図 ---
  const map = L.map('map', { worldCopyJump: false, maxZoom: MAX_ZOOM }).setView([DEFAULT_PLACE.lat, DEFAULT_PLACE.lon], DEFAULT_ZOOM);
  // 背景地図。英語は OpenFreeMap(英語の地名)、日本語は地理院タイル(#51)。
  // 日本語でも ?map=ofm を付けると OpenFreeMap(日本語の地名)にする(一本化の見比べ用)。
  // URL を書き換えても残るよう、起動時に一度だけ読む。
  const MAP_PARAM = new URLSearchParams(location.search).get('map') === 'ofm' ? 'map=ofm' : '';
  const MAP_KIND = MAP_PARAM || LANG === 'en' ? 'ofm' : 'gsi';
  let baseLayer = null;

  // 背景地図のレイヤーを作って載せる(basemap.js)。OpenFreeMap が使えなければ、地理院タイルで表示する。
  const addBaseLayer = async (kind) => {
    baseLayer = await window.Basemap.addBaseLayer(map, { kind, lang: LANG, t, maxZoom: MAX_ZOOM, creditEl: $('credit-map') });
  };
  addBaseLayer(MAP_KIND).catch((err) => {
    console.error(err);
    if (MAP_KIND !== 'gsi') addBaseLayer('gsi');
  });

  // 地図に重ねる雲量も Open-Meteo のデータなので、地図上にも出典とライセンスを示す(CC BY 4.0)。
  // 補間したことや海岸線データの出所など長い文言は、パネル下部の出典欄に書く。
  const CLOUD_ATTRIBUTION = t('cloudAttributionHtml');

  // 凡例は出典と同じ右下の枠に積む。地図の幅が狭いと出典が折り返して高くなるが、
  // 同じ枠に入れておけば凡例はその上に押し上げられ、重ならない。
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => document.querySelector('.legend');
  legend.addTo(map);

  const pinIcon = L.divIcon({ className: 'pin', html: '<div class="arrow" hidden></div><div class="dot"></div>', iconSize: [0, 0] });
  let marker = null;
  let overlay = null;
  let outline = null;

  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = OVERLAY_PX;
  const offCtx = offscreen.getContext('2d');
  const offImage = offCtx.createImageData(OVERLAY_PX, OVERLAY_PX);

  map.on('zoomend', () => {
    // OpenFreeMap はスタイルで暗い色にしているので、不透明度は変えない。
    if (baseLayer instanceof L.TileLayer) baseLayer.setOpacity(window.Basemap.gsiOpacity(map.getZoom()));
    updateUrl();
  });

  map.on('click', (e) => {
    const { lat } = e.latlng;
    const lon = wrapLon(e.latlng.lng);
    selectPlace({ name: coordName(lat, lon), lat, lon, named: false });
  });

  // what: 何の取得に失敗したか('forecast' か 'search')。配信元に届かないときの文言を変える。
  function errorMessage(err, what) {
    if (err instanceof NetworkError) {
      if (err.offline) return t('offline');
      return what === 'search' ? t('searchUnreachable') : `${t('forecastUnreachable')}${t('tryLater')}`;
    }
    if (err instanceof DataError) return err.message;
    return t('unexpected');
  }

  // --- 目的地の選択 ---
  // URL に地点を書くのは、URL で開いたときか、利用者が地点を選んだ後だけ。
  // 何も付けずに開いたままなら URL を変えない(#11 の「保存した初期位置」を URL より優先させないため)。
  let urlActive = false;
  function updateUrl() {
    if (!urlActive || !state.place) return;
    let query = placeQuery({ ...state.place, name: state.place.named ? state.place.name : null }, map.getZoom());
    query += `&lang=${LANG}`; // 共有した相手も同じ言語で開く(#63)
    if (MAP_PARAM) query += `&${MAP_PARAM}`; // 背景地図の指定を残す(#51)
    // 「戻る」の履歴を増やさないよう、置き換える。
    history.replaceState(null, '', `${location.pathname}${query}`);
  }

  function selectPlace(place, { pan = false, zoom = DEFAULT_ZOOM, fromUser = true } = {}) {
    stopPlayback();
    state.place = place;
    el.place.textContent = place.name;
    el.gmap.href = googleMapsUrl(place.lat, place.lon);
    el.placeActions.hidden = false;
    home.renderToggle();
    if (fromUser) urlActive = true;
    if (!marker) marker = L.marker([place.lat, place.lon], { icon: pinIcon, keyboard: false, interactive: false }).addTo(map);
    else marker.setLatLng([place.lat, place.lon]);
    if (pan) map.setView([place.lat, place.lon], zoom);
    updateUrl();
    showStatus(t('loading'));

    // 連続クリックでAPIを消費しないよう少し待つ。
    clearTimeout(debounceTimer);
    if (loadController) loadController.abort();
    cancelRetry();
    debounceTimer = setTimeout(() => load(place), 300);
  }

  // --- 読み込みに失敗したときの取り直し ---
  // 配信元に届かないときは「再読み込み」ボタンを出す。自動では取り直さない。
  // 配信元が長く止まっていることがあり、見ていない人の分までリクエストを出さないため。
  // 押したら1分は押せないようにし、リクエストを1分に1回までにする。
  const RETRY_COOLDOWN_MS = 60 * 1000;
  let retryCooldown = null;

  function cancelRetry() {
    clearTimeout(retryCooldown);
    el.retry.disabled = false;
  }

  el.retry.addEventListener('click', () => {
    if (!state.place) return;
    el.retry.disabled = true;
    clearTimeout(retryCooldown);
    retryCooldown = setTimeout(() => { el.retry.disabled = false; }, RETRY_COOLDOWN_MS);
    showStatus(t('loading'), false, { retry: true });
    load(state.place, { bust: true });
  });

  async function load(place, { bust = false } = {}) {
    const controller = new AbortController();
    loadController = controller;
    try {
      const data = await fetchForecast(place, controller.signal, { bust });
      if (controller.signal.aborted) return;
      apply(place, data);
      hideStatus();
      state.loadFailed = false;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error(err);
      state.loadFailed = true;
      // オフラインは回線が戻ったときに取り直すので、配信元に届かないときだけボタンを出す。
      if (err instanceof NetworkError && !err.offline) {
        showStatus(`${t('forecastUnreachable')}${t('waitAndRetry')}`, true, { retry: true });
      } else {
        showStatus(errorMessage(err, 'forecast'), true);
      }
    }
  }

  // keepTime: 予報を取り直したときに、見ている時刻を保つ(「現在」を見ていれば新しい「現在」へ)。
  function apply(place, data, { keepTime = false } = {}) {
    const following = isFollowingNow();
    const oldTimes = state.center ? state.center.hourly.time : [];
    state.center = data.center;
    state.grid = data.grid;
    state.gridValues = data.gridValues;
    state.loadedPlace = place;
    state.fetchedAt = data.at;
    state.refreshFailed = false;
    const { time } = data.center.hourly;
    const offset = data.center.utc_offset_seconds;
    state.epochs = time.map((t) => localToEpoch(t, offset));
    computeSky(place);
    state.nowIndex = currentIndex(state.epochs, Date.now());
    const kept = keepTime && !following ? reindexTime(oldTimes, time, state.t) : null;

    el.slider.max = time.length - 1;
    for (const control of [el.slider, el.play, el.now]) control.disabled = false;

    if (outline) outline.remove();
    if (overlay) overlay.remove();
    overlay = L.imageOverlay(offscreen.toDataURL(), data.grid.bounds, { className: 'cloud-layer', opacity: 1, interactive: false, attribution: CLOUD_ATTRIBUTION }).addTo(map);
    outline = L.rectangle(data.grid.bounds, { color: '#8fc7ff', weight: 1, dashArray: '4 4', fill: false, interactive: false }).addTo(map);

    renderWindows();
    renderFetched();
    setTime(kept ?? state.nowIndex);
  }

  // 予報の期間(各時刻の前後30分を含む)について、太陽高度から昼・薄明・夜の時間帯を分単位で求める。
  // 日の出・日の入りは −0.83°、天文薄明は −18°(観測のねらい目の判定と同じ)。
  function computeSky(place) {
    const from = state.epochs[0] - 1800000;
    const to = state.epochs[state.epochs.length - 1] + 1800000;
    const alt = (ms) => sunAltitude(ms, place.lat, place.lon);
    state.dark = intervalsBelow(alt, from, to, -18);
    const cuts = [from, to, ...[-0.83, -18].flatMap((level) => findCrossings(alt, from, to, level).map((x) => x.ms))]
      .sort((a, b) => a - b);
    state.sky = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [start, end] = [cuts[k], cuts[k + 1]];
      if (end <= start) continue;
      const a = alt((start + end) / 2);
      state.sky.push({ start, end, kind: a > -0.83 ? 'day' : a > -18 ? 'twilight' : 'night' });
    }

    // 月の出・月の入りは、月の中心の高度 −0.83°(大気差と月の半径の分)で区切る。
    const moon = (ms) => moonAltitude(ms, place.lat, place.lon);
    state.moonDown = intervalsBelow(moon, from, to, -0.83);
    state.moonUp = [];
    let cursor = from;
    for (const d of [...state.moonDown, { start: to, end: to }]) {
      if (d.start > cursor) state.moonUp.push({ start: cursor, end: d.start });
      cursor = d.end;
    }
  }

  // 観測のねらい目に添える月の条件。
  function moonLabel(w) {
    const c = moonCondition(w, state.moonDown);
    const clock = (ms) => formatTime(localIso(ms), false);
    if (c.kind === 'none') return t('moonNone');
    if (c.kind === 'up') return t('moonUp', Math.round(moonIllumination((w.start + w.end) / 2) * 100));
    return t('moonPartial', c.from ? clock(c.from) : '', c.to ? clock(c.to) : '');
  }

  // Whether the user is watching "now" without playing or moving the time.
  // Only then does the display move along with the clock (apply() and setupAutoRefresh()).
  function isFollowingNow() {
    return Boolean(state.center) && !state.timer && Math.round(state.t) === state.nowIndex;
  }

  const clockText = (date) => `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

  function renderFetched() {
    if (!state.fetchedAt) { el.fetched.hidden = true; return; }
    const at = new Date(state.fetchedAt);
    const sameDay = at.toDateString() === new Date().toDateString();
    const clock = clockText(at);
    const when = sameDay ? clock : `${i18n.shortDate(at.getMonth() + 1, at.getDate())} ${clock}`;
    el.fetched.textContent = state.refreshFailed ? t('fetchedStale', when, state.refreshFailed) : t('fetchedAt', when);
    el.fetched.classList.toggle('stale', Boolean(state.refreshFailed));
    el.fetched.hidden = false;
  }

  // --- 描画 ---
  function setTime(t) {
    if (!state.center) return;
    state.t = t;
    el.slider.value = Math.round(t);
    renderReadout();
    renderOverlay();
    renderTimeline();
  }

  // エポックミリ秒を、目的地の現地時刻の文字列(分単位に丸める)にする。
  function localIso(ms) {
    const local = Math.round(ms / 60000) * 60000 + state.center.utc_offset_seconds * 1000;
    return new Date(local).toISOString().slice(0, 16);
  }

  const { formatTime } = i18n;

  function renderReadout() {
    const { hourly, timezone_abbreviation: tz } = state.center;
    const i = Math.round(state.t);
    el.time.textContent = `${formatTime(hourly.time[i])} ${tz}`;

    const total = hourly.cloud_cover[i];
    el.total.textContent = total == null ? '—' : `${Math.round(total)}%`;

    el.layers.replaceChildren(...[...LAYERS].reverse().map((layer) => {
      const value = hourly[layer.key][i];
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = layer.label;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      fill.style.width = `${value ?? 0}%`;
      bar.append(fill);
      const dd = document.createElement('dd');
      dd.textContent = value == null ? '—' : `${Math.round(value)}%`;
      row.append(dt, bar, dd);
      return row;
    }));

    // 最も雲の多い層の風を、目的地の雲の動きの目安として示す。
    const dominant = LAYERS.reduce((best, layer) => ((hourly[layer.key][i] ?? -1) > (hourly[best.key][i] ?? -1) ? layer : best));
    const dominantValue = hourly[dominant.key][i];
    const arrowEl = marker && marker.getElement() && marker.getElement().querySelector('.arrow');
    if (dominantValue == null || dominantValue < 10) {
      el.flow.textContent = dominantValue == null ? '' : t('noNotableCloud');
      if (arrowEl) arrowEl.hidden = true;
    } else {
      const flow = windFlow(hourly[`wind_direction_${dominant.windLevel}`][i]);
      const speed = hourly[`wind_speed_${dominant.windLevel}`][i];
      el.flow.textContent = flow && speed != null
        ? t('cloudFlow', dominant.label, i18n.compass(flow.from), i18n.compass(flow.to), Math.round(speed))
        : t('cloudDominant', dominant.label);
      if (arrowEl) {
        arrowEl.hidden = !flow;
        if (flow) arrowEl.style.transform = `rotate(${flow.arrowDeg}deg)`;
      }
    }
  }

  function renderOverlay() {
    if (!overlay) return;
    const { size } = state.grid;
    const frame = state.gridValues.map((series) => valueAt(series, state.t));
    const px = offImage.data;
    for (let y = 0; y < OVERLAY_PX; y++) {
      for (let x = 0; x < OVERLAY_PX; x++) {
        const c = sampleGrid(frame, size, x / (OVERLAY_PX - 1), y / (OVERLAY_PX - 1));
        const p = (y * OVERLAY_PX + x) * 4;
        px[p] = px[p + 1] = px[p + 2] = 255;
        // 雲量100%でも約78%の不透明度にとどめ、地名や道路が透けて読めるようにする。
        px[p + 3] = c == null ? 0 : Math.round(200 * Math.pow(c / 100, 0.85));
      }
    }
    offCtx.putImageData(offImage, 0, 0);
    overlay.setUrl(offscreen.toDataURL());
  }

  // 3日間の雲のタイムライン(timeline.js)。
  const TIMELINE_ROWS = [
    { label: t('layerAll'), key: 'cloud_cover' },
    { label: t('layerHigh'), key: 'cloud_cover_high' },
    { label: t('layerMid'), key: 'cloud_cover_mid' },
    { label: t('layerLow'), key: 'cloud_cover_low' },
  ];

  function renderTimeline() {
    window.Timeline.draw(el.timeline, {
      hourly: state.center.hourly, epochs: state.epochs, sky: state.sky, moonUp: state.moonUp, t: state.t,
      rows: TIMELINE_ROWS, shortDate: i18n.shortDate, moonIllumination, dpr: window.devicePixelRatio || 1,
    });
  }

  function renderWindows() {
    const { hourly } = state.center;
    const found = findObservingWindows({
      times: hourly.time, epochs: state.epochs, clouds: hourly.cloud_cover, dark: state.dark,
      fromMs: state.epochs[state.nowIndex],
    });
    if (!found.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = t('noWindows');
      el.windows.replaceChildren(li);
      return;
    }
    el.windows.replaceChildren(...found.map((w) => {
      const li = document.createElement('li');
      const btn = document.createElement('span');
      btn.textContent = t('timeRange', formatTime(localIso(w.start)), formatTime(localIso(w.end), false));
      const small = document.createElement('small');
      small.textContent = t('avgCloud', Math.round(w.avgCloud));
      const moon = document.createElement('small');
      moon.textContent = moonLabel(w);
      // 英語は要素の間で改行できないので、改行してよい位置を入れる(日本語は元々どこでも改行できる)。
      li.append(btn, document.createElement('wbr'), small, document.createElement('wbr'), moon);
      return li;
    }));
  }

  // --- 操作 ---
  // retry: 「再読み込み」ボタンを出すか。
  function showStatus(message, isError = false, { retry: showRetry = false } = {}) {
    el.statusText.textContent = message;
    el.retry.hidden = !showRetry;
    el.status.hidden = false;
    el.status.classList.toggle('error', isError);
  }
  function hideStatus() {
    el.status.hidden = true;
    el.retry.hidden = true;
  }

  // Open the first place last, once every part above is ready.
  openInitialPlace();

  // --- 各部分 ---

  // 画面の言語(#63)を決めて、画面の文言とフッターの言語の切り替えを用意する。
  // URL の lang → その端末で選んだ言語 → ブラウザの言語設定の順で決める。
  // URL の lang は共有された地点を同じ言語で開くためのもので、端末には覚えない(覚えるのは切り替えを押したときだけ)。
  function setupLanguage() {
    const LANG_KEY = 'finestella:lang';
    const urlLang = new URLSearchParams(location.search).get('lang');
    const lang = window.I18n.pickLang({
      url: urlLang,
      saved: (() => { try { return window.localStorage.getItem(LANG_KEY); } catch { return null; } })(),
      browser: navigator.languages?.length ? navigator.languages : [navigator.language],
    });
    const i18n = window.I18n.create(lang);
    document.documentElement.lang = lang;
    window.I18n.applyStatic(document, i18n);

    // フッターの「English / 日本語」。今の言語は押せない表示にし、押したら端末に覚えて、同じ地点のまま開き直す。
    for (const a of document.querySelectorAll('.lang-switch [data-lang]')) {
      if (a.dataset.lang === lang) a.setAttribute('aria-current', 'true');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        try { window.localStorage.setItem(LANG_KEY, a.dataset.lang); } catch { /* 覚えられなくても URL で切り替わる */ }
        const q = new URLSearchParams(location.search);
        q.set('lang', a.dataset.lang);
        location.assign(`${location.pathname}?${q}${location.hash}`);
      });
    }

    return { LANG: lang, URL_LANG: urlLang, i18n };
  }

  // Keep the forecast up to date while the page stays open:
  // follow the current time, refetch a stale forecast, and reload after coming back online.
  // Everything here runs from timers and events, after the startup flow has finished.
  // Returns tick() and refreshIfStale() for setupUpdateCheck().
  function setupAutoRefresh() {
    // Move "now" along with the clock (no network).
    function tick() {
      if (!state.center) return;
      const next = currentIndex(state.epochs, Date.now());
      if (next === state.nowIndex) return;
      const following = isFollowingNow();
      state.nowIndex = next;
      renderWindows(); // the observing windows start from "now"
      if (following) setTime(next);
    }

    // Refetch in the background once the forecast is MAX_AGE_MS old, only while the tab is visible.
    // On failure, keep the current data and show that it is stale.
    async function refreshIfStale() {
      const place = state.place;
      if (document.hidden || state.refreshing || !state.center || state.loadedPlace !== place) return;
      if (Date.now() - state.fetchedAt < MAX_AGE_MS) return;
      state.refreshing = true;
      try {
        const data = await fetchForecast(place);
        if (state.place === place && state.loadedPlace === place) apply(place, data, { keepTime: true });
      } catch (err) {
        console.error(err);
        if (state.loadedPlace === place) state.refreshFailed = !(err instanceof NetworkError) ? 'error' : err.offline ? 'offline' : 'unreachable';
      } finally {
        state.refreshing = false;
        renderFetched();
      }
    }

    setInterval(tick, 60 * 1000);
    setInterval(refreshIfStale, 5 * 60 * 1000);
    // Back online: reload a forecast that failed to load, or refresh a stale one.
    window.addEventListener('online', () => {
      if (state.loadFailed && state.place) {
        showStatus(t('loading'));
        load(state.place);
      } else {
        refreshIfStale();
      }
    });

    return { tick, refreshIfStale };
  }

  // Reload the page when a new build has been deployed (#59, update.js).
  // The place comes back from the URL or the saved home, so reloading loses almost nothing.
  // When the page comes back to the foreground, this also follows the current time (tick)
  // and refreshes a stale forecast (refreshIfStale), both from setupAutoRefresh().
  function setupUpdateCheck({ tick, refreshIfStale }) {
    const currentBuild = window.Update.currentBuild(document);
    let hiddenAt = 0;

    // Show the build ID next to the version number in the footer, so we can tell which build
    // is running even when a deploy does not bump the version.
    if (currentBuild) {
      const build = document.getElementById('build');
      build.textContent = `(${currentBuild}) `;
      build.hidden = false;
    }

    const reloadIfUpdated = () => window.Update.reloadIfUpdated({
      current: currentBuild,
      fetch: (...args) => fetch(...args),
      url: location.pathname,
      reload: () => location.reload(),
      logError: console.error,
    });

    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      tick();
      // If we are about to reload, do not refetch the forecast with the old build.
      if (away >= window.Update.CHECK_AFTER_MS && await reloadIfUpdated()) return;
      refreshIfStale();
    });
  }

  // Choosing the time to show: play/stop, "Now", the slider, and dragging on the 3-day timeline.
  // Any of them except play stops the playback. The controls are disabled until a forecast is loaded.
  // Returns stopPlayback() for selectPlace().
  function setupTimeControls() {
    function stopPlayback() {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      el.play.textContent = t('play');
    }

    // Advance a quarter of an hour every 120 ms. From the end, start again at "now".
    function startPlayback() {
      el.play.textContent = t('stop');
      const last = state.center.hourly.time.length - 1;
      if (state.t >= last) state.t = state.nowIndex;
      state.timer = setInterval(() => {
        const next = state.t + 0.25;
        if (next > last) { stopPlayback(); return; }
        setTime(next);
      }, 120);
    }

    el.play.addEventListener('click', () => (state.timer ? stopPlayback() : startPlayback()));
    el.now.addEventListener('click', () => { stopPlayback(); setTime(state.nowIndex); });
    el.slider.addEventListener('input', () => { stopPlayback(); setTime(Number(el.slider.value)); });

    function seekFromPointer(e) {
      if (!state.center) return;
      const rect = el.timeline.getBoundingClientRect();
      stopPlayback();
      setTime(window.Timeline.indexAt(e.clientX - rect.left, rect.width, state.center.hourly.time.length));
    }
    el.timeline.addEventListener('pointerdown', (e) => {
      el.timeline.setPointerCapture(e.pointerId);
      seekFromPointer(e);
    });
    el.timeline.addEventListener('pointermove', (e) => {
      if (e.buttons) seekFromPointer(e);
    });
    // The timeline canvas is drawn at the width of the panel, so redraw it when the window is resized.
    window.addEventListener('resize', () => { if (state.center) renderTimeline(); });

    return { stopPlayback };
  }

  // The button that copies the latitude and longitude of the selected place.
  // The clipboard is only available over https or on localhost; otherwise the button is hidden.
  function setupCopyCoords() {
    const button = el.copyCoords;
    button.hidden = !(navigator.clipboard && window.isSecureContext);
    const label = button.textContent;
    let resetTimer = null;
    button.addEventListener('click', async () => {
      if (!state.place) return;
      let message;
      try {
        await navigator.clipboard.writeText(formatCoords(state.place.lat, state.place.lon));
        message = t('copied');
      } catch (err) {
        console.error(err);
        message = t('copyFailed');
      }
      button.textContent = message;
      // Show the result briefly, then put the original label back.
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { button.textContent = label; }, 1500);
    });
  }

  // The home place: the place opened when the page has no place in its URL, saved in this browser.
  // If the browser cannot save it (e.g. site data is blocked), the button is hidden and Nobeyama opens.
  // Chrome's incognito mode can save it; it is cleared when the incognito windows are closed.
  // Returns saved() for the startup flow and renderToggle() for selectPlace().
  function setupHome() {
    const HOME_KEY = 'finestella:home';
    const storage = (() => {
      try {
        const s = window.localStorage;
        s.setItem(`${HOME_KEY}:test`, '1');
        s.removeItem(`${HOME_KEY}:test`);
        return s;
      } catch {
        return null;
      }
    })();

    const load = () => {
      try {
        return storage ? parseHome(storage.getItem(HOME_KEY)) : null;
      } catch {
        return null;
      }
    };

    let saved = load();
    const button = el.homeToggle;

    // The label says whether the selected place is the home place.
    function renderToggle() {
      button.hidden = !storage;
      button.textContent = isSamePlace(saved, state.place) ? t('unsetHome') : t('setHome');
    }

    // map is declared later in the startup flow, but it is only used after a click.
    button.addEventListener('click', () => {
      if (!storage || !state.place) return;
      try {
        if (isSamePlace(saved, state.place)) {
          storage.removeItem(HOME_KEY);
          saved = null;
        } else {
          const name = state.place.named ? state.place.name : null;
          storage.setItem(HOME_KEY, serializeHome({ ...state.place, name }, map.getZoom()));
          saved = load();
        }
      } catch (err) {
        console.error(err);
        button.textContent = t('saveFailed');
        return;
      }
      renderToggle();
    });

    return { saved: () => saved, renderToggle };
  }

  // The search box (search.js). A "latitude, longitude" opens that point;
  // anything else is searched as a place name and the results are listed.
  function setupSearch() {
    const { searchPlaces } = window.Search.create({
      fetchJson: api.fetchJson, lang: LANG, t, rankGsiResults, logError: console.error,
    });
    const list = el.searchResults;

    // Each search gets a number, so a late result from an earlier search does not overwrite the list.
    let searchSeq = 0;
    // The name being searched. Pressing search again with the same name does not send another
    // request (Nominatim allows one request per second, #82).
    let searchingName = null;

    const showMessage = (text) => {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = text;
      list.replaceChildren(li);
      list.hidden = false;
    };

    el.search.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = el.searchInput.value.trim();
      if (!name || name === searchingName) return;
      const coords = parseCoords(name);
      if (coords) {
        ++searchSeq; // do not show the list if a search in progress returns later
        searchingName = null;
        list.hidden = true;
        selectPlace({ name: coordName(coords.lat, coords.lon), ...coords, named: false }, { pan: true, zoom: SEARCH_ZOOM });
        return;
      }
      const seq = ++searchSeq;
      searchingName = name;
      showMessage(t('searching'));
      try {
        const results = await searchPlaces(name);
        if (seq !== searchSeq) return;
        if (!results.length) { showMessage(t('notFound')); return; }
        list.replaceChildren(...results.map((r) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = r.label;
          btn.addEventListener('click', () => {
            list.hidden = true;
            selectPlace({ name: r.name, lat: r.lat, lon: r.lon, named: true }, { pan: true, zoom: SEARCH_ZOOM });
          });
          li.append(btn);
          return li;
        }));
        list.hidden = false;
      } catch (err) {
        console.error(err);
        if (seq !== searchSeq) return;
        showMessage(errorMessage(err, 'search'));
      } finally {
        if (seq === searchSeq) searchingName = null;
      }
    });
  }

  // Open the place given in the URL; without one, the saved home place, or else Nobeyama.
  // Also follow the URL hash while the page is open.
  function openInitialPlace() {
    const openPlace = (p, zoom) => {
      const place = { name: p.name || coordName(p.lat, p.lon), lat: p.lat, lon: p.lon, named: Boolean(p.name) };
      selectPlace(place, { pan: true, zoom }); // rewrites the URL in the current format
    };

    // Editing #lat,lon in the address bar does not reload the page (editing after ? does), so listen for it.
    // The hash wins over ?lat=…, and the zoom stays as it is.
    window.addEventListener('hashchange', () => {
      const p = parsePlaceUrl('', location.hash);
      if (p) openPlace(p, map.getZoom());
    });

    const fromUrl = parsePlaceUrl(location.search, location.hash);
    if (fromUrl) {
      openPlace(fromUrl, fromUrl.zoom ?? DEFAULT_ZOOM);
      return;
    }

    // Remove invalid parameters before opening, so they are not kept in bookmarks.
    // Keep only the language and the base map (?lang=en, ?map=ofm).
    const kept = [URL_LANG === LANG ? `lang=${LANG}` : '', MAP_PARAM].filter(Boolean).join('&');
    const keep = kept ? `?${kept}` : '';
    if (location.search !== keep || location.hash) history.replaceState(null, '', `${location.pathname}${keep}`);
    // Without a place in the URL, open the saved home place, or else Nobeyama. The URL is left as it is.
    const saved = home.saved();
    const start = saved
      ? { name: saved.name || coordName(saved.lat, saved.lon), lat: saved.lat, lon: saved.lon, named: Boolean(saved.name) }
      : DEFAULT_PLACE;
    selectPlace(start, { pan: true, zoom: saved?.zoom ?? DEFAULT_ZOOM, fromUser: false });
  }
})();
