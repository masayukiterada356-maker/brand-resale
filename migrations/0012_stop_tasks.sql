-- 売れた商品の、ほかのフリマの出品を止める作業（手動で止める／PCを起動した時に止め忘れを止める）
CREATE TABLE stop_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  platform TEXT NOT NULL,           -- 止めるフリマ
  external_id TEXT,                 -- 分かっていればフリマの商品ID
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending（止める）/ done（止めた）/ not_listed（出品していなかった）
  source TEXT NOT NULL,             -- sold（売れた時）/ pc_check（PCの止め忘れチェック）
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT,
  UNIQUE (item_id, platform)
);
CREATE INDEX idx_stop_tasks_status ON stop_tasks(status);
