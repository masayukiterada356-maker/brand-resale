// 管理番号の組み立て：仕入れ先1文字＋年1文字＋月1文字＋数字

const YEAR_LETTERS = 'ABCDEFGHIJ';     // 西暦の末尾 1=A … 9=I, 0=J
const MONTH_LETTERS = 'ABCDEFGHIJKL';  // 1月=A … 12月=L

export function yearLetter(year) {
  return YEAR_LETTERS[(year % 10 + 9) % 10];
}

export function monthLetter(month) {
  if (month < 1 || month > 12) throw new Error(`月が正しくありません: ${month}`);
  return MONTH_LETTERS[month - 1];
}

// purchaseDate: 'YYYY-MM-DD'
export function prefixFor(supplierCode, purchaseDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(purchaseDate || '');
  if (!m) throw new Error(`仕入れ日が正しくありません: ${purchaseDate}`);
  return supplierCode + yearLetter(Number(m[1])) + monthLetter(Number(m[2]));
}
