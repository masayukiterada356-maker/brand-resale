// 自宅PCのプログラム（agent/）とのやり取り
// 合言葉：ヘッダー x-agent-token ＝ Workerのシークレット AGENT_TOKEN

import { PRICE_OFFSET, SHIPPING } from './listing-config.js';
import { handlePriceAgent } from './prices.js';

const PLATFORMS = ['mercari', 'rakuma', 'yahoo'];
const MAX_PHOTOS = { mercari: 20, rakuma: 20, yahoo: 10 };
const MAX_ATTEMPTS = 3;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

export function agentAuthorized(req, env) {
  const t = req.headers.get('x-agent-token') || '';
  return !!env.AGENT_TOKEN && t.length === env.AGENT_TOKEN.length && t === env.AGENT_TOKEN;
}

// 下書きを作る商品：出品文が確認済みで、まだ下書きができていないフリマがあるもの
async function queue(url, env) {
  const limit = Math.min(Number(url.searchParams.get('limit')) || 5, 20);
  const { results } = await env.DB.prepare(`SELECT i.id, i.mgmt_no, i.brand, i.thumb_version, i.thumb_photo_id,
        l.title, l.description, l.condition, l.target, l.category, l.price,
        (SELECT group_concat(d.platform || ':' || d.status || ':' || d.attempts) FROM listing_drafts d WHERE d.item_id = i.id) AS done
      FROM items i JOIN listings l ON l.item_id = i.id
      WHERE l.ready = 1 AND i.status = 'in_stock' AND l.price IS NOT NULL
      ORDER BY l.updated_at
      LIMIT 200`).all();

  const out = [];
  for (const r of results) {
    const state = Object.fromEntries((r.done || '').split(',').filter(Boolean).map((x) => {
      const [p, s, a] = x.split(':'); return [p, { status: s, attempts: Number(a) }];
    }));
    const todo = PLATFORMS.filter((p) => !state[p] || (state[p].status === 'error' && state[p].attempts < MAX_ATTEMPTS));
    if (!todo.length) continue;

    const { results: photos } = await env.DB
      .prepare('SELECT drive_id FROM photos WHERE item_id = ? ORDER BY position').bind(r.id).all();
    if (!photos.length || !r.thumb_version) continue; // 写真とサムネイルがそろってから

    // 1枚目は黄色い枠のサムネイル、その後に残りの写真（サムネイルに使った写真は除く）
    const images = [
      { name: `${r.mgmt_no}_00.jpg`, path: `/api/items/${r.id}/thumb?v=${r.thumb_version}` },
      ...photos.filter((p) => p.drive_id !== r.thumb_photo_id).map((p, i) => ({
        name: `${r.mgmt_no}_${String(i + 1).padStart(2, '0')}.jpg`, path: `/api/photos/img/${p.drive_id}?s=2000`,
      })),
    ];

    out.push({
      item_id: r.id,
      mgmt_no: r.mgmt_no,
      brand: r.brand,
      title: r.title,
      description: r.description,
      condition: r.condition,
      category: [r.target || 'レディース', ...String(r.category || '').split('/').map((s) => s.trim()).filter(Boolean)],
      platforms: todo.map((p) => ({
        platform: p,
        price: Math.max(r.price + PRICE_OFFSET[p], 300),
        shipping: SHIPPING[p],
        max_photos: MAX_PHOTOS[p],
      })),
      images,
    });
    if (out.length >= limit) break;
  }
  return json({ items: out });
}

async function result(req, env) {
  const b = await req.json().catch(() => null);
  if (!b || !PLATFORMS.includes(b.platform) || !Number(b.item_id)) return fail('内容が正しくありません');
  const status = b.ok ? 'drafted' : 'error';
  await env.DB.prepare(`INSERT INTO listing_drafts (item_id, platform, status, message, attempts, updated_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(item_id, platform) DO UPDATE SET status = excluded.status, message = excluded.message,
        attempts = listing_drafts.attempts + 1, updated_at = excluded.updated_at`)
    .bind(Number(b.item_id), b.platform, status, String(b.message || '').slice(0, 500)).run();
  return json({ ok: true });
}

// アプリの画面から：下書きをやり直す（記録を消す）
export async function resetDraft(itemId, platform, env) {
  if (platform && !PLATFORMS.includes(platform)) return fail('フリマの名前が正しくありません');
  if (platform) await env.DB.prepare('DELETE FROM listing_drafts WHERE item_id = ? AND platform = ?').bind(itemId, platform).run();
  else await env.DB.prepare('DELETE FROM listing_drafts WHERE item_id = ?').bind(itemId).run();
  return json({ ok: true });
}

export async function handleAgent(req, env, url) {
  if (!url.pathname.startsWith('/api/agent/')) return null;
  if (!agentAuthorized(req, env)) return fail('合言葉が違います', 401);
  if (req.method === 'GET' && url.pathname === '/api/agent/queue') return queue(url, env);
  if (req.method === 'POST' && url.pathname === '/api/agent/result') return result(req, env);
  if (req.method === 'GET' && url.pathname === '/api/agent/ping') return json({ ok: true });
  const pr = await handlePriceAgent(req, env, url);
  if (pr) return pr;
  return fail('見つかりません', 404);
}
