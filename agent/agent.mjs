// 自宅PCで動かす下書き作成プログラム
//   npm run login … 専用のChromeを開く。3つのフリマに1回だけログインしておく
//   npm run check … アプリにつながるか、ログインできているかを確かめる
//   npm run run   … 「出品文OK」の商品の下書きを作る（タスクスケジューラーから毎晩）
//   npm run price … 毎晩の値下げ（ラクマ19時・メルカリ21時・ヤフーフリマ22時。タスクスケジューラーから毎晩19時）
//   npm run check-stops … 止め忘れのチェック（PCを起動した時）：売れた商品がまだ出品中なら止める
//
// 絶対にしないこと：「出品する」「公開」ボタンを押すこと。下書き保存だけ。

import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { App } from './lib/app.mjs';
import { log, sleep } from './lib/util.mjs';
import { LoginError } from './sites/common.mjs';
import * as mercari from './sites/mercari.mjs';
import * as rakuma from './sites/rakuma.mjs';
import * as yahoo from './sites/yahoo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = { mercari, rakuma, yahoo };
const BY_PLATFORM = { 'メルカリ': mercari, 'ラクマ': rakuma, 'ヤフーフリマ': yahoo };

async function loadConfig() {
  const file = process.env.AGENT_CONFIG || join(HERE, 'config.json');
  if (!existsSync(file)) throw new Error(`設定ファイルがありません：${file}（config.example.json をコピーして作ってください）`);
  const cfg = JSON.parse(await readFile(file, 'utf8'));
  return { maxItemsPerRun: 5, platforms: ['mercari', 'rakuma', 'yahoo'], waitBetweenItemsSec: [60, 180], ...cfg };
}

async function openBrowser(cfg) {
  await mkdir(cfg.profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(cfg.profileDir, {
    // PCに入っている本物のChromeを使う（テストの時だけ AGENT_BROWSER_CHANNEL= で付属のChromiumにできる）
    channel: process.env.AGENT_BROWSER_CHANNEL === undefined ? 'chrome' : (process.env.AGENT_BROWSER_CHANNEL || undefined),
    headless: process.env.AGENT_HEADLESS === '1', // ふだんは画面を出して動かす
    viewport: null,
    locale: 'ja-JP',
    args: ['--start-maximized'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  await useFakeSites(ctx);
  return ctx;
}

// テスト用：本物のフリマのかわりに test/fake-sites の練習用画面を出す
async function useFakeSites(ctx) {
  const dir = process.env.AGENT_FAKE_SITES;
  if (!dir) return;
  const map = { 'jp.mercari.com': 'mercari.html', 'fril.jp': 'rakuma.html', 'paypayfleamarket-sec.yahoo.co.jp': 'yahoo.html', 'paypayfleamarket.yahoo.co.jp': 'done.html', 'item.fril.jp': 'price.html' };
  // 値下げの画面（一覧・商品ページ・編集）は price.html
  const isPricePage = (u) => /\/mypage\/listings|fril\.jp\/sell$|\/my\/selling|\/sell\/edit\/|\/item\/[^/]+\/edit|\/item\/edit|yahoo\.co\.jp\/item\/z\d+/.test(u);
  for (const [host, file] of Object.entries(map)) {
    await ctx.route(`https://${host}/**`, async (route) => {
      if (route.request().method() === 'POST') {
        await writeFile(join(dir, `posted_${host}.json`), route.request().postData() || '');
        return route.fulfill({ status: 200, body: 'ok' });
      }
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('.js')) {
        return route.fulfill({ contentType: 'text/javascript', body: await readFile(join(dir, path.split('/').pop()), 'utf8') });
      }
      const body = await readFile(join(dir, isPricePage(route.request().url()) ? 'price.html' : file), 'utf8');
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    });
  }
}

async function screenshot(page, name) {
  const dir = join(HERE, 'logs');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function cmdLogin(cfg) {
  const ctx = await openBrowser(cfg);
  for (const s of Object.values(SITES)) {
    const p = await ctx.newPage();
    await p.goto(s.URL).catch(() => {});
  }
  log('3つのフリマのタブを開きました。それぞれログインしてから、Chromeを閉じてください。');
  await new Promise((r) => ctx.on('close', r));
}

async function cmdCheck(cfg) {
  const app = new App(cfg);
  await app.ping();
  log('アプリ：つながりました');
  const items = await app.queue(20);
  log(`下書きを待っている商品：${items.length}点`);
  const ctx = await openBrowser(cfg);
  const page = ctx.pages()[0] || await ctx.newPage();
  for (const [key, s] of Object.entries(SITES)) {
    await page.goto(s.URL, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const ok = !/login|signin|accounts\.rakuten|login\.yahoo/.test(page.url());
    log(`${s.name}：${ok ? 'ログインできています' : 'ログインが必要です（npm run login）'}`);
    if (!ok) await screenshot(page, `check_${key}`);
  }
  await ctx.close();
}

async function cmdRun(cfg) {
  const app = new App(cfg);
  const items = await app.queue(cfg.maxItemsPerRun);
  if (!items.length) { log('下書きを作る商品はありません'); return; }
  log(`${items.length}点の下書きを作ります`);

  const ctx = await openBrowser(cfg);
  const page = ctx.pages()[0] || await ctx.newPage();
  const work = join(HERE, 'work');
  try {
    for (const [n, item] of items.entries()) {
      log(`■ ${item.mgmt_no} ${item.title}`);
      const dir = join(work, item.mgmt_no);
      const files = await app.downloadImages(item, dir);
      log(`  写真 ${files.length}枚を用意しました`);

      for (const p of item.platforms) {
        if (!cfg.platforms.includes(p.platform)) continue;
        const site = SITES[p.platform];
        const notes = [];
        try {
          await site.createDraft(page, item, p, files, notes);
          log(`  ${site.name}：下書きを保存しました ${notes.join(' / ')}`);
          await app.report(item.item_id, p.platform, true, notes.join(' / '));
        } catch (e) {
          const shot = await screenshot(page, `${item.mgmt_no}_${p.platform}`);
          log(`  ${site.name}：失敗 ${e.message}（画面の記録：${shot}）`);
          await app.report(item.item_id, p.platform, false, [e.message, ...notes].join(' / '));
          if (e instanceof LoginError) throw e; // ログイン切れは全部止める
        }
        await sleep(5000 + Math.random() * 5000);
      }
      await rm(dir, { recursive: true, force: true });

      if (n < items.length - 1) {
        const [a, b] = cfg.waitBetweenItemsSec;
        const wait = (a + Math.random() * (b - a)) * 1000;
        log(`  次の商品まで ${Math.round(wait / 1000)}秒 待ちます`);
        await sleep(wait);
      }
    }
  } finally {
    await ctx.close();
  }
  log('終わりました');
}

// 毎晩の値下げ（フリマごとに時間帯と件数が決まっている）
//   ラクマ 19:00〜20:00・メルカリ 21:00〜22:00・ヤフーフリマ 22:00〜23:00（各50件・ランダム）
//   PCが動いていなかった時：ラクマ・ヤフーフリマは起動した時から取り戻す（ヤフーフリマが先）。メルカリは手動（アプリに一覧）
const DEFAULT_RULES = {
  rakuma:  { start: '19:00', end: '20:00', catchUp: true,  priority: 2 },
  mercari: { start: '21:00', end: '22:00', catchUp: false, priority: 1 },
  yahoo:   { start: '22:00', end: '23:00', catchUp: true,  priority: 0 },
};
const CATCH_UP_MIN_DEFAULT = 60; // 取り戻す時は、およそ1時間で終わるように間隔をあける

function at(hhmm, base = new Date()) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(base); d.setHours(h, m || 0, 0, 0); return d.getTime();
}

async function takeLock() {
  const file = join(HERE, 'logs', 'price.lock');
  await mkdir(join(HERE, 'logs'), { recursive: true });
  try {
    const old = JSON.parse(await readFile(file, 'utf8'));
    let alive = false;
    try { process.kill(old.pid, 0); alive = true; } catch { /* 動いていない */ }
    if (alive && Date.now() - old.at < 6 * 3600e3) return null;
  } catch { /* ロックなし */ }
  await writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return async () => rm(file, { force: true });
}

async function cmdPrice(cfg) {
  const release = await takeLock();
  if (!release) { log('値下げはもう動いています（2つ目は止めます）'); return; }
  const app = new App(cfg);
  const rules = { ...DEFAULT_RULES, ...(cfg.priceRules || {}) };
  // 「今すぐ始める」：npm run price -- --now rakuma,yahoo
  // 指定したフリマは、時間帯を待たずに今から取り戻しとして始める（ヤフーフリマが先）。メルカリは指定できない
  const nowArg = process.argv.find((a) => a.startsWith('--now'));
  if (nowArg) {
    const list = (nowArg.split('=')[1] || process.argv[process.argv.indexOf(nowArg) + 1] || 'rakuma,yahoo').split(',').map((x) => x.trim());
    for (const k of list) {
      if (k === 'mercari') { log('メルカリは今すぐの値下げはできません（時間帯 21:00〜22:00 だけ）'); continue; }
      if (rules[k]) rules[k] = { ...rules[k], start: '00:00', end: '00:01', catchUp: true };
    }
    cfg.platforms = cfg.platforms.filter((k) => list.includes(k) && k !== 'mercari');
    log(`今すぐ始めます：${cfg.platforms.join('・')}`);
  }
  const dayEnd = at(cfg.priceDayEnd || '23:59');
  const keys = cfg.platforms.filter((k) => rules[k] && SITES[k]?.dropPrice);
  const st = Object.fromEntries(keys.map((k) => [k, { queue: null, remaining: null, deadline: 0, due: 0, listed: false, catchUpFrom: 0 }]));

  const windowOf = (k) => ({ s: at(rules[k].start), e: at(rules[k].end) });
  const isActive = (k, now) => {
    const w = windowOf(k);
    if (now >= w.s && now < w.e) return true;
    return rules[k].catchUp && now >= w.e && now < dayEnd; // 時間帯を過ぎても残っていれば取り戻す
  };
  const deadlineOf = (k, now) => {
    const w = windowOf(k);
    if (now < w.e) return w.e;
    // 取り戻し：ヤフーフリマが先。ラクマは、ヤフーフリマの取り戻しが終わる頃までずらす
    let from = now;
    if (k !== 'yahoo' && st.yahoo && isActive('yahoo', now) && (st.yahoo.remaining ?? 1) > 0) from = Math.max(from, st.yahoo.deadline || now);
    return Math.min(dayEnd, from + (cfg.catchUpMinutes ?? CATCH_UP_MIN_DEFAULT) * 60000);
  };
  const schedule = (k, now) => {
    const x = st[k];
    x.deadline = deadlineOf(k, now);
    const gap = Math.max(20000, (x.deadline - now) / ((x.queue?.length || 1) + 1));
    x.due = now + gap * (0.5 + Math.random());
  };

  let ctx = null;
  let page = null;
  const browser = async () => {
    if (!ctx) { ctx = await openBrowser(cfg); page = ctx.pages()[0] || await ctx.newPage(); }
    return page;
  };

  try {
    for (;;) {
      const now = Date.now();
      if (now >= dayEnd) { log('今日の値下げの時間は終わりました'); break; }

      // 時間帯に入ったフリマの準備（出品中の一覧を読む → 今日の計画）
      for (const k of keys) {
        const x = st[k];
        if (!isActive(k, now) || x.queue) continue;
        const site = SITES[k];
        const p = await browser();
        try {
          const listings = await site.listListings(p);
          await ensureLoggedIn(p, site);
          const r = await app.sendListings(site.PLATFORM, listings, listings.length > 0);
          log(`${site.name}：出品中 ${r.received}件（結び付き ${r.linked}・確認待ち ${r.unlinked}）`);
        } catch (e) {
          log(`${site.name}：一覧を読めませんでした ${e.message}`);
          await screenshot(p, `list_${k}`);
          if (e instanceof LoginError) throw e;
        }
        const plan = await app.pricePlan(300, site.PLATFORM);
        x.queue = plan.items;
        x.remaining = plan.items.length;
        const w = windowOf(k);
        log(`${site.name}：今日 ${plan.done_today[site.PLATFORM]}件済み・これから ${plan.items.length}件${now >= w.e ? '（時間帯を過ぎたので取り戻し）' : ''}（下限に到達 ${plan.floor_hits}件）`);
        schedule(k, Date.now());
      }

      // 次にやるもの：予定時刻が一番早いもの（同じなら ヤフーフリマ → メルカリ → ラクマ）
      const ready = keys.filter((k) => st[k].queue?.length && isActive(k, now));
      const future = keys.filter((k) => !st[k].queue && windowOf(k).s > now && windowOf(k).s < dayEnd);
      if (!ready.length && !future.length) { log('今日の値下げは全部終わりました'); break; }
      if (!ready.length) {
        const next = Math.min(...future.map((k) => windowOf(k).s));
        await sleep(Math.min(next - now, 5 * 60000));
        continue;
      }
      ready.sort((a, b) => (st[a].due - st[b].due) || (rules[a].priority - rules[b].priority));
      const k = ready[0];
      if (st[k].due > now) { await sleep(Math.min(st[k].due - now, 60000)); continue; }

      const item = st[k].queue.shift();
      const site = SITES[k];
      const p = await browser();
      try {
        const r = await site.dropPrice(p, item);
        if (r.status === 'changed') {
          log(`  ${item.mgmt_no} ${item.platform}：画面の価格（${r.seen_price}円）が記録と違うので、今日は下げません`);
          await app.priceResult({ platform: item.platform, external_id: item.external_id, status: 'changed', seen_price: r.seen_price, old_price: item.current_price, message: '画面の価格が記録と違う' });
        } else {
          log(`  ${item.mgmt_no} ${item.platform}：${item.current_price} → ${item.new_price}円`);
          await app.priceResult({ platform: item.platform, external_id: item.external_id, status: 'done', old_price: item.current_price, new_price: item.new_price });
        }
      } catch (e) {
        const shot = await screenshot(p, `price_${item.mgmt_no}_${k}`);
        log(`  ${item.mgmt_no} ${item.platform}：失敗 ${e.message}（${shot}）`);
        await app.priceResult({ platform: item.platform, external_id: item.external_id, status: 'error', old_price: item.current_price, message: e.message }).catch(() => {});
        if (e instanceof LoginError) throw e;
      }
      st[k].remaining = st[k].queue.length;
      schedule(k, Date.now());
    }
  } finally {
    if (ctx) await ctx.close();
    await release();
  }
}

// 止め忘れのチェック：3つのフリマの出品中の一覧を読み、アプリで「売れた」の商品が残っていれば止める
async function cmdCheckStops(cfg) {
  const release = await takeLock();
  if (!release) { log('ほかの作業が動いているので、止め忘れのチェックはあとにします'); return; }
  const app = new App(cfg);
  const ctx = await openBrowser(cfg);
  const page = ctx.pages()[0] || await ctx.newPage();
  let stopped = 0;
  let failed = 0;
  try {
    for (const key of cfg.platforms) {
      const site = SITES[key];
      if (!site?.listListings || !site.stop) continue;
      try {
        const listings = await site.listListings(page);
        await ensureLoggedIn(page, site);
        const r = await app.sendListings(site.PLATFORM, listings, listings.length > 0);
        log(`${site.name}：出品中 ${r.received}件・止め忘れ ${r.stale.length}件`);
      } catch (e) {
        log(`${site.name}：一覧を読めませんでした ${e.message}`);
        await screenshot(page, `stopcheck_${key}`);
        if (e instanceof LoginError) throw e;
      }
      await sleep(2000 + Math.random() * 2000);
    }
    // 止める作業（売れた時に作られたもの＋今の止め忘れ）を順に止める
    const tasks = await app.stopTasks();
    for (const t of tasks) {
      const site = BY_PLATFORM[t.platform];
      if (!site?.stop || !cfg.platforms.includes(Object.keys(SITES).find((k) => SITES[k] === site))) continue;
      try {
        await site.stop(page, t);
        log(`  ${t.mgmt_no} ${t.platform}：止めました`);
        await app.stopResult({ platform: t.platform, external_id: t.external_id, ok: true, message: 'PCが止めた' });
        stopped++;
      } catch (e) {
        const shot = await screenshot(page, `stop_${t.mgmt_no}_${t.platform}`);
        log(`  ${t.mgmt_no} ${t.platform}：止められませんでした ${e.message}（${shot}）`);
        await app.stopResult({ platform: t.platform, external_id: t.external_id, ok: false, message: e.message }).catch(() => {});
        failed++;
        if (e instanceof LoginError) throw e;
      }
      await sleep(4000 + Math.random() * 4000);
    }
  } finally {
    await ctx.close();
    await release();
  }
  log(`止め忘れのチェックが終わりました（止めた ${stopped}件・止められなかった ${failed}件）`);
}

async function ensureLoggedIn(page, site) {
  if (/login|signin|accounts\.rakuten|login\.yahoo/.test(page.url())) {
    throw new LoginError(`${site.name}のログインが切れています。「npm run login」でログインし直してください`);
  }
}

const cmd = process.argv[2] || 'run';
const cfg = await loadConfig().catch((e) => { log(e.message); process.exit(1); });
try {
  if (cmd === 'login') await cmdLogin(cfg);
  else if (cmd === 'check') await cmdCheck(cfg);
  else if (cmd === 'price') await cmdPrice(cfg);
  else if (cmd === 'check-stops') await cmdCheckStops(cfg);
  else await cmdRun(cfg);
} catch (e) {
  log('止まりました：', e.message);
  await writeFile(join(HERE, 'last-error.txt'), `${new Date().toISOString()}\n${e.stack || e.message}\n`).catch(() => {});
  process.exit(1);
}
