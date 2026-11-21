import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDescription } from '../src/gemini.js';

test('説明文：今のシートと同じ形で、管理番号で終わる', () => {
  const d = buildDescription({
    keywords: 'LOEWE ロエベ',
    condition_text: '綺麗な美品（ABランク）です。',
    intro: '1行目\n2行目\n3行目',
    details: [{ label: 'ブランド', value: 'LOEWE（ロエベ）' }, { label: 'カラー', value: 'ブラック' }],
  }, 'NFJ4363');
  assert.ok(d.startsWith('LOEWE ロエベ\n\n\n■ 商品状態\n綺麗な美品'));
  assert.ok(d.includes('■ 商品詳細\n・ブランド：LOEWE（ロエベ）\n・カラー：ブラック'));
  assert.ok(d.includes('古物商許可証No.541412205500号'));
  assert.ok(d.endsWith('\n\n管理番号：NFJ4363'));
});
