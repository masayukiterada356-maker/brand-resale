-- 写真フォルダを最後に読んだ時刻（1回の確認で読めるフォルダ数に上限があるので、古い順に読み直す）
ALTER TABLE photo_folders ADD COLUMN synced_at TEXT;
