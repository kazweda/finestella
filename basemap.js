// OpenFreeMap(OpenStreetMap のデータ)で描く背景地図のスタイル(#51)。
// 主役は雲なので、海と陸・主な道路・都市名・山頂だけを暗い色で描く。
// 国境線や国・州の名前は描かない(係争のある地域の扱いを、このアプリの地図として示さないため)。
// 地名は lang の言語(name:en など)で1段だけ出す。将来、日本語版も一本化するときは lang を変えるだけで済む。
(function (root) {
  'use strict';

  const OFM_SOURCE = 'https://tiles.openfreemap.org/planet';
  const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const FONT = ['Noto Sans Regular'];

  const COLORS = {
    land: '#1d2533',
    water: '#0b1018', // 地図の背景(style.css の #map)と同じ
    road: '#273141',
    label: '#8d9aab',
    peak: '#a9b5c4',
    halo: '#0b1018',
  };

  // その言語の名前がなければ、次の名前にする。どちらもなければ出さない。
  // - 日本語:現地の名前。日本の地名は name:ja がなくても name が日本語のことが多く、ローマ字にすると読みにくいため
  // - それ以外:ローマ字の名前。現地の名前にすると、英語版で日本の山頂などが漢字のまま出るため
  const nameField = (lang) => ['coalesce', ['get', `name:${lang}`], ['get', lang === 'ja' ? 'name' : 'name:latin'], ''];

  const OFM_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> '
    + '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
    + 'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

  function ofmStyle(lang) {
    const name = nameField(lang);
    const label = (id, filter, minzoom, size) => ({
      id, type: 'symbol', source: 'ofm', 'source-layer': 'place', filter, minzoom,
      layout: { 'text-field': name, 'text-font': FONT, 'text-size': size, 'text-max-width': 8 },
      paint: { 'text-color': COLORS.label, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.2 },
    });
    return {
      version: 8,
      glyphs: OFM_GLYPHS,
      sources: { ofm: { type: 'vector', url: OFM_SOURCE } },
      layers: [
        { id: 'land', type: 'background', paint: { 'background-color': COLORS.land } },
        { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': COLORS.water } },
        {
          id: 'road', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 6,
          filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
          paint: { 'line-color': COLORS.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 11, 1.5] },
        },
        label('place-village', ['==', ['get', 'class'], 'village'], 10, 11),
        label('place-town', ['==', ['get', 'class'], 'town'], 8, 12),
        label('place-city', ['==', ['get', 'class'], 'city'], 4, ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15]),
        {
          // 山頂は名前と標高を2行で出す(観測地を選ぶ目印になるため)。
          id: 'peak', type: 'symbol', source: 'ofm', 'source-layer': 'mountain_peak', minzoom: 8,
          filter: ['all', ['==', ['get', 'class'], 'peak'], ['has', 'ele']],
          layout: {
            'text-field': ['format', name, {}, '\n', {}, ['concat', ['to-string', ['get', 'ele']], ' m'], { 'font-scale': 0.85 }],
            'text-font': FONT, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.3],
          },
          paint: { 'text-color': COLORS.peak, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.2 },
        },
      ],
    };
  }

  root.Basemap = { ofmStyle, OFM_ATTRIBUTION };
})(globalThis);
