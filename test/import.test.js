import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBytes } from '../src/csv.js';
import { yearLetter, monthLetter, prefixFor } from '../src/codes.js';
import { buildPreview } from '../src/import.js';
import { normalizeBrand, splitBrandFromName } from '../src/brands.js';

const load = (name) => decodeBytes(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('年の記号：西暦の末尾、10年で一周', () => {
  assert.equal(yearLetter(2021), 'A');
  assert.equal(yearLetter(2026), 'F');
  assert.equal(yearLetter(2030), 'J');
  assert.equal(yearLetter(2031), 'A');
});

test('月の記号：1月=A … 12月=L', () => {
  assert.equal(monthLetter(1), 'A');
  assert.equal(monthLetter(11), 'K');
  assert.equal(monthLetter(12), 'L');
});

test('管理番号の頭3文字', () => {
  assert.equal(prefixFor('R', '2026-11-21'), 'RFK');
  assert.equal(prefixFor('E', '2031-01-05'), 'EAA');
});

test('ブランド名をそろえる', () => {
  assert.equal(normalizeBrand('TIFFANY'), 'TIFFANY');
  assert.equal(normalizeBrand('Tiffany&Co.'), 'TIFFANY');
  assert.equal(normalizeBrand('Valextra'), 'VALEXTRA');
  assert.equal(splitBrandFromName('Tiffany&Co. Tスマイル ミニ').brand, 'TIFFANY');
  assert.equal(splitBrandFromName('Tiffany&Co. Tスマイル ミニ').rest, 'Tスマイル ミニ');
});

test('コメ兵（バッグ）：管理番号と税込の仕入れ値', () => {
  const p = buildPreview(load('komehyo_bag.csv'), '2026-11-21', {}, {}, { participation: false });
  assert.equal(p.supplier_code, 'R');
  assert.equal(p.summary.ok, 8);
  const gucci = p.rows[0];
  assert.equal(gucci.mgmt_no, 'RFK46-4');
  assert.equal(gucci.brand, 'GUCCI');
  assert.equal(gucci.cost, 47586); // (42000+1260)×1.1
  assert.equal(gucci.rank, '未使用');
  assert.equal(gucci.details['素材'], 'キャンバス');
  const lv = p.rows.find((r) => r.supplier_ref === '1351-8');
  assert.equal(lv.mgmt_no, 'RFK1351-8');
  assert.equal(lv.cost, 36256); // (32000+960)×1.1
  assert.equal(lv.details['シリアル'], 'ICチップ');
});

test('コメ兵（ジュエリー）：列が違っても読める', () => {
  const p = buildPreview(load('komehyo_jewelry.csv'), '2026-11-21', {}, {}, { participation: false });
  assert.equal(p.summary.ok, 4);
  const hermes = p.rows.find((r) => r.supplier_ref === '481-7');
  assert.equal(hermes.mgmt_no, 'RFK481-7');
  assert.equal(hermes.cost, 243595); // (215000+6450)×1.1
  assert.equal(hermes.details['素材（金性）'], '750PG');
  assert.equal(hermes.details['重量'], '7.9');
});

test('エコリング（Shift-JIS）：末尾4ケタ、落札合計', () => {
  const p = buildPreview(load('ecoring_sjis.csv'), '2026-09-20');
  assert.equal(p.supplier_code, 'E');
  assert.equal(p.summary.ok, 3);
  const r = p.rows[0];
  assert.equal(r.mgmt_no, 'EFI1528');
  assert.equal(r.cost, 97900);
  assert.equal(r.brand, 'TIFFANY');
  assert.equal(r.details['オークション番号'], '13572_0104');
  assert.equal(r.category, '貴金属');
  assert.equal(r.images.length, 9);
});

test('エコリング：末尾4ケタが重なったら5ケタ', () => {
  const p = buildPreview(load('ecoring_sjis.csv'), '2026-09-20', { mgmtNos: new Set(['EFI1528']) });
  assert.equal(p.rows[0].mgmt_no, 'EFI71528');
  assert.equal(p.rows[0].status, 'ok');
});

test('コメ兵：管理番号が重なったら止めて決めてもらう', () => {
  const p = buildPreview(load('komehyo_bag.csv'), '2026-11-21', { mgmtNos: new Set(['RFK46-4']) });
  assert.equal(p.rows[0].status, 'conflict');
  const fixed = buildPreview(load('komehyo_bag.csv'), '2026-11-21',
    { mgmtNos: new Set(['RFK46-4']) }, { 2: 'RFK46-4B' });
  assert.equal(fixed.rows[0].status, 'ok');
  assert.equal(fixed.rows[0].mgmt_no, 'RFK46-4B');
});

test('同じCSVを2回取り込んでも重複しない', () => {
  const p = buildPreview(load('komehyo_bag.csv'), '2026-12-01', { refs: new Set(['R:46-4']) });
  assert.equal(p.rows[0].status, 'duplicate');
  assert.equal(p.summary.ok, 7);
});

test('成立していない行は取り込まない', () => {
  const csv = 'ロットNo,枝番,品名,ブランド,セリ結果,成立金額,落札手数料\n"1","1","バッグ","GUCCI","不成立","",""\n';
  const p = buildPreview(csv, '2026-11-21');
  assert.equal(p.rows[0].status, 'skipped');
});

const ELENOSS = `注文概要
	E4784 エルメス メドールXO ST0283 ネックレス メタル×バッファローホーン シルバー × 1
¥59,000

小計

¥59,000
配送

¥0
税金合計

¥5,364
合計

¥59,000 JPY`;

test('エレノス：メールから管理番号と仕入れ値', () => {
  const p = buildPreview(ELENOSS, '2026-10-20');
  assert.equal(p.supplier_code, 'N');
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].mgmt_no, 'NFJ4784');
  assert.equal(p.rows[0].cost, 59000);
  assert.equal(p.rows[0].brand, 'HERMES');
  assert.equal(p.rows[0].status, 'ok');
});

const CYPHER = `［　商　品　詳　細　］
--------------------------------
【　商　品　番　号　】S-00048
【　商　　品　　名　】S-00048 ルイヴィトン モンクレール ヴァレンティノガラヴァーニ アパレル５点セット
【　価　格　(税込)　】88,500円
【　　税　　　率　　】10%
【　　数　　　量　　】1
【　　小　　　計　　】88,500円
--------------------------------
【　商　品　合　計　】88,500円
【　　送　　　料　　】1,500円（税込）
【配　送　先　合　計】90,000円
================================
【　総　　合　　計　】90,000円`;

test('サイファー：メールを読み、管理番号は入力してもらう', () => {
  const p = buildPreview(CYPHER, '2026-11-21');
  assert.equal(p.supplier_code, 'C');
  assert.equal(p.rows[0].status, 'conflict');
  assert.equal(p.rows[0].cost, 90000);
  assert.equal(p.rows[0].brand, 'LOUIS VUITTON');
  const fixed = buildPreview(CYPHER, '2026-11-21', {}, { 2: '9155' });
  assert.equal(fixed.rows[0].mgmt_no, 'CFK9155');
  assert.equal(fixed.rows[0].status, 'ok');
});

test('サイファー：「商品番号」の行から貼り付けても読める', () => {
  const p = buildPreview(CYPHER.slice(CYPHER.indexOf('【　商　品　番　号')), '2026-11-21');
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].supplier_ref, 'S-00048');
});

test('エレノス：送料は仕入れ値に含め、複数商品なら分ける', () => {
  const mail = `注文概要
	E1001 エルメス スカーフリング × 1
¥10,000
	E1002 ルイヴィトン 長財布 × 1
¥20,000
小計
¥30,000
配送

¥1,001
合計`;
  const p = buildPreview(mail, '2026-11-21');
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].cost, 10501); // 500＋端数1
  assert.equal(p.rows[1].cost, 20500);
});

test('前の管理表から移した商品と同じ番号は、2重に登録しない', () => {
  const p = buildPreview(load('ecoring_sjis.csv'), '2026-09-20', { mgmtNos: new Set(['EFI1528']), legacyMgmtNos: new Set(['EFI1528']) });
  assert.equal(p.rows[0].status, 'duplicate');
  assert.equal(p.rows[1].status, 'ok');
});

const YAHOO = `qfx********様

おめでとうございます！
商品「1円 ■美品■ PIERRE HARDY ピエール アルディ アルファ レザー ミラー付き クロスボディ ショルダーバッグ 斜め掛け ブラウン系 HE3202」を落札しました。

┃■落札したオークションの情報

商品：1円 ■美品■ PIERRE HARDY ピエール アルディ アルファ レザー ミラー付き クロスボディ ショルダーバッグ 斜め掛け ブラウン系 HE3202
オークションID：w1247518192
終了日時：10月 15日 22時 48分
購入手続き期限：10月 20日 23時 59分 ※
---------------------------
希望数量：1
落札数量：1
落札単価：30,500 円
消費税：3,050 円
落札合計（税込）：33,550 円`;

test('ヤフオク：落札メールから管理番号・仕入れ値・ブランド', () => {
  const p = buildPreview(YAHOO, '2026-10-15');
  assert.equal(p.supplier_code, 'Y');
  const r = p.rows[0];
  assert.equal(r.mgmt_no, 'YFJ8192');
  assert.equal(r.cost, 33550);
  assert.equal(r.brand, 'PIERRE HARDY');
  assert.equal(r.rank, '美品');
  assert.equal(r.supplier_ref, 'w1247518192');
  assert.equal(r.status, 'ok');
  // 送料が書いてあれば足す
  const withShip = buildPreview(YAHOO + '\n送料：1,200円', '2026-10-15');
  assert.equal(withShip.rows[0].cost, 34750);
});

test('K-ブランドオフ：開催日で管理番号、箱番号-番号2ケタ', () => {
  const p = buildPreview(load('brandoff_sjis.csv'), '2026-11-21', {}, {}, { participation: false });
  assert.equal(p.supplier_code, 'K');
  assert.equal(p.rows.length, 3);
  const r = p.rows[0];
  assert.equal(r.mgmt_no, 'KFI1-07');       // 2026/09/03 → F・I
  assert.equal(r.purchase_date, '2026-09-03');
  assert.equal(r.brand, 'BOTTEGA VENETA');
  assert.equal(r.cost, Math.floor((48000 + 2400) * 1.1));
  assert.equal(p.rows[2].mgmt_no, 'KFI51-08');
  assert.equal(r.category, 'バッグ');      // 半角カナを直す
});

test('参加費：1回の仕入れで1,100円を点数で割り、端数は1点目に足す', () => {
  const base = buildPreview(load('komehyo_bag.csv'), '2026-11-21', {}, {}, { participation: false });
  const p = buildPreview(load('komehyo_bag.csv'), '2026-11-21');
  // 8点：1,100÷8＝137 余り4 → 1点目 141円、ほか 137円
  assert.equal(p.rows[0].cost - base.rows[0].cost, 141);
  assert.equal(p.rows[1].cost - base.rows[1].cost, 137);
  assert.equal(p.summary.total_cost - base.summary.total_cost, 1100);
  // ブランドオフ：3点（同じ開催日）
  const k0 = buildPreview(load('brandoff_sjis.csv'), '2026-11-21', {}, {}, { participation: false });
  const k = buildPreview(load('brandoff_sjis.csv'), '2026-11-21');
  assert.equal(k.summary.total_cost - k0.summary.total_cost, 1100);
  assert.equal(k.rows[0].cost - k0.rows[0].cost, 368);
  // エコリングには参加費がない
  const e0 = buildPreview(load('ecoring_sjis.csv'), '2026-09-20');
  assert.equal(e0.rows[0].cost, 97900);
});
