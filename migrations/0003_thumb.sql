-- 黄色い枠のサムネイル：R2の thumbs/{商品ID}.jpg（大）と thumbs/{商品ID}_s.jpg（一覧用の小）
-- 作り直すたびに番号を変えて、iPhoneに古い画像が残らないようにする
ALTER TABLE items ADD COLUMN thumb_version INTEGER;
