// 今までの管理表のCSVから、データベースに入れるSQLを作る（コマンドで入れる時用）
// ふだんはアプリの「取り込み」→「前の管理表」から入れられる
//
//   node scripts/import-legacy.mjs 在庫管理.csv > private/legacy.sql
//   npx wrangler d1 execute brand-resale-db --local --file private/legacy.sql

import { readFileSync } from 'node:fs';
import { convert } from '../src/legacy.js';
export { convert };

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export function toSql(items) {
  const out = ['-- 今までの管理表から移したデータ（自動で作ったファイル）'];
  for (const it of items) {
    out.push(`INSERT INTO items (mgmt_no, supplier_code, supplier_ref, purchase_date, listed_date, sold_date, brand, name, rank, cost, status, channel, target_price, start_price, memo, legacy_row, invoice_no, invoice_status) VALUES (${[
      it.mgmt, it.supplier, `管理表${it.row}行`, it.purchase, it.listed, it.sold, it.brand, it.name, it.rank, it.cost, it.status,
      it.channel, it.target, it.start, it.memo, it.row, it.invoice, it.invoice ? 'registered' : null].map(q).join(', ')});`);
    if (it.sale) {
      const s = it.sale;
      out.push(`INSERT INTO sales (item_id, platform, sold_date, price, shipping, payout, packing, photo_fee, extra_shipping, repair, profit, days, likes, views) VALUES ((SELECT id FROM items WHERE mgmt_no = ${q(it.mgmt)}), ${[
        s.platform, s.sold_date, s.price, s.shipping, s.payout, s.packing, s.photo_fee, s.extra_shipping, s.repair, s.profit, s.days, s.likes, s.views].map(q).join(', ')});`);
    }
  }
  return out.join('\n') + '\n';
}

if (process.argv[1] && process.argv[1].endsWith('import-legacy.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('使い方：node scripts/import-legacy.mjs 在庫管理.csv > private/legacy.sql'); process.exit(1); }
  const { items, problems } = convert(readFileSync(file, 'utf8'));
  process.stdout.write(toSql(items));
  const stock = items.filter((i) => i.status !== 'sold');
  const nb = items.filter((i) => !i.brand).length;
  console.error(`ブランドが分からなかった商品：${nb}点（商品名はそのまま残しています）`);
  console.error(`商品 ${items.length}点（在庫 ${stock.length}点・在庫金額 ¥${stock.reduce((s, i) => s + i.cost, 0).toLocaleString()}／販売済み ${items.length - stock.length}点）`);
  if (problems.length) console.error(`\n確認してほしい行（${problems.length}件）：\n` + problems.join('\n'));
}
