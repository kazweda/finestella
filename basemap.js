// OpenFreeMap(OpenStreetMap のデータ)で描く背景地図のスタイル(#51)。
// 主役は雲なので、海と陸・川・道路・町村名・山頂だけを暗い色で描く。
// 国境線や国・州の名前は描かない(係争のある地域の扱いを、このアプリの地図として示さないため)。
// 地名は lang の言語(name:en など)で1段だけ出す。将来、日本語版も一本化するときは lang を変えるだけで済む。
(function (root) {
  'use strict';

  const OFM_SOURCE = 'https://tiles.openfreemap.org/planet';
  const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const FONT = ['Noto Sans Regular'];

  // 雲(白)を重ねても線や地名が見分けられるよう、陸と道路・川の明るさの差を大きめにとる(#63)。
  const COLORS = {
    land: '#202938',
    water: '#0b1018', // 地図の背景(style.css の #map)と同じ
    river: '#0e1520',
    road: '#55657b',
    roadMinor: '#3d4a5c',
    label: '#c3ccd8',
    labelMinor: '#9aa6b5',
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
    const label = (id, classes, minzoom, size, color = COLORS.label) => ({
      id, type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom,
      filter: ['match', ['get', 'class'], classes, true, false],
      layout: { 'text-field': name, 'text-font': FONT, 'text-size': size, 'text-max-width': 8 },
      paint: { 'text-color': color, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.4 },
    });
    // 道路の線。minzoom で出し始め、そこから2段階かけて濃くする。
    const road = (id, classes, minzoom, width, maxWidth) => ({
      id, type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom,
      filter: ['match', ['get', 'class'], classes, true, false],
      paint: {
        'line-color': COLORS.road,
        'line-width': ['interpolate', ['linear'], ['zoom'], minzoom, width, 10, maxWidth],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0.3, minzoom + 2, 1],
      },
    });
    return {
      version: 8,
      glyphs: OFM_GLYPHS,
      sources: { ofm: { type: 'vector', url: OFM_SOURCE } },
      layers: [
        { id: 'land', type: 'background', paint: { 'background-color': COLORS.land } },
        { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': COLORS.water } },
        {
          id: 'river', type: 'line', source: 'ofm', 'source-layer': 'waterway', minzoom: 8,
          filter: ['match', ['get', 'class'], ['river', 'canal'], true, false],
          paint: { 'line-color': COLORS.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 11, 2] },
        },
        {
          id: 'road-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 9,
          filter: ['match', ['get', 'class'], ['secondary', 'tertiary'], true, false],
          paint: { 'line-color': COLORS.roadMinor, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 11, 1.2] },
        },
        // 広い範囲では道路が網の目のように重なって見づらいので、縮小するほど本数を減らして薄くする。
        // 拡大したときは、雲が多くても見分けられる明るさにする。
        // ズームは MapLibre の値で、アプリ(Leaflet)のズームより1小さい(例:minzoom 7 はアプリのズーム8から)。
        // 日本の国道の多くは trunk に分類されていて本数が多いため、高速道路(motorway)より1段階遅らせる。
        road('road-primary', ['primary'], 8, 0.5, 1.6),
        road('road-trunk', ['trunk'], 7, 0.5, 1.8),
        road('road-motorway', ['motorway'], 5, 0.6, 2),
        // ラベルは、重なると後ろの層ほど優先して残る。目印の山頂より、場所がわかる町村名を優先する。
        {
          // 山頂は名前と標高を2行で出す(観測地を選ぶ目印になるため)。重なったら高い山を残す。
          id: 'peak', type: 'symbol', source: 'ofm', 'source-layer': 'mountain_peak', minzoom: 8,
          filter: ['all', ['==', ['get', 'class'], 'peak'], ['has', 'ele']],
          layout: {
            'text-field': ['format', name, {}, '\n', {}, ['concat', ['to-string', ['get', 'ele']], ' m'], { 'font-scale': 0.85 }],
            'text-font': FONT, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.3],
            'symbol-sort-key': ['-', 0, ['get', 'ele']],
          },
          paint: { 'text-color': COLORS.peak, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.2 },
        },
        label('place-local', ['hamlet', 'suburb', 'quarter', 'neighbourhood'], 9, 10, COLORS.labelMinor),
        label('place-village', ['village'], 8, 11.5),
        label('place-town', ['town'], 7, 12.5),
        label('place-city', ['city'], 4, ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15]),
      ],
    };
  }

  root.Basemap = { ofmStyle, OFM_ATTRIBUTION };
})(globalThis);
