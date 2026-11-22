// 地名検索(#74)。画面には触らないので、fetchJson などを渡せば Node のテストからも使える。
// ブラウザでは globalThis.Search として使う。
(function (root) {
  'use strict';

  const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
  const GSI_SEARCH = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const LIMIT = 6;
  // Nominatim はふだん1秒以内に返る。補助の問い合わせなので、ほかより早く打ち切る(#82)。
  const NOMINATIM_TIMEOUT_MS = 8 * 1000;

  // 日本語(漢字・かな)を含むか。
  const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

  // スペース区切りの「町名 県名」を、Open-Meteo が絞り込みに使えるカンマ区切りに直す(Moab Utah → Moab, Utah)。
  // 最後の語だけを県名・州名とみなす。カンマがあるか、1語なら null。
  function withComma(name) {
    if (/[,、，]/.test(name)) return null;
    const m = name.trim().match(/^(.+?)\s+(\S+)$/);
    return m ? `${m[1]}, ${m[2]}` : null;
  }

  // Nominatim の候補を表示用にする。表示名は英語の名前(名前・市町村・県)だけで組み立てる。
  // display_name や道路名には、英語を指定しても日本語が混じるため。名前が日本語しかない候補は出さない。
  function nominatimResults(data) {
    const picked = [];
    for (const r of Array.isArray(data) ? data : []) {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      const a = r.address || {};
      const name = r.name || '';
      if (!name || JAPANESE.test(name) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // 同じ場所の候補(駅と停留所など)はまとめる。国土地理院の候補と同じく約1km。
      if (picked.some((p) => Math.abs(p.lat - lat) < 0.01 && Math.abs(p.lon - lon) < 0.01)) continue;
      // 県は「Ehime Prefecture」の形で返る。Open-Meteo の候補(「Nagano」)とそろえる。
      const pref = (a.province || a.state || '').replace(/\s+Prefecture$/, '');
      const parts = [name, a.city || a.town || a.village, pref, a.country]
        .filter((p, i, all) => p && !JAPANESE.test(p) && all.indexOf(p) === i);
      picked.push({ name, label: parts.join(', '), lat, lon });
      if (picked.length >= LIMIT) break;
    }
    return picked;
  }

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

    // 日本の地名だけを探す。海外の地名は Open-Meteo で見つかり、Nominatim への問い合わせ(1秒に1回まで)を減らせるため。
    async function geocodeNominatim(name) {
      const params = new URLSearchParams({
        q: name, format: 'jsonv2', addressdetails: 1, countrycodes: 'jp', 'accept-language': lang, limit: LIMIT,
      });
      const data = await fetchJson(`${NOMINATIM}?${params}`, undefined, { timeoutMs: NOMINATIM_TIMEOUT_MS });
      return nominatimResults(data);
    }

    // 英語で、日本語を含まない地名を探す(#82)。どこかで見つかったら、そこで返す。
    // 1. Open-Meteo(入力のまま)
    // 2. Open-Meteo(スペース区切りをカンマ区切りに直す)。Open-Meteo はスペース区切りの「町名 県名」を見つけられない
    // 3. Nominatim(日本だけ)。ハイフンのない町名(Aizuwakamatsu)、町名(Otemachi, Matsuyama)、
    //    Open-Meteo に登録のない地名(Yamanakako)のため
    async function searchLatin(name) {
      const results = await geocodeOpenMeteo(name);
      if (results.length) return results;
      const comma = withComma(name);
      if (comma) {
        const retried = await geocodeOpenMeteo(comma);
        if (retried.length) return retried;
      }
      return geocodeNominatim(name);
    }

    async function searchPlaces(name) {
      // 英語で、日本語を含まない地名は国土地理院を使わない。国土地理院は日本語の地名しか見つけられないため。
      if (lang !== 'ja' && !JAPANESE.test(name)) return searchLatin(name);
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

  root.Search = { create, withComma, nominatimResults };
})(globalThis);
