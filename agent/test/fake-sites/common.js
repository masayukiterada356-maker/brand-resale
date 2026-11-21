// 練習用のニセのフリマ画面で共通に使う部品（本物の画面の作りをまねたもの）
window.FAKE = {
  state: { photos: 0 },
  tree: {
    'レディース': { 'バッグ': ['トートバッグ', 'ハンドバッグ', 'ショルダーバッグ', 'その他'], 'アクセサリー': ['ネックレス', 'ピアス', 'リング'], '財布': ['長財布', '折り財布'] },
    'メンズ': { 'バッグ': ['トートバッグ'] },
  },
  brands: ['GUCCI', 'HERMES', 'LOUIS VUITTON', 'TIFFANY', 'VALEXTRA', 'POLENE', 'PIERRE HARDY', 'BALENCIAGA'],
  post(host, data) { return fetch(location.origin + '/__save', { method: 'POST', body: JSON.stringify(data) }); },
};
