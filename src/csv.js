// CSVの読み込み（ダブルクォート・改行入りの値に対応）

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOMを外す
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // 空行を除く
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// 見出し行を使って、1行ずつ { 列名: 値 } の形にする
export function toRecords(header, rows) {
  return rows.map((r) => {
    const rec = {};
    header.forEach((h, i) => { rec[h.trim()] = (r[i] ?? '').trim(); });
    return rec;
  });
}

// バイト列を文字に戻す（UTF-8でなければShift-JIS）
export function decodeBytes(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}
