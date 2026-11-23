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

  // Open-Meteo's candidates for display. The label is "name, admin1, country".
  // Different places can share a label (two "Mauna Kea, Hawaii, United States", on Hawaii and Maui), so
  // only for those, add admin2, then admin3 and admin4, after the name until they can be told apart (#86).
  // Other labels stay short, so they fit on one line on a phone. separator: t('listSeparator').
  function openMeteoResults(data, separator) {
    const places = (data && Array.isArray(data.results) ? data.results : []).map((r) => ({
      r, parts: [r.name, r.admin1, r.country],
    }));
    const labelOf = (p) => p.parts.filter(Boolean).join(separator);
    for (const level of ['admin2', 'admin3', 'admin4']) {
      const counts = new Map();
      for (const p of places) counts.set(labelOf(p), (counts.get(labelOf(p)) || 0) + 1);
      const shared = places.filter((p) => counts.get(labelOf(p)) > 1);
      if (!shared.length) break;
      // Right after the name, so the areas go from small to large (name, admin3, admin2, admin1, country).
      // Skip one that is already in the label (e.g. admin2 "松本市" for the city "松本市").
      for (const p of shared) {
        const area = p.r[level];
        if (area && !p.parts.includes(area)) p.parts.splice(1, 0, area);
      }
    }
    return places.map((p) => ({ name: p.r.name, label: labelOf(p), lat: p.r.latitude, lon: p.r.longitude }));
  }

  // Merge Open-Meteo's results for the same query in Japanese (local) and English (#114).
  // In Japanese, some places are matched only by their Japanese name, so a Latin query misses them
  // (the summit of Mauna Kea is "マウナ・ケア山" and "Mauna Kea" does not find it).
  // Keeps the English order, uses the Japanese entry for a place found in both, and adds the places
  // found only in Japanese after them. A place found only in English keeps its name, but its areas and
  // country are put in Japanese when another Japanese entry has the same area (by admin1_id etc.).
  function mergeLocalized(local, english) {
    const hasId = (r) => r.id != null;
    const byId = new Map(local.filter(hasId).map((r) => [r.id, r]));
    const names = {};
    for (const key of ['admin1', 'admin2', 'admin3', 'admin4', 'country']) {
      names[key] = new Map(local.filter((r) => r[`${key}_id`] && r[key]).map((r) => [r[`${key}_id`], r[key]]));
    }
    const localize = (r) => {
      const out = { ...r };
      for (const key of Object.keys(names)) {
        const name = names[key].get(r[`${key}_id`]);
        if (name) out[key] = name;
      }
      return out;
    };
    const merged = english.map((r) => (hasId(r) && byId.get(r.id)) || localize(r));
    const seen = new Set(english.filter(hasId).map((r) => r.id));
    return [...merged, ...local.filter((r) => !hasId(r) || !seen.has(r.id))];
  }

  // Katakana place names written with or without the middle dot (#114). Open-Meteo's Japanese names
  // use it ("マウナ・ケア山", "ラ・パルマ") and match only from the start of the name, so "マウナケア" finds nothing.
  const KATAKANA_ONLY = /^[\p{Script=Katakana}ー・\s]+$/u;
  const isKatakana = (name) => KATAKANA_ONLY.test(name) && /\p{Script=Katakana}/u.test(name);
  // "マウナ ケア" → "マウナ・ケア" (like withComma() for "Moab Utah"). null without a space.
  const withNakaguro = (name) => (/\s/.test(name.trim()) ? name.trim().split(/\s+/).join('・') : null);
  // The name without middle dots and spaces, to compare "マウナケア" with "マウナ・ケア山".
  const katakanaKey = (name) => name.replace(/[・\s]/g, '');
  // When nothing is found, search again with the end cut off, this many times at most, with more results
  // (a shorter name matches more places). A middle dot right after the first character ("ラ・パルマ") is not reached.
  const KATAKANA_RETRIES = 3;
  const KATAKANA_COUNT = 20;

  // fetchJson: URL から JSON を取る関数。lang: 画面の言語。t: 文言。rankGsiResults: places.js の並べ替え。
  // logError: 片方の検索が失敗しても続けるときに、失敗を記録する関数。
  function create({ fetchJson, lang, t, rankGsiResults, logError = () => {} }) {
    // 国内の地名は国土地理院で探す。Open-Meteo は「札幌」「高縄山」のような日本語の地名を
    // 見つけられないことが多いため、国土地理院に合う地名がないとき(主に海外)だけ併用する。
    async function geocodeGsi(name) {
      const data = await fetchJson(`${GSI_SEARCH}?${new URLSearchParams({ q: name })}`);
      return rankGsiResults(data, name);
    }

    // Open-Meteo's raw results.
    async function fetchOpenMeteo(name, language = lang, count = LIMIT) {
      const params = new URLSearchParams({ name, count, language, format: 'json' });
      const data = await fetchJson(`${GEOCODE}?${params}`);
      return data && Array.isArray(data.results) ? data.results : [];
    }

    const toResults = (raw) => openMeteoResults({ results: raw.slice(0, LIMIT) }, t('listSeparator'));

    async function geocodeOpenMeteo(name) {
      return toResults(await fetchOpenMeteo(name));
    }

    // Places abroad in the Japanese UI (#114).
    // - Latin input ("Mauna Kea"): search in Japanese and English and merge them, since some places are
    //   matched only by their Japanese name in Japanese. A failed English search is only logged.
    // - Katakana input: searchKatakana().
    // - Other Japanese input (kanji, hiragana): in Japanese, as before.
    async function geocodeAbroadJa(name) {
      if (!JAPANESE.test(name)) {
        const [local, english] = await Promise.all([
          fetchOpenMeteo(name, 'ja'),
          fetchOpenMeteo(name, 'en').catch((err) => { logError(err); return []; }),
        ]);
        return toResults(mergeLocalized(local, english));
      }
      if (isKatakana(name)) return toResults(await searchKatakana(name));
      return toResults(await fetchOpenMeteo(name, 'ja'));
    }

    // Katakana with or without middle dots. Spaces become middle dots ("マウナ ケア" → "マウナ・ケア").
    // If nothing is found, cut the end off and search again, keeping only the places whose name without
    // middle dots starts with the input ("マウナケア" → "マウナ" finds "マウナ・ケア山", but not "マウナボ").
    async function searchKatakana(name) {
      const found = await fetchOpenMeteo(withNakaguro(name) || name, 'ja');
      if (found.length) return found;
      const key = katakanaKey(name);
      for (let cut = 1; cut <= KATAKANA_RETRIES; cut++) {
        const prefix = key.slice(0, key.length - cut);
        if (prefix.length < 2) break;
        const matched = (await fetchOpenMeteo(prefix, 'ja', KATAKANA_COUNT))
          .filter((r) => katakanaKey(r.name || '').startsWith(key));
        if (matched.length) return matched;
      }
      return [];
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
      const abroad = await (lang === 'ja' ? geocodeAbroadJa(name) : geocodeOpenMeteo(name)).catch((err) => {
        if (domestic.length) { logError(err); return []; }
        throw err;
      });
      return [...abroad, ...domestic].slice(0, LIMIT);
    }

    return { searchPlaces };
  }

  root.Search = { create, withComma, nominatimResults, openMeteoResults, mergeLocalized };
})(globalThis);
