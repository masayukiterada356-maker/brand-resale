// 共通の道具

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 人の操作に近い、ばらつきのある待ち時間
export const pause = (min = 600, max = 1600) => sleep(min + Math.random() * (max - min));

export function log(...args) {
  const t = new Date().toLocaleString('ja-JP', { hour12: false });
  console.log(`[${t}]`, ...args);
}

// 文字の比べ方：空白・記号・全角半角・大文字小文字の違いを無視する
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・/／、,()（）「」]/g, '');
}

// 候補の中から、目当ての言葉に一番近いものを選ぶ（完全一致→含む→共通の文字数）
export function bestMatch(target, options) {
  const t = norm(target);
  if (!t || !options.length) return -1;
  let i = options.findIndex((o) => norm(o) === t);
  if (i >= 0) return i;
  i = options.findIndex((o) => norm(o).includes(t) || (norm(o).length >= 2 && t.includes(norm(o))));
  if (i >= 0) return i;
  let best = -1;
  let score = 0;
  options.forEach((o, k) => {
    const n = norm(o);
    const common = [...new Set(n)].filter((c) => t.includes(c)).length;
    const sc = common / Math.max(n.length, t.length);
    if (sc > score) { score = sc; best = k; }
  });
  return score >= 0.5 ? best : -1;
}

// 画面に出ている要素の中から、文字が一致する最初のものを探す
export async function byText(page, selector, text, { exact = true } = {}) {
  const loc = page.locator(selector).filter({ hasText: exact ? new RegExp(`^\\s*${escapeRe(text)}\\s*$`) : text });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i);
  }
  return null;
}

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 最初に見つかった（画面に出ている）要素を返す
export async function firstVisible(page, selectors, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const s of selectors) {
      const loc = typeof s === 'string' ? page.locator(s) : s;
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i);
      }
    }
    await sleep(300);
  }
  return null;
}

export class StepError extends Error {
  constructor(step, message) { super(`${step}：${message}`); this.step = step; }
}
