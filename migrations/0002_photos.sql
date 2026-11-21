-- 第2段階（前半）：外注さんのドライブの写真を取り込み、商品に割り当てる

-- 番号フォルダ（例：11/14 の中の「5」）1つ＝商品1つ分の写真
CREATE TABLE photo_folders (
  drive_id TEXT PRIMARY KEY,               -- GoogleドライブのフォルダID
  date_folder_id TEXT NOT NULL,
  date_label TEXT NOT NULL,                -- 日付フォルダの名前（例：11/14）
  number TEXT NOT NULL,                    -- 番号フォルダの名前（例：5）
  shoot_date TEXT NOT NULL,                -- 日付フォルダが作られた日 YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'unassigned', -- unassigned / assigned / ignored
  item_id INTEGER REFERENCES items(id),
  photo_count INTEGER NOT NULL DEFAULT 0,
  first_photo_id TEXT,
  assigned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photo_folders_status ON photo_folders(status);
CREATE INDEX idx_photo_folders_item ON photo_folders(item_id);

-- 写真1枚ずつ
CREATE TABLE photos (
  drive_id TEXT PRIMARY KEY,               -- Googleドライブのファイル ID
  folder_id TEXT NOT NULL REFERENCES photo_folders(drive_id),
  item_id INTEGER REFERENCES items(id),    -- 割り当てた商品（フォルダと同じ）
  name TEXT NOT NULL,                      -- IMG_3642.jpg
  position INTEGER NOT NULL,               -- フォルダの中の順番（1から）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_folder ON photos(folder_id, position);
CREATE INDEX idx_photos_item ON photos(item_id, position);

-- サムネイルにする写真（後の段階で黄色い枠を付ける。空なら1枚目）
ALTER TABLE items ADD COLUMN thumb_photo_id TEXT;

-- 最後にドライブを確認した時刻など
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
