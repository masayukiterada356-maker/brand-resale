// メルカリ：jp.mercari.com/sell/create に下書きを作る

import {
  ensureLoggedIn, fillField, chooseSelect, uploadPhotos, walkTree, clickDraftButton,
  pause, firstVisible, byText, bestMatch, StepError,
} from './common.mjs';

export const name = 'メルカリ';
export const URL = 'https://jp.mercari.com/sell/create';

export async function createDraft(page, item, p, files, notes) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await pause(2500, 4000);
  await ensureLoggedIn(page, /login|signin/, name);

  await uploadPhotos(page, '写真', files.slice(0, p.max_photos));

  // カテゴリ（失敗しても下書きは作り、手で直してもらう）
  try {
    const open = await byText(page, 'a, button, div[role="button"]', 'カテゴリーを選択する', { exact: false })
      || await byText(page, 'a, button', 'カテゴリー', { exact: false });
    if (!open) throw new StepError('カテゴリ', '選ぶボタンが見つかりません');
    await open.click();
    await pause(1500, 2500);
    const r = await walkTree(page, item.category,
      async () => {
        const all = await page.locator('main a, main li[role="button"], main button').all();
        const vis = [];
        for (const a of all) if (await a.isVisible().catch(() => false)) vis.push(a);
        return vis;
      },
      async () => /\/sell\/create/.test(page.url()));
    if (!r.ok) throw new StepError('カテゴリ', `最後まで選べませんでした（${r.chosen.join(' > ')}）`);
    notes.push(`カテゴリ：${r.chosen.join(' > ')}`);
  } catch (e) {
    notes.push(`要確認 ${e.message}`);
    if (!/\/sell\/create/.test(page.url())) { await page.goto(URL); await pause(2000, 3000); }
  }

  // ブランド（カテゴリによっては出てこない）
  try {
    const open = await byText(page, 'a, button, div[role="button"]', 'ブランド', { exact: false });
    if (open) {
      await open.click();
      await pause(1500, 2500);
      const box = await firstVisible(page, ['input[type="search"]', 'input[placeholder*="ブランド"]', 'main input[type="text"]'], 5000);
      if (!box) throw new StepError('ブランド', '検索欄が見つかりません');
      await box.fill(item.brand);
      await pause(1500, 2500);
      const opts = await page.locator('main a, main li, main button').all();
      const texts = await Promise.all(opts.map((o) => o.innerText().catch(() => '')));
      const i = bestMatch(item.brand, texts);
      if (i < 0) throw new StepError('ブランド', `「${item.brand}」が候補にありません`);
      await opts[i].click();
      await pause(1500, 2500);
    }
  } catch (e) {
    notes.push(`要確認 ${e.message}`);
    if (!/\/sell\/create/.test(page.url())) await page.goBack().catch(() => {});
  }

  // 商品の状態
  try {
    await chooseSelect(page, '商品の状態', ['select[name="itemCondition"]', 'select[name*="ondition"]',
      page.locator('select').filter({ has: page.locator('option', { hasText: '未使用に近い' }) })], { label: item.condition });
  } catch {
    const open = await byText(page, 'a, button, div[role="button"]', '商品の状態', { exact: false });
    if (!open) throw new StepError('商品の状態', '選ぶ場所が見つかりません');
    await open.click();
    await pause(1000, 1800);
    const opt = await byText(page, 'label, li, button, span', item.condition);
    if (!opt) throw new StepError('商品の状態', `「${item.condition}」が見つかりません`);
    await opt.click();
    await pause(800, 1500);
  }

  await fillField(page, '商品名', ['input[name="name"]', page.getByLabel('商品名', { exact: true })], item.title);
  await fillField(page, '商品の説明', ['textarea[name="description"]', page.getByLabel('商品の説明')], item.description);

  // 配送（らくらくメルカリ便はアカウントの初期設定のまま。日数・地域は選べる時だけ選ぶ）
  for (const [step, label] of [['発送までの日数', p.shipping.days], ['発送元の地域', p.shipping.from]]) {
    try {
      await chooseSelect(page, step, [page.locator('select').filter({ has: page.locator('option', { hasText: label }) })], { label });
    } catch { /* 画面にない時はアカウントの初期設定のまま */ }
  }

  await fillField(page, '販売価格', ['input[name="price"]', page.getByLabel('販売価格')], p.price);

  await clickDraftButton(page, '下書き保存');
  await page.waitForURL(/mypage\/drafts|\/sell\b(?!\/create)/, { timeout: 30000 }).catch(() => {
    throw new StepError('下書き保存', '保存できたか確認できませんでした（画面が変わりません）');
  });
}
