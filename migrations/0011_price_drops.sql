-- 毎晩の値下げ：各フリマの「出品中」の商品と、値下げの記録

CREATE TABLE platform_listings (
  platform TEXT NOT NULL,           -- メルカリ / ラクマ / ヤフーフリマ
  external_id TEXT NOT NULL,        -- フリマの商品ID（m… / ラクマの番号 / z…）
  item_id INTEGER REFERENCES items(id),  -- 在庫のどの商品か（結び付いていなければ空）
  title TEXT,
  price INTEGER,                    -- 今の価格（最後に見た時、または値下げした後）
  url TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active（出品中）/ gone（一覧から消えた）
  candidates_json TEXT,             -- 結び付けの候補
  floor_hit_at TEXT,                -- 下限（損益分岐点）に届いた日
  last_drop_at TEXT,                -- 最後に値下げした日（日本時間 YYYY-MM-DD）
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (platform, external_id)
);
CREATE INDEX idx_platform_listings_item ON platform_listings(item_id);

CREATE TABLE price_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  item_id INTEGER,
  old_price INTEGER,
  new_price INTEGER,
  status TEXT NOT NULL,             -- done / error / changed（画面の価格が違った）
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_price_drops_created ON price_drops(created_at);
