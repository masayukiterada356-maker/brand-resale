// K-ブランドオフ（K）JBAオークションの落札CSV（Shift-JIS）
// 管理番号の数字＝「箱番号-番号（2ケタ）」 例：箱558・番号1 → KEJ558-01
// 仕入れ日＝CSVの「開催日」（行ごとに入っているので、画面で選んだ日より優先）

import { normalizeBrand } from '../brands.js';

export const code = 'K';

export function detect(header) {
  return header.includes('箱番号') && header.includes('オークション結果') && header.includes('落札価格');
}

const toInt = (s) => {
  const n = Number(String(s ?? '').replace(/[,円\s]/g, ''));
  return Number.isFinite(n) && String(s ?? '').trim() !== '' ? Math.trunc(n) : NaN;
};
const kana = (s) => String(s ?? '').normalize('NFKC').trim();

const KNOWN = new Set(['会場', '開催日', '箱番号', '番号', 'レーン名', '品名', 'ブランド名', '品番', 'ランク',
  'スタート価格', '予想時刻', 'オークション結果', '落札価格', '落札手数料']);

export function parseRecord(rec) {
  const box = kana(rec['箱番号']);
  const no = kana(rec['番号']);
  const ref = `${box}-${no.padStart(2, '0')}`;
  const date = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(kana(rec['開催日']));
  const base = { supplier_ref: `${kana(rec['開催日'])}:${ref}` };

  if (kana(rec['オークション結果']) !== '落札') {
    return { ...base, skip: `オークション結果が「${kana(rec['オークション結果']) || '空欄'}」のため取り込みません` };
  }
  if (!/^\d+$/.test(box) || !/^\d+$/.test(no)) return { ...base, skip: '箱番号・番号が数字ではありません' };
  const bid = toInt(rec['落札価格']);
  const fee = toInt(rec['落札手数料'] || '0');
  if (!Number.isFinite(bid)) return { ...base, skip: '落札価格が読めません' };

  const details = { 会場: kana(rec['会場']) };
  for (const [k, v] of Object.entries(rec)) if (!KNOWN.has(k) && v.trim()) details[k] = kana(v);

  return {
    ...base,
    purchase_date: date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : null,
    number_candidates: [ref],
    brand: normalizeBrand(kana(rec['ブランド名'])),
    brand_raw: kana(rec['ブランド名']),
    category: kana(rec['品名']),
    name: kana(rec['品番']),
    model: '',
    rank: kana(rec['ランク']),
    accessories: '',
    notes: '',
    details,
    images: [],
    bid_price: bid,
    supplier_fee: Number.isFinite(fee) ? fee : 0,
    // 仕入れ値＝（落札価格＋落札手数料）×1.1、1円未満は切り捨て（コメ兵と同じ決まり。要確認）
    cost: Math.floor(((bid + (Number.isFinite(fee) ? fee : 0)) * 11) / 10),
    warnings: [],
  };
}
