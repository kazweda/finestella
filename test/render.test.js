const test = require('node:test');
const assert = require('node:assert/strict');
require('../forecast.js');
require('../i18n.js');
require('../render.js');
const { Render, Forecast, I18n } = globalThis;

// 画面に触らない文字作り(#118)。描画そのものは tools/compare で確かめる。
const ja = I18n.create('ja');
const en = I18n.create('en');

test('時刻の文字は、分だけ0で埋める', () => {
  assert.equal(Render.clockText(new Date(2026, 10, 20, 9, 5)), '9:05');
  assert.equal(Render.clockText(new Date(2026, 10, 20, 21, 30)), '21:30');
  assert.equal(Render.clockText(new Date(2026, 10, 20, 0, 0)), '0:00');
});

test('「◯:◯ 取得」は、今日なら時刻だけ、別の日なら日付を付ける', () => {
  const fetchedAt = new Date(2026, 10, 20, 21, 5).getTime();
  const text = (now, refreshFailed = false, i18n = ja) => Render.fetchedText({
    fetchedAt, refreshFailed, now, t: i18n.t, shortDate: i18n.shortDate,
  });
  assert.equal(text(new Date(2026, 10, 20, 23, 59)), ja.t('fetchedAt', '21:05'));
  assert.equal(text(new Date(2026, 10, 21, 0, 1)), ja.t('fetchedAt', `${ja.shortDate(11, 20)} 21:05`));
  assert.equal(text(new Date(2026, 10, 20, 22, 0), false, en), en.t('fetchedAt', '21:05'));
});

test('取り直しに失敗したときは、その理由と古い予報であることを示す', () => {
  const fetchedAt = new Date(2026, 10, 20, 21, 5).getTime();
  for (const reason of ['offline', 'unreachable', 'error']) {
    const text = Render.fetchedText({ fetchedAt, refreshFailed: reason, now: new Date(2026, 10, 20, 22, 0), t: ja.t, shortDate: ja.shortDate });
    assert.equal(text, ja.t('fetchedStale', '21:05', reason));
  }
  assert.notEqual(ja.t('fetchedStale', '21:05', 'offline'), ja.t('fetchedStale', '21:05', 'unreachable'));
});

test('観測のねらい目の月の文言(ない/出ている/一部だけ沈んでいる)', () => {
  const OFFSET = 9 * 3600; // JST
  const at = (iso) => Forecast.localToEpoch(iso, OFFSET);
  const w = { start: at('2026-11-20T22:00'), end: at('2026-11-21T04:00') };
  const text = (moonDown, i18n = ja) => Render.moonText(w, { moonDown, utcOffsetSeconds: OFFSET, t: i18n.t, formatTime: i18n.formatTime });

  assert.equal(text([{ start: at('2026-11-20T18:00'), end: at('2026-11-21T06:00') }]), ja.t('moonNone'));
  const illum = Math.round(Forecast.moonIllumination((w.start + w.end) / 2) * 100);
  assert.equal(text([]), ja.t('moonUp', illum));
  // 途中で沈む・途中で出る・間だけ沈む。時刻は目的地の現地時刻で出す。
  assert.equal(text([{ start: at('2026-11-21T02:30'), end: at('2026-11-21T10:00') }]), ja.t('moonPartial', '02:30', ''));
  assert.equal(text([{ start: at('2026-11-20T12:00'), end: at('2026-11-21T01:15') }]), ja.t('moonPartial', '', '01:15'));
  assert.equal(text([{ start: at('2026-11-21T00:00'), end: at('2026-11-21T02:00') }], en), 'No moon 00:00 – 02:00');
});
