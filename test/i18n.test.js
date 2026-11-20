const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../i18n.js');
const I = globalThis.I18n;

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const LANGS = Object.keys(I.MESSAGES);

// index.html の data-i18n などに書いたキーと、要素の中身(スクリプトが動く前の表示)。
const textRefs = [...html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)].map((m) => ({ key: m[1], text: m[2] }));
const htmlRefs = [...html.matchAll(/<(\w+)[^>]*data-i18n-html="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({ key: m[2], text: m[3] }));
const attrRefs = [...html.matchAll(/<[^>]*data-i18n-attr="([^"]+)"[^>]*>/g)].flatMap((m) => m[1].split(';').map((pair) => {
  const [attr, key] = pair.split(':').map((s) => s.trim());
  const value = (m[0].match(new RegExp(`\\s${attr}="([^"]*)"`)) || [])[1];
  return { key, text: value };
}));

test('index.html と app.js が使う文言は、すべての言語にある', () => {
  const keys = new Set([
    ...[...textRefs, ...htmlRefs, ...attrRefs].map((r) => r.key),
    ...[...app.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(keys.size >= 40);
  for (const lang of LANGS) {
    for (const key of keys) assert.ok(key in I.MESSAGES[lang], `${lang} に ${key} がない`);
  }
});

test('index.html の日本語は i18n.js の日本語と同じ(スクリプトが動く前の表示とずれない)', () => {
  const { t } = I.create('ja');
  assert.ok(textRefs.length >= 10 && htmlRefs.length >= 3 && attrRefs.length >= 4);
  for (const { key, text } of [...textRefs, ...htmlRefs, ...attrRefs]) {
    assert.equal(text.trim(), t(key), `${key} が index.html とずれている`);
  }
});

test('日本語の日付・座標・方角の書き方', () => {
  const ja = I.create('ja');
  assert.equal(ja.formatTime('2026-11-20T21:00'), '11/20(金) 21:00');
  assert.equal(ja.formatTime('2026-11-20T21:00', false), '21:00');
  assert.equal(ja.coordName(35.953, 138.473), '北緯 35.95°, 東経 138.47°');
  assert.equal(ja.coordName(-33.87, -70.66), '南緯 33.87°, 西経 70.66°');
  assert.equal(ja.compass(12), '西');
  assert.equal(ja.t('cloudFlow', '中層', '西', '東', 45), '中層の雲が中心で、西から東へ約45 m/sで流れる見込みです。');
});

test('ない文言を使うとすぐ気づけるよう、エラーにする', () => {
  assert.throws(() => I.create('ja').t('noSuchKey'), /noSuchKey/);
});

test('どの言語も、日本語と同じ文言をそろえている', () => {
  const ja = Object.keys(I.MESSAGES.ja).sort();
  for (const lang of LANGS) assert.deepEqual(Object.keys(I.MESSAGES[lang]).sort(), ja, `${lang} の文言が日本語とそろっていない`);
});

test('画面の言語は URL → 端末で選んだ言語 → ブラウザの言語設定の順で決める', () => {
  assert.equal(I.pickLang({ url: 'en', saved: 'ja', browser: ['ja-JP'] }), 'en');
  assert.equal(I.pickLang({ url: 'fr', saved: 'ja', browser: ['en-US'] }), 'ja', '対応しない URL の lang は無視する');
  assert.equal(I.pickLang({ saved: 'en', browser: ['ja-JP'] }), 'en');
  assert.equal(I.pickLang({ browser: ['ja-JP', 'en-US'] }), 'ja');
  assert.equal(I.pickLang({ browser: ['en-GB', 'ja'] }), 'en', '先に挙がっている言語を使う');
  assert.equal(I.pickLang({ browser: ['fr-FR', 'ja'] }), 'ja', '対応しない言語は飛ばす');
  assert.equal(I.pickLang({ browser: ['fr-FR', 'de'] }), 'en', 'どれも対応しなければ英語');
  assert.equal(I.pickLang(), 'en');
});

test('英語の日付・座標・方角・文の書き方', () => {
  const en = I.create('en');
  assert.equal(en.formatTime('2026-11-20T21:00'), 'Fri, Nov 20 21:00');
  assert.equal(en.formatTime('2026-11-20T21:00', false), '21:00');
  assert.equal(en.shortDate(11, 20), 'Nov 20');
  assert.equal(en.coordName(19.821, -155.468), '19.82°N, 155.47°W');
  assert.equal(en.coordName(-33.87, 151.21), '33.87°S, 151.21°E');
  assert.equal(en.compass(12), 'W');
  assert.equal(en.t('cloudFlow', en.t('layerMid'), 'W', 'E', 45), 'Mostly mid-level clouds, moving from W to E at about 45 m/s.');
  assert.equal(en.t('moonPartial', '02:43', ''), 'No moon from 02:43');
  assert.equal(en.t('moonPartial', '', '04:30'), 'No moon until 04:30');
  assert.equal(en.t('moonPartial', '01:00', '04:30'), 'No moon 01:00 – 04:30');
});
