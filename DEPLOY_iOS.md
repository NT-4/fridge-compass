# iPhone で使う（PWA 配信手順）

App Store 申請・Apple Developer Program（年$99）・Mac は**不要**。
iPhone の Safari で開いて「ホーム画面に追加」すると、アプリと同じように全画面で起動し、
オフラインでも動作します。

## 重要：HTTPS が必須

Service Worker（オフライン動作の中核）は **https:// でしか動きません**（localhost は例外）。
`file://` で開いたり、HTTP のままだとオフライン機能が無効になります。
そのため、下記いずれかの方法で HTTPS 公開してください。すべて無料枠で済みます。

---

## 方法A：GitHub Pages（推奨・無料・恒久URL）

1. GitHub でリポジトリを作成（例 `fridge-compass`）
2. このフォルダの中身を push

```bash
cd "C:/Users/taita/.claude/image generate/fridge-app"
git init
git add .
git commit -m "冷蔵庫コンパス PWA"
git branch -M main
git remote add origin https://github.com/<あなたのID>/fridge-compass.git
git push -u origin main
```

3. GitHub のリポジトリ画面 → **Settings → Pages** → Source を `main` / `(root)` にして保存
4. 数分後 `https://<あなたのID>.github.io/fridge-compass/` で公開される
5. その URL を iPhone の Safari で開く

## 方法B：Netlify Drop（最速・ドラッグ&ドロップ）

1. https://app.netlify.com/drop を開く
2. `fridge-app` フォルダをブラウザにドラッグ&ドロップ
3. 即座に `https://xxxx.netlify.app` が発行される → iPhone Safari で開く

アカウント登録なしでも一時URLが出ます（恒久運用なら登録推奨）。

## 方法C：同じ Wi-Fi 内で試すだけ（HTTPSなし・オフライン機能は無効）

```bash
python -m http.server 8650 --directory "C:/Users/taita/.claude/image generate/fridge-app" --bind 0.0.0.0
```

iPhone の Safari で `http://<PCのローカルIP>:8650` を開く。
※ HTTP なので Service Worker は動かず、オフライン動作とホーム画面アプリ化は制限されます。
　あくまで表示確認用。

---

## iPhone でのインストール手順（ユーザー操作）

1. **Safari で**公開URLを開く（Chrome ではホーム画面追加が正しく動きません）
2. 下部の **共有ボタン**（□に↑）をタップ
3. **「ホーム画面に追加」** を選択
4. 名前（冷蔵庫コンパス）を確認して「追加」

ホーム画面のアイコンから起動すると、Safari のUIが消えて全画面のアプリとして動作します。
アプリ内にも初回アクセス時に案内バナーが出ます。

---

## PWA の制約（App Store 版との違い）

| 機能 | PWA での状況 |
|---|---|
| オフライン動作 | ✅ 対応済み（Service Worker） |
| ホーム画面アイコン・全画面起動 | ✅ 対応済み |
| データ保存 | ✅ localStorage。ただし**長期間未使用だと iOS が削除する可能性あり**（後述） |
| カメラ（レシート撮影・バーコード） | ✅ 使用可（`<input type="file" accept="image/*" capture>` / getUserMedia） |
| **プッシュ通知（賞味期限アラート）** | ⚠️ **iOS 16.4以降かつ「ホーム画面に追加」した場合のみ**可能。ホーム画面追加していない Safari タブでは不可 |
| バックグラウンド定時通知 | ❌ 不可。アプリを開いた時にまとめて表示する方式が現実的 |
| App Store 掲載 | ❌ されない（URL共有で配布） |

### データ消失リスクへの対策（実装検討事項）
iOS の Safari は、**7日間サイトを使わないとストレージを消去する**仕様があります
（ホーム画面に追加した PWA は対象外とされていますが、保証はありません）。
本番運用では以下のいずれかを推奨します。
- バックエンドへのデータ同期（アカウント機能）
- 設定画面に「データのエクスポート/インポート（JSON）」を追加

---

## 現状の未実装項目（実運用前に対応が必要）

このプロトタイプは以下がモック（疑似動作）のままです。実運用にはバックエンド実装が必要です。

- **レシートOCR** … Claude Vision API をバックエンド経由で呼ぶ
- **バーコード読取** … html5-qrcode でカメラ読取 ＋ Yahoo!ショッピングAPI で JAN→商品名
- **AIレシピ生成** … 現在は内蔵12レシピのスコアリング。生成AI呼び出しに置換
- **賞味期限プッシュ通知** … 現在は起動時バナー表示のみ

いずれも API キーをブラウザに置けないため、バックエンド（既存の uvicorn プロキシ）に
`/api/ocr`・`/api/jan`・`/api/recipe` を追加して中継する構成にしてください。
