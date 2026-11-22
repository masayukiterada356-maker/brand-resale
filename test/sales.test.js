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
