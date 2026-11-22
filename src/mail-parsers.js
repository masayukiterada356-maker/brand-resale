// フリマの「購入されました」メールを読む
// 戻り値：{ platform, external_id, title, price } または null（売れた通知ではない）

const yen = (s) => Number(String(s ?? '').replace(/[^\d]/g, '')) || null;
const field = (text, label) => (new RegExp(`${label}\\s*[:：]\\s*([^\\n\\r]+)`).exec(text) || [])[1]?.trim() || '';

function mercari(text) {
  if (!/メルカリ/.test(text) || !/購入しました|購入されました/.test(text)) return null;
  const id = field(text, '商品ID');
  const title = field(text, '商品名');
  if (!title) return null;
  return { platform: 'メルカリ', external_id: id || null, title, price: yen(field(text, '商品価格')) };
}

// ラクマ・ヤフーフリマは、実物のメールを見てから足す
export const MAIL_PARSERS = [mercari];

export function parseSoldMail(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  for (const p of MAIL_PARSERS) {
    const r = p(t);
    if (r) return r;
  }
  return null;
}
