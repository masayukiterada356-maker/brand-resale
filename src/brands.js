// ブランド名の表記ゆれをそろえる対応表
// 左：そろえた後の名前、右：CSVに出てくる書き方（大文字小文字・空白は無視して比べる）
// 新しい書き方が出てきたら、ここに足していく

const BRANDS = {
  'LOUIS VUITTON': ['LOUIS VUITTON', 'LOUISVUITTON', 'ルイヴィトン', 'ルイ・ヴィトン', 'ヴィトン', 'LV'],
  'HERMES': ['HERMES', 'HERMÈS', 'エルメス'],
  'CHANEL': ['CHANEL', 'シャネル'],
  'GUCCI': ['GUCCI', 'グッチ'],
  'PRADA': ['PRADA', 'プラダ'],
  'CELINE': ['CELINE', 'CÉLINE', 'セリーヌ'],
  'BALENCIAGA': ['BALENCIAGA', 'バレンシアガ'],
  'BOTTEGA VENETA': ['BOTTEGA VENETA', 'BOTTEGAVENETA', 'ボッテガヴェネタ', 'ボッテガ・ヴェネタ', 'ボッテガ'],
  'LOEWE': ['LOEWE', 'ロエベ'],
  'FENDI': ['FENDI', 'フェンディ'],
  'DIOR': ['DIOR', 'CHRISTIAN DIOR', 'Christian Dior', 'ディオール', 'クリスチャンディオール'],
  'SAINT LAURENT': ['SAINT LAURENT', 'YVES SAINT LAURENT', 'YSL', 'サンローラン', 'イヴサンローラン'],
  'BURBERRY': ['BURBERRY', 'バーバリー'],
  'COACH': ['COACH', 'コーチ'],
  'MIU MIU': ['MIU MIU', 'MIUMIU', 'ミュウミュウ'],
  'GOYARD': ['GOYARD', 'ゴヤール'],
  'VALEXTRA': ['VALEXTRA', 'ヴァレクストラ'],
  'POLENE': ['POLENE', 'POLÈNE', 'ポレーヌ'],
  'PIERRE HARDY': ['PIERRE HARDY', 'ピエールアルディ'],
  'TIFFANY': ['TIFFANY', 'TIFFANY&CO.', 'TIFFANY & CO.', 'TIFFANY&CO', 'ティファニー'],
  'CARTIER': ['CARTIER', 'カルティエ'],
  'BVLGARI': ['BVLGARI', 'BULGARI', 'ブルガリ'],
  'VAN CLEEF & ARPELS': ['VAN CLEEF & ARPELS', 'VAN CLEEF&ARPELS', 'VCA', 'ヴァンクリーフ&アーペル', 'ヴァンクリーフ'],
  'HARRY WINSTON': ['HARRY WINSTON', 'ハリーウィンストン'],
  'CHAUMET': ['CHAUMET', 'ショーメ'],
  'BOUCHERON': ['BOUCHERON', 'ブシュロン'],
  'ROLEX': ['ROLEX', 'ロレックス'],
  'OMEGA': ['OMEGA', 'オメガ'],
};

const norm = (s) => s.toUpperCase().replace(/[\s・]/g, '');

const ALIASES = Object.entries(BRANDS)
  .flatMap(([canon, list]) => list.map((a) => ({ canon, key: norm(a) })))
  .sort((a, b) => b.key.length - a.key.length); // 長い書き方から先に比べる

// ブランド名そのものをそろえる（見つからなければ大文字にしてそのまま）
export function normalizeBrand(raw) {
  if (!raw) return '';
  const key = norm(raw);
  const hit = ALIASES.find((a) => a.key === key);
  return hit ? hit.canon : raw.trim().toUpperCase();
}

// 商品名の先頭からブランド名を見つける（エコリング用）
// 戻り値：{ brand, brandRaw, rest }
export function splitBrandFromName(name) {
  const text = name.trim();
  const keyOf = (s) => norm(s);
  for (const a of ALIASES) {
    // 先頭から1文字ずつ伸ばして、空白を無視したときに一致する長さを探す
    let consumed = 0;
    let built = '';
    while (consumed < text.length && built.length < a.key.length) {
      built = keyOf(text.slice(0, ++consumed));
    }
    if (built === a.key) {
      const next = text[consumed];
      // 単語の途中で切れていないか確認（英字ブランドの後ろに英字が続かない）
      if (next === undefined || !/[A-Za-z]/.test(next) || /[^\x00-\x7F]/.test(a.key)) {
        return { brand: a.canon, brandRaw: text.slice(0, consumed).trim(), rest: text.slice(consumed).trim() };
      }
    }
  }
  // 見つからない時は最初の単語をブランドとみなす
  const m = /^(\S+)\s*(.*)$/.exec(text);
  return m
    ? { brand: m[1].toUpperCase(), brandRaw: m[1], rest: m[2], unknown: true }
    : { brand: '', brandRaw: '', rest: text, unknown: true };
}
