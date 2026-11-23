// Fixed responses in place of the forecast and place-search APIs.
// The values are computed from the coordinates and the hour, so every run (and both versions) gets the same data
// without storing large JSON files. They only need to look like the real responses, not to be realistic.
'use strict';

// The clock starts at 2026-11-20 12:00 JST. The forecast covers the 3 days from midnight, like Open-Meteo.
const START = Date.parse('2026-11-20T12:00:00+09:00');
const FIRST_HOUR = Date.parse('2026-11-20T00:00:00+09:00');
const HOURS = 72;
const OFFSET = 9 * 3600;

const pad = (n) => String(n).padStart(2, '0');
const localTime = (ms) => {
  const d = new Date(ms + OFFSET * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`;
};
const TIMES = Array.from({ length: HOURS }, (_, h) => localTime(FIRST_HOUR + h * 3600000));

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const SEEDS = { cloud_cover: 0, cloud_cover_low: 1.3, cloud_cover_mid: 2.9, cloud_cover_high: 4.1 };

// Cloud cover that changes with the place and the hour. Clear stretches (0%) make some observing windows.
function cloud(name, lat, lon, h) {
  const seed = SEEDS[name] ?? 0;
  return clamp(40 + 70 * Math.sin((2 * Math.PI * h) / 31 + lat * 3 + lon * 2 + seed));
}

// Southern bands with fixed weather, for the cases the pattern above never makes (#118):
// overcast (no observing window), clear (no notable cloud), and clouds without a wind direction.
const OVERCAST = (lat) => lat <= -20 && lat > -30;
const CLEAR = (lat) => lat <= -30 && lat > -40;
const NO_WIND_DIRECTION = (lat) => lat <= -40 && lat > -50;

function value(name, lat, lon, h) {
  if (name.startsWith('cloud_cover')) {
    if (OVERCAST(lat)) return 100;
    if (CLEAR(lat)) return 0;
    if (NO_WIND_DIRECTION(lat)) return 80;
    return cloud(name, lat, lon, h);
  }
  if (name.startsWith('wind_direction_') && NO_WIND_DIRECTION(lat)) return null;
  if (name.startsWith('wind_speed_')) return 4 + ((h * 3 + Math.round(lat)) % 25);
  if (name.startsWith('wind_direction_')) return (h * 17 + Math.round(lon * 10)) % 360;
  return null;
}

function point(lat, lon, hourly) {
  const series = { time: TIMES };
  for (const name of hourly) series[name] = TIMES.map((_, h) => value(name, lat, lon, h));
  return {
    latitude: lat, longitude: lon, timezone: 'Asia/Tokyo', timezone_abbreviation: 'JST', utc_offset_seconds: OFFSET,
    hourly: series,
  };
}

// The answer to a forecast URL: one place, or a list for the grid (comma-separated coordinates).
function forecast(url) {
  const q = url.searchParams;
  const lats = q.get('latitude').split(',').map(Number);
  const lons = q.get('longitude').split(',').map(Number);
  const hourly = q.get('hourly').split(',');
  const points = lats.map((lat, i) => point(lat, lons[i], hourly));
  return points.length === 1 ? points[0] : points;
}

const gsi = (title, lon, lat, addressCode = '') => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { title, addressCode },
});

const GSI = {
  松本: [gsi('長野県松本市', 137.972, 36.238, '20202'), gsi('松本', 140.1, 36.3)],
  長野: [gsi('長野県長野市', 138.181, 36.651, '20201'), gsi('長野', 139.3, 35.6)],
  野辺山: [gsi('長野県南佐久郡南牧村野辺山', 138.473, 35.953, '20305')],
};

const OPEN_METEO = {
  'Mauna Kea': [{ id: 5850027, name: 'Mauna Kea', latitude: 19.82, longitude: -155.468, country: 'United States', admin1: 'Hawaii' }],
};

// The answer to a place-search URL, or null for a host we do not know.
function search(url) {
  const q = url.searchParams;
  if (url.hostname === 'msearch.gsi.go.jp') return GSI[q.get('q')] || [];
  if (url.hostname === 'geocoding-api.open-meteo.com') return { results: OPEN_METEO[q.get('name')] || [] };
  if (url.hostname === 'nominatim.openstreetmap.org') return [];
  return null;
}

module.exports = { START, forecast, search };
