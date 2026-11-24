import { makeFramedThumb } from './frame.js';

// 画面（iPhone中心）。#/ 在庫一覧、#/item/123 商品、#/import 取り込み

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('back');

const yen = (n) => (n == null ? '—' : '¥' + Number(n).toLocaleString('ja-JP'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) { showLogin(); throw new Error('ログインしてください'); }
  if (!res.ok) throw new Error(data.error || `エラー（${res.status}）`);
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
}

function setHeader(title, tab, back = false) {
  $title.textContent = title;
  $back.hidden = !back;
  // 戻るボタンがない画面（一覧などの上の画面）では、左上に歯車の設定ボタンを出す
  document.getElementById('gear').hidden = back || title === 'ログイン' || title === '設定';
  document.title = title === '在庫' ? '在庫管理' : `${title}｜在庫管理`;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
}
$back.addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));

// 商品名の見せ方：ブランドの下に「品名・モデル名」
const itemLabel = (it) => [it.category, it.name, it.model].filter(Boolean).join(' · ');

/* ---------- 在庫一覧 ---------- */
let searchText = '';
let listView = 'stock';
const VIEWS = { stock: '在庫', unlisted: '未出品', listed: '出品中', sold: '売れた' };

async function viewItems() {
  setHeader('在庫', 'items');
  $view.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">在庫数</div><div class="v" id="s-count">…</div></div>
      <div class="stat"><div class="k">在庫の仕入れ値合計</div><div class="v" id="s-cost">…</div></div>
    </div>
    <div id="inbox-banner"></div>
    <div id="price-banner"></div>
    <div class="seg" id="views">${Object.entries(VIEWS).map(([k, v]) => `<button data-v="${k}" class="${k === listView ? 'on' : ''}">${v}</button>`).join('')}</div>
    <input class="search" id="q" type="search" placeholder="管理番号・ブランド・商品名で探す" value="${esc(searchText)}">
    <div class="list" id="list"></div>
`;
  document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => {
    listView = b.dataset.v;
    document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('on', x === b));
    loadList();
  }));
  const $q = document.getElementById('q');
  let timer;
  $q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchText = $q.value; loadList(); }, 250);
  });
  await loadList();
  api('/api/prices').then((d) => {
    const $b = document.getElementById('price-banner');
    if (!$b || !(d.counts?.linked || d.counts?.unlinked)) return;
    const ln = d.last_night || {};
    const t = d.done_today || {};
    $b.innerHTML = `<a class="card banner ${d.counts.unlinked || d.errors.length ? 'warn' : ''}" href="#/prices">値下げ（今日）：ラクマ ${t['ラクマ'] || 0}・メルカリ ${t['メルカリ'] || 0}・ヤフー ${t['ヤフーフリマ'] || 0}件${ln.error ? `・失敗 ${ln.error}件` : ''}
      ${d.counts.unlinked ? `／<b>結び付けの確認 ${d.counts.unlinked}件</b>` : ''}${d.counts.floor ? `／下限に到達 ${d.counts.floor}件` : ''}</a>`;
  }).catch(() => {});
  api('/api/sales/inbox').then((d) => {
    const n = d.events.length;
    const $b = document.getElementById('inbox-banner');
    if ($b) $b.innerHTML = `<a class="card banner ${n ? 'warn' : ''}" href="#/sold-inbox">${n ? `<b>売れたかもしれない商品が ${n}件</b> あります。確認してください` : '売れた通知メールを貼り付ける'}</a>`;
  }).catch(() => {});
}

async function loadList() {
  const $list = document.getElementById('list');
  try {
    const data = await api(`/api/items?view=${listView}&q=${encodeURIComponent(searchText)}`);
    const t = data.totals;
    document.getElementById('s-count').innerHTML = `${t.count}点<span class="sub-stat">未出品 ${t.unlisted}・出品中 ${t.listed}</span>`;
    document.getElementById('s-cost').innerHTML = `${yen(t.cost)}<span class="sub-stat">未出品 ${yen(t.unlisted_cost)}</span>`;
    if (!data.items.length) {
      $list.innerHTML = searchText
        ? `<div class="empty">「${esc(searchText)}」に合う商品はありません</div>`
        : `<div class="empty">まだ商品がありません<br><a href="#/import">仕入れ先のCSVを取り込む</a></div>`;
      return;
    }
    $list.innerHTML = data.items.map((it) => `
      <a class="item" href="#/item/${it.id}">
        ${it.thumb ? `<img class="thumb" src="${esc(it.thumb)}" alt="" loading="lazy">` : '<div class="thumb">写真なし</div>'}
        <div class="body">
          <div class="mgmt">${esc(it.mgmt_no)}</div>
          <div class="brand">${esc(it.brand)}</div>
          <div class="nm">${esc(itemLabel(it))}</div>
        </div>
        <div class="right">
          ${it.status === 'sold' ? `
          <div class="yen">${yen(it.sold_price)}</div>
          <div class="days ${it.profit < 0 ? 'neg' : ''}">利益 ${yen(it.profit)}</div>
          <div class="days">${esc((it.sold_date || '').slice(2).replace(/-/g, '/'))}・${it.days}日</div>` : `
          <div class="yen">${yen(it.cost)}</div>
          <div class="days">${it.days}日目</div>
          ${it.status === 'listed' ? `<span class="chip ok">出品中${it.channel ? '・' + esc(it.channel) : ''}</span>` : ''}
          ${it.supplier_code === 'Y' && !it.invoice_status ? '<span class="chip conflict">インボイス未入力</span>' : ''}`}
          ${it.listing_state === 'ready' ? '<span class="chip ok">出品文OK</span>' : it.listing_state === 'draft' ? '<span class="chip duplicate">文を確認</span>' : ''}
        </div>
      </a>`).join('');
  } catch (e) {
    $list.innerHTML = `<div class="empty">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

/* ---------- 商品の詳細 ---------- */
async function viewItem(id) {
  setHeader('商品', 'items', true);
  $view.innerHTML = '<div class="empty">読み込み中…</div>';
  try {
    const it = await api(`/api/items/${id}`);
    setHeader(it.mgmt_no, 'items', true);
    const details = Object.entries(it.details || {});
    viewItem.current = it;
    $view.innerHTML = `
      ${it.photos.length ? `
      <div class="card thumb-card">
        <div class="thumb-big" id="thumb-big">${it.thumb_version
          ? `<img src="/api/items/${it.id}/thumb?v=${it.thumb_version}" alt="サムネイル">`
          : '<div class="ph">サムネイルを作っています…</div>'}</div>
        <div>
          <h2>サムネイル</h2>
          <p class="note">下の写真をタップすると、その写真に黄色い枠を付けて差し替えます</p>
        </div>
      </div>
      <div class="gallery pick">${it.photos.map((p) => `
        <button class="pick-btn ${p.drive_id === (it.thumb_photo_id || it.photos[0].drive_id) ? 'on' : ''}" data-photo="${esc(p.drive_id)}">
          <img src="/api/photos/img/${esc(p.drive_id)}?s=800" alt="" loading="lazy"><span>${p.position}</span>
        </button>`).join('')}</div>
        <p class="note">外注さんの写真（${esc(it.photos[0].date_label)} の ${esc(it.photos[0].number)} 番・${it.photos.length}枚）・<a href="#/photos/${esc(it.photos[0].folder_id)}">割り当てを変える</a></p>` : ''}
      ${it.supplier_images.length ? `<div class="gallery">${it.supplier_images.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>
        <p class="note">仕入れ先の写真（確認用）</p>` : ''}
      <div class="card">
        <div class="mgmt">${esc(it.mgmt_no)}</div>
        <div class="brand" style="font-size:18px">${esc(it.brand)}</div>
        <div>${esc(itemLabel(it))}</div>
        <div class="big-cost" style="margin-top:8px">${yen(it.cost)}</div>
        <div class="note">仕入れ値（税込）・${it.status === 'sold' ? `${it.days}日で売れました` : `仕入れから${it.days}日目`}</div>
      </div>
      ${it.sale ? `
      <div class="card">
        <h2>売れた記録</h2>
        <dl class="kv">
          <dt>売れた場所</dt><dd>${esc(it.sale.platform || '')}</dd>
          <dt>売れた日</dt><dd>${esc(it.sale.sold_date || '')}（${it.days}日）</dd>
          <dt>販売価格</dt><dd>${yen(it.sale.price)}</dd>
          ${it.sale.fee != null ? `<dt>手数料</dt><dd>${yen(it.sale.fee)}</dd>` : ''}
          <dt>送料</dt><dd>${yen(it.sale.shipping)}</dd>
          <dt>入金額</dt><dd>${yen(it.sale.payout)}</dd>
          <dt>梱包材</dt><dd>${yen(it.sale.packing)}</dd>
          ${it.sale.photo_fee ? `<dt>撮影代</dt><dd>${yen(it.sale.photo_fee)}</dd>` : ''}
          ${it.sale.extra_shipping ? `<dt>送料（その他）</dt><dd>${yen(it.sale.extra_shipping)}</dd>` : ''}
          ${it.sale.repair ? `<dt>リペア</dt><dd>${yen(it.sale.repair)}</dd>` : ''}
          <dt>利益</dt><dd><b class="${it.sale.profit < 0 ? 'neg' : ''}">${yen(it.sale.profit)}</b></dd>
        </dl>
        ${it.sale.fee != null && !/発送：/.test(it.sale.memo || '') ? `
        <div class="ship-box">
          <h2 style="margin-top:12px">発送する時：発送の種類をタップ</h2>
          <div class="chips" id="ship-types"></div>
          <p class="note">タップすると送料と梱包材が入り、入金額と利益を計算し直します。</p>
          <details><summary class="note">梱包材の金額を変える時</summary>
            <label class="field" style="margin-top:6px"><span>梱包材（円）空欄なら決まった金額</span><input type="number" inputmode="numeric" id="ship-pack" class="num" placeholder="空欄＝決まった金額"></label>
          </details>
        </div>` : ''}
        <dl class="kv" hidden>
          ${it.sale.likes != null ? `<dt>いいね・閲覧</dt><dd>${it.sale.likes ?? '—'}・${it.sale.views ?? '—'}</dd>` : ''}
        </dl>
      </div>` : ''}
      ${it.status !== 'sold' ? '<div class="card" id="be-card"></div>' : ''}
      ${it.status === 'sold' ? '<button class="linkbtn" id="undo-sold">「売れた」を取り消す</button>' : '<div class="card" id="sold-card"><button class="btn" id="sold-open">売れた</button></div><div id="listing"></div>'}
      <div class="card">
        <h2>仕入れ</h2>
        <dl class="kv">
          <dt>仕入れ先</dt><dd>${esc(it.supplier_name)}</dd>
          <dt>仕入れ先の番号</dt><dd>${esc(it.supplier_ref)}</dd>
          <dt>仕入れ日</dt><dd>${esc(it.purchase_date)}</dd>
          ${it.listed_date ? `<dt>出品日</dt><dd>${esc(it.listed_date)}</dd>` : ''}
          ${it.channel ? `<dt>販路</dt><dd>${esc(it.channel)}</dd>` : ''}
          ${it.target_price ? `<dt>目安価格</dt><dd>${yen(it.target_price)}</dd>` : ''}
          ${it.start_price ? `<dt>スタート価格</dt><dd>${yen(it.start_price)}</dd>` : ''}
          ${it.memo ? `<dt>メモ</dt><dd>${esc(it.memo)}</dd>` : ''}
          <dt>落札額</dt><dd>${yen(it.bid_price)}</dd>
          <dt>落札手数料</dt><dd>${yen(it.supplier_fee)}</dd>
          <dt>仕入れ値（税込）</dt><dd>${yen(it.cost)}</dd>
        </dl>
      </div>
      <div class="card ${it.supplier_code === 'Y' && !it.invoice_status ? 'need' : ''}" id="invoice-card"></div>
      <div class="card">
        <h2>商品の情報</h2>
        <dl class="kv">
          ${it.brand_raw && it.brand_raw !== it.brand ? `<dt>CSVのブランド表記</dt><dd>${esc(it.brand_raw)}</dd>` : ''}
          ${it.rank ? `<dt>ランク</dt><dd>${esc(it.rank)}</dd>` : ''}
          ${it.accessories ? `<dt>付属品</dt><dd>${esc(it.accessories)}</dd>` : ''}
          ${it.notes ? `<dt>状態メモ</dt><dd>${esc(it.notes)}</dd>` : ''}
          ${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
        </dl>
      </div>`;
    $view.querySelectorAll('.pick-btn').forEach((b) => b.addEventListener('click', async () => {
      if (b.classList.contains('on') && it.thumb_version) return;
      $view.querySelectorAll('.pick-btn').forEach((x) => x.classList.toggle('on', x === b));
      await setThumb(it.id, b.dataset.photo, true);
    }));
    renderInvoice(it);
    renderBreakEven(it, it.break_even);
    if (it.status !== 'sold') api(`/api/items/${it.id}/listings`).then((d) => {
      if (!d.listings.length) return;
      const $c = document.getElementById('be-card');
      if ($c) $c.insertAdjacentHTML('beforeend', `<div class="note" style="margin-top:8px">今の出品：${d.listings.map((l) => `${esc(l.platform)} ${yen(l.price)}${l.floor_hit_at ? '（下限）' : ''}${l.last_drop_at ? `・${esc(l.last_drop_at.slice(5))}に値下げ` : ''}`).join('　')}</div>`);
    }).catch(() => {});
    document.getElementById('sold-open')?.addEventListener('click', () => openSold(it));
    if (document.getElementById('ship-types')) {
      api('/api/sales/config').then((cfg) => {
        const $t = document.getElementById('ship-types');
        $t.innerHTML = Object.keys(cfg.shipping).map((t) => `<button type="button" class="chip-btn" data-t="${t}">${t}<br><small>送料${yen(cfg.shipping[t][it.sale.platform] ?? 0)}＋梱包${yen(cfg.packing[t] ?? 0)}</small></button>`).join('');
        $t.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
          try {
            const r = await api(`/api/items/${it.id}/shipping`, { method: 'POST', body: JSON.stringify({ ship_type: b.dataset.t, packing: document.getElementById('ship-pack').value }) });
            toast(`発送：${b.dataset.t}　利益 ${yen(r.profit)}`);
            viewItem(it.id);
          } catch (e) { toast(e.message); }
        }));
      }).catch(() => {});
    }
    document.getElementById('undo-sold')?.addEventListener('click', async () => {
      if (!confirm('「売れた」の記録を取り消して、在庫に戻します。よろしいですか？')) return;
      try { await api(`/api/items/${it.id}/sold`, { method: 'DELETE' }); toast('在庫に戻しました'); viewItem(it.id); } catch (e) { toast(e.message); }
    });
    loadListing(it);
    // 写真はあるのにサムネイルがまだない時は、1枚目で作る
    if (it.photos.length && !it.thumb_version) await setThumb(it.id, it.photos[0].drive_id, false);
  } catch (e) {
    $view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// 写真に黄色い枠を付けて保存する
async function createThumb(itemId, photoId) {
  const { full, small } = await makeFramedThumb(`/api/photos/img/${photoId}?s=2000`);
  const form = new FormData();
  form.append('photo_id', photoId);
  form.append('full', full, 'thumb.jpg');
  form.append('small', small, 'thumb_s.jpg');
  const res = await fetch(`/api/items/${itemId}/thumb`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'サムネイルを保存できませんでした');
  return data.thumb_version;
}

async function setThumb(itemId, photoId, announce) {
  const box = document.getElementById('thumb-big');
  if (box) box.classList.add('busy');
  try {
    const v = await createThumb(itemId, photoId);
    if (box && viewItem.current?.id === itemId) {
      box.innerHTML = `<img src="/api/items/${itemId}/thumb?v=${v}" alt="サムネイル">`;
      viewItem.current.thumb_version = v;
    }
    if (announce) toast('サムネイルを差し替えました');
  } catch (e) {
    toast(e.message);
  } finally {
    if (box) box.classList.remove('busy');
  }
}

/* ---------- CSV取り込み ---------- */
const imp = { text: '', filename: '', date: todayJst(), overrides: {}, preview: null, participation: true };

function decodeBytes(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('shift_jis').decode(buf); }
}

const STATUS_LABEL = { ok: '登録する', conflict: '番号が重なる', duplicate: '登録済み', skipped: '対象外' };
const SUPPLIER_NAME = { R: 'コメ兵オークション', E: 'エコリング', K: 'K-ブランドオフ', N: 'エレノス', C: 'サイファー', Y: 'ヤフオク' };
let importMode = 'csv';

function viewImport() {
  setHeader('取り込み', 'import');
  $view.innerHTML = `
    <div class="card">
      <div class="seg" id="mode">
        <button data-m="csv" class="${importMode === 'csv' ? 'on' : ''}">CSVファイル</button>
        <button data-m="mail" class="${importMode === 'mail' ? 'on' : ''}">メールを貼り付け</button>
        <button data-m="legacy" class="${importMode === 'legacy' ? 'on' : ''}">前の管理表</button>
      </div>
      ${importMode === 'legacy' ? legacyHtml() : ''}
      ${importMode === 'legacy' ? '' : importMode === 'csv' ? `
      <label class="file ${imp.filename ? 'has' : ''}" id="file-label">
        <input type="file" id="file" accept=".csv,text/csv">
        <span id="file-name">${imp.filename ? esc(imp.filename) : 'コメ兵・エコリング・ブランドオフのCSVを選ぶ'}</span>
      </label>` : `
      <label class="field"><span>エレノス・サイファーの注文メール、ヤフオクの落札メールの本文</span>
        <textarea id="mail" rows="7" placeholder="注文確認メールの「注文概要」や「商品詳細」の部分を貼り付けてください">${imp.filename === 'メール' ? esc(imp.text) : ''}</textarea></label>`}
      ${importMode === 'legacy' ? '' : `
      <label class="field" style="margin-top:12px">
        <span>仕入れ日（管理番号の年・月になります）</span>
        <input type="date" id="date" value="${imp.date}">
      </label>
      <button class="btn" id="go" ${imp.text ? '' : 'disabled'}>中身を確認する</button>`}
    </div>
    <div id="result"></div>`;

  document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => {
    if (importMode === b.dataset.m) return;
    importMode = b.dataset.m;
    Object.assign(imp, { text: '', filename: '', overrides: {}, preview: null, participation: true });
    viewImport();
  }));
  document.getElementById('mail')?.addEventListener('input', (ev) => {
    imp.text = ev.target.value; imp.filename = 'メール'; imp.overrides = {}; imp.preview = null;
    document.getElementById('go').disabled = !imp.text.trim();
    document.getElementById('result').innerHTML = '';
  });
  document.getElementById('file')?.addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    imp.text = decodeBytes(await f.arrayBuffer());
    imp.filename = f.name;
    imp.overrides = {};
    imp.preview = null;
    document.getElementById('file-name').textContent = f.name;
    document.getElementById('file-label').classList.add('has');
    document.getElementById('go').disabled = false;
    document.getElementById('result').innerHTML = '';
  });
  if (importMode === 'legacy') { setupLegacy(); return; }
  document.getElementById('date').addEventListener('change', (ev) => {
    imp.date = ev.target.value;
    if (imp.preview) runPreview();
  });
  document.getElementById('go').addEventListener('click', runPreview);
  if (imp.preview) renderPreview();
}

/* ---------- 前の管理表（ブランドせどり管理表の在庫管理シート）の取り込み ---------- */
let legacyData = null;

function legacyHtml() {
  return `
    <p class="note" style="margin-top:0">Googleスプレッドシートの「在庫管理」シートを、ファイル → ダウンロード → カンマ区切り形式（.csv）で保存して選んでください。スプレッドシートは変わりません。</p>
    <label class="file" id="lfile-label"><input type="file" id="lfile" accept=".csv,text/csv"><span id="lfile-name">在庫管理シートのCSVを選ぶ</span></label>
    <div id="lresult"></div>`;
}

function setupLegacy() {
  legacyData = null;
  api('/api/legacy/status').then((s) => {
    if (s.items) document.getElementById('lresult').innerHTML = `<p class="note">すでに前の管理表から ${s.items}点 入っています（在庫 ${s.stock}点・販売済み ${s.sold}点）。同じCSVをもう一度入れても、2重にはなりません。</p>`;
  }).catch(() => {});
  document.getElementById('lfile').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    document.getElementById('lfile-name').textContent = f.name;
    document.getElementById('lfile-label').classList.add('has');
    const $r = document.getElementById('lresult');
    try {
      const { convert } = await import('/shared/legacy.js');
      legacyData = convert(decodeBytes(await f.arrayBuffer()));
    } catch (e) {
      $r.innerHTML = `<p class="msg" style="color:var(--bad)">${esc(e.message)}</p>`;
      return;
    }
    const items = legacyData.items;
    const stock = items.filter((i) => i.status !== 'sold');
    $r.innerHTML = `
      <div class="sum" style="margin-top:12px">
        <span class="chip ok">在庫 ${stock.length}点</span>
        <span class="chip skipped">販売済み ${items.length - stock.length}点</span>
      </div>
      <div class="total"><span>在庫の仕入れ値合計</span><span>${yen(stock.reduce((s, i) => s + i.cost, 0))}</span></div>
      ${legacyData.problems.length ? `<details><summary class="note">確認してほしい行 ${legacyData.problems.length}件</summary>
        <ul class="note">${legacyData.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
      <button class="btn" id="lgo" style="margin-top:10px">${items.length}点をアプリに入れる</button>
      <div class="note" id="lprog"></div>`;
    document.getElementById('lgo').addEventListener('click', runLegacy);
  });
}

async function runLegacy() {
  const btn = document.getElementById('lgo');
  const $p = document.getElementById('lprog');
  btn.disabled = true;
  const items = legacyData.items;
  let inserted = 0;
  let skipped = 0;
  try {
    for (let i = 0; i < items.length; i += 150) {
      $p.textContent = `入れています… ${Math.min(i + 150, items.length)} / ${items.length}点`;
      const r = await api('/api/legacy/import', { method: 'POST', body: JSON.stringify({ items: items.slice(i, i + 150) }) });
      inserted += r.inserted; skipped += r.skipped;
    }
    $p.textContent = `終わりました：新しく入れた ${inserted}点${skipped ? `・すでに入っていた ${skipped}点` : ''}`;
    toast(`前の管理表から ${inserted}点を入れました`);
  } catch (e) {
    $p.textContent = `途中で止まりました（${inserted}点まで入っています）：${e.message}。もう一度押すと続きから入れます`;
    btn.disabled = false;
  }
}

async function runPreview() {
  const $r = document.getElementById('result');
  $r.innerHTML = '<div class="empty">確認中…</div>';
  try {
    imp.preview = await api('/api/import/preview', {
      method: 'POST',
      body: JSON.stringify({ text: imp.text, purchase_date: imp.date, overrides: imp.overrides, participation: imp.participation }),
    });
    renderPreview();
  } catch (e) {
    imp.preview = null;
    $r.innerHTML = `<div class="card" style="color:var(--bad)">${esc(e.message)}</div>`;
  }
}

function renderPreview() {
  const p = imp.preview;
  const s = p.summary;
  const $r = document.getElementById('result');
  $r.innerHTML = `
    <div class="card">
      <h2>${esc(SUPPLIER_NAME[p.supplier_code] || p.supplier_code)}・${p.rows.length}行</h2>
      <div class="sum">
        <span class="chip ok">登録する ${s.ok}</span>
        ${s.conflict ? `<span class="chip conflict">番号が重なる ${s.conflict}</span>` : ''}
        ${s.duplicate ? `<span class="chip duplicate">登録済み ${s.duplicate}</span>` : ''}
        ${s.skipped ? `<span class="chip skipped">対象外 ${s.skipped}</span>` : ''}
      </div>
      ${p.rows.map((r) => `
        <div class="prow ${r.status}">
          <div class="line1">
            <span class="mgmt">${esc(r.mgmt_no || `${p.prefix}？（${r.supplier_ref}）`)}</span>
            <span class="chip ${r.status}">${STATUS_LABEL[r.status]}</span>
          </div>
          ${r.brand !== undefined ? `
          <div class="line1">
            <span class="who"><span class="brand">${esc(r.brand)}</span> <span class="sub">${esc(itemLabel(r))}</span></span>
            <span class="yen">${yen(r.cost)}</span>
          </div>` : ''}
          ${r.message ? `<div class="msg">${esc(r.message)}</div>` : ''}
          ${r.status === 'conflict' || imp.overrides[r.line] || /前の管理表/.test(r.message || '') ? `
            <input type="text" data-line="${r.line}" placeholder="管理番号（数字だけなら ${esc(p.prefix)} を自動で付けます）" value="${esc(imp.overrides[r.line] || '')}" autocapitalize="characters" autocomplete="off">` : ''}
        </div>`).join('')}
      ${p.participation_available ? `<label class="check"><input type="checkbox" id="pfee" ${imp.participation ? 'checked' : ''}> 参加費 1,100円を含める（${s.ok + s.conflict}点で割り振り）</label>` : ''}
      <div class="total"><span>登録する${s.ok}点の仕入れ値</span><span>${yen(s.total_cost)}</span></div>
      <button class="btn" id="commit" ${s.ok ? '' : 'disabled'}>${s.ok}点を登録する</button>
      ${s.conflict ? '<p class="note">番号が重なる商品は、管理番号を入れると登録できます。入れなければ今回は登録しません。</p>' : ''}
    </div>`;

  $r.querySelectorAll('input[data-line]').forEach((el) => {
    el.addEventListener('change', () => {
      const v = el.value.trim().toUpperCase();
      if (v) imp.overrides[el.dataset.line] = v; else delete imp.overrides[el.dataset.line];
      runPreview();
    });
  });
  document.getElementById('commit').addEventListener('click', runCommit);
  document.getElementById('pfee')?.addEventListener('change', (ev) => { imp.participation = ev.target.checked; runPreview(); });
}

async function runCommit() {
  const btn = document.getElementById('commit');
  btn.disabled = true;
  btn.textContent = '登録中…';
  try {
    const res = await api('/api/import/commit', {
      method: 'POST',
      body: JSON.stringify({ text: imp.text, filename: imp.filename, purchase_date: imp.date, overrides: imp.overrides, participation: imp.participation }),
    });
    toast(`${res.inserted}点を登録しました`);
    Object.assign(imp, { text: '', filename: '', overrides: {}, preview: null, participation: true });
    location.hash = '#/';
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = 'もう一度登録する';
  }
}


/* ---------- 売れたかも（売れた通知の確認） ---------- */
async function viewSoldInbox() {
  setHeader('売れた通知', 'items', true);
  $view.innerHTML = `
    <div class="card">
      <h2>売れた通知メールを貼り付ける</h2>
      <p class="note" style="margin-top:0">メルカリの「購入しました」、ラクマの「代金のお支払いがありました」、ヤフーフリマ（Yahoo!かんたん決済）の「支払いを受け付けました」メールの本文を貼り付けると、どの商品かを探して記録します。（Gmailとつないだ後は自動になります）</p>
      <textarea id="ib-text" rows="6" placeholder="メールの本文"></textarea>
      <label class="field" style="margin-top:8px"><span>売れた日</span><input type="date" id="ib-date" value="${todayJst()}"></label>
      <button class="btn" id="ib-go">読み取る</button>
    </div>
    <div id="ib-list"></div>`;
  document.getElementById('ib-go').addEventListener('click', async () => {
    try {
      const r = await api('/api/sales/inbox/paste', { method: 'POST', body: JSON.stringify({ text: document.getElementById('ib-text').value, sold_date: document.getElementById('ib-date').value }) });
      toast(r.matched ? '商品が特定できたので、売れたとして記録しました' : '候補から商品を選んでください');
      document.getElementById('ib-text').value = '';
      loadInbox();
    } catch (e) { toast(e.message); }
  });
  loadInbox();
}

async function loadInbox() {
  const $l = document.getElementById('ib-list');
  const d = await api('/api/sales/inbox');
  if (!d.events.length) { $l.innerHTML = '<div class="empty" style="padding:24px">確認を待っている通知はありません</div>'; return; }
  $l.innerHTML = d.events.map((e) => `
    <div class="card ai-card">
      <div class="ai-head"><span class="chip ai">${esc(e.platform)}で売れました</span><span class="note">${esc(e.sold_date)}</span></div>
      <div style="font-weight:600">${esc(e.title)}</div>
      <div class="big-cost" style="font-size:20px">${yen(e.price)}</div>
      <p class="note">どの商品ですか？（近い順）</p>
      <div class="cands">${e.candidates.map((c, i) => `
        <button class="cand" data-ev="${e.id}" data-item="${c.id}">
          <div class="body">
            <div class="mgmt">${esc(c.mgmt_no)} ${i === 0 ? '<span class="chip ai">一番近い</span>' : ''}</div>
            <div class="brand">${esc(c.brand || '')}</div>
            <div class="nm">${esc(c.name || '')}</div>
          </div>
          <div class="when">${esc(c.channel || '')}<br>仕入 ${yen(c.cost)}</div>
        </button>`).join('') || '<div class="note">近い商品が見つかりませんでした。管理番号で探して「売れた」ボタンで記録してください。</div>'}</div>
      <button class="linkbtn" data-ignore="${e.id}">この通知は対象外にする</button>
    </div>`).join('');
  $l.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', async () => {
    const mg = b.querySelector('.mgmt').textContent.trim().split(' ')[0];
    if (!confirm(`${mg} が売れたとして記録します。よろしいですか？`)) return;
    try {
      await api(`/api/sales/inbox/${b.dataset.ev}`, { method: 'POST', body: JSON.stringify({ item_id: Number(b.dataset.item) }) });
      toast(`${mg} を売れたとして記録しました。発送の時に、発送の種類を選んでください`);
      loadInbox();
    } catch (e) { toast(e.message); }
  }));
  $l.querySelectorAll('[data-ignore]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/sales/inbox/${b.dataset.ignore}`, { method: 'POST', body: JSON.stringify({ ignore: true }) });
    loadInbox();
  }));
}

/* ---------- 毎晩の値下げ ---------- */
async function viewPrices() {
  setHeader('値下げ', 'items', true);
  $view.innerHTML = '<div class="empty">読み込み中…</div>';
  const d = await api('/api/prices');
  const ln = d.last_night || {};
  $view.innerHTML = `
    <div class="card">
      <h2>毎晩の値下げ（100円ずつ・ランダム）</h2>
      <table class="be">
        <tr><th></th><th>時間帯</th><th>今日</th></tr>
        ${[['ラクマ', '19:00〜20:00'], ['メルカリ', '21:00〜22:00'], ['ヤフーフリマ', '22:00〜23:00']].map(([p, t]) => `
          <tr><td>${p}</td><td style="text-align:right">${t}</td><td class="yen">${d.done_today?.[p] || 0} / ${d.daily?.[p] || 50}件</td></tr>`).join('')}
      </table>
      <div class="sum" style="margin-top:8px">${ln.changed ? `<span class="chip duplicate">手で変えた価格に合わせた ${ln.changed}件</span>` : ''}${ln.error ? `<span class="chip conflict">失敗 ${ln.error}件</span>` : ''}</div>
      <p class="note" style="margin:0">損益分岐点より下には下げません。PCが動いていなかった日は、ラクマ・ヤフーフリマは起動した時から取り戻します（ヤフーフリマが先）。メルカリは下の一覧から手で下げてください。</p>
    </div>
    <div id="manual-mercari"></div>
    ${d.unlinked.length ? `<h2 class="date-h">どの商品の出品ですか？（${d.unlinked.length}件）</h2>
      ${d.unlinked.map((u) => `
      <div class="card ai-card">
        <div class="ai-head"><span class="chip ai">${esc(u.platform)}で出品中</span><span class="yen">${yen(u.price)}</span></div>
        <div style="font-weight:600">${esc(u.title)}</div>
        <div class="cands" style="margin-top:8px">${u.candidates.map((c) => `
          <button class="cand" data-p="${esc(u.platform)}" data-x="${esc(u.external_id)}" data-item="${c.id}">
            <div class="body"><div class="mgmt">${esc(c.mgmt_no)}</div><div class="brand">${esc(c.brand || '')}</div><div class="nm">${esc(c.name || '')}</div></div>
            <div class="when">仕入 ${yen(c.cost)}</div>
          </button>`).join('') || '<p class="note">近い商品が見つかりません</p>'}</div>
        <button class="linkbtn" data-ignore-p="${esc(u.platform)}" data-x="${esc(u.external_id)}">在庫の商品ではない（値下げしない）</button>
      </div>`).join('')}` : ''}
    ${d.floor.length ? `<h2 class="date-h">損益分岐点に届いた商品（これ以上は下げません）</h2>
      <div class="list">${d.floor.map((f) => `
        <a class="item" href="#/item/${f.id}"><div class="body"><div class="mgmt">${esc(f.mgmt_no)}</div><div class="brand">${esc(f.brand || '')}</div><div class="nm">${esc(f.name || '')}</div></div>
          <div class="right"><div class="yen">${yen(f.price)}</div><div class="days">${esc(f.platform)}・${f.days}日目</div></div></a>`).join('')}</div>
      <p class="note">再出品やインスタ投稿を考える目安です。</p>` : ''}
    ${d.errors.length ? `<h2 class="date-h">失敗（直近3日）</h2><div class="card">${d.errors.map((e) => `<div class="note">${esc(e.created_at.slice(5, 16))} ${esc(e.mgmt_no || '')} ${esc(e.platform)}：${esc(e.message || '')}</div>`).join('')}</div>` : ''}`;
  // メルカリの手動の値下げ（22時を過ぎても今日の件数が終わっていない時）
  if ((d.jst_hour >= 22 || d.jst_hour < 5) && (d.done_today?.['メルカリ'] || 0) < (d.daily?.['メルカリ'] || 50)) {
    api('/api/prices/manual?platform=' + encodeURIComponent('メルカリ')).then((m) => {
      const $m = document.getElementById('manual-mercari');
      if (!$m || !m.items.length) return;
      $m.innerHTML = `<div class="card ai-card">
        <div class="ai-head"><span class="chip ai">メルカリは手動で</span><span class="note">今日 ${m.done_today}/${m.daily}件</span></div>
        <p class="note" style="margin-top:0">PCが動いていなかったので、メルカリのアプリで価格を下げて「下げた」を押してください。</p>
        ${m.items.map((x) => `<div class="drow" style="grid-template-columns:1fr auto auto">
          <div><div class="mgmt">${esc(x.mgmt_no)}</div><div class="note">${yen(x.current_price)} → <b>${yen(x.new_price)}</b></div></div>
          ${x.url ? `<a class="linkbtn" href="${esc(x.url)}" target="_blank" rel="noopener">開く</a>` : '<span></span>'}
          <button class="chip-btn" data-manual="${esc(x.external_id)}">下げた</button></div>`).join('')}
      </div>`;
      $m.querySelectorAll('[data-manual]').forEach((b) => b.addEventListener('click', async () => {
        try {
          const r = await api('/api/prices/manual', { method: 'POST', body: JSON.stringify({ platform: 'メルカリ', external_id: b.dataset.manual }) });
          b.textContent = `済 ${yen(r.new_price)}`; b.disabled = true; b.classList.add('on');
        } catch (e) { toast(e.message); }
      }));
    }).catch(() => {});
  }
  $view.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', async () => {
    const mg = b.querySelector('.mgmt').textContent;
    if (!confirm(`この出品を ${mg} に結び付けます。よろしいですか？`)) return;
    await api('/api/prices/link', { method: 'POST', body: JSON.stringify({ platform: b.dataset.p, external_id: b.dataset.x, item_id: Number(b.dataset.item) }) });
    toast(`${mg} に結び付けました`); viewPrices();
  }));
  $view.querySelectorAll('[data-ignore-p]').forEach((b) => b.addEventListener('click', async () => {
    await api('/api/prices/link', { method: 'POST', body: JSON.stringify({ platform: b.dataset.ignoreP, external_id: b.dataset.x, ignore: true }) });
    viewPrices();
  }));
}

/* ---------- 損益分岐点 ---------- */
const SHIP_TYPES = ['ネコポス', '宅急便コンパクト', '60サイズ', '80サイズ', '100サイズ'];
function renderBreakEven(it, be) {
  const $c = document.getElementById('be-card');
  if (!$c || !be) return;
  // 今の出品価格（メルカリ）があれば、その価格での利益も出す（ラクマ・ヤフーは1,000円引き）
  const listPrice = { 'メルカリ': it.listing_price || it.start_price || null };
  if (listPrice['メルカリ']) { listPrice['ラクマ'] = listPrice['メルカリ'] - 1000; listPrice['ヤフーフリマ'] = listPrice['メルカリ'] - 1000; }
  const profitAt = (p, x) => x - Math.floor(x * p.rate) - p.shipping - p.packing - p.photo_fee - be.cost;
  $c.innerHTML = `
    <div class="lhead"><h2>損益分岐点</h2><span class="note">これより安く売ると赤字</span></div>
    <table class="be">
      <tr><th></th><th>損益分岐点</th>${listPrice['メルカリ'] ? `<th>${it.listing_price ? '出品価格' : 'スタート価格'}での利益</th>` : ''}</tr>
      ${Object.entries(be.platforms).map(([name, p]) => `
        <tr><td>${name}<small>手数料${Math.round(p.rate * 100)}%</small></td>
          <td class="yen">${yen(p.price)}</td>
          ${listPrice[name] ? `<td class="yen ${profitAt(p, listPrice[name]) < 0 ? 'neg' : ''}">${yen(profitAt(p, listPrice[name]))}<small>${yen(listPrice[name])}の時</small></td>` : ''}</tr>`).join('')}
    </table>
    <label class="field" style="margin-top:10px"><span>発送の種類（予定）${be.guessed ? '<b>・商品の種類から推測</b>' : ''}</span>
      <div class="chips" id="be-types">${SHIP_TYPES.map((t) => `<button type="button" class="chip-btn ${t === be.ship_type ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div></label>
    <p class="note">計算：（仕入れ値 ${yen(be.cost)}＋撮影代 ${yen(900)}＋送料＋梱包材）÷（1－手数料率）</p>`;
  $c.querySelectorAll('#be-types button').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api(`/api/items/${it.id}/ship-type`, { method: 'PUT', body: JSON.stringify({ ship_type: b.dataset.t }) });
      it.break_even = r; renderBreakEven(it, r);
    } catch (e) { toast(e.message); }
  }));
}

/* ---------- 売れた ---------- */
let saleConfig = null;
async function openSold(it) {
  if (!saleConfig) saleConfig = await api('/api/sales/config');
  const $c = document.getElementById('sold-card');
  const places = ['メルカリ', 'ラクマ', 'ヤフーフリマ', 'その他'];
  const types = Object.keys(saleConfig.shipping);
  const inp = (id, v = '', extra = '') => `<input type="number" inputmode="numeric" id="${id}" value="${v}" ${extra} class="num">`;
  $c.innerHTML = `
    <h2>売れた</h2>
    <label class="field"><span>売れた場所</span>
      <div class="seg" id="s-place">${places.map((p, i) => `<button type="button" data-p="${p}" class="${i === 0 ? 'on' : ''}">${p}</button>`).join('')}</div>
      <input type="text" id="s-other" placeholder="売れた場所（友人の名前・お店など）" hidden></label>
    <label class="field"><span>売れた日</span><input type="date" id="s-date" value="${todayJst()}"></label>
    <label class="field"><span>販売価格（円）</span>${inp('s-price', '')}</label>
    <label class="field"><span>発送の種類（選ぶと送料が入ります）</span>
      <div class="chips" id="s-type">${types.map((t) => `<button type="button" data-t="${t}" class="chip-btn">${t}</button>`).join('')}<button type="button" data-t="" class="chip-btn">手渡し・なし</button></div></label>
    <div class="grid2">
      <label class="field"><span>手数料</span>${inp('s-fee')}</label>
      <label class="field"><span>送料</span>${inp('s-ship', 0)}</label>
      <label class="field"><span>梱包材</span>${inp('s-pack', 0)}</label>
      <label class="field"><span>撮影代</span>${inp('s-photo', 900)}</label>
    </div>
    <div class="total"><span>入金額</span><span id="s-payout">—</span></div>
    <div class="total" style="border-top:0;padding-top:0"><span>利益（仕入れ値 ${yen(it.cost)} を引いた後）</span><span id="s-profit">—</span></div>
    <button class="btn" id="s-save">売れたとして記録する</button>
    <button class="linkbtn" id="s-cancel">やめる</button>`;
  let place = places[0];
  let feeTouched = false;
  let shipType = null;
  let packTouched = false;
  let shipCleared = false;
  const $ = (id) => document.getElementById(id);
  const upd = () => {
    const price = Number($('s-price').value) || 0;
    const rate = saleConfig.fee_rate[place] ?? 0;
    if (!feeTouched) $('s-fee').value = price ? Math.floor(price * rate) : '';
    if (shipType) $('s-ship').value = saleConfig.shipping[shipType]?.[place] ?? $('s-ship').value;
    if (shipType && !packTouched) $('s-pack').value = saleConfig.packing?.[shipType] ?? $('s-pack').value;
    if (!shipType && shipCleared && !packTouched) $('s-pack').value = 0;
    const payout = price - (Number($('s-fee').value) || 0) - (Number($('s-ship').value) || 0);
    const profit = payout - it.cost - (Number($('s-pack').value) || 0) - (Number($('s-photo').value) || 0);
    $('s-payout').textContent = price ? yen(payout) : '—';
    $('s-profit').textContent = price ? yen(profit) : '—';
    $('s-profit').className = profit < 0 ? 'neg' : '';
  };
  $c.querySelectorAll('#s-place button').forEach((b) => b.addEventListener('click', () => {
    place = b.dataset.p;
    $c.querySelectorAll('#s-place button').forEach((x) => x.classList.toggle('on', x === b));
    $('s-other').hidden = place !== 'その他';
    upd();
  }));
  $c.querySelectorAll('#s-type button').forEach((b) => b.addEventListener('click', () => {
    shipType = b.dataset.t || null;
    $c.querySelectorAll('#s-type button').forEach((x) => x.classList.toggle('on', x === b));
    if (!shipType) { $('s-ship').value = 0; shipCleared = true; }
    upd();
  }));
  $('s-fee').addEventListener('input', () => { feeTouched = true; upd(); });
  $('s-pack').addEventListener('input', () => { packTouched = true; upd(); });
  ['s-price', 's-ship', 's-photo'].forEach((id) => $(id).addEventListener('input', upd));
  $('s-cancel').addEventListener('click', () => viewItem(it.id));
  $('s-save').addEventListener('click', async () => {
    const platform = place === 'その他' ? $('s-other').value.trim() : place;
    try {
      const r = await api(`/api/items/${it.id}/sold`, { method: 'POST', body: JSON.stringify({
        platform, sold_date: $('s-date').value, price: $('s-price').value, fee: $('s-fee').value, shipping: $('s-ship').value,
        packing: $('s-pack').value, photo_fee: $('s-photo').value, ship_type: shipType,
      }) });
      toast(`売れたとして記録しました（利益 ${yen(r.profit)}）`);
      viewItem(it.id);
    } catch (e) { toast(e.message); }
  });
  upd();
}

/* ---------- 仕入れ先のインボイス ---------- */
function renderInvoice(it) {
  const $c = document.getElementById('invoice-card');
  if (!$c) return;
  const st = it.invoice_status || '';
  const label = st === 'registered' ? `登録番号 ${esc(it.invoice_no)}` : st === 'none' ? '登録のない相手（適格請求書なし）' : '未確認';
  $c.innerHTML = `
    <div class="lhead"><h2>仕入れ先のインボイス</h2>
      <span class="chip ${st ? 'ok' : it.supplier_code === 'Y' ? 'conflict' : 'skipped'}">${st ? '記録済み' : '未入力'}</span></div>
    ${it.supplier_code === 'Y' && !st ? '<p class="note" style="margin-top:0">ヤフオクの仕入れは、出品者のインボイス登録番号を記録してください。</p>' : ''}
    <label class="field"><span>出品者（仕入れ先）の名前・ID</span>
      <input type="text" id="inv-seller" value="${esc(it.seller_name || '')}" autocomplete="off"></label>
    <label class="field"><span>インボイス</span>
      <select id="inv-status">
        <option value="" ${!st ? 'selected' : ''}>未確認</option>
        <option value="registered" ${st === 'registered' ? 'selected' : ''}>登録番号あり</option>
        <option value="none" ${st === 'none' ? 'selected' : ''}>登録のない相手</option>
      </select></label>
    <label class="field" id="inv-no-wrap" ${st === 'registered' ? '' : 'hidden'}><span>登録番号（T＋数字13ケタ）</span>
      <input type="text" id="inv-no" value="${esc(it.invoice_no || '')}" placeholder="T1234567890123" autocapitalize="characters" autocomplete="off" inputmode="text"></label>
    <button class="btn ghost" id="inv-save">保存する</button>
    <p class="note">今：${label}</p>`;
  const $s = document.getElementById('inv-status');
  $s.addEventListener('change', () => { document.getElementById('inv-no-wrap').hidden = $s.value !== 'registered'; });
  document.getElementById('inv-save').addEventListener('click', async () => {
    try {
      const r = await api(`/api/items/${it.id}/invoice`, { method: 'PUT', body: JSON.stringify({
        seller_name: document.getElementById('inv-seller').value, invoice_status: $s.value, invoice_no: document.getElementById('inv-no').value,
      }) });
      Object.assign(it, r);
      $c.classList.remove('need');
      toast('インボイスの情報を保存しました');
      renderInvoice(it);
    document.getElementById('sold-open')?.addEventListener('click', () => openSold(it));
    if (document.getElementById('ship-types')) {
      api('/api/sales/config').then((cfg) => {
        const $t = document.getElementById('ship-types');
        $t.innerHTML = Object.keys(cfg.shipping).map((t) => `<button type="button" class="chip-btn" data-t="${t}">${t}<br><small>送料${yen(cfg.shipping[t][it.sale.platform] ?? 0)}＋梱包${yen(cfg.packing[t] ?? 0)}</small></button>`).join('');
        $t.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
          try {
            const r = await api(`/api/items/${it.id}/shipping`, { method: 'POST', body: JSON.stringify({ ship_type: b.dataset.t, packing: document.getElementById('ship-pack').value }) });
            toast(`発送：${b.dataset.t}　利益 ${yen(r.profit)}`);
            viewItem(it.id);
          } catch (e) { toast(e.message); }
        }));
      }).catch(() => {});
    }
    document.getElementById('undo-sold')?.addEventListener('click', async () => {
      if (!confirm('「売れた」の記録を取り消して、在庫に戻します。よろしいですか？')) return;
      try { await api(`/api/items/${it.id}/sold`, { method: 'DELETE' }); toast('在庫に戻しました'); viewItem(it.id); } catch (e) { toast(e.message); }
    });
    } catch (e) { toast(e.message); }
  });
}

/* ---------- 出品文（Geminiで作る・確認して直す） ---------- */
const CONDITIONS = ['新品、未使用', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり', '全体的に状態が悪い'];
const margin = (price, cost) => (price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null);

async function loadListing(it) {
  const $l = document.getElementById('listing');
  if (!$l) return;
  try {
    const { listing, drafts } = await api(`/api/items/${it.id}/listing`);
    renderListing(it, listing, drafts);
  } catch (e) {
    $l.innerHTML = `<div class="card note">${esc(e.message)}</div>`;
  }
}

const PLATFORM_NAME = { mercari: 'メルカリ', rakuma: 'ラクマ', yahoo: 'ヤフーフリマ' };

function draftsHtml(l, drafts = []) {
  if (!l.ready) return '';
  const by = Object.fromEntries(drafts.map((d) => [d.platform, d]));
  const waiting = !it_hasPhotos;
  return `
    <div class="drafts">
      <h2>フリマの下書き</h2>
      ${Object.entries(PLATFORM_NAME).map(([k, name]) => {
        const d = by[k];
        const chip = !d ? `<span class="chip skipped">${waiting ? '写真待ち' : '作成待ち'}</span>`
          : d.status === 'drafted' ? '<span class="chip ok">下書き済み</span>'
          : `<span class="chip conflict">失敗${d.attempts >= 3 ? '（止めています）' : `（${d.attempts}回目）`}</span>`;
        return `<div class="drow">
          <div class="dname">${name}</div>${chip}
          ${d ? `<button class="linkbtn" data-reset="${k}">やり直す</button>` : ''}
          ${d?.message ? `<div class="dmsg ${d.status === 'error' || /要確認/.test(d.message) ? 'warn' : ''}">${esc(d.message)}</div>` : ''}
        </div>`;
      }).join('')}
      <p class="note">自宅PCのプログラムが毎晩作ります。下書きを確認して、各フリマで公開してください。</p>
    </div>`;
}
let it_hasPhotos = false;

function renderListing(it, l, drafts = []) {
  it_hasPhotos = !!(it.photos.length && (it.thumb_version || viewItem.current?.thumb_version));
  const $l = document.getElementById('listing');
  if (!$l) return;
  if (!l) {
    $l.innerHTML = `
      <div class="card">
        <h2>出品文</h2>
        <p class="note" style="margin-top:0">Geminiが写真と仕入れ情報から、タイトル・説明文・推奨価格を作ります。${it.photos.length ? '' : '（外注さんの写真がまだないので、仕入れ先の情報だけで作ります）'}</p>
        <button class="btn" id="gen">Geminiで出品文を作る</button>
      </div>`;
    document.getElementById('gen').addEventListener('click', () => generateListing(it));
    return;
  }
  const off = (p) => (p ? Math.max(p - 1000, 300) : null);
  $l.innerHTML = `
    <div class="card listing ${l.ready ? 'is-ready' : ''}">
      <div class="lhead"><h2>出品文</h2>${l.ready ? '<span class="chip ok">確認済み</span>' : '<span class="chip duplicate">未確認</span>'}</div>
      <label class="field"><span>タイトル <b id="tcount"></b></span>
        <input type="text" id="l-title" value="${esc(l.title)}" maxlength="60"></label>
      <label class="field"><span>商品の状態</span>
        <select id="l-cond">${CONDITIONS.map((c) => `<option ${c === l.condition ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>説明文 <b id="dcount"></b></span>
        <textarea id="l-desc" rows="12">${esc(l.description)}</textarea></label>
      <div class="price-box">
        <label class="field" style="margin:0"><span>メルカリの価格（円）</span>
          <input type="number" id="l-price" inputmode="numeric" value="${l.price ?? ''}"></label>
        <div class="price-side">
          <div>利益率 <b id="l-margin">—</b></div>
          <div class="note">ラクマ・ヤフー <b id="l-off">—</b></div>
        </div>
      </div>
      ${l.ai_price ? `<p class="note ai-price">Geminiの推奨：<b>${yen(l.ai_price)}</b>　${esc(l.ai_price_reason || '')}
        ${l.ai_price !== l.price ? ' <button class="linkbtn" id="use-ai">この金額にする</button>' : ''}</p>` : ''}
      <div class="lbtns">
        <button class="btn" id="l-ok">${l.ready ? '保存する' : '確認して保存'}</button>
        <button class="btn ghost" id="l-regen">作り直す</button>
      </div>
      ${l.ready ? '<button class="linkbtn" id="l-unready">未確認に戻す</button>' : '<p class="note">「確認して保存」した商品が、フリマの下書き作成の対象になります。</p>'}
      ${draftsHtml(l, drafts)}
    </div>`;
  $l.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`${PLATFORM_NAME[b.dataset.reset]}の下書きを、次の夜にもう一度作ります。前の下書きはフリマ側で消しておいてください。よろしいですか？`)) return;
    await api(`/api/items/${it.id}/drafts/reset`, { method: 'POST', body: JSON.stringify({ platform: b.dataset.reset }) });
    toast('やり直しにしました'); loadListing(it);
  }));

  const $t = document.getElementById('l-title');
  const $d = document.getElementById('l-desc');
  const $p = document.getElementById('l-price');
  const upd = () => {
    const n = [...$t.value].length;
    document.getElementById('tcount').textContent = `${n}/40`;
    document.getElementById('tcount').className = n > 40 ? 'over' : '';
    const dn = [...$d.value].length;
    document.getElementById('dcount').textContent = `${dn}文字`;
    const pr = Number($p.value);
    const mg = margin(pr, it.cost);
    const $m = document.getElementById('l-margin');
    $m.textContent = mg == null ? '—' : `${mg}%`;
    $m.className = mg != null && mg < 20 ? 'over' : '';
    document.getElementById('l-off').textContent = pr ? yen(off(pr)) : '—';
  };
  [$t, $d, $p].forEach((el) => el.addEventListener('input', upd));
  upd();

  const save = async (ready) => {
    try {
      const r = await api(`/api/items/${it.id}/listing`, {
        method: 'PUT',
        body: JSON.stringify({ title: $t.value, condition: document.getElementById('l-cond').value, description: $d.value, price: $p.value, ready }),
      });
      toast(ready ? '確認済みにしました' : '保存しました');
      renderListing(it, r.listing, r.drafts);
    } catch (e) { toast(e.message); }
  };
  document.getElementById('l-ok').addEventListener('click', () => save(true));
  document.getElementById('l-unready')?.addEventListener('click', () => save(false));
  document.getElementById('use-ai')?.addEventListener('click', () => { $p.value = l.ai_price; upd(); });
  document.getElementById('l-regen').addEventListener('click', () => {
    if (confirm('Geminiでタイトルと説明文を作り直します。今の文は上書きされます（価格はそのまま）。よろしいですか？')) generateListing(it);
  });
}

async function generateListing(it) {
  const $l = document.getElementById('listing');
  $l.innerHTML = '<div class="card"><h2>出品文</h2><p class="note">Geminiが写真を見て作っています…（10〜20秒ほど）</p></div>';
  try {
    const { listing, drafts } = await api(`/api/items/${it.id}/listing/generate`, { method: 'POST' });
    renderListing(it, listing, drafts);
  } catch (e) {
    toast(e.message);
    renderInvoice(it);
    document.getElementById('sold-open')?.addEventListener('click', () => openSold(it));
    if (document.getElementById('ship-types')) {
      api('/api/sales/config').then((cfg) => {
        const $t = document.getElementById('ship-types');
        $t.innerHTML = Object.keys(cfg.shipping).map((t) => `<button type="button" class="chip-btn" data-t="${t}">${t}<br><small>送料${yen(cfg.shipping[t][it.sale.platform] ?? 0)}＋梱包${yen(cfg.packing[t] ?? 0)}</small></button>`).join('');
        $t.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
          try {
            const r = await api(`/api/items/${it.id}/shipping`, { method: 'POST', body: JSON.stringify({ ship_type: b.dataset.t, packing: document.getElementById('ship-pack').value }) });
            toast(`発送：${b.dataset.t}　利益 ${yen(r.profit)}`);
            viewItem(it.id);
          } catch (e) { toast(e.message); }
        }));
      }).catch(() => {});
    }
    document.getElementById('undo-sold')?.addEventListener('click', async () => {
      if (!confirm('「売れた」の記録を取り消して、在庫に戻します。よろしいですか？')) return;
      try { await api(`/api/items/${it.id}/sold`, { method: 'DELETE' }); toast('在庫に戻しました'); viewItem(it.id); } catch (e) { toast(e.message); }
    });
    loadListing(it);
  }
}

/* ---------- 写真の割り当て ---------- */
let photoFilter = 'unassigned';

async function refreshBadge() {
  try {
    const d = await api('/api/photos/folders?status=unassigned');
    const b = document.getElementById('photo-badge');
    const n = d.counts?.unassigned || 0;
    b.textContent = n; b.hidden = !n;
  } catch { /* 写真がまだ設定されていない時は出さない */ }
}

const fmtTime = (s) => {
  if (!s) return 'まだ確認していません';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return `最後の確認：${d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
};

async function viewPhotos() {
  setHeader('写真の割り当て', 'photos');
  $view.innerHTML = `
    <div class="bar"><span class="note" id="synced">…</span><button class="btn small ghost" id="sync">ドライブを確認</button></div>
    <div class="seg" id="seg">
      <button data-f="unassigned">未割り当て</button><button data-f="assigned">割り当て済み</button><button data-f="ignored">対象外</button>
    </div>
    <div id="folders"></div>`;
  document.querySelectorAll('#seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.f === photoFilter);
    b.addEventListener('click', () => { photoFilter = b.dataset.f; viewPhotos(); });
  });
  document.getElementById('sync').addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = '確認中…';
    try {
      const r = await api('/api/photos/sync', { method: 'POST' });
      toast(`${r.scanned ?? r.folders}フォルダを確認：新しいフォルダ${r.new_folders}個・写真${r.new_photos}枚${r.remaining ? `（残り${r.remaining}フォルダは、もう一度押すと続きを読みます）` : ''}`);
      await loadFolders(); refreshBadge();
    } catch (e) { toast(e.message); }
    ev.target.disabled = false; ev.target.textContent = 'ドライブを確認';
  });
  await loadFolders();
}

async function loadFolders() {
  const $f = document.getElementById('folders');
  try {
    const d = await api('/api/photos/folders?status=' + photoFilter);
    document.getElementById('synced').textContent = fmtTime(d.synced_at);
    const segLabels = { unassigned: '未割り当て', assigned: '割り当て済み', ignored: '対象外' };
    document.querySelectorAll('#seg button').forEach((b) => {
      const n = d.counts?.[b.dataset.f] || 0;
      b.textContent = `${segLabels[b.dataset.f]}${n ? ' ' + n : ''}`;
    });
    if (!d.folders.length) {
      $f.innerHTML = `<div class="empty">${photoFilter === 'unassigned'
        ? (d.synced_at ? '割り当てを待っている写真はありません' : '「ドライブを確認」を押すと、外注さんの写真フォルダを読み込みます')
        : 'ありません'}</div>`;
      return;
    }
    const groups = [];
    for (const f of d.folders) {
      const g = groups.at(-1);
      if (g && g.label === f.date_label && g.date === f.shoot_date) g.list.push(f);
      else groups.push({ label: f.date_label, date: f.shoot_date, dateId: f.date_folder_id, list: [f] });
    }
    $f.innerHTML = groups.map((g) => `
      <div class="date-h">${esc(g.label)} の撮影・${g.list.length}点
        ${photoFilter === 'unassigned' ? `<button class="linkbtn" data-ignore-date="${esc(g.dateId)}" data-label="${esc(g.label)}" style="float:right;padding:0">まとめて対象外</button>` : ''}
        ${photoFilter === 'ignored' ? `<button class="linkbtn" data-restore-date="${esc(g.dateId)}" data-label="${esc(g.label)}" style="float:right;padding:0">まとめて未割り当てに戻す</button>` : ''}</div>
      <div class="grid">${g.list.map((f) => `
        <a class="tile ${f.status}" href="#/photos/${esc(f.drive_id)}">
          ${f.first_photo_id ? `<img src="/api/photos/img/${esc(f.first_photo_id)}?s=300" alt="" loading="lazy">` : '<div class="ph"></div>'}
          <span class="no">${esc(f.number)}</span>
          <div class="cap">${f.mgmt_no ? `<span class="mgmt">${esc(f.mgmt_no)}</span>` : `<span>${f.photo_count}枚</span>`}</div>
        </a>`).join('')}</div>`).join('');
    $f.querySelectorAll('[data-restore-date]').forEach((b) => b.addEventListener('click', async () => {
      const r = await api(`/api/photos/dates/${b.dataset.restoreDate}/restore`, { method: 'POST' });
      toast(`${r.restored}個を未割り当てに戻しました`); loadFolders(); refreshBadge();
    }));
    $f.querySelectorAll('[data-ignore-date]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`${b.dataset.label} の撮影分を、まとめて対象外にします（すでに出品済みの撮影分など）。よろしいですか？`)) return;
      const r = await api(`/api/photos/dates/${b.dataset.ignoreDate}/ignore`, { method: 'POST' });
      toast(`${r.ignored}個を対象外にしました`); loadFolders(); refreshBadge();
    }));
  } catch (e) {
    $f.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

async function viewFolder(id) {
  setHeader('写真', 'photos', true);
  $view.innerHTML = '<div class="empty">読み込み中…</div>';
  let d;
  try { d = await api(`/api/photos/folders/${id}`); } catch (e) { $view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const f = d.folder;
  setHeader(`${f.date_label} の ${f.number} 番`, 'photos', true);

  const candRow = (c) => `
    <button class="cand" data-id="${c.id}">
      ${c.supplier_thumb ? `<img class="thumb" src="${esc(c.supplier_thumb)}" alt="" loading="lazy">` : '<div class="thumb">写真なし</div>'}
      <div class="body">
        <div class="mgmt">${esc(c.mgmt_no)}</div>
        <div class="brand">${esc(c.brand)} ${c.ai_pick ? '<span class="chip ai">AIのおすすめ</span>' : ''}
          ${c.status === 'listed' ? `<span class="chip ok">出品中${c.channel ? '・' + esc(c.channel) : ''}</span>` : c.status === 'sold' ? '<span class="chip skipped">売れた</span>' : '<span class="chip duplicate">未出品</span>'}</div>
        <div class="nm">${esc(itemLabel(c))}</div>
      </div>
      <div class="when">仕入れ<br>${esc(c.purchase_date.slice(5).replace('-', '/'))}</div>
    </button>`;

  $view.innerHTML = `
    <div class="strip">${d.photos.map((p) => `<img src="/api/photos/img/${esc(p.drive_id)}?s=600" alt="" loading="lazy">`).join('')}</div>
    <p class="note">${d.photos.length}枚・横にスクロールして全部見られます</p>
    <div id="ai-box"></div>
    ${f.status === 'assigned' ? `
      <div class="card assigned-box">
        <div><div class="note">割り当て済み</div><div class="mgmt" style="font-size:16px">${esc(f.mgmt_no)}</div></div>
        <button class="btn small ghost" id="unassign">外す</button>
      </div>` : f.status === 'ignored' ? `
      <div class="card assigned-box">
        <div class="note">対象外にしています</div>
        <button class="btn small ghost" id="unassign">未割り当てに戻す</button>
      </div>` : ''}
    ${f.status !== 'ignored' ? `
      <div class="card" style="padding-bottom:8px">
        <h2>${f.status === 'assigned' ? '別の商品に変える' : 'どの商品の写真ですか？'}</h2>
        <input class="search" id="cq" type="search" placeholder="管理番号・ブランド・商品名で絞り込む" style="margin-bottom:8px">
        <div class="cands" id="cands"></div>
      </div>
      ${f.status === 'unassigned' ? '<button class="linkbtn" id="ignore">在庫の商品ではない（対象外にする）</button>' : ''}` : ''}`;

  const render = (q = '') => {
    const $c = document.getElementById('cands');
    if (!$c) return;
    const k = q.trim().toLowerCase();
    const list = d.candidates.filter((c) => !k || [c.mgmt_no, c.brand, c.name, c.category, c.model].some((v) => (v || '').toLowerCase().includes(k)));
    if (!list.length) { $c.innerHTML = `<div class="empty" style="padding:20px">${d.candidates.length ? '合う商品がありません' : '写真のない在庫がありません'}</div>`; return; }
    const before = list.filter((c) => c.before_shoot);
    const after = list.filter((c) => !c.before_shoot);
    $c.innerHTML = before.map(candRow).join('') +
      (after.length ? `<div class="sep">撮影日（${esc(f.shoot_date)}）より後に仕入れた商品</div>${after.map(candRow).join('')}` : '');
    $c.querySelectorAll('.cand').forEach((b) => b.addEventListener('click', () => assign(id, Number(b.dataset.id), f)));
  };
  render();
  document.getElementById('cq')?.addEventListener('input', (ev) => render(ev.target.value));

  // Geminiに写真を見せて、どの商品かを当ててもらう（未割り当ての時だけ・1回だけ）
  const $ai = document.getElementById('ai-box');
  const showAi = (r) => {
    if (!r.item_id) { $ai.innerHTML = `<div class="card ai-card"><div class="note">AI：当てはまる商品が見つかりませんでした。${esc(r.reason || '')}</div></div>`; return; }
    const c = d.candidates.find((x) => x.id === r.item_id);
    if (!c) return;
    $ai.innerHTML = `
      <div class="card ai-card">
        <div class="ai-head"><span class="chip ai">AIのおすすめ</span><span class="note">確からしさ ${Math.round((r.confidence || 0) * 100)}%</span></div>
        <div class="mgmt" style="font-size:16px">${esc(c.mgmt_no)}</div>
        <div><span class="brand">${esc(c.brand)}</span> <span class="nm" style="display:inline">${esc(itemLabel(c))}</span></div>
        <p class="note" style="margin:6px 0 10px">${esc(r.reason || '')}</p>
        <button class="btn" id="ai-ok">この商品に割り当てる</button>
      </div>`;
    document.getElementById('ai-ok').addEventListener('click', () => assign(id, c.id, f));
  };
  if (f.status === 'unassigned' && $ai) {
    if (f.ai_item_id) {
      showAi({ item_id: f.ai_item_id, confidence: f.ai_confidence, reason: f.ai_reason });
    } else if (d.candidates.length) {
      $ai.innerHTML = '<div class="card ai-card"><div class="note">AIが写真を見て、どの商品か探しています…</div></div>';
      try {
        const r = await api(`/api/photos/folders/${id}/suggest`, { method: 'POST' });
        if (location.hash !== `#/photos/${id}`) return;
        d.candidates.forEach((c) => { c.ai_pick = c.id === r.item_id ? 1 : 0; });
        d.candidates.sort((a, b) => b.ai_pick - a.ai_pick);
        render(document.getElementById('cq')?.value || '');
        showAi(r);
      } catch (e) {
        $ai.innerHTML = `<div class="card ai-card"><div class="note">AIで探せませんでした：${esc(e.message)}</div></div>`;
      }
    }
  }
  document.getElementById('unassign')?.addEventListener('click', async () => {
    await api(`/api/photos/folders/${id}/assign`, { method: 'POST', body: JSON.stringify({ unassign: true }) });
    toast('割り当てを外しました'); viewFolder(id); refreshBadge();
  });
  document.getElementById('ignore')?.addEventListener('click', async () => {
    await api(`/api/photos/folders/${id}/assign`, { method: 'POST', body: JSON.stringify({ ignore: true }) });
    toast('対象外にしました'); location.hash = '#/photos';
  });
}

async function assign(folderId, itemId, f) {
  try {
    const r = await api(`/api/photos/folders/${folderId}/assign`, { method: 'POST', body: JSON.stringify({ item_id: itemId }) });
    toast(`${f.date_label} の ${f.number} 番 → ${r.mgmt_no}`);
    refreshBadge();
    // 1枚目に黄色い枠を付けてサムネイルにする（画面は先に進める）
    if (r.first_photo_id) createThumb(r.item_id, r.first_photo_id).catch((e) => toast(`サムネイル：${e.message}`));
    // 次の未割り当てへ進む
    const d = await api('/api/photos/folders?status=unassigned');
    const next = d.folders.find((x) => x.drive_id !== folderId);
    location.hash = next ? `#/photos/${next.drive_id}` : '#/photos';
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- ログイン・設定 ---------- */
let loginShown = false;
function showLogin() {
  if (loginShown) return;
  loginShown = true;
  setHeader('ログイン', '');
  $view.innerHTML = `
    <div class="card" style="margin-top:24px">
      <h2>在庫管理にログイン</h2>
      <form id="login-form">
        <label class="field"><span>パスワード</span>
          <input type="password" id="pw" autocomplete="current-password" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);font-size:16px"></label>
        <button class="btn" type="submit">ログイン</button>
      </form>
      <p class="note">一度ログインすると、このiPhone（ブラウザ）では1年間そのまま使えます。</p>
    </div>`;
  document.getElementById('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password: document.getElementById('pw').value }) });
      loginShown = false;
      route(); refreshBadge();
    } catch (e) { toast(e.message); }
  });
}

async function viewSettings() {
  setHeader('設定', '', true);
  const g = new URLSearchParams(location.hash.split('?')[1] || '').get('google');
  if (g) { toast(g === 'ok' ? 'Googleとつながりました' : g); history.replaceState(null, '', '#/settings'); }
  let c = {};
  try { c = await api('/api/config'); } catch { /* ログイン画面に移る */ return; }
  $view.innerHTML = `
    <div class="card">
      <div class="lhead"><h2>Googleとの接続</h2><span class="chip ${c.google_connected ? 'ok' : 'conflict'}">${c.google_connected ? 'つながっています' : 'まだです'}</span></div>
      ${c.google_connected ? `<p class="note" style="margin-top:0">${esc(c.google_email || '')}　外注さんの写真（ドライブ）と、売れた通知（Gmailの「${esc(c.gmail_label)}」ラベル）を読みます。読むだけで、変えたり消したりはしません。</p>` : ''}
      <label class="field"><span>クライアントID（…apps.googleusercontent.com）</span>
        <input type="text" id="g-id" class="num" value="${esc(c.google_client_id)}" autocomplete="off"></label>
      <label class="field"><span>クライアント シークレット ${c.has_client_secret ? '<b>（保存済み。変える時だけ入れる）</b>' : ''}</span>
        <input type="password" id="g-secret" class="num" autocomplete="off" placeholder="${c.has_client_secret ? '••••••••（保存済み）' : ''}"></label>
      <label class="field"><span>承認済みのリダイレクト URI（Google側に登録する文字）</span>
        <input type="text" class="num" readonly value="${esc(c.redirect_uri)}" onclick="this.select()"></label>
      <button class="btn ghost" id="g-save">クライアントを保存</button>
      <a class="btn" style="margin-top:8px;text-align:center;text-decoration:none" href="/api/google/connect" ${c.google_client_id && c.has_client_secret ? '' : 'hidden'}>${c.google_connected ? 'Googleとつなぎ直す' : 'Googleとつなぐ'}</a>
      ${c.google_connected ? '<button class="btn ghost" id="g-check" style="margin-top:8px">今すぐGmailとドライブを確認する</button>' : ''}
    </div>
    <div class="card">
      <div class="lhead"><h2>Geminiの鍵</h2><span class="chip ${c.has_gemini ? 'ok' : 'conflict'}">${c.has_gemini ? '保存済み' : 'まだです'}</span></div>
      <label class="field"><span>APIキー ${c.has_gemini ? '<b>（変える時だけ入れる）</b>' : ''}</span>
        <input type="password" id="gm-key" class="num" autocomplete="off"></label>
      <button class="btn ghost" id="gm-save">鍵を保存</button>
      ${c.has_gemini ? `<p class="note">使うモデル：${esc(c.gemini_model || '')}</p><button class="btn ghost" id="gm-probe">Geminiを試す</button><div id="gm-probe-out" class="note"></div>` : ''}
    </div>
    <div class="card">
      <h2>自宅PCのプログラム</h2>
      <p class="note" style="margin-top:0">下書き作成・毎晩の値下げをするPCのプログラムの設定ファイルです。<b>PCで</b>ダウンロードして、プログラムのフォルダ（C:\\flea-agent）に入れてください。中にPCとアプリをつなぐ合言葉が入っているので、人に渡さないでください。</p>
      <a class="btn ghost" style="text-align:center;text-decoration:none" href="/api/agent-config" download="config.json">config.json をダウンロード</a>
    </div>`
    + `
    <div class="card">
      <h2>パスワードを変える</h2>
      <label class="field"><span>今のパスワード</span><input type="password" id="pw-cur" autocomplete="current-password"></label>
      <label class="field"><span>新しいパスワード（10文字以上）</span><input type="password" id="pw-new" autocomplete="new-password"></label>
      <button class="btn" id="pw-save">変える</button>
      <p class="note">変えると、ほかの端末ではログインし直しになります。</p>
    </div>
    <button class="btn ghost" id="logout">ログアウト</button>`;
  document.getElementById('g-save').addEventListener('click', async () => {
    try {
      await api('/api/config', { method: 'PUT', body: JSON.stringify({ google_client_id: document.getElementById('g-id').value, google_client_secret: document.getElementById('g-secret').value }) });
      toast('保存しました'); viewSettings();
    } catch (e) { toast(e.message); }
  });
  document.getElementById('gm-save').addEventListener('click', async () => {
    try {
      await api('/api/config', { method: 'PUT', body: JSON.stringify({ gemini_api_key: document.getElementById('gm-key').value }) });
      toast('Geminiの鍵を保存しました'); viewSettings();
    } catch (e) { toast(e.message); }
  });
  document.getElementById('gm-probe')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = '試しています…（最大1分ほど）';
    try {
      const r = await api('/api/gemini/probe', { method: 'POST' });
      document.getElementById('gm-probe-out').innerHTML = r.results.map((x) => `${esc(x.model)}：${x.status === 200 ? `◎ ${(x.ms / 1000).toFixed(1)}秒` : `× ${esc(String(x.status))} ${esc(x.answer)}`}`).join('<br>');
    } catch (e) { toast(e.message); }
    ev.target.disabled = false; ev.target.textContent = 'Geminiを試す';
  });
  document.getElementById('g-check')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = '確認中…';
    try {
      const m = await api('/api/sales/gmail-check', { method: 'POST' });
      const d = await api('/api/photos/sync', { method: 'POST' });
      toast(`Gmail：${m.skipped || (m.checked ? `直近3日 ${m.checked}通（記録 ${m.matched}・確認待ち ${m.pending}）` : `直近3日の通知なし（ラベルのメール 全${m.label_total ?? '?'}通）`)}／写真：新しいフォルダ ${d.new_folders}個`);
    } catch (e) { toast(e.message); }
    ev.target.disabled = false; ev.target.textContent = '今すぐGmailとドライブを確認する';
  });
  document.querySelectorAll('#pw-cur, #pw-new').forEach((el) => Object.assign(el.style, { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '16px' }));
  document.getElementById('pw-save').addEventListener('click', async () => {
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ current: document.getElementById('pw-cur').value, next: document.getElementById('pw-new').value }) });
      toast('パスワードを変えました');
      location.hash = '#/';
    } catch (e) { toast(e.message); }
  });
  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });
}

/* ---------- 画面の切り替え ---------- */
function route() {
  const h = location.hash || '#/';
  const m = /^#\/item\/(\d+)$/.exec(h);
  window.scrollTo(0, 0);
  if (m) return viewItem(m[1]);
  if (h === '#/import') return viewImport();
  if (h.startsWith('#/settings')) return viewSettings();
  if (h === '#/sold-inbox') return viewSoldInbox();
  if (h === '#/prices') return viewPrices();
  const pm = /^#\/photos\/([\w-]+)$/.exec(h);
  if (pm) return viewFolder(pm[1]);
  if (h === '#/photos') return viewPhotos();
  return viewItems();
}
window.addEventListener('hashchange', () => { route(); refreshBadge(); });
route();
refreshBadge();
