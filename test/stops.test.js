import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staleListings, createStopTasks } from '../src/stops.js';

// データベースのかわり（必要な問い合わせだけ答える）
function fakeDb(rows) {
  const calls = [];
  const stmt = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; return this; },
    async all() { calls.push(this.sql); return { results: /FROM platform_listings pl JOIN items/.test(this.sql) ? rows : [] }; },
    async run() { calls.push(this.sql); return {}; },
  });
  return { calls, prepare: (sql) => stmt(sql), async batch(list) { list.forEach((x) => calls.push(x.sql)); } };
}

test('止め忘れチェック：売れたフリマの出品は止めない', async () => {
  const db = fakeDb([
    { external_id: 'm1', url: null, item_id: 1, mgmt_no: 'A', sold_platform: 'メルカリ' },
    { external_id: 'm2', url: null, item_id: 2, mgmt_no: 'B', sold_platform: 'ラクマ' },
    { external_id: 'm3', url: null, item_id: 3, mgmt_no: 'C', sold_platform: 'ペイペイフリマ' },
  ]);
  const r = await staleListings({ DB: db }, 'メルカリ', ['m1', 'm2', 'm3']);
  assert.deepEqual(r.map((x) => x.mgmt_no), ['B', 'C']);
  const ry = await staleListings({ DB: fakeDb([{ external_id: 'z1', item_id: 3, mgmt_no: 'C', sold_platform: 'ペイペイフリマ' }]) }, 'ヤフーフリマ', ['z1']);
  assert.equal(ry.length, 0); // 前の管理表の「ペイペイフリマ」＝ヤフーフリマ
});

test('売れた時：売れたフリマ以外の2つに止める作業を作る', async () => {
  const db = fakeDb([]);
  await createStopTasks({ DB: db }, 10, 'ラクマ');
  const inserts = db.calls.filter((c) => /INSERT INTO stop_tasks/.test(c));
  assert.equal(inserts.length, 2);
});
