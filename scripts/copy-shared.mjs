// サーバーと画面の両方で使うプログラムを public/shared/ に写す（wrangler dev / deploy の前に自動で動く）
import { mkdir, copyFile } from 'node:fs/promises';
const files = ['csv.js', 'brands.js', 'legacy.js'];
await mkdir('public/shared', { recursive: true });
for (const f of files) await copyFile(`src/${f}`, `public/shared/${f}`);
