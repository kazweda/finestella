// 地名検索(#74)。画面には触らないので、fetchJson などを渡せば Node のテストからも使える。
// ブラウザでは globalThis.Search として使う。
(function (root) {
  'use strict';

  const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
  const GSI_SEARCH = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
  const LIMIT = 6;

  // 日本語(漢字・かな)を含むか。
  const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

  // fetchJson: URL から JSON を取る関数。lang: 画面の言語。t: 文言。rankGsiResults: places.js の並べ替え。
  // logError: 片方の検索が失敗しても続けるときに、失敗を記録する関数。
  function create({ fetchJson, lang, t, rankGsiResults, logError = () => {} }) {
    // 国内の地名は国土地理院で探す。Open-Meteo は「札幌」「高縄山」のような日本語の地名を
    // 見つけられないことが多いため、国土地理院に合う地名がないとき(主に海外)だけ併用する。
    async function geocodeGsi(name) {
      const data = await fetchJson(`${GSI_SEARCH}?${new URLSearchParams({ q: name })}`);
      return rankGsiResults(data, name);
    }

    async function geocodeOpenMeteo(name) {
      const params = new URLSearchParams({ name, count: LIMIT, language: lang, format: 'json' });
      const data = await fetchJson(`${GEOCODE}?${params}`);
      return (data.results || []).map((r) => ({
        name: r.name,
        label: [r.name, r.admin1, r.country].filter(Boolean).join(t('listSeparator')),
        lat: r.latitude,
        lon: r.longitude,
      }));
    }

    async function searchPlaces(name) {
      // 英語で、日本語を含まない地名は Open-Meteo だけで探す。国土地理院は日本語の地名しか見つけられないため。
      if (lang !== 'ja' && !JAPANESE.test(name)) return geocodeOpenMeteo(name);
      let domestic = [];
      try {
        domestic = await geocodeGsi(name);
      } catch (err) {
        logError(err); // 国土地理院が使えなくても Open-Meteo で探す
      }
      if (domestic.some((r) => r.strong)) return domestic;
      // 「ハワイ」で国内の施設名だけが見つかった場合などは、海外の候補を先に並べる。
      const abroad = await geocodeOpenMeteo(name).catch((err) => {
        if (domestic.length) { logError(err); return []; }
        throw err;
      });
      return [...abroad, ...domestic].slice(0, LIMIT);
    }

    return { searchPlaces };
  }

  root.Search = { create };
})(globalThis);
