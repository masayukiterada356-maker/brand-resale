// iPhoneのホーム画面のアプリに通知とアイコンの数字（バッジ）を送る（Web Push）
// ・中身のない通知を送り、受け取ったアプリ側（sw.js）がアプリから最新の数字と文を取りに来る
//   （中身を暗号化して送る手間がいらない）
// ・送る側の鍵：VAPID_PRIVATE_JWK（Workerのシークレット）、VAPID_PUBLIC（公開鍵）

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();

// 対応が必要な売れた商品の数：ほかのフリマでまだ止めていない売れた商品 ＋「売れたかも」の確認待ち
export async function badgeCount(env) {
  const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(DISTINCT item_id) FROM stop_tasks WHERE status = 'pending') AS stops,
      (SELECT COUNT(*) FROM sale_events WHERE status = 'pending') AS inbox`).first();
  return { count: (r?.stops || 0) + (r?.inbox || 0), stops: r?.stops || 0, inbox: r?.inbox || 0 };
}

// 通知に出す文（いちばん新しい売れた記録）
async function latestText(env) {
  const s = await env.DB.prepare(`SELECT i.mgmt_no, i.brand, s.platform, s.price FROM sales s JOIN items i ON i.id = s.item_id
      ORDER BY s.created_at DESC LIMIT 1`).first();
  const e = await env.DB.prepare("SELECT platform, title, price FROM sale_events WHERE status = 'pending' ORDER BY id DESC LIMIT 1").first();
  if (e) return { title: `${e.platform}で売れました（商品の確認が必要）`, body: `${e.title}　¥${(e.price || 0).toLocaleString()}` };
  if (s) return { title: `${s.platform}で売れました`, body: `${s.mgmt_no} ${s.brand || ''}　¥${(s.price || 0).toLocaleString()}　ほかのフリマを止めてください` };
  return { title: '在庫管理', body: '売れた商品があります' };
}

export async function vapidAuth(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'https://brand-resale.zaiko-mmglcl.workers.dev',
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

// 登録されているiPhone（など）すべてに知らせる
export async function notifyAll(env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return { skipped: '通知の鍵がまだです' };
  const { results } = await env.DB.prepare('SELECT endpoint FROM push_subs').all();
  let sent = 0;
  for (const { endpoint } of results) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { TTL: '86400', Urgency: 'high', Authorization: await vapidAuth(env, endpoint), 'Content-Length': '0' },
      });
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run(); // 通知をやめた端末
      } else if (res.ok) {
        sent++;
        await env.DB.prepare("UPDATE push_subs SET last_ok_at = datetime('now') WHERE endpoint = ?").bind(endpoint).run();
      } else {
        console.error('通知を送れませんでした', res.status, (await res.text()).slice(0, 200));
      }
    } catch (e) { console.error('通知を送れませんでした', e.message); }
  }
  return { sent, devices: results.length };
}

export async function handlePush(req, env, url) {
  const p = url.pathname;
  if (p === '/api/push/key' && req.method === 'GET') return json({ key: env.VAPID_PUBLIC || null });
  if (p === '/api/push/status' && req.method === 'GET') {
    const b = await badgeCount(env);
    return json({ ...b, ...(await latestText(env)) });
  }
  if (p === '/api/push/subscribe' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const endpoint = String(b.endpoint || '');
    if (!/^https:\/\//.test(endpoint)) return fail('通知の宛先が正しくありません');
    await env.DB.prepare('INSERT OR IGNORE INTO push_subs (endpoint) VALUES (?)').bind(endpoint).run();
    return json({ ok: true });
  }
  if (p === '/api/push/test' && req.method === 'POST') return json(await notifyAll(env));
  return null;
}
