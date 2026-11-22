// Gmailの「フリマ」ラベルのメールだけを読み、売れた通知を処理する（読むだけ。メールは変えない）
// 必要なもの：Googleの許可（Googleドライブと同じ。読み取り専用の gmail.readonly を含める）
//             GMAIL_LABEL（ラベルの名前。例：フリマ売れた）

import { accessToken } from './drive.js';
import { parseSoldMail } from './mail-parsers.js';
import { handleSoldNotice } from './sales.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function decode(b64url) {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// メールの本文（文字の部分）を取り出す。HTMLしかない時はタグを外す
export function bodyText(payload) {
  const parts = [];
  const walk = (p) => {
    if (!p) return;
    if (p.body?.data && /^text\/(plain|html)/.test(p.mimeType || '')) parts.push({ type: p.mimeType, text: decode(p.body.data) });
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  const plain = parts.find((p) => p.type.startsWith('text/plain'));
  if (plain) return plain.text;
  const html = parts.find((p) => p.type.startsWith('text/html'));
  return html ? html.text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ') : '';
}

export async function checkGmail(env, { max = 15 } = {}) {
  if (!env.GOOGLE_REFRESH_TOKEN || !env.GMAIL_LABEL) return { skipped: 'Gmailの設定がまだです' };
  const token = await accessToken(env);
  const h = { authorization: `Bearer ${token}` };
  const q = `label:"${env.GMAIL_LABEL}" newer_than:3d`;
  const list = await fetch(`${API}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`, { headers: h }).then((r) => r.json());
  if (list.error) throw new Error(`Gmailを読めません：${list.error.message}`);
  const ids = (list.messages || []).map((m) => m.id);
  if (!ids.length) return { checked: 0 };

  // すでに処理したメールは読まない
  const { results } = await env.DB.prepare(`SELECT message_id FROM sale_events WHERE message_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all();
  const done = new Set(results.map((r) => r.message_id));
  const out = { checked: ids.length, matched: 0, pending: 0, not_sale: 0 };
  for (const id of ids.filter((x) => !done.has(x))) {
    const msg = await fetch(`${API}/messages/${id}?format=full`, { headers: h }).then((r) => r.json());
    const parsed = parseSoldMail(bodyText(msg.payload));
    const day = new Date(Number(msg.internalDate) + 9 * 3600e3).toISOString().slice(0, 10);
    if (!parsed || !parsed.price) {
      // 売れた通知ではないメール（発送・評価のお知らせなど）も、もう一度読まないように印だけ付ける
      await env.DB.prepare(`INSERT OR IGNORE INTO sale_events (source, message_id, platform, title, sold_date, status)
          VALUES ('gmail', ?, '-', '（売れた通知ではないメール）', ?, 'ignored')`).bind(id, day).run();
      out.not_sale++;
      continue;
    }
    const r = await handleSoldNotice(env, parsed, { source: 'gmail', message_id: id, sold_date: day });
    if (r.matched) out.matched++; else if (!r.duplicate && !r.already) out.pending++;
  }
  return out;
}
