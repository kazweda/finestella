const test = require('node:test');
const assert = require('node:assert/strict');
require('../places.js');
require('../i18n.js');
require('../search.js');
require('../api.js');
const { Search, Places, I18n, Api } = globalThis;

// 国土地理院・Open-Meteo・Nominatim の代わり。呼ばれた先と URL・打ち切りの時間を記録する。
// openMeteo は候補の配列か、入力(name)から候補の配列を返す関数。
function fakeFetchJson({ gsi = [], openMeteo = [], nominatim = [], gsiFails = false, nominatimError = null, openMeteoFails = null } = {}) {
  const calls = [];
  const requests = [];
  const fetchJson = async (url, signal, options = {}) => {
    const u = new URL(url);
    const host = u.hostname.includes('gsi') ? 'gsi' : u.hostname.includes('nominatim') ? 'nominatim' : 'open-meteo';
    calls.push(host);
    requests.push({ host, params: u.searchParams, timeoutMs: options.timeoutMs });
    if (host === 'gsi') {
      if (gsiFails) throw new Error('GSI down');
      return gsi;
    }
    if (host === 'nominatim') {
      if (nominatimError) throw nominatimError;
      return nominatim;
    }
    const name = u.searchParams.get('name');
    const language = u.searchParams.get('language');
    if (openMeteoFails === language) throw new Error(`Open-Meteo (${language}) down`);
    return { results: typeof openMeteo === 'function' ? openMeteo(name, language, Number(u.searchParams.get('count'))) : openMeteo };
  };
  return { fetchJson, calls, requests };
}

const gsiFeature = (title, lon, lat, props = {}) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { title, addressCode: '', ...props },
});
const meteo = (name, admin1, country, latitude, longitude) => ({ name, admin1, country, latitude, longitude });

const search = (lang, fake) => Search.create({ fetchJson: fake.fetchJson, lang, t: I18n.create(lang).t, rankGsiResults: Places.rankGsiResults }).searchPlaces;

test('英語で、日本語を含まない地名は Open-Meteo だけで探す', async () => {
  const fake = fakeFetchJson({ openMeteo: [meteo('Mauna Kea', 'Hawaii', 'United States', 19.82, -155.47)] });
  const results = await search('en', fake)('Mauna Kea');
  assert.deepEqual(fake.calls, ['open-meteo']);
  assert.equal(results[0].label, 'Mauna Kea, Hawaii, United States');
});

test('英語でも、漢字・かなを含む地名は国土地理院で探す', async () => {
  const fake = fakeFetchJson({ gsi: [gsiFeature('長野県南牧村野辺山', 138.47, 35.95)] });
  await search('en', fake)('野辺山');
  assert.equal(fake.calls[0], 'gsi');
});

test('日本語で国土地理院に合う地名があれば、Open-Meteo は使わない', async () => {
  const fake = fakeFetchJson({ gsi: [gsiFeature('愛媛県松山市', 132.77, 33.84)] });
  const results = await search('ja', fake)('松山');
  assert.deepEqual(fake.calls, ['gsi']);
  assert.equal(results[0].label, '愛媛県松山市');
});

test('国土地理院で合う地名がなければ、海外(Open-Meteo)の候補を先に並べる', async () => {
  const fake = fakeFetchJson({
    // 施設(dataSource 1)は名前の一部が合うだけのことが多いので、合う地名としては扱われない。
    gsi: [gsiFeature('スパリゾートハワイアンズ', 140.8, 37.0, { dataSource: '1', addressCode: '07204' })],
    openMeteo: [meteo('ハワイ', '', 'アメリカ合衆国', 19.6, -155.5)],
  });
  const results = await search('ja', fake)('ハワイ');
  assert.deepEqual(fake.calls, ['gsi', 'open-meteo']);
  assert.equal(results[0].name, 'ハワイ');
});

test('国土地理院が使えなくても、Open-Meteo で探す', async () => {
  const fake = fakeFetchJson({ gsiFails: true, openMeteo: [meteo('札幌市', '北海道', '日本', 43.06, 141.35)] });
  const results = await search('ja', fake)('札幌');
  assert.equal(results.length, 1);
});

// --- 表示名がまったく同じ候補(#86) ---
// Open-Meteo の返り値の形(2026-11-23 に確認した値を短くしたもの)。
const place = (name, admin1, admin2, country, latitude, longitude, more = {}) => ({ name, admin1, admin2, country, latitude, longitude, ...more });
const labels = (results, sep = ', ') => Search.openMeteoResults({ results }, sep).map((r) => r.label);

test('表示名が同じ候補だけ、名前のあとに admin2 を足して見分ける', () => {
  assert.deepEqual(labels([
    place('Mauna Kea', 'Hawaii', 'Hawaii County', 'United States', 19.82, -155.47),
    place('Mauna Kea', 'Hawaii', 'Maui County', 'United States', 20.92, -156.31),
    place('Mauna Kea State Park', 'Hawaii', 'Hawaii County', 'United States', 19.75, -155.52),
  ]), [
    'Mauna Kea, Hawaii County, Hawaii, United States',
    'Mauna Kea, Maui County, Hawaii, United States',
    'Mauna Kea State Park, Hawaii, United States',
  ]);
});

test('表示名が重ならなければ、今までどおり「名前, 州・県, 国」のまま', () => {
  assert.deepEqual(labels([
    place('Matsumoto', 'Nagano', 'Matsumoto Shi', 'Japan', 36.23, 137.97),
    place('Matsumoto', 'Okinawa', 'Okinawa Shi', 'Japan', 26.36, 127.82),
    place('Matsumoto', 'Kumamoto', 'Kuma-gun', 'Japan', 32.4, 130.83, { admin3: 'Itsuki Mura' }),
  ]), ['Matsumoto, Nagano, Japan', 'Matsumoto, Okinawa, Japan', 'Matsumoto, Kumamoto, Japan']);
  assert.deepEqual(labels([place('Moab', 'Utah', 'Grand', 'United States', 38.57, -109.55)]), ['Moab, Utah, United States']);
  assert.deepEqual(labels([place('Tokyo', 'Tokyo', '', 'Japan', 35.69, 139.69)]), ['Tokyo, Tokyo, Japan']);
});

test('admin2 も同じなら admin3、admin4 の順に足し、小さい区分から並べる', () => {
  assert.deepEqual(labels([
    place('Springfield', 'Illinois', 'Sangamon', 'United States', 39.8, -89.64, { admin3: 'Capital Township' }),
    place('Springfield', 'Illinois', 'Sangamon', 'United States', 39.9, -89.7, { admin3: 'Woodside Township' }),
  ]), [
    'Springfield, Capital Township, Sangamon, Illinois, United States',
    'Springfield, Woodside Township, Sangamon, Illinois, United States',
  ]);
});

test('名前と同じ区分は足さず、日本語では「、」で区切る', () => {
  assert.deepEqual(labels([
    place('松本市', '長野県', '松本市', '日本', 36.23, 137.97),
    place('松本市', '長野県', '東筑摩郡', '日本', 36.3, 137.9),
  ], '、'), ['松本市、長野県、日本', '松本市、東筑摩郡、長野県、日本']);
});

test('区分がすべて同じか、ない候補は、見分けられないまま並べる', () => {
  assert.deepEqual(labels([
    place('Twin Peak', 'Utah', '', 'United States', 38.1, -110.1),
    place('Twin Peak', 'Utah', '', 'United States', 38.2, -110.2),
  ]), ['Twin Peak, Utah, United States', 'Twin Peak, Utah, United States']);
  assert.deepEqual(Search.openMeteoResults({}, ', '), []);
  assert.deepEqual(Search.openMeteoResults(null, ', '), []);
});

test('英語の画面で「Mauna Kea, Hawaii」を探すと、2つの Mauna Kea を見分けられる', async () => {
  const fake = fakeFetchJson({ openMeteo: [
    place('Mauna Kea', 'Hawaii', 'Hawaii County', 'United States', 19.82, -155.47),
    place('Mauna Kea', 'Hawaii', 'Maui County', 'United States', 20.92, -156.31),
  ] });
  const results = await search('en', fake)('Mauna Kea, Hawaii');
  assert.deepEqual(results, [
    { name: 'Mauna Kea', label: 'Mauna Kea, Hawaii County, Hawaii, United States', lat: 19.82, lon: -155.47 },
    { name: 'Mauna Kea', label: 'Mauna Kea, Maui County, Hawaii, United States', lat: 20.92, lon: -156.31 },
  ]);
});

// --- 英語のローマ字の地名(#82) ---
// Nominatim の返り値の形(2026-11-22 に確認した値を短くしたもの)。
const nominatimPlace = (name, lat, lon, address) => ({ name, lat: String(lat), lon: String(lon), address: { country: 'Japan', ...address } });

test('スペース区切りの「町名 県名」を、カンマ区切りに直す', () => {
  assert.equal(Search.withComma('Moab Utah'), 'Moab, Utah');
  assert.equal(Search.withComma(' Mauna Kea  Hawaii '), 'Mauna Kea, Hawaii');
  assert.equal(Search.withComma('Fujimi, Nagano'), null);
  assert.equal(Search.withComma('Aizuwakamatsu'), null);
});

test('英語で Open-Meteo に見つかれば、探し直さない', async () => {
  const fake = fakeFetchJson({ openMeteo: [meteo('Moab', 'Utah', 'United States', 38.57, -109.55)] });
  const results = await search('en', fake)('Moab, Utah');
  assert.deepEqual(fake.calls, ['open-meteo']);
  assert.equal(results[0].label, 'Moab, Utah, United States');
});

test('英語で0件なら、カンマ区切りに直して Open-Meteo で探し直す', async () => {
  const fake = fakeFetchJson({
    openMeteo: (name) => (name === 'Fujimi, Nagano' ? [meteo('Fujimi', 'Nagano', 'Japan', 35.91, 138.24)] : []),
  });
  const results = await search('en', fake)('Fujimi Nagano');
  assert.deepEqual(fake.calls, ['open-meteo', 'open-meteo']);
  assert.equal(fake.requests[1].params.get('name'), 'Fujimi, Nagano');
  assert.equal(results[0].label, 'Fujimi, Nagano, Japan');
});

test('それでも0件なら、日本に限って Nominatim で探し、8秒で打ち切る', async () => {
  const fake = fakeFetchJson({
    nominatim: [nominatimPlace('Aizuwakamatsu', 37.49, 139.93, { city: 'Aizuwakamatsu', province: 'Fukushima Prefecture' })],
  });
  const results = await search('en', fake)('Aizuwakamatsu');
  assert.deepEqual(fake.calls, ['open-meteo', 'nominatim']); // 1語なのでカンマ区切りの探し直しはしない
  const { params, timeoutMs } = fake.requests[1];
  assert.equal(params.get('q'), 'Aizuwakamatsu');
  assert.equal(params.get('countrycodes'), 'jp');
  assert.equal(params.get('accept-language'), 'en');
  assert.equal(timeoutMs, 8000);
  assert.deepEqual(results, [{ name: 'Aizuwakamatsu', label: 'Aizuwakamatsu, Fukushima, Japan', lat: 37.49, lon: 139.93 }]);
});

test('Nominatim の候補は英語の名前だけで表示名を作り、同じ場所の候補はまとめる', async () => {
  const fake = fakeFetchJson({
    nominatim: [
      nominatimPlace('Otemachi', 33.8428, 132.7642, { road: '松山港線', neighbourhood: 'Otemachi 1-chome', city: 'Matsuyama', province: 'Ehime Prefecture' }),
      nominatimPlace('Otemachi', 33.8429, 132.7641, { city: 'Matsuyama', province: 'Ehime Prefecture' }), // 停留所
      nominatimPlace('大手町', 33.84, 132.77, { city: 'Matsuyama' }), // 英語の名前がない
    ],
  });
  const results = await search('en', fake)('Otemachi, Matsuyama');
  assert.deepEqual(fake.calls, ['open-meteo', 'nominatim']); // カンマがあるので直さない
  assert.deepEqual(results.map((r) => r.label), ['Otemachi, Matsuyama, Ehime, Japan']);
});

test('名前と市町村が同じなら、表示名に重ねない', () => {
  const [lake, village] = Search.nominatimResults([
    nominatimPlace('Lake Yamanaka', 35.41, 138.87, { village: 'Yamanakako', province: 'Yamanashi Prefecture' }),
    nominatimPlace('Yamanakako', 35.43, 138.88, { village: 'Yamanakako', province: 'Yamanashi Prefecture' }),
  ]);
  assert.equal(lake.label, 'Lake Yamanaka, Yamanakako, Yamanashi, Japan');
  assert.equal(village.label, 'Yamanakako, Yamanashi, Japan');
});

test('Nominatim も0件なら0件、失敗したらそのエラーを返す', async () => {
  assert.deepEqual(await search('en', fakeFetchJson())('Hoshinomura'), []);
  const err = new Api.NetworkError(false);
  await assert.rejects(search('en', fakeFetchJson({ nominatimError: err }))('Yamanakako'), err);
});

test('日本語の画面では Nominatim を使わない', async () => {
  const fake = fakeFetchJson();
  await search('ja', fake)('Yamanakako');
  assert.deepEqual(fake.calls, ['gsi', 'open-meteo', 'open-meteo']); // ローマ字なので日本語と英語(#114)
});

// --- 日本語の画面で、海外の地名(#114) ---
// Open-Meteo の返り値の形(2026-11-23 に確認した値を短くしたもの)。日本語では、山頂は日本語の名前でしか当たらない。
const US = { country_id: 6252001, admin1_id: 5855797 };
const MAUNA_KEA_JA = [
  { id: 6326699, name: 'Mauna Kea', admin1: 'ハワイ州', admin2: 'マウイ郡', admin2_id: 5850871, country: 'アメリカ', ...US, latitude: 20.92, longitude: -156.31 },
  { id: 5850916, name: 'Mauna Kea State Park', admin1: 'ハワイ州', admin2: 'ハワイ郡', admin2_id: 5855765, country: 'アメリカ', ...US, latitude: 19.75, longitude: -155.52 },
];
const MAUNA_KEA_EN = [
  { id: 5850911, name: 'Mauna Kea', admin1: 'Hawaii', admin2: 'Hawaii County', admin2_id: 5855765, country: 'United States', ...US, latitude: 19.82, longitude: -155.47 },
  { id: 6326699, name: 'Mauna Kea', admin1: 'Hawaii', admin2: 'Maui County', admin2_id: 5850871, country: 'United States', ...US, latitude: 20.92, longitude: -156.31 },
  { id: 5850916, name: 'Mauna Kea State Park', admin1: 'Hawaii', admin2: 'Hawaii County', admin2_id: 5855765, country: 'United States', ...US, latitude: 19.75, longitude: -155.52 },
];

test('日本語と英語の結果は英語の順に並べ、両方にある地点は日本語、英語だけの地点も区分と国を日本語にする', () => {
  const merged = Search.mergeLocalized(MAUNA_KEA_JA, MAUNA_KEA_EN);
  assert.deepEqual(merged.map((r) => r.id), [5850911, 6326699, 5850916]);
  assert.deepEqual(Search.openMeteoResults({ results: merged }, '、').map((r) => r.label), [
    'Mauna Kea、ハワイ郡、ハワイ州、アメリカ',
    'Mauna Kea、マウイ郡、ハワイ州、アメリカ',
    'Mauna Kea State Park、ハワイ州、アメリカ',
  ]);
  // 日本語にしかない地点は後ろに足す。区分が日本語で見つからなければ英語のまま
  const onlyJa = { id: 1, name: 'ハワイ火山国立公園', admin1: 'ハワイ州', country: 'アメリカ', ...US };
  const unknownArea = { id: 2, name: 'Somewhere', admin1: 'Elsewhere', admin1_id: 9, country: 'United States', country_id: 6252001 };
  const more = Search.mergeLocalized([onlyJa], [unknownArea]);
  assert.deepEqual(more.map((r) => [r.id, r.admin1, r.country]), [[2, 'Elsewhere', 'アメリカ'], [1, 'ハワイ州', 'アメリカ']]);
});

test('日本語の画面で「Mauna Kea」を探すと、日本語と英語で探し、山頂が先頭に出る', async () => {
  const fake = fakeFetchJson({ openMeteo: (name, language) => (language === 'ja' ? MAUNA_KEA_JA : MAUNA_KEA_EN) });
  const results = await search('ja', fake)('Mauna Kea');
  assert.deepEqual(fake.calls, ['gsi', 'open-meteo', 'open-meteo']);
  assert.deepEqual(fake.requests.slice(1).map((r) => r.params.get('language')).sort(), ['en', 'ja']);
  assert.deepEqual(results[0], { name: 'Mauna Kea', label: 'Mauna Kea、ハワイ郡、ハワイ州、アメリカ', lat: 19.82, lon: -155.47 });
  assert.equal(results[1].label, 'Mauna Kea、マウイ郡、ハワイ州、アメリカ');
});

test('英語での検索に失敗しても、日本語の結果を出す', async () => {
  const errors = [];
  const fake = fakeFetchJson({ openMeteoFails: 'en', openMeteo: MAUNA_KEA_JA });
  const results = Search.create({ fetchJson: fake.fetchJson, lang: 'ja', t: I18n.create('ja').t, rankGsiResults: Places.rankGsiResults, logError: (e) => errors.push(e) });
  assert.deepEqual((await results.searchPlaces('Mauna Kea')).map((r) => r.lat), [20.92, 19.75]);
  assert.equal(errors.length, 1);
});

test('日本語の画面で、漢字・ひらがなの入力は今までどおり日本語だけで探す', async () => {
  const fake = fakeFetchJson({ openMeteo: [meteo('パリ', 'イル＝ド＝フランス地域圏', 'フランス', 48.85, 2.35)] });
  await search('ja', fake)('巴里');
  assert.deepEqual(fake.calls, ['gsi', 'open-meteo']);
  assert.equal(fake.requests[1].params.get('language'), 'ja');
});

// 本物と同じく、日本語の名前の先頭で照合する偽の Open-Meteo。
const katakanaPlaces = [
  meteo('マウナボ', 'マウナボ', '', 18.0, -65.9),
  meteo('マウナ・ケア山', 'ハワイ州', 'アメリカ', 19.82, -155.47),
  meteo('ラ・パルマ', 'カリフォルニア州', 'アメリカ', 33.85, -118.05),
];
const prefixSearch = (name, language, count) => katakanaPlaces.filter((p) => p.name.startsWith(name)).slice(0, count);
const openMeteoNames = (fake) => fake.requests.filter((r) => r.host === 'open-meteo').map((r) => r.params.get('name'));

test('カタカナで0件なら、末尾を削って探し直し、中点を除いて比べる(マウナケア → マウナ・ケア山)', async () => {
  const fake = fakeFetchJson({ openMeteo: prefixSearch });
  const results = await search('ja', fake)('マウナケア');
  assert.deepEqual(openMeteoNames(fake), ['マウナケア', 'マウナケ', 'マウナ']);
  assert.deepEqual(fake.requests.filter((r) => r.host === 'open-meteo').map((r) => r.params.get('count')), ['6', '20', '20']);
  assert.deepEqual(results.map((r) => r.label), ['マウナ・ケア山、ハワイ州、アメリカ']); // 「マウナボ」は除く
});

test('カタカナの間のスペースは中点に直し、見つかれば探し直さない', async () => {
  const fake = fakeFetchJson({ openMeteo: prefixSearch });
  const results = await search('ja', fake)('マウナ ケア');
  assert.deepEqual(openMeteoNames(fake), ['マウナ・ケア']);
  assert.equal(results[0].name, 'マウナ・ケア山');
  const full = fakeFetchJson({ openMeteo: prefixSearch });
  await search('ja', full)('マウナ　ケア'); // 全角スペース
  assert.deepEqual(openMeteoNames(full), ['マウナ・ケア']);
});

test('カタカナの探し直しは3回までで、2文字より短くは削らない', async () => {
  const fake = fakeFetchJson({ openMeteo: prefixSearch });
  assert.deepEqual(await search('ja', fake)('ラパルマ'), []); // 「ラ・パルマ」には届かない(限界)
  assert.deepEqual(openMeteoNames(fake), ['ラパルマ', 'ラパル', 'ラパ']);
  const long = fakeFetchJson({ openMeteo: () => [] });
  await search('ja', long)('サンペドロデアタカマ');
  assert.equal(openMeteoNames(long).length, 4); // 入力のまま + 探し直し3回
});

test('英語の画面では、カタカナでも探し直さない', async () => {
  const fake = fakeFetchJson({ openMeteo: prefixSearch });
  assert.deepEqual(await search('en', fake)('マウナケア'), []);
  assert.deepEqual(openMeteoNames(fake), ['マウナケア']);
});
