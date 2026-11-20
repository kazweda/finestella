const test = require('node:test');
const assert = require('node:assert/strict');
require('../places.js');
require('../i18n.js');
require('../search.js');
const { Search, Places, I18n } = globalThis;

// 国土地理院と Open-Meteo の代わり。呼ばれた先を記録する。
function fakeFetchJson({ gsi = [], openMeteo = [], gsiFails = false } = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    const host = new URL(url).hostname;
    calls.push(host.includes('gsi') ? 'gsi' : 'open-meteo');
    if (host.includes('gsi')) {
      if (gsiFails) throw new Error('GSI down');
      return gsi;
    }
    return { results: openMeteo };
  };
  return { fetchJson, calls };
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
