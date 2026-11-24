-- 仕入れ先ごとのインボイス登録番号。取り込んだ商品に自動で付ける（ヤフオクは出品者ごとに違うので手で入れる）
ALTER TABLE suppliers ADD COLUMN invoice_no TEXT;

UPDATE suppliers SET invoice_no = 'T2180001141237' WHERE code = 'R'; -- コメ兵オークション
UPDATE suppliers SET invoice_no = 'T5140001063969' WHERE code = 'E'; -- エコリング
UPDATE suppliers SET invoice_no = 'T1220001023167' WHERE code = 'K'; -- K-ブランドオフ
UPDATE suppliers SET invoice_no = 'T3122001033666' WHERE code = 'C'; -- サイファー
UPDATE suppliers SET invoice_no = 'T9010801037495' WHERE code = 'N'; -- エレノス

-- すでに入っている商品にも付ける（まだ何も入っていない商品だけ。インボイス制度が始まった 2023-10-01 以降の仕入れ）
UPDATE items SET
  invoice_no = (SELECT s.invoice_no FROM suppliers s WHERE s.code = items.supplier_code),
  invoice_status = 'registered',
  seller_name = COALESCE(seller_name, (SELECT s.name FROM suppliers s WHERE s.code = items.supplier_code))
WHERE supplier_code IN ('R', 'E', 'K', 'C', 'N') AND invoice_status IS NULL AND purchase_date >= '2023-10-01';
