// 3つのフリマで共通の操作

import { pause, sleep, firstVisible, byText, bestMatch, StepError, log } from '../lib/util.mjs';

export class LoginError extends Error {}

export async function ensureLoggedIn(page, loginUrlPattern, siteName) {
  if (loginUrlPattern.test(page.url())) {
    throw new LoginError(`${siteName}のログインが切れています。「npm run login」でログインし直してください`);
  }
}

// 入力欄に文字を入れる（React の画面でも反映されるように fill を使う）
export async function fillField(page, step, selectors, value) {
  const el = await firstVisible(page, selectors);
  if (!el) throw new StepError(step, '入力欄が見つかりません');
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await el.fill('');
  await el.fill(String(value));
  await pause(300, 800);
  const got = await el.inputValue().catch(() => null);
  const same = (a) => String(a).replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).join('\n').trim();
  if (got !== null && same(got) !== same(value)) {
    throw new StepError(step, '入力した文字が反映されませんでした');
  }
}

// <select> を、表示されている文字（label）か値（value）で選ぶ
export async function chooseSelect(page, step, selectors, { label, value }) {
  const el = await firstVisible(page, selectors, 4000);
  if (!el) throw new StepError(step, '選択欄が見つかりません');
  await el.scrollIntoViewIfNeeded();
  if (value !== undefined) await el.selectOption({ value: String(value) });
  else await el.selectOption({ label });
  await pause(300, 700);
}

// 写真を入れる
export async function uploadPhotos(page, step, files, perPhotoMs = 1200) {
  const input = page.locator('input[type="file"]').first();
  if (!(await input.count())) throw new StepError(step, '写真を入れる場所が見つかりません');
  await input.setInputFiles(files);
  await sleep(Math.min(3000 + files.length * perPhotoMs, 30000));
}

// 階層になった一覧を、言葉の近いものから順にクリックしていく（カテゴリ選び）
// getOptions: () => 画面に出ている選択肢（Locator）の配列
// isDone: () => 選び終わったか
export async function walkTree(page, path, getOptions, isDone, { maxDepth = 5 } = {}) {
  const chosen = [];
  let k = 0;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (await isDone()) return { ok: true, chosen };
    const opts = await getOptions();
    if (!opts.length) break;
    const texts = await Promise.all(opts.map((o) => o.innerText().then((t) => t.trim().split('\n')[0]).catch(() => '')));
    let idx = -1;
    // まだ使っていない言葉から順に探す（1段目で使わなかった言葉が次で当たることもある）
    while (k < path.length && idx < 0) {
      idx = bestMatch(path[k], texts);
      k++;
    }
    if (idx < 0) idx = bestMatch('その他', texts);
    if (idx < 0) break;
    chosen.push(texts[idx]);
    await opts[idx].scrollIntoViewIfNeeded();
    await opts[idx].click();
    await pause(1200, 2200);
  }
  return { ok: await isDone(), chosen };
}

export async function clickDraftButton(page, step) {
  const btn = await byText(page, 'button, a', '下書きに保存する') || await byText(page, 'button, a', '下書き保存');
  if (!btn) throw new StepError(step, '「下書きに保存する」ボタンが見つかりません');
  // 念のため：「出品する」「公開」のボタンではないことを確かめる
  const label = (await btn.innerText()).trim();
  if (!/下書き/.test(label) || /出品する|公開/.test(label)) throw new StepError(step, `押そうとしたボタンが下書き保存ではありません（${label}）`);
  await btn.scrollIntoViewIfNeeded();
  await pause(500, 1000);
  await btn.click();
  log(`  ${step}：「${label}」を押しました`);
}

export { pause, sleep, firstVisible, byText, bestMatch, StepError };
