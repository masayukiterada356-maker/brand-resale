-- 仕入れ先のインボイス（適格請求書）情報。ヤフオクなど、個人・事業者から買う時に記録する
ALTER TABLE items ADD COLUMN seller_name TEXT;   -- 出品者（仕入れ先）の名前・ID
ALTER TABLE items ADD COLUMN invoice_no TEXT;    -- 登録番号（T＋13ケタ）。登録のない相手は空
ALTER TABLE items ADD COLUMN invoice_status TEXT;-- registered（登録番号あり）/ none（登録なしの相手）/ 空＝未確認
