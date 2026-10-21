# ShortEmotion · 短線情緒

A股短線情緒看板與個股技術分析：**https://lfjmwl.com**（Vercel 預設網址 stockmarketshortemotion.vercel.app 也可用）。

由 [twsvp-frontend](https://github.com/MuWeiLee/twsvp-frontend) 的「短線情緒」原樣遷出（來源 `69593b1`，PR #126），獨立部署。twsvp.com 保留自己的短線情緒頁面，兩站各自取數、互不依賴。

| 網址 | 內容 |
| --- | --- |
| `/about` | 介紹頁（公開）：產品介紹、今日情緒分數、底部「登录」按鈕 |
| `/login` | 登入頁：輸入郵箱 → 同一頁填驗證碼，免費註冊 |
| `/home` | 首頁（**需登入**）：積分與簽到、個股技術分析輸入框、今日短線情緒（分數、階段、市場概況）、當日題材異動（可直接解鎖） |
| `/technicalanalysis` | 個股技術分析（**需登入**，每次分析扣 10 積分） |
| `/shortemotion/cn` | 短線情緒 · A股（**需登入**） |
| `/` | 已登入 → `/home`；未登入 → `/about` |
| `/cn`、`/cn-short-emotion`、`/short-emotion` | 舊網址，轉到上面的新網址 |
| `/tw`、`/tw-short-emotion`、`/shortemotion/tw`、`/shortemotion/hk` | 已下線的台股、港股看板，轉到 A股看板 |

每個看板放在自己的資料夾（`/看板名/…`），以後新增看板照同樣方式加。

## 運作方式

```
GitHub Actions（.github/workflows/short-emotion.yml，工作日 09:00–15:30 每 30 分鐘喚醒；A股盤中每 30 分鐘、新聞每小時）
  └─ scripts/short-emotion/refresh.mjs 呼叫 Wind MCP 計算快照
       └─ 強制推送到 short-emotion-data 分支
Vercel
  ├─ middleware.js                打開看板前檢查登入（未登入 → /login?next=原網址）
  ├─ public/about/、public/login/ 介紹頁、登入頁（共用 public/shared/lang.js 簡繁切換）
  ├─ public/short-emotion/        短線情緒看板頁面
  ├─ public/home/、public/technical-analysis/  首頁、個股技術分析頁面（共用 public/shared/nav-account.js）
  ├─ api/auth.js                  登入：驗證碼通過後把憑證寫進 HttpOnly cookie、查詢登入狀態、退出
  ├─ api/short-emotion.js         只讀資料分支（summary 公開，其餘需登入）；POST action=refresh 觸發上面的工作流
  └─ api/technical-analysis.js    個股技術分析：由網站伺服器直接呼叫 Wind MCP（需要 WIND_API_KEY），扣積分
Supabase Auth                     寄送與驗證郵箱驗證碼（經 Resend 寄出，不使用資料表）
```

短線情緒的頁面不直接呼叫 Wind，「刷新」觸發 GitHub Actions 取數。個股技術分析例外：每次查詢的股票不同、無法事先算好，所以由 `api/technical-analysis.js` 直接呼叫 Wind。

## 個股技術分析

- 算法移植自 [lfjDashboard/個股技術分析助手-20261020](https://github.com/MuWeiLee/lfjDashboard/tree/main/个股技术分析助手-20261020)（`api/_lib/technical-analysis/engine.js`，照原版搬過來，只換了 Wind 呼叫方式、日期按北京時間、輸出不標注數據來源）。
- 輸入六位代碼或準確簡稱（不做搜尋清單與聯想），交給 Wind 辨認；隨時都能分析，非交易時段用最近一個交易日收盤的數據，盤中結果標「盤中快照」。
- 一次分析呼叫 Wind 7～12 次：個股快照、分時、6 年日 K，上證／深證（分時 + 日 K），創業板／科創板再加對應指數；近期連續大漲或漲停時再查近 3 日新聞與公告。同一支股票 60 秒內重看用伺服器暫存，不再呼叫 Wind（仍扣分）。
- 扣分：每次發起 −10（同一支股票重看也扣；不限額帳號記 0 分）。順序是先認出股票（認不出、輸入不合法不扣分）→ 扣分 → 取其餘數據；分析失敗或逾時（40 秒）自動退回。流水記下股票，例如「個股分析 · 樣本電子 603936.SH」。
- 分析結果的個股資訊右上角有分享按鈕，可導出長圖（整份一張）或小卡（每個區塊一張，抬頭寫公司名稱與代碼；走勢的分時、日 K 各一張）。只用頁面上的結果，不調用行情、不扣分；倉位風險測算是用戶自己填的，不導出。
- **最近分析**：每次分析成功後把完整結果存進 Supabase（`supabase/migrations/20261021b_analysis_history.sql`，每人保留最近 10 筆，只有本人看得到）。首頁與個股分析頁的輸入框下方顯示最近 3 條（同一支股票只留最新一次），點開直接看當時的結果（`/technicalanalysis?id=<記錄>`），不調用行情、不扣分；頂部標明分析時間，「重新分析」才扣分。
- 首頁按「開始分析」會帶著股票跳到 `/technicalanalysis` 直接分析；網址上的 `?q=` 只預填、不自動分析（避免打開分享連結就扣分）。
- 上線前要做：Vercel 環境變數加 `WIND_API_KEY`（Production）；Supabase SQL Editor 執行 `supabase/migrations/20261021_points_analysis.sql`。沒有 Key 時頁面顯示「暫未開通」，不扣分。

## A股看板內容

- 情緒分中的「連板梯隊」取最近交易日的漲停名單計算；「成交環境」取最近 60 個交易日的成交額分位數。盤初資料不足或取數失敗時暫用中性分，來源狀態會標明限制。
- 異動題材合併相近分支，候選股需有概念、主營或當日催化依據；看板展示個股的歸屬和主歸因，以及未入選歸因的數量。
- 情緒評分口徑 **v3**（2026-10-20，移植自 [lfjDashboard/短线情绪看板20261020](https://github.com/MuWeiLee/lfjDashboard/tree/main/短线情绪看板20261020)）：
  - 權重：市場廣度 20%、極端反饋 20%、連板梯隊 10%、賺錢效應 25%、題材聚焦 15%、成交環境 10%。
  - 跌停按 2.5 倍計入；昨日漲停溢價取中位數，正負斜率 +10 / −8；連板梯隊只看連板質量（沒有漲停或連板歷史不全時給中性 30）；題材分加上前 10 名的廣度。
  - 成交額按 A股 U 型成交節奏外推全天，再和近 60 個交易日比較分位（最高分位計法不變）。
  - 階段：冰點、退潮、分歧、修復、啟動、主升、高潮。和前一日（或近 5 日平均）相差 ≥ 6 分才算方向；單日衝進熱區（> 70）是「啟動」，今天之前已連續 2 日在熱區才算「主升」；熱區但昨日漲停不賺錢、或明顯縮量時降級。
  - 連續性只取 v3 的日均分；歷史圖在 v2 / v3 交界處斷線，同一天的日均分只合併最新口徑的快照。
- 題材異動上榜門檻 60；當天沒有任何題材漲停 ≥ 3 家時放寬到 55（只寫在 summary，不算資料缺失）。非漲停題材最高 82 分；AI 應用、算力通信、消費電子分開計。
- 收盤後若當日已有 15:00 的收盤快照，之後的刷新只更新新聞，不再重複取行情與題材。

台股、港股看板已於 2026-10-18 移除（程式與歷史資料一併刪除）。

## 登入

- 郵箱驗證碼登入，未註冊的郵箱自動註冊。驗證碼由瀏覽器直接向 Supabase 申請與驗證（頻率限制按訪客自己的 IP 計算），
  通過後交給 `POST /api/auth?action=session`，伺服器寫入兩個 HttpOnly cookie（`se_at`、`se_rt`，SameSite=Lax）。
- **90 天免登入，滾動延長**：access token 約 1 小時過期，過期後由 middleware / 接口用 refresh token 換新，cookie 重新算 90 天。
  cookie 由伺服器設定，Safari 不會在 7 天後清掉。
- Supabase 暫時連不上時，已登入的人照常放行，不會整站無法使用。
- 設定在 `api/_lib/supabase-public.js`（只放公開的 Publishable key）；本地或測試可用 `SHORT_EMOTION_AUTH=off` 關閉登入。
- 後台設定（2026-10-14）：Supabase 自訂 SMTP 用 Resend（寄件人 `noreply@lfjmwl.com`），郵件範本改為顯示驗證碼 `{{ .Token }}`；
  寄信上限 20 封／小時，登入請求 10 次／5 分鐘／IP。Resend 免費版每天 100 封、每月 3000 封。
- 資料分支本身是公開的（公開倉庫），登入是產品上的門檻，不是資料保密。

## 用戶統計

- **註冊用戶**：Supabase Auth 自動記錄（Supabase → Authentication → Users），包含信箱、註冊時間、最後一次輸入驗證碼的時間。
- **活躍用戶（只保留 30 天）**：`daily_active` 表每人每天一行，只記「哪天來過」（不記看了哪個市場、用了哪個功能）。
  打開看板時由 middleware 寫入（每人每天一次，`se_seen` cookie 去重）；寫入用登入用戶自己的憑證呼叫 `record_activity()`，
  不需要 secret key，函數每次寫入時順手刪除 30 天前的記錄。SQL 見 `supabase/migrations/`（依檔名順序執行）。
- **頁面瀏覽量**：Vercel Web Analytics（Hobby 方案免費，每月 5 萬次瀏覽，報表保留 1 個月；不用 cookie、不能自訂事件）。
  每個頁面載入 `/_vercel/insights/script.js`，在 Vercel 專案的 Analytics 查看。需要先在 Vercel 專案的 Analytics 頁按 Enable。
- 查看：Supabase → Table Editor 的 `activity_summary`（註冊數、近 7 天新註冊、今日 / 7 天 / 30 天活躍）與 `activity_daily`（每天活躍人數）。
  表與視圖都不對網站訪客開放。

## 個人資料

- 看板右上角頭像 → 點郵箱進入 `/account`（需登入）：姓名、郵箱（只讀）、電話（區號 + 手機號，不做驗證碼）。
- 存在 Supabase 用戶資料的 user_metadata（`full_name` / `display_name`、`phone_country_code`、`phone_number`），
  透過 `GET / POST /api/auth?action=profile` 用登入用戶自己的憑證讀寫，不另建表；Supabase 後台 Users 的 Display name 會顯示姓名。

## 外觀

- 個人頁面 `/account` 的「外觀」：白版、黑版、自適應（預設，跟隨系統深淺色）。記在這台裝置的瀏覽器（localStorage `twsvp_theme`，沿用 TWSVP 時期的鍵名），所有頁面打開時讀取。

## 積分

- 規則（2026-10-20）：註冊贈送 +50（已註冊的人第一次打開時補發）、每日簽到 +10；手動刷新 −5、解鎖當日題材異動 −5（12 小時內有效，看板顯示倒計時）、個股技術分析 −10（見上節）。
- 簽到按瀏覽器所在時區的 00:00 換日；時區在第一次簽到時記下，之後固定（避免改時區重複簽到）。
- 題材異動未解鎖時，接口只回傳題材數量，不回傳內容。
- 手動刷新只在交易時段（工作日北京時間 09:15–15:05）開放；別人正在刷新或 10 分鐘內剛更新過時不觸發、不扣分；觸發失敗自動退回。定時更新照舊，不扣分。
- 餘額與流水存在 Supabase（`supabase/migrations/20261020_points.sql`，在 SQL Editor 執行一次），只能經由 `points_*` 函數用登入者自己的憑證存取；
  流水只記類型（註冊贈送／簽到／刷新／解鎖異動／退回），永久保留。營運概況：`select * from points_overview;`
- 個人資料頁 `/account` 顯示餘額、簽到按鈕與積分記錄。

## 部署設定（只需做一次）

1. **GitHub 倉庫 Secret**：Settings → Secrets and variables → Actions → 新增 `WIND_API_KEY`。
   沒設定之前，定時任務會自動跳過（只留一條警告），不會寄失敗通知。
2. **Vercel**：匯入本倉庫，Framework 選 Other，其餘保持預設（`vercel.json` 已指定輸出目錄 `public`）。
3. **Vercel 環境變數** `GITHUB_ACTIONS_TOKEN`：GitHub fine-grained token，只授權本倉庫，
   權限 Actions: Read and write、Contents: Read-only。沒有它頁面照常顯示，只是「刷新」不可用。
4. **Vercel 環境變數** `WIND_API_KEY`：個股技術分析用（可與 GitHub Actions 同一把）。沒有它個股分析顯示「暫未開通」。

## 本地開發

```bash
npm install
npm test            # 單元測試
npm run dev         # http://localhost:3000 ，預設讀線上資料分支，登入用真實 Supabase
SHORT_EMOTION_AUTH=off npm run dev                        # 不登入直接看看板
SHORT_EMOTION_DATA_DIR=./short-emotion-data npm run dev   # 改讀本地檢出的資料分支
SHORT_EMOTION_AUTH=off WIND_MOCK=1 npm run dev            # 個股技術分析用離線樣本（樣本電子 603936、樣本新材 300986 等）
```

手動跑一次取數（需要 `WIND_API_KEY`）：`WIND_API_KEY=... npm run refresh -- --force --market=all`

## 協作

`main` 是線上版本，受保護規則限制，所有改動都走「分支 → PR → 合併」。流程、分工與衝突處理見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 品牌標識

- 分享長圖、小卡底部附二維碼（`public/short-emotion/qr-site.svg`，指向 https://lfjmwl.com：已登入進看板、未登入到介紹頁）；網址改了用 `python3 scripts/short-emotion/build-share-qr.py` 重新產生。

- Logo：紅色實心方塊反白，L 與 J 合起來是一個 D（`public/short-emotion/logo.svg`）；分頁圖示另有 `favicon-32.png`、`/favicon.ico`，手機桌面圖示 `/apple-touch-icon.png`。

## 第二階段待辦

- 外觀設定的 localStorage 鍵名仍為 `twsvp_theme`、`twsvp_price_scheme`；樣式檔仍叫 `twsvp.css`
