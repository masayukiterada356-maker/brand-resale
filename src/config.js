// アプリの「設定」画面で入れる鍵（Googleのクライアント・Geminiの鍵）と、Googleとの接続
// ・鍵はデータベースに「暗号化して」保存する（暗号の鍵は Workerのシークレット SESSION_KEY から作る）
// ・Workerのシークレットに同じ名前があれば、そちらを優先する

import { pickModel, probeGemini } from './gemini.js';

const enc = new TextEncoder();
const KEYS = {
  GOOGLE_CLIENT_ID: 'google_client_id',
  GOOGLE_CLIENT_SECRET: 'google_client_secret',
  GOOGLE_REFRESH_TOKEN: 'google_refresh_token',
  GEMINI_API_KEY: 'gemini_api_key',
};
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`config:${env.SESSION_KEY}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}
async function open(env, sealed) {
  try {
    const [iv, ct] = sealed.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

async function getSetting(env, key) {
  return (await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value ?? null;
}
async function putSetting(env, key, value) {
  if (value === null) { await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run(); return; }
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

// env に、設定画面で入れた鍵を足したものを返す（リクエストのたびに1回だけ読む）
export async function withConfig(env) {
  if (!env.DB || !env.SESSION_KEY) return env;
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${Object.values(KEYS).map(() => '?').join(',')})`)
    .bind(...Object.values(KEYS)).all().catch(() => ({ results: [] }));
  const stored = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const out = Object.create(env);
  for (const [envName, key] of Object.entries(KEYS)) {
    if (env[envName]) continue;
    if (stored[key]) {
      const v = await open(env, stored[key]);
      if (v) Object.defineProperty(out, envName, { value: v });
    }
  }
  return out;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const fail = (message, status = 400) => json({ error: message }, status);

const redirectUri = (url) => `${url.origin}/api/google/callback`;

async function status(env, url) {
  return json({
    redirect_uri: redirectUri(url),
    google_client_id: env.GOOGLE_CLIENT_ID || '',
    has_client_secret: !!env.GOOGLE_CLIENT_SECRET,
    google_connected: !!env.GOOGLE_REFRESH_TOKEN,
    google_email: await getSetting(env, 'google_email'),
    has_gemini: !!env.GEMINI_API_KEY,
    gemini_model: env.GEMINI_API_KEY ? await pickModel(env).catch((e) => `（${e.message}）`) : null,
    gmail_label: env.GMAIL_LABEL || '',
    drive_folder: env.DRIVE_ROOT_FOLDER_ID || '',
  });
}

async function save(env, req) {
  const b = await req.json().catch(() => ({}));
  const clean = (v) => String(v ?? '').trim();
  if (b.google_client_id !== undefined) {
    const v = clean(b.google_client_id);
    if (v && !/\.apps\.googleusercontent\.com$/.test(v)) return fail('クライアントIDは「…apps.googleusercontent.com」で終わる文字です');
    await putSetting(env, KEYS.GOOGLE_CLIENT_ID, v ? await seal(env, v) : null);
  }
  if (b.google_client_secret !== undefined && clean(b.google_client_secret)) {
    await putSetting(env, KEYS.GOOGLE_CLIENT_SECRET, await seal(env, clean(b.google_client_secret)));
  }
  if (b.gemini_api_key !== undefined && clean(b.gemini_api_key)) {
    const key = clean(b.gemini_api_key);
    // 鍵が使えるか、Geminiに軽く聞いて確かめる
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) return fail('Geminiの鍵が使えませんでした。コピーし直してください');
    await putSetting(env, KEYS.GEMINI_API_KEY, await seal(env, key));
  }
  return json({ ok: true });
}

// 「Googleとつなぐ」：Googleの許可画面へ
async function connect(env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('先にクライアントIDとシークレットを保存してください');
  const state = b64(crypto.getRandomValues(new Uint8Array(18))).replace(/[+/=]/g, '');
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(url),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`,
      'set-cookie': `gstate=${state}; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

async function callback(env, req, url) {
  const back = (msg) => new Response(null, { status: 302, headers: { location: `/#/settings?google=${encodeURIComponent(msg)}`, 'set-cookie': 'gstate=; Path=/api/google; Max-Age=0' } });
  const state = /(?:^|;\s*)gstate=([^;]+)/.exec(req.headers.get('cookie') || '')?.[1];
  if (!state || state !== url.searchParams.get('state')) return back('やり直してください（確認の文字が合いません）');
  if (url.searchParams.get('error')) return back(`許可されませんでした（${url.searchParams.get('error')}）`);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(url),
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) return back(`つなげませんでした（${data.error_description || data.error || res.status}）`);
  const granted = String(data.scope || '');
  const missing = ['drive.readonly', 'gmail.readonly'].filter((s) => !granted.includes(s));
  await putSetting(env, KEYS.GOOGLE_REFRESH_TOKEN, await seal(env, data.refresh_token));
  const who = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${data.access_token}` } })
    .then((r) => r.json()).catch(() => ({}));
  await putSetting(env, 'google_email', who.email || 'つながりました');
  return back(missing.length ? `つながりましたが、${missing.join('・')} の許可がありません。チェックを入れてやり直してください` : 'ok');
}

async function disconnect(env) {
  await putSetting(env, KEYS.GOOGLE_REFRESH_TOKEN, null);
  await putSetting(env, 'google_email', null);
  return json({ ok: true });
}

export async function handleConfig(req, env, url) {
  const p = url.pathname;
  if (p === '/api/config' && req.method === 'GET') return status(env, url);
  if (p === '/api/config' && req.method === 'PUT') return save(env, req);
  if (p === '/api/google/connect' && req.method === 'GET') return connect(env, url);
  if (p === '/api/google/callback' && req.method === 'GET') return callback(env, req, url);
  if (p === '/api/google/disconnect' && req.method === 'POST') return disconnect(env);
  if (p === '/api/gemini/probe' && req.method === 'POST') {
    if (!env.GEMINI_API_KEY) return fail('Geminiの鍵がまだです');
    try { return json({ results: await probeGemini(env) }); } catch (e) { return fail(e.message, 502); }
  }
  return null;
}
