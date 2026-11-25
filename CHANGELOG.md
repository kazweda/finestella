# Changelog

[日本語](CHANGELOG.ja.md)

Notable changes to FineStella for its users. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This English changelog starts at 0.7.0, the first version with an English interface. For earlier versions, see the [Japanese changelog](CHANGELOG.ja.md).

## [Unreleased]

## [0.10.0] - 2026-11-24

### Added

- A "current location" button at the top left of the map. Press it to see the cloud forecast for where you are. Your location is read only when you press the button, and your browser asks for permission the first time. It is rounded to about 1 km, so sharing the URL does not give away your exact location.

## [0.9.0] - 2026-11-23

### Changed

- In "Clouds over 3 days", the band showing when the Moon is up is now drawn in one color instead of getting brighter with the Moon's phase. A thin moon made the band dark and hard to see against the night. The Moon's phase at the time shown now appears as an emoji (🌒🌓🌔🌕 and so on) next to the heading.

### Fixed

- Different places with the same name in search results could not be told apart (for example, "Mauna Kea, Hawaii" listed the summit on the Big Island and a place on Maui as the same two lines). Only for such results, the county or city is now added, as in "Mauna Kea, Hawaii County, Hawaii, United States".

## [0.8.1] - 2026-11-23

### Fixed

- When the forecast for a newly chosen place failed to load, the cloud cover and the clouds on the map from the previous place stayed on screen under the new place's name. Now the readings show "—" and the clouds are removed from the map. Once the forecast loads, after "Reload" or when the connection comes back, it is shown as usual.
- The list of search results stayed open over the map when a place was chosen by tapping the map instead. It now closes whenever a place is chosen.

## [0.8.0] - 2026-11-23

### Added

- You can now enter coordinates as "latitude, longitude" (e.g. `35.6812, 139.7671`) in the search box to open that location. Coordinates copied from FineStella or Google Maps can be pasted as they are.
- Japanese place names are easier to find in romaji. Town names without hyphens (Aizuwakamatsu), district names (Otemachi, Matsuyama) and places that could not be found before (Yamanakako) are now found through OpenStreetMap's place search (Nominatim). Space-separated "town state" queries such as "Moab Utah" also work. The search box example is now "Mauna Kea, Hawaii", to show that adding a state or prefecture after a comma narrows the results.
- This English changelog. The "Changelog" link at the bottom of the English page now opens it instead of the Japanese one.

### Changed

- A place chosen from search now opens zoomed in to town level (zoom 10). It used to open at a wide view (zoom 8), which on a phone showed a whole region and made the place hard to see. Zoom out to check the surrounding clouds.
- Link previews on social media (description and image) and the description shown in search results are now in both English and Japanese.
- On the English map (OpenFreeMap), roads and rivers are drawn brighter so they stay visible under heavy cloud. Town and village names take priority over peak names, and neighborhood and locality names appear when you zoom in. In wide views, only highways are shown, faintly, so roads don't overlap into a mesh.

## [0.7.0] - 2026-11-20

### Added

- FineStella is now available in English. It opens in Japanese if your browser's language is Japanese, and in English otherwise. Switch with "English / 日本語" at the bottom of the page; your choice is remembered on that device.
- In English, the base map uses OpenFreeMap (OpenStreetMap data) and shows place and peak names in English worldwide, including Japan. Place search also looks up names in English.
- Shared URLs now include the language (e.g. `&lang=en`), so the recipient sees the same language.

### Changed

- When the app added to your home screen is opened after being unused for a while (5 minutes or more), it now reloads automatically if a new version is available. Previously, improvements and fixes might not arrive until you fully closed and reopened the app. The location you were viewing stays open.
- The deployment ID (e.g. `(82d4eef)`) is now shown next to the version number at the bottom of the page, so you can tell which version is running.

[Unreleased]: https://github.com/kazweda/finestella/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/kazweda/finestella/releases/tag/v0.10.0
[0.9.0]: https://github.com/kazweda/finestella/releases/tag/v0.9.0
[0.8.1]: https://github.com/kazweda/finestella/releases/tag/v0.8.1
[0.8.0]: https://github.com/kazweda/finestella/releases/tag/v0.8.0
[0.7.0]: https://github.com/kazweda/finestella/releases/tag/v0.7.0
