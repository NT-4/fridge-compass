/* PWA まわり：Service Worker 登録 / iOS インストール案内 / ショートカット遷移 */

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  });
}

// ---------- スタンドアロン判定 ----------
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
         window.navigator.standalone === true;
}
function isIos() {
  const ua = window.navigator.userAgent;
  const iosUa = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ は Mac を名乗るのでタッチ有無で判定
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iosUa || iPadOs;
}

// ---------- iOS「ホーム画面に追加」案内 ----------
const IOS_HINT_KEY = "fridge-compass-ios-hint-dismissed";

function dismissIosInstall() {
  document.getElementById("ios-install").classList.add("hidden");
  try { localStorage.setItem(IOS_HINT_KEY, "1"); } catch (e) { /* ignore */ }
}

function maybeShowIosInstall() {
  if (!isIos() || isStandalone()) return;
  try { if (localStorage.getItem(IOS_HINT_KEY)) return; } catch (e) { /* ignore */ }
  // 起動直後に出すと邪魔なので少し待つ
  setTimeout(() => {
    document.getElementById("ios-install").classList.remove("hidden");
  }, 1200);
}

// ---------- マニフェスト shortcuts からの画面指定 ----------
function applyScreenFromUrl() {
  const screen = new URLSearchParams(location.search).get("screen");
  if (screen && document.getElementById("screen-" + screen)) {
    switchScreen(screen);
  }
}

// ---------- 起動時にステータスバー分の余白を確保（iOS 全画面時） ----------
function applyStandaloneClass() {
  if (isStandalone()) document.body.classList.add("standalone");
}

applyStandaloneClass();
applyScreenFromUrl();
maybeShowIosInstall();
