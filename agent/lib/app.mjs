// アプリ（Cloudflare）とのやり取り

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class App {
  constructor(cfg) {
    this.base = cfg.appUrl.replace(/\/$/, '');
    this.headers = { 'x-agent-token': cfg.agentToken };
    if (cfg.cfAccessClientId) {
      this.headers['CF-Access-Client-Id'] = cfg.cfAccessClientId;
      this.headers['CF-Access-Client-Secret'] = cfg.cfAccessClientSecret;
    }
  }

  async req(path, opts = {}) {
    const res = await fetch(this.base + path, { ...opts, headers: { ...this.headers, ...(opts.headers || {}) } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`アプリにつながりません（${res.status}）${body.slice(0, 200)}`);
    }
    return res;
  }

  async ping() { return (await this.req('/api/agent/ping')).json(); }

  async queue(limit) { return (await (await this.req(`/api/agent/queue?limit=${limit}`)).json()).items; }

  async report(itemId, platform, ok, message = '') {
    await this.req('/api/agent/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, platform, ok, message }),
    });
  }

  /* ---------- 値下げ ---------- */
  async sendListings(platform, listings, complete) {
    return (await this.req('/api/agent/listings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, listings, complete }),
    })).json();
  }

  async pricePlan(limit) { return (await this.req(`/api/agent/price-plan?limit=${limit}`)).json(); }

  async priceResult(body) {
    await this.req('/api/agent/price-result', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  // 写真をPCの作業フォルダに保存して、ファイルの場所の一覧を返す
  async downloadImages(item, dir) {
    await mkdir(dir, { recursive: true });
    const files = [];
    for (const img of item.images) {
      const res = await this.req(img.path);
      const file = join(dir, img.name);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      files.push(file);
    }
    return files;
  }
}
