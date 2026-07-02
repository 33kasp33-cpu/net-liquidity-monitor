# Global Net Liquidity Monitor & AI Dashboard

FRBの総資産 (WALCL)、TGA残高 (WTREGEN)、リバースレポ残高 (RRPONTSYD) から世界のネット・リキディティ（正味のドル流動性）を算出し、Chart.js を用いて可視化、さらに Google Gemini AI にデータを送信してバブル過熱度や暴落リスク、今週の投資スタンスを自動判定するダッシュボードシステムです。

Google Apps Script (GAS) を利用して、毎週自動でデータを更新し、GitHub API 経由で本リポジトリの `data/liquidity_data.json` および `index.html` を更新・コミットします。GitHub Pages を有効にすることで、常に最新のAI分析レポートとグラフが公開されます。

---

## 🗺️ システム構成と自動化フロー

1. **データ取得・計算 (Google Apps Script)**:
   - 毎週定期的に実行（FREDデータ更新日に連動）。
   - FRED APIから `WALCL`、`WTREGEN`、`RRPONTSYD` を取得。
   - `Net Liquidity (Billions) = (WALCL - WTREGEN) / 1000 - RRPONTSYD` を計算。
2. **AIレポート生成 (Gemini API)**:
   - 最新データと推移を `gemini-2.5-flash` モデルに送信し、バブル度、暴落リスク、投資スタンスを判定させ、詳細レポート（Markdown）を生成。
3. **自動デプロイ (GitHub API & GitHub Pages)**:
   - `data/liquidity_data.json` と、データを埋め込んだ `index.html` を本リポジトリに自動コミット。
   - GitHub Pages を通じてダッシュボードが自動で最新化されて公開。

---

## 📂 ファイル構成

- **`index.html`**:
  - Tailwind CSS と Chart.js を使用した美麗なダッシュボードUI。
  - レポートからメタデータを抽出し、バブル過熱度・暴落リスクのインジケーターを動的描画。
- **`gas_script.js`**:
  - Google Apps Script 用のソースコード。GASプロジェクトにそのまま貼り付けて利用します。
- **`data/liquidity_data.json`**:
  - GASによって毎週自動更新されるネット・リキディティの時系列データ。

---

## 🚀 セットアップ手順

詳細な導入・連携手順については、ローカル環境のウォークスルーまたは以下の手順に従ってください。

### 1. リポジトリの GitHub Pages 有効化
- 本リポジトリの **Settings** > **Pages** に移動します。
- **Build and deployment** のホスティング元を `Deploy from a branch` に設定。
- `main` ブランチの `/ (root)` を選択し、**Save** ボタンを押します。
- 数分後、`https://<GitHubユーザー名>.github.io/<リポジトリ名>/` でダッシュボードが公開されます。

### 2. 各種APIキーの取得
- **FRED API Key**: [St. Louis Fed](https://fredaccount.stlouisfed.org/apikeys) から取得。
- **Gemini API Key**: [Google AI Studio](https://aistudio.google.com/) から取得。
- **GitHub PAT (個人用アクセストークン)**: [GitHub Settings](https://github.com/settings/tokens) からクラシックトークンを発行（`repo` スコープが必要）。

### 3. Google Apps Script のデプロイ
1. [Google Apps Script](https://script.google.com/) にて新しいプロジェクトを作成し、`gas_script.js` の内容を貼り付けて保存します。
2. 左側の「設定（歯車マーク）」アイコンをクリックし、「スクリプトプロパティ」に以下の値を設定します：
   - `FRED_API_KEY` : 取得したFREDキー
   - `GEMINI_API_KEY` : 取得したGeminiキー
   - `GITHUB_TOKEN` : 取得したGitHub PAT
   - `GITHUB_OWNER` : 自身のGitHubユーザー名
   - `GITHUB_REPO` : `net-liquidity-monitor`
   - `GITHUB_BRANCH` : `main`
3. GASの実行関数から `setupTrigger` を選択して実行します。毎週金曜日の朝などに自動実行されるようになり、運用が開始されます。

---

## 免責事項
本システムで生成されるAI分析レポートおよびネット・リキディティ情報は、一般的な市場動向の整理を目的としたものであり、特定の投資行動を勧誘または保証するものではありません。投資判断はご自身の責任で行うようお願いいたします。
