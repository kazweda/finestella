const test = require('node:test');
const assert = require('node:assert/strict');
require('../basemap.js');
const B = globalThis.Basemap;

const sourceLayers = (style) => style.layers.map((l) => l['source-layer']).filter(Boolean);

test('国境線と国・州の名前は描かない', () => {
  const style = B.ofmStyle('en');
  assert.ok(!sourceLayers(style).includes('boundary'), '国境線のレイヤーがある');
  for (const l of style.layers.filter((x) => x['source-layer'] === 'place')) {
    const json = JSON.stringify(l.filter);
    assert.ok(!/country|state|province/.test(json), `${l.id} が国や州の名前を出す`);
  }
});

test('地名は指定した言語の名前を1段で出す', () => {
  for (const lang of ['en', 'ja']) {
    const style = B.ofmStyle(lang);
    const labels = style.layers.filter((l) => l.type === 'symbol');
    assert.ok(labels.length >= 3);
    for (const l of labels) {
      const json = JSON.stringify(l.layout['text-field']);
      assert.ok(json.includes(`"name:${lang}"`), `${l.id} が name:${lang} を使っていない`);
      assert.ok(!json.includes('name:nonlatin'), `${l.id} が現地の文字を2段目に出す`);
    }
  }
});

test('名前がないとき、英語ではローマ字、日本語では現地の名前にする', () => {
  const field = (lang) => JSON.stringify(B.ofmStyle(lang).layers.find((l) => l.id === 'place-city').layout['text-field']);
  assert.ok(field('en').includes('"name:latin"'));
  assert.ok(!field('en').includes('["get","name"]'), '英語で現地の名前(漢字など)が出る');
  assert.ok(field('ja').includes('["get","name"]'));
  assert.ok(!field('ja').includes('"name:latin"'), '日本語でローマ字が出る');
});

test('山頂は名前と標高を出す', () => {
  const peak = B.ofmStyle('en').layers.find((l) => l['source-layer'] === 'mountain_peak');
  assert.ok(peak);
  assert.ok(JSON.stringify(peak.layout['text-field']).includes('"ele"'));
});

test('出典に OpenStreetMap と OpenFreeMap を示す', () => {
  assert.match(B.OFM_ATTRIBUTION, /OpenStreetMap/);
  assert.match(B.OFM_ATTRIBUTION, /OpenFreeMap/);
});
