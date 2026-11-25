# FineStella

[日本語](README.ja.md)

FineStella is a cloud forecast web app for stargazing. Choose a destination and a time, and see how much cloud there will be and how it will move.

**Open the app:** https://finestella.com/

It is still at an early stage (0.x). The interface is available in English and Japanese.

## Features

### Clouds

- Total, low, mid and high cloud cover at your destination for any time over 3 days, starting today
- Cloud cover for about 130 km in every direction, drawn on the map; play it forward to watch the clouds move
- The direction and speed of the clouds, based on the wind near the height of the clouds

### Finding a good time to observe

- "Best observing windows" for each night: dark hours when total cloud cover stays at 30% or less. Dark hours are outside astronomical twilight (Sun below −18°), to the minute
- The Moon in each window: no Moon, the time it sets or rises partway through, or Moon up with the percentage illuminated
- Bands above the cloud timeline show how dark the sky is (day, twilight, night) and when the Moon is up. The changes are drawn to the minute, at sunrise and sunset (−0.83°) and astronomical twilight. An emoji next to the heading shows the Moon's phase at the time shown

### Choosing a place

- Tap the map or search by name (the map zooms in to level 11, wide enough to see a whole city). Enter "latitude, longitude" (e.g. `35.6812, 139.7671`) in the search box to open that point
- The location button on the map ("Show clouds at my location") shows the forecast for where you are. Your location is read only when you press the button, and is rounded to about 1 km
- Save a place as your home to open it next time (a place in the URL takes priority)
- The place, its name and the zoom level are kept in the URL, so a bookmark or a shared link opens the same view (e.g. `?lat=19.821&lon=-155.468&name=Mauna+Kea&z=10`)
- Open the place in Google Maps, or copy its coordinates

### Other

- While the page stays open, "now" follows the clock, and a forecast fetched 30 minutes ago or more is fetched again (the time it was fetched is shown)
- The language follows your browser settings. Switch with "English / 日本語" at the bottom of the page; your choice is remembered on that device (`lang` in the URL takes priority)

## Limitations

- Only forecasts are shown. There are no live satellite images.
- Forecasts are hourly, and the surrounding cloud cover is interpolated from a grid about 0.4 degrees apart. The shape and motion of the clouds are only a guide.
- The direction of the clouds is an estimate from the wind at the layer with the most cloud over the destination.
- The Japanese base map (GSI Tiles) is shown only up to zoom 8 outside Japan (cloud data is still available). The English base map (OpenFreeMap) covers the whole world.
- Choosing a place fetches forecasts for up to 50 points (the destination and 49 around it), so the app uses a fairly large number of API calls.

## Data sources and terms

The terms of each provider were checked on 2026-11-11 (see [#2](https://github.com/kazweda/finestella/issues/2)). All of them allow the current use, which is free and without ads. The required credits are shown at the bottom right of the map and at the bottom of the panel.

| Use | Provider | Terms |
|---|---|---|
| Forecasts | [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) | The free tier is for non-commercial use (an app without ads is treated as non-commercial). Attribution required |
| Place search outside Japan | [Open-Meteo](https://open-meteo.com/en/docs/geocoding-api) (data from [GeoNames](https://www.geonames.org/), CC BY 4.0) | Attribution required |
| Place search in Japan | [Geospatial Information Authority of Japan (GSI)](https://maps.gsi.go.jp/) (the place search of GSI Maps) | Attribution required. The API specification is not public and may change without notice |
| Place search in Japan (in the English interface, when Open-Meteo finds nothing) | [Nominatim](https://nominatim.org/) (data from [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL) | Attribution required. The [usage policy](https://operations.osmfoundation.org/policies/nominatim/) allows at most 1 request per second and forbids requests while typing (autocomplete). Requests are sent only when the search button is pressed ([#82](https://github.com/kazweda/finestella/issues/82)) |
| Base map (Japanese) | [GSI Tiles](https://maps.gsi.go.jp/development/ichiran.html) (pale map) | No application needed. The tiles are modified (for example, colors are inverted), so this must be stated along with the attribution. The source of the shoreline data outside Japan is also shown |
| Base map (English) | [OpenFreeMap](https://openfreemap.org/) (data from [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL) | Free, no registration. Attribution to OpenFreeMap, OpenMapTiles and OpenStreetMap required |
| Base map rendering (English) | [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause) | Loaded only in English |
| Map display | [Leaflet](https://leafletjs.com/) (BSD-2-Clause) | The "Leaflet" credit on the map is kept |

**Request limits:** The free tier of Open-Meteo allows 600 requests per minute, 5,000 per hour and 10,000 per day for each IP address. The app gets forecasts through a relay ([worker/](worker/)) that caches each forecast for 10 minutes. When the relay cannot be reached or fails, including when it reaches the limit, the browser requests Open-Meteo directly. If that request also reaches the limit, the app shows "Too many requests".

**Analytics:** The site uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) to learn the number of visits, countries, referrers and device types. It does not use cookies. Cloudflare Web Analytics does not record query strings ([official FAQ](https://developers.cloudflare.com/web-analytics/faq/)), so the place in the URL (latitude, longitude and name) is not recorded. Data is grouped only by page path (`/`), as checked on the dashboard on 2026-11-14.

Earning money from the app through ads or charges would require a paid Open-Meteo plan. The terms of use of GSI content should also be checked before any commercial use.

## Development

No build is needed: open `index.html` in a browser.

Run the tests with:

```sh
node --test
```

GitHub Actions runs the same tests on pull requests. After a merge to `main`, the tests run again and the site is then deployed to GitHub Pages within a few minutes. `.node-version` keeps the Node version the same locally and in CI.

- Changes are recorded in [CHANGELOG.md](CHANGELOG.md). The footer of the site shows the version number and a link to the changelog.
- The release steps are in [docs/RELEASE.md](docs/RELEASE.md) (in Japanese).

## About the name

"FineStella" has three meanings:

- **Fine**: clear, beautiful (English)
- **Stella**: star (Latin and Italian)
- It sounds like **finestra**, Italian for "window". This carries on the idea of the former name, Sky Window: a window for looking into the sky above your destination

The app was renamed from Sky Window in November 2026. The old URL, https://skywindow.netplan.jp/, redirects to the new one.

## Support

If you like FineStella, you can support my work here!

☕ [Buy me a coffee](https://buymeacoffee.com/netplan)

Donations are voluntary, and nothing is given in return. Under Open-Meteo's terms, voluntary donations, including tips, can be accepted while using the free tier.

## License

The code in this repository is released under the [MIT License](LICENSE). Forecast data, base maps and other external content are subject to the terms of each provider, described in "Data sources and terms" above.
