/* ============================================================
 * scanner.js — バーコード読取 + 商品データベース照会モジュール
 *
 * 【重要な前提】
 * ブラウザ標準の BarcodeDetector API は Chrome/Android では利用できるが、
 * iOS Safari では実装されておらず使用できない。そのため本モジュールは
 * まず isNativeScanSupported() で機能検出を行い、非対応環境では
 * カメラでの自動読取を諦めて「手入力」または「写真からのAI読取
 * (window.AI.readBarcodeFromPhoto、存在すれば)」にフォールバックする
 * ことを呼び出し側に促す設計になっている。
 *
 * JANコード(EAN-13/EAN-8)から商品名を引く手段として Open Food Facts の
 * 公開API(APIキー不要・CORS対応・無料)を利用するが、これは欧米発の
 * データベースであり日本国内で流通する商品のカバー率は低い。そのため
 * まずアプリ内蔵のローカル辞書(定番の日本商品を少数収録)を優先的に
 * 参照し、そこでヒットしなければ Open Food Facts に問い合わせる、
 * という2段階のフォールバック構成にしている。それでもヒットしない
 * 場合は found:false を返し、呼び出し側での手入力に委ねる。
 *
 * 外部ライブラリ・CDN・ビルドツールは一切使用しない。素のJSと
 * ブラウザ標準API(getUserMedia, BarcodeDetector, fetch, AbortController)
 * のみで構成する。
 * ============================================================ */

(function () {
  "use strict";

  // ------------------------------------------------------------
  // ローカル商品辞書
  // Open Food Facts では見つかりにくい日本の定番商品を少数収録。
  // JANコードはすべて架空のダミー(4900000000009 系)であり、実在企業の実際のコードではない。
  // ただし isValidJan() のチェックディジット検証を通す必要があるため、
  // 単純な連番ではなく EAN-13 の検査数字を正しく計算した値にしてある。
  // ------------------------------------------------------------
  var LOCAL_JAN_DB = {
    "4900000000009": { name: "しょうゆ", category: "調味料", unit: "ml", qty: 500 },
    "4900000000016": { name: "牛乳", category: "乳製品", unit: "ml", qty: 1000 },
    "4900000000023": { name: "絹ごし豆腐", category: "豆腐・大豆製品", unit: "g", qty: 300 },
    "4900000000030": { name: "ウインナー", category: "肉", unit: "g", qty: 180 },
    "4900000000047": { name: "コンソメ顆粒", category: "調味料", unit: "g", qty: 50 },
    "4900000000054": { name: "トマトケチャップ", category: "調味料", unit: "ml", qty: 500 },
    "4900000000061": { name: "味噌", category: "調味料", unit: "g", qty: 750 },
    "4900000000078": { name: "サラダ油", category: "調味料", unit: "ml", qty: 1000 },
    "4900000000085": { name: "卵(Lサイズ10個入り)", category: "卵", unit: "個", qty: 10 },
    "4900000000092": { name: "食パン(6枚切り)", category: "加工食品", unit: "個", qty: 1 },
    "4900000000108": { name: "ヨーグルト(プレーン)", category: "乳製品", unit: "g", qty: 400 },
    "4900000000115": { name: "バター", category: "乳製品", unit: "g", qty: 200 },
    "4900000000122": { name: "鶏むね肉", category: "肉", unit: "g", qty: 300 },
    "4900000000139": { name: "豚こま切れ肉", category: "肉", unit: "g", qty: 250 },
    "4900000000146": { name: "冷凍餃子", category: "加工食品", unit: "個", qty: 12 },
    "4900000000153": { name: "納豆(3パック)", category: "豆腐・大豆製品", unit: "個", qty: 3 },
    "4900000000160": { name: "にんじん", category: "野菜", unit: "個", qty: 3 },
    "4900000000177": { name: "玉ねぎ", category: "野菜", unit: "個", qty: 3 },
    "4900000000184": { name: "めんつゆ", category: "調味料", unit: "ml", qty: 500 },
    "4900000000191": { name: "オレンジジュース", category: "飲料", unit: "ml", qty: 1000 }
  };

  // ------------------------------------------------------------
  // カメラ / BarcodeDetector 関連の内部状態(モジュールスコープ)
  // ------------------------------------------------------------
  var _stream = null;
  var _intervalId = null;
  var _detector = null;
  var _videoEl = null;

  function isNativeScanSupported() {
    return typeof window !== "undefined" && "BarcodeDetector" in window;
  }

  function mapCameraError(err) {
    var name = err && err.name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return new Error("カメラの利用が許可されていません。ブラウザの設定でカメラへのアクセスを許可してください");
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return new Error("この端末にカメラが見つかりませんでした");
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return new Error("カメラを起動できませんでした(他のアプリがカメラを使用中の可能性があります)");
    }
    return new Error("カメラの起動に失敗しました: " + (err && err.message ? err.message : String(err)));
  }

  function stopCamera() {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    if (_stream) {
      try {
        _stream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e) {
        // 無視: 既に停止済みのトラックなど
      }
      _stream = null;
    }
    if (_videoEl) {
      try {
        _videoEl.srcObject = null;
      } catch (e) {
        // 無視
      }
    }
    _videoEl = null;
    _detector = null;
  }

  function startCamera(videoEl, onDetect, onError) {
    // 同時に複数起動しないよう、まず既存のカメラ利用を停止しておく
    stopCamera();

    return new Promise(function (resolve) {
      try {
        if (location.protocol !== "https:" && location.hostname !== "localhost") {
          onError(new Error("カメラを使うにはHTTPS接続が必要です"));
          resolve();
          return;
        }

        if (!isNativeScanSupported()) {
          onError(new Error("この端末のブラウザはカメラでのバーコード自動読取に対応していません"));
          resolve();
          return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          onError(new Error("この端末のブラウザはカメラ利用に対応していません"));
          resolve();
          return;
        }

        videoEl.setAttribute("playsinline", "");
        videoEl.muted = true;

        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: "environment" } })
          .then(function (mediaStream) {
            _stream = mediaStream;
            videoEl.srcObject = mediaStream;
            _videoEl = videoEl;

            var playResult = videoEl.play();
            if (playResult && typeof playResult.then === "function") {
              playResult.catch(function () {
                /* 一部ブラウザでの自動再生失敗は無視 */
              });
            }

            try {
              _detector = new window.BarcodeDetector({
                formats: ["ean_13", "ean_8", "upc_a", "upc_e"]
              });
            } catch (e) {
              stopCamera();
              onError(new Error("バーコード検出器の初期化に失敗しました"));
              resolve();
              return;
            }

            _intervalId = setInterval(function () {
              if (!_detector || !_videoEl) return;
              _detector
                .detect(_videoEl)
                .then(function (results) {
                  if (results && results.length > 0) {
                    var value = results[0].rawValue;
                    stopCamera();
                    onDetect(value);
                  }
                })
                .catch(function () {
                  // 1フレームの検出失敗は無視して次のインターバルへ
                });
            }, 300);

            resolve();
          })
          .catch(function (err) {
            onError(mapCameraError(err));
            resolve();
          });
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        resolve();
      }
    });
  }

  // ------------------------------------------------------------
  // JANコード(EAN-13/EAN-8) チェックディジット検証
  // GS1標準アルゴリズム: コード全体(チェックディジット含む)を
  // 右端から1桁目・2桁目...とし、奇数位置は重み1、偶数位置は重み3
  // として各桁との積の総和を取り、10の倍数であれば有効。
  // ------------------------------------------------------------
  function isValidJan(code) {
    if (code === null || code === undefined) return false;
    var s = String(code).trim();
    if (!/^\d{8}$/.test(s) && !/^\d{13}$/.test(s)) return false;

    var digits = s.split("").map(Number);
    var n = digits.length;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var posFromRight = n - i; // 1-indexed, 右端が1
      var weight = posFromRight % 2 === 1 ? 1 : 3;
      sum += digits[i] * weight;
    }
    return sum % 10 === 0;
  }

  // ------------------------------------------------------------
  // Open Food Facts のカテゴリタグを日本語カテゴリへ簡易マッピング
  // ------------------------------------------------------------
  var CATEGORY_RULES = [
    [/milk|dairy|yogurt|cheese/, "乳製品"],
    [/meat|poultry|beef|pork|chicken/, "肉"],
    [/fish|seafood/, "魚"],
    [/vegetable/, "野菜"],
    [/egg/, "卵"],
    [/tofu|soy/, "豆腐・大豆製品"],
    [/sauce|condiment|seasoning|oil|vinegar/, "調味料"],
    [/beverage|drink|water|juice/, "飲料"],
    [/snack|frozen|canned|meal/, "加工食品"]
  ];

  function mapCategory(categoriesTags) {
    if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return "その他";
    var joined = categoriesTags.join(" ").toLowerCase();
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      if (CATEGORY_RULES[i][0].test(joined)) return CATEGORY_RULES[i][1];
    }
    return "その他";
  }

  // ------------------------------------------------------------
  // Open Food Facts の quantity 文字列("500 ml" "1 L" "200g" "1kg" 等)
  // を { qty, unit } (ml または g) へ変換する。解析できなければ null。
  // ------------------------------------------------------------
  function parseQuantity(quantityStr) {
    if (!quantityStr) return null;
    var m = String(quantityStr).match(/([\d.]+)\s*(ml|l|kg|g)\b/i);
    if (!m) return null;
    var num = parseFloat(m[1]);
    if (isNaN(num)) return null;
    var unitRaw = m[2].toLowerCase();
    if (unitRaw === "l") {
      num = num * 1000;
      unitRaw = "ml";
    } else if (unitRaw === "kg") {
      num = num * 1000;
      unitRaw = "g";
    }
    return { qty: Math.round(num), unit: unitRaw };
  }

  // ------------------------------------------------------------
  // カテゴリ・商品名から単位/数量の既定値を推定する
  // ------------------------------------------------------------
  function estimateUnitQty(category, name) {
    var n = name || "";
    if (category === "調味料" || category === "飲料") {
      if (/油|しょうゆ|醤油|酒|みりん|酢|ソース|ドレッシング|ジュース|牛乳/.test(n)) {
        return { unit: "ml", qty: category === "飲料" ? 1000 : 500 };
      }
      if (/塩|砂糖|粉|だし|コンソメ|味噌/.test(n)) {
        return { unit: "g", qty: 200 };
      }
    }
    return { unit: "個", qty: 1 };
  }

  // ------------------------------------------------------------
  // Open Food Facts API 照会 (タイムアウト15秒、失敗時はnullを返す)
  // ------------------------------------------------------------
  function lookupOpenFoodFacts(code) {
    var url =
      "https://world.openfoodfacts.org/api/v2/product/" +
      encodeURIComponent(code) +
      ".json?fields=product_name,product_name_ja,brands,quantity,categories_tags";

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = controller
      ? setTimeout(function () {
          controller.abort();
        }, 15000)
      : null;

    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || data.status !== 1 || !data.product) return null;

        var product = data.product;
        var baseName = product.product_name_ja || product.product_name || "";
        if (!baseName) return null;

        var name = baseName;
        if (product.brands) {
          var brand = String(product.brands).split(",")[0].trim();
          if (brand && baseName.indexOf(brand) === -1) {
            name = brand + " " + baseName;
          }
        }

        var category = mapCategory(product.categories_tags);
        var parsed = parseQuantity(product.quantity);
        var unit, qty;
        if (parsed) {
          unit = parsed.unit;
          qty = parsed.qty;
        } else {
          var est = estimateUnitQty(category, name);
          unit = est.unit;
          qty = est.qty;
        }

        return {
          found: true,
          source: "openfoodfacts",
          name: name,
          category: category,
          unit: unit,
          qty: qty,
          raw: data
        };
      })
      .catch(function () {
        if (timeoutId) clearTimeout(timeoutId);
        // ネットワークエラー・タイムアウトはアプリ全体を落とさないよう握りつぶす
        return null;
      });
  }

  // ------------------------------------------------------------
  // JANコード照会: (a)ローカル辞書 → (b)Open Food Facts → (c)不発
  // ------------------------------------------------------------
  function lookupJan(code) {
    var c = String(code).trim();

    var local = LOCAL_JAN_DB[c];
    if (local) {
      return Promise.resolve({
        found: true,
        source: "local",
        name: local.name,
        category: local.category,
        unit: local.unit,
        qty: local.qty,
        raw: null
      });
    }

    return lookupOpenFoodFacts(c).then(function (offResult) {
      if (offResult) return offResult;
      return { found: false, source: null };
    });
  }

  // ------------------------------------------------------------
  // 写真からのバーコード読取 (window.AI があれば利用する薄いラッパー)
  // window.AI が存在しない環境でもこのファイルの読み込み自体は
  // エラーにならないよう、参照は必ず実行時の機能検出を経由する。
  // ------------------------------------------------------------
  function canReadPhoto() {
    return (
      typeof window !== "undefined" &&
      !!window.AI &&
      typeof window.AI.readBarcodeFromPhoto === "function"
    );
  }

  function readBarcodeFromPhoto(file) {
    if (!canReadPhoto()) return Promise.resolve(null);
    return Promise.resolve()
      .then(function () {
        return window.AI.readBarcodeFromPhoto(file);
      })
      .catch(function () {
        return null;
      });
  }

  // ------------------------------------------------------------
  // 公開API
  // ------------------------------------------------------------
  window.Scanner = {
    isNativeScanSupported: isNativeScanSupported,
    startCamera: startCamera,
    stopCamera: stopCamera,
    lookupJan: lookupJan,
    isValidJan: isValidJan,
    canReadPhoto: canReadPhoto,
    readBarcodeFromPhoto: readBarcodeFromPhoto
  };
})();
