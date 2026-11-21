// 出品文（Geminiで作る・MASAが直す）と、写真の自動振り分け

import { driveFor } from './drive.js';
import { generateListing, buildDescription, imagePart, matchFolder, CONDITIONS } from './gemini.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

// 商品の写真を最大 n 枚、Geminiに渡せる形で集める（外注さんの写真→なければ仕入れ先の写真）
async function itemImages(env, item, n) {
  const { results: photos } = await env.DB
    .prepare('SELECT drive_id FROM photos WHERE item_id = ? ORDER BY position LIMIT ?').bind(item.id, n).all();
  const drive = photos.length ? driveFor(env) : null;
  const loaders = photos.length
    ? photos.map((p) => () => drive.image(p.drive_id, 768))
    : JSON.parse(item.supplier_images_json || '[]').slice(0, n).map((u) => async () => {
      const r = await fetch(u);
      return { body: await r.arrayBuffer(), type: r.headers.get('content-type') || 'image/jpeg' };
    });
  const out = [];
  for (const load of loaders) {
    try { out.push(await imagePart(load)); } catch { /* 読めない写真は飛ばす */ }
  }
  return out.filter(Boolean);
}

async function getListing(itemId, env) {
  const l = await env.DB.prepare('SELECT * FROM listings WHERE item_id = ?').bind(itemId).first();
  if (!l) return json({ listing: null });
  delete l.ai_raw;
  return json({ listing: l });
}

async function generate(itemId, env) {
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return fail('商品が見つかりません', 404);
  item.details = JSON.parse(item.details_json || '{}');

  const images = await itemImages(env, item, 4);
  let ai;
  try { ai = await generateListing(env, item, images); } catch (e) { return fail(e.message, 502); }

  const condition = CONDITIONS.includes(ai.condition) ? ai.condition : '目立った傷や汚れなし';
  const description = buildDescription(ai, item.mgmt_no);
  const prev = await env.DB.prepare('SELECT price FROM listings WHERE item_id = ?').bind(itemId).first();

  await env.DB.prepare(`INSERT INTO listings
      (item_id, title, rank_label, condition, category, description, ai_price, ai_price_reason, price, ai_raw, ready, generated_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      ON CONFLICT(item_id) DO UPDATE SET
        title = excluded.title, rank_label = excluded.rank_label, condition = excluded.condition,
        category = excluded.category, description = excluded.description, ai_price = excluded.ai_price,
        ai_price_reason = excluded.ai_price_reason, ai_raw = excluded.ai_raw, ready = 0,
        generated_at = excluded.generated_at, updated_at = excluded.updated_at`)
    .bind(itemId, ai.title, ai.rank_label, condition, ai.category, description,
      Number(ai.price) || null, ai.price_reason || '', prev?.price ?? (Number(ai.price) || null),
      JSON.stringify(ai), )
    .run();
  return getListing(itemId, env);
}

async function save(itemId, req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return fail('内容が届いていません');
  const cur = await env.DB.prepare('SELECT item_id FROM listings WHERE item_id = ?').bind(itemId).first();
  if (!cur) return fail('先に出品文を作ってください');
  const title = String(b.title || '').trim();
  if (!title) return fail('タイトルが空です');
  if (title.length > 40) return fail(`タイトルが${title.length}文字です（40文字まで）`);
  if (!CONDITIONS.includes(b.condition)) return fail('商品の状態を選んでください');
  const price = b.price === '' || b.price == null ? null : Math.trunc(Number(b.price));
  if (price != null && (!Number.isFinite(price) || price < 300 || price > 9999999)) return fail('価格が正しくありません');
  if (b.ready && !price) return fail('価格を入れてください');
  await env.DB.prepare(`UPDATE listings SET title = ?, condition = ?, description = ?, price = ?, ready = ?,
      updated_at = datetime('now') WHERE item_id = ?`)
    .bind(title, b.condition, String(b.description || ''), price, b.ready ? 1 : 0, itemId).run();
  return getListing(itemId, env);
}

/* ---------- 写真の自動振り分け ---------- */
async function suggest(folderId, env) {
  const folder = await env.DB.prepare('SELECT * FROM photo_folders WHERE drive_id = ?').bind(folderId).first();
  if (!folder) return fail('見つかりません', 404);
  const { results: candidates } = await env.DB.prepare(`SELECT i.id, i.mgmt_no, i.brand, i.category, i.name, i.model, i.notes, i.accessories
      FROM items i
      WHERE i.status = 'in_stock' AND i.purchase_date <= ?
        AND NOT EXISTS (SELECT 1 FROM photo_folders f WHERE f.item_id = i.id)
      ORDER BY i.purchase_date DESC LIMIT 60`).bind(folder.shoot_date).all();
  if (!candidates.length) return fail('写真のない在庫がありません');

  const { results: photos } = await env.DB
    .prepare('SELECT drive_id FROM photos WHERE folder_id = ? ORDER BY position LIMIT 3').bind(folderId).all();
  const drive = driveFor(env);
  const images = [];
  for (const p of photos) {
    try { images.push(await imagePart(() => drive.image(p.drive_id, 640))); } catch { /* 飛ばす */ }
  }

  let ai;
  try { ai = await matchFolder(env, candidates, images); } catch (e) { return fail(e.message, 502); }
  const hit = candidates.find((c) => c.mgmt_no === ai.mgmt_no) || null;
  await env.DB.prepare('UPDATE photo_folders SET ai_item_id = ?, ai_confidence = ?, ai_reason = ? WHERE drive_id = ?')
    .bind(hit?.id ?? null, hit ? Number(ai.confidence) || 0 : 0, ai.reason || '', folderId).run();
  return json({ item_id: hit?.id ?? null, mgmt_no: hit?.mgmt_no ?? null, confidence: ai.confidence, reason: ai.reason });
}

export async function handleListings(req, env, url) {
  const { pathname } = url;
  const m = req.method;
  let r = /^\/api\/items\/(\d+)\/listing$/.exec(pathname);
  if (r && m === 'GET') return getListing(Number(r[1]), env);
  if (r && m === 'PUT') return save(Number(r[1]), req, env);
  r = /^\/api\/items\/(\d+)\/listing\/generate$/.exec(pathname);
  if (r && m === 'POST') return generate(Number(r[1]), env);
  r = /^\/api\/photos\/folders\/([\w-]+)\/suggest$/.exec(pathname);
  if (r && m === 'POST') return suggest(r[1], env);
  return null;
}
