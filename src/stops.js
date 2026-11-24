// 売れた商品の、ほかのフリマの出品を止める
//  ・売れた時：止める作業を作り、アプリの一番上に出す（手で止めて「止めた」を押す）
//  ・PCを起動した時：出品中の一覧に「売れた商品」が残っていないか確かめ、残っていれば止める

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

export const STOP_PLATFORMS = ['メルカリ', 'ラクマ', 'ヤフーフリマ'];
const alias = (p) => (p === 'ペイペイフリマ' ? 'ヤフーフリマ' : p);

const itemUrl = (platform, id) => !id ? null
  : platform === 'メルカリ' ? `https://jp.mercari.com/item/${id}`
  : platform === 'ラクマ' ? `https://item.fril.jp/${id}`
  : platform === 'ヤフーフリマ' ? `https://paypayfleamarket.yahoo.co.jp/item/${id}` : null;

// 売れた時に呼ぶ：売れたフリマ以外の2つに、止める作業を作る
export async function createStopTasks(env, itemId, soldPlatform) {
  const sold = alias(soldPlatform);
  const { results: known } = await env.DB.prepare(`SELECT platform, external_id, url FROM platform_listings
      WHERE item_id = ? AND status = 'active'`).bind(itemId).all();
  const byPlatform = Object.fromEntries(known.map((k) => [k.platform, k]));
  const stmts = [];
  for (const p of STOP_PLATFORMS) {
    if (p === sold) continue;
    const k = byPlatform[p];
    stmts.push(env.DB.prepare(`INSERT INTO stop_tasks (item_id, platform, external_id, url, source)
        VALUES (?, ?, ?, ?, 'sold') ON CONFLICT(item_id, platform) DO NOTHING`)
      .bind(itemId, p, k?.external_id ?? null, k?.url || itemUrl(p, k?.external_id)));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export async function removeStopTasks(env, itemId) {
  await env.DB.prepare("DELETE FROM stop_tasks WHERE item_id = ? AND status = 'pending'").bind(itemId).run();
}

// PCが出品中の一覧を送った時：売れた商品がまだ出品中なら、止める作業にする
export async function staleListings(env, platform, externalIds) {
  if (!externalIds.length) return [];
  // 売れたフリマの出品（取引中）は止めない。ほかのフリマの出品だけ
  const { results: all } = await env.DB.prepare(`SELECT pl.external_id, pl.url, i.id AS item_id, i.mgmt_no, s.platform AS sold_platform
      FROM platform_listings pl JOIN items i ON i.id = pl.item_id LEFT JOIN sales s ON s.item_id = i.id
      WHERE pl.platform = ? AND i.status = 'sold' AND pl.external_id IN (${externalIds.map(() => '?').join(',')})`)
    .bind(platform, ...externalIds).all();
  const results = all.filter((r) => alias(r.sold_platform || '') !== platform);
  if (results.length) {
    await env.DB.batch(results.map((r) => env.DB.prepare(`INSERT INTO stop_tasks (item_id, platform, external_id, url, source, status)
        VALUES (?, ?, ?, ?, 'pc_check', 'pending')
        ON CONFLICT(item_id, platform) DO UPDATE SET external_id = excluded.external_id, url = COALESCE(excluded.url, stop_tasks.url),
          status = 'pending', message = 'PCのチェックで、まだ出品中でした'`)
      .bind(r.item_id, platform, r.external_id, r.url || itemUrl(platform, r.external_id))));
  }
  return results.map((r) => ({ ...r, url: r.url || itemUrl(platform, r.external_id) }));
}

/* ---------- アプリの画面（ログインが必要） ---------- */
async function list(env) {
  const { results } = await env.DB.prepare(`SELECT t.*, i.mgmt_no, i.brand, i.name, s.platform AS sold_platform, s.sold_date
      FROM stop_tasks t JOIN items i ON i.id = t.item_id LEFT JOIN sales s ON s.item_id = t.item_id
      WHERE t.status = 'pending' ORDER BY t.created_at DESC, t.item_id`).all();
  return json({ tasks: results });
}

async function act(id, req, env) {
  const b = await req.json().catch(() => ({}));
  const status = b.action === 'not_listed' ? 'not_listed' : 'done';
  await env.DB.prepare("UPDATE stop_tasks SET status = ?, done_at = datetime('now'), message = ? WHERE id = ?")
    .bind(status, status === 'done' ? '手で止めた' : '出品していなかった', id).run();
  // 止めた出品は、値下げの対象からも外す
  const t = await env.DB.prepare('SELECT platform, external_id FROM stop_tasks WHERE id = ?').bind(id).first();
  if (t?.external_id) await env.DB.prepare("UPDATE platform_listings SET status = 'gone' WHERE platform = ? AND external_id = ?").bind(t.platform, t.external_id).run();
  return json({ ok: true });
}

export async function handleStops(req, env, url) {
  if (url.pathname === '/api/stops' && req.method === 'GET') return list(env);
  const m = /^\/api\/stops\/(\d+)$/.exec(url.pathname);
  if (m && req.method === 'POST') return act(Number(m[1]), req, env);
  return null;
}

/* ---------- 自宅PCのプログラム用（合言葉が必要） ---------- */
export async function handleStopAgent(req, env, url) {
  if (url.pathname === '/api/agent/stops' && req.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT t.id, t.platform, t.external_id, t.url, i.mgmt_no FROM stop_tasks t
        JOIN items i ON i.id = t.item_id WHERE t.status = 'pending' AND t.external_id IS NOT NULL`).all();
    return json({ tasks: results });
  }
  if (url.pathname === '/api/agent/stop-result' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!STOP_PLATFORMS.includes(b.platform) || !b.external_id) return fail('内容が正しくありません');
    if (b.ok) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE stop_tasks SET status = 'done', done_at = datetime('now'), message = ? WHERE platform = ? AND external_id = ? AND status = 'pending'`)
          .bind(String(b.message || 'PCが止めた').slice(0, 200), b.platform, b.external_id),
        env.DB.prepare("UPDATE platform_listings SET status = 'gone' WHERE platform = ? AND external_id = ?").bind(b.platform, b.external_id),
      ]);
    } else {
      await env.DB.prepare(`UPDATE stop_tasks SET message = ? WHERE platform = ? AND external_id = ? AND status = 'pending'`)
        .bind(`PCで止められませんでした：${String(b.message || '').slice(0, 180)}`, b.platform, b.external_id).run();
    }
    return json({ ok: true });
  }
  return null;
}
