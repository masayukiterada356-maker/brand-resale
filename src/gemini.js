// Gemini（Google のAI）で出品文・推奨価格を作る／写真がどの商品かを当てる
// 鍵：GEMINI_API_KEY（Workerのシークレット）。手元の確認は GEMINI_MOCK=1 でダミーを使う

import { Buffer } from 'node:buffer';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export const CONDITIONS = [
  '新品、未使用', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり', '全体的に状態が悪い',
];
export const RANK_LABELS = ['新品', '極美品', '美品', '良品', '並品', '難あり'];

// 説明文の最後に必ず付ける決まった文（今の出品管理シートと同じ）
export function footer(mgmtNo) {
  return `★フォロー割あり！
コメントにてお知らせください(*^▽^*)

ご覧いただきありがとうございます♪
皆様に安心してご購入いただくために、返品を受け付けております(^^)詳しくは私のプロフィール欄をご確認ください✨

資格・免許
愛知県公安委員会
 古物商許可証No.541412205500号

⭐️全額返金保証⭐️
万が一、コピー品であった場合や説明文にない不具合があった場合には、全額返金対応致します。
必ず受け取り評価前にご連絡ください。


お得なブランド一覧
✨✨✨✨✨✨✨✨✨✨
#グリフィーの出品商品一覧はこちら
✨✨✨✨✨✨✨✨✨✨

⭐️購入先
愛知県公安認可の正規ブランド品買取販売店からお譲り頂いております。
鑑定済みの確実な正規品です、ご安心下さい。 万が一正規品ではなかった場合は返品対応させて頂きます。

管理番号：${mgmtNo}`;
}

// AIが作った部品を、今のシートと同じ形の説明文に組み立てる
export function buildDescription(parts, mgmtNo) {
  const details = (parts.details || []).map((d) => `・${d.label}：${d.value}`).join('\n');
  return [
    parts.keywords,
    '',
    '',
    '■ 商品状態',
    parts.condition_text,
    '',
    '',
    parts.intro,
    '',
    '■ 商品詳細',
    details,
    '',
    '',
    footer(mgmtNo),
  ].join('\n');
}

const LISTING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: '出品タイトル。40文字以内' },
    rank_label: { type: 'STRING', enum: RANK_LABELS },
    condition: { type: 'STRING', enum: CONDITIONS },
    target: { type: 'STRING', enum: ['レディース', 'メンズ', 'ユニセックス'] },
    category: { type: 'STRING', description: 'フリマのカテゴリ。大分類 / 小分類。例：バッグ / トートバッグ、アクセサリー / ネックレス、財布 / 長財布' },
    keywords: { type: 'STRING' },
    condition_text: { type: 'STRING' },
    intro: { type: 'STRING' },
    details: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['label', 'value'] } },
    price: { type: 'INTEGER', description: 'メルカリでの推奨価格（円）' },
    price_reason: { type: 'STRING' },
  },
  required: ['title', 'rank_label', 'condition', 'target', 'category', 'keywords', 'condition_text', 'intro', 'details', 'price', 'price_reason'],
};

const EXAMPLE = `【タイトルの例】
【美品】ロエベ フォント トート スモール ラフィア 2WAY かごバッグ 黒
【良品】ロエベ フラメンコ クラッチ ミニ ショルダーバッグ ダークバター
【極美品】ヴァレクストラ イジィデ 2WAY ハンドバッグ ホワイト 袋付

【説明文の部品の例】
keywords: LOEWE ロエベ フォント トート スモール ラフィア 2WAY かごバッグ ハンドバッグ ショルダーバッグ ロゴ ブラック 黒 保存袋付
condition_text: ラフィア素材特有のわずかな毛羽立ちは見られますが、目立つ汚れや型崩れはなく、使用感の少ない大変綺麗な美品（ABランク）です。保存袋付。
intro: LOEWE（ロエベ）の大人気モデル「ロエベ フォント トート スモール（LOEWE Font Tote Small）」ラフィア2WAYかごバッグです。
シックなブラックの天然ラフィアを手編みしたスクエアフォルムに、フロントのコントラストカラーの「LOEWE」ロゴが洗練された存在感を放ちます。
付属のレザーストラップで斜め掛けや肩掛けも可能。シーズンレスでコーディネートの主役になる逸品です。専用保存袋が付属します。
details: ブランド：LOEWE（ロエベ） / モデル：フォント トート スモール（692350） / カラー：ブラック（黒）× ホワイトロゴ / 素材：ラフィア × カーフレザー / 仕様：オープントップ開閉、取り外し・調節可能ショルダーストラップ / 付属品：専用保存袋`;

function listingPrompt(item) {
  const info = {
    ブランド: item.brand,
    品名: item.category,
    商品名: item.name,
    品番: item.model,
    仕入れ先のランク: item.rank,
    状態メモ: item.notes,
    付属品: item.accessories,
    詳細: item.details,
    仕入れ値: item.cost,
  };
  return `あなたはブランド中古品をフリマ（メルカリ・ラクマ・ヤフーフリマ）で販売するプロです。
写真と仕入れ情報から、出品タイトル・説明文の部品・推奨価格を作ってください。

# ルール
- タイトルは「【状態】ブランドのカタカナ＋モデル名＋素材＋種類＋色＋付属品」。40文字以内。
- 状態の目安：Aランク＝極美品、ABランク＝美品、Bランク＝良品、未使用＝新品。写真と状態メモで判断する。
- condition はメルカリの選択肢から選ぶ。
- condition_text は傷・汚れを正直に書き、最後に（〇ランク）と付属品を書く。
- intro は3行（改行で区切る）。モデルの魅力・特徴・使い方。
- details はブランド・モデル・シリアル（分かれば）・原産国（分かれば）・カラー・素材・仕様・付属品。分からない項目は書かない。推測で原産国やシリアルを作らない。
- 写真と仕入れ情報にないことは書かない。コピー品・偽物を疑わせる表現は使わない。
- price はメルカリでの推奨価格。相場と状態から決め、利益率（(価格−仕入れ値)÷価格）が30%以上を目安に、18,800円・46,800円のようなキリのいい金額にする。
- price_reason に価格の理由を1〜2文で書く。

${EXAMPLE}

# この商品の仕入れ情報
${JSON.stringify(info, null, 2)}`;
}

// 使うモデル：GEMINI_MODEL があればそれ。なければ、その鍵で使える「flash」を新しい順に選ぶ
// （一番新しいものが混み合っている時は、次のものを使う）
let modelList = null;
export async function modelCandidates(env) {
  if (env.GEMINI_MODEL) return [env.GEMINI_MODEL];
  if (modelList) return modelList;
  const res = await fetch(`${API}?pageSize=200`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Geminiのモデル一覧を読めません：${data.error?.message || res.status}`);
  const ok = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  const ver = (n) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
  const plain = ok.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => ver(b) - ver(a));
  const lite = ok.filter((n) => /^gemini-[\d.]+-flash-lite$/.test(n)).sort((a, b) => ver(b) - ver(a));
  modelList = [...plain.slice(0, 3), ...lite.slice(0, 1)];
  if (!modelList.length) { modelList = null; throw new Error('使えるGeminiのモデルが見つかりません'); }
  return modelList;
}
export async function pickModel(env) { return (await modelCandidates(env))[0]; }

async function callGemini(env, parts, schema) {
  const models = await modelCandidates(env);
  let lastError = '';
  for (const model of models) {
    // 混み合っている時（503・429）は少し待って1回やり直し、だめなら次のモデルへ
    for (let attempt = 0; attempt < 2; attempt++) {
      // 答えが返ってこないモデルもあるので、40秒で区切って次へ
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 40000);
      let res;
      try {
        res = await fetch(`${API}/${model}:generateContent`, {
          method: 'POST',
          signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.4 },
          }),
        });
      } catch (e) {
        lastError = e.name === 'AbortError' ? `${model} が40秒で答えませんでした` : e.message;
        break; // 次のモデルへ
      } finally { clearTimeout(timer); }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // うまく答えたモデルを、次から先に使う
        if (modelList && modelList[0] !== model) modelList = [model, ...modelList.filter((m) => m !== model)];
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        try { return JSON.parse(text); } catch { throw new Error('Geminiの答えを読めませんでした。もう一度お試しください'); }
      }
      lastError = data.error?.message || String(res.status);
      if ([429, 503].includes(res.status)) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      if ([400, 404].includes(res.status) && /model/i.test(lastError)) break; // このモデルは使えない → 次へ
      if (res.status >= 500) break; // Google側の不調 → 次のモデルへ
      throw new Error(`Geminiのエラー：${lastError}`);
    }
  }
  throw new Error(/demand|overload|429|503|答えません/i.test(lastError)
    ? 'Geminiが混み合っています。少し時間をおいて、もう一度お試しください'
    : `Geminiのエラー：${lastError}`);
}

// 画像を Gemini に渡せる形にする
export async function imagePart(fetchImage) {
  const { body, type } = await fetchImage();
  if (!/^image\/(jpeg|png|webp)/.test(type)) return null; // ダミーのSVGなどは渡さない
  return { inline_data: { mime_type: type.split(';')[0], data: Buffer.from(body).toString('base64') } };
}

export async function generateListing(env, item, images) {
  if (env.GEMINI_MOCK === '1') return mockListing(item);
  if (!env.GEMINI_API_KEY) throw new Error('Geminiの鍵（GEMINI_API_KEY）がまだ設定されていません');
  return callGemini(env, [{ text: listingPrompt(item) }, ...images.filter(Boolean)], LISTING_SCHEMA);
}

/* ---------- 写真がどの商品かを当てる ---------- */

const MATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mgmt_no: { type: 'STRING', description: '一番当てはまる商品の管理番号。どれでもなければ空' },
    confidence: { type: 'NUMBER', description: '0〜1' },
    reason: { type: 'STRING' },
  },
  required: ['mgmt_no', 'confidence', 'reason'],
};

export async function matchFolder(env, candidates, images) {
  if (env.GEMINI_MOCK === '1') return mockMatch(candidates);
  if (!env.GEMINI_API_KEY) throw new Error('Geminiの鍵（GEMINI_API_KEY）がまだ設定されていません');
  const list = candidates.map((c) => ({
    管理番号: c.mgmt_no, ブランド: c.brand, 品名: c.category, 商品名: c.name, 品番: c.model, 状態メモ: c.notes, 付属品: c.accessories,
  }));
  const prompt = `写真は外注さんが撮影したブランド品1点の写真です。下の在庫リストのどの商品か、ブランド・形・色・品名・付属品から判断してください。
自信がなければ confidence を低くし、どれにも当てはまらなければ mgmt_no を空にしてください。reason は日本語で1文。

# 在庫リスト
${JSON.stringify(list, null, 1)}`;
  return callGemini(env, [{ text: prompt }, ...images.filter(Boolean)], MATCH_SCHEMA);
}

/* ---------- ダミー（手元の確認用） ---------- */
function mockListing(item) {
  const kana = { GUCCI: 'グッチ', HERMES: 'エルメス', TIFFANY: 'ティファニー', 'LOUIS VUITTON': 'ルイヴィトン', VALEXTRA: 'ヴァレクストラ' }[item.brand] || item.brand;
  const rank = item.rank === '未使用' ? '新品' : '美品';
  const price = Math.ceil((item.cost / 0.68) / 1000) * 1000 - 200;
  return {
    title: `【${rank}】${kana} ${item.name || ''} ${item.category || ''}`.replace(/\s+/g, ' ').trim().slice(0, 40),
    rank_label: rank,
    condition: item.rank === '未使用' ? '新品、未使用' : '未使用に近い',
    target: 'レディース',
    category: /ネックレス|リング|ピアス/.test(item.category) ? `アクセサリー / ${item.category}` : /財布/.test(item.category) ? '財布 / 長財布' : `バッグ / ${item.category || 'その他'}`,
    keywords: `${item.brand} ${kana} ${item.name || ''} ${item.category || ''}（ダミー）`,
    condition_text: `${item.notes ? item.notes.trim() + 'が見られますが、' : ''}全体的に綺麗な${rank}（ABランク）です。${item.accessories ? item.accessories + '付。' : ''}（ダミーの文です）`,
    intro: `${item.brand}（${kana}）の${item.name || item.category}です。\nこれはGeminiの鍵を入れる前のダミーの文です。\n本番ではGeminiが写真を見て作ります。`,
    details: [
      { label: 'ブランド', value: `${item.brand}（${kana}）` },
      ...(item.name ? [{ label: 'モデル', value: item.name }] : []),
      ...(item.accessories ? [{ label: '付属品', value: item.accessories }] : []),
    ],
    price,
    price_reason: '（ダミー）仕入れ値から利益率30%程度になる金額です。',
  };
}

function mockMatch(candidates) {
  const c = candidates[0];
  return c
    ? { mgmt_no: c.mgmt_no, confidence: 0.82, reason: `（ダミー）写真の形と色が ${c.brand} の${c.category || '商品'}に近いです。` }
    : { mgmt_no: '', confidence: 0, reason: '（ダミー）候補がありません' };
}

// 設定画面の「Geminiを試す」：使えるモデルに短い質問をして、答えるまでの時間を測る
export async function probeGemini(env) {
  const models = await modelCandidates(env);
  const out = [];
  for (const model of models) {
    const t = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '「はい」とだけ答えてください' }] }] }),
      });
      const data = await res.json().catch(() => ({}));
      out.push({ model, status: res.status, ms: Date.now() - t, answer: data.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 20) || data.error?.message?.slice(0, 120) || '' });
    } catch (e) {
      out.push({ model, status: 'timeout', ms: Date.now() - t, answer: e.name === 'AbortError' ? '25秒で答えがありません' : e.message });
    } finally { clearTimeout(timer); }
  }
  return out;
}
