/**
 * Global Liquidity Insight - GAS Automation Script
 * 
 * 毎週木曜日（FREDデータ更新日）に自動実行され、以下の処理を行います：
 * 1. FRED APIから FRB総資産(WALCL)、TGA残高(WTREGEN)、リバースレポ(RRPONTSYD)を取得。
 * 2. ネット・リキディティ(十億ドル)を算出して時系列データをマージ。
 * 3. 直近のデータ推移をGemini APIに送信し、AI分析レポートを生成。
 * 4. GitHub API経由で `data/liquidity_data.json` と、データを埋め込んだ `index.html` をリポジトリにコミット＆プッシュ。
 * 
 * 【事前準備】
 * スクリプトの「設定（歯車マーク）」->「スクリプトプロパティ」に以下の環境変数を設定してください：
 * - FRED_API_KEY : FREDのAPIキー
 * - GEMINI_API_KEY : GeminiのAPIキー
 * - GITHUB_TOKEN : GitHubの個人用アクセストークン（PAT、`repo`スコープが必要）
 * - GITHUB_OWNER : GitHubのユーザー名または組織名
 * - GITHUB_REPO : リポジトリ名
 * - GITHUB_BRANCH : 公開用ブランチ名（例: main または gh-pages）
 */

// メインのエントリーポイント
function runLiquidityWorkflow() {
  var properties = PropertiesService.getScriptProperties().getProperties();
  
  // 必須プロパティのチェック
  var requiredKeys = ['FRED_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH'];
  for (var i = 0; i < requiredKeys.length; i++) {
    if (!properties[requiredKeys[i]]) {
      throw new Error("スクリプトプロパティ '" + requiredKeys[i] + "' が設定されていません。");
    }
  }

  Logger.log("=== 1. FREDからデータ取得開始 ===");
  var liquidityData = fetchAndMergeFredData(properties.FRED_API_KEY);
  Logger.log("取得データ件数: " + liquidityData.length + "件");
  
  if (liquidityData.length === 0) {
    throw new Error("FREDからのデータ取得に失敗したか、データが空です。");
  }

  Logger.log("=== 2. Gemini APIで分析レポート生成開始 ===");
  var aiReport = generateGeminiReport(properties.GEMINI_API_KEY, liquidityData);
  Logger.log("AI分析レポート生成完了");

  Logger.log("=== 3. GitHubへデータをコミット＆プッシュ ===");
  
  // JSTタイムスタンプの作成
  var lastUpdated = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss") + " (JST)";
  
  // 3-1. JSONデータをコミット
  var jsonContent = JSON.stringify(liquidityData, null, 2);
  commitFileToGitHub(
    properties.GITHUB_OWNER,
    properties.GITHUB_REPO,
    properties.GITHUB_BRANCH,
    properties.GITHUB_TOKEN,
    "data/liquidity_data.json",
    jsonContent,
    "chore: update liquidity data for " + liquidityData[liquidityData.length - 1].date
  );

  // 3-2. index.html テンプレートを取得して置換しコミット
  var originalHtml = getFileContentFromGitHub(
    properties.GITHUB_OWNER,
    properties.GITHUB_REPO,
    properties.GITHUB_BRANCH,
    properties.GITHUB_TOKEN,
    "index.html"
  );

  var updatedHtml = originalHtml;
  
  // データ配列部分の置換
  updatedHtml = updatedHtml.replace(/\/\*\{\{DATA\}\}\*\/[\s\S]*?(?=\s*;)/, function() {
    return "/*{{DATA}}*/ " + JSON.stringify(liquidityData);
  });
  
  // レポート部分の置換 (バッククォートと$をエスケープ)
  updatedHtml = updatedHtml.replace(/\/\*\{\{REPORT\}\}\*\/[\s\S]*?(?=\s*;)/, function() {
    var escapedReport = aiReport.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    return "/*{{REPORT}}*/ `" + escapedReport + "`";
  });
  
  // 更新日時の置換
  updatedHtml = updatedHtml.replace("/*{{LAST_UPDATED}}*/", lastUpdated);

  commitFileToGitHub(
    properties.GITHUB_OWNER,
    properties.GITHUB_REPO,
    properties.GITHUB_BRANCH,
    properties.GITHUB_TOKEN,
    "index.html",
    updatedHtml,
    "website: update dashboard with latest AI analysis for " + liquidityData[liquidityData.length - 1].date
  );

  Logger.log("=== ワークフロー完了 ===");
}

/**
 * FRED APIからWALCL, WTREGEN, RRPONTSYDを取得し、マージ・ネットリキディティ計算を行う
 */
function fetchAndMergeFredData(apiKey) {
  var threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  var startStr = Utilities.formatDate(threeYearsAgo, "GMT", "yyyy-MM-dd");
  
  // API URLs
  var walclUrl = "https://api.stlouisfed.org/fred/series/observations?series_id=WALCL&api_key=" + apiKey + "&file_type=json&observation_start=" + startStr + "&limit=1000";
  var tgaUrl = "https://api.stlouisfed.org/fred/series/observations?series_id=WTREGEN&api_key=" + apiKey + "&file_type=json&observation_start=" + startStr + "&limit=1000";
  var rrpUrl = "https://api.stlouisfed.org/fred/series/observations?series_id=RRPONTSYD&api_key=" + apiKey + "&file_type=json&observation_start=" + startStr + "&limit=1000";
  
  // Fetch
  var walclResponse = UrlFetchApp.fetch(walclUrl);
  var tgaResponse = UrlFetchApp.fetch(tgaUrl);
  var rrpResponse = UrlFetchApp.fetch(rrpUrl);
  
  var walclData = JSON.parse(walclResponse.getContentText());
  var tgaData = JSON.parse(tgaResponse.getContentText());
  var rrpData = JSON.parse(rrpResponse.getContentText());
  
  // Map作成 (日付 -> 数値)
  var walclMap = {};
  walclData.observations.forEach(function(obs) {
    var val = parseFloat(obs.value);
    if (!isNaN(val)) walclMap[obs.date] = val;
  });
  
  var tgaMap = {};
  tgaData.observations.forEach(function(obs) {
    var val = parseFloat(obs.value);
    if (!isNaN(val)) tgaMap[obs.date] = val;
  });
  
  var rrpMap = {};
  rrpData.observations.forEach(function(obs) {
    var val = parseFloat(obs.value);
    if (!isNaN(val)) rrpMap[obs.date] = val; // RRPONTSYDはすでにBillions
  });
  
  // マージ処理
  var mergedData = [];
  var walclDates = Object.keys(walclMap).sort();
  
  walclDates.forEach(function(dateStr) {
    var walclVal = walclMap[dateStr];
    var tgaVal = tgaMap[dateStr];
    
    // RRPは日次なので、同じ日付がない場合は過去にさかのぼって一番近い営業日を採用
    var rrpVal = findClosestPastValue(rrpMap, dateStr);
    
    // TGAも存在しない場合のためにフォールバック
    if (tgaVal === undefined) {
      tgaVal = findClosestPastValue(tgaMap, dateStr);
    }
    
    if (walclVal !== undefined && tgaVal !== undefined && rrpVal !== undefined) {
      // ネット・リキディティ (十億ドル単位)
      // WALCL: Millions -> Billions (1/1000)
      // WTREGEN (TGA): Millions -> Billions (1/1000)
      // RRPONTSYD (RRP): Billions
      var netLiquidity = (walclVal - tgaVal) / 1000 - rrpVal;
      
      mergedData.push({
        date: dateStr,
        walcl: walclVal,
        tga: tgaVal,
        rrp: rrpVal,
        net_liquidity: Math.round(netLiquidity * 100) / 100
      });
    }
  });
  
  return mergedData;
}

// マップ内に日付が無い場合、過去最大7日前まで遡って値を探す
function findClosestPastValue(map, dateStr) {
  if (map[dateStr] !== undefined) {
    return map[dateStr];
  }
  var date = new Date(dateStr);
  for (var i = 1; i <= 7; i++) {
    var prevDate = new Date(date.getTime() - i * 24 * 60 * 60 * 1000);
    var prevDateStr = Utilities.formatDate(prevDate, "GMT", "yyyy-MM-dd");
    if (map[prevDateStr] !== undefined) {
      return map[prevDateStr];
    }
  }
  return undefined;
}

/**
 * Gemini API (gemini-2.5-flash) を呼び出して分析レポートを作成する
 */
function generateGeminiReport(apiKey, liquidityData) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
  
  // 直近データ抽出
  var latest = liquidityData[liquidityData.length - 1];
  var prev1w = liquidityData[liquidityData.length - 2];
  var prev4w = liquidityData[liquidityData.length - 5]; // 4週間前
  var prev12w = liquidityData[liquidityData.length - 13]; // 12週間前
  
  // 直近12週間のデータ推移テキストを作成
  var recentTrendText = "";
  var startIndex = Math.max(0, liquidityData.length - 12);
  for (var i = startIndex; i < liquidityData.length; i++) {
    var d = liquidityData[i];
    recentTrendText += "- " + d.date + ": NL=" + d.net_liquidity.toFixed(1) + "B (WALCL=" + (d.walcl/1000).toFixed(1) + "B, TGA=" + (d.tga/1000).toFixed(1) + "B, RRP=" + d.rrp.toFixed(1) + "B)\n";
  }
  
  // 統計情報
  var nlValues = liquidityData.map(function(d) { return d.net_liquidity; });
  var maxNl = Math.max.apply(null, nlValues);
  var minNl = Math.min.apply(null, nlValues);
  var avgNl = nlValues.reduce(function(sum, val) { return sum + val; }, 0) / nlValues.length;
  
  // プロンプト構築
  var prompt = "あなたは世界の金融市場における「米ドルネット・リキディティ（流動性）」の変化を可視化・分析し、リスク資産（株式・暗号資産など）への影響を評価するシニア・マクロ経済ストラテジストです。\n\n" +
               "以下の最新の流動性データに基づいて、バブル過熱度や暴落リスク、今週の投資スタンスを判断し、美麗な分析レポートを出力してください。\n\n" +
               "【計算ルール】\n" +
               "ネット・リキディティ = (WALCL - WTREGEN) / 1000 - RRPONTSYD\n" +
               "・WALCL: FRB総資産 (Millions USD -> Billions USDに換算)\n" +
               "・WTREGEN: TGA残高 (財務省一般勘定: Millions USD -> Billions USDに換算)\n" +
               "・RRPONTSYD: リバースレポ残高 (Billions USD)\n" +
               "※TGAとRRPは流動性の「ドレイン（吸引）」要因となるため、総資産から引くことで、市場を流通する純粋なドルの流動性を測定します。\n\n" +
               "【直近データ比較】\n" +
               "- 最新 (" + latest.date + "): NL = " + latest.net_liquidity + " B, WALCL = " + (latest.walcl/1000).toFixed(1) + " B, TGA = " + (latest.tga/1000).toFixed(1) + " B, RRP = " + latest.rrp + " B\n" +
               "- 前週比: " + (latest.net_liquidity - prev1w.net_liquidity).toFixed(1) + " B\n" +
               "- 前月比 (4週前比): " + (latest.net_liquidity - prev4w.net_liquidity).toFixed(1) + " B\n" +
               "- 3ヶ月比 (12週前比): " + (latest.net_liquidity - prev12w.net_liquidity).toFixed(1) + " B\n\n" +
               "【過去3年の統計】\n" +
               "- 最高値: " + maxNl.toFixed(1) + " B\n" +
               "- 最安値: " + minNl.toFixed(1) + " B\n" +
               "- 平均値: " + avgNl.toFixed(1) + " B\n\n" +
               "【直近12週間の時系列データ】\n" +
               recentTrendText + "\n" +
               "【出力フォーマット】\n" +
               "以下のフォーマット通りに正確に出力してください。余計な前置きや説明は不要です。\n\n" +
               "冒頭に、ダッシュボード制御用の以下のJSONブロックを正確に出力してください。\n" +
               "```json\n" +
               "{\n" +
               "  \"heating_level\": 0から100までの整数 (過去の最高・最低や株価動向と照らし合わせた過熱度。現在の水準が高ければ高いほど高い数値),\n" +
               "  \"crash_risk\": 0から100までの整数 (直近4週、12週の流動性減少トレンド、RRPバッファー底打ち懸念などを加味したリスク),\n" +
               "  \"stance\": \"日本語の投資スタンス名 (例: 強気 (Bullish), 警戒的楽観 (Cautious Optimism), 中立 (Neutral), 避難・リスクオフ (Risk Off))\"\n" +
               "}\n" +
               "```\n\n" +
               "JSONブロックの直後に、日本語による詳細レポートを記述してください。マークダウン見出しには以下の3つを正確に使用してください。\n" +
               "## 📊 今週のマクロ分析サマリー\n" +
               "(ネット・リキディティの変化の詳細、各ドレイン要因の分析、金融市場への流動性の過不足を詳細に評価)\n\n" +
               "## ⚠️ 流動性リスクとバブル度\n" +
               "(バブル過熱度と暴落リスクのパーセンテージを選定した具体的なクオンツ・マクロ的根拠。SOFR金利や流動性クラッシュの予兆、RRPの残り寿命などの警告兆候)\n\n" +
               "## 💡 今週の投資戦略\n" +
               "(推奨スタンス、推奨されるキャッシュポジション比率、来週以降に発表されるマクロイベント等での流動性への影響を想定したアクションプラン)";

  var payload = {
    "contents": [{
      "parts": [{
        "text": prompt
      }]
    }],
    "generationConfig": {
      "temperature": 0.2
    }
  };
  
  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error("Gemini API call failed: " + response.getContentText());
  }
  
  var resData = JSON.parse(response.getContentText());
  return resData.candidates[0].content.parts[0].text;
}

/**
 * GitHub APIを使ってファイルをコミット＆プッシュする
 */
function commitFileToGitHub(owner, repo, branch, token, path, contentStr, commitMessage) {
  var url = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path;
  
  // 既存ファイルのSHAを取得する
  var optionsGet = {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    muteHttpExceptions: true
  };
  
  var responseGet = UrlFetchApp.fetch(url + "?ref=" + branch, optionsGet);
  var sha = null;
  if (responseGet.getResponseCode() === 200) {
    var fileInfo = JSON.parse(responseGet.getContentText());
    sha = fileInfo.sha;
  }
  
  // Base64エンコード
  var base64Content = Utilities.base64Encode(contentStr, Utilities.Charset.UTF_8);
  
  var payload = {
    message: commitMessage,
    content: base64Content,
    branch: branch
  };
  if (sha) {
    payload.sha = sha;
  }
  
  var optionsPut = {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  var responsePut = UrlFetchApp.fetch(url, optionsPut);
  var resCode = responsePut.getResponseCode();
  if (resCode !== 200 && resCode !== 201) {
    throw new Error("Failed to commit " + path + ": " + responsePut.getContentText());
  }
  Logger.log("GitHubコミット成功: " + path);
}

/**
 * GitHub APIからファイルの中身を取得する
 */
function getFileContentFromGitHub(owner, repo, branch, token, path) {
  var url = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path + "?ref=" + branch;
  var options = {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error("GitHubからファイル取得に失敗しました (" + path + "): " + response.getContentText());
  }
  
  var fileInfo = JSON.parse(response.getContentText());
  var decodedBytes = Utilities.base64Decode(fileInfo.content);
  var contentStr = Utilities.newBlob(decodedBytes).getDataAsString();
  return contentStr;
}

/**
 * 毎週木曜日自動実行トリガーをセットアップする関数
 * GASエディタ上で手動で1回実行してください。
 */
function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "runLiquidityWorkflow") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // 毎週木曜日の朝6時〜7時に自動実行
  ScriptApp.newTrigger("runLiquidityWorkflow")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY)
    .atHour(6)
    .create();
  
  Logger.log("毎週木曜朝6:00〜7:00の時間駆動トリガーをセットアップしました。");
}
