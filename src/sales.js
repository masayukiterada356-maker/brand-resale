import { parseSoldMail } from './mail-parsers.js';
import { findItem } from './match.js';

// 売れた時の記録（手で入れる「売れた」ボタン。後の段階でメールからの自動記録も同じ形で入れる）

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

// 手数料の率（ラクマは月ごとに変わることがあるので、後で設定画面から変えられるようにする）
export const FEE_RATE = { 'メルカリ': 0.10, 'ラクマ': 0.10, 'ヤフーフリマ': 0.05 };

// 発送の種類ごとの送料（各フリマの配送サービス）。梱包代は商品ごとに入れる
export const SHIPPING = {
  'ネコポス':         { 'メルカリ': 210,  'ラクマ': 200,  'ヤフーフリマ': 210 },
  '宅急便コンパクト': { 'メルカリ': 450,  'ラクマ': 430,  'ヤフーフリマ': 490 },
  '60サイズ':         { 'メルカリ': 750,  'ラクマ': 650,  'ヤフーフリマ': 750 },
  '80サイズ':         { 'メルカリ': 850,  'ラクマ': 750,  'ヤフーフリマ': 850 },
  '100サイズ':        { 'メルカリ': 1050, 'ラクマ': 1050, 'ヤフーフリマ': 1050 },
};

// 発送の種類ごとの梱包材（フリマ共通）
export const PACKING = { 'ネコポス': 80, '宅急便コンパクト': 80, '60サイズ': 100, '80サイズ': 100, '100サイズ': 100 };

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

// 売れたことを記録する（ボタンからも、メールからも使う）
export async function recordSale(env, itemId, b) {
  const item = await env.DB.prepare('SELECT id, cost, status, purchase_date FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return { error: '商品が見つかりません', status: 404 };
  if (item.status === 'sold') return { error: 'この商品はもう「売れた」になっています' };
  const platform = String(b.platform || '').trim().slice(0, 40);
  if (!platform) return { error: '売れた場所を選んでください' };
  const soldDate = /^\d{4}-\d{2}-\d{2}$/.test(b.sold_date || '') ? b.sold_date : null;
  if (!soldDate) return { error: '売れた日を選んでください' };
  const c = calcSale({ ...b, platform }, item.cost);
  if (c.error) return c;
  const days = Math.round((Date.parse(soldDate) - Date.parse(item.purchase_date)) / 86400000);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sales (item_id, platform, sold_date, price, fee, shipping, payout, packing, photo_fee, profit, days, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(itemId, platform, soldDate, c.price, c.fee, c.shipping, c.payout, c.packing, c.photo_fee, c.profit, days,
        [b.ship_type ? `発送：${b.ship_type}` : '', String(b.memo || '').slice(0, 500)].filter(Boolean).join(' / ') || null),
    env.DB.prepare("UPDATE items SET status = 'sold', sold_date = ?, updated_at = datetime('now') WHERE id = ?").bind(soldDate, itemId),
  ]);
  return { ok: true, ...c, days };
}

async function markSold(itemId, req, env) {
  const b = await req.json().catch(() => ({}));
  const r = await recordSale(env, itemId, b);
  return r.error ? fail(r.error, r.status || 400) : json(r);
}

// 発送した時：発送の種類を選ぶと、送料・梱包代を入れて入金額・利益を計算し直す
async function updateShipping(itemId, req, env) {
  const b = await req.json().catch(() => ({}));
  const sale = await env.DB.prepare('SELECT s.*, i.cost FROM sales s JOIN items i ON i.id = s.item_id WHERE s.item_id = ?').bind(itemId).first();
  if (!sale) return fail('売れた記録がありません', 404);
  const shipping = b.shipping !== undefined && b.shipping !== ''
    ? Number(b.shipping) : (SHIPPING[b.ship_type]?.[sale.platform] ?? sale.shipping ?? 0);
  // 梱包材：入れていなければ、発送の種類の決まった金額
  const packing = b.packing !== undefined && b.packing !== '' && b.packing !== null
    ? Number(b.packing) : (PACKING[b.ship_type] ?? sale.packing ?? 0);
  const c = calcSale({ platform: sale.platform, price: sale.price, fee: sale.fee, shipping,
    packing, photo_fee: b.photo_fee ?? sale.photo_fee ?? 0 }, sale.cost);
  if (c.error) return fail(c.error);
  await env.DB.prepare(`UPDATE sales SET shipping = ?, packing = ?, photo_fee = ?, payout = ?, profit = ?,
      memo = TRIM(COALESCE(memo, '') || ?) WHERE item_id = ?`)
    .bind(c.shipping, c.packing, c.photo_fee, c.payout, c.profit, b.ship_type ? ` 発送：${b.ship_type}` : '', itemId).run();
  return json({ ok: true, ...c });
}

/* ---------- 売れた通知（メール） ---------- */

// 通知1件を処理する：商品が確定すれば記録、しなければ「売れたかも」に置く
export async function handleSoldNotice(env, parsed, { source, message_id = null, sold_date }) {
  if (message_id) {
    const dup = await env.DB.prepare('SELECT id FROM sale_events WHERE message_id = ?').bind(message_id).first();
    if (dup) return { duplicate: true };
  }
  const found = await findItem(env, parsed);
  const ins = await env.DB.prepare(`INSERT INTO sale_events (source, message_id, platform, external_id, title, price, sold_date, status, item_id, candidates_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?) RETURNING id`)
    .bind(source, message_id, parsed.platform, parsed.external_id, parsed.title, parsed.price, sold_date, JSON.stringify(found.candidates)).first();
  if (found.item_id) {
    const r = await confirmEvent(env, ins.id, found.item_id);
    return { event_id: ins.id, matched: !r.error, item_id: found.item_id, error: r.error };
  }
  return { event_id: ins.id, matched: false, candidates: found.candidates };
}

async function confirmEvent(env, eventId, itemId) {
  const ev = await env.DB.prepare('SELECT * FROM sale_events WHERE id = ?').bind(eventId).first();
  if (!ev) return { error: '通知が見つかりません' };
  if (ev.status !== 'pending') return { error: 'この通知は処理済みです' };
  // 送料・梱包代は発送の時に入れる。撮影代は 900円
  const r = await recordSale(env, itemId, { platform: ev.platform, sold_date: ev.sold_date, price: ev.price, shipping: 0, packing: 0, photo_fee: 900 });
  if (r.error) return r;
  const stmts = [env.DB.prepare("UPDATE sale_events SET status = 'matched', item_id = ? WHERE id = ?").bind(itemId, eventId)];
  if (ev.external_id) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO platform_items (platform, external_id, item_id) VALUES (?, ?, ?)')
      .bind(ev.platform, ev.external_id, itemId));
  }
  await env.DB.batch(stmts);
  return r;
}

async function pasteNotice(req, env) {
  const b = await req.json().catch(() => ({}));
  const parsed = parseSoldMail(b.text);
  if (!parsed) return fail('売れた通知のメールとして読めませんでした（今はメルカリ・ラクマに対応）');
  if (!parsed.price) return fail('価格が読み取れませんでした');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.sold_date || '') ? b.sold_date : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return json({ parsed, ...(await handleSoldNotice(env, parsed, { source: 'paste', sold_date: day })) });
}

async function inbox(env) {
  const { results } = await env.DB.prepare("SELECT * FROM sale_events WHERE status = 'pending' ORDER BY id DESC").all();
  const ids = [...new Set(results.flatMap((e) => JSON.parse(e.candidates_json || '[]').map((c) => c.id)))];
  const items = ids.length
    ? (await env.DB.prepare(`SELECT id, mgmt_no, brand, name, cost, channel, start_price, thumb_version, supplier_images_json
        FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results
    : [];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  return json({ events: results.map((e) => ({
    ...e, candidates: JSON.parse(e.candidates_json || '[]').map((c) => ({ ...byId[c.id], score: c.score })).filter((c) => c.id),
  })) });
}

async function eventAction(id, req, env) {
  const b = await req.json().catch(() => ({}));
  if (b.ignore) {
    await env.DB.prepare("UPDATE sale_events SET status = 'ignored' WHERE id = ? AND status = 'pending'").bind(id).run();
    return json({ ok: true });
  }
  const r = await confirmEvent(env, id, Number(b.item_id));
  return r.error ? fail(r.error) : json(r);
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
  r = /^\/api\/items\/(\d+)\/shipping$/.exec(url.pathname);
  if (r && req.method === 'POST') return updateShipping(Number(r[1]), req, env);
  if (url.pathname === '/api/sales/config' && req.method === 'GET') return json({ fee_rate: FEE_RATE, shipping: SHIPPING, packing: PACKING });
  if (url.pathname === '/api/sales/inbox' && req.method === 'GET') return inbox(env);
  if (url.pathname === '/api/sales/inbox/paste' && req.method === 'POST') return pasteNotice(req, env);
  r = /^\/api\/sales\/inbox\/(\d+)$/.exec(url.pathname);
  if (r && req.method === 'POST') return eventAction(Number(r[1]), req, env);
  return null;
}
