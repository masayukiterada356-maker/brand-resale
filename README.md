# ブランド中古物販 管理アプリ

第1段階：データベース・仕入れ先CSVの取り込み・管理番号の自動付与・在庫一覧

## 構成
- `src/index.js` … Cloudflare Worker（/api/*）。それ以外は `public/` の画面を返す
- `src/import.js` … CSV取り込みの本体（仕入れ先の見分け・管理番号・仕入れ値）
- `src/suppliers/` … 仕入れ先ごとの読み方（komehyo.js＝コメ兵、ecoring.js＝エコリング）
- `src/brands.js` … ブランド名の表記ゆれの対応表
- `migrations/` … データベース（D1）の表
- `public/` … iPhone向けの画面

## 手元で動かす
```
npm install
npm run db:migrate:local
npm run dev        # http://localhost:8787
npm test           # 管理番号・仕入れ値のテスト
```

## Cloudflareに載せる（初回）
```
npx wrangler login
npx wrangler d1 create brand-resale-db   # 出てきた database_id を wrangler.jsonc に書く
npx wrangler d1 migrations apply brand-resale-db --remote
npm run deploy
```
公開後、Cloudflare Access（Zero Trust）で自分のGoogleアカウントだけ入れるようにする。
