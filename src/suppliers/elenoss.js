// エレノス（N）注文確認メールの本文を貼り付けて読む
// 例：「E4784 エルメス メドールXO … × 1」の次の行に「¥59,000」
// 管理番号の数字＝商品コードの数字部分（E4784 → NFJ4784）

import { splitBrandFromName } from '../brands.js';

export const code = 'N';

export function detectText(text) {
  return /注文概要/.test(text) && /[A-Z]\d{3,}\s+.+×\s*\d+/.test(text);
}

const yen = (s) => Number(String(s).replace(/[¥,\s円]/g, ''));

export function parseText(text) {
  const rows = [];
  const re = /^[ \t]*([A-Z])(\d{3,})[ \t]+(.+?)[ \t]*×[ \t]*(\d+)[ \t]*\r?\n\s*¥\s*([\d,]+)/gm;
  let m;
  while ((m = re.exec(text))) {
    const [, , num, title, qty, price] = m;
    const ref = m[1] + num;
    const { brand, brandRaw, rest, unknown } = splitBrandFromName(title);
    const warnings = [];
    if (unknown) warnings.push(`ブランド名を見分けられませんでした（仮に「${brand}」）`);
    if (Number(qty) > 1) warnings.push(`数量が${qty}です（1つの商品として登録します）`);
    rows.push({
      supplier_ref: ref,
      number_candidates: [num],
      brand, brand_raw: brandRaw,
      category: '', name: rest, model: '', rank: '', accessories: '', notes: '',
      details: { 'エレノスの商品名': title },
      images: [],
      bid_price: yen(price), supplier_fee: 0,
      cost: yen(price), // 表示価格は税込
      warnings,
    });
  }
  const ship = /配送\s*\r?\n\s*¥\s*([\d,]+)/.exec(text);
  if (ship && yen(ship[1]) > 0 && rows.length) {
    rows.forEach((r) => r.warnings.push(`送料${yen(ship[1]).toLocaleString()}円は仕入れ値に入れていません`));
  }
  return rows;
}
