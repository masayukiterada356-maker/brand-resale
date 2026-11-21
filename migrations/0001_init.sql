-- 第1段階：仕入れ先・取り込み履歴・商品

CREATE TABLE suppliers (
  code TEXT PRIMARY KEY,          -- 管理番号の1文字目（R, N, K, E, C, Y）
  name TEXT NOT NULL
);

INSERT INTO suppliers (code, name) VALUES
  ('R', 'コメ兵オークション'),
  ('N', 'ELENOSS（エレノス）'),
  ('K', 'K-ブランドオフ（JBA）'),
  ('E', 'エコリング'),
  ('C', 'Cypher（サイファー）'),
  ('Y', 'ヤフオク');

-- CSVを1回取り込むごとに1行
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_code TEXT NOT NULL REFERENCES suppliers(code),
  filename TEXT,
  purchase_date TEXT NOT NULL,    -- YYYY-MM-DD
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mgmt_no TEXT NOT NULL UNIQUE,           -- 例：RFK46-4 / EFK1528
  supplier_code TEXT NOT NULL REFERENCES suppliers(code),
  supplier_ref TEXT NOT NULL,             -- 仕入れ先の番号（コメ兵：46-4、エコリング：13桁）
  import_batch_id INTEGER REFERENCES import_batches(id),

  purchase_date TEXT NOT NULL,            -- 仕入れ日 YYYY-MM-DD
  listed_date TEXT,                       -- 出品日（後の段階）
  sold_date TEXT,                         -- 売れた日（後の段階）

  brand TEXT,                             -- 表記をそろえたブランド名
  brand_raw TEXT,                         -- CSVに書かれていたままのブランド名
  category TEXT,                          -- 品名（ハンドバッグ、ネックレス など）
  name TEXT,                              -- 商品名
  model TEXT,                             -- モデル名・品番
  rank TEXT,                              -- 相場ランク・ランク
  accessories TEXT,                       -- 付属品
  notes TEXT,                             -- その他商品情報（傷・状態のメモ）
  details_json TEXT,                      -- ジャンル特有の列（素材・シリアル・カラット等）
  supplier_images_json TEXT,              -- 仕入れ先の写真URL（確認用）

  bid_price INTEGER,                      -- 落札額（税抜）
  supplier_fee INTEGER,                   -- 落札手数料（税抜）
  cost INTEGER NOT NULL,                  -- 仕入れ値（税込・実際の支払い）

  status TEXT NOT NULL DEFAULT 'in_stock',-- in_stock / listed / sold など
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (supplier_code, supplier_ref)    -- 同じCSVを2回取り込んでも重複しない
);

CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_purchase_date ON items(purchase_date);
CREATE INDEX idx_items_brand ON items(brand);
