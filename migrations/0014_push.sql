-- iPhoneのホーム画面のアプリへの通知（Web Push）の宛先
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_ok_at TEXT
);
