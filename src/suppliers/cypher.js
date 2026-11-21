// サイファー（C）注文確認メールの本文を貼り付けて読む
// 管理番号の数字はメールにないため、登録時に入力する（決まりが分かったら自動にする）

import { splitBrandFromName } from '../brands.js';

export const code = 'C';

export function detectText(text) {
  return /商\s*品\s*番\s*号/.test(text) && /総\s*合\s*計/.test(text);
}

const field = (text, label) => {
  const re = new RegExp(`【[\\s　]*${label.split('').join('[\\s　]*')}[\\s　]*】\\s*([^\\n\\r]+)`);
  return (re.exec(text) || [])[1]?.trim() || '';
};
const yen = (s) => Number(String(s).replace(/[^\d]/g, ''));

export function parseText(text) {
  // 商品ブロックごとに読む（複数商品の注文にも対応）
  const marker = /【[\s　]*商[\s　]*品[\s　]*番[\s　]*号[\s　]*】/;
  const blocks = text.split(new RegExp(`(?=${marker.source})`)).filter((b) => marker.test(b));
  const shipping = yen(field(text, '送料') || '0');
  return blocks.map((b) => {
    const ref = field(b, '商品番号');
    const title = field(b, '商品名').replace(new RegExp(`^${ref}\\s*`), '');
    const price = yen(field(b, '小計') || field(b, '価格(税込)'));
    const { brand, brandRaw, rest } = splitBrandFromName(title);
    const warnings = ['管理番号を入力してください'];
    if (/\d+\s*点\s*セット|[５5]点/.test(title)) warnings.push('セット商品です。1点ずつ登録する場合は後で分けてください');
    return {
      supplier_ref: ref,
      number_candidates: [], // 自動では決めない
      brand, brand_raw: brandRaw,
      category: '', name: rest, model: '', rank: '', accessories: '', notes: '',
      details: { 'サイファーの商品名': title, ...(shipping ? { 送料: `${shipping}円` } : {}) },
      images: [],
      bid_price: price, supplier_fee: 0,
      cost: price + (blocks.length === 1 ? shipping : 0),
      warnings: shipping && blocks.length === 1 ? [...warnings, `送料${shipping.toLocaleString()}円を仕入れ値に含めました`] : warnings,
    };
  }).filter((r) => r.supplier_ref);
}
