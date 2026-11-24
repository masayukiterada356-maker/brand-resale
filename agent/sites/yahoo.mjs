// ヤフーフリマ（PayPayフリマ）に下書きを作る
// 入力欄の目印は、これまでのスキル（flea-market-sheet-listing）で確かめたもの

import {
  ensureLoggedIn, fillField, uploadPhotos, walkTree, clickDraftButton,
  pause, firstVisible, byText, bestMatch, StepError,
} from './common.mjs';

export const name = 'ヤフーフリマ';
export const URL = 'https://paypayfleamarket-sec.yahoo.co.jp/item/add?from=sellTop';

const REQUIRED = '選択してください（必須）';

async function modalOptions(page) {
  const dlg = page.locator('[role="dialog"]').last();
  const scope = (await dlg.count()) ? dlg : page;
  const all = await scope.locator('li').all();
  const vis = [];
  for (const a of all) if (await a.isVisible().catch(() => false)) vis.push(a);
  return vis;
}

export async function createDraft(page, item, p, files, notes) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await pause(2500, 4000);
  await ensureLoggedIn(page, /login\.yahoo|\/login/, name);

  await uploadPhotos(page, '写真', files.slice(0, p.max_photos));
  if (files.length > p.max_photos) notes.push(`写真は${p.max_photos}枚まで（残り${files.length - p.max_photos}枚は入れていません）`);

  await fillField(page, '商品名', ['input[placeholder="商品名を入力してください（必須）"]'], item.title);
  await fillField(page, '説明文', ['textarea[placeholder]'], item.description);

  // カテゴリ：1つ目の「選択してください（必須）」
  try {
    const open = await byText(page, 'div, button, span, p', REQUIRED);
    if (!open) throw new StepError('カテゴリ', '選ぶ場所が見つかりません');
    const before = await page.getByText(REQUIRED, { exact: true }).count();
    await open.click();
    await pause(1500, 2200);
    const r = await walkTree(page, item.category, () => modalOptions(page),
      async () => (await page.getByText(REQUIRED, { exact: true }).count()) < before
        && !(await page.locator('[role="dialog"]').isVisible().catch(() => false)));
    if (!r.ok) throw new StepError('カテゴリ', `最後まで選べませんでした（${r.chosen.join(' > ')}）`);
    notes.push(`カテゴリ：${r.chosen.join(' > ')}`);
  } catch (e) {
    notes.push(`要確認 ${e.message}`);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // ブランド：入力して候補から選ぶ
  try {
    const box = await firstVisible(page, ['input[placeholder="ブランドを入力して選択（任意）"]'], 4000);
    if (!box) throw new StepError('ブランド', '入力欄が見つかりません');
    await box.fill(item.brand);
    await pause(2000, 2800);
    const opts = await page.locator('[role="listbox"] li, [role="option"], ul li').all();
    const vis = [];
    for (const o of opts) if (await o.isVisible().catch(() => false)) vis.push(o);
    const texts = await Promise.all(vis.map((o) => o.innerText().catch(() => '')));
    const i = bestMatch(item.brand, texts);
    if (i < 0) throw new StepError('ブランド', `「${item.brand}」が候補にありません`);
    await vis[i].click();
    await pause(800, 1500);
  } catch (e) {
    notes.push(`要確認 ${e.message}`);
  }

  // 商品の状態：残った「選択してください（必須）」→ 同じ表記を選ぶ
  {
    const open = await byText(page, 'div, button, span, p', REQUIRED);
    if (!open) throw new StepError('商品の状態', '選ぶ場所が見つかりません');
    await open.click();
    await pause(1200, 2000);
    const opt = await byText(page, '[role="dialog"] li, [role="dialog"] p, li, p', item.condition);
    if (!opt) throw new StepError('商品の状態', `「${item.condition}」が見つかりません`);
    await opt.click();
    await pause(1000, 1600);
  }

  await fillField(page, '販売価格', ['input[type="tel"]'], p.price);

  await clickDraftButton(page, '下書き保存');
  await page.waitForURL(/paypayfleamarket\.yahoo\.co\.jp\/sell/, { timeout: 30000 }).catch(() => {
    throw new StepError('下書き保存', '保存できたか確認できませんでした（画面が変わりません）');
  });
}

/* ---------- 値下げ ---------- */
import { scrapeListings, changePrice } from './price-common.mjs';
export const PLATFORM = 'ヤフーフリマ';
// 要確認：出品中の一覧のURL
export const LISTINGS_URL = 'https://paypayfleamarket.yahoo.co.jp/my/selling';
export function listListings(page) {
  return scrapeListings(page, {
    url: LISTINGS_URL,
    linkPattern: /paypayfleamarket(-sec)?\.yahoo\.co\.jp\/.*(item\/|itemId=)z\d+/,
    idFrom: (h) => (/(z\d{6,})/.exec(h) || [])[1],
    toUrl: (id) => `https://paypayfleamarket.yahoo.co.jp/item/${id}`,
  });
}
export function dropPrice(page, item) {
  // 商品ページの「編集」から編集画面を開く
  return changePrice(page, {
    openEdit: async (p, it) => {
      await p.goto(`https://paypayfleamarket.yahoo.co.jp/item/${it.external_id}`, { waitUntil: 'domcontentloaded' });
      await pause(2000, 3000);
      const edit = await byText(p, 'a, button', '編集する', { exact: false }) || await byText(p, 'a, button', '商品の編集', { exact: false });
      if (!edit) throw new StepError('編集', '商品ページに「編集」が見つかりません');
      await edit.click();
    },
    priceSelectors: ['input[type="tel"]', 'input[name="price"]'],
    saveTexts: ['変更する', '更新する', '保存する'],
  }, item);
}

// 要確認：商品ページの「編集」→「出品を停止する」
import { stopListing } from './price-common.mjs';
export function stop(page, item) {
  return stopListing(page, {
    openEdit: async (p, it) => {
      await p.goto(`https://paypayfleamarket.yahoo.co.jp/item/${it.external_id}`, { waitUntil: 'domcontentloaded' });
      await pause(2000, 3000);
      const edit = await byText(p, 'a, button', '編集する', { exact: false }) || await byText(p, 'a, button', '商品の編集', { exact: false });
      if (!edit) throw new StepError('編集', '商品ページに「編集」が見つかりません');
      await edit.click();
    },
    stopTexts: ['出品を停止する', '出品を停止', '公開を停止'],
  }, item);
}
