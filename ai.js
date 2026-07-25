/*
 * ai.js — Claude API 連携モジュール (BYOK: Bring Your Own Key)
 *
 * このモジュールは、ユーザー自身の Anthropic API キーを、この端末のブラウザの
 * localStorage にのみ保存し、ブラウザから直接 Claude API (api.anthropic.com) を
 * 呼び出す方式（BYOK）で動作します。
 *
 * - APIキーはこの端末のブラウザ内 (localStorage) にのみ保存されます。
 * - APIキーおよびリクエスト内容の送信先は Anthropic の公式API (https://api.anthropic.com)
 *   のみです。それ以外の外部サーバーには一切送信しません。
 * - サーバー側（GitHub Pages 等）にキーが保存・送信されることはありません。
 *
 * 素の ES5/ES2017 相当の JS のみで書かれており、モジュール構文 (export) は
 * 使用していません。<script src="ai.js"></script> で読み込むと、グローバルに
 * window.AI が公開されます。
 */

(function (global) {
  "use strict";

  // ------------------------------------------------------------------
  // 定数
  // ------------------------------------------------------------------

  var API_KEY_STORAGE_KEY = "fridge-compass-api-key";
  var API_URL = "https://api.anthropic.com/v1/messages";
  var MODEL = "claude-opus-5";
  var ANTHROPIC_VERSION = "2023-06-01";
  var REQUEST_TIMEOUT_MS = 90000; // 90秒

  var CATEGORIES = [
    "野菜", "肉", "魚", "卵", "乳製品", "豆腐・大豆製品",
    "加工食品", "調味料", "飲料", "その他"
  ];

  var UNITS = ["個", "ml", "g"];

  // ------------------------------------------------------------------
  // APIキー管理
  // ------------------------------------------------------------------

  function getKey() {
    try {
      return global.localStorage.getItem(API_KEY_STORAGE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function setKey(key) {
    var trimmed = (key == null ? "" : String(key)).trim();
    try {
      global.localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
    } catch (e) {
      // localStorage が使えない環境では何もできない
    }
    return trimmed;
  }

  function clearKey() {
    try {
      global.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch (e) {
      // no-op
    }
  }

  function hasKey() {
    var k = getKey();
    return typeof k === "string" && k.length > 0;
  }

  // ------------------------------------------------------------------
  // 共通リクエスト処理
  // ------------------------------------------------------------------

  /**
   * Anthropic Messages API へ送るリクエストボディを組み立てる。
   * 送信処理から分離してあるので、実送信せずにボディの形を検証できる。
   *
   * @param {Object} opts
   *   opts.maxTokens {number}
   *   opts.messages {Array} - content は string または配列(ブロック)
   *   opts.effort {string} - "low" 等
   *   opts.format {Object|undefined} - output_config.format に入れる json_schema 定義
   * @returns {Object} リクエストボディ
   */
  function buildRequestBody(opts) {
    opts = opts || {};
    var outputConfig = { effort: opts.effort || "low" };
    if (opts.format) {
      outputConfig.format = opts.format;
    }

    var body = {
      model: MODEL,
      max_tokens: opts.maxTokens,
      messages: opts.messages,
      output_config: outputConfig
    };
    // 注意: temperature / top_p / top_k / thinking は絶対に含めない。
    return body;
  }

  function buildHeaders(apiKey) {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
    };
  }

  /**
   * ステータスコードに応じた日本語エラーメッセージを返す。
   */
  function messageForStatus(status) {
    if (status === 401) {
      return "APIキーが無効です。設定を確認してください。";
    }
    if (status === 429) {
      return "リクエストが多すぎます（レート制限）。しばらく待ってから再試行してください。";
    }
    if (status === 400) {
      return "リクエストが不正です。入力内容を確認してください。";
    }
    if (status === 529 || status >= 500) {
      return "Anthropicサーバーが一時的に混雑しています。しばらく待ってから再試行してください。";
    }
    return "APIエラーが発生しました（ステータス: " + status + "）。";
  }

  /**
   * Anthropic Messages API を呼び出し、パース済みJSONを返す。
   * 呼び出し元は解析済みの JS オブジェクトを受け取る。
   *
   * @param {Object} body - buildRequestBody() で作ったリクエストボディ
   * @returns {Promise<Object>} パース済みJSON (items や recipes を含むオブジェクト)
   */
  function sendMessage(body) {
    var apiKey = getKey();
    if (!hasKey()) {
      return Promise.reject(new Error("APIキーが未設定です"));
    }

    var controller = null;
    var timeoutId = null;
    var fetchOpts = {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body)
    };

    if (typeof global.AbortController === "function") {
      controller = new global.AbortController();
      fetchOpts.signal = controller.signal;
      timeoutId = global.setTimeout(function () {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    }

    return global.fetch(API_URL, fetchOpts)
      .then(function (response) {
        if (timeoutId !== null) { global.clearTimeout(timeoutId); }
        if (!response.ok) {
          return response
            .json()
            .catch(function () { return null; })
            .then(function () {
              throw new Error(messageForStatus(response.status));
            });
        }
        return response.json();
      })
      .then(function (data) {
        // 1. refusal は content を読む前にチェック
        if (data && data.stop_reason === "refusal") {
          throw new Error("安全上の理由でAIが応答を拒否しました");
        }
        // 2. max_tokens で切れた場合
        if (data && data.stop_reason === "max_tokens") {
          throw new Error("応答が長すぎて途中で切れました");
        }
        // 3. content からテキストブロックを取り出して JSON.parse
        var content = (data && data.content) || [];
        var textBlock = null;
        for (var i = 0; i < content.length; i++) {
          if (content[i] && content[i].type === "text") {
            textBlock = content[i];
            break;
          }
        }
        if (!textBlock) {
          throw new Error("AIの応答にテキストが含まれていませんでした");
        }
        try {
          return JSON.parse(textBlock.text);
        } catch (parseErr) {
          throw new Error("AIの応答をJSONとして解析できませんでした");
        }
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          throw new Error("リクエストがタイムアウトしました");
        }
        if (err instanceof Error) {
          throw err;
        }
        throw new Error("ネットワークに接続できません");
      });
  }

  // ------------------------------------------------------------------
  // testKey()
  // ------------------------------------------------------------------

  function testKey() {
    if (!hasKey()) {
      return Promise.resolve({ ok: false, message: "APIキーが未設定です" });
    }

    var apiKey = getKey();
    var body = {
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "OK とだけ返して" }],
      output_config: { effort: "low" }
    };

    var controller = null;
    var timeoutId = null;
    var fetchOpts = {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body)
    };
    if (typeof global.AbortController === "function") {
      controller = new global.AbortController();
      fetchOpts.signal = controller.signal;
      timeoutId = global.setTimeout(function () {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    }

    return global.fetch(API_URL, fetchOpts)
      .then(function (response) {
        if (timeoutId !== null) { global.clearTimeout(timeoutId); }
        if (!response.ok) {
          return Promise.reject(new Error(messageForStatus(response.status)));
        }
        return response.json();
      })
      .then(function (data) {
        if (data && data.stop_reason === "refusal") {
          return { ok: false, message: "安全上の理由でAIが応答を拒否しました" };
        }
        return { ok: true, message: "APIキーは有効です" };
      })
      .catch(function (err) {
        var message;
        if (err && err.name === "AbortError") {
          message = "リクエストがタイムアウトしました";
        } else if (err instanceof Error) {
          message = err.message;
        } else {
          message = "ネットワークに接続できません";
        }
        return { ok: false, message: message };
      });
  }

  // ------------------------------------------------------------------
  // 画像リサイズ (レシートOCR用)
  // ------------------------------------------------------------------

  var MAX_LONG_EDGE = 2000;
  var JPEG_QUALITY = 0.8;

  /**
   * File/Blob を canvas で長辺 2000px 以下に縮小し、
   * "data:image/jpeg;base64,..." プレフィックスを除いた純粋な base64 文字列を返す。
   *
   * @param {File|Blob} file
   * @returns {Promise<string>} プレフィックスなしのbase64文字列
   */
  function resizeImageToBase64(file) {
    return new Promise(function (resolve, reject) {
      if (typeof global.FileReader === "undefined") {
        reject(new Error("この環境では画像を読み込めません"));
        return;
      }

      var reader = new global.FileReader();
      reader.onerror = function () {
        reject(new Error("画像の読み込みに失敗しました"));
      };
      reader.onload = function () {
        var img = new global.Image();
        img.onerror = function () {
          reject(new Error("画像のデコードに失敗しました"));
        };
        img.onload = function () {
          try {
            var width = img.width;
            var height = img.height;
            var longEdge = Math.max(width, height);

            if (longEdge > MAX_LONG_EDGE) {
              var scale = MAX_LONG_EDGE / longEdge;
              width = Math.round(width * scale);
              height = Math.round(height * scale);
            }

            var canvas = global.document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            var dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
            var prefix = "data:image/jpeg;base64,";
            var base64 = dataUrl.indexOf(prefix) === 0
              ? dataUrl.slice(prefix.length)
              : dataUrl.replace(/^data:[^,]*,/, "");
            resolve(base64);
          } catch (e) {
            reject(e instanceof Error ? e : new Error("画像の変換に失敗しました"));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ------------------------------------------------------------------
  // ocrReceipt(file)
  // ------------------------------------------------------------------

  var OCR_ITEM_SCHEMA = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
            qty: { type: "number" },
            unit: { type: "string", enum: UNITS }
          },
          required: ["name", "category", "qty", "unit"],
          additionalProperties: false
        }
      }
    },
    required: ["items"],
    additionalProperties: false
  };

  var OCR_PROMPT = [
    "これは日本のスーパーマーケットのレシート画像です。",
    "レシートの中から、食品・食材の行だけを抽出してください。",
    "合計・小計・税・釣銭・店名・電話番号・ポイント・値引きなどの行は除外してください。",
    "商品名は一般的な食材名に正規化してください（例:「豚こま切れ肉100g」→「豚こま切れ肉」）。",
    "カテゴリは次の中から選んでください: " + CATEGORIES.join("、") + "。",
    "単位(unit)は、醤油・酒・みりんなどの液体調味料は \"ml\"、塩・砂糖・粉末だしなどの粉末は \"g\"、",
    "それ以外（個数で数えるもの）は \"個\" としてください。",
    "内容量がレシート上で読み取れる場合はその数値を qty に入れてください。",
    "読み取れない場合は、液体は500、粉末は200、個数のものは1を既定値としてください。",
    "食品が1つも読み取れない場合は items を空配列にしてください。",
    "指定されたJSONスキーマに厳密に従って出力してください。"
  ].join("\n");

  /**
   * レシート画像 (File) から食材情報を抽出する。
   * @param {File} file
   * @returns {Promise<{items: Array}>}
   */
  function ocrReceipt(file) {
    if (!hasKey()) {
      return Promise.reject(new Error("APIキーが未設定です"));
    }
    return resizeImageToBase64(file).then(function (base64) {
      var body = buildRequestBody({
        maxTokens: 4096,
        effort: "low",
        format: { type: "json_schema", schema: OCR_ITEM_SCHEMA },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64
                }
              },
              { type: "text", text: OCR_PROMPT }
            ]
          }
        ]
      });
      return sendMessage(body);
    });
  }

  // ------------------------------------------------------------------
  // suggestRecipes(inventory)
  // ------------------------------------------------------------------

  var RECIPE_SCHEMA = {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            reason: { type: "string" },
            usedIngredients: { type: "array", items: { type: "string" } },
            missingIngredients: { type: "array", items: { type: "string" } },
            steps: { type: "array", items: { type: "string" } },
            seasonings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  tbsp: { type: "number" },
                  tsp: { type: "number" }
                },
                required: ["name", "tbsp", "tsp"],
                additionalProperties: false
              }
            },
            referenceQuery: { type: "string" }
          },
          required: [
            "name", "reason", "usedIngredients", "missingIngredients",
            "steps", "seasonings", "referenceQuery"
          ],
          additionalProperties: false
        }
      }
    },
    required: ["recipes"],
    additionalProperties: false
  };

  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  function daysUntil(expiry) {
    if (!expiry) { return null; }
    var today = new Date();
    var todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var expiryDate = new Date(expiry + "T00:00:00");
    if (isNaN(expiryDate.getTime())) { return null; }
    return Math.round((expiryDate.getTime() - todayMidnight.getTime()) / MS_PER_DAY);
  }

  function formatInventoryForPrompt(inventory) {
    var lines = [];
    for (var i = 0; i < inventory.length; i++) {
      var item = inventory[i] || {};
      var remain = daysUntil(item.expiry);
      var remainText = remain === null ? "不明" : (remain + "日");
      lines.push(
        (item.name || "") + " " +
        (item.qty != null ? item.qty : "") + (item.unit || "") + " " +
        "[" + (item.category || "") + "] " +
        "賞味期限まで残り" + remainText
      );
    }
    return lines.join("\n");
  }

  var RECIPE_PROMPT_HEADER = [
    "以下は現在の冷蔵庫の在庫です（1行1食材）。",
    "この在庫をもとに、一人暮らし向けの現実的な家庭料理レシピをちょうど3品提案してください。",
    "賞味期限が近い食材を優先的に使ってください。",
    "各レシピについて:",
    "- reason: なぜこのレシピを選んだかを1文で（期限が近い食材名を挙げてください）",
    "- usedIngredients: 在庫にある食材のうち使用するもの（在庫の食材名と一致させてください）",
    "- missingIngredients: 在庫にないが必要な食材",
    "- seasonings: 使用する調味料と大さじ(tbsp)・小さじ(tsp)の杯数。使わない方は0にしてください。調味料を使わない場合は空配列にしてください。",
    "- steps: 調理手順を3〜5ステップで",
    "- referenceQuery: レシピ検索用の日本語キーワード（例:「肉じゃが 簡単」）",
    "指定されたJSONスキーマに厳密に従って出力してください。",
    "",
    "在庫:"
  ].join("\n");

  /**
   * 在庫からレシピを提案する。
   * @param {Array} inventory - {id,name,qty,category,expiry,unit,addedAt} の配列
   * @returns {Promise<{recipes: Array}>}
   */
  function suggestRecipes(inventory) {
    if (!hasKey()) {
      return Promise.reject(new Error("APIキーが未設定です"));
    }
    var list = inventory || [];
    var promptText = RECIPE_PROMPT_HEADER + "\n" + formatInventoryForPrompt(list);

    var body = buildRequestBody({
      maxTokens: 8192,
      effort: "low",
      format: { type: "json_schema", schema: RECIPE_SCHEMA },
      messages: [
        { role: "user", content: promptText }
      ]
    });
    return sendMessage(body);
  }

  // ------------------------------------------------------------------
  // readBarcodeFromPhoto(file)
  // ------------------------------------------------------------------
  //
  // iOS Safari は BarcodeDetector API 非対応のため、iPhoneではカメラでの
  // 自動バーコード読取ができない。代わりに「バーコードの写真を撮って
  // Claudeに数字を読ませる」経路を用意する。

  var BARCODE_SCHEMA = {
    type: "object",
    properties: {
      found: { type: "boolean" },
      code: { type: "string" }
    },
    required: ["found", "code"],
    additionalProperties: false
  };

  var BARCODE_PROMPT = [
    "画像に写っている商品バーコード（JAN/EAN-13 または EAN-8）の数字列だけを読み取ってください。",
    "バーコードの下に印字されている数字を優先して読んでください。",
    "読み取れた場合は found: true とし、code にはハイフンや空白を含まない数字のみを入れてください。",
    "バーコードが写っていない、または不鮮明で読み取れない場合は found: false, code: \"\" を返してください。",
    "推測で数字を捏造しないでください。"
  ].join("\n");

  /**
   * モデルからの {found, code} 応答を検証し、有効な数字コードだけを返す。
   * 桁数(8桁 or 13桁)チェック・数字以外混入チェックを行い、
   * モデルの出力を無条件には信用しない。
   *
   * @param {{found: boolean, code: string}} result
   * @returns {string|null}
   */
  function extractBarcodeCode(result) {
    if (!result || result.found !== true) {
      return null;
    }
    var code = result.code;
    if (typeof code !== "string") {
      return null;
    }
    if (!/^[0-9]+$/.test(code)) {
      return null;
    }
    if (code.length !== 8 && code.length !== 13) {
      return null;
    }
    return code;
  }

  /**
   * バーコードの写真から数字列を読み取る。
   * @param {File} file
   * @returns {Promise<string|null>} 読み取れた8桁/13桁の数字コード、
   *   読み取れない/不正な場合は null。
   *   APIキー未設定時は他メソッドと同様に reject する（一貫性のため）。
   */
  function readBarcodeFromPhoto(file) {
    if (!hasKey()) {
      return Promise.reject(new Error("APIキーが未設定です"));
    }
    return resizeImageToBase64(file).then(function (base64) {
      var body = buildRequestBody({
        maxTokens: 1024,
        effort: "low",
        format: { type: "json_schema", schema: BARCODE_SCHEMA },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64
                }
              },
              { type: "text", text: BARCODE_PROMPT }
            ]
          }
        ]
      });
      return sendMessage(body).then(extractBarcodeCode);
    });
  }

  // ------------------------------------------------------------------
  // 公開API
  // ------------------------------------------------------------------

  global.AI = {
    getKey: getKey,
    setKey: setKey,
    clearKey: clearKey,
    hasKey: hasKey,
    testKey: testKey,
    ocrReceipt: ocrReceipt,
    suggestRecipes: suggestRecipes,
    readBarcodeFromPhoto: readBarcodeFromPhoto,

    // 内部関数はテスト・検証のために公開しておく（意図的な内部API）
    _internal: {
      buildRequestBody: buildRequestBody,
      resizeImageToBase64: resizeImageToBase64,
      daysUntil: daysUntil,
      extractBarcodeCode: extractBarcodeCode,
      CATEGORIES: CATEGORIES,
      UNITS: UNITS,
      MODEL: MODEL,
      API_URL: API_URL
    }
  };
})(typeof window !== "undefined" ? window : this);
