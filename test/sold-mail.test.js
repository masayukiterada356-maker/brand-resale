import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSoldMail } from '../src/mail-parsers.js';
import { score } from '../src/match.js';

const MAIL = `ブランドGriffey@フォロー割有りさん

メルカリをご利用いただきありがとうございます。
下記の商品をにこにこ♡さんが購入しました。

■商品情報
商品ID : m41825891795
商品名 : TIFFANY＆CO Tスマイル　ネックレス　スモール　750 45cm
商品価格 : 148,000円
発送期限 : 11月24日（火）`;

test('メルカリの購入通知を読む', () => {
  const r = parseSoldMail(MAIL);
  assert.equal(r.platform, 'メルカリ');
  assert.equal(r.external_id, 'm41825891795');
  assert.equal(r.price, 148000);
  assert.match(r.title, /Tスマイル/);
  assert.equal(parseSoldMail('こんにちは'), null);
});

test('候補の点数：タイトルに近い商品が上に来る', () => {
  const ev = parseSoldMail(MAIL);
  const a = score(ev, { brand: 'TIFFANY', name: 'TIFFANY Tスマイル 750WG ネックレス   スモール  3.1g 社外箱', channel: 'メルカリ', start_price: 190707 });
  const b = score(ev, { brand: 'TIFFANY', name: 'TIFFANY＆CO  750   2.8g\tTｽﾏｲﾙ   箱   45cm', channel: 'コメ兵', start_price: 192137 });
  const c = score(ev, { brand: 'TIFFANY', name: 'TIFFANY オープンハート ネックレス 750 41cm 3g', channel: 'メルカリ', start_price: 97270 });
  const d = score(ev, { brand: 'HERMES', name: 'エルメス スカーフリング', channel: 'メルカリ' });
  assert.ok(a > b && b > c && c > d, `${a} ${b} ${c} ${d}`);
});

import { bodyText } from '../src/gmail.js';
test('Gmailの本文を取り出す（文字の部分→なければHTML）', () => {
  const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(bodyText({ mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain; charset=UTF-8', body: { data: b64('商品名 : テスト') } },
    { mimeType: 'text/html', body: { data: b64('<p>x</p>') } }] }), '商品名 : テスト');
  assert.equal(bodyText({ mimeType: 'text/html', body: { data: b64('商品ID : m1<br>商品名 : A') } }).trim(), '商品ID : m1\n商品名 : A');
});

test('ラクマの「代金のお支払いがありました」通知を読む', () => {
  const r = parseSoldMail(`Griffey様

ラクマをご利用いただきありがとうございます。
継続中の取引についてラクマよりお知らせです。

下記の商品について購入者より代金のお支払いがありました。

■ 商品情報
オーダーID : 879843222
商品名     : 【極美品】グッチ GGサイケデリック　チルドレンズ　 ハンドバッグ　550763
商品価格   : 73,500円
購入者様   : Lara`);
  assert.equal(r.platform, 'ラクマ');
  assert.equal(r.price, 73500);
  assert.equal(r.external_id, 'order:879843222');
  assert.match(r.title, /GGサイケデリック/);
});

test('ヤフーフリマ（Yahoo!かんたん決済）の通知を読む', () => {
  const mail = `このメールはYahoo!オークション、またはYahoo!フリマを利用されたお客様に、Yahoo!かんたん決済より自動的にお送りしております。

下記商品について、Yahoo!かんたん決済での支払いを受け付けました。

----------
  商品タイトル             ： 【美品】ロエベ クロスボディ カメラバッグ ミニ サテンカーフ ブラック 黒 LOEWE ショルダーバッグ アナグラム
  商品ID                   ： z701597106
  取引相手の支払金額       ： 155,000 円
  決済ID                   ： 26110798468313
----------`;
  const r = parseSoldMail(mail);
  assert.equal(r.platform, 'ヤフーフリマ');
  assert.equal(r.external_id, 'z701597106');
  assert.equal(r.price, 155000);
  assert.match(r.title, /カメラバッグ/);
  assert.equal(parseSoldMail(mail.replace('z701597106', 'w1247518192')).platform, 'ヤフオク');
});
