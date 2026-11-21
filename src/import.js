// CSV取り込み：仕入れ先を見分け、行ごとに管理番号と仕入れ値を決める
// データベースに触らない部分なので、そのままテストできる

import { parseCsv, toRecords } from './csv.js';
import { prefixFor } from './codes.js';
import * as komehyo from './suppliers/komehyo.js';
import * as ecoring from './suppliers/ecoring.js';

const PARSERS = [komehyo, ecoring];

export function detectSupplier(header) {
  return PARSERS.find((p) => p.detect(header)) || null;
}

/**
 * @param {string} text CSVの中身（文字に戻したもの）
 * @param {string} purchaseDate 'YYYY-MM-DD'
 * @param {object} existing すでにデータベースにあるもの
 *   { mgmtNos: Set<string>, refs: Set<string>（'R:46-4' の形）}
 * @param {object} overrides 行番号→手で直した管理番号
 */
export function buildPreview(text, purchaseDate, existing = {}, overrides = {}) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('CSVが空です');
  const header = rows[0].map((h) => h.trim());
  const parser = detectSupplier(header);
  if (!parser) {
    throw new Error('この形式のCSVはまだ読めません（今はコメ兵・エコリングに対応）');
  }

  const prefix = prefixFor(parser.code, purchaseDate);
  const usedMgmt = new Set(existing.mgmtNos || []);
  const usedRefs = new Set(existing.refs || []);
  const records = toRecords(header, rows.slice(1));

  const out = [];
  records.forEach((rec, i) => {
    const line = i + 2; // CSVの行番号（見出しが1行目）
    const p = parser.parseRecord(rec);
    if (p.silent) return;
    const base = { line, supplier_ref: p.supplier_ref };

    if (p.skip) { out.push({ ...base, status: 'skipped', message: p.skip }); return; }

    const refKey = `${parser.code}:${p.supplier_ref}`;
    if (usedRefs.has(refKey)) {
      out.push({ ...base, ...p, status: 'duplicate', message: 'この商品はすでに登録されています' });
      return;
    }

    let mgmt = null;
    let status = 'ok';
    let message = '';
    const override = overrides[line]?.trim();

    if (override) {
      if (usedMgmt.has(override)) { status = 'conflict'; message = `${override} はすでにあります`; }
      else mgmt = override;
    } else {
      const tried = [];
      for (const num of p.number_candidates) {
        const cand = prefix + num;
        if (!usedMgmt.has(cand)) { mgmt = cand; break; }
        tried.push(cand);
      }
      if (!mgmt) {
        status = 'conflict';
        message = `${tried[0]} はすでにあります。管理番号を決めてください`;
      } else if (tried.length) {
        message = `${tried[0]} がすでにあるため ${mgmt} にしました`;
      }
    }

    if (mgmt) { usedMgmt.add(mgmt); usedRefs.add(refKey); }
    const warn = (p.warnings || []).join(' / ');
    out.push({
      ...base,
      ...p,
      mgmt_no: mgmt || (prefix + p.number_candidates[0]),
      status,
      message: [message, warn].filter(Boolean).join(' / '),
    });
  });

  const count = (s) => out.filter((r) => r.status === s).length;
  return {
    supplier_code: parser.code,
    purchase_date: purchaseDate,
    rows: out,
    summary: {
      ok: count('ok'),
      conflict: count('conflict'),
      duplicate: count('duplicate'),
      skipped: count('skipped'),
      total_cost: out.filter((r) => r.status === 'ok').reduce((s, r) => s + r.cost, 0),
    },
  };
}
