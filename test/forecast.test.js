const test = require('node:test');
const assert = require('node:assert/strict');
require('../forecast.js');
const F = globalThis.Forecast;

test('格子は北西から南東へ並ぶ', () => {
  const g = F.buildGrid(36, 138, 9, 1);
  assert.equal(g.points.length, 81);
  assert.equal(g.points[0].lat, 37);
  assert.ok(g.points[0].lon < g.points[8].lon);
  assert.equal(g.points[40].lat, 36);
  assert.equal(g.points[80].lat, 35);
  assert.ok(g.points[80].lon > g.points[72].lon);
});

test('既定の格子は7×7で、南北 ±1.2° の範囲を約0.4°間隔で覆う', () => {
  const g = F.buildGrid(36, 138);
  assert.equal(g.size, 7);
  assert.equal(g.points.length, 49);
  assert.equal(g.points[24].lat, 36);
  assert.equal(g.points[0].lat, 37.2);
  assert.ok(Math.abs(g.points[7].lat - 36.8) < 1e-9);
});

test('格子の中心は刻みにそろい、目的地は中心から間隔の半分以内にある', () => {
  for (const [lat, lon] of [[35.953, 138.473], [33.93, 132.74], [43.06, 141.35], [-33.87, 151.21], [64.1, -21.9]]) {
    const g = F.buildGrid(lat, lon);
    const [[south, west], [north, east]] = g.bounds;
    const latStep = (north - south) / 6;
    const lonStep = (east - west) / 6;
    assert.ok(Math.abs((south + north) / 2 - lat) <= latStep / 2 + 1e-9);
    assert.ok(Math.abs((west + east) / 2 - lon) <= lonStep / 2 + 1e-9);
  }
});

test('近くの目的地は同じ格子を使い、離れると別の格子になる', () => {
  const a = F.buildGrid(35.95, 138.47);
  const b = F.buildGrid(35.97, 138.52);
  assert.equal(a.key, b.key);
  assert.deepEqual(a.points, b.points);
  assert.notEqual(F.buildGrid(36.5, 138.47).key, a.key);
});

test('日付変更線の両側の格子は別の格子として扱う', () => {
  assert.notEqual(F.buildGrid(0, 179.9).key, F.buildGrid(0, -179.9).key);
});

test('日付変更線をまたぐ格子は経度が折り返される', () => {
  const g = F.buildGrid(0, 179.5, 3, 1);
  for (const p of g.points) assert.ok(p.lon >= -180 && p.lon <= 180);
  assert.ok(g.points[2].lon < 0);
});

test('時刻の補間は欠測を飛ばす', () => {
  assert.equal(F.valueAt([0, 100], 0.25), 25);
  assert.equal(F.valueAt([null, 100], 0.5), 100);
  assert.equal(F.valueAt([40, null], 0.5), 40);
  assert.equal(F.valueAt([null, null], 0.5), null);
  assert.equal(F.valueAt([1, 2], 5), 2);
});

test('格子の補間は角と中間の値を返し、欠測を除外する', () => {
  const v = [0, 100, 100, 0];
  assert.equal(F.sampleGrid(v, 2, 0, 0), 0);
  assert.equal(F.sampleGrid(v, 2, 1, 0), 100);
  assert.equal(F.sampleGrid(v, 2, 0.5, 0.5), 50);
  assert.equal(F.sampleGrid([null, 80, null, 80], 2, 0.5, 0.5), 80);
  assert.equal(F.sampleGrid([null, null, null, null], 2, 0.5, 0.5), null);
});

test('西風の雲は東へ流れる', () => {
  const f = F.windFlow(270);
  assert.equal(f.from, 12); // 西
  assert.equal(f.to, 4); // 東
  assert.equal(f.arrowDeg, 90);
  assert.equal(F.windFlow(null), null);
  assert.equal(F.compassIndex(359), 0); // 北
});

test('雲の不透明度は、雲量0%で透明、100%でも約78%(200)にとどめ、欠測は透明にする', () => {
  assert.equal(F.cloudAlpha(0), 0);
  assert.equal(F.cloudAlpha(100), 200);
  assert.equal(F.cloudAlpha(50), Math.round(200 * Math.pow(0.5, 0.85)));
  assert.equal(F.cloudAlpha(null), 0);
  assert.equal(F.cloudAlpha(undefined), 0);
  for (let c = 1; c <= 100; c++) assert.ok(F.cloudAlpha(c) >= F.cloudAlpha(c - 1), `${c}%`);
});

test('現地時刻をエポックへ変換する', () => {
  assert.equal(F.localToEpoch('2026-11-07T09:00', 32400), Date.UTC(2026, 10, 7, 0, 0));
});

test('エポックから現地時刻に戻すと、元の文字列になり、分に丸める', () => {
  for (const offset of [32400, 0, -25200, 19800]) {
    for (const s of ['2026-11-07T09:00', '2026-12-31T23:59', '2027-01-01T00:00']) {
      assert.equal(F.epochToLocal(F.localToEpoch(s, offset), offset), s, `${s} ${offset}`);
    }
  }
  const base = F.localToEpoch('2026-11-07T09:00', 32400);
  assert.equal(F.epochToLocal(base + 29999, 32400), '2026-11-07T09:00');
  assert.equal(F.epochToLocal(base + 30000, 32400), '2026-11-07T09:01');
  assert.equal(F.epochToLocal(base - 30001, 32400), '2026-11-07T08:59');
});

test('太陽高度はAPIの日の出・日の入り時刻と整合する', () => {
  // Open-Meteo: 36N 138E 2026-11-07 日の出06:15 日の入り16:47 (JST)
  const at = (s) => F.sunAltitude(F.localToEpoch(s, 32400), 36, 138);
  assert.ok(Math.abs(at('2026-11-07T06:15') + 0.83) < 0.6);
  assert.ok(Math.abs(at('2026-11-07T16:47') + 0.83) < 0.6);
  assert.ok(at('2026-11-07T12:00') > 30);
  assert.ok(at('2026-11-07T23:59') < -18);
});

// 国立天文台 暦計算室「日の出入り@東京」(35.6581N 139.7414E、標高0m)の2026年の値。
const TOKYO = { lat: 35.6581, lon: 139.7414 };
const NAOJ_TOKYO = [
  ['2026-06-01', '04:27', '18:51'],
  ['2026-06-21', '04:25', '19:00'],
  ['2026-11-01', '06:02', '16:46'],
  ['2026-11-13', '06:14', '16:36'],
  ['2026-11-30', '06:31', '16:28'],
];
const jst = (s) => F.localToEpoch(s, 32400);
const sunAt = ({ lat, lon }) => (ms) => F.sunAltitude(ms, lat, lon);

test('日の出・日の入りの時刻は、国立天文台の値と2分以内で一致する', () => {
  for (const [date, rise, set] of NAOJ_TOKYO) {
    const xs = F.findCrossings(sunAt(TOKYO), jst(`${date}T00:00`), jst(`${date}T23:59`), -0.83);
    assert.equal(xs.length, 2, date);
    assert.equal(xs[0].rising, true);
    assert.equal(xs[1].rising, false);
    assert.ok(Math.abs(xs[0].ms - jst(`${date}T${rise}`)) <= 2 * 60000, `${date} 日の出`);
    assert.ok(Math.abs(xs[1].ms - jst(`${date}T${set}`)) <= 2 * 60000, `${date} 日の入り`);
  }
});

test('天文薄明の境目は、太陽高度がちょうど −18° になる時刻になる', () => {
  const f = sunAt(TOKYO);
  const xs = F.findCrossings(f, jst('2026-11-13T12:00'), jst('2026-11-14T12:00'), -18);
  assert.equal(xs.length, 2);
  for (const x of xs) assert.ok(Math.abs(f(x.ms) + 18) < 0.01);
  // 日の入り(16:36)のおよそ1時間半後に暗くなり、日の出のおよそ1時間半前に明るくなりはじめる
  assert.ok(xs[0].ms > jst('2026-11-13T17:45') && xs[0].ms < jst('2026-11-13T18:15'));
  assert.ok(xs[1].ms > jst('2026-11-14T04:30') && xs[1].ms < jst('2026-11-14T05:00'));
});

test('暗い時間帯は範囲の端で切り、白夜では空、極夜では範囲全体になる', () => {
  const from = jst('2026-11-13T12:00');
  const to = jst('2026-11-15T12:00');
  const dark = F.intervalsBelow(sunAt(TOKYO), from, to, -18);
  assert.equal(dark.length, 2);
  assert.ok(dark.every((d) => d.start < d.end && d.end - d.start > 10 * 3600000));

  const midnight = F.intervalsBelow(sunAt(TOKYO), jst('2026-11-14T00:00'), jst('2026-11-14T12:00'), -18);
  assert.equal(midnight[0].start, jst('2026-11-14T00:00'));

  const juneFrom = Date.UTC(2026, 5, 20);
  const juneTo = Date.UTC(2026, 5, 22);
  assert.deepEqual(F.intervalsBelow(sunAt({ lat: 70, lon: 20 }), juneFrom, juneTo, -0.83), []);
  const decFrom = Date.UTC(2026, 11, 20);
  const decTo = Date.UTC(2026, 11, 22);
  assert.deepEqual(F.intervalsBelow(sunAt({ lat: 89, lon: 0 }), decFrom, decTo, -18), [{ start: decFrom, end: decTo }]);
});

// 国立天文台 暦計算室「月の出入り@東京」の2026年11月の値。[日付, 月の出, 月の入り](その日にないものは null)
const NAOJ_TOKYO_MOON = [
  ['2026-11-01', '22:30', '12:15'],
  ['2026-11-03', null, '13:24'],
  ['2026-11-10', '07:04', '16:48'],
  ['2026-11-17', '12:15', '23:10'],
  ['2026-11-18', '12:42', null],
  ['2026-11-24', '15:49', '05:46'],
  ['2026-11-30', '22:39', '11:26'],
];

test('月の出・月の入りの時刻は、国立天文台の値と3分以内で一致する', () => {
  const f = (ms) => F.moonAltitude(ms, TOKYO.lat, TOKYO.lon);
  for (const [date, rise, set] of NAOJ_TOKYO_MOON) {
    const xs = F.findCrossings(f, jst(`${date}T00:00`), jst(`${date}T23:59`), -0.83);
    const risings = xs.filter((x) => x.rising);
    const settings = xs.filter((x) => !x.rising);
    for (const [expected, found, label] of [[rise, risings, '月の出'], [set, settings, '月の入り']]) {
      if (expected == null) { assert.equal(found.length, 0, `${date} ${label}`); continue; }
      assert.equal(found.length, 1, `${date} ${label}`);
      assert.ok(Math.abs(found[0].ms - jst(`${date}T${expected}`)) <= 3 * 60000, `${date} ${label}`);
    }
  }
});

test('月の輝面比は、新月で0に、上弦で半分に、満月で1に近い', () => {
  // 2026年11月: 新月 9日、上弦 17日、満月 24日(国立天文台の月齢 0.8/7.8/14.8 の前後)
  assert.ok(F.moonIllumination(jst('2026-11-09T12:00')) < 0.02);
  assert.ok(Math.abs(F.moonIllumination(jst('2026-11-17T12:00')) - 0.5) < 0.1);
  assert.ok(F.moonIllumination(jst('2026-11-24T12:00')) > 0.97);
});

test('月の条件は、時間帯の中で月が沈んでいる最も長い部分を返す', () => {
  const w = { start: 1000 * 60000, end: 1600 * 60000 };
  const min = (m) => m * 60000;
  assert.deepEqual(F.moonCondition(w, [{ start: min(0), end: min(2000) }]), { kind: 'none' });
  assert.deepEqual(F.moonCondition(w, []), { kind: 'up' });
  assert.deepEqual(F.moonCondition(w, [{ start: min(1600), end: min(2000) }]), { kind: 'up' });
  assert.deepEqual(F.moonCondition(w, [{ start: min(1240), end: min(2000) }]), { kind: 'partial', from: min(1240), to: null });
  assert.deepEqual(F.moonCondition(w, [{ start: min(0), end: min(1135) }]), { kind: 'partial', from: null, to: min(1135) });
  assert.deepEqual(
    F.moonCondition(w, [{ start: min(0), end: min(1050) }, { start: min(1300), end: min(1400) }]),
    { kind: 'partial', from: min(1300), to: min(1400) },
  );
});

// 1時間ごとの時刻と、そのエポックミリ秒(JST)。
const hours = (fromIso, n) => {
  const start = jst(fromIso);
  const epochs = Array.from({ length: n }, (_, i) => start + i * 3600000);
  const times = epochs.map((e) => new Date(e + 32400000).toISOString().slice(0, 16));
  return { times, epochs };
};

// 72時間分の予報の時刻(エポックミリ秒)。
const hourlyEpochs = (startMs) => Array.from({ length: 72 }, (_, k) => startMs + k * 3600000);
// 時間帯が from〜to を隙間なく、重ならずに埋めているか。
const assertCovers = (parts, from, to, label) => {
  const sorted = [...parts].sort((a, b) => a.start - b.start);
  assert.equal(sorted[0].start, from, `${label} の始まり`);
  assert.equal(sorted[sorted.length - 1].end, to, `${label} の終わり`);
  for (let k = 0; k < sorted.length; k++) {
    assert.ok(sorted[k].end > sorted[k].start, `${label} の ${k} 番目が空`);
    if (k > 0) assert.equal(sorted[k].start, sorted[k - 1].end, `${label} の ${k} 番目の前に隙間か重なり`);
  }
};

test('空の時間帯は、予報の期間の前後30分までを、昼・薄明・夜で隙間なく区切る', () => {
  const epochs = hourlyEpochs(jst('2026-11-13T00:00'));
  const from = epochs[0] - 1800000;
  const to = epochs[71] + 1800000;
  const { sky, dark } = F.skyPeriods(epochs, TOKYO.lat, TOKYO.lon);
  assertCovers(sky, from, to, 'sky');
  for (let k = 1; k < sky.length; k++) assert.notEqual(sky[k].kind, sky[k - 1].kind, `${k} 番目が前と同じ`);
  const count = (kind) => sky.filter((x) => x.kind === kind).length;
  assert.deepEqual([count('day'), count('twilight'), count('night')], [3, 6, 4]);
  // 昼の始まりと終わりは、国立天文台の日の出(06:14)・日の入り(16:36)と2分以内で一致する
  const day = sky.find((x) => x.kind === 'day');
  assert.ok(Math.abs(day.start - jst('2026-11-13T06:14')) <= 2 * 60000);
  assert.ok(Math.abs(day.end - jst('2026-11-13T16:36')) <= 2 * 60000);
  // 暗い時間は、太陽高度が −18° より下の時間で、夜の区切りと一致する
  assert.deepEqual(dark, F.intervalsBelow(sunAt(TOKYO), from, to, -18));
  assert.deepEqual(dark, sky.filter((x) => x.kind === 'night').map(({ start, end }) => ({ start, end })));
});

test('月が出ている時間と沈んでいる時間は、予報の期間を隙間なく埋める', () => {
  const epochs = hourlyEpochs(jst('2026-11-13T00:00'));
  const { moonDown, moonUp } = F.skyPeriods(epochs, TOKYO.lat, TOKYO.lon);
  assert.ok(moonDown.length > 0 && moonUp.length > 0);
  assertCovers([...moonDown, ...moonUp], epochs[0] - 1800000, epochs[71] + 1800000, 'moon');
  for (const u of moonUp) assert.ok(F.moonAltitude((u.start + u.end) / 2, TOKYO.lat, TOKYO.lon) > -0.83);
});

test('白夜では昼だけ、極夜では昼がなく、どちらも期間全体を区切る', () => {
  const june = hourlyEpochs(Date.UTC(2026, 5, 20));
  const white = F.skyPeriods(june, 70, 20);
  assert.deepEqual(white.sky.map((x) => x.kind), ['day']);
  assert.deepEqual(white.dark, []);
  assertCovers(white.sky, june[0] - 1800000, june[71] + 1800000, 'white');

  const dec = hourlyEpochs(Date.UTC(2026, 11, 20));
  const polar = F.skyPeriods(dec, 78, 15);
  assert.ok(polar.sky.every((x) => x.kind !== 'day'));
  assert.ok(polar.sky.some((x) => x.kind === 'twilight') && polar.sky.some((x) => x.kind === 'night'));
  assertCovers(polar.sky, dec[0] - 1800000, dec[71] + 1800000, 'polar');
  assertCovers([...polar.moonDown, ...polar.moonUp], dec[0] - 1800000, dec[71] + 1800000, 'polar moon');
});

test('観測のねらい目は、天文薄明の時刻で分単位に区切る', () => {
  const { times, epochs } = hours('2026-11-13T17:00', 13); // 17:00〜翌5:00
  const dark = [{ start: jst('2026-11-13T18:47'), end: jst('2026-11-14T04:20') }];
  const w = F.findObservingWindows({ times, epochs, clouds: Array(13).fill(10), dark });
  assert.equal(w.length, 1);
  assert.equal(w[0].night, '2026-11-13');
  assert.equal(w[0].start, jst('2026-11-13T18:47'));
  assert.equal(w[0].end, jst('2026-11-14T04:20'));
  assert.equal(w[0].avgCloud, 10);
});

test('観測のねらい目は、雲の多い時刻の前後30分で区切り、夜ごとに最長の晴れ間を選ぶ', () => {
  const { times, epochs } = hours('2026-11-13T19:00', 30); // 19:00〜翌々0:00
  const clouds = Array(30).fill(10);
  clouds[2] = 90; // 21:00 は曇り
  clouds[6] = null; // 1:00 は欠測
  const dark = [
    { start: jst('2026-11-13T18:47'), end: jst('2026-11-14T04:20') },
    { start: jst('2026-11-14T18:48'), end: jst('2026-11-15T04:21') },
  ];
  const w = F.findObservingWindows({ times, epochs, clouds, dark });
  assert.equal(w.length, 2);
  // 21:30〜0:30 と 1:30〜4:20 のうち、長い方を選ぶ
  assert.equal(w[0].start, jst('2026-11-13T21:30'));
  assert.equal(w[0].end, jst('2026-11-14T00:30'));
  assert.equal(w[0].hours, 3);
  assert.equal(w[1].night, '2026-11-14');
  assert.equal(w[1].start, jst('2026-11-14T18:48'));
  assert.equal(w[1].end, jst('2026-11-15T00:30')); // 予報の最後の時刻(0:00)の30分後まで
});

test('観測のねらい目は、昼と雲の多い時間帯を除き、開始の時刻より前を含めない', () => {
  const { times, epochs } = hours('2026-11-13T20:00', 3);
  const dark = [{ start: jst('2026-11-13T18:00'), end: jst('2026-11-13T21:40') }];
  assert.deepEqual(F.findObservingWindows({ times, epochs, clouds: [null, 50, 0], dark }), []);
  const w = F.findObservingWindows({ times, epochs, clouds: [0, 0, 0], dark, fromMs: jst('2026-11-13T21:00') });
  assert.equal(w[0].start, jst('2026-11-13T21:00'));
  assert.equal(w[0].end, jst('2026-11-13T21:40'));
  assert.deepEqual(F.findObservingWindows({ times, epochs, clouds: [0, 0, 0], dark: [] }), []);
});

test('現在の時刻の番号は、時刻の進みに合わせて増え、予報の範囲に収まる', () => {
  const start = Date.UTC(2026, 10, 12, 0, 0);
  const epochs = [0, 1, 2, 3].map((h) => start + h * 3600000);
  assert.equal(F.currentIndex(epochs, start - 1), 0);
  assert.equal(F.currentIndex(epochs, start + 59 * 60000), 0);
  assert.equal(F.currentIndex(epochs, start + 61 * 60000), 1);
  assert.equal(F.currentIndex(epochs, start + 10 * 3600000), 3);
  assert.equal(F.currentIndex([], start), 0);
});

test('取り直した予報でも、見ていた時刻を同じ日時の番号に移す', () => {
  const oldTimes = ['2026-11-12T22:00', '2026-11-12T23:00', '2026-11-13T00:00', '2026-11-13T01:00'];
  const newTimes = ['2026-11-13T00:00', '2026-11-13T01:00', '2026-11-13T02:00'];
  assert.equal(F.reindexTime(oldTimes, newTimes, 3), 1);
  assert.equal(F.reindexTime(oldTimes, newTimes, 2.25), 0.25);
  assert.equal(F.reindexTime(oldTimes, newTimes, 0), null);
});
