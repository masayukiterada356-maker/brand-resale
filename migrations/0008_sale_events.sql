-- 売れた通知（メール）の受け口。商品が特定できない時は「売れたかも」として確認を待つ
CREATE TABLE sale_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,            -- gmail / paste
  message_id TEXT UNIQUE,          -- Gmailのメッセージ ID（同じメールを2回処理しない）
  platform TEXT NOT NULL,          -- メルカリ / ラクマ / ヤフーフリマ
  external_id TEXT,                -- フリマの商品ID（例：m41825891795）
  title TEXT,                      -- 出品タイトル
  price INTEGER,
  sold_date TEXT NOT NULL,         -- メールが届いた日 YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'pending', -- pending（確認待ち）/ matched（記録済み）/ ignored（対象外）
  item_id INTEGER REFERENCES items(id),
  candidates_json TEXT,            -- 候補の商品 [{id, score}]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sale_events_status ON sale_events(status);

-- フリマごとの商品ID（下書き・出品した時や、売れた通知で分かった時に入れる）
CREATE TABLE platform_items (
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  PRIMARY KEY (platform, external_id)
);
