// Cloudflare Worker：/api/* はここで処理し、それ以外は public/ の画面を返す

import { buildPreview } from './import.js';
import { handlePhotos, syncDrive } from './photos.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

async function loadExisting(db, supplierCode) {
  const { results } = await db
    .prepare('SELECT mgmt_no, supplier_code, supplier_ref FROM items')
    .all();
  return {
    mgmtNos: new Set(results.map((r) => r.mgmt_no)),
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
      r.mgmt_no, preview.supplier_code, r.supplier_ref, batch.id, preview.purchase_date,
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
  const status = url.searchParams.get('status') || '';
  const where = [];
  const args = [];
  if (status) { where.push('i.status = ?'); args.push(status); }
  if (q) {
    where.push('(i.mgmt_no LIKE ? OR i.brand LIKE ? OR i.name LIKE ? OR i.category LIKE ? OR i.model LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like, like);
  }
  const sql = `SELECT i.id, i.mgmt_no, i.supplier_code, s.name AS supplier_name, i.purchase_date,
      i.brand, i.category, i.name, i.model, i.rank, i.cost, i.status, i.supplier_images_json,
      COALESCE(i.thumb_photo_id, (SELECT p.drive_id FROM photos p WHERE p.item_id = i.id ORDER BY p.folder_id, p.position LIMIT 1)) AS photo_id,
      CAST(julianday('now', '+9 hours') - julianday(i.purchase_date) AS INTEGER) AS days
    FROM items i JOIN suppliers s ON s.code = i.supplier_code
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY i.purchase_date DESC, i.id DESC LIMIT 500`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const items = results.map((r) => {
    const imgs = JSON.parse(r.supplier_images_json || '[]');
    delete r.supplier_images_json;
    const thumb = r.photo_id ? `/api/photos/img/${r.photo_id}?s=200` : imgs[0] || null;
    return { ...r, thumb };
  });
  const totals = await env.DB
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(cost),0) AS cost FROM items WHERE status = 'in_stock'")
    .first();
  return json({ items, totals });
}

async function getItem(id, env) {
  const r = await env.DB
    .prepare(`SELECT i.*, s.name AS supplier_name,
        CAST(julianday('now', '+9 hours') - julianday(i.purchase_date) AS INTEGER) AS days
      FROM items i JOIN suppliers s ON s.code = i.supplier_code WHERE i.id = ?`)
    .bind(id)
    .first();
  if (!r) return fail('見つかりません', 404);
  const { results: photos } = await env.DB.prepare(`SELECT p.drive_id, p.position, f.date_label, f.number, f.drive_id AS folder_id
      FROM photos p JOIN photo_folders f ON f.drive_id = p.folder_id
      WHERE p.item_id = ? ORDER BY f.shoot_date, p.position`).bind(id).all();
  return json({ ...parseItem(r), photos });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname } = url;
    const m = req.method;

    if (pathname.startsWith('/api/')) {
      try {
        if (pathname.startsWith('/api/photos/')) {
          const res = await handlePhotos(req, env, url);
          if (res) return res;
        }
        if (m === 'POST' && pathname === '/api/import/preview') return await importPreview(req, env);
        if (m === 'POST' && pathname === '/api/import/commit') return await importCommit(req, env);
        if (m === 'GET' && pathname === '/api/items') return await listItems(url, env);
        const im = /^\/api\/items\/(\d+)$/.exec(pathname);
        if (m === 'GET' && im) return await getItem(Number(im[1]), env);
        if (m === 'GET' && pathname === '/api/suppliers') {
          const { results } = await env.DB.prepare('SELECT * FROM suppliers ORDER BY rowid').all();
          return json(results);
        }
        return fail('見つかりません', 404);
      } catch (e) {
        return fail(`サーバーのエラー：${e.message}`, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  // 1時間ごとにドライブを確認して、新しい写真フォルダを取り込む
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncDrive(env).catch((e) => console.error('写真の取り込みに失敗', e.message)));
  },
};
