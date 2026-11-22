// Cloudflare Worker：/api/* はここで処理し、それ以外は public/ の画面を返す

import { buildPreview } from './import.js';
import { handlePhotos, syncDrive, saveThumb, getThumb } from './photos.js';
import { handleListings } from './listings.js';
import { handleLegacy } from './legacy-api.js';
import { handleSales } from './sales.js';
import { checkGmail } from './gmail.js';
import { withConfig, handleConfig } from './config.js';
import { handleAuth, isLoggedIn } from './auth.js';
import STATIC from './static-files.js';
import { handleAgent, agentAuthorized, resetDraft } from './agent.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

async function loadExisting(db, supplierCode) {
  const { results } = await db
    .prepare('SELECT mgmt_no, supplier_code, supplier_ref, legacy_row FROM items')
    .all();
  return {
    mgmtNos: new Set(results.map((r) => r.mgmt_no)),
    legacyMgmtNos: new Set(results.filter((r) => r.legacy_row).map((r) => r.mgmt_no)),
    refs: new Set(results.filter((r) => !supplierCode || r.supplier_code === supplierCode)
      .map((r) => `${r.supplier_code}:${r.supplier_ref}`)),
  };
}

function checkImportBody(body) {
  if (!body || typeof body.text !== 'string' || !body.text.trim()) return 'CSVの中身がありません';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.purchase_date || '')) return '仕入れ日を選んでください';
  return null;
}

async function importPreview(req, env) {
  const body = await req.json().catch(() => null);
  const err = checkImportBody(body);
  if (err) return fail(err);
  try {
    const existing = await loadExisting(env.DB);
    return json(buildPreview(body.text, body.purchase_date, existing, body.overrides || {}));
  } catch (e) {
    return fail(e.message);
  }
}

async function importCommit(req, env) {
  const body = await req.json().catch(() => null);
  const err = checkImportBody(body);
  if (err) return fail(err);

  let preview;
  try {
    // 画面から届いた結果は使わず、サーバーでもう一度計算する
    preview = buildPreview(body.text, body.purchase_date, await loadExisting(env.DB), body.overrides || {});
  } catch (e) {
    return fail(e.message);
  }
  const rows = preview.rows.filter((r) => r.status === 'ok');
  if (rows.length === 0) return fail('登録できる商品がありません');

  const batch = await env.DB
    .prepare('INSERT INTO import_batches (supplier_code, filename, purchase_date, item_count) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(preview.supplier_code, body.filename || null, preview.purchase_date, rows.length)
    .first();

  const insert = env.DB.prepare(`INSERT INTO items (
      mgmt_no, supplier_code, supplier_ref, import_batch_id, purchase_date,
      brand, brand_raw, category, name, model, rank, accessories, notes,
      details_json, supplier_images_json, bid_price, supplier_fee, cost
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  try {
    await env.DB.batch(rows.map((r) => insert.bind(
      r.mgmt_no, preview.supplier_code, r.supplier_ref, batch.id, r.purchase_date || preview.purchase_date,
      r.brand, r.brand_raw, r.category, r.name, r.model, r.rank, r.accessories, r.notes,
      JSON.stringify(r.details || {}), JSON.stringify(r.images || []),
      r.bid_price, r.supplier_fee, r.cost,
    )));
  } catch (e) {
    await env.DB.prepare('DELETE FROM import_batches WHERE id = ?').bind(batch.id).run();
    return fail(`登録できませんでした：${e.message}`, 409);
  }

  return json({
    batch_id: batch.id,
    inserted: rows.length,
    mgmt_nos: rows.map((r) => r.mgmt_no),
    summary: preview.summary,
  });
}

function parseItem(r) {
  const out = { ...r };
  out.details = JSON.parse(r.details_json || '{}');
  out.supplier_images = JSON.parse(r.supplier_images_json || '[]');
  delete out.details_json;
  delete out.supplier_images_json;
  return out;
}

async function listItems(url, env) {
  const q = (url.searchParams.get('q') || '').trim();
  // view：stock＝在庫（未出品＋出品中）、unlisted＝未出品、listed＝出品中、sold＝売れた商品
  const view = url.searchParams.get('view') || 'stock';
  const where = [];
  const args = [];
  if (view === 'stock') where.push("i.status != 'sold'");
  else if (view === 'unlisted') where.push("i.status = 'in_stock'");
  else if (view === 'listed') where.push("i.status = 'listed'");
  else if (view === 'sold') where.push("i.status = 'sold'");
  if (q) {
    where.push('(i.mgmt_no LIKE ? OR i.brand LIKE ? OR i.name LIKE ? OR i.category LIKE ? OR i.model LIKE ? OR i.channel LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like, like, like);
  }
  const sql = `SELECT i.id, i.mgmt_no, i.supplier_code, s.name AS supplier_name, i.purchase_date,
      i.brand, i.category, i.name, i.model, i.rank, i.cost, i.status, i.supplier_images_json,
      i.thumb_version, i.channel, i.invoice_status, i.listed_date, sa.sold_date, sa.price AS sold_price, sa.profit, sa.platform AS sold_platform,
      (SELECT CASE WHEN l.ready = 1 THEN 'ready' ELSE 'draft' END FROM listings l WHERE l.item_id = i.id) AS listing_state,
      COALESCE(i.thumb_photo_id, (SELECT p.drive_id FROM photos p WHERE p.item_id = i.id ORDER BY p.folder_id, p.position LIMIT 1)) AS photo_id,
      CAST(COALESCE(julianday(sa.sold_date), julianday('now', '+9 hours')) - julianday(i.purchase_date) AS INTEGER) AS days
    FROM items i JOIN suppliers s ON s.code = i.supplier_code
    LEFT JOIN sales sa ON sa.item_id = i.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${view === 'sold' ? 'sa.sold_date DESC' : 'i.purchase_date DESC'}, i.id DESC LIMIT 300`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const items = results.map((r) => {
    const imgs = JSON.parse(r.supplier_images_json || '[]');
    delete r.supplier_images_json;
    const thumb = r.thumb_version ? `/api/items/${r.id}/thumb?size=s&v=${r.thumb_version}`
      : r.photo_id ? `/api/photos/img/${r.photo_id}?s=200` : imgs[0] || null;
    return { ...r, thumb };
  });
  const totals = await env.DB.prepare(`SELECT
      COALESCE(SUM(status != 'sold'), 0) AS count, COALESCE(SUM(CASE WHEN status != 'sold' THEN cost END), 0) AS cost,
      COALESCE(SUM(status = 'in_stock'), 0) AS unlisted, COALESCE(SUM(CASE WHEN status = 'in_stock' THEN cost END), 0) AS unlisted_cost,
      COALESCE(SUM(status = 'listed'), 0) AS listed, COALESCE(SUM(status = 'sold'), 0) AS sold
    FROM items`).first();
  return json({ items, totals });
}

// 仕入れ先のインボイス情報を保存する
export function checkInvoice(b) {
  const status = ['registered', 'none', ''].includes(b.invoice_status) ? b.invoice_status : null;
  if (status === null) return { error: 'インボイスの区分が正しくありません' };
  const no = String(b.invoice_no || '').normalize('NFKC').replace(/[\s-]/g, '').toUpperCase();
  if (status === 'registered' && !/^T\d{13}$/.test(no)) return { error: '登録番号は「T」と数字13ケタです（例：T1234567890123）' };
  return { status, no: status === 'registered' ? no : null, seller: String(b.seller_name || '').trim().slice(0, 100) || null };
}

async function saveInvoice(id, req, env) {
  const b = await req.json().catch(() => ({}));
  const v = checkInvoice(b);
  if (v.error) return fail(v.error);
  await env.DB.prepare(`UPDATE items SET seller_name = ?, invoice_no = ?, invoice_status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(v.seller, v.no, v.status || null, id).run();
  return json({ ok: true, seller_name: v.seller, invoice_no: v.no, invoice_status: v.status || null });
}

async function getItem(id, env) {
  const r = await env.DB
    .prepare(`SELECT i.*, s.name AS supplier_name,
        CAST(COALESCE(julianday(i.sold_date), julianday('now', '+9 hours')) - julianday(i.purchase_date) AS INTEGER) AS days
      FROM items i JOIN suppliers s ON s.code = i.supplier_code WHERE i.id = ?`)
    .bind(id)
    .first();
  if (!r) return fail('見つかりません', 404);
  const { results: photos } = await env.DB.prepare(`SELECT p.drive_id, p.position, f.date_label, f.number, f.drive_id AS folder_id
      FROM photos p JOIN photo_folders f ON f.drive_id = p.folder_id
      WHERE p.item_id = ? ORDER BY f.shoot_date, p.position`).bind(id).all();
  const sale = await env.DB.prepare('SELECT * FROM sales WHERE item_id = ?').bind(id).first();
  return json({ ...parseItem(r), photos, sale: sale || null });
}

// 画面のファイル（public/ の中身。Workerの中に入れてある）
const decoded = new Map();
function serveStatic(pathname) {
  const path = pathname === '/' ? '/index.html' : pathname;
  const f = STATIC[path] || (!/\.[a-z]+$/.test(path) ? STATIC['/index.html'] : null);
  if (!f) return new Response('見つかりません', { status: 404 });
  if (!decoded.has(path)) decoded.set(path, Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)));
  return new Response(decoded.get(path), {
    headers: { 'content-type': f.type, 'cache-control': path.endsWith('.html') ? 'no-cache' : 'public, max-age=300' },
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const { pathname } = url;
    const m = req.method;

    if (pathname.startsWith('/api/')) {
      try {
        const au = await handleAuth(req, env, url);
        if (au) return au;
        // 自宅PCのプログラムは合言葉で入る（下書き用の画像の取得も含む）
        const agentPaths = /^\/api\/(agent\/|items\/\d+\/thumb$|photos\/img\/)/.test(pathname);
        if (!(agentPaths && agentAuthorized(req, env)) && !pathname.startsWith('/api/agent/') && !(await isLoggedIn(req, env))) {
          return fail('ログインしてください', 401);
        }
        env = await withConfig(env);
        if (pathname === '/api/sales/gmail-check' && m === 'POST') {
          try { return json(await checkGmail(env)); } catch (e) { return fail(e.message, 502); }
        }
        const cf = await handleConfig(req, env, url);
        if (cf) return cf;
        const sr = await handleSales(req, env, url);
        if (sr) return sr;
        const lg = await handleLegacy(req, env, url);
        if (lg) return lg;
        const ar = await handleAgent(req, env, url);
        if (ar) return ar;
        const dr = /^\/api\/items\/(\d+)\/drafts\/reset$/.exec(pathname);
        if (m === 'POST' && dr) return await resetDraft(Number(dr[1]), (await req.json().catch(() => ({}))).platform, env);
        const lr = await handleListings(req, env, url);
        if (lr) return lr;
        if (pathname.startsWith('/api/photos/')) {
          const res = await handlePhotos(req, env, url, ctx);
          if (res) return res;
        }
        if (m === 'POST' && pathname === '/api/import/preview') return await importPreview(req, env);
        if (m === 'POST' && pathname === '/api/import/commit') return await importCommit(req, env);
        if (m === 'GET' && pathname === '/api/items') return await listItems(url, env);
        const im = /^\/api\/items\/(\d+)$/.exec(pathname);
        if (m === 'GET' && im) return await getItem(Number(im[1]), env);
        const vm = /^\/api\/items\/(\d+)\/invoice$/.exec(pathname);
        if (m === 'PUT' && vm) return await saveInvoice(Number(vm[1]), req, env);
        const tm = /^\/api\/items\/(\d+)\/thumb$/.exec(pathname);
        if (m === 'POST' && tm) return await saveThumb(Number(tm[1]), req, env);
        if (m === 'GET' && tm) return await getThumb(Number(tm[1]), url, env);
        if (m === 'GET' && pathname === '/api/suppliers') {
          const { results } = await env.DB.prepare('SELECT * FROM suppliers ORDER BY rowid').all();
          return json(results);
        }
        return fail('見つかりません', 404);
      } catch (e) {
        return fail(`サーバーのエラー：${e.message}`, 500);
      }
    }
    return serveStatic(pathname);
  },

  // 1時間ごとにドライブを確認して、新しい写真フォルダを取り込む
  async scheduled(event, env, ctx) {
    env = await withConfig(env);
    ctx.waitUntil(syncDrive(env).catch((e) => console.error('写真の取り込みに失敗', e.message)));
    ctx.waitUntil(checkGmail(env).catch((e) => console.error('Gmailの確認に失敗', e.message)));
  },
};
