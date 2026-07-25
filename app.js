/* ============================================================
 * 冷蔵庫コンパス — 冷蔵庫管理アプリ プロトタイプ
 * OCR / バーコード / AIレシピ生成はモック動作。
 * データは localStorage に保存。
 * ============================================================ */

// ---------- カテゴリと賞味期限デフォルト（日数） ----------
const CATEGORIES = {
  "野菜":    7,
  "肉":      3,
  "魚":      2,
  "卵":     14,
  "乳製品": 10,
  "豆腐・大豆製品": 5,
  "加工食品": 30,
  "調味料": 180,
  "飲料":   30,
  "その他":  7,
};

// ---------- バーコード（JAN）モック辞書 ----------
const JAN_DB = {
  "4901111111111": { name: "キッコーマン しょうゆ 500ml", category: "調味料",       unit: "ml", qty: 500 },
  "4902222222222": { name: "明治おいしい牛乳 900ml",     category: "乳製品",       unit: "ml", qty: 900 },
  "4903333333333": { name: "シャウエッセン ウインナー",   category: "加工食品",     unit: "個", qty: 1 },
  "4904444444444": { name: "味の素 コンソメ 顆粒",       category: "調味料",       unit: "g",  qty: 50 },
  "4905555555555": { name: "カゴメ トマトケチャップ",     category: "調味料",       unit: "ml", qty: 500 },
  "4906666666666": { name: "森永 絹ごし豆腐 3個パック",   category: "豆腐・大豆製品", unit: "個", qty: 3 },
};

// ---------- 単位換算（大さじ/小さじ ⇔ ml/g） ----------
const SPOON_ML = { tbsp: 15, tsp: 5 };          // 液体: 大さじ15ml / 小さじ5ml
const SPOON_GRAMS = {                             // 粉末/固形の大さじ1・小さじ1あたり重量(g)
  "塩":            { tbsp: 18, tsp: 6 },
  "砂糖":          { tbsp: 9,  tsp: 3 },
  "鶏がらスープの素": { tbsp: 9,  tsp: 3 },
  "小麦粉":        { tbsp: 9,  tsp: 3 },
  "片栗粉":        { tbsp: 9,  tsp: 3 },
  "味噌":          { tbsp: 18, tsp: 6 },
  "だしの素":       { tbsp: 9,  tsp: 3 },
  "コンソメ":       { tbsp: 9,  tsp: 3 },
};
const DEFAULT_SPOON_GRAMS = { tbsp: 10, tsp: 3 }; // 未知粉末のフォールバック

const LIQUID_WORDS = ["醤油","しょうゆ","酒","みりん","油","ケチャップ","ソース","めんつゆ","ポン酢","酢","マヨネーズ","だし汁","牛乳"];
const POWDER_WORDS = ["塩","砂糖","小麦粉","片栗粉","鶏がら","だしの素","コンソメ","味噌"];
function defaultUnitFor(name, category){
  if (LIQUID_WORDS.some(w=>name.includes(w))) return "ml";
  if (POWDER_WORDS.some(w=>name.includes(w))) return "g";
  return "個";
}
function spoonToAmount(name, unit, spoons){ // spoons={tbsp?,tsp?} → 消費量(ml or g)を整数で返す
  const t = spoons.tbsp||0, s = spoons.tsp||0;
  if (unit === "ml") return Math.round(t*SPOON_ML.tbsp + s*SPOON_ML.tsp);
  if (unit === "g"){ const g = SPOON_GRAMS[name] || DEFAULT_SPOON_GRAMS; return Math.round(t*g.tbsp + s*g.tsp); }
  return 0;
}

// ---------- レシートOCR モック結果 ----------
const OCR_SAMPLE = [
  { name: "豚こま切れ肉", category: "肉" },
  { name: "キャベツ",     category: "野菜" },
  { name: "にんじん",     category: "野菜" },
  { name: "牛乳",         category: "乳製品" },
  { name: "卵 10個入",    category: "卵" },
  { name: "もやし",       category: "野菜" },
];

// ---------- レシピDB（モックAIの知識ベース） ----------
const RECIPES = [
  {
    name: "肉じゃが",
    ingredients: ["豚肉", "じゃがいも", "にんじん", "玉ねぎ", "しょうゆ", "みりん"],
    amounts: { "しょうゆ": { tbsp: 1.5 }, "みりん": { tbsp: 1 } },
    steps: ["じゃがいも・にんじん・玉ねぎを一口大に切る", "豚肉を炒め、野菜を加えてさらに炒める", "だし・しょうゆ・みりんを加えて15分煮込む"],
    ref: "https://cookpad.com/search/%E8%82%89%E3%81%98%E3%82%83%E3%81%8C",
  },
  {
    name: "野菜炒め",
    ingredients: ["豚肉", "キャベツ", "もやし", "にんじん", "しょうゆ"],
    amounts: { "しょうゆ": { tbsp: 1.5 } },
    steps: ["野菜を食べやすい大きさに切る", "豚肉を強火で炒め、色が変わったら野菜を投入", "塩こしょう・しょうゆで味付けして完成"],
    ref: "https://www.kurashiru.com/search?query=%E9%87%8E%E8%8F%9C%E7%82%92%E3%82%81",
  },
  {
    name: "豚汁",
    ingredients: ["豚肉", "にんじん", "大根", "豆腐", "味噌", "ねぎ"],
    amounts: { "味噌": { tbsp: 1 } },
    steps: ["野菜と豆腐を切る", "豚肉と野菜を軽く炒めて水を加え煮る", "火が通ったら味噌を溶き入れ、ねぎを散らす"],
    ref: "https://cookpad.com/search/%E8%B1%9A%E6%B1%81",
  },
  {
    name: "オムライス",
    ingredients: ["卵", "ごはん", "玉ねぎ", "ケチャップ", "鶏肉"],
    amounts: { "ケチャップ": { tbsp: 2 } },
    steps: ["玉ねぎと鶏肉を炒め、ごはんとケチャップでチキンライスを作る", "溶き卵を薄く焼く", "チキンライスを卵で包み、ケチャップをかける"],
    ref: "https://www.kurashiru.com/search?query=%E3%82%AA%E3%83%A0%E3%83%A9%E3%82%A4%E3%82%B9",
  },
  {
    name: "麻婆豆腐",
    ingredients: ["豆腐", "ひき肉", "ねぎ", "豆板醤", "しょうゆ"],
    amounts: { "豆板醤": { tsp: 1 }, "しょうゆ": { tbsp: 1.5 } },
    steps: ["ひき肉を炒め、豆板醤を加えて香りを出す", "水・しょうゆを加え、角切りの豆腐を入れて煮る", "水溶き片栗粉でとろみをつけ、ねぎを散らす"],
    ref: "https://cookpad.com/search/%E9%BA%BB%E5%A9%86%E8%B1%86%E8%85%90",
  },
  {
    name: "親子丼",
    ingredients: ["鶏肉", "卵", "玉ねぎ", "しょうゆ", "みりん", "ごはん"],
    amounts: { "しょうゆ": { tbsp: 1.5 }, "みりん": { tbsp: 1 } },
    steps: ["玉ねぎと鶏肉をだし・しょうゆ・みりんで煮る", "溶き卵を回し入れ、半熟で火を止める", "ごはんにのせて完成"],
    ref: "https://www.kurashiru.com/search?query=%E8%A6%AA%E5%AD%90%E4%B8%BC",
  },
  {
    name: "焼きうどん",
    ingredients: ["うどん", "豚肉", "キャベツ", "にんじん", "しょうゆ"],
    amounts: { "しょうゆ": { tbsp: 1.5 } },
    steps: ["豚肉と野菜を炒める", "うどんを加えてほぐしながら炒める", "しょうゆとかつお節で味付けする"],
    ref: "https://cookpad.com/search/%E7%84%BC%E3%81%8D%E3%81%86%E3%81%A9%E3%82%93",
  },
  {
    name: "チャーハン",
    ingredients: ["ごはん", "卵", "ねぎ", "ハム", "しょうゆ"],
    amounts: { "しょうゆ": { tbsp: 1.5 } },
    steps: ["溶き卵を半熟に炒めて一度取り出す", "ごはんとハム・ねぎを炒め、卵を戻す", "塩こしょう・しょうゆで味を調える"],
    ref: "https://www.kurashiru.com/search?query=%E3%83%81%E3%83%A3%E3%83%BC%E3%83%8F%E3%83%B3",
  },
  {
    name: "ポトフ",
    ingredients: ["ウインナー", "キャベツ", "にんじん", "じゃがいも", "コンソメ"],
    amounts: { "コンソメ": { tsp: 1 } },
    steps: ["野菜を大きめに切る", "鍋に材料とコンソメ・水を入れて20分煮込む", "塩こしょうで味を調える"],
    ref: "https://cookpad.com/search/%E3%83%9D%E3%83%88%E3%83%95",
  },
  {
    name: "豚の生姜焼き",
    ingredients: ["豚肉", "玉ねぎ", "しょうが", "しょうゆ", "みりん"],
    amounts: { "しょうゆ": { tbsp: 1.5 }, "みりん": { tbsp: 1 } },
    steps: ["しょうが・しょうゆ・みりんでタレを作る", "豚肉と玉ねぎを炒める", "タレを絡めて照りが出たら完成"],
    ref: "https://www.kurashiru.com/search?query=%E7%94%9F%E5%A7%9C%E7%84%BC%E3%81%8D",
  },
  {
    name: "味噌汁（具だくさん）",
    ingredients: ["豆腐", "もやし", "ねぎ", "味噌"],
    amounts: { "味噌": { tbsp: 1 } },
    steps: ["だし汁を沸かし、もやしと豆腐を入れる", "火が通ったら味噌を溶く", "ねぎを散らして完成"],
    ref: "https://cookpad.com/search/%E5%91%B3%E5%99%8C%E6%B1%81",
  },
  {
    name: "キャベツと卵のお好み焼き風",
    ingredients: ["キャベツ", "卵", "小麦粉", "ソース"],
    amounts: { "小麦粉": { tbsp: 2 }, "ソース": { tbsp: 1 } },
    steps: ["キャベツを千切りにし、卵・小麦粉・水と混ぜる", "フライパンで両面を焼く", "ソースとマヨネーズをかける"],
    ref: "https://www.kurashiru.com/search?query=%E3%81%8A%E5%A5%BD%E3%81%BF%E7%84%BC%E3%81%8D",
  },
];

// 食材名のゆらぎ吸収（在庫名 ⇔ レシピ材料名のマッチング用）
const ALIASES = {
  "豚肉": ["豚こま", "豚バラ", "豚ロース", "豚こま切れ"],
  "鶏肉": ["鶏もも", "鶏むね", "ささみ"],
  "ひき肉": ["挽き肉", "合いびき", "豚ひき", "鶏ひき"],
  "卵": ["たまご", "玉子"],
  "しょうゆ": ["醤油"],
  "豆腐": ["絹ごし", "木綿"],
  "ウインナー": ["ソーセージ", "シャウエッセン"],
  "牛乳": ["ミルク"],
  "ねぎ": ["長ねぎ", "青ねぎ", "万能ねぎ"],
  "ケチャップ": ["トマトケチャップ"],
  "コンソメ": ["ブイヨン"],
};

// 部分一致の誤マッチ除外（例：「玉ねぎ」は「ねぎ」ではない）
const NEGATIVE_MATCH = {
  "ねぎ": ["玉ねぎ", "たまねぎ", "タマネギ"],
};

// ---------- 状態 ----------
const STORE_KEY = "fridge-compass-v1";
let state = { inventory: [], shopping: [], notifyTime: "07:30", alertDismissed: false };

function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

function load() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    try { state = { ...state, ...JSON.parse(raw) }; return; } catch (e) { /* fallthrough */ }
  }
  seedSample();
}

// 初回起動用サンプルデータ
function seedSample() {
  const today = new Date();
  const d = (n) => toYmd(addDays(today, n));
  state.inventory = [
    mkItem("豚こま切れ肉", 1, "肉", d(1), "個"),
    mkItem("キャベツ", 1, "野菜", d(2), "個"),
    mkItem("卵", 6, "卵", d(10), "個"),
    mkItem("牛乳", 1, "乳製品", d(5), "個"),
    mkItem("絹ごし豆腐", 2, "豆腐・大豆製品", d(3), "個"),
    mkItem("にんじん", 3, "野菜", d(8), "個"),
    mkItem("玉ねぎ", 2, "野菜", d(14), "個"),
    mkItem("しょうゆ", 500, "調味料", d(180), "ml"),
    mkItem("味噌", 500, "調味料", d(120), "g"),
    mkItem("ごはん（冷凍）", 3, "その他", d(30), "個"),
    mkItem("酒", 300, "調味料", d(180), "ml"),
    mkItem("みりん", 300, "調味料", d(180), "ml"),
    mkItem("塩", 200, "調味料", d(180), "g"),
    mkItem("砂糖", 400, "調味料", d(180), "g"),
    mkItem("鶏がらスープの素", 80, "調味料", d(180), "g"),
  ];
  state.shopping = [];
  save();
}

let idSeq = Date.now();
function mkItem(name, qty, category, expiry, unit = "個") {
  return { id: ++idSeq, name, qty, category, expiry, unit, addedAt: Date.now() };
}

// ---------- 日付ユーティリティ ----------
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function toYmd(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysLeft(ymd) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(ymd + "T00:00:00");
  return Math.round((t - today) / 86400000);
}
function expiryLabel(ymd) {
  const n = daysLeft(ymd);
  if (n < 0) return { text: `期限切れ ${-n}日`, cls: "danger" };
  if (n === 0) return { text: "今日まで", cls: "danger" };
  if (n <= 3) return { text: `あと${n}日`, cls: "warn" };
  return { text: `あと${n}日`, cls: "safe" };
}

// ---------- 画面切り替え ----------
function switchScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById("screen-" + name).classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.screen === name));
}

// ---------- トースト ----------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

// ---------- モーダル ----------
function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  if (id === "modal-manual") {
    document.getElementById("m-name").value = "";
    document.getElementById("m-qty").value = 1;
    document.getElementById("m-unit").value = "個";
    updateManualQtyLabel();
    updateManualExpiryDefault();
  }
  if (id === "modal-receipt") {
    document.getElementById("receipt-step1").classList.remove("hidden");
    document.getElementById("receipt-step2").classList.add("hidden");
    document.getElementById("receipt-step3").classList.add("hidden");
  }
  if (id === "modal-barcode") {
    document.getElementById("barcode-result").classList.add("hidden");
    document.getElementById("jan-input").value = "";
  }
}
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

// ---------- 在庫：手入力 ----------
function updateManualExpiryDefault() {
  const cat = document.getElementById("m-category").value;
  const days = CATEGORIES[cat] ?? 7;
  document.getElementById("m-expiry").value = toYmd(addDays(new Date(), days));
}
function updateManualUnitDefault() {
  const name = document.getElementById("m-name").value.trim();
  const cat = document.getElementById("m-category").value;
  document.getElementById("m-unit").value = defaultUnitFor(name, cat);
  updateManualQtyLabel();
}
function updateManualQtyLabel() {
  const unit = document.getElementById("m-unit").value;
  const label = document.getElementById("m-qty-label");
  label.textContent = unit === "ml" ? "量(ml)" : unit === "g" ? "量(g)" : "数量(個)";
}
function submitManual() {
  const name = document.getElementById("m-name").value.trim();
  const qty = parseInt(document.getElementById("m-qty").value, 10) || 1;
  const cat = document.getElementById("m-category").value;
  const expiry = document.getElementById("m-expiry").value;
  const unit = document.getElementById("m-unit").value;
  if (!name) { toast("食材名を入力してください"); return; }
  if (!expiry) { toast("賞味期限を入力してください"); return; }
  state.inventory.push(mkItem(name, qty, cat, expiry, unit));
  save(); renderAll();
  closeModal("modal-manual");
  toast(`「${name}」を在庫に登録しました`);
}

// ---------- 在庫：レシートOCR（モック） ----------
function startOcr() {
  document.getElementById("receipt-step1").classList.add("hidden");
  document.getElementById("receipt-step2").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("receipt-step2").classList.add("hidden");
    document.getElementById("receipt-step3").classList.remove("hidden");
    renderOcrResults();
  }, 1500);
}
function renderOcrResults() {
  const wrap = document.getElementById("ocr-results");
  const catOptions = Object.keys(CATEGORIES)
    .map((c) => `<option value="${c}">${c}</option>`).join("");
  let html = `<div class="ocr-row ocr-head"><span>食材名</span><span>カテゴリ</span><span>賞味期限</span></div>`;
  OCR_SAMPLE.forEach((item, i) => {
    const expiry = toYmd(addDays(new Date(), CATEGORIES[item.category]));
    html += `
      <div class="ocr-row" data-i="${i}">
        <input type="text" class="ocr-name" value="${item.name}">
        <select class="ocr-cat">${catOptions.replace(`value="${item.category}"`, `value="${item.category}" selected`)}</select>
        <input type="date" class="ocr-expiry" value="${expiry}">
      </div>`;
  });
  wrap.innerHTML = html;
}
function submitOcr() {
  const rows = document.querySelectorAll("#ocr-results .ocr-row[data-i]");
  let count = 0;
  rows.forEach((row) => {
    const name = row.querySelector(".ocr-name").value.trim();
    const cat = row.querySelector(".ocr-cat").value;
    const expiry = row.querySelector(".ocr-expiry").value;
    if (name && expiry) { state.inventory.push(mkItem(name, 1, cat, expiry, "個")); count++; }
  });
  save(); renderAll();
  closeModal("modal-receipt");
  toast(`レシートから${count}件を在庫に登録しました`);
}

// ---------- 在庫：バーコード（モック） ----------
function simulateScan() {
  const codes = Object.keys(JAN_DB);
  const code = codes[Math.floor(Math.random() * codes.length)];
  document.getElementById("jan-input").value = code;
  lookupJan();
}
function lookupJan() {
  const code = document.getElementById("jan-input").value.trim();
  const el = document.getElementById("barcode-result");
  el.classList.remove("hidden");
  const hit = JAN_DB[code];
  if (!hit) {
    el.innerHTML = `❌ JANコード <b>${code || "(未入力)"}</b> に該当する商品が見つかりません。<br>
      <span style="font-size:11px;color:#6b7d8a">お試し用コード: ${Object.keys(JAN_DB).slice(0, 3).join(" / ")}</span>`;
    return;
  }
  const expiry = toYmd(addDays(new Date(), CATEGORIES[hit.category]));
  el.innerHTML = `
    ✅ <b>${hit.name}</b><br>
    <span style="font-size:12px;color:#6b7d8a">カテゴリ: ${hit.category} ／ 数量: ${hit.qty}${hit.unit} ／ 賞味期限目安: ${expiry}</span><br>
    <button class="small-btn" style="margin-top:8px" onclick="addFromBarcode('${code}')">この商品を在庫に登録</button>`;
}
function addFromBarcode(code) {
  const hit = JAN_DB[code];
  if (!hit) return;
  const expiry = toYmd(addDays(new Date(), CATEGORIES[hit.category]));
  state.inventory.push(mkItem(hit.name, hit.qty, hit.category, expiry, hit.unit));
  save(); renderAll();
  closeModal("modal-barcode");
  toast(`「${hit.name}」を在庫に登録しました`);
}

// ---------- 在庫：一覧表示・操作 ----------
function renderStock() {
  const list = document.getElementById("stock-list");
  const sort = document.getElementById("sort-select").value;
  const items = [...state.inventory];
  if (sort === "expiry") items.sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  if (sort === "added") items.sort((a, b) => b.addedAt - a.addedAt);

  document.getElementById("stock-count").textContent = `${items.length}品目`;
  document.getElementById("stock-empty").classList.toggle("hidden", items.length > 0);

  list.innerHTML = items.map((it) => {
    const lbl = expiryLabel(it.expiry);
    const cls = lbl.cls === "danger" ? "danger" : lbl.cls === "warn" ? "warn" : "";
    const qtyLabel = it.unit === "個"
      ? `<span style="font-weight:400;font-size:12px">× ${it.qty}個</span>`
      : `<span style="font-weight:400;font-size:12px">残り ${it.qty} ${it.unit}</span>`;
    const consumeBtn = it.unit === "個"
      ? `<button class="icon-btn" title="1つ消費" onclick="consumeItem(${it.id})">−1</button>`
      : "";
    return `
      <li class="stock-item ${cls}">
        <div class="stock-info">
          <div class="stock-name">${it.name} ${qtyLabel}</div>
          <div class="stock-meta">${it.category} ｜ 期限 ${it.expiry.replaceAll("-", "/")}</div>
        </div>
        <span class="expiry-chip ${lbl.cls}">${lbl.text}</span>
        <div class="stock-actions">
          ${consumeBtn}
          <button class="icon-btn" title="削除" onclick="deleteItem(${it.id})">🗑</button>
        </div>
      </li>`;
  }).join("");
}
function consumeItem(id) {
  const it = state.inventory.find((x) => x.id === id);
  if (!it) return;
  it.qty -= 1;
  if (it.qty <= 0) {
    state.inventory = state.inventory.filter((x) => x.id !== id);
    toast(`「${it.name}」を使い切りました`);
  }
  save(); renderAll();
}
function deleteItem(id) {
  const it = state.inventory.find((x) => x.id === id);
  state.inventory = state.inventory.filter((x) => x.id !== id);
  save(); renderAll();
  if (it) toast(`「${it.name}」を削除しました`);
}

// ---------- 通知（賞味期限アラート） ----------
function expiringItems() {
  return state.inventory.filter((it) => daysLeft(it.expiry) <= 3);
}
function renderAlert(force = false) {
  const banner = document.getElementById("alert-banner");
  const items = expiringItems();
  if (items.length === 0 || (state.alertDismissed && !force)) {
    banner.classList.add("hidden");
    return;
  }
  const names = items
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .map((it) => {
      const n = daysLeft(it.expiry);
      return `${it.name}（${n < 0 ? "期限切れ" : n === 0 ? "今日まで" : `あと${n}日`}）`;
    }).join("、");
  document.getElementById("alert-text").textContent =
    `期限が近い食材が${items.length}件あります：${names}。今日のレシピ提案で優先的に使いましょう。`;
  banner.classList.remove("hidden");
}
function dismissAlert() {
  state.alertDismissed = true;
  save();
  document.getElementById("alert-banner").classList.add("hidden");
}
function testNotify() {
  state.alertDismissed = false;
  save();
  switchScreen("stock");
  renderAlert(true);
  const items = expiringItems();
  if (items.length === 0) toast("期限3日以内の食材は現在ありません");
  else toast(`毎日 ${state.notifyTime} にこの内容がプッシュ通知されます（モック）`);
}
function saveNotifyTime() {
  state.notifyTime = document.getElementById("notify-time").value;
  save();
  toast(`通知時刻を ${state.notifyTime} に設定しました`);
}

// ---------- AIレシピ提案（モック） ----------
function nameMatches(invName, ingName) {
  const excluded = NEGATIVE_MATCH[ingName] || [];
  if (excluded.some((x) => invName.includes(x))) return false;
  if (invName.includes(ingName) || ingName.includes(invName)) return true;
  const aliases = ALIASES[ingName] || [];
  return aliases.some((a) => invName.includes(a));
}
function findStock(ingName) {
  return state.inventory.find((it) => nameMatches(it.name, ingName));
}

function suggestRecipes() {
  const btn = document.getElementById("suggest-btn");
  const thinking = document.getElementById("ai-thinking");
  const results = document.getElementById("recipe-results");
  btn.disabled = true;
  results.innerHTML = "";
  thinking.classList.remove("hidden");

  setTimeout(() => {
    thinking.classList.add("hidden");
    btn.disabled = false;
    renderRecipeResults(rankRecipes());
  }, 1800);
}

function rankRecipes() {
  const scored = RECIPES.map((r) => {
    let score = 0;
    const inStock = [], missing = [];
    r.ingredients.forEach((ing) => {
      const hit = findStock(ing);
      if (hit) {
        const n = daysLeft(hit.expiry);
        const urgency = n <= 0 ? 5 : n <= 3 ? 4 : n <= 7 ? 2 : 1;
        score += urgency;
        inStock.push({ ing, item: hit, urgent: n <= 3 });
      } else {
        missing.push(ing);
      }
    });
    score += (inStock.length / r.ingredients.length) * 3; // 充足率ボーナス
    score -= missing.length * 0.5;                        // 買い足しが多いほど減点
    return { recipe: r, score, inStock, missing };
  });
  return scored
    .filter((s) => s.inStock.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function renderRecipeResults(ranked) {
  const results = document.getElementById("recipe-results");
  if (ranked.length === 0) {
    results.innerHTML = `<p class="hint-text">在庫が少なく提案できるレシピがありません。まず食材を登録してください。</p>`;
    return;
  }
  results.innerHTML = ranked.map((s, i) => {
    const urgentIngs = s.inStock.filter((x) => x.urgent).map((x) => x.item.name);
    const reason = urgentIngs.length > 0
      ? `期限が近い「${urgentIngs.join("」「")}」を優先的に消費できます`
      : `在庫の食材を${s.inStock.length}種類活用できます`;
    const stockChips = s.inStock.map((x) =>
      `<span class="ing-chip ${x.urgent ? "urgent" : ""}">${x.ing}${x.urgent ? " ⏰" : ""}</span>`).join("");
    const missingChips = s.missing.length > 0
      ? s.missing.map((m) => `<span class="ing-chip missing">${m}</span>`).join("")
      : `<span class="hint-text">なし（すべて在庫でまかなえます）</span>`;
    const steps = s.recipe.steps.map((st) => `<li>${st}</li>`).join("");
    const missingBtn = s.missing.length > 0
      ? `<button class="missing-action" id="missing-btn-${i}"
           onclick='addMissingToShopping(${JSON.stringify(s.missing)}, "missing-btn-${i}")'>
           🛒 不足食材${s.missing.length}件を買い物リストへ追加</button>`
      : "";
    return `
      <div class="recipe-card">
        <div class="recipe-rank">おすすめ ${i + 1} 位</div>
        <div class="recipe-name">${s.recipe.name}</div>
        <div class="recipe-reason">💡 ${reason}</div>
        <div class="ing-group-title">✅ 在庫で使える食材（⏰=期限間近）</div>
        <div class="ing-chips">${stockChips}</div>
        <div class="ing-group-title">❌ 不足食材</div>
        <div class="ing-chips">${missingChips}</div>
        <div class="ing-group-title">📝 作り方</div>
        <ol class="recipe-steps">${steps}</ol>
        <a class="recipe-link" href="${s.recipe.ref}" target="_blank" rel="noopener">
          🔗 参考レシピをWebで見る（${s.recipe.ref.includes("cookpad") ? "クックパッド" : "クラシル"}）
        </a>
        <button class="cook-action" onclick="cookRecipe('${s.recipe.name}')">🍽️ これを作った（在庫を減らす）</button>
        ${missingBtn}
      </div>`;
  }).join("");
}

function cookRecipe(recipeName) {
  const recipe = RECIPES.find((r) => r.name === recipeName);
  if (!recipe) return;
  const amounts = recipe.amounts || {};
  const summary = [];
  let anyFound = false;
  recipe.ingredients.forEach((ing) => {
    const hit = findStock(ing);
    if (!hit) return;
    anyFound = true;
    if (hit.unit === "個") {
      hit.qty -= 1;
      summary.push(`${hit.name} -1個`);
    } else {
      const spoons = amounts[ing];
      if (!spoons) return;
      const amt = spoonToAmount(hit.name, hit.unit, spoons);
      if (amt <= 0) return;
      hit.qty = Math.max(0, hit.qty - amt);
      summary.push(`${hit.name} -${amt}${hit.unit}`);
    }
  });
  if (!anyFound) { toast("在庫が足りません"); return; }
  state.inventory = state.inventory.filter((it) => it.qty > 0);
  save(); renderAll();
  toast(summary.length > 0
    ? `${recipe.name}を作りました。${summary.join("、")}`
    : `${recipe.name}を作りました。`);
}

function addMissingToShopping(names, btnId) {
  let added = 0;
  names.forEach((name) => {
    const exists = state.shopping.some((s) => s.name === name && !s.checked);
    if (!exists) {
      state.shopping.push({ id: ++idSeq, name, checked: false, src: "レシピ提案" });
      added++;
    }
  });
  save(); renderAll();
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = "✅ 買い物リストに追加済み"; }
  toast(added > 0 ? `${added}件を買い物リストに追加しました` : "すでに買い物リストにあります");
}

// ---------- 買い物リスト ----------
function guessCategory(name) {
  for (const [ing, aliases] of Object.entries(ALIASES)) {
    if (name.includes(ing) || aliases.some((a) => name.includes(a))) {
      if (["豚肉", "鶏肉", "ひき肉"].includes(ing)) return "肉";
      if (ing === "卵") return "卵";
      if (ing === "牛乳") return "乳製品";
      if (ing === "豆腐") return "豆腐・大豆製品";
      if (["しょうゆ", "ケチャップ", "コンソメ"].includes(ing)) return "調味料";
      if (ing === "ウインナー") return "加工食品";
    }
  }
  const vegWords = ["キャベツ", "にんじん", "玉ねぎ", "じゃがいも", "大根", "もやし", "ねぎ", "しょうが"];
  if (vegWords.some((v) => name.includes(v))) return "野菜";
  const seasonings = ["味噌", "みりん", "ソース", "豆板醤", "小麦粉", "塩", "砂糖"];
  if (seasonings.some((v) => name.includes(v))) return "調味料";
  return "その他";
}

function addShoppingManual() {
  const input = document.getElementById("shopping-input");
  const name = input.value.trim();
  if (!name) return;
  state.shopping.push({ id: ++idSeq, name, checked: false, src: "手動メモ" });
  input.value = "";
  save(); renderAll();
}

function toggleShopping(id) {
  const item = state.shopping.find((s) => s.id === id);
  if (!item) return;
  item.checked = !item.checked;
  if (item.checked) {
    // 在庫データ自動連動：購入済み → 冷蔵庫在庫へ加算
    const cat = guessCategory(item.name);
    const expiry = toYmd(addDays(new Date(), CATEGORIES[cat]));
    const unit = defaultUnitFor(item.name, cat);
    const addQty = unit === "ml" ? 500 : unit === "g" ? 100 : 1;
    const existing = state.inventory.find((it) => it.name === item.name && it.unit === unit);
    if (existing) existing.qty += addQty;
    else state.inventory.push(mkItem(item.name, addQty, cat, expiry, unit));
    state.shopping = state.shopping.filter((s) => s.id !== id);
    state.alertDismissed = false;
    toast(`「${item.name}」を購入済みにし、在庫へ自動追加しました（${cat}）`);
  }
  save(); renderAll();
}

function deleteShopping(id) {
  state.shopping = state.shopping.filter((s) => s.id !== id);
  save(); renderAll();
}

function renderShopping() {
  const list = document.getElementById("shopping-list");
  const items = state.shopping;
  document.getElementById("shopping-count").textContent = `${items.length}件`;
  document.getElementById("shopping-empty").classList.toggle("hidden", items.length > 0);
  const badge = document.getElementById("shopping-badge");
  badge.classList.toggle("hidden", items.length === 0);
  badge.textContent = items.length;

  list.innerHTML = items.map((s) => `
    <li class="shopping-item">
      <input type="checkbox" ${s.checked ? "checked" : ""} onchange="toggleShopping(${s.id})"
             title="購入済みにすると在庫へ自動追加">
      <div>
        <div class="shopping-name">${s.name}</div>
        <div class="shopping-src">${s.src || ""}</div>
      </div>
      <button class="icon-btn" style="margin-left:auto" onclick="deleteShopping(${s.id})">🗑</button>
    </li>`).join("");
}

// ---------- 設定 ----------
function resetAll() {
  if (!confirm("在庫・買い物リストをすべて消去し、サンプルデータに戻します。よろしいですか？")) return;
  seedSample();
  state.alertDismissed = false;
  save(); renderAll();
  toast("サンプルデータに初期化しました");
}

// ---------- 全体描画 ----------
function renderAll() {
  renderStock();
  renderShopping();
  renderAlert();
}

// ---------- 初期化 ----------
function init() {
  load();

  // 今日の日付表示
  const now = new Date();
  const wd = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  document.getElementById("today-date").textContent =
    `${now.getMonth() + 1}月${now.getDate()}日（${wd}）`;

  // カテゴリセレクト構築
  const sel = document.getElementById("m-category");
  sel.innerHTML = Object.keys(CATEGORIES).map((c) => `<option value="${c}">${c}</option>`).join("");
  sel.addEventListener("change", updateManualExpiryDefault);
  sel.addEventListener("change", updateManualUnitDefault);
  document.getElementById("m-name").addEventListener("input", updateManualUnitDefault);
  document.getElementById("m-unit").addEventListener("change", updateManualQtyLabel);

  document.getElementById("notify-time").value = state.notifyTime;

  // セッションごとにアラートを再表示
  state.alertDismissed = false;

  renderAll();
}

init();
