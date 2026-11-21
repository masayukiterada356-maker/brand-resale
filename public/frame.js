// サムネイルに黄色い枠を付ける（iPhoneのブラウザの中で作る）
// 見本（2000×2000）：外側に #FFFF00 の枠が 43px（=2.15%）。写真は正方形の中央を切り出す

export const FRAME = {
  size: 2000,          // 出来上がりの大きさ（正方形）
  color: '#FFFF00',
  ratio: 43 / 2000,    // 枠の太さ（1辺に対する割合）
  smallSize: 300,      // 一覧用
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('写真を読み込めませんでした'));
    img.src = src;
  });
}

function draw(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  // 写真：短い辺に合わせて中央を正方形に切り出す
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.min(w, h);
  g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  // 枠：上下左右に同じ太さで重ねる
  const b = Math.round(size * FRAME.ratio);
  g.fillStyle = FRAME.color;
  g.fillRect(0, 0, size, b);
  g.fillRect(0, size - b, size, b);
  g.fillRect(0, 0, b, size);
  g.fillRect(size - b, 0, b, size);
  return c;
}

const toBlob = (canvas, q) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), 'image/jpeg', q));

// 写真のURL → { full: Blob, small: Blob }
export async function makeFramedThumb(src) {
  const img = await loadImage(src);
  return {
    full: await toBlob(draw(img, FRAME.size), 0.9),
    small: await toBlob(draw(img, FRAME.smallSize), 0.85),
  };
}
