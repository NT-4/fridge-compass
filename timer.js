/* ============================================================
 * ポモドーロ勉強タイマー
 *  - 残り時間は Date.now() 基準で計算するため、タブを離れても
 *    端末がスリープしてもズレない（setInterval は描画用）。
 *  - 設定と学習記録は localStorage に保存（アプリ本体とは別キー）。
 *  - 通知音は Web Audio で生成するため音声ファイル不要＝オフラインでも鳴る。
 * ============================================================ */

const POMO_KEY = "fridge-compass-pomodoro-v1";

const POMO_DEFAULTS = {
  focusMin: 25,     // 集中
  shortMin: 5,      // 小休憩
  longMin: 15,      // 長い休憩
  longEvery: 4,     // 何ポモドーロごとに長い休憩を挟むか
  autoNext: true,   // 次のフェーズを自動で開始
  sound: true,      // 終了時に音＋バイブで知らせる
  notify: false,    // 終了時にシステム通知
};

// フェーズ定義（key は設定の分数プロパティ名）
const POMO_PHASES = {
  focus: { label: "集中",     icon: "📖", key: "focusMin", end: "集中セット完了！ひと息つきましょう" },
  short: { label: "小休憩",   icon: "☕", key: "shortMin", end: "休憩おわり。次の集中に入りましょう" },
  long:  { label: "長い休憩", icon: "🛋", key: "longMin",  end: "長い休憩おわり。おつかれさまでした" },
};

const POMO_PRESETS = [
  { label: "25 / 5", focusMin: 25, shortMin: 5,  longMin: 15 },
  { label: "50 / 10", focusMin: 50, shortMin: 10, longMin: 20 },
  { label: "15 / 3", focusMin: 15, shortMin: 3,  longMin: 10 },
];

let pomo = {
  settings: { ...POMO_DEFAULTS },
  phase: "focus",
  running: false,
  endAt: null,          // 実行中の終了時刻(ms)
  remainMs: POMO_DEFAULTS.focusMin * 60000,
  doneInSet: 0,         // 長い休憩までに完了した集中セット数
  history: {},          // "YYYY-MM-DD": { count, focusMs }
};

let pomoTick = null;
let pomoWakeLock = null;
let pomoAudioCtx = null;

// ---------- 保存・復元 ----------
function pomoSave() {
  try {
    localStorage.setItem(POMO_KEY, JSON.stringify({
      settings: pomo.settings,
      phase: pomo.phase,
      running: pomo.running,
      endAt: pomo.endAt,
      remainMs: pomo.remainMs,
      doneInSet: pomo.doneInSet,
      history: pomo.history,
    }));
  } catch (e) { /* 保存できなくてもタイマー自体は動く */ }
}

function pomoLoad() {
  let raw = null;
  try { raw = localStorage.getItem(POMO_KEY); } catch (e) { /* ignore */ }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    pomo.settings = { ...POMO_DEFAULTS, ...(saved.settings || {}) };
    pomo.phase = POMO_PHASES[saved.phase] ? saved.phase : "focus";
    pomo.doneInSet = Number(saved.doneInSet) || 0;
    pomo.history = saved.history && typeof saved.history === "object" ? saved.history : {};
    pomo.remainMs = Number(saved.remainMs) || pomoPhaseTotal();
    pomo.running = false;
    pomo.endAt = null;

    if (saved.running && saved.endAt) {
      const remain = saved.endAt - Date.now();
      if (remain > 0) {
        // 再読み込み前から動いていたタイマーはそのまま継続
        pomo.running = true;
        pomo.endAt = saved.endAt;
        pomo.remainMs = remain;
      } else {
        // 閉じている間に終わっていた分は記録だけ確定させ、次は手動開始
        pomoCompletePhase({ silent: true, autoNext: false });
      }
    }
  } catch (e) { /* 壊れていたら初期値のまま */ }
}

// ---------- 時間計算 ----------
function pomoPhaseTotal(phase = pomo.phase) {
  const min = Number(pomo.settings[POMO_PHASES[phase].key]) || POMO_DEFAULTS[POMO_PHASES[phase].key];
  return min * 60000;
}

function pomoRemain() {
  if (pomo.running && pomo.endAt) return Math.max(0, pomo.endAt - Date.now());
  return Math.max(0, pomo.remainMs);
}

function pomoFmt(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pomoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- 操作 ----------
function pomoToggle() {
  if (pomo.running) pomoPause(); else pomoStart();
}

function pomoStart() {
  if (pomo.running) return;
  if (pomo.remainMs <= 0) pomo.remainMs = pomoPhaseTotal();
  pomo.endAt = Date.now() + pomo.remainMs;
  pomo.running = true;
  pomoAudioUnlock();       // 最初のタップで音の再生許可を取っておく
  pomoArmChime();          // 終了音を定刻に予約（画面を離れても鳴らすため）
  pomoRequestWakeLock();
  pomoStartTick();
  pomoSave();
  pomoRender();
}

function pomoPause() {
  if (!pomo.running) return;
  pomo.remainMs = pomoRemain();
  pomo.running = false;
  pomo.endAt = null;
  pomoStopTick();
  pomoDisarmChime();
  pomoReleaseWakeLock();
  pomoSave();
  pomoRender();
}

function pomoReset() {
  pomo.running = false;
  pomo.endAt = null;
  pomo.remainMs = pomoPhaseTotal();
  pomoStopTick();
  pomoDisarmChime();
  pomoReleaseWakeLock();
  pomoSave();
  pomoRender();
}

// 現在のフェーズを飛ばして次へ（集中は完了扱いにしない）
function pomoSkip() {
  const next = pomoNextPhase(false);
  pomoGoPhase(next, false);
  toast(`${POMO_PHASES[next].label}にスキップしました`);
}

function pomoNextPhase(counted) {
  if (pomo.phase !== "focus") return "focus";
  const every = Math.max(1, Number(pomo.settings.longEvery) || POMO_DEFAULTS.longEvery);
  const done = pomo.doneInSet + (counted ? 1 : 0);
  return done > 0 && done % every === 0 ? "long" : "short";
}

function pomoGoPhase(next, autoStart) {
  if (pomo.phase === "long") pomo.doneInSet = 0;
  pomo.phase = next;
  pomo.remainMs = pomoPhaseTotal(next);
  pomo.running = false;
  pomo.endAt = null;
  pomoStopTick();
  pomoDisarmChime();
  if (autoStart) pomoStart(); else { pomoReleaseWakeLock(); pomoSave(); pomoRender(); }
}

// フェーズ終了時の処理（時間切れ）
function pomoCompletePhase(opts = {}) {
  const silent = opts.silent === true;
  const allowAuto = opts.autoNext !== false && pomo.settings.autoNext;
  const finished = pomo.phase;

  if (finished === "focus") {
    const day = pomoToday();
    const rec = pomo.history[day] || { count: 0, focusMs: 0 };
    rec.count += 1;
    rec.focusMs += pomoPhaseTotal("focus");
    pomo.history[day] = rec;
    pomo.doneInSet += 1;
  }

  const next = pomoNextPhase(false);

  if (!silent) {
    // 予約済みの音がすでに鳴っている場合は、バイブだけ追加する
    if (pomoChimeArmed) { pomoChimeArmed = false; pomoVibrate(); }
    else pomoChime(finished === "focus" ? "focusEnd" : "breakEnd");
    pomoNotify(
      `${POMO_PHASES[finished].icon} ${POMO_PHASES[finished].label}おわり`,
      `${POMO_PHASES[finished].end}（次：${POMO_PHASES[next].label} ${pomoPhaseTotal(next) / 60000}分）`
    );
    if (typeof toast === "function") toast(`${POMO_PHASES[finished].icon} ${POMO_PHASES[finished].end}`);
  }

  pomoGoPhase(next, allowAuto);
  if (silent) { pomoSave(); pomoRender(); }
}

// ---------- 進行 ----------
function pomoStartTick() {
  if (pomoTick) return;
  pomoTick = setInterval(() => {
    if (!pomo.running) return;
    if (pomoRemain() <= 0) {
      pomo.remainMs = 0;
      pomo.running = false;
      pomo.endAt = null;
      pomoStopTick();
      pomoCompletePhase();
      return;
    }
    pomoRender();
  }, 250);
}

function pomoStopTick() {
  if (pomoTick) { clearInterval(pomoTick); pomoTick = null; }
}

// ---------- 画面ロック抑止（勉強中に画面が消えないように） ----------
async function pomoRequestWakeLock() {
  if (!("wakeLock" in navigator) || pomoWakeLock) return;
  try {
    pomoWakeLock = await navigator.wakeLock.request("screen");
    pomoWakeLock.addEventListener("release", () => { pomoWakeLock = null; });
  } catch (e) { /* 非対応・拒否時は何もしない */ }
}

function pomoReleaseWakeLock() {
  if (!pomoWakeLock) return;
  try { pomoWakeLock.release(); } catch (e) { /* ignore */ }
  pomoWakeLock = null;
}

// ---------- 通知音（Web Audio で生成） ----------
function pomoAudioUnlock() {
  if (!pomo.settings.sound) return null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!pomoAudioCtx) pomoAudioCtx = new AC();
    if (pomoAudioCtx.state === "suspended") pomoAudioCtx.resume();
    return pomoAudioCtx;
  } catch (e) { return null; }
}

let pomoScheduledNodes = [];   // 予約済みチャイムのオシレータ
let pomoChimeArmed = false;    // 現フェーズの終了音を予約済みか

const POMO_TONES = {
  focusEnd: [[880, 0], [1108, 0.18], [1318, 0.36]],  // 上がる3音＝おつかれさま
  breakEnd: [[1318, 0], [880, 0.2]],                 // 下がる2音＝再開
  test:     [[988, 0], [1318, 0.16]],
};

// delaySec 秒後に鳴らす（0 = 即時）。返り値は音を出せたか。
function pomoPlayTone(kind, delaySec = 0) {
  if (!pomo.settings.sound) return false;
  const ctx = pomoAudioUnlock();
  if (!ctx || ctx.state !== "running") return false;
  const base = ctx.currentTime + Math.max(0, delaySec);
  (POMO_TONES[kind] || POMO_TONES.test).forEach(([freq, at]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, base + at);
    gain.gain.exponentialRampToValueAtTime(0.25, base + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, base + at + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(base + at);
    osc.stop(base + at + 0.4);
    osc.onended = () => { pomoScheduledNodes = pomoScheduledNodes.filter((n) => n.osc !== osc); };
    pomoScheduledNodes.push({ osc, at: base + at });
  });
  return true;
}

function pomoVibrate() {
  if (!pomo.settings.sound || !navigator.vibrate) return;
  try { navigator.vibrate([120, 80, 120]); } catch (e) { /* ignore */ }
}

function pomoChime(kind) {
  pomoPlayTone(kind, 0);
  pomoVibrate();
}

/* スマホ対策：終了音を「終了時刻」に前もって予約しておく。
 * 画面を見ていない間はブラウザが setInterval を大幅に間引くため、
 * タイマーの発火を待って鳴らすと数十秒〜数分遅れることがある。
 * オーディオ側に絶対時刻で積んでおけば、JSが止まっていても定刻に鳴る。 */
function pomoArmChime() {
  pomoDisarmChime();
  if (!pomo.running || !pomo.settings.sound) return;
  const remainSec = pomoRemain() / 1000;
  if (remainSec <= 0 || remainSec > 3 * 3600) return;

  const ctx = pomoAudioUnlock();
  if (ctx && ctx.state === "suspended") {
    // 初回タップ直後は resume() 完了待ち。完了してから予約する
    ctx.resume().then(() => { if (pomo.running && !pomoChimeArmed) pomoArmChime(); }).catch(() => {});
    return;
  }
  const kind = pomo.phase === "focus" ? "focusEnd" : "breakEnd";
  pomoChimeArmed = pomoPlayTone(kind, remainSec);
}

function pomoDisarmChime() {
  // 鳴っている最中の音は途切れさせず、これから鳴る予定の分だけ取り消す
  const now = pomoAudioCtx ? pomoAudioCtx.currentTime : Infinity;
  pomoScheduledNodes = pomoScheduledNodes.filter((n) => {
    if (n.at <= now + 0.05) return true;
    try { n.osc.stop(); n.osc.disconnect(); } catch (e) { /* ignore */ }
    return false;
  });
  pomoChimeArmed = false;
}

function pomoTestSound() {
  if (!pomo.settings.sound) { toast("「音で知らせる」をオンにしてください"); return; }
  pomoChime("focusEnd");
}

// ---------- システム通知 ----------
function pomoNotify(title, body) {
  if (!pomo.settings.notify) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "pomodoro" };
  try {
    new Notification(title, opts);
  } catch (e) {
    // Android Chrome など、Service Worker 経由でしか出せない環境向け
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(() => {});
    }
  }
}

async function pomoToggleNotify(el) {
  if (el.checked) {
    if (!("Notification" in window)) {
      el.checked = false;
      toast("この端末は通知に対応していません");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") { try { perm = await Notification.requestPermission(); } catch (e) { perm = "denied"; } }
    if (perm !== "granted") {
      el.checked = false;
      toast("通知がブロックされています。ブラウザの設定から許可してください");
      return;
    }
  }
  pomo.settings.notify = el.checked;
  pomoSave();
}

// ---------- 設定 ----------
function pomoClamp(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pomoSaveSettings() {
  const s = pomo.settings;
  s.focusMin  = pomoClamp(document.getElementById("pomo-focus").value, 1, 180, POMO_DEFAULTS.focusMin);
  s.shortMin  = pomoClamp(document.getElementById("pomo-short").value, 1, 60,  POMO_DEFAULTS.shortMin);
  s.longMin   = pomoClamp(document.getElementById("pomo-long").value,  1, 120, POMO_DEFAULTS.longMin);
  s.longEvery = pomoClamp(document.getElementById("pomo-every").value, 1, 12,  POMO_DEFAULTS.longEvery);
  s.autoNext  = document.getElementById("pomo-auto").checked;
  s.sound     = document.getElementById("pomo-sound").checked;

  // 停止中なら、変更した長さをその場で反映
  if (!pomo.running) pomo.remainMs = pomoPhaseTotal();
  else pomoArmChime();
  pomoSave();
  pomoRenderSettings();
  pomoRender();
}

// −/＋ ボタン（スマホでキーボードを出さずに調整するため）
function pomoStep(id, delta) {
  const el = document.getElementById(id);
  const min = Number(el.min) || 1;
  const max = Number(el.max) || 999;
  el.value = pomoClamp((Number(el.value) || min) + delta, min, max, min);
  pomoSaveSettings();
}

function pomoApplyPreset(i) {
  const p = POMO_PRESETS[i];
  if (!p) return;
  pomo.settings.focusMin = p.focusMin;
  pomo.settings.shortMin = p.shortMin;
  pomo.settings.longMin = p.longMin;
  if (!pomo.running) pomo.remainMs = pomoPhaseTotal();
  pomoSave();
  pomoRenderSettings();
  pomoRender();
  toast(`${p.label} 分に設定しました`);
}

function pomoResetHistory() {
  if (!confirm("学習記録（完了ポモドーロ数・集中時間）をすべて消去します。よろしいですか？")) return;
  pomo.history = {};
  pomo.doneInSet = 0;
  pomoSave();
  pomoRender();
  toast("学習記録を消去しました");
}

// ---------- 描画 ----------
const POMO_RING_LEN = 2 * Math.PI * 54; // r=54 の円周

function pomoRender() {
  const screen = document.getElementById("screen-timer");
  if (!screen) return;

  const phase = POMO_PHASES[pomo.phase];
  const total = pomoPhaseTotal();
  const remain = pomoRemain();
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remain / total)) : 0;

  const card = document.getElementById("pomo-card");
  card.className = `pomo-card phase-${pomo.phase}` + (pomo.running ? " running" : "");
  document.getElementById("pomo-phase").textContent = `${phase.icon} ${phase.label}`;
  document.getElementById("pomo-time").textContent = pomoFmt(remain);

  const ring = document.getElementById("pomo-ring-fg");
  ring.style.strokeDasharray = POMO_RING_LEN;
  ring.style.strokeDashoffset = POMO_RING_LEN * (1 - progress);

  const btn = document.getElementById("pomo-main-btn");
  btn.textContent = pomo.running ? "⏸ 一時停止" : (remain < total ? "▶ 再開" : "▶ 開始");

  // 長い休憩までのセット進捗
  const every = Math.max(1, Number(pomo.settings.longEvery) || POMO_DEFAULTS.longEvery);
  const filled = pomo.doneInSet % every || (pomo.doneInSet > 0 && pomo.phase === "long" ? every : 0);
  document.getElementById("pomo-dots").innerHTML =
    Array.from({ length: every }, (_, i) =>
      `<span class="pomo-dot${i < filled ? " on" : ""}"></span>`).join("");
  document.getElementById("pomo-set-label").textContent = `長い休憩まで ${Math.max(0, every - filled)} セット`;

  // タブのインジケータとタイトル
  const badge = document.getElementById("pomo-badge");
  badge.classList.toggle("hidden", !pomo.running);
  document.title = pomo.running
    ? `${pomoFmt(remain)} ${phase.label} — 冷蔵庫コンパス`
    : "冷蔵庫コンパス — 冷蔵庫管理アプリ";

  pomoRenderStats();
}

function pomoRenderStats() {
  const today = pomo.history[pomoToday()] || { count: 0, focusMs: 0 };
  document.getElementById("pomo-today-count").textContent = today.count;
  document.getElementById("pomo-today-focus").textContent = `${Math.round(today.focusMs / 60000)}分`;

  // 直近7日（左が6日前、右が今日）
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ key, label: ["日", "月", "火", "水", "木", "金", "土"][d.getDay()], count: (pomo.history[key] || {}).count || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  document.getElementById("pomo-history").innerHTML = days.map((d) => `
    <div class="pomo-bar-col" title="${d.key}：${d.count}ポモドーロ">
      <div class="pomo-bar-track"><div class="pomo-bar" style="height:${d.count ? Math.max(8, (d.count / max) * 100) : 0}%"></div></div>
      <div class="pomo-bar-num">${d.count || ""}</div>
      <div class="pomo-bar-label">${d.label}</div>
    </div>`).join("");
}

function pomoRenderSettings() {
  document.getElementById("pomo-focus").value = pomo.settings.focusMin;
  document.getElementById("pomo-short").value = pomo.settings.shortMin;
  document.getElementById("pomo-long").value = pomo.settings.longMin;
  document.getElementById("pomo-every").value = pomo.settings.longEvery;
  document.getElementById("pomo-auto").checked = pomo.settings.autoNext;
  document.getElementById("pomo-sound").checked = pomo.settings.sound;
  const notifyEl = document.getElementById("pomo-notify");
  const granted = "Notification" in window && Notification.permission === "granted";
  notifyEl.checked = pomo.settings.notify && granted;
  if (pomo.settings.notify && !granted) { pomo.settings.notify = false; pomoSave(); }
}

// ---------- 初期化 ----------
function pomoInit() {
  if (!document.getElementById("screen-timer")) return;
  pomoLoad();

  document.getElementById("pomo-presets").innerHTML = POMO_PRESETS.map((p, i) =>
    `<button class="pomo-preset" onclick="pomoApplyPreset(${i})">${p.label} 分</button>`).join("");

  pomoRenderSettings();
  pomoRender();
  if (pomo.running) pomoStartTick();

  // 復帰時：残り時間を取り直し、画面ロック抑止も張り直す
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (pomo.running) { pomoRequestWakeLock(); pomoStartTick(); pomoArmChime(); }
    pomoRender();
  });

  // 離脱時に残りを保存しておく（次回起動でそのまま続きから）
  window.addEventListener("pagehide", () => { if (pomo.running) pomo.remainMs = pomoRemain(); pomoSave(); });
}

pomoInit();
