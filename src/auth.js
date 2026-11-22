// ログイン：パスワードで入り、1年間有効なクッキーを渡す
// ・最初のパスワード：Workerのシークレット APP_PASSWORD
// ・アプリの画面から変えたパスワードは、データベース（settings）に「ハッシュ」だけを保存
// ・クッキーの署名：Workerのシークレット SESSION_KEY
// ・自宅PCのプログラムは x-agent-token で入る（agent.js）

const enc = new TextEncoder();
const COOKIE = 'sid';
const YEAR = 365 * 24 * 3600;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}

async function sha(text) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// 長さが同じかどうかも含めて、時間差の出ない比べ方
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function setting(env, key) {
  return (await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value ?? null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
}

// パスワードを変えると番号が上がり、それまでのクッキーは使えなくなる
async function passwordVersion(env) {
  return (await setting(env, 'password_version')) || '0';
}

async function checkPassword(env, password) {
  const stored = await setting(env, 'password_hash'); // "salt$hash"
  if (stored) {
    const [salt, hash] = stored.split('$');
    return same(await sha(`${salt}:${password}`), hash);
  }
  return !!env.APP_PASSWORD && same(password, env.APP_PASSWORD);
}

async function makeCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + YEAR;
  const v = await passwordVersion(env);
  const sig = await hmac(env.SESSION_KEY, `${exp}.${v}`);
  return `${COOKIE}=${exp}.${v}.${sig}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;
}

export async function isLoggedIn(req, env) {
  if (env.AUTH_DISABLED === '1') return true; // 手元の確認用だけ
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get('cookie') || '');
  if (!m || !env.SESSION_KEY) return false;
  const [exp, v, sig] = m[1].split('.');
  if (!exp || Number(exp) < Date.now() / 1000) return false;
  if (v !== (await passwordVersion(env))) return false;
  return same(sig, await hmac(env.SESSION_KEY, `${exp}.${v}`));
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

// 間違いが続いたら15分止める（総当たり対策）
async function tooMany(env) {
  const raw = await setting(env, 'login_fail');
  const [count, since] = (raw || '0:0').split(':').map(Number);
  return { count, since, locked: count >= 10 && Date.now() - since < 15 * 60 * 1000 };
}

export async function handleAuth(req, env, url) {
  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!env.SESSION_KEY) return json({ error: 'ログインの設定（SESSION_KEY）がまだです' }, 500);
    const f = await tooMany(env);
    if (f.locked) return json({ error: '間違いが続いたので、15分ほど待ってからもう一度お試しください' }, 429);
    const b = await req.json().catch(() => ({}));
    if (!(await checkPassword(env, String(b.password || '')))) {
      const fresh = Date.now() - f.since > 15 * 60 * 1000;
      await setSetting(env, 'login_fail', `${fresh ? 1 : f.count + 1}:${fresh ? Date.now() : f.since}`);
      return json({ error: 'パスワードが違います' }, 401);
    }
    await setSetting(env, 'login_fail', '0:0');
    return json({ ok: true }, 200, { 'set-cookie': await makeCookie(env) });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
  }
  if (url.pathname === '/api/password' && req.method === 'POST') {
    if (!(await isLoggedIn(req, env))) return json({ error: 'ログインしてください' }, 401);
    const b = await req.json().catch(() => ({}));
    if (!(await checkPassword(env, String(b.current || '')))) return json({ error: '今のパスワードが違います' }, 400);
    const next = String(b.next || '');
    if (next.length < 10) return json({ error: '新しいパスワードは10文字以上にしてください' }, 400);
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    await setSetting(env, 'password_hash', `${salt}$${await sha(`${salt}:${next}`)}`);
    await setSetting(env, 'password_version', String(Number(await passwordVersion(env)) + 1));
    // パスワードを変えた本人は、そのまま使い続けられるように新しいクッキーを渡す
    return json({ ok: true }, 200, { 'set-cookie': await makeCookie(env) });
  }
  return null;
}
