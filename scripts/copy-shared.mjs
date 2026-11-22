// wrangler dev / deploy の前に自動で動く
// 1. サーバーと画面の両方で使うプログラムを public/shared/ に写す
// 2. public/ の画面のファイルを、Workerの中に入れる形（src/static-files.js）にまとめる
import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

for (const f of ['csv.js', 'brands.js', 'legacy.js']) {
  await mkdir('public/shared', { recursive: true });
  await copyFile(`src/${f}`, `public/shared/${f}`);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
async function walk(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = `${base}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else if (TYPES[extname(e.name)]) out.push(rel);
  }
  return out;
}
const files = {};
for (const rel of await walk('public')) {
  const buf = await readFile(join('public', rel));
  files[rel] = { type: TYPES[extname(rel)], b64: buf.toString('base64') };
}
await writeFile('src/static-files.js',
  `// 自動で作ったファイル（scripts/copy-shared.mjs）。直接書き換えない\nexport default ${JSON.stringify(files)};\n`);
