// Googleドライブの読み取り（読むだけ。書き込み・削除はしない）
//
// 本番：MASAさんのGoogleアカウントの「更新トークン」で読む
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN（Workerのシークレット）
// 手元の確認：DRIVE_MOCK=1 にすると、ダミーのドライブを使う

const FOLDER = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';

let cachedToken = null; // { token, exp }

export async function accessToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Googleにつながりません（${data.error || res.status}）。接続の設定をやり直してください`);
  cachedToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

class GoogleDrive {
  constructor(env) { this.env = env; }

  // 1つのフォルダの中身を取る（全ページ）
  // ※ 複数のフォルダを OR でまとめて聞くと、Googleドライブは結果を途中までしか返さないことがあるので、必ず1つずつ聞く
  async listFolder(parentId, { folders }) {
    const out = [];
    const type = folders ? `mimeType = '${FOLDER}'` : "mimeType contains 'image/'";
    const q = `'${parentId}' in parents and ${type} and trashed = false`;
    let pageToken = '';
    let calls = 0;
    do {
      const params = new URLSearchParams({
        q, pageSize: '1000', fields: 'nextPageToken, incompleteSearch, files(id, name, parents, createdTime)',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`${API}/files?${params}`, {
        headers: { authorization: `Bearer ${await accessToken(this.env)}` },
      });
      calls++;
      const data = await res.json();
      if (!res.ok) throw new Error(`ドライブを読めません：${data.error?.message || res.status}`);
      out.push(...data.files.map((f) => ({ ...f, parent: parentId })));
      pageToken = data.nextPageToken || '';
    } while (pageToken && calls < 10);
    this.calls = (this.calls || 0) + calls;
    return out;
  }

  async listChildren(parentIds, opts) {
    const out = [];
    for (const id of parentIds) out.push(...(await this.listFolder(id, opts)));
    return out;
  }

  // 小さめの画像（一覧・割り当て画面用）
  async image(fileId, size) {
    const token = await accessToken(this.env);
    const meta = await fetch(`${API}/files/${fileId}?fields=thumbnailLink,mimeType&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    if (meta.thumbnailLink) {
      const url = meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) return { body: await res.arrayBuffer(), type: res.headers.get('content-type') || 'image/jpeg' };
    }
    // 縮小画像が取れない時は元の画像
    const res = await fetch(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('画像を読めません');
    return { body: await res.arrayBuffer(), type: meta.mimeType || 'image/jpeg' };
  }
}

/* ---------- ダミーのドライブ（手元の確認用） ---------- */
const MOCK_COLORS = ['#8a5a3c', '#2f3b4c', '#b0894f', '#5b6b4a', '#7c2d3b', '#3d5c73'];

class MockDrive {
  constructor() {
    const root = 'mock-root';
    this.nodes = [];
    const dates = [
      { id: 'mock-d1114', name: '11/14', createdTime: '2026-11-14T01:28:16Z', count: 6 },
      { id: 'mock-d1025', name: '10/25', createdTime: '2026-10-24T05:37:50Z', count: 2 },
    ];
    for (const d of dates) {
      this.nodes.push({ id: d.id, name: d.name, parent: root, createdTime: d.createdTime, folder: true });
      for (let n = 1; n <= d.count; n++) {
        const fid = `${d.id}-f${n}`;
        this.nodes.push({ id: fid, name: String(n), parent: d.id, createdTime: d.createdTime, folder: true });
        const photos = 3 + (n % 3);
        for (let k = 1; k <= photos; k++) {
          this.nodes.push({ id: `${fid}-p${k}`, name: `IMG_${3600 + n * 10 + k}.jpg`, parent: fid, createdTime: d.createdTime, folder: false });
        }
      }
    }
  }
  async listChildren(parentIds, { folders }) {
    const set = new Set(parentIds);
    return this.nodes.filter((n) => set.has(n.parent) && n.folder === !!folders);
  }
  async listFolder(parentId, opts) { return this.listChildren([parentId], opts); }
  async image(fileId) {
    const m = /^mock-d(\d+)-f(\d+)-p(\d+)$/.exec(fileId) || [];
    const color = MOCK_COLORS[(Number(m[2]) || 0) % MOCK_COLORS.length];
    const label = m[1] ? `${m[1].slice(0, -2)}/${m[1].slice(-2)}  No.${m[2]}` : fileId;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <rect width="400" height="400" fill="#efece6"/>
      <rect x="90" y="130" width="220" height="170" rx="22" fill="${color}"/>
      <path d="M150 130v-22a50 50 0 0 1 100 0v22" fill="none" stroke="${color}" stroke-width="14"/>
      <text x="200" y="350" font-family="sans-serif" font-size="26" text-anchor="middle" fill="#333">${label}  写真${m[3] || ''}</text>
    </svg>`;
    return { body: new TextEncoder().encode(svg), type: 'image/svg+xml' };
  }
}

export function driveFor(env) {
  if (env.DRIVE_MOCK === '1') return new MockDrive();
  if (!env.GOOGLE_REFRESH_TOKEN) throw new Error('Googleドライブへの接続がまだ設定されていません');
  return new GoogleDrive(env);
}

export function driveRoot(env) {
  return env.DRIVE_MOCK === '1' ? 'mock-root' : env.DRIVE_ROOT_FOLDER_ID;
}
