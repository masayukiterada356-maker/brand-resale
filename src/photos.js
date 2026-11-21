// 写真の取り込み（ドライブ→データベース）と割り当て

import { driveFor, driveRoot } from './drive.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

// 日本時間の日付
const jstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const byNumber = (a, b) => (Number(a.name) - Number(b.name)) || a.name.localeCompare(b.name, 'ja');

/**
 * ドライブを確認して、新しい番号フォルダ・写真をデータベースに入れる。
 * すでにあるフォルダの割り当ては変えない。写真が後から増えた時は足す。
 */
export async function syncDrive(env) {
  const drive = driveFor(env);
  const root = driveRoot(env);
  if (!root) throw new Error('外注さんのフォルダ（DRIVE_ROOT_FOLDER_ID）が設定されていません');
  const since = env.PHOTO_SYNC_FROM || '2000-01-01';

  const dateFolders = (await drive.listChildren([root], { folders: true }))
    .filter((d) => jstDate(d.createdTime) >= since);
  if (!dateFolders.length) return { folders: 0, new_folders: 0, new_photos: 0 };
  const dateById = new Map(dateFolders.map((d) => [d.id, d]));

  const itemFolders = await drive.listChildren(dateFolders.map((d) => d.id), { folders: true });
  const files = itemFolders.length
    ? await drive.listChildren(itemFolders.map((f) => f.id), { folders: false })
    : [];

  const filesByFolder = new Map();
  for (const f of files) {
    if (!filesByFolder.has(f.parent)) filesByFolder.set(f.parent, []);
    filesByFolder.get(f.parent).push(f);
  }

  const { results: known } = await env.DB.prepare('SELECT drive_id, item_id FROM photo_folders').all();
  const knownFolders = new Map(known.map((r) => [r.drive_id, r]));
  const { results: knownP } = await env.DB.prepare('SELECT drive_id FROM photos').all();
  const knownPhotos = new Set(knownP.map((r) => r.drive_id));

  const stmts = [];
  let newFolders = 0;
  let newPhotos = 0;

  for (const f of itemFolders.sort(byNumber)) {
    const date = dateById.get(f.parent);
    const photos = (filesByFolder.get(f.id) || [])
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const prev = knownFolders.get(f.id);

    if (!prev) {
      newFolders++;
      stmts.push(env.DB.prepare(`INSERT INTO photo_folders
          (drive_id, date_folder_id, date_label, number, shoot_date, photo_count, first_photo_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(f.id, date.id, date.name, f.name, jstDate(date.createdTime), photos.length, photos[0]?.id || null));
    } else {
      stmts.push(env.DB.prepare('UPDATE photo_folders SET photo_count = ?, first_photo_id = ?, number = ?, date_label = ? WHERE drive_id = ?')
        .bind(photos.length, photos[0]?.id || null, f.name, date.name, f.id));
    }

    photos.forEach((p, i) => {
      if (knownPhotos.has(p.id)) {
        stmts.push(env.DB.prepare('UPDATE photos SET position = ?, name = ? WHERE drive_id = ?').bind(i + 1, p.name, p.id));
      } else {
        newPhotos++;
        stmts.push(env.DB.prepare('INSERT INTO photos (drive_id, folder_id, item_id, name, position) VALUES (?, ?, ?, ?, ?)')
          .bind(p.id, f.id, prev?.item_id ?? null, p.name, i + 1));
      }
    });
  }

  stmts.push(env.DB.prepare("INSERT INTO settings (key, value) VALUES ('photo_synced_at', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value"));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  return { folders: itemFolders.length, new_folders: newFolders, new_photos: newPhotos };
}

/* ---------- API ---------- */

async function listFolders(url, env) {
  const status = url.searchParams.get('status') || 'unassigned';
  const where = status === 'all' ? '' : 'WHERE f.status = ?';
  const stmt = env.DB.prepare(`SELECT f.drive_id, f.date_label, f.number, f.shoot_date, f.status,
        f.photo_count, f.first_photo_id, f.item_id, i.mgmt_no, i.brand
      FROM photo_folders f LEFT JOIN items i ON i.id = f.item_id
      ${where}
      ORDER BY f.shoot_date DESC, f.date_folder_id, CAST(f.number AS INTEGER), f.number`);
  const { results } = await (status === 'all' ? stmt : stmt.bind(status)).all();
  const counts = await env.DB.prepare(`SELECT
      SUM(status = 'unassigned') AS unassigned, SUM(status = 'assigned') AS assigned, SUM(status = 'ignored') AS ignored
      FROM photo_folders`).first();
  const synced = await env.DB.prepare("SELECT value FROM settings WHERE key = 'photo_synced_at'").first();
  return json({ folders: results, counts, synced_at: synced?.value || null });
}

async function getFolder(id, env) {
  const folder = await env.DB.prepare(`SELECT f.*, i.mgmt_no FROM photo_folders f
      LEFT JOIN items i ON i.id = f.item_id WHERE f.drive_id = ?`).bind(id).first();
  if (!folder) return fail('見つかりません', 404);
  const { results: photos } = await env.DB
    .prepare('SELECT drive_id, name, position FROM photos WHERE folder_id = ? ORDER BY position').bind(id).all();

  // 候補：まだ写真が割り当てられていない在庫。撮影日より前に仕入れたものを先に
  const { results: candidates } = await env.DB.prepare(`SELECT i.id, i.mgmt_no, i.brand, i.category, i.name, i.model,
        i.purchase_date, i.supplier_images_json,
        (i.purchase_date <= ?) AS before_shoot
      FROM items i
      WHERE i.status = 'in_stock'
        AND NOT EXISTS (SELECT 1 FROM photo_folders f WHERE f.item_id = i.id)
      ORDER BY before_shoot DESC, i.purchase_date DESC, i.id DESC
      LIMIT 300`).bind(folder.shoot_date).all();

  return json({
    folder,
    photos,
    candidates: candidates.map((c) => {
      const imgs = JSON.parse(c.supplier_images_json || '[]');
      delete c.supplier_images_json;
      return { ...c, supplier_thumb: imgs[0] || null };
    }),
  });
}

async function assignFolder(id, req, env) {
  const body = await req.json().catch(() => ({}));
  const folder = await env.DB.prepare('SELECT * FROM photo_folders WHERE drive_id = ?').bind(id).first();
  if (!folder) return fail('見つかりません', 404);

  if (body.unassign || body.ignore) {
    await env.DB.batch([
      env.DB.prepare("UPDATE photo_folders SET status = ?, item_id = NULL, assigned_at = NULL WHERE drive_id = ?")
        .bind(body.ignore ? 'ignored' : 'unassigned', id),
      env.DB.prepare('UPDATE photos SET item_id = NULL WHERE folder_id = ?').bind(id),
      ...(folder.item_id ? [env.DB.prepare(`UPDATE items SET thumb_photo_id = NULL, updated_at = datetime('now')
          WHERE id = ? AND thumb_photo_id IN (SELECT drive_id FROM photos WHERE folder_id = ?)`).bind(folder.item_id, id)] : []),
    ]);
    return json({ ok: true });
  }

  const itemId = Number(body.item_id);
  const item = await env.DB.prepare('SELECT id, mgmt_no FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return fail('商品が見つかりません');
  const other = await env.DB.prepare('SELECT date_label, number FROM photo_folders WHERE item_id = ? AND drive_id != ?')
    .bind(itemId, id).first();
  if (other && !body.force) {
    return fail(`${item.mgmt_no} にはすでに ${other.date_label} の ${other.number} 番の写真が割り当てられています`, 409);
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE photo_folders SET status = 'assigned', item_id = ?, assigned_at = datetime('now') WHERE drive_id = ?")
      .bind(itemId, id),
    env.DB.prepare('UPDATE photos SET item_id = ? WHERE folder_id = ?').bind(itemId, id),
  ]);
  return json({ ok: true, mgmt_no: item.mgmt_no });
}

// 写真を小さくして返す。一度読んだらR2に置いておき、次からはそこから返す
async function photoImage(fileId, url, env) {
  const size = Math.min(Math.max(Number(url.searchParams.get('s')) || 400, 100), 1600);
  const known = await env.DB.prepare('SELECT 1 FROM photos WHERE drive_id = ?').bind(fileId).first();
  if (!known) return fail('見つかりません', 404);

  const key = `drive-cache/${fileId}_s${size}`;
  const headers = { 'cache-control': 'private, max-age=604800' };
  const hit = env.PHOTOS ? await env.PHOTOS.get(key) : null;
  if (hit) return new Response(hit.body, { headers: { ...headers, 'content-type': hit.httpMetadata?.contentType || 'image/jpeg' } });

  const img = await driveFor(env).image(fileId, size);
  if (env.PHOTOS) await env.PHOTOS.put(key, img.body, { httpMetadata: { contentType: img.type } });
  return new Response(img.body, { headers: { ...headers, 'content-type': img.type } });
}

export async function handlePhotos(req, env, url) {
  const { pathname } = url;
  const m = req.method;
  if (m === 'POST' && pathname === '/api/photos/sync') {
    try { return json(await syncDrive(env)); } catch (e) { return fail(e.message, 502); }
  }
  if (m === 'GET' && pathname === '/api/photos/folders') return listFolders(url, env);
  let r = /^\/api\/photos\/folders\/([\w-]+)$/.exec(pathname);
  if (m === 'GET' && r) return getFolder(r[1], env);
  r = /^\/api\/photos\/folders\/([\w-]+)\/assign$/.exec(pathname);
  if (m === 'POST' && r) return assignFolder(r[1], req, env);
  r = /^\/api\/photos\/img\/([\w-]+)$/.exec(pathname);
  if (m === 'GET' && r) {
    try { return await photoImage(r[1], url, env); } catch (e) { return fail(e.message, 502); }
  }
  return null;
}
