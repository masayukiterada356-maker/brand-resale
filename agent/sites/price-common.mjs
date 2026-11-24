// 値下げで3つのフリマに共通の操作
// ※ 一覧・編集画面のURLと目印は、本物の画面で最初に確かめる必要がある（「要確認」と書いた所）

import { pause, sleep, firstVisible, byText, StepError } from './common.mjs';

const yenOf = (s) => {
  const m = /[¥￥]\s*([\d,]+)/.exec(s || '') || /([\d,]{3,})\s*円/.exec(s || '');
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

// 出品中の一覧のページから、商品のリンク・タイトル・価格を集める（下までスクロールして全部読む）
export async function scrapeListings(page, { url, linkPattern, idFrom, toUrl }) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await pause(2500, 4000);
  let lastCount = -1;
  for (let i = 0; i < 40; i++) {
    const n = await page.locator('a[href]').count();
    if (n === lastCount) break;
    lastCount = n;
    await page.mouse.wheel(0, 4000);
    await pause(900, 1600);
  }
  const raw = await page.$$eval('a[href]', (as) => as.map((a) => {
    // 商品カード：リンクの中、またはリンクを含む少し大きな枠の文字
    let card = a;
    for (let k = 0; k < 3 && card.parentElement && card.innerText.length < 8; k++) card = card.parentElement;
    return { href: a.href, text: (card.innerText || a.getAttribute('aria-label') || '').trim() };
  }));
  const out = new Map();
  for (const r of raw) {
    if (!linkPattern.test(r.href)) continue;
    const id = idFrom(r.href);
    if (!id || out.has(id)) continue;
    const lines = r.text.split('\n').map((s) => s.trim()).filter(Boolean);
    const title = lines.find((l) => !/[¥￥]|円|いいね|コメント|公開停止|販売中|出品中/.test(l) && l.length > 3) || '';
    out.set(id, { external_id: id, title, price: yenOf(r.text), url: toUrl(id) });
  }
  return [...out.values()];
}

// 編集画面で価格を変える：今の価格が予定どおりか確かめてから、新しい価格を入れて保存
export async function changePrice(page, { editUrl, openEdit, priceSelectors, saveTexts }, item) {
  if (editUrl) await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  else await openEdit(page, item);
  await pause(2000, 3500);
  const input = await firstVisible(page, priceSelectors, 10000);
  if (!input) throw new StepError('価格', '編集画面に価格の欄が見つかりません');
  const now = Number((await input.inputValue()).replace(/[^\d]/g, ''));
  if (now !== item.current_price) return { status: 'changed', seen_price: now };

  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill('');
  await input.fill(String(item.new_price));
  await pause(600, 1200);
  if (Number((await input.inputValue()).replace(/[^\d]/g, '')) !== item.new_price) throw new StepError('価格', '新しい価格が入りませんでした');

  let btn = null;
  for (const t of saveTexts) { btn = await byText(page, 'button, input[type=submit], a', t); if (btn) break; }
  if (!btn) throw new StepError('保存', `保存のボタン（${saveTexts.join('・')}）が見つかりません`);
  const label = ((await btn.innerText().catch(() => '')) || (await btn.getAttribute('value')) || '').trim();
  if (/削除|停止|出品する|下書き/.test(label)) throw new StepError('保存', `押そうとしたボタンが価格の保存ではありません（${label}）`);
  await btn.scrollIntoViewIfNeeded();
  await pause(500, 1000);
  await btn.click();
  await sleep(3500);
  // 確認の画面が出るフリマもある
  const ok = await byText(page, 'button', 'OK') || await byText(page, 'button', '変更する');
  if (ok && (await ok.isVisible().catch(() => false))) { await ok.click().catch(() => {}); await sleep(2500); }
  return { status: 'done' };
}

// 出品を止める（メルカリ・ヤフーフリマは停止、ラクマは下書きに戻す）
// 「削除」は絶対に押さない。押す前にボタンの文字を確かめる
export async function stopListing(page, { editUrl, openEdit, stopTexts }, item) {
  if (editUrl) await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  else await openEdit(page, item);
  await pause(2000, 3500);
  let btn = null;
  for (const t of stopTexts) { btn = await byText(page, 'button, a, input[type=submit]', t, { exact: false }); if (btn) break; }
  if (!btn) throw new StepError('停止', `「${stopTexts.join('」「')}」のボタンが見つかりません（もう止まっている可能性があります）`);
  const label = ((await btn.innerText().catch(() => '')) || (await btn.getAttribute('value')) || '').trim();
  if (/削除/.test(label)) throw new StepError('停止', `押そうとしたボタンが削除です（${label}）。押しません`);
  await btn.scrollIntoViewIfNeeded();
  await pause(500, 1000);
  await btn.click();
  await sleep(2500);
  // 確認の画面（「停止する」「OK」など）
  for (const t of ['停止する', '下書きに戻す', 'OK', 'はい']) {
    const ok = await byText(page, '[role="dialog"] button, button', t);
    if (ok && (await ok.isVisible().catch(() => false))) {
      const l = (await ok.innerText().catch(() => '')).trim();
      if (!/削除/.test(l)) { await ok.click().catch(() => {}); await sleep(2500); }
      break;
    }
  }
  return { status: 'stopped', label };
}
