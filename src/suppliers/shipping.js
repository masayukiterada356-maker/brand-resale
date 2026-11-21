// 送料は仕入れ値に含める。1回の注文に複数の商品がある時は均等に分ける（端数は1点目）
export function addShipping(rows, shipping) {
  if (!shipping || !rows.length) return;
  const each = Math.floor(shipping / rows.length);
  rows.forEach((r, i) => {
    const part = each + (i === 0 ? shipping - each * rows.length : 0);
    r.cost += part;
    r.details = { ...r.details, 送料: `${part.toLocaleString()}円` };
    r.warnings.push(rows.length > 1
      ? `送料${shipping.toLocaleString()}円を${rows.length}点で分け、${part.toLocaleString()}円を仕入れ値に含めました`
      : `送料${shipping.toLocaleString()}円を仕入れ値に含めました`);
  });
}
