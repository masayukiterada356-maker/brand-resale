// コメ兵オークション（R）
// 商品のジャンルで列が少しずつ変わるので、列の名前で読む

import { normalizeBrand } from '../brands.js';

export const code = 'R';

export function detect(header) {
  return header.includes('ロットNo') && header.includes('枝番') && header.includes('セリ結果');
}

// 決まった項目に入れる列（これ以外の列は details にまとめる）
const KNOWN = new Set([
  'ロットNo', '枝番', '品名', 'ブランド', 'モデル名', '品番型式', '相場ランク', 'ランク',
  '数量', '付属品', 'その他商品情報', 'セリ結果', '成立金額', '落札手数料',
]);

const toInt = (s) => {
  const n = Number(String(s ?? '').replace(/[,円\s]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

export function parseRecord(rec) {
  const lot = rec['ロットNo'];
  const eda = rec['枝番'];
  const ref = `${lot}-${eda}`;
  const warnings = [];

  if (rec['セリ結果'] !== '成立') {
    return { supplier_ref: ref, skip: `セリ結果が「${rec['セリ結果'] || '空欄'}」のため取り込みません` };
  }
  if (!/^\d+$/.test(lot) || !/^\d+$/.test(eda)) {
    return { supplier_ref: ref, skip: 'ロットNo・枝番が数字ではありません' };
  }

  const bid = toInt(rec['成立金額']);
  const fee = toInt(rec['落札手数料'] || '0');
  if (!Number.isFinite(bid) || !Number.isFinite(fee)) {
    return { supplier_ref: ref, skip: '成立金額・落札手数料が読めません' };
  }
  // 仕入れ値＝（成立金額＋落札手数料）×1.1、1円未満は切り捨て
  const cost = Math.floor(((bid + fee) * 11) / 10);

  const qty = toInt(rec['数量'] || '1');
  if (qty > 1) warnings.push(`数量が${qty}です（1つの商品として登録します）`);

  const details = {};
  for (const [k, v] of Object.entries(rec)) {
    if (!KNOWN.has(k) && v !== '' && v !== '0') details[k] = v;
  }
  if (qty > 1) details['数量'] = String(qty);

  const brandRaw = rec['ブランド'] || '';
  return {
    supplier_ref: ref,
    number_candidates: [ref],
    brand: normalizeBrand(brandRaw),
    brand_raw: brandRaw,
    category: rec['品名'] || '',
    name: rec['モデル名'] || '',
    model: rec['品番型式'] || '',
    rank: rec['相場ランク'] || rec['ランク'] || '',
    accessories: rec['付属品'] || '',
    notes: rec['その他商品情報'] || '',
    details,
    images: [],
    bid_price: bid,
    supplier_fee: fee,
    cost,
    warnings,
  };
}
