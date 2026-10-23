# 協作說明

兩個人（加上各自的 Claude）同時改這個倉庫時的約定。核心只有一句：**`main` 是線上版本，所有改動都走「分支 → PR → 合併」。**

## 為什麼

Vercel 只要看到 `main` 有新提交，就會自動部署到 https://lfjmwl.com 。所以：

- 每個人在自己的分支上改，互不影響，也不會把半成品推到線上。
- 改好開 PR，自動跑測試，另一個人看過再合併。合併那一刻才上線。

`main` 已設保護規則：不能直接推送、不能強推、不能刪除，必須經 PR 且測試（CI 的 `test` 檢查）通過才能合併。

## 日常流程

```bash
# 1. 開工前：拿到最新的 main
git checkout main
git pull

# 2. 開一條分支（名稱用 feat/、fix/、chore/、docs/ 開頭，後面寫做什麼）
git checkout -b feat/new-logo

# 3. 改程式，跑測試
npm test

# 4. 提交並推上 GitHub
git add -A
git commit -m "換上正式 Logo"
git push -u origin feat/new-logo
```

5. 到 GitHub 上點 **Compare & pull request**，照範本填寫後建立 PR。
6. 等 PR 頁面的 **CI / test** 變綠勾；需要的話打開 Vercel 預覽網址看畫面。
7. 請對方看一下，沒問題就按 **Squash and merge**（把分支的多個提交壓成一個，`main` 的歷史比較乾淨），然後刪掉分支。
8. 合併後 Vercel 會自動部署到線上。

## 分工與溝通

- 開工前到 GitHub **Issues** 開一張卡，寫「我在改什麼」，並指派給自己。兩個人就不會同時改同一處。
- 盡量按區塊分工，例如一個人改頁面（`public/`），一個人改數據引擎（`api/_lib/`）。
- PR 保持小而短：一個 PR 只做一件事，做完當天合併最理想。分支開越久，越容易衝突。

## 遇到衝突

只有兩個人改了同一個檔案的同一段，才會衝突。PR 頁面會提示 **This branch has conflicts**：

```bash
git checkout feat/my-branch
git pull origin main        # 把最新的 main 合進自己的分支
# 打開標出 <<<<<<< ======= >>>>>>> 的檔案，決定保留哪一段，刪掉這些標記
npm test
git add -A
git commit -m "解決與 main 的衝突"
git push
```

不確定該保留哪段時，在 PR 裡 @ 對方一起看。

## 本地開發

```bash
npm install
npm test        # 單元測試
npm run dev     # http://localhost:3000/cn ，讀線上數據，不需要 Wind 金鑰
```

想在本地產生一份假數據（不呼叫 Wind、不花額度）：

```bash
WIND_MOCK=1 SHORT_EMOTION_DATA_DIR=./short-emotion-data npm run refresh -- --force
SHORT_EMOTION_DATA_DIR=./short-emotion-data npm run dev
```

`short-emotion-data/` 已加入 `.gitignore`，不會被提交。

## 用 Claude 寫程式時

不論在哪台電腦、哪個對話，都請 Claude 照同樣規矩做：**開一條分支、改完開 PR，不要直接推 `main`**。PR 開好後由人看過再合併。

## 不要手動改的東西

- `short-emotion-data` 分支：由定時任務自動產生，每次都會整個覆寫。
- 金鑰：`WIND_API_KEY`（GitHub Secret）、`GITHUB_ACTIONS_TOKEN` 和 `CRON_SECRET`（Vercel 環境變數；`CRON_SECRET` 與 Supabase Vault 裡的 `shortemotion_cron_secret` 同值）只放在平台設定裡，不要寫進程式或提交。
- `.github/workflows/short-emotion.yml` 的手動運行參數（target / force / market）：頁面的「刷新」按鈕和準點定時（`/api/cron`）依賴它們，改的話要同步改 `api/_lib/short-emotion/github.js`。

## 已知限制

Vercel 目前是免費版（Hobby），官方說明只有帳號擁有者能觸發部署。非擁有者推送的分支可能拿不到預覽網址，合併後也可能不會自動上線。遇到這種情況，正式解法是升級 Vercel Pro，並把成員加入團隊。
