import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcSale } from '../src/sales.js';

test('売れた：入金額と利益（管理表の EFJ2260 と同じ計算）', () => {
  // 販売200,000・手数料10%・送料1,050・梱包100・撮影900・仕入れ155,100
  const c = calcSale({ platform: 'メルカリ', price: 200000, shipping: 1050, packing: 100, photo_fee: 900 }, 155100);
  assert.equal(c.fee, 20000);
  assert.equal(c.payout, 178950);
  assert.equal(c.profit, 178950 - 155100 - 100 - 900);
  assert.equal(calcSale({ platform: 'ヤフーフリマ', price: 10000 }, 5000).fee, 500);
  assert.ok(calcSale({ platform: 'メルカリ', price: '' }, 0).error);
});

import { SHIPPING } from '../src/sales.js';
test('送料の表（MASAさんの決めた金額）', () => {
  assert.deepEqual(Object.values(SHIPPING).map((r) => r['メルカリ']), [210, 450, 750, 850, 1050]);
  assert.deepEqual(Object.values(SHIPPING).map((r) => r['ラクマ']), [200, 430, 650, 750, 1050]);
  assert.deepEqual(Object.values(SHIPPING).map((r) => r['ヤフーフリマ']), [210, 490, 750, 850, 1050]);
});

import { PACKING } from '../src/sales.js';
test('梱包材：ネコポス・コンパクトは80円、段ボールは100円', () => {
  assert.deepEqual(PACKING, { 'ネコポス': 80, '宅急便コンパクト': 80, '60サイズ': 100, '80サイズ': 100, '100サイズ': 100 });
});

import { breakEven, guessShipType } from '../src/sales.js';
test('損益分岐点：（仕入れ値＋撮影代＋送料＋梱包材）÷（1－手数料率）', () => {
  // 管理表の EFJ2260 と同じ：仕入れ155,100・100サイズ → (155100+900+1050+100)/0.9
  const b = breakEven({ cost: 155100 }, '100サイズ');
  assert.equal(b.platforms['メルカリ'].price, Math.ceil((155100 + 900 + 1050 + 100) / 0.9));
  assert.equal(b.platforms['ヤフーフリマ'].price, Math.ceil((155100 + 900 + 1050 + 100) / 0.95));
  assert.equal(b.platforms['ラクマ'].price, Math.ceil((155100 + 900 + 1050 + 100) / 0.9));
  assert.equal(guessShipType({ name: 'TIFFANY オープンハート ネックレス' }), '宅急便コンパクト');
  assert.equal(guessShipType({ name: 'LOEWE トートバッグ' }), '60サイズ');
  assert.equal(guessShipType({ category: 'キャリーケース/旅行用バッグ' }), '80サイズ');
});
