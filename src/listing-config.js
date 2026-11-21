// 出品の決まりごと（第3段階の下書き作成で使う）

export const SHIPPING = {
  mercari: { method: 'らくらくメルカリ便', payer: '送料込み（出品者負担）', days: '1~2日で発送', from: '愛知県' },
  rakuma:  { method: 'かんたんラクマパック', payer: '送料込み（出品者負担）', days: '1~2日で発送', from: '愛知県' },
  yahoo:   { method: 'おてがる配送（ヤマト運輸）', payer: '送料込み（出品者負担）', days: '1~2日で発送', from: '愛知県' },
};

// ラクマ・ヤフーフリマはメルカリより1,000円安く始める
export const PRICE_OFFSET = { mercari: 0, rakuma: -1000, yahoo: -1000 };
