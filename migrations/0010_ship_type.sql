-- 商品ごとの「発送の種類」の予定（損益分岐点・値下げの下限の計算に使う）
ALTER TABLE items ADD COLUMN ship_type TEXT;
