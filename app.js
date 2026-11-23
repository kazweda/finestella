// FineStella's page: the startup flow, and when things happen (choosing a place, loading, refreshing).
// The details are in the other files, loaded before this one (index.html):
// - Parts of the page: render.js (drawing the forecast on the panel and the map), search-box.js (the search
//   box), timeline.js (the 3-day timeline), basemap.js (the base map).
// - No page, tested in Node: forecast.js (the clouds, the Sun and the Moon), places.js (places and their URLs),
//   api.js (fetching forecasts and places), search.js (searching place names), update.js (new builds),
//   i18n.js (the texts; its setupPage() also fills in the page's texts and the language switch).
(function () {
  'use strict';

  const {
    buildGrid, localToEpoch, skyPeriods, wrapLon, currentIndex, reindexTime,
  } = window.Forecast;
  const {
    rankGsiResults, parsePlaceUrl, placeQuery, formatCoords, googleMapsUrl, parseHome, serializeHome, isSamePlace,
  } = window.Places;

  // --- Startup flow (#88, #119) ---
  // 1. Decide the language first (i18n.js), since the constants below use t().
  // 2. Declare the constants and the state shared by the parts.
  // 3. Set up each part with its setup…() below, then open the first place.
  // Below the startup flow there are only function declarations (they are hoisted, so they can be
  // called before they appear). Everything they share is declared here, before the first call.
  const { LANG, URL_LANG, i18n } = window.I18n.setupPage({
    doc: document, location, navigator, getStorage: () => window.localStorage,
  });
  const { t, coordName } = i18n;

  const FORECAST_DAYS = 3;
  const MAX_ZOOM = 11; // wide enough to see a whole city
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
    // The chosen place and what can be done with it (selectPlace(), setupCopyCoords(), setupHome()).
    place: $('place'), placeActions: $('place-actions'), gmap: $('gmap'), copyCoords: $('copy-coords'), homeToggle: $('home-toggle'),
    // The status line and the "Reload" button (showStatus(), setupRetry()).
    status: $('status'), statusText: $('status-text'), retry: $('retry'),
    // Where the forecast is drawn (render.js). The timeline is also dragged (setupTimeControls()).
    time: $('time'), fetched: $('fetched'), total: $('total'), layers: $('layers'), flow: $('flow'), windows: $('windows'),
    timeline: $('timeline'), moonPhase: $('moon-phase'),
    // The time controls (setupTimeControls()). render.js moves the slider along with the time shown.
    slider: $('slider'), play: $('play'), now: $('now'),
    // The search box (search-box.js).
    search: $('search'), searchInput: $('search-input'), searchResults: $('search-results'),
  };

  // place is the place the user chose; loadedPlace is the place of the forecast on screen.
  // They differ while a forecast is loading, and when it failed to load.
  const state = {
    place: null, loadedPlace: null, center: null, grid: null, gridValues: null,
    t: 0, nowIndex: 0, epochs: [], sky: [], dark: [], moonDown: [], moonUp: [], timer: null,
    fetchedAt: 0, refreshing: false, refreshFailed: false, loadFailed: false,
  };

  // The marker of the chosen place. selectPlace() makes and moves it; the rendering turns its arrow.
  const pinIcon = L.divIcon({ className: 'pin', html: '<div class="arrow" hidden></div><div class="dot"></div>', iconSize: [0, 0] });
  let marker = null;

  // Choosing a place and loading its forecast (selectPlace(), updateUrl(), load()).
  // The place is written to the URL only after it was opened from the URL or chosen by the user.
  // Opened with nothing in the URL, the URL is left as it is, so the saved home place (#11) keeps
  // winning over the URL.
  let urlActive = false;
  let loadController = null;
  let debounceTimer = null;

  // The map comes first, since the other parts read its zoom or draw on it.
  const map = setupMap();
  // How to draw the forecast (render.js). This file decides when: apply(), the time controls, the auto refresh.
  const { setTime, renderWindows, renderFetched, renderTimeline, showGrid, clear: clearDisplay } = setupRendering();
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

    clearDisplay();
    el.slider.value = 0;
    for (const control of [el.slider, el.play, el.now]) control.disabled = true;
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

    showGrid(data.grid.bounds);

    renderWindows();
    renderFetched();
    setTime(kept ?? state.nowIndex);
  }

  // Whether the user is watching "now" without playing or moving the time.
  // Only then does the display move along with the clock (apply() and setupAutoRefresh()).
  function isFollowingNow() {
    return Boolean(state.center) && !state.timer && Math.round(state.t) === state.nowIndex;
  }

  // --- Status display and error messages (errorMessage() is also used by the search box) ---
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

  // --- Parts (in the order of the startup flow) ---

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

  // Drawing the forecast on the panel and the map (render.js): the readout, the bars of the layers, the flow
  // of the clouds and the arrow on the marker, the clouds on the map, the timeline, the Moon, the observing
  // windows and "Fetched at". Returns the functions apply() and the other parts call.
  function setupRendering() {
    return window.Render.createRenderer({ el, state, i18n, map, getMarker: () => marker, LAYERS });
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
      const build = $('build');
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

  // The search box (search-box.js). A place chosen there opens at town level (SEARCH_ZOOM).
  // Place names are searched with search.js. Returns close() for selectPlace().
  function setupSearch() {
    const { searchPlaces } = window.Search.create({
      fetchJson: api.fetchJson, lang: LANG, t, rankGsiResults, logError: console.error,
    });
    return window.SearchBox.setup({
      form: el.search, input: el.searchInput, list: el.searchResults, searchPlaces, t, coordName,
      errorMessage: (err) => errorMessage(err, 'search'),
      choose: (place) => selectPlace(place, { pan: true, zoom: SEARCH_ZOOM }),
    });
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
