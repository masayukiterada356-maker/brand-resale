// 前の管理表の取り込み（画面で読み取った結果を、150点ずつ受け取って入れる）

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

const int = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const str = (v, n = 2000) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, n));
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const STATUS = new Set(['in_stock', 'listed', 'sold']);
const SUPPLIERS = new Set(['R', 'N', 'K', 'E', 'C', 'Y', 'X']);

async function importChunk(req, env) {
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || !items.length) return fail('商品が届いていません');
  if (items.length > 200) return fail('一度に送れるのは200点までです');

  const stmts = [];
  for (const it of items) {
    if (!it.mgmt || !STATUS.has(it.status) || !SUPPLIERS.has(it.supplier)) return fail(`データが正しくありません（${it.mgmt || '管理番号なし'}）`);
    stmts.push(env.DB.prepare(`INSERT INTO items (mgmt_no, supplier_code, supplier_ref, purchase_date, listed_date, sold_date,
        brand, name, rank, cost, status, channel, target_price, start_price, memo, legacy_row, invoice_no, invoice_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mgmt_no) DO NOTHING`).bind(
      str(it.mgmt, 60), it.supplier, `管理表${int(it.row)}行`, date(it.purchase) || '2000-01-01', date(it.listed), date(it.sold),
      str(it.brand, 60) || '', str(it.name), str(it.rank, 20), int(it.cost) ?? 0, it.status, str(it.channel, 60),
      int(it.target), int(it.start), str(it.memo), int(it.row), str(it.invoice, 20), it.invoice ? 'registered' : null,
    ));
    if (it.sale && it.status === 'sold') {
      const s = it.sale;
      // 管理表から移した商品にだけ付ける（同じ管理番号の別の商品には付けない）
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO sales (item_id, platform, sold_date, price, shipping, payout, packing,
          photo_fee, extra_shipping, repair, profit, days, likes, views)
        SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM items WHERE mgmt_no = ? AND legacy_row = ?`).bind(
        str(s.platform, 60), date(s.sold_date), int(s.price), int(s.shipping), int(s.payout), int(s.packing),
        int(s.photo_fee), int(s.extra_shipping), int(s.repair), int(s.profit), int(s.days), int(s.likes), int(s.views),
        str(it.mgmt, 60), int(it.row),
      ));
    }
  }
  const results = await env.DB.batch(stmts);
  let inserted = 0;
  let k = 0;
  for (const it of items) {
    if (results[k].meta?.changes) inserted++;
    k += it.sale && it.status === 'sold' ? 2 : 1;
  }
  return json({ inserted, skipped: items.length - inserted });
}

async function status(env) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS items, SUM(status != 'sold') AS stock,
      COALESCE(SUM(CASE WHEN status != 'sold' THEN cost END), 0) AS stock_cost, SUM(status = 'sold') AS sold
    FROM items WHERE legacy_row IS NOT NULL`).first();
  return json(r);
}

export async function handleLegacy(req, env, url) {
  if (url.pathname === '/api/legacy/import' && req.method === 'POST') return importChunk(req, env);
  if (url.pathname === '/api/legacy/status' && req.method === 'GET') return status(env);
  return null;
}
