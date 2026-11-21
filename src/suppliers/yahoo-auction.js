// ヤフオク（Y）落札メールの本文を貼り付けて読む
// 管理番号の数字＝オークションIDの末尾4ケタ（重なったら5ケタ…）
// 出品者名・インボイス登録番号は落札メールに載らないので、登録後に商品の画面で入れる

import { splitBrandFromName } from '../brands.js';
import { addShipping } from './shipping.js';

export const code = 'Y';

export function detectText(text) {
  return /オークションID[：:]/.test(text) && /落札/.test(text);
}

const yen = (s) => Number(String(s).replace(/[^\d]/g, ''));
const line = (text, label) => (new RegExp(`${label}[：:]\\s*([^\\n\\r]+)`).exec(text) || [])[1]?.trim() || '';

export function parseText(text) {
  const id = line(text, 'オークションID');
  const title = line(text, '商品');
  if (!id || !title) return [];
  const digits = id.replace(/\D/g, '');

  const total = yen(line(text, '落札合計（税込）') || line(text, '落札合計') || line(text, '落札価格'));
  const unit = yen(line(text, '落札単価'));
  const tax = yen(line(text, '消費税'));

  // タイトルから「1円」「■美品■」などの飾りを外してブランドを探す
  const rankMark = /■([^■]{1,6})■/.exec(title);
  const clean = title.replace(/^\s*1円\s*/, '').replace(/■[^■]*■/g, ' ').replace(/【[^】]*】/g, ' ').replace(/\s+/g, ' ').trim();
  const { brand, brandRaw, rest, unknown } = splitBrandFromName(clean);
  const warnings = ['出品者名とインボイス登録番号は、登録後に商品の画面で入れてください'];
  if (unknown) warnings.push(`ブランド名を見分けられませんでした（仮に「${brand}」）`);

  const rows = [{
    supplier_ref: id,
    number_candidates: [4, 5, 6, 7, 8].map((n) => digits.slice(-n)),
    brand, brand_raw: brandRaw,
    category: '', name: rest, model: '', rank: rankMark ? rankMark[1] : '', accessories: '', notes: '',
    details: {
      ヤフオクの商品名: title,
      オークションID: id,
      ...(line(text, '終了日時') ? { 終了日時: line(text, '終了日時') } : {}),
      ...(tax ? { 消費税: `${tax.toLocaleString()}円` } : {}),
    },
    images: [],
    bid_price: unit || total, supplier_fee: 0,
    cost: total || unit + tax,
    warnings,
  }];
  // 取引ナビなどの「送料」が一緒に貼られていれば、仕入れ値に含める
  const ship = /送料[^\d\n]*([\d,]+)\s*円/.exec(text);
  if (ship) addShipping(rows, yen(ship[1]));
  else rows[0].warnings.push('送料が書かれていません（送料があれば、送料の分かるメール本文も一緒に貼り付けてください）');
  return rows;
}
