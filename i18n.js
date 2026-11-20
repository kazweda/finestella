// 画面の文言と、日付・方角・座標の書き方(#63)。言語ごとの違いはこのファイルに集める。
// 値は文字列か、引数から文字列を作る関数。HTML を含むもの(リンクや色見本)は名前を …Html にする。
// ブラウザでは globalThis.I18n として使う。
(function (root) {
  'use strict';

  // 英語の文では、層の名前(Low など)を「low clouds」「mid-level clouds」の形にする。
  const LAYER_ADJ = { Low: 'low', Mid: 'mid-level', High: 'high' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const CC_BY = link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0');
  const OPEN_METEO = link('https://open-meteo.com/', 'Open-Meteo.com');
  const OFM_CREDIT = `${link('https://openfreemap.org', 'OpenFreeMap')} © ${link('https://www.openmaptiles.org/', 'OpenMapTiles')} Data from ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap')}`;

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
      creditMapGsiHtml: `背景地図:${link('https://maps.gsi.go.jp/development/ichiran.html', '地理院タイル')}(淡色地図)の色を反転するなど加工して作成。日本周辺以外の海岸線:Shoreline data is derived from: United States. National Imagery and Mapping Agency.`,
      creditMapOfmHtml: `背景地図:${OFM_CREDIT}`,
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
    en: {
      mapLabel: 'Map for choosing a destination',
      searchPlaceholder: 'Search (e.g. Mauna Kea)',
      searchLabel: 'Search places',
      searchButton: 'Search',
      legendMin: 'Cloud 0%',
      choosePlace: 'Choose a destination',
      openGoogleMaps: 'Open in Google Maps',
      copyCoords: 'Copy coordinates',
      retry: 'Reload',
      totalCloud: 'Total cloud',
      windowsHeading: 'Best observing windows',
      windowsNote: 'Times outside astronomical twilight (sun below −18°) when total cloud cover stays at 30% or less. “No moon” means the Moon is below the horizon.',
      timelineHeading: 'Clouds over 3 days',
      now: 'Now',
      sliderLabel: 'Time to show',
      timelineNoteHtml: 'The top band shows how dark the sky is (<span class="swatch day"></span>day <span class="swatch twilight"></span>twilight <span class="swatch night"></span>night), and the thin band below it shows when the Moon is up (<span class="swatch moon"></span>brighter means closer to full). Cloud motion is interpolated from hourly forecasts and may differ from the actual shape of the clouds.',
      creditWeatherHtml: `Weather data by ${OPEN_METEO} (${CC_BY}). Cloud cover and motion are interpolated from hourly forecasts.`,
      creditSearchHtml: `Place search: Location data based on ${link('https://www.geonames.org/', 'GeoNames')} (${CC_BY}). Japanese place names: ${link('https://maps.gsi.go.jp/', 'GSI Japan')}.`,
      creditMapGsiHtml: `Base map: modified from ${link('https://maps.gsi.go.jp/development/ichiran.html', 'GSI Tiles')} (pale map, colors inverted). Shorelines outside Japan: Shoreline data is derived from: United States. National Imagery and Mapping Agency.`,
      creditMapOfmHtml: `Base map: ${OFM_CREDIT}`,
      changelog: 'Changelog',

      defaultPlace: 'Nobeyama',
      gsiAttributionHtml: `Modified from ${link('https://maps.gsi.go.jp/development/ichiran.html', 'GSI Tiles')}`,
      cloudAttributionHtml: `Clouds ${OPEN_METEO} (${CC_BY})`,
      layerLow: 'Low',
      layerMid: 'Mid',
      layerHigh: 'High',
      layerAll: 'Total',

      loading: 'Loading the cloud forecast…',
      offline: 'You are offline. Check your internet connection.',
      forecastUnreachable: 'Could not get the forecast. The data provider (Open-Meteo) cannot be reached right now. ',
      tryLater: 'Please try again later.',
      waitAndRetry: 'Please wait a moment and reload.',
      searchUnreachable: 'Could not search places. Please try again later.',
      unexpected: 'Something went wrong. Please reload the page.',
      tooManyRequests: 'Too many requests. Please wait a moment and try again.',
      httpError: (status) => `Could not get the data (HTTP ${status}). Please try again later.`,
      badData: 'The data was not in the expected format.',
      badGridData: 'The surrounding cloud data was not in the expected format.',
      fetchedAt: (when) => `Updated ${when}`,
      fetchedStale: (when, reason) => `Forecast from ${when}. ${{ offline: 'Could not update because you are offline.', unreachable: 'Could not update because the data provider cannot be reached.' }[reason] ?? 'Could not update.'}`,

      noNotableCloud: 'No significant clouds over the destination.',
      cloudFlow: (layer, from, to, speed) => `Mostly ${LAYER_ADJ[layer]} clouds, moving from ${from} to ${to} at about ${speed} m/s.`,
      cloudDominant: (layer) => `Mostly ${LAYER_ADJ[layer]} clouds.`,

      noWindows: 'No times meet the conditions within the forecast period.',
      timeRange: (from, to) => `${from} – ${to}`,
      avgCloud: (pct) => `avg. cloud ${pct}%`,
      moonNone: 'No moon',
      moonUp: (pct) => `Moon up (${pct}% illuminated)`,
      moonPartial: (from, to) => (from && to ? `No moon ${from} – ${to}` : from ? `No moon from ${from}` : `No moon until ${to}`),

      play: '▶ Play',
      stop: '■ Stop',
      searching: 'Searching…',
      notFound: 'No places found. Try another spelling, or tap the map.',
      listSeparator: ', ',
      copied: 'Copied',
      copyFailed: 'Could not copy',
      setHome: 'Set as home',
      unsetHome: 'Remove home',
      saveFailed: 'Could not save',

      compass: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
      weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      dateTime: (m, d, weekday, clock) => `${weekday}, ${MONTHS[m - 1]} ${d} ${clock}`,
      shortDate: (m, d) => `${MONTHS[m - 1]} ${d}`,
      coordName: (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`,
    },
  };

  const LANGS = Object.keys(MESSAGES);

  // 画面の言語を決める。URL の lang → その端末で選んだ言語 → ブラウザの言語設定の順(#63)。
  // ブラウザの言語設定は、対応する言語のうち最初に挙がっているものを使い、なければ英語にする。
  function pickLang({ url, saved, browser = [] } = {}) {
    if (LANGS.includes(url)) return url;
    if (LANGS.includes(saved)) return saved;
    for (const tag of browser) {
      const base = String(tag).toLowerCase().split('-')[0];
      if (LANGS.includes(base)) return base;
    }
    return 'en';
  }

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

  root.I18n = { MESSAGES, LANGS, pickLang, create, applyStatic };
})(globalThis);
