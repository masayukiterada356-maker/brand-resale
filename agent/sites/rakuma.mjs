// ラクマ：fril.jp/item/new に下書きを作る
// 入力欄の名前と状態の番号は、これまでのスキル（flea-market-sheet-listing）で確かめたもの

import {
  ensureLoggedIn, fillField, chooseSelect, uploadPhotos, walkTree, clickDraftButton,
  pause, firstVisible, byText, bestMatch, StepError,
} from './common.mjs';

export const name = 'ラクマ';
export const URL = 'https://fril.jp/item/new';

const STATUS = {
  '新品、未使用': 5, '未使用に近い': 4, '目立った傷や汚れなし': 6, 'やや傷や汚れあり': 3, '傷や汚れあり': 2, '全体的に状態が悪い': 1,
};

async function noneButtons(page) {
  const all = await page.locator('button').filter({ hasText: /^\s*指定なし\s*$/ }).all();
  const vis = [];
  for (const b of all) if (await b.isVisible().catch(() => false)) vis.push(b);
  return vis;
}

export async function createDraft(page, item, p, files, notes) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await pause(2500, 4000);
  await ensureLoggedIn(page, /login|signin|accounts\.rakuten/, name);

  await uploadPhotos(page, '写真', files.slice(0, p.max_photos));

  await fillField(page, '商品名', ['input[name="itemName"]'], [...item.title].slice(0, 40).join(''));
  await fillField(page, '説明文', ['textarea[name="detail"]'], item.description);

  // カテゴリ：1つ目の「指定なし」を押すと一覧が開く
  try {
    const btns = await noneButtons(page);
    if (!btns.length) throw new StepError('カテゴリ', '「指定なし」ボタンが見つかりません');
    await btns[0].click();
    await pause(1200, 2000);
    const before = btns.length;
    const r = await walkTree(page, item.category,
      async () => {
        const dlg = page.locator('[role="dialog"], .chakra-modal__content').last();
        const scope = (await dlg.count()) ? dlg : page;
        const all = await scope.locator('button, [role="button"], li').all();
        const vis = [];
        for (const a of all) {
          const t = (await a.innerText().catch(() => '')).trim();
          if (t && t !== '指定なし' && (await a.isVisible().catch(() => false))) vis.push(a);
        }
        return vis;
      },
      async () => (await noneButtons(page)).length < before && !(await page.locator('[role="dialog"]').isVisible().catch(() => false)));
    if (!r.ok) throw new StepError('カテゴリ', `最後まで選べませんでした（${r.chosen.join(' > ')}）`);
    notes.push(`カテゴリ：${r.chosen.join(' > ')}`);
  } catch (e) {
    notes.push(`要確認 ${e.message}`);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // ブランド：残った「指定なし」→ 検索
  try {
    const btns = await noneButtons(page);
    if (!btns.length) throw new StepError('ブランド', '「指定なし」ボタンが見つかりません');
    await btns[btns.length - 1].click();
    await pause(1200, 2000);
    const box = await firstVisible(page, ['input[placeholder="ブランド名で検索"]'], 5000);
    if (!box) throw new StepError('ブランド', '検索欄が見つかりません');
    await box.fill(item.brand);
    await pause(1500, 2500);
    const scope = page.locator('.css-1c4l09m').last();
    const opts = await ((await scope.count()) ? scope : page.locator('[role="dialog"]').last()).locator('button').all();
    const texts = await Promise.all(opts.map((o) => o.innerText().catch(() => '')));
    const i = bestMatch(item.brand, texts);
    if (i < 0) throw new StepError('ブランド', `「${item.brand}」が候補にありません`);
    await opts[i].click();
    await pause(1000, 1800);
  } catch (e) {
    notes.push(`要確認 ${e.message}`);
    await page.keyboard.press('Escape').catch(() => {});
  }

  await chooseSelect(page, '商品の状態', ['select[name="status"]'], { value: STATUS[item.condition] ?? 6 });
  await chooseSelect(page, '配送料の負担', ['select[name="carriage"]'], { value: 1 });       // 送料込み
  await chooseSelect(page, '発送日の目安', ['select[name="deliveryDate"]'], { value: 1 });   // 1〜2日
  await chooseSelect(page, '発送元の地域', ['select[name="deliveryArea"]'], { value: 23 });  // 愛知県
  try { await chooseSelect(page, '購入申請', ['select[name="requestRequired"]'], { value: 0 }); } catch { /* ない時はそのまま */ }
  // 配送方法：かんたんラクマパック（選べる時だけ）
  try {
    await chooseSelect(page, '配送方法', [page.locator('select').filter({ has: page.locator('option', { hasText: p.shipping.method }) })], { label: p.shipping.method });
  } catch { notes.push(`要確認 配送方法（${p.shipping.method}）を選べませんでした`); }

  await fillField(page, '販売価格', ['input[name="sellPrice"]'], p.price);

  await clickDraftButton(page, '下書き保存');
  await page.waitForURL(/\/draft/, { timeout: 30000 }).catch(() => {
    throw new StepError('下書き保存', '保存できたか確認できませんでした（画面が変わりません）');
  });
}

/* ---------- 値下げ ---------- */
import { scrapeListings, changePrice } from './price-common.mjs';
export const PLATFORM = 'ラクマ';
// 要確認：出品中の一覧のURL
export const LISTINGS_URL = 'https://fril.jp/sell';
export function listListings(page) {
  return scrapeListings(page, {
    url: LISTINGS_URL,
    linkPattern: /(item\.fril\.jp\/[0-9a-f]{16,}|fril\.jp\/item\/[0-9a-z]{8,}\/edit)/,
    idFrom: (h) => (/item\.fril\.jp\/([0-9a-f]{16,})/.exec(h) || /fril\.jp\/item\/([0-9a-z]{8,})\/edit/.exec(h) || [])[1],
    toUrl: (id) => `https://item.fril.jp/${id}`,
  });
}
export function dropPrice(page, item) {
  return changePrice(page, {
    editUrl: `https://fril.jp/item/${item.external_id}/edit`,
    priceSelectors: ['input[name="sellPrice"]'],
    saveTexts: ['変更する', '更新する', '保存する'],
  }, item);
}

// 要確認：編集画面の「下書きに戻す」
import { stopListing } from './price-common.mjs';
export function stop(page, item) {
  return stopListing(page, { editUrl: `https://fril.jp/item/${item.external_id}/edit`, stopTexts: ['下書きに戻す'] }, item);
}
