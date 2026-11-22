// 毎晩の値下げ（自宅PCのプログラムと一緒に動く）
//  1. PCが各フリマの「出品中」の一覧を読んで送る → 在庫の商品と結び付ける
//  2. PCが「今夜の値下げ計画」をもらう：100円下げる。損益分岐点を下回るものは下げない
//  3. PCが1件ずつ価格を変えて、結果を送る

import { breakEven } from './sales.js';
import { score } from './match.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

export const STEP = 100; // 1回の値下げ幅
const PLATFORMS = ['メルカリ', 'ラクマ', 'ヤフーフリマ'];
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const AUTO_LINK_SCORE = 8;   // この点数以上で、2番目と差があれば自動で結び付ける
const AUTO_LINK_GAP = 4;

async function candidatesFor(env, platform, title, price) {
  const { results } = await env.DB.prepare(`SELECT i.id, i.brand, i.name, i.category, i.model, i.channel, i.start_price,
        l.title AS listing_title
      FROM items i LEFT JOIN listings l ON l.item_id = i.id
      WHERE i.status != 'sold'
        AND NOT EXISTS (SELECT 1 FROM platform_listings pl WHERE pl.item_id = i.id AND pl.platform = ? AND pl.status = 'active')`)
    .bind(platform).all();
  const ev = { platform, title, price };
  return results.map((it) => ({ id: it.id, score: score(ev, it), exact: it.listing_title === title }))
    .filter((c) => c.score > 0 || c.exact).sort((a, b) => (b.exact - a.exact) || (b.score - a.score)).slice(0, 5);
}

// 1. 出品中の一覧を受け取る
async function receiveListings(req, env) {
  const b = await req.json().catch(() => null);
  if (!b || !PLATFORMS.includes(b.platform) || !Array.isArray(b.listings)) return fail('内容が正しくありません');
  const platform = b.platform;
  const seen = new Set();
  let linked = 0;
  let unlinked = 0;
  for (const l of b.listings.slice(0, 1000)) {
    const id = String(l.external_id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const price = Number.isFinite(Number(l.price)) ? Math.round(Number(l.price)) : null;
    const cur = await env.DB.prepare('SELECT item_id FROM platform_listings WHERE platform = ? AND external_id = ?').bind(platform, id).first();
    let itemId = cur?.item_id ?? null;
    let cands = null;
    if (!itemId) {
      // 売れた通知などで結び付いている商品ID
      const known = await env.DB.prepare('SELECT item_id FROM platform_items WHERE platform = ? AND external_id = ?').bind(platform, id).first();
      if (known) itemId = known.item_id;
    }
    if (!itemId) {
      const c = await candidatesFor(env, platform, l.title, price);
      if (c[0] && (c[0].exact || (c[0].score >= AUTO_LINK_SCORE && c[0].score - (c[1]?.score ?? 0) >= AUTO_LINK_GAP))) itemId = c[0].id;
      else cands = c;
    }
    await env.DB.prepare(`INSERT INTO platform_listings (platform, external_id, item_id, title, price, url, status, candidates_json, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'))
        ON CONFLICT(platform, external_id) DO UPDATE SET item_id = COALESCE(platform_listings.item_id, excluded.item_id),
          title = excluded.title, price = excluded.price, url = excluded.url, status = 'active',
          candidates_json = excluded.candidates_json, last_seen_at = excluded.last_seen_at`)
      .bind(platform, id, itemId, String(l.title || '').slice(0, 200), price, String(l.url || '').slice(0, 300), cands ? JSON.stringify(cands) : null).run();
    if (itemId) {
      linked++;
      await env.DB.prepare('INSERT OR IGNORE INTO platform_items (platform, external_id, item_id) VALUES (?, ?, ?)').bind(platform, id, itemId).run();
    } else unlinked++;
  }
  // 一覧になかったもの＝売れた・止めた・消した
  if (b.complete && seen.size) {
    const ids = [...seen];
    await env.DB.prepare(`UPDATE platform_listings SET status = 'gone' WHERE platform = ? AND status = 'active'
        AND external_id NOT IN (${ids.map(() => '?').join(',')})`).bind(platform, ...ids).run();
  }
  return json({ ok: true, received: seen.size, linked, unlinked });
}

// 1日に値下げする件数（フリマごと）
export const DAILY = { 'メルカリ': 50, 'ラクマ': 50, 'ヤフーフリマ': 50 };

// 今日（日本時間）すでに値下げした件数
export async function doneToday(env) {
  const { results } = await env.DB.prepare(`SELECT platform, COUNT(*) AS n FROM price_drops
      WHERE status IN ('done', 'changed') AND date(created_at, '+9 hours') = ? GROUP BY platform`).bind(today()).all();
  return Object.fromEntries(PLATFORMS.map((p) => [p, results.find((r) => r.platform === p)?.n || 0]));
}

// 2. 今日の値下げ計画（フリマごと。1日の件数から、今日すでに下げた分を引いた数まで）
export async function buildPlan(env, limit = 80, platform = null) {
  const day = today();
  const done = await doneToday(env);
  const { results } = await env.DB.prepare(`SELECT pl.platform, pl.external_id, pl.price, pl.url, pl.last_drop_at, pl.item_id,
        i.cost, i.category, i.name, i.ship_type, i.mgmt_no, l.title AS listing_title
      FROM platform_listings pl JOIN items i ON i.id = pl.item_id LEFT JOIN listings l ON l.item_id = i.id
      WHERE pl.status = 'active' AND i.status != 'sold' AND pl.price IS NOT NULL
        AND (? IS NULL OR pl.platform = ?)
        AND (pl.last_drop_at IS NULL OR pl.last_drop_at < ?)`).bind(platform, platform, day).all();
  const plan = [];
  const floorHits = [];
  for (const r of results) {
    const floor = breakEven(r).platforms[r.platform]?.price ?? 0;
    const next = r.price - STEP;
    if (next < floor) { floorHits.push(r); continue; }
    plan.push({ platform: r.platform, external_id: r.external_id, url: r.url, mgmt_no: r.mgmt_no, current_price: r.price, new_price: next, floor, last_drop_at: r.last_drop_at });
  }
  if (floorHits.length) {
    await env.DB.batch(floorHits.map((r) => env.DB.prepare(`UPDATE platform_listings SET floor_hit_at = COALESCE(floor_hit_at, ?)
        WHERE platform = ? AND external_id = ?`).bind(day, r.platform, r.external_id)));
  }
  // 前に値下げした日が古いものを先に（同じ日の中はランダム）。フリマごとに今日の残りの件数まで
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  plan.sort((a, b) => (a.last_drop_at || '').localeCompare(b.last_drop_at || ''));
  const left = Object.fromEntries(PLATFORMS.map((p) => [p, Math.max(DAILY[p] - done[p], 0)]));
  const chosen = [];
  for (const it of plan) {
    if (chosen.length >= limit) break;
    if (left[it.platform] > 0) { chosen.push(it); left[it.platform]--; }
  }
  for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  return { date: day, step: STEP, daily: DAILY, done_today: done, total_candidates: plan.length, floor_hits: floorHits.length, items: chosen };
}

// 3. 1件ごとの結果
async function receiveResult(req, env) {
  const b = await req.json().catch(() => null);
  if (!b || !PLATFORMS.includes(b.platform) || !b.external_id) return fail('内容が正しくありません');
  const row = await env.DB.prepare('SELECT item_id, price FROM platform_listings WHERE platform = ? AND external_id = ?').bind(b.platform, b.external_id).first();
  if (!row) return fail('出品が見つかりません', 404);
  const status = ['done', 'error', 'changed'].includes(b.status) ? b.status : 'error';
  const stmts = [env.DB.prepare(`INSERT INTO price_drops (platform, external_id, item_id, old_price, new_price, status, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(b.platform, b.external_id, row.item_id, b.old_price ?? row.price, b.new_price ?? null, status, String(b.message || '').slice(0, 300))];
  if (status === 'done') {
    stmts.push(env.DB.prepare('UPDATE platform_listings SET price = ?, last_drop_at = ? WHERE platform = ? AND external_id = ?')
      .bind(Math.round(b.new_price), today(), b.platform, b.external_id));
  } else if (status === 'changed' && Number.isFinite(Number(b.seen_price))) {
    // 画面の価格がアプリの記録と違った（手で変えたなど）→ 画面の価格を覚え直す。今夜は下げない
    stmts.push(env.DB.prepare('UPDATE platform_listings SET price = ?, last_drop_at = ? WHERE platform = ? AND external_id = ?')
      .bind(Math.round(Number(b.seen_price)), today(), b.platform, b.external_id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

export async function handlePriceAgent(req, env, url) {
  if (url.pathname === '/api/agent/listings' && req.method === 'POST') return receiveListings(req, env);
  if (url.pathname === '/api/agent/price-plan' && req.method === 'GET') {
    const pf = url.searchParams.get('platform');
    return json(await buildPlan(env, Math.min(Number(url.searchParams.get('limit')) || 80, 300), PLATFORMS.includes(pf) ? pf : null));
  }
  if (url.pathname === '/api/agent/price-result' && req.method === 'POST') return receiveResult(req, env);
  return null;
}

/* ---------- アプリの画面用（ログインが必要） ---------- */

async function overview(env) {
  const { results: last } = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM price_drops
      WHERE created_at >= datetime('now', '-20 hours') GROUP BY status`).all();
  const counts = await env.DB.prepare(`SELECT
      SUM(status = 'active' AND item_id IS NOT NULL) AS linked,
      SUM(status = 'active' AND item_id IS NULL) AS unlinked,
      SUM(status = 'active' AND floor_hit_at IS NOT NULL) AS floor
    FROM platform_listings`).first();
  const { results: unlinked } = await env.DB.prepare(`SELECT platform, external_id, title, price, url, candidates_json
      FROM platform_listings WHERE status = 'active' AND item_id IS NULL ORDER BY last_seen_at DESC LIMIT 100`).all();
  const ids = [...new Set(unlinked.flatMap((u) => JSON.parse(u.candidates_json || '[]').map((c) => c.id)))];
  const items = ids.length ? (await env.DB.prepare(`SELECT id, mgmt_no, brand, name, cost, channel FROM items WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all()).results : [];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const { results: floor } = await env.DB.prepare(`SELECT pl.platform, pl.price, pl.floor_hit_at, i.id, i.mgmt_no, i.brand, i.name,
        CAST(julianday('now', '+9 hours') - julianday(i.purchase_date) AS INTEGER) AS days
      FROM platform_listings pl JOIN items i ON i.id = pl.item_id
      WHERE pl.status = 'active' AND pl.floor_hit_at IS NOT NULL AND i.status != 'sold' ORDER BY pl.floor_hit_at DESC LIMIT 100`).all();
  const { results: errors } = await env.DB.prepare(`SELECT d.platform, d.message, d.created_at, i.mgmt_no FROM price_drops d
      LEFT JOIN items i ON i.id = d.item_id WHERE d.status = 'error' AND d.created_at >= datetime('now', '-3 days') ORDER BY d.id DESC LIMIT 30`).all();
  const nowJst = new Date(Date.now() + 9 * 3600e3);
  return json({
    done_today: await doneToday(env),
    daily: DAILY,
    jst_hour: nowJst.getUTCHours(),
    last_night: Object.fromEntries(last.map((r) => [r.status, r.n])),
    counts,
    unlinked: unlinked.map((u) => ({ ...u, candidates: JSON.parse(u.candidates_json || '[]').map((c) => ({ ...byId[c.id], score: c.score })).filter((c) => c.id) })),
    floor,
    errors,
  });
}

async function link(req, env) {
  const b = await req.json().catch(() => ({}));
  if (!PLATFORMS.includes(b.platform) || !b.external_id) return fail('内容が正しくありません');
  if (b.ignore) {
    await env.DB.prepare("UPDATE platform_listings SET status = 'ignored' WHERE platform = ? AND external_id = ?").bind(b.platform, b.external_id).run();
    return json({ ok: true });
  }
  const itemId = Number(b.item_id);
  if (!itemId) return fail('商品を選んでください');
  await env.DB.batch([
    env.DB.prepare('UPDATE platform_listings SET item_id = ?, candidates_json = NULL WHERE platform = ? AND external_id = ?').bind(itemId, b.platform, b.external_id),
    env.DB.prepare('INSERT OR IGNORE INTO platform_items (platform, external_id, item_id) VALUES (?, ?, ?)').bind(b.platform, b.external_id, itemId),
  ]);
  return json({ ok: true });
}

// 手動の値下げ（PCが動いていなかった日のメルカリ）：今日の残りの一覧と、「下げた」の記録
async function manualList(env, platform) {
  const plan = await buildPlan(env, 300, platform);
  return json({ platform, done_today: plan.done_today[platform], daily: DAILY[platform], items: plan.items });
}
async function manualDone(req, env) {
  const b = await req.json().catch(() => ({}));
  if (!PLATFORMS.includes(b.platform) || !b.external_id) return fail('内容が正しくありません');
  const row = await env.DB.prepare(`SELECT pl.price, pl.item_id, pl.last_drop_at, i.cost, i.category, i.name, i.ship_type
      FROM platform_listings pl JOIN items i ON i.id = pl.item_id WHERE pl.platform = ? AND pl.external_id = ?`).bind(b.platform, b.external_id).first();
  if (!row) return fail('出品が見つかりません', 404);
  if (row.last_drop_at === today()) return fail('今日はもう値下げしています');
  const next = row.price - STEP;
  const floor = breakEven(row).platforms[b.platform]?.price ?? 0;
  if (next < floor) return fail(`損益分岐点（${floor.toLocaleString()}円）を下回るので下げられません`);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO price_drops (platform, external_id, item_id, old_price, new_price, status, message)
        VALUES (?, ?, ?, ?, ?, 'done', '手動')`).bind(b.platform, b.external_id, row.item_id, row.price, next),
    env.DB.prepare('UPDATE platform_listings SET price = ?, last_drop_at = ? WHERE platform = ? AND external_id = ?').bind(next, today(), b.platform, b.external_id),
  ]);
  return json({ ok: true, new_price: next });
}

export async function handlePrices(req, env, url) {
  if (url.pathname === '/api/prices' && req.method === 'GET') return overview(env);
  if (url.pathname === '/api/prices/manual' && req.method === 'GET') {
    const pf = url.searchParams.get('platform') || 'メルカリ';
    return PLATFORMS.includes(pf) ? manualList(env, pf) : fail('フリマの名前が正しくありません');
  }
  if (url.pathname === '/api/prices/manual' && req.method === 'POST') return manualDone(req, env);
  if (url.pathname === '/api/prices/link' && req.method === 'POST') return link(req, env);
  const m = /^\/api\/items\/(\d+)\/listings$/.exec(url.pathname);
  if (m && req.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT platform, external_id, price, url, last_drop_at, floor_hit_at FROM platform_listings
        WHERE item_id = ? AND status = 'active'`).bind(Number(m[1])).all();
    return json({ listings: results });
  }
  return null;
}
