// 画面の文言と、日付・方角・座標の書き方(#63)。言語ごとの違いはこのファイルに集める。
// 値は文字列か、引数から文字列を作る関数。HTML を含むもの(リンクや色見本)は名前を …Html にする。
// ブラウザでは globalThis.I18n として使う。
(function (root) {
  'use strict';

  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const CC_BY = link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0');
  const OPEN_METEO = link('https://open-meteo.com/', 'Open-Meteo.com');

  const MESSAGES = {
    ja: {
      // --- index.html の固定の文言(data-i18n で差し込む) ---
      mapLabel: '目的地を選ぶ地図',
      searchPlaceholder: '地名で検索(例: 野辺山)',
      searchLabel: '地名で検索',
      searchButton: '検索',
      legendMin: '雲量 0%',
      choosePlace: '目的地を選択',
      openGoogleMaps: 'Google マップで開く',
      copyCoords: '緯度・経度をコピー',
      retry: '再読み込み',
      totalCloud: '全雲量',
      windowsHeading: '観測のねらい目',
      windowsNote: '天文薄明の外(太陽高度 −18° 未満)で、全雲量30%以下が続く時間帯です。「月なし」は月が地平線の下にある時間です。',
      timelineHeading: '3日間の雲',
      now: '現在',
      sliderLabel: '表示する時刻',
      timelineNoteHtml: '上の帯は空の暗さ(<span class="swatch day"></span>昼 <span class="swatch twilight"></span>薄明 <span class="swatch night"></span>夜)、その下の細い帯は月が出ている時間です(<span class="swatch moon"></span>明るいほど満月に近い)。雲の動きは1時間ごとの予報を補間した表示です。実際の雲の形とは異なることがあります。',
      creditWeatherHtml: `Weather data by ${OPEN_METEO}(${CC_BY})。雲の分布と動きは1時間ごとの予報を補間して表示しています。`,
      creditSearchHtml: `地名検索:${link('https://maps.gsi.go.jp/', '国土地理院')}。海外の地名は Location data based on ${link('https://www.geonames.org/', 'GeoNames')}(${CC_BY})`,
      creditMapHtml: `背景地図:${link('https://maps.gsi.go.jp/development/ichiran.html', '地理院タイル')}(淡色地図)の色を反転するなど加工して作成。日本周辺以外の海岸線:Shoreline data is derived from: United States. National Imagery and Mapping Agency.`,
      changelog: '更新履歴',

      // --- 地図 ---
      defaultPlace: '野辺山',
      gsiAttributionHtml: `${link('https://maps.gsi.go.jp/development/ichiran.html', '地理院タイル')}を加工して作成`,
      cloudAttributionHtml: `雲量 ${OPEN_METEO}(${CC_BY})`,
      layerLow: '下層',
      layerMid: '中層',
      layerHigh: '上層',
      layerAll: '全体',

      // --- 予報の取得 ---
      loading: '雲の予報を読み込んでいます…',
      offline: 'インターネットに接続されていません。接続を確認してください。',
      forecastUnreachable: '予報データを取得できませんでした。配信元(Open-Meteo)に接続できない状態です。',
      tryLater: '時間をおいてお試しください。',
      waitAndRetry: '少し待ってから再読み込みしてください。',
      searchUnreachable: '地名を検索できませんでした。時間をおいてお試しください。',
      unexpected: '表示中に問題が起きました。ページを再読み込みしてください。',
      tooManyRequests: 'リクエストが多すぎます。少し待ってからお試しください。',
      httpError: (status) => `データを取得できませんでした(HTTP ${status})。時間をおいてお試しください。`,
      badData: 'データの形式が想定と異なります。',
      badGridData: '周辺の雲データの形式が想定と異なります。',
      fetchedAt: (when) => `${when} 取得`,
      fetchedStale: (when, reason) => `${when} 取得の予報です。${{ offline: 'オフラインのため', unreachable: '配信元に接続できず、' }[reason] ?? ''}更新できませんでした。`,

      // --- 読み取り ---
      noNotableCloud: '目的地の上空に目立つ雲はありません。',
      cloudFlow: (layer, from, to, speed) => `${layer}の雲が中心で、${from}から${to}へ約${speed} m/sで流れる見込みです。`,
      cloudDominant: (layer) => `${layer}の雲が中心です。`,

      // --- 観測のねらい目 ---
      noWindows: '予報の期間内に条件を満たす時間帯はありません。',
      timeRange: (from, to) => `${from}〜${to}`,
      avgCloud: (pct) => `平均雲量 ${pct}%`,
      moonNone: '月なし',
      moonUp: (pct) => `月あり(輝面比 ${pct}%)`,
      moonPartial: (from, to) => `月なし ${from}〜${to}`,

      // --- 操作 ---
      play: '▶ 再生',
      stop: '■ 停止',
      searching: '検索しています…',
      notFound: '見つかりませんでした。別の表記で検索するか、地図をタップしてください。',
      listSeparator: '、',
      copied: 'コピーしました',
      copyFailed: 'コピーできませんでした',
      setHome: '初期位置にする',
      unsetHome: '初期位置を解除',
      saveFailed: '保存できませんでした',

      // --- 書き方 ---
      compass: ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
        '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'],
      weekdays: '日月火水木金土',
      // date: 'YYYY-MM-DD'、clock: 'HH:MM'(目的地の現地時刻)
      dateTime: (m, d, weekday, clock) => `${m}/${d}(${weekday}) ${clock}`,
      shortDate: (m, d) => `${m}/${d}`,
      coordName: (lat, lon) => `${lat < 0 ? '南緯' : '北緯'} ${Math.abs(lat).toFixed(2)}°, ${lon < 0 ? '西経' : '東経'} ${Math.abs(lon).toFixed(2)}°`,
    },
  };

  function create(lang) {
    const m = MESSAGES[lang] || MESSAGES.ja;
    const t = (key, ...args) => {
      const v = m[key];
      if (v === undefined) throw new Error(`文言がない: ${key}`);
      return typeof v === 'function' ? v(...args) : v;
    };
    return {
      lang,
      t,
      // 方角の番号(0=北、時計回りに16方位)を名前にする。
      compass: (index) => m.compass[index],
      // 'YYYY-MM-DDTHH:MM' を「11/20(金) 21:00」のようにする。withDate が false なら時刻だけ。
      formatTime(iso, withDate = true) {
        const [date, clock] = iso.split('T');
        if (!withDate) return clock;
        const [, mo, d] = date.split('-').map(Number);
        const weekday = m.weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
        return m.dateTime(mo, d, weekday, clock);
      },
      shortDate: (mo, d) => m.shortDate(mo, d),
      coordName: (lat, lon) => m.coordName(lat, lon),
    };
  }

  // index.html の data-i18n(文字)・data-i18n-html(HTML)・data-i18n-attr(属性名:キー;…)に文言を差し込む。
  function applyStatic(doc, { t }) {
    for (const node of doc.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const node of doc.querySelectorAll('[data-i18n-html]')) node.innerHTML = t(node.dataset.i18nHtml);
    for (const node of doc.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of node.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map((s) => s.trim());
        node.setAttribute(attr, t(key));
      }
    }
  }

  root.I18n = { MESSAGES, create, applyStatic };
})(globalThis);
