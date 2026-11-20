# リリース手順

FineStella の配信と、版の番号の付け方をまとめます。

## 配信のしくみ

`main` にマージすると、GitHub Actions([.github/workflows/pages.yml](../.github/workflows/pages.yml))が次の順に動き、数分で https://finestella.com/ に反映されます。

1. テストを実行する。失敗したら配信しない
2. 配信するファイル(`index.html`、JS と CSS、`favicon.ico`、`manifest.webmanifest`、`assets/`)をそろえる。ファイルを増やしたときは、pages.yml のコピーの対象にも足す(漏れているとテストが失敗する)
3. `index.html` の `?v=__BUILD__` を、コミットの ID(例:`?v=f2962e5`)に置き換える
4. GitHub Pages に配信する

**版の番号を上げなくても、マージするたびに配信されます。** 版の番号は、機能がまとまったときに、下の「リリースの手順」で上げます。

### キャッシュ対策のしくみ

GitHub Pages は各ファイルを10分間キャッシュさせます。そのため、配信の直後は、古い `index.html` と新しい `app.js` のように、違う時点のファイルが組み合わさることがあります。読み込む URL にコミットの ID を付けておくと、次のようになります。

- 新しい `index.html` を読んだ人は、新しい ID の URL を参照するので、新しい JS と CSS をそろって読み込む
- 古い `index.html` が残っている人は、古い ID の URL を参照するので、古い時点のまま一貫して動く(10分以内に新しいものに切り替わる)

ID は配信のたびに自動で変わるので、手で更新する必要はありません。手元で `index.html` を開いたときは `?v=__BUILD__` のまま読み込みますが、動作に影響はありません。

ホーム画面に登録したアプリは、裏で一時停止しているだけのことがあり、手前に戻ってもページを読み込み直しません。そのためアプリは、5分以上裏にあってから手前に戻ったときに、サーバーの `index.html` の ID を今動いている版の ID と比べます。違っていれば自動で読み込み直します(`app.js` の `reloadIfUpdated`、#59)。ID は `app.js?v=` の値から読むので、`app.js` の読み込みの書き方を変えるときは、ここも合わせて直してください。GitHub Pages のキャッシュがあるため、配信から最大10分ほどは古い ID が返り、読み込み直しはその後になります。

`index.html` で JS や CSS を読み込むときは、必ず `?v=__BUILD__` を付けてください。付け忘れるとテスト([test/version.test.js](../test/version.test.js))が失敗します。

## 版の番号の付け方

[セマンティック バージョニング](https://semver.org/lang/ja/)(`MAJOR.MINOR.PATCH`)に従います。試作段階なので `0.x` で運用します。

| 上げる番号 | どんなとき | 例 |
|---|---|---|
| `MINOR`(0.**1**.0 → 0.**2**.0) | 機能の追加、見た目の大きな変更 | 予報を7日間にする |
| `PATCH`(0.1.**0** → 0.1.**1**) | 不具合の修正、文言の修正 | 表示の崩れを直す |

番号の正本は [CHANGELOG.md](../CHANGELOG.md) の最新の版です。ほかに書くのは、[index.html](../index.html) のフッターの `FineStella v…` の1か所だけです。食い違うとテストが失敗します。

## 日々の変更

PR を作るときは、利用者に関わる変更を [CHANGELOG.md](../CHANGELOG.md) の `## [Unreleased]` に書き足します。

- 「追加」「変更」「修正」「削除」の小見出しに分ける
- 利用者が読んでわかる言葉で書く(コードの細部は書かない)
- README やテストだけの変更など、利用者に関わらない変更は書かない

マージした変更はすぐ公開サイトに出ますが、版の番号は次のリリースまで変わりません。

## リリースの手順

`[Unreleased]` にたまった変更がまとまったら、新しい版にします。

1. **リリース用のブランチを作る**
   ```sh
   git checkout main && git pull
   git checkout -b release/v0.x.y
   ```
2. **CHANGELOG を更新する**
   - `## [Unreleased]` の下の内容を、新しい見出し `## [0.x.y] - YYYY-MM-DD` の下に移す
   - `## [Unreleased]` は空のまま残す
   - 末尾のリンクを更新する
     ```
     [Unreleased]: https://github.com/kazweda/finestella/compare/v0.x.y...HEAD
     [0.x.y]: https://github.com/kazweda/finestella/releases/tag/v0.x.y
     ```
3. **フッターの番号を変える**:`index.html` の `FineStella v旧番号` を `FineStella v0.x.y` にする
4. **テストを実行する**
   ```sh
   node --test
   ```
5. **PR を作ってマージする**:タイトルは「v0.x.y をリリースする」にする
6. **タグを付ける**:マージしたコミットにタグを付けて push する
   ```sh
   git checkout main && git pull
   git tag v0.x.y
   git push origin v0.x.y
   ```
7. **GitHub Release を作る**:本文には CHANGELOG の該当する版の内容を写す
   ```sh
   gh release create v0.x.y --title v0.x.y --notes-file <該当する版の内容を書いたファイル>
   ```
8. **公開サイトで確かめる**:配信が終わったら https://finestella.com/ を開き、フッターに新しい番号が出ていること、地図・検索・予報が動くことを確かめる

## 予報の中継(Cloudflare Workers)

アプリは予報を `https://api.finestella.com/v1/forecast`(中継)から取り、中継が Open-Meteo から取得します。ブラウザから Open-Meteo に直接つなぐと、しばらくぶりに接続する端末で数分〜十数分つながらないことがあるためです(#57)。中継に届かないときや中継が失敗したときは、アプリが Open-Meteo に直接取りに行きます。

- コードは [worker/](../worker/)。中身は `worker/src/proxy.js`、テストは [test/worker.test.js](../test/worker.test.js)
- 同じ予報は10分間キャッシュから返す。Open-Meteo が応答しないときは、6時間以内のキャッシュを返す
- キャッシュから返したときも、画面の「◯:◯ 取得」は中継が Open-Meteo から取得した時刻になる
- 無料プランの範囲で動く(1日10万リクエストまで)

**中継は `main` にマージしても自動では配信されません。** `worker/` を変えたときは、手元から配信します。

```sh
cd worker
npx wrangler login   # 初回だけ。ブラウザで Cloudflare にログインする
npx wrangler deploy
```

初回の配信で `api.finestella.com` が Workers に割り当てられます(finestella.com は Cloudflare の DNS で管理しているため)。配信したら、次のように確かめます。

```sh
curl -s -o /dev/null -D - -H 'Origin: https://finestella.com' 'https://api.finestella.com/v1/forecast?latitude=36&longitude=138&hourly=cloud_cover' | grep -i x-cache
```

1回目は `X-Cache: MISS`、すぐもう一度送ると `X-Cache: HIT` になります。

### アクセスの記録

中継は1件ごとに、返したステータス・パス・Origin・User-Agent・国・回線の組織名(`asOrganization`)・受けた拠点(`colo`)を Workers Logs に残します。Cloudflare のダッシュボードで Workers の `finestella-api` →「Observability」から見られます。IP アドレスと緯度・経度(利用者の場所)は残しません。

- 正規の利用: `status` 200、`origin` が `https://finestella.com`、ブラウザの User-Agent、家庭用回線や携帯会社の組織名
- スキャンなど: `status` 403 / 404、`/.env` や `/wp-login.php` などのパス、データセンター(クラウド事業者)の組織名
