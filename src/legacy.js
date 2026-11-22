// 今までの管理表（ブランドせどり管理表の「在庫管理」シートのCSV）を、アプリの形に直す
// ブラウザでもサーバーでも使う（public/shared/ に写して画面から読み込む）
//
// ・売上日がある行＝販売済み、ない行＝在庫（出品日があれば出品中、なければ未出品）
// ・管理番号はそのまま。重なった時は「_2」を付け、空欄は「旧-行番号」にする
// ・読めない数字（「不明」「#VALUE!」など）は空にして、元の文字をメモに残す
// ・撮影代の列に入っているインボイス登録番号（T＋13ケタ）は、インボイスの欄に移す

import { parseCsv } from './csv.js';
import { splitBrandFromName } from './brands.js';

export const HEAD = ['プラットフォーム', '仕入れ日', '出品日', '商品ページ', '画像URL', '管理番号', '商品名', 'ランク', '仕入値',
  '目安価格', '買い戻し金額', '損益分岐点', 'スタート価格', '売上日', '販売価格', '送料', '入金額', '梱包材', '利益金額',
  '利益率', '販売日数', '売れた曜日', '売れた時間', 'いいね数', '閲覧数', 'メモ', '撮影代', '送料2', 'リペア'];

export const NEW_FORMAT = /^([RNKECY])[A-J][A-L]/;

export function toYen(s) {
  const t = String(s ?? '').replace(/[¥￥,\s]/g, '').trim();
  if (t === '' || t === '-') return { value: null };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { value: Math.round(Number(t)) };
  return { value: null, raw: String(s).trim() };
}

export function toDate(s) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(s ?? '').trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

export function convert(text) {
  const all = parseCsv(text);
  const hi = all.findIndex((r) => r[0] === 'プラットフォーム' && r[5] === '管理番号');
  if (hi < 0) throw new Error('「在庫管理」シートのCSVではないようです（見出しの行が見つかりません）');

  const used = new Map();
  const items = [];
  const problems = [];
  all.slice(hi + 1).forEach((r, i) => {
    const row = hi + 2 + i; // スプレッドシートの行番号
    const c = Object.fromEntries(HEAD.map((h, k) => [h, (r[k] ?? '').trim()]));
    if (!c['管理番号'] && !c['商品名']) return; // 空の行（ひな形だけの行）

    let mgmt = c['管理番号'] || `旧-${row}`;
    if (used.has(mgmt)) { const n = used.get(mgmt) + 1; used.set(mgmt, n); problems.push(`${row}行目：管理番号「${mgmt}」が重なるため「${mgmt}_${n}」にしました`); mgmt = `${mgmt}_${n}`; }
    else used.set(mgmt, 1);
    if (!c['管理番号']) problems.push(`${row}行目：管理番号が空欄のため「${mgmt}」にしました`);

    const memo = [c['メモ']];
    // 撮影代の列に入っているインボイス登録番号（ヤフオク仕入れ）は、インボイスの欄に移す
    let invoice = null;
    if (/^T\d{13}$/.test(c['撮影代'])) { invoice = c['撮影代']; c['撮影代'] = ''; }
    const num = (h) => {
      const y = toYen(c[h]);
      if (y.raw) { memo.push(`${h}：${y.raw}`); problems.push(`${row}行目（${mgmt}）：${h}「${y.raw}」は数字ではないので空にしました`); }
      return y.value;
    };
    const purchase = toDate(c['仕入れ日']);
    const listed = toDate(c['出品日']);
    if (c['出品日'] && !listed) memo.push(`出品日：${c['出品日']}`);
    const sold = toDate(c['売上日']);
    if (c['売上日'] && !sold) problems.push(`${row}行目（${mgmt}）：売上日「${c['売上日']}」が読めません`);

    const sup = NEW_FORMAT.exec(mgmt);
    const item = {
      row, mgmt,
      supplier: sup ? sup[1] : 'X',
      channel: c['プラットフォーム'] || null,
      purchase: purchase || '2000-01-01',
      listed,
      sold,
      name: c['商品名'],
      brand: (() => { const b = splitBrandFromName(c['商品名'].replace(/[\u3000]/g, ' ')); return b.unknown ? '' : b.brand; })(),
      rank: c['ランク'].normalize('NFKC'),
      cost: num('仕入値') ?? 0,
      target: num('目安価格'),
      start: num('スタート価格'),
      status: c['売上日'] ? 'sold' : listed ? 'listed' : 'in_stock',
      invoice,
      sale: null,
    };
    if (!purchase) problems.push(`${row}行目（${mgmt}）：仕入れ日が空欄・読めないため 2000-01-01 にしました`);
    if (c['売上日']) {
      item.sale = {
        platform: c['プラットフォーム'] || null, sold_date: sold,
        price: num('販売価格'), shipping: num('送料'), payout: num('入金額'), packing: num('梱包材'),
        photo_fee: num('撮影代'), extra_shipping: num('送料2'), repair: num('リペア'), profit: num('利益金額'),
        days: toYen(c['販売日数']).value, likes: toYen(c['いいね数']).value, views: toYen(c['閲覧数']).value,
      };
    } else {
      // 在庫の行の撮影代・送料などはメモに残す
      for (const h of ['撮影代', '送料2', 'リペア']) if (c[h]) memo.push(`${h}：${c[h]}`);
    }
    item.memo = memo.filter(Boolean).join(' / ') || null;
    items.push(item);
  });
  return { items, problems };
}

