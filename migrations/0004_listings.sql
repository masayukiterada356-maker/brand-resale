-- 第3段階（前半）：出品文・推奨価格（Geminiが作り、MASAが確認・修正する）

CREATE TABLE listings (
  item_id INTEGER PRIMARY KEY REFERENCES items(id),
  title TEXT NOT NULL,
  rank_label TEXT,                 -- 極美品 / 美品 / 良品 など
  condition TEXT NOT NULL,         -- フリマの「商品の状態」
  category TEXT,                   -- 例：バッグ / トートバッグ
  description TEXT NOT NULL,       -- 説明文（決まった文と管理番号まで入った完成形）
  ai_price INTEGER,                -- Geminiの推奨価格（メルカリ）
  ai_price_reason TEXT,
  price INTEGER,                   -- MASAが決めたメルカリの価格（ラクマ・ヤフーは1,000円引き）
  ai_raw TEXT,                     -- Geminiの答えそのまま（作り直しの参考）
  ready INTEGER NOT NULL DEFAULT 0,-- 1＝確認済み。下書き作成の対象
  generated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 写真の自動振り分け：Geminiのおすすめ
ALTER TABLE photo_folders ADD COLUMN ai_item_id INTEGER REFERENCES items(id);
ALTER TABLE photo_folders ADD COLUMN ai_confidence REAL;
ALTER TABLE photo_folders ADD COLUMN ai_reason TEXT;
