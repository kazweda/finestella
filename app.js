(function () {
  'use strict';

  const {
    buildGrid, valueAt, sampleGrid, cloudAlpha, windFlow, localToEpoch, epochToLocal, moonIllumination, moonPhaseIndex, moonCondition,
    skyPeriods, findObservingWindows, wrapLon, currentIndex, reindexTime,
  } = window.Forecast;
  const {
    rankGsiResults, parsePlaceUrl, placeQuery, formatCoords, parseCoords, googleMapsUrl, parseHome, serializeHome, isSamePlace,
  } = window.Places;

  // --- Startup flow (#88) ---
  // 1. Decide the language first, since the constants below use t().
  // 2. Declare the constants and the state shared by the parts.
  // 3. Set up each part, then open the first place.
  // Below the startup flow there are only function declarations (they are hoisted, so they can be
  // called before they appear). Everything they share is declared here, before the first call.
  const { LANG, URL_LANG, i18n } = setupLanguage();
  const { t, coordName, formatTime } = i18n;

  const FORECAST_DAYS = 3;
  const MAX_ZOOM = 11; // wide enough to see a whole city
  const OVERLAY_PX = 180;
  // named: whether the place has a name. Points chosen by tapping the map have only coordinates,
  // and their name is not put in the URL.
  const DEFAULT_PLACE = { name: t('defaultPlace'), lat: 35.953, lon: 138.473, named: true };
  const DEFAULT_ZOOM = 8; // the surrounding clouds (about ±130 km) roughly fit on the screen
  // A place chosen from search opens at town level so it is easy to see; zoom out to check the clouds around it.
  const SEARCH_ZOOM = 10;
  const MAX_AGE_MS = 30 * 60 * 1000; // refetch forecasts older than this
  // With ?map=ofm, Japanese also uses OpenFreeMap (Japanese names), to compare the base maps (#51).
  // Read once at startup so it is kept when the URL is rewritten (updateUrl(), openInitialPlace()).
  const MAP_PARAM = new URLSearchParams(location.search).get('map') === 'ofm' ? 'map=ofm' : '';

  const LAYERS = [
    { key: 'cloud_cover_low', label: t('layerLow'), windLevel: '850hPa' },
    { key: 'cloud_cover_mid', label: t('layerMid'), windLevel: '500hPa' },
    { key: 'cloud_cover_high', label: t('layerHigh'), windLevel: '300hPa' },
  ];
  const HOURLY_VARS = ['cloud_cover', ...LAYERS.map((l) => l.key),
    ...LAYERS.flatMap((l) => [`wind_speed_${l.windLevel}`, `wind_direction_${l.windLevel}`])];
  // Rows of the 3-day timeline (timeline.js), from the top.
  const TIMELINE_ROWS = [
    { label: t('layerAll'), key: 'cloud_cover' },
    { label: t('layerHigh'), key: 'cloud_cover_high' },
    { label: t('layerMid'), key: 'cloud_cover_mid' },
    { label: t('layerLow'), key: 'cloud_cover_low' },
  ];
  // The Moon's phase in eight steps (moonPhaseIndex()), as seen from the northern hemisphere.
  const MOON_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  // The cloud layer is Open-Meteo data too, so the map also shows its source and license (CC BY 4.0).
  // Longer notes (interpolation, the source of the shoreline data) are in the credits below the panel.
  const CLOUD_ATTRIBUTION = t('cloudAttributionHtml');

  // Fetching forecasts and places (api.js), shared by loading, refreshing and searching.
  const { NetworkError, DataError } = window.Api;
  const api = window.Api.createClient({
    fetch: (...args) => fetch(...args),
    t,
    isOffline: () => navigator.onLine === false,
    forecast: { days: FORECAST_DAYS, hourlyVars: HOURLY_VARS, maxAgeMs: MAX_AGE_MS, buildGrid },
  });
  const { fetchForecast } = api;

  const $ = (id) => document.getElementById(id);
  const el = {
    place: $('place'), time: $('time'), status: $('status'), statusText: $('status-text'), retry: $('retry'), total: $('total'), layers: $('layers'),
    flow: $('flow'), windows: $('windows'), timeline: $('timeline'),
    slider: $('slider'), play: $('play'), now: $('now'),
    search: $('search'), searchInput: $('search-input'), searchResults: $('search-results'),
    fetched: $('fetched'), moonPhase: $('moon-phase'),
    placeActions: $('place-actions'), gmap: $('gmap'), copyCoords: $('copy-coords'), homeToggle: $('home-toggle'),
  };

  // place is the place the user chose; loadedPlace is the place of the forecast on screen.
  // They differ while a forecast is loading, and when it failed to load.
  const state = {
    place: null, loadedPlace: null, center: null, grid: null, gridValues: null,
    t: 0, nowIndex: 0, epochs: [], sky: [], dark: [], moonDown: [], moonUp: [], timer: null,
    fetchedAt: 0, refreshing: false, refreshFailed: false, loadFailed: false,
  };

  // What is drawn on the map, shared by selectPlace(), apply() and the rendering.
  const pinIcon = L.divIcon({ className: 'pin', html: '<div class="arrow" hidden></div><div class="dot"></div>', iconSize: [0, 0] });
  let marker = null;
  let overlay = null;
  let outline = null;
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = OVERLAY_PX;
  const offCtx = offscreen.getContext('2d');
  const offImage = offCtx.createImageData(OVERLAY_PX, OVERLAY_PX);

  // Choosing a place and loading its forecast (selectPlace(), updateUrl(), load()).
  // The place is written to the URL only after it was opened from the URL or chosen by the user.
  // Opened with nothing in the URL, the URL is left as it is, so the saved home place (#11) keeps
  // winning over the URL.
  let urlActive = false;
  let loadController = null;
  let debounceTimer = null;

  // The map comes first, since the other parts read its zoom or draw on it.
  const map = setupMap();
  // setupUpdateCheck() also follows the current time and refreshes a stale forecast
  // when the page comes back to the foreground, so it takes them from setupAutoRefresh().
  const autoRefresh = setupAutoRefresh();
  setupUpdateCheck(autoRefresh);
  setupCopyCoords();
  // When another place is chosen, selectPlace() stops the playback, resets the "Reload" button
  // and closes the search results.
  const { stopPlayback } = setupTimeControls();
  const retry = setupRetry();
  const home = setupHome();
  const search = setupSearch();
  // Open the first place last, once every part above is ready.
  openInitialPlace();

  // --- Choosing a place ---
  function updateUrl() {
    if (!urlActive || !state.place) return;
    let query = placeQuery({ ...state.place, name: state.place.named ? state.place.name : null }, map.getZoom());
    query += `&lang=${LANG}`; // the recipient of a shared URL sees the same language (#63)
    if (MAP_PARAM) query += `&${MAP_PARAM}`; // keep the base map (#51)
    // Replace the entry so "Back" does not walk through every place.
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

    // Wait a little, so quick repeated clicks do not use up the API.
    clearTimeout(debounceTimer);
    if (loadController) loadController.abort();
    retry.cancel();
    search.close();
    debounceTimer = setTimeout(() => load(place), 300);
  }

  // --- Loading and applying the forecast ---
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
      clearForecast();
      // Offline, it reloads when the connection comes back, so the button is only for an unreachable source.
      if (err instanceof NetworkError && !err.offline) {
        showStatus(`${t('forecastUnreachable')}${t('waitAndRetry')}`, true, { retry: true });
      } else {
        showStatus(errorMessage(err, 'forecast'), true);
      }
    }
  }

  // Go back to the display before any forecast was loaded (#103). Called when the chosen place failed
  // to load, so the forecast of the previous place is not shown under the new place's name.
  // A failed refresh of the same place keeps its forecast instead (refreshIfStale()).
  function clearForecast() {
    Object.assign(state, {
      loadedPlace: null, center: null, grid: null, gridValues: null,
      t: 0, nowIndex: 0, epochs: [], sky: [], dark: [], moonDown: [], moonUp: [],
      fetchedAt: 0, refreshFailed: false,
    });

    el.time.textContent = '—';
    el.total.textContent = '—';
    el.layers.replaceChildren();
    el.flow.textContent = '';
    el.windows.replaceChildren();
    el.fetched.hidden = true;
    el.timeline.getContext('2d').clearRect(0, 0, el.timeline.width, el.timeline.height);
    el.moonPhase.hidden = true;
    el.slider.value = 0;
    for (const control of [el.slider, el.play, el.now]) control.disabled = true;

    const arrowEl = marker && marker.getElement() && marker.getElement().querySelector('.arrow');
    if (arrowEl) arrowEl.hidden = true;
    if (overlay) overlay.remove();
    if (outline) outline.remove();
    overlay = null;
    outline = null;
  }

  // keepTime: after refetching, keep the time being shown (or the new "now", if "now" was shown).
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
    state.epochs = time.map((s) => localToEpoch(s, offset));
    Object.assign(state, skyPeriods(state.epochs, place.lat, place.lon)); // sky, dark, moonDown, moonUp
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

  // Whether the user is watching "now" without playing or moving the time.
  // Only then does the display move along with the clock (apply() and setupAutoRefresh()).
  function isFollowingNow() {
    return Boolean(state.center) && !state.timer && Math.round(state.t) === state.nowIndex;
  }

  // --- Status display ---
  // retry: whether to show the "Reload" button.
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

  // what: what failed to load ('forecast' or 'search'). The message for an unreachable source differs.
  function errorMessage(err, what) {
    if (err instanceof NetworkError) {
      if (err.offline) return t('offline');
      return what === 'search' ? t('searchUnreachable') : `${t('forecastUnreachable')}${t('tryLater')}`;
    }
    if (err instanceof DataError) return err.message;
    return t('unexpected');
  }

  // --- Rendering ---
  // index: the time to show, as a position in the hourly forecast (fractions while playing).
  function setTime(index) {
    if (!state.center) return;
    state.t = index;
    el.slider.value = Math.round(index);
    renderReadout();
    renderOverlay();
    renderTimeline();
    renderMoonPhase();
  }

  // Epoch milliseconds to the local time string at the destination of the forecast on screen.
  function localIso(ms) {
    return epochToLocal(ms, state.center.utc_offset_seconds);
  }

  // The time and the cloud cover at the time being shown.
  function renderReadout() {
    const { hourly, timezone_abbreviation: tz } = state.center;
    const i = Math.round(state.t);
    el.time.textContent = `${formatTime(hourly.time[i])} ${tz}`;

    const total = hourly.cloud_cover[i];
    el.total.textContent = total == null ? '—' : `${Math.round(total)}%`;

    renderLayers(hourly, i);
    renderFlow(hourly, i);
  }

  // A bar for each cloud layer, high to low.
  function renderLayers(hourly, i) {
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
  }

  // The wind of the cloudiest layer, as a guide to how the clouds at the destination move:
  // a sentence under the total cloud cover, and the arrow on the marker.
  function renderFlow(hourly, i) {
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
        px[p + 3] = cloudAlpha(c);
      }
    }
    offCtx.putImageData(offImage, 0, 0);
    overlay.setUrl(offscreen.toDataURL());
  }

  // The 3-day cloud timeline (timeline.js).
  function renderTimeline() {
    window.Timeline.draw(el.timeline, {
      hourly: state.center.hourly, epochs: state.epochs, sky: state.sky, moonUp: state.moonUp, t: state.t,
      rows: TIMELINE_ROWS, shortDate: i18n.shortDate, dpr: window.devicePixelRatio || 1,
    });
  }

  // The Moon's phase at the time shown, as an emoji next to the heading of the timeline (#52).
  function renderMoonPhase() {
    const ms = state.epochs[0] + state.t * 3600000;
    el.moonPhase.textContent = MOON_EMOJI[moonPhaseIndex(ms)];
    el.moonPhase.setAttribute('aria-label', t('moonPhaseLabel', Math.round(moonIllumination(ms) * 100)));
    el.moonPhase.hidden = false;
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
      // English cannot break between the elements, so add places where a line may break
      // (Japanese can break anywhere).
      li.append(btn, document.createElement('wbr'), small, document.createElement('wbr'), moon);
      return li;
    }));
  }

  // The Moon during an observing window.
  function moonLabel(w) {
    const c = moonCondition(w, state.moonDown);
    const clock = (ms) => formatTime(localIso(ms), false);
    if (c.kind === 'none') return t('moonNone');
    if (c.kind === 'up') return t('moonUp', Math.round(moonIllumination((w.start + w.end) / 2) * 100));
    return t('moonPartial', c.from ? clock(c.from) : '', c.to ? clock(c.to) : '');
  }

  // "Fetched at 21:05", in the time zone of this device.
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

  function clockText(date) {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  // --- Parts (in the order of the startup flow) ---

  // Decide the language of the page (#63), fill in its texts, and set up the language switch in the footer.
  // The language comes from the URL's lang, then the language chosen on this device, then the browser's settings.
  // The URL's lang is for opening a shared place in the same language, so it is not saved on the device
  // (only pressing the switch saves it).
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

    // "English / 日本語" in the footer. The current language is marked to look unpressable; pressing a language
    // saves it on this device and reopens the page at the same place.
    for (const a of document.querySelectorAll('.lang-switch [data-lang]')) {
      if (a.dataset.lang === lang) a.setAttribute('aria-current', 'true');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        try { window.localStorage.setItem(LANG_KEY, a.dataset.lang); } catch { /* the URL still switches it */ }
        const q = new URLSearchParams(location.search);
        q.set('lang', a.dataset.lang);
        location.assign(`${location.pathname}?${q}${location.hash}`);
      });
    }

    return { LANG: lang, URL_LANG: urlLang, i18n };
  }

  // The map, its base map and legend, and choosing a place by clicking on it.
  // It starts at Nobeyama; openInitialPlace() then moves it to the first place.
  function setupMap() {
    const map = L.map('map', { worldCopyJump: false, maxZoom: MAX_ZOOM }).setView([DEFAULT_PLACE.lat, DEFAULT_PLACE.lon], DEFAULT_ZOOM);

    // The base map (basemap.js): OpenFreeMap (English names) in English, GSI Tiles in Japanese (#51).
    // If OpenFreeMap cannot be used, fall back to GSI Tiles.
    const kind = (MAP_PARAM || LANG === 'en') ? 'ofm' : 'gsi';
    let baseLayer = null;
    const addBaseLayer = async (k) => {
      baseLayer = await window.Basemap.addBaseLayer(map, { kind: k, lang: LANG, t, maxZoom: MAX_ZOOM, creditEl: $('credit-map') });
    };
    addBaseLayer(kind).catch((err) => {
      console.error(err);
      if (kind !== 'gsi') addBaseLayer('gsi');
    });

    // The legend sits in the same bottom-right corner as the attribution. On a narrow map the
    // attribution wraps and gets taller, and the legend is pushed up above it instead of overlapping.
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => document.querySelector('.legend');
    legend.addTo(map);

    map.on('zoomend', () => {
      // OpenFreeMap is darkened by its style, so only GSI Tiles change their opacity with the zoom.
      if (baseLayer instanceof L.TileLayer) baseLayer.setOpacity(window.Basemap.gsiOpacity(map.getZoom()));
      updateUrl();
    });

    map.on('click', (e) => {
      const { lat } = e.latlng;
      const lon = wrapLon(e.latlng.lng);
      selectPlace({ name: coordName(lat, lon), lat, lon, named: false });
    });

    return map;
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

  // The "Reload" button, shown when the forecast source cannot be reached. It does not retry by itself:
  // the source is sometimes down for a long time, and we do not want to send requests for people who
  // are not looking. After a press it stays disabled for a minute, so it sends at most one request a minute.
  // Returns cancel() for selectPlace(), which re-enables it when another place is chosen.
  function setupRetry() {
    const COOLDOWN_MS = 60 * 1000;
    let cooldown = null;

    el.retry.addEventListener('click', () => {
      if (!state.place) return;
      el.retry.disabled = true;
      clearTimeout(cooldown);
      cooldown = setTimeout(() => { el.retry.disabled = false; }, COOLDOWN_MS);
      showStatus(t('loading'), false, { retry: true });
      load(state.place, { bust: true });
    });

    return {
      cancel() {
        clearTimeout(cooldown);
        el.retry.disabled = false;
      },
    };
  }

  // The home place: the place opened when the page has no place in its URL, saved in this browser.
  // If the browser cannot save it (e.g. site data is blocked), the button is hidden and Nobeyama opens.
  // Chrome's incognito mode can save it; it is cleared when the incognito windows are closed.
  // Returns saved() for openInitialPlace() and renderToggle() for selectPlace().
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
  // Returns close() for selectPlace().
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

    return {
      // Close the list when a place is chosen in any way (a result, coordinates, the map, the URL), and
      // ignore a search still in progress, so its late result does not open the list again (#106).
      // The search box keeps its text.
      close() {
        ++searchSeq;
        searchingName = null;
        list.hidden = true;
      },
    };
  }

  // Open the place given in the URL; without one, the saved home place, or else Nobeyama.
  // Also follow the URL hash while the page is open.
  function openInitialPlace() {
    // A place from the URL or the saved home. Without a name, its coordinates are its name.
    // fromUser: false keeps the URL as it is (see urlActive).
    const openPlace = (p, zoom, { fromUser = true } = {}) => {
      const place = { name: p.name || coordName(p.lat, p.lon), lat: p.lat, lon: p.lon, named: Boolean(p.name) };
      selectPlace(place, { pan: true, zoom, fromUser }); // with fromUser, rewrites the URL in the current format
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
    if (saved) openPlace(saved, saved.zoom ?? DEFAULT_ZOOM, { fromUser: false });
    else selectPlace(DEFAULT_PLACE, { pan: true, zoom: DEFAULT_ZOOM, fromUser: false });
  }
})();
