import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInvoice } from '../src/index.js';

test('インボイス登録番号：T＋13ケタだけ受け付ける（全角・ハイフンは直す）', () => {
  assert.equal(checkInvoice({ invoice_status: 'registered', invoice_no: 'T9021001013831' }).no, 'T9021001013831');
  assert.equal(checkInvoice({ invoice_status: 'registered', invoice_no: 'ｔ９０２１-００１０-１３８３１' }).no, 'T9021001013831');
  assert.ok(checkInvoice({ invoice_status: 'registered', invoice_no: 'T12345' }).error);
  assert.equal(checkInvoice({ invoice_status: 'none', invoice_no: 'T9021001013831' }).no, null);
  assert.ok(checkInvoice({ invoice_status: 'xx' }).error);
});
