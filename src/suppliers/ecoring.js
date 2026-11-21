// エコリング（E）エコオクの落札CSV（Shift-JIS、1行目英語・2行目日本語の見出し）

import { splitBrandFromName } from '../brands.js';

export const code = 'E';

export function detect(header) {
  return header.includes('buyout_number') && header.includes('buy_total');
}

const toInt = (s) => {
  if (s === undefined || s === null || String(s).trim() === '') return NaN;
  const n = Number(String(s).replace(/[,円\s]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

export function parseRecord(rec) {
  const ref = rec['buyout_number'] || '';

  // 2行目の日本語見出しなど、番号が数字でない行は読み飛ばす
  if (!/^\d{5,}$/.test(ref)) return { supplier_ref: ref, skip: '見出し行', silent: true };

  if (rec['sell_price'] || rec['sell_total']) {
    return { supplier_ref: ref, skip: '販売の行のため取り込みません' };
  }
  if (rec['cancel_fee']) {
    return { supplier_ref: ref, skip: 'キャンセルの行のため取り込みません' };
  }

  const bid = toInt(rec['bid_price']);
  if (!Number.isFinite(bid)) return { supplier_ref: ref, skip: '落札額が読めません' };
  const fee = toInt(rec['purchase_commission']) || 0;
  let cost = toInt(rec['buy_total']);
  const warnings = [];
  if (!Number.isFinite(cost)) {
    cost = bid + (toInt(rec['bid_price_tax']) || 0) + fee + (toInt(rec['purchase_commission_tax']) || 0);
    warnings.push('落札合計が空欄のため、落札額・手数料・消費税を足して計算しました');
  }

  // 商品名：先頭の (13572_0104) を外し、続くブランド名を取り出す
  let name = rec['item_name'] || '';
  const details = {};
  const lot = /^\((\d+_\d+)\)\s*/.exec(name);
  if (lot) { details['オークション番号'] = lot[1]; name = name.slice(lot[0].length); }
  let category = '';
  const cat = /\(([^()]+)\)\s*$/.exec(name);
  if (cat) { category = cat[1]; }

  const { brand, brandRaw, rest, unknown } = splitBrandFromName(name);
  if (unknown) warnings.push(`ブランド名を見分けられませんでした（仮に「${brand}」）`);
  if (rec['memo']) details['メモ'] = rec['memo'];

  const images = Object.keys(rec)
    .filter((k) => /^image_\d+$/.test(k))
    .sort()
    .map((k) => rec[k])
    .filter((u) => /^https?:\/\//.test(u));

  return {
    supplier_ref: ref,
    // 管理番号の数字：末尾4ケタ。重なったら末尾5ケタ（さらに重なれば6ケタ…）
    number_candidates: [4, 5, 6, 7, 8].map((n) => ref.slice(-n)),
    brand,
    brand_raw: brandRaw,
    category,
    name: rest || name,
    model: '',
    rank: '',
    accessories: '',
    notes: '',
    details,
    images,
    bid_price: bid,
    supplier_fee: fee,
    cost,
    warnings,
  };
}
