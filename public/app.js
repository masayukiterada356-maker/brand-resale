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
    <div class="seg" id="views">${Object.entries(VIEWS).map(([k, v]) => `<button data-v="${k}" class="${k === listView ? 'on' : ''}">${v}</button>`).join('')}</div>
    <input class="search" id="q" type="search" placeholder="管理番号・ブランド・商品名で探す" value="${esc(searchText)}">
    <div class="list" id="list"></div>`;
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
          <dt>送料</dt><dd>${yen(it.sale.shipping)}</dd>
          <dt>入金額</dt><dd>${yen(it.sale.payout)}</dd>
          <dt>梱包材</dt><dd>${yen(it.sale.packing)}</dd>
          ${it.sale.photo_fee ? `<dt>撮影代</dt><dd>${yen(it.sale.photo_fee)}</dd>` : ''}
          ${it.sale.extra_shipping ? `<dt>送料（その他）</dt><dd>${yen(it.sale.extra_shipping)}</dd>` : ''}
          ${it.sale.repair ? `<dt>リペア</dt><dd>${yen(it.sale.repair)}</dd>` : ''}
          <dt>利益</dt><dd><b class="${it.sale.profit < 0 ? 'neg' : ''}">${yen(it.sale.profit)}</b></dd>
          ${it.sale.likes != null ? `<dt>いいね・閲覧</dt><dd>${it.sale.likes ?? '—'}・${it.sale.views ?? '—'}</dd>` : ''}
        </dl>
      </div>` : ''}
      ${it.status === 'sold' ? '' : '<div id="listing"></div>'}
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
const imp = { text: '', filename: '', date: todayJst(), overrides: {}, preview: null };

function decodeBytes(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('shift_jis').decode(buf); }
}

const STATUS_LABEL = { ok: '登録する', conflict: '番号が重なる', duplicate: '登録済み', skipped: '対象外' };
const SUPPLIER_NAME = { R: 'コメ兵オークション', E: 'エコリング', N: 'エレノス', C: 'サイファー' };
let importMode = 'csv';

function viewImport() {
  setHeader('取り込み', 'import');
  $view.innerHTML = `
    <div class="card">
      <div class="seg" id="mode">
        <button data-m="csv" class="${importMode === 'csv' ? 'on' : ''}">CSVファイル</button>
        <button data-m="mail" class="${importMode === 'mail' ? 'on' : ''}">メールを貼り付け</button>
      </div>
      ${importMode === 'csv' ? `
      <label class="file ${imp.filename ? 'has' : ''}" id="file-label">
        <input type="file" id="file" accept=".csv,text/csv">
        <span id="file-name">${imp.filename ? esc(imp.filename) : 'コメ兵・エコリングのCSVを選ぶ'}</span>
      </label>` : `
      <label class="field"><span>エレノス・サイファーの注文メールの本文</span>
        <textarea id="mail" rows="7" placeholder="注文確認メールの「注文概要」や「商品詳細」の部分を貼り付けてください">${imp.filename === 'メール' ? esc(imp.text) : ''}</textarea></label>`}
      <label class="field" style="margin-top:12px">
        <span>仕入れ日（管理番号の年・月になります）</span>
        <input type="date" id="date" value="${imp.date}">
      </label>
      <button class="btn" id="go" ${imp.text ? '' : 'disabled'}>中身を確認する</button>
    </div>
    <div id="result"></div>`;

  document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => {
    if (importMode === b.dataset.m) return;
    importMode = b.dataset.m;
    Object.assign(imp, { text: '', filename: '', overrides: {}, preview: null });
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
  document.getElementById('date').addEventListener('change', (ev) => {
    imp.date = ev.target.value;
    if (imp.preview) runPreview();
  });
  document.getElementById('go').addEventListener('click', runPreview);
  if (imp.preview) renderPreview();
}

async function runPreview() {
  const $r = document.getElementById('result');
  $r.innerHTML = '<div class="empty">確認中…</div>';
  try {
    imp.preview = await api('/api/import/preview', {
      method: 'POST',
      body: JSON.stringify({ text: imp.text, purchase_date: imp.date, overrides: imp.overrides }),
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
}

async function runCommit() {
  const btn = document.getElementById('commit');
  btn.disabled = true;
  btn.textContent = '登録中…';
  try {
    const res = await api('/api/import/commit', {
      method: 'POST',
      body: JSON.stringify({ text: imp.text, filename: imp.filename, purchase_date: imp.date, overrides: imp.overrides }),
    });
    toast(`${res.inserted}点を登録しました`);
    Object.assign(imp, { text: '', filename: '', overrides: {}, preview: null });
    location.hash = '#/';
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = 'もう一度登録する';
  }
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
      toast(r.new_folders || r.new_photos ? `新しいフォルダ${r.new_folders}個・写真${r.new_photos}枚を取り込みました` : '新しい写真はありませんでした');
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
      else groups.push({ label: f.date_label, date: f.shoot_date, list: [f] });
    }
    $f.innerHTML = groups.map((g) => `
      <div class="date-h">${esc(g.label)} の撮影・${g.list.length}点</div>
      <div class="grid">${g.list.map((f) => `
        <a class="tile ${f.status}" href="#/photos/${esc(f.drive_id)}">
          ${f.first_photo_id ? `<img src="/api/photos/img/${esc(f.first_photo_id)}?s=300" alt="" loading="lazy">` : '<div class="ph"></div>'}
          <span class="no">${esc(f.number)}</span>
          <div class="cap">${f.mgmt_no ? `<span class="mgmt">${esc(f.mgmt_no)}</span>` : `<span>${f.photo_count}枚</span>`}</div>
        </a>`).join('')}</div>`).join('');
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
        <div class="brand">${esc(c.brand)} ${c.ai_pick ? '<span class="chip ai">AIのおすすめ</span>' : ''}</div>
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

/* ---------- 画面の切り替え ---------- */
function route() {
  const h = location.hash || '#/';
  const m = /^#\/item\/(\d+)$/.exec(h);
  window.scrollTo(0, 0);
  if (m) return viewItem(m[1]);
  if (h === '#/import') return viewImport();
  const pm = /^#\/photos\/([\w-]+)$/.exec(h);
  if (pm) return viewFolder(pm[1]);
  if (h === '#/photos') return viewPhotos();
  return viewItems();
}
window.addEventListener('hashchange', () => { route(); refreshBadge(); });
route();
refreshBadge();
