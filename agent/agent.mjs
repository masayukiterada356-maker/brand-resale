// 自宅PCで動かす下書き作成プログラム
//   npm run login … 専用のChromeを開く。3つのフリマに1回だけログインしておく
//   npm run check … アプリにつながるか、ログインできているかを確かめる
//   npm run run   … 「出品文OK」の商品の下書きを作る（タスクスケジューラーから毎晩）
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
  const map = { 'jp.mercari.com': 'mercari.html', 'fril.jp': 'rakuma.html', 'paypayfleamarket-sec.yahoo.co.jp': 'yahoo.html', 'paypayfleamarket.yahoo.co.jp': 'done.html' };
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
      const body = await readFile(join(dir, file), 'utf8');
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

const cmd = process.argv[2] || 'run';
const cfg = await loadConfig().catch((e) => { log(e.message); process.exit(1); });
try {
  if (cmd === 'login') await cmdLogin(cfg);
  else if (cmd === 'check') await cmdCheck(cfg);
  else await cmdRun(cfg);
} catch (e) {
  log('止まりました：', e.message);
  await writeFile(join(HERE, 'last-error.txt'), `${new Date().toISOString()}\n${e.stack || e.message}\n`).catch(() => {});
  process.exit(1);
}
