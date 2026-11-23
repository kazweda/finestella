// 「3日間の雲」のタイムラインの描画(#74)。
// 上から、日付、空の暗さ(昼・薄明・夜)、月が出ている時間、層ごとの雲量のヒートマップ、選択中の時刻の線。
// ブラウザでは globalThis.Timeline として使う。
(function (root) {
  'use strict';

  // 左端の層の名前の幅。タップした位置から時刻を求めるときにも使う。
  const LABEL_W = 34;
  const SKY_COLORS = { day: '#d9b36a', twilight: '#4a5f86', night: '#10151f' };
  const LABEL_COLOR = '#9aa8b8';
  const NOW_COLOR = '#ffc27a';
  const MOON_COLOR = 'rgb(232 228 200)'; // the same as .swatch.moon in style.css

  // canvas: 描く先。hourly: 目的地の1時間ごとの予報。epochs: 各時刻のエポックミリ秒。
  // sky: 空の暗さの区間。moonUp: 月が出ている区間。t: 選択中の時刻(時間の番号、小数あり)。
  // rows: 層の { label, key }。shortDate: (月, 日) → 日付の文字。
  function draw(canvas, { hourly, epochs, sky, moonUp, t, rows, shortDate, dpr = 1 }) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const n = hourly.time.length;
    const cellW = (W - LABEL_W) / n;
    const dateH = 18;
    const darkH = 8;
    const moonH = 5;
    const bandsH = darkH + 2 + moonH + 6;
    const rowH = (H - dateH - bandsH) / rows.length;
    const xOf = (i) => LABEL_W + i * cellW;

    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // 日付の区切り
    ctx.fillStyle = LABEL_COLOR;
    hourly.time.forEach((iso, i) => {
      if (iso.endsWith('T00:00')) {
        const [, m, d] = iso.split('T')[0].split('-').map(Number);
        ctx.fillText(shortDate(m, d), xOf(i) + 2, dateH / 2);
      }
    });

    // 空の暗さ(昼・薄明・夜)。各列は毎時0分を中心とした1時間で、境目は分単位の位置に描く。
    const xAt = (ms) => xOf((ms - epochs[0]) / 3600000 + 0.5);
    for (const s of sky) {
      ctx.fillStyle = SKY_COLORS[s.kind];
      const x0 = xAt(s.start);
      ctx.fillRect(x0, dateH, xAt(s.end) - x0, darkH);
    }

    // When the Moon is up, in one color (#52). A thin moon used to be drawn dark and was lost against
    // the night; its phase is now shown by the emoji next to the heading instead.
    const moonY = dateH + darkH + 2;
    ctx.fillStyle = MOON_COLOR;
    for (const u of moonUp) {
      const x0 = xAt(u.start);
      ctx.fillRect(x0, moonY, xAt(u.end) - x0, moonH);
    }

    // 雲量のヒートマップ
    rows.forEach((row, r) => {
      const y = dateH + bandsH + r * rowH;
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(row.label, 0, y + rowH / 2);
      for (let i = 0; i < n; i++) {
        const v = hourly[row.key][i];
        if (v == null) {
          ctx.fillStyle = '#000';
        } else {
          const shade = Math.round(42 + (255 - 42) * (v / 100));
          ctx.fillStyle = `rgb(${shade} ${Math.min(255, shade + 8)} ${Math.min(255, shade + 20)})`;
        }
        ctx.fillRect(xOf(i), y, Math.ceil(cellW), rowH - 2);
      }
    });

    // 選択中の時刻
    ctx.fillStyle = NOW_COLOR;
    ctx.fillRect(xOf(t + 0.5) - 1, dateH, 2, H - dateH);
  }

  // タップした横の位置(要素の左端からの px)を、時刻の番号(0〜n-1)にする。
  function indexAt(x, width, n) {
    const i = Math.floor(((x - LABEL_W) / (width - LABEL_W)) * n);
    return Math.max(0, Math.min(n - 1, i));
  }

  root.Timeline = { LABEL_W, draw, indexAt };
})(globalThis);
