# 版の比較(#120)

作業中の版と main の版で同じ場面を再生し、画面に出るものが同じかを確かめるスクリプト。
見た目と動きを変えない整理(#119 など)で、移し忘れや受け渡しの漏れを見つけるために使う。

```sh
node tools/compare/compare.js                 # main と比べる
node tools/compare/compare.js <ref>           # ほかのブランチやコミットと比べる
node tools/compare/compare.js --only 検索語    # 名前にその語を含む場面だけ
node tools/compare/compare.js --dump <dir>    # 記録を <dir>/base.json と head.json にも書き出す
```

全場面が同じなら終了コード 0、違う場面があれば 1(場面の名前と、最初に違う箇所を出す)。全場面で約40秒かかる。

## 要るもの

- Node(`.node-version` の版)。npm のパッケージは使わない
- Chrome。見つからないときは `CHROME_PATH` に実行ファイルを指定する
- 初回だけ unpkg から Leaflet を読む(実行中は覚えておく)

## しくみ

- 比べる版は `git worktree` で一時的なディレクトリに取り出し(終わったら消す)、作業中の版はリポジトリをそのまま配る。どちらも `127.0.0.1` の小さなサーバーで配る
- 場面ごとに新しいブラウザの状態(保存した初期位置なし)で開く
- 予報と地名検索は `fixtures.js` の決まった応答を返す。API は使わない。地図のタイル、MapLibre GL(ヘッドレスでは WebGL が使えない)、アクセス解析は読まない
- 時計は 2026-11-20 12:00(日本時間)で止め、場面が進めたぶんだけタイマーが発火する(`page.js`)。地図のアニメーションは切る
- 記録するのは、パネルと検索欄の HTML、地図の HTML(雲の画像は画素のハッシュ)、URL、スライダーの値、タイムラインの画素のハッシュ、残っているタイマー、保存した値、予報と検索の取得、コンソールのエラー(1行目だけ。行番号はコードを移すと変わるため)

## 場面を足す

`scenes.js` に `{ name, run(s) }` を足す。`s` でできること(`compare.js` の `runScene()`):

| | |
|---|---|
| `open(query)` | `?…` や `#…` を付けて開き、最初の地点を読み込み終えるまで待つ |
| `advance(ms)` | 時計を進める |
| `click(selector)` / `clickMap(fx, fy)` | ボタンを押す / 地図の位置(幅と高さの割合)をタップする |
| `clickAndReload(selector)` | 押すとページを開き直すもの(フッターの言語の切り替え)を押し、`open()` と同じく読み込み終えるまで待つ |
| `slider(value)` / `timelineDown(fx)` / `timelineMove(fx, pressed)` / `timelineUp(fx)` | 時刻の操作 |
| `search(text)` / `setHash(hash)` / `resize(width)` | 検索、URL の `#` の書き換え、窓の幅 |
| `hide()` / `show()` / `offline()` / `online()` | 裏に回る・戻る、回線が切れる・戻る |
| `forecast('ok' \| 'fail' \| 'error')` | 予報の配信元が答える / つながらない / 500 を返す |
| `hold(test)` / `release()` | 地名検索の応答を止めておき、あとで返す |
| `snap(label)` | ここで記録する |

`node --test` には入れていない(Chrome が要るため)。サイトにも配信しない(`pages.yml` でコピーしない)。
