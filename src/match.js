// 売れた通知のタイトルから、在庫のどの商品かを探す
// ・出品文（listings.title）と完全に同じ、またはフリマの商品IDが分かっている → 確定
// ・それ以外は、言葉の重なり・ブランド・出品先・価格の近さで点数を付けて候補を出す

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

export function tokens(s) {
  return new Set(norm(s)
    .replace(/[【】\[\]()（）「」・,、.。/／|｜＆&]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 || /\d/.test(t)));
}

const BRAND_WORDS = {
  tiffany: ['tiffany', 'ティファニー'], hermes: ['hermes', 'エルメス'], 'louis vuitton': ['vuitton', 'ヴィトン', 'ルイヴィトン'],
  chanel: ['chanel', 'シャネル'], gucci: ['gucci', 'グッチ'], loewe: ['loewe', 'ロエベ'], celine: ['celine', 'セリーヌ'],
  prada: ['prada', 'プラダ'], cartier: ['cartier', 'カルティエ'], valextra: ['valextra', 'ヴァレクストラ'], fendi: ['fendi', 'フェンディ'],
};

export function score(ev, item) {
  const a = tokens(ev.title);
  const text = [item.listing_title, item.brand, item.name, item.category, item.model].filter(Boolean).join(' ');
  const b = tokens(text);
  let s = 0;
  for (const t of a) {
    if (b.has(t)) s += 2;
    else if ([...b].some((x) => x.length >= 3 && (x.includes(t) || t.includes(x)))) s += 1;
  }
  const evText = norm(ev.title);
  const itText = norm(text);
  for (const words of Object.values(BRAND_WORDS)) {
    const inEv = words.some((w) => evText.includes(w));
    const inIt = words.some((w) => itText.includes(w));
    if (inEv && inIt) s += 3;
    else if (inEv !== inIt && (inEv || inIt) && item.brand) s -= 3;
  }
  // 出品先が同じなら少し上げる（ヤフーフリマは前の管理表では「ペイペイフリマ」）
  const alias = (p) => norm(p).replace('ペイペイフリマ', 'ヤフーフリマ').replace('paypayフリマ', 'ヤフーフリマ');
  if (item.channel && alias(item.channel).includes(alias(ev.platform))) s += 2;
  if (ev.price && item.start_price) {
    const r = ev.price / item.start_price;
    if (r > 0.6 && r < 1.4) s += 1;
  }
  return s;
}

// 戻り値：{ item_id（確定した時）, candidates: [{id, score}] }
export async function findItem(env, ev) {
  if (ev.external_id) {
    const hit = await env.DB.prepare(`SELECT p.item_id FROM platform_items p JOIN items i ON i.id = p.item_id
        WHERE p.platform = ? AND p.external_id = ? AND i.status != 'sold'`).bind(ev.platform, ev.external_id).first();
    if (hit) return { item_id: hit.item_id, candidates: [] };
  }
  const exact = await env.DB.prepare(`SELECT i.id FROM listings l JOIN items i ON i.id = l.item_id
      WHERE i.status != 'sold' AND l.title = ?`).bind(ev.title).all();
  if (exact.results.length === 1) return { item_id: exact.results[0].id, candidates: [] };

  const { results } = await env.DB.prepare(`SELECT i.id, i.brand, i.name, i.category, i.model, i.channel, i.start_price,
        l.title AS listing_title
      FROM items i LEFT JOIN listings l ON l.item_id = i.id WHERE i.status != 'sold'`).all();
  const ranked = results.map((it) => ({ id: it.id, score: score(ev, it) }))
    .filter((c) => c.score > 0).sort((x, y) => y.score - x.score).slice(0, 5);
  return { item_id: null, candidates: ranked };
}
