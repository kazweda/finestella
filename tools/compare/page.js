// Injected into the page before any of its scripts (Page.addScriptToEvaluateOnNewDocument).
// compare.js replaces __START__ with the epoch milliseconds the clock starts at.
//
// - A fake clock: Date and the timers only move when the scene advances them, so both versions see the
//   same times and the same timers fire in the same order.
// - Switches for the visibility of the page and the connection (navigator.onLine).
// - Leaflet without animations, so the map settles at once.
// - A snapshot of what the page shows, for compare.js to compare.
(() => {
  'use strict';

  const realSetTimeout = window.setTimeout.bind(window);
  const RealDate = Date;
  let now = __START__;

  // --- Clock ---
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() { return now; }
  }
  window.Date = FakeDate;

  const timers = new Map();
  let nextId = 1;
  const addTimer = (fn, ms, args, repeat) => {
    const delay = Math.max(0, Number(ms) || 0);
    const id = nextId++;
    timers.set(id, { fn, delay, at: now + delay, args, repeat });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => addTimer(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => addTimer(fn, ms, args, true);
  window.clearTimeout = (id) => { timers.delete(id); };
  window.clearInterval = (id) => { timers.delete(id); };

  // Fire every timer due within ms, in order of time (then of creation), moving the clock to each.
  // When a timer starts a request, wait (in real time) for it to finish before the clock moves on, as
  // requests take only milliseconds in a real browser. Otherwise a long jump would also fire the
  // request's own timeout. held: requests compare.js keeps on purpose, not to wait for.
  async function advance(ms, held = 0) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) {
        if (t.at <= end && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
      }
      if (!next) break;
      const [id, t] = next;
      now = t.at;
      if (t.repeat) t.at = now + Math.max(1, t.delay);
      else timers.delete(id);
      try {
        if (typeof t.fn === 'function') t.fn(...t.args);
      } catch (err) {
        console.error(err);
      }
      if (inflight > held) await idle(held);
    }
    now = end;
  }

  // Wait until no request (other than held ones) has been in flight for a few checks in a row,
  // since a finished request may lead to the next one (the grid after the destination).
  async function idle(held) {
    for (let quiet = 0, i = 0; quiet < 3 && i < 500; i++) {
      await new Promise((resolve) => realSetTimeout(resolve, 5));
      quiet = inflight <= held ? quiet + 1 : 0;
    }
  }

  // --- Visibility and connection ---
  let hidden = false;
  let online = true;
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => online });

  function setHidden(value) {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }
  function setOnline(value) {
    online = value;
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  }

  // --- Requests in flight, so compare.js can wait until the page is idle ---
  let inflight = 0;
  const realFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    inflight++;
    const p = realFetch(...args);
    p.then(() => {}, () => {}).finally(() => realSetTimeout(() => { inflight--; }, 0));
    return p;
  };

  // --- Leaflet without animations ---
  let leaflet;
  Object.defineProperty(window, 'L', {
    configurable: true,
    get: () => leaflet,
    set(value) {
      leaflet = value;
      if (value && value.Map && value.Map.mergeOptions) {
        value.Map.mergeOptions({ zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false });
      }
    },
  });

  // --- Snapshot ---
  // FNV-1a, to compare large strings (images) without sending them.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
  const normalize = (html) => html.replace(/data:[^"')\s]+/g, (m) => `data:#${hash(m)}`);

  function snapshot() {
    const $ = (s) => document.querySelector(s);
    const map = $('#map').cloneNode(true);
    // Tiles are blocked; whether a tile has already failed depends on timing, so leave them out.
    map.querySelectorAll('.leaflet-tile').forEach((n) => n.remove());
    const timeline = $('#timeline');
    const slider = $('#slider');
    const storage = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        storage[key] = localStorage.getItem(key);
      }
    } catch { /* blocked */ }
    return {
      url: location.pathname + location.search + location.hash,
      lang: document.documentElement.lang,
      panel: normalize($('.panel').outerHTML),
      search: normalize($('#search').outerHTML),
      searchInput: $('#search-input').value,
      map: normalize(map.innerHTML),
      slider: { value: slider.value, max: slider.max, disabled: slider.disabled },
      timeline: timeline.width ? `${timeline.width}x${timeline.height} #${hash(timeline.toDataURL())}` : 'empty',
      timers: [...timers.values()].map((t) => `${t.repeat ? 'interval' : 'timeout'} ${t.delay}ms in ${t.at - now}ms`).sort(),
      storage,
    };
  }

  window.__compare = {
    advance,
    now: () => now,
    setHidden,
    setOnline,
    inflight: () => inflight,
    snapshot,
    sleep: (ms) => new Promise((resolve) => realSetTimeout(resolve, ms)),
  };
})();
