// Drawing the forecast on the panel and the map (#118): the time and cloud cover, the bars of the layers,
// the flow of the clouds and the arrow on the marker, the clouds on the map, the 3-day timeline, the Moon's
// phase, the observing windows and "Fetched at".
// app.js decides when to draw (after loading, while playing, when the clock moves); this file decides how.
// Used as globalThis.Render in the browser. The texts at the top do not touch the page and are tested in Node.
(function (root) {
  'use strict';

  // --- Texts (no page) ---

  // "21:05", in the time zone of this device.
  function clockText(date) {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  // "Fetched at 21:05", in the time zone of this device, with the date when it is not today (now).
  // refreshFailed: why the last refresh failed ('offline', 'unreachable', 'error'), or false.
  function fetchedText({ fetchedAt, refreshFailed, now, t, shortDate }) {
    const at = new Date(fetchedAt);
    const sameDay = at.toDateString() === now.toDateString();
    const clock = clockText(at);
    const when = sameDay ? clock : `${shortDate(at.getMonth() + 1, at.getDate())} ${clock}`;
    return refreshFailed ? t('fetchedStale', when, refreshFailed) : t('fetchedAt', when);
  }

  // The Moon during an observing window. moonDown: the periods when the Moon is down (skyPeriods()).
  // utcOffsetSeconds: of the destination, for the times shown.
  function moonText(w, { moonDown, utcOffsetSeconds, t, formatTime }) {
    const { moonCondition, moonIllumination, epochToLocal } = root.Forecast;
    const c = moonCondition(w, moonDown);
    const clock = (ms) => formatTime(epochToLocal(ms, utcOffsetSeconds), false);
    if (c.kind === 'none') return t('moonNone');
    if (c.kind === 'up') return t('moonUp', Math.round(moonIllumination((w.start + w.end) / 2) * 100));
    return t('moonPartial', c.from ? clock(c.from) : '', c.to ? clock(c.to) : '');
  }

  // --- Drawing ---

  const OVERLAY_PX = 180;
  // The Moon's phase in eight steps (moonPhaseIndex()), as seen from the northern hemisphere.
  const MOON_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

  // el, state: app.js's elements and state (state.t is set here, by setTime()).
  // map: the Leaflet map. getMarker: returns the marker of the chosen place (made by selectPlace()), or null.
  // LAYERS: the cloud layers, low to high, with their wind levels.
  function createRenderer({ el, state, i18n, map, getMarker, LAYERS }) {
    const { t, formatTime } = i18n;
    const {
      valueAt, sampleGrid, cloudAlpha, windFlow, epochToLocal, moonIllumination, moonPhaseIndex, findObservingWindows,
    } = root.Forecast;

    // Rows of the 3-day timeline (timeline.js), from the top.
    const TIMELINE_ROWS = [
      { label: t('layerAll'), key: 'cloud_cover' },
      { label: t('layerHigh'), key: 'cloud_cover_high' },
      { label: t('layerMid'), key: 'cloud_cover_mid' },
      { label: t('layerLow'), key: 'cloud_cover_low' },
    ];
    // The cloud layer is Open-Meteo data too, so the map also shows its source and license (CC BY 4.0).
    // Longer notes (interpolation, the source of the shoreline data) are in the credits below the panel.
    const CLOUD_ATTRIBUTION = t('cloudAttributionHtml');

    // The clouds on the map, drawn on an offscreen canvas, and the outline of the area they cover.
    let overlay = null;
    let outline = null;
    const offscreen = document.createElement('canvas');
    offscreen.width = offscreen.height = OVERLAY_PX;
    const offCtx = offscreen.getContext('2d');
    const offImage = offCtx.createImageData(OVERLAY_PX, OVERLAY_PX);

    // Put the clouds and their outline over the area of a newly loaded forecast.
    function showGrid(bounds) {
      if (outline) outline.remove();
      if (overlay) overlay.remove();
      overlay = L.imageOverlay(offscreen.toDataURL(), bounds, { className: 'cloud-layer', opacity: 1, interactive: false, attribution: CLOUD_ATTRIBUTION }).addTo(map);
      outline = L.rectangle(bounds, { color: '#8fc7ff', weight: 1, dashArray: '4 4', fill: false, interactive: false }).addTo(map);
    }

    // Go back to the display before any forecast was loaded (#103): "—", no bars, windows, timeline,
    // Moon or "Fetched at", no arrow on the marker, and no clouds on the map.
    function clear() {
      el.time.textContent = '—';
      el.total.textContent = '—';
      el.layers.replaceChildren();
      el.flow.textContent = '';
      el.windows.replaceChildren();
      el.fetched.hidden = true;
      el.timeline.getContext('2d').clearRect(0, 0, el.timeline.width, el.timeline.height);
      el.moonPhase.hidden = true;

      const marker = getMarker();
      const arrowEl = marker && marker.getElement() && marker.getElement().querySelector('.arrow');
      if (arrowEl) arrowEl.hidden = true;
      if (overlay) overlay.remove();
      if (outline) outline.remove();
      overlay = null;
      outline = null;
    }

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
      const marker = getMarker();
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

    function moonLabel(w) {
      return moonText(w, { moonDown: state.moonDown, utcOffsetSeconds: state.center.utc_offset_seconds, t, formatTime });
    }

    // "Fetched at 21:05" (fetchedText()).
    function renderFetched() {
      if (!state.fetchedAt) { el.fetched.hidden = true; return; }
      el.fetched.textContent = fetchedText({
        fetchedAt: state.fetchedAt, refreshFailed: state.refreshFailed, now: new Date(), t, shortDate: i18n.shortDate,
      });
      el.fetched.classList.toggle('stale', Boolean(state.refreshFailed));
      el.fetched.hidden = false;
    }

    return { setTime, renderWindows, renderFetched, renderTimeline, showGrid, clear };
  }

  root.Render = { clockText, fetchedText, moonText, createRenderer };
})(globalThis);
