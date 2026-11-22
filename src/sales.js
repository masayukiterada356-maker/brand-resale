// 売れた時の記録（手で入れる「売れた」ボタン。後の段階でメールからの自動記録も同じ形で入れる）

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

// 手数料の率（ラクマは月ごとに変わることがあるので、後で設定画面から変えられるようにする）
export const FEE_RATE = { 'メルカリ': 0.10, 'ラクマ': 0.10, 'ヤフーフリマ': 0.05 };

// 発送の種類ごとの送料（各フリマの配送サービス）。梱包代は商品ごとに入れる
export const SHIPPING = {
  'ネコポス':         { 'メルカリ': 210, 'ラクマ': 200, 'ヤフーフリマ': 200 },
  '宅急便コンパクト': { 'メルカリ': 450, 'ラクマ': 530, 'ヤフーフリマ': 450 },
  '60サイズ':         { 'メルカリ': 750, 'ラクマ': 800, 'ヤフーフリマ': 750 },
  '80サイズ':         { 'メルカリ': 850, 'ラクマ': 1000, 'ヤフーフリマ': 850 },
  '100サイズ':        { 'メルカリ': 1050, 'ラクマ': 1250, 'ヤフーフリマ': 1050 },
};

const int = (v) => (v === '' || v === null || v === undefined ? null : Math.round(Number(v)));

export function calcSale(b, cost) {
  const price = int(b.price);
  if (!price || price < 0) return { error: '販売価格を入れてください' };
  const fee = int(b.fee) ?? Math.floor(price * (FEE_RATE[b.platform] ?? 0));
  const shipping = int(b.shipping) ?? 0;
  const packing = int(b.packing) ?? 0;
  const photo = int(b.photo_fee) ?? 0;
  if ([fee, shipping, packing, photo].some((n) => !Number.isFinite(n) || n < 0)) return { error: '金額が正しくありません' };
  const payout = price - fee - shipping;
  const profit = payout - cost - packing - photo;
  return { price, fee, shipping, packing, photo_fee: photo, payout, profit };
}

async function markSold(itemId, req, env) {
  const b = await req.json().catch(() => ({}));
  const item = await env.DB.prepare('SELECT id, cost, status, purchase_date FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return fail('商品が見つかりません', 404);
  if (item.status === 'sold') return fail('この商品はもう「売れた」になっています');
  const platform = String(b.platform || '').trim().slice(0, 40);
  if (!platform) return fail('売れた場所を選んでください');
  const soldDate = /^\d{4}-\d{2}-\d{2}$/.test(b.sold_date || '') ? b.sold_date : null;
  if (!soldDate) return fail('売れた日を選んでください');
  const c = calcSale({ ...b, platform }, item.cost);
  if (c.error) return fail(c.error);
  const days = Math.round((Date.parse(soldDate) - Date.parse(item.purchase_date)) / 86400000);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sales (item_id, platform, sold_date, price, fee, shipping, payout, packing, photo_fee, profit, days, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(itemId, platform, soldDate, c.price, c.fee, c.shipping, c.payout, c.packing, c.photo_fee, c.profit, days,
        [b.ship_type ? `発送：${b.ship_type}` : '', String(b.memo || '').slice(0, 500)].filter(Boolean).join(' / ') || null),
    env.DB.prepare("UPDATE items SET status = 'sold', sold_date = ?, updated_at = datetime('now') WHERE id = ?").bind(soldDate, itemId),
  ]);
  return json({ ok: true, ...c, days });
}

// 間違えた時に「売れた」を取り消す
async function undoSold(itemId, env) {
  const item = await env.DB.prepare('SELECT listed_date, legacy_row FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return fail('商品が見つかりません', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sales WHERE item_id = ?').bind(itemId),
    env.DB.prepare("UPDATE items SET status = ?, sold_date = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(item.listed_date ? 'listed' : 'in_stock', itemId),
  ]);
  return json({ ok: true });
}

export async function handleSales(req, env, url) {
  let r = /^\/api\/items\/(\d+)\/sold$/.exec(url.pathname);
  if (r && req.method === 'POST') return markSold(Number(r[1]), req, env);
  if (r && req.method === 'DELETE') return undoSold(Number(r[1]), env);
  if (url.pathname === '/api/sales/config' && req.method === 'GET') return json({ fee_rate: FEE_RATE, shipping: SHIPPING });
  return null;
}
