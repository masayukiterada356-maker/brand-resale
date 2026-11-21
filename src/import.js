// CSV取り込み：仕入れ先を見分け、行ごとに管理番号と仕入れ値を決める
// データベースに触らない部分なので、そのままテストできる

import { parseCsv, toRecords } from './csv.js';
import { prefixFor } from './codes.js';
import * as komehyo from './suppliers/komehyo.js';
import * as ecoring from './suppliers/ecoring.js';
import * as elenoss from './suppliers/elenoss.js';
import * as cypher from './suppliers/cypher.js';
import * as yahooAuction from './suppliers/yahoo-auction.js';

const PARSERS = [komehyo, ecoring];
const TEXT_PARSERS = [elenoss, cypher, yahooAuction]; // メール本文を貼り付けて読む仕入れ先

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
  if (!text || !text.trim()) throw new Error('中身が空です');
  let parser = TEXT_PARSERS.find((t) => t.detectText(text));
  let parsed;
  if (parser) {
    parsed = parser.parseText(text);
    if (!parsed.length) throw new Error('メールから商品を読み取れませんでした');
  } else {
    const rows = parseCsv(text);
    const header = rows[0].map((h) => h.trim());
    parser = detectSupplier(header);
    if (!parser) {
      throw new Error('この形式はまだ読めません（コメ兵・エコリングのCSV、エレノス・サイファー・ヤフオクのメールに対応）');
    }
    parsed = toRecords(header, rows.slice(1)).map((rec) => parser.parseRecord(rec));
  }

  const prefix = prefixFor(parser.code, purchaseDate);
  const usedMgmt = new Set(existing.mgmtNos || []);
  const usedRefs = new Set(existing.refs || []);
  const legacy = new Set(existing.legacyMgmtNos || []); // 前の管理表から移した商品の管理番号

  const out = [];
  parsed.forEach((p, i) => {
    const line = i + 2; // 行の番号（CSVでは見出しが1行目）
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
    let override = overrides[line]?.trim().toUpperCase();
    // 数字だけ入れた時は、頭の3文字（例：CFK）を自動で付ける
    if (override && /^\d[\d-]*$/.test(override)) override = prefix + override;

    if (override) {
      if (usedMgmt.has(override)) { status = 'conflict'; message = `${override} はすでにあります`; }
      else mgmt = override;
    } else if (p.number_candidates.length && legacy.has(prefix + p.number_candidates[0])) {
      // 前の管理表から移した商品と同じ番号＝同じ商品とみなし、2重に登録しない
      out.push({ ...base, ...p, mgmt_no: prefix + p.number_candidates[0], status: 'duplicate',
        message: '前の管理表から移した商品と同じ管理番号です（登録済み）。別の商品なら管理番号を入力してください' });
      return;
    } else {
      const tried = [];
      for (const num of p.number_candidates) {
        const cand = prefix + num;
        if (!usedMgmt.has(cand)) { mgmt = cand; break; }
        tried.push(cand);
      }
      if (!mgmt && !p.number_candidates.length) {
        status = 'conflict';
      } else if (!mgmt) {
        status = 'conflict';
        message = `${tried[0]} はすでにあります。管理番号を決めてください`;
      } else if (tried.length) {
        message = `${tried[0]} がすでにあるため ${mgmt} にしました`;
      }
    }

    if (mgmt) { usedMgmt.add(mgmt); usedRefs.add(refKey); }
    const warn = (p.warnings || []).filter((w) => !(mgmt && w === '管理番号を入力してください')).join(' / ');
    out.push({
      ...base,
      ...p,
      mgmt_no: mgmt || (p.number_candidates.length ? prefix + p.number_candidates[0] : ''),
      status,
      message: [message, warn].filter(Boolean).join(' / '),
    });
  });

  const count = (s) => out.filter((r) => r.status === s).length;
  return {
    supplier_code: parser.code,
    prefix,
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
