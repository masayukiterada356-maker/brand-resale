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

async function viewItems() {
  setHeader('在庫', 'items');
  $view.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">在庫数</div><div class="v" id="s-count">…</div></div>
      <div class="stat"><div class="k">在庫の仕入れ値合計</div><div class="v" id="s-cost">…</div></div>
    </div>
    <input class="search" id="q" type="search" placeholder="管理番号・ブランド・商品名で探す" value="${esc(searchText)}">
    <div class="list" id="list"></div>`;
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
    const data = await api('/api/items?q=' + encodeURIComponent(searchText));
    document.getElementById('s-count').textContent = `${data.totals.count}点`;
    document.getElementById('s-cost').textContent = yen(data.totals.cost);
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
          <div class="yen">${yen(it.cost)}</div>
          <div class="days">${it.days}日目</div>
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
    $view.innerHTML = `
      ${it.supplier_images.length ? `<div class="gallery">${it.supplier_images.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>
        <p class="note">仕入れ先の写真（確認用）</p>` : ''}
      <div class="card">
        <div class="mgmt">${esc(it.mgmt_no)}</div>
        <div class="brand" style="font-size:18px">${esc(it.brand)}</div>
        <div>${esc(itemLabel(it))}</div>
        <div class="big-cost" style="margin-top:8px">${yen(it.cost)}</div>
        <div class="note">仕入れ値（税込）・仕入れから${it.days}日目</div>
      </div>
      <div class="card">
        <h2>仕入れ</h2>
        <dl class="kv">
          <dt>仕入れ先</dt><dd>${esc(it.supplier_name)}</dd>
          <dt>仕入れ先の番号</dt><dd>${esc(it.supplier_ref)}</dd>
          <dt>仕入れ日</dt><dd>${esc(it.purchase_date)}</dd>
          <dt>落札額</dt><dd>${yen(it.bid_price)}</dd>
          <dt>落札手数料</dt><dd>${yen(it.supplier_fee)}</dd>
          <dt>仕入れ値（税込）</dt><dd>${yen(it.cost)}</dd>
        </dl>
      </div>
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
  } catch (e) {
    $view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ---------- CSV取り込み ---------- */
const imp = { text: '', filename: '', date: todayJst(), overrides: {}, preview: null };

function decodeBytes(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('shift_jis').decode(buf); }
}

const STATUS_LABEL = { ok: '登録する', conflict: '番号が重なる', duplicate: '登録済み', skipped: '対象外' };
const SUPPLIER_NAME = { R: 'コメ兵オークション', E: 'エコリング' };

function viewImport() {
  setHeader('取り込み', 'import');
  $view.innerHTML = `
    <div class="card">
      <label class="file ${imp.filename ? 'has' : ''}" id="file-label">
        <input type="file" id="file" accept=".csv,text/csv">
        <span id="file-name">${imp.filename ? esc(imp.filename) : '仕入れ先のCSVを選ぶ'}</span>
      </label>
      <label class="field" style="margin-top:12px">
        <span>仕入れ日（管理番号の年・月になります）</span>
        <input type="date" id="date" value="${imp.date}">
      </label>
      <button class="btn" id="go" ${imp.text ? '' : 'disabled'}>中身を確認する</button>
    </div>
    <div id="result"></div>`;

  document.getElementById('file').addEventListener('change', async (ev) => {
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
            <span class="mgmt">${esc(r.mgmt_no || r.supplier_ref)}</span>
            <span class="chip ${r.status}">${STATUS_LABEL[r.status]}</span>
          </div>
          ${r.brand !== undefined ? `
          <div class="line1">
            <span class="who"><span class="brand">${esc(r.brand)}</span> <span class="sub">${esc(itemLabel(r))}</span></span>
            <span class="yen">${yen(r.cost)}</span>
          </div>` : ''}
          ${r.message ? `<div class="msg">${esc(r.message)}</div>` : ''}
          ${r.status === 'conflict' || imp.overrides[r.line] ? `
            <input type="text" data-line="${r.line}" placeholder="管理番号を入力" value="${esc(imp.overrides[r.line] || '')}" autocapitalize="characters" autocomplete="off">` : ''}
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

/* ---------- 画面の切り替え ---------- */
function route() {
  const h = location.hash || '#/';
  const m = /^#\/item\/(\d+)$/.exec(h);
  window.scrollTo(0, 0);
  if (m) return viewItem(m[1]);
  if (h === '#/import') return viewImport();
  return viewItems();
}
window.addEventListener('hashchange', route);
route();
