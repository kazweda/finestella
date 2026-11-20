// 新しい版が出ていれば読み込み直す(#59、#74)。
// ホーム画面のアプリは裏で一時停止しているだけのことがあり、手前に戻っても古い JS のまま動き続ける。
// しばらく裏にあったときだけ、サーバーの index.html の版(?v= のコミットの ID)を今の版と比べる。
// ブラウザでは globalThis.Update として使う。
(function (root) {
  'use strict';

  const CHECK_AFTER_MS = 5 * 60 * 1000;
  // 配信で ?v=__BUILD__ がコミットの ID に置き換わる(pages.yml)。手元で開いたときは __BUILD__ のまま。
  const UNBUILT = '__BUILD__';
  const BUILD_ID = /app\.js\?v=([^"'&]+)/;

  // HTML(または app.js の URL)から版の ID を取り出す。配信されていない版や見つからないときは null。
  function parseBuild(text) {
    const id = (String(text || '').match(BUILD_ID) || [])[1];
    return id && id !== UNBUILT ? id : null;
  }

  // 今動いている版の ID。読み込んだ app.js の URL から読む。
  const currentBuild = (doc) => parseBuild(doc.querySelector('script[src*="app.js?v="]')?.getAttribute('src'));

  // 読み込み直すときは true を返す。オフラインなどで確かめられなければ、今の版のまま使い続ける。
  async function reloadIfUpdated({ current, fetch, url, reload, logError = () => {} }) {
    if (!current) return false;
    try {
      // GitHub Pages は index.html を10分キャッシュするので、ブラウザのキャッシュは使わない。
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return false;
      const latest = parseBuild(await res.text());
      if (!latest || latest === current) return false;
      reload();
      return true;
    } catch (err) {
      logError(err);
      return false;
    }
  }

  root.Update = { CHECK_AFTER_MS, parseBuild, currentBuild, reloadIfUpdated };
})(globalThis);
