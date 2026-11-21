-- 第3段階（後半）：自宅PCのプログラムが作ったフリマの下書きの記録

CREATE TABLE listing_drafts (
  item_id INTEGER NOT NULL REFERENCES items(id),
  platform TEXT NOT NULL,            -- mercari / rakuma / yahoo
  status TEXT NOT NULL,              -- drafted（下書き済み）/ error / published（公開済み・後の段階）
  message TEXT,                      -- エラーの理由や、手で直してほしい所
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, platform)
);

-- 対象（レディース / メンズ / ユニセックス）。カテゴリを選ぶ時の1段目に使う
ALTER TABLE listings ADD COLUMN target TEXT;
