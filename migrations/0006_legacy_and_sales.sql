-- 今までの管理表（ブランドせどり管理表）の記録を移すための列と、売れた記録の表

-- 以前の記録用の仕入れ先（管理番号から仕入れ先が分からない古い商品）
INSERT INTO suppliers (code, name) VALUES ('X', '以前の記録（仕入れ先不明）');

ALTER TABLE items ADD COLUMN channel TEXT;        -- 販路（メルカリ・MARCAS・友人名など。管理表の「プラットフォーム」）
ALTER TABLE items ADD COLUMN target_price INTEGER; -- 目安価格
ALTER TABLE items ADD COLUMN start_price INTEGER;  -- スタート価格
ALTER TABLE items ADD COLUMN memo TEXT;            -- メモ
ALTER TABLE items ADD COLUMN legacy_row INTEGER;   -- 管理表の行番号（移した商品だけ）

-- 売れた記録（1商品につき1件）
CREATE TABLE sales (
  item_id INTEGER PRIMARY KEY REFERENCES items(id),
  platform TEXT,             -- 売れた場所（メルカリ・ラクマ・ヤフーフリマ・コメ兵・友人名など）
  sold_date TEXT,            -- 売れた日 YYYY-MM-DD
  paid_date TEXT,            -- 入金（受け取り評価）の日。マネーフォワード用CSVで使う（後の段階）
  price INTEGER,             -- 販売価格
  fee INTEGER,               -- 手数料
  shipping INTEGER,          -- 送料
  payout INTEGER,            -- 入金額
  packing INTEGER,           -- 梱包材
  photo_fee INTEGER,         -- 撮影代
  extra_shipping INTEGER,    -- 送料（管理表の右側の「送料」列）
  repair INTEGER,            -- リペア代
  profit INTEGER,            -- 利益金額（管理表の値をそのまま）
  days INTEGER,              -- 販売日数
  likes INTEGER,
  views INTEGER,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sales_sold ON sales(sold_date);
CREATE INDEX idx_sales_platform ON sales(platform);
