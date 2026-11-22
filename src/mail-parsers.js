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

// ラクマ：「購入者より代金のお支払いがありました」のメールで売れたとみなす
// （オーダーIDは注文の番号で、商品の番号ではないので「order:」を付けて区別する）
function rakuma(text) {
  if (!/ラクマ/.test(text) || !/代金のお支払いがありました|購入されました/.test(text)) return null;
  const title = field(text, '商品名');
  if (!title) return null;
  const order = field(text, 'オーダーID');
  return { platform: 'ラクマ', external_id: order ? `order:${order}` : null, title, price: yen(field(text, '商品価格')) };
}

// ヤフーフリマ：Yahoo!かんたん決済の「支払いを受け付けました」メール
// 同じメールがヤフオクで売れた時にも届くので、商品ID が z で始まればヤフーフリマ、それ以外はヤフオクとする
function yahoo(text) {
  if (!/Yahoo!かんたん決済/.test(text) || !/支払いを受け付けました/.test(text)) return null;
  const title = field(text, '商品タイトル');
  const id = field(text, '商品ID');
  if (!title) return null;
  return {
    platform: /^z/i.test(id) ? 'ヤフーフリマ' : 'ヤフオク',
    external_id: id || null,
    title,
    price: yen(field(text, '取引相手の支払金額')),
  };
}

export const MAIL_PARSERS = [mercari, rakuma, yahoo];

export function parseSoldMail(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  for (const p of MAIL_PARSERS) {
    const r = p(t);
    if (r) return r;
  }
  return null;
}
