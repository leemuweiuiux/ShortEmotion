# ShortEmotion · 短線情緒

A股 / 台股短線情緒看板：**https://lfjmwl.com**（Vercel 預設網址 stockmarketshortemotion.vercel.app 也可用）。

由 [twsvp-frontend](https://github.com/MuWeiLee/twsvp-frontend) 的「短線情緒」原樣遷出（來源 `69593b1`，PR #126），獨立部署。twsvp.com 保留自己的短線情緒頁面，兩站各自取數、互不依賴。

| 網址 | 內容 |
| --- | --- |
| `/about` | 介紹頁（公開）：產品介紹、今日情緒分數、底部「登录」按鈕 |
| `/login` | 登入頁：輸入郵箱 → 同一頁填驗證碼，免費註冊 |
| `/shortemotion/cn` | 短線情緒 · A股（**需登入**） |
| `/shortemotion/tw` | 短線情緒 · 台股（盤後快照，繁體，**需登入**） |
| `/` | 已登入 → `/shortemotion/cn`；未登入 → `/about` |
| `/home`、`/cn`、`/tw`、`/cn-short-emotion`、`/tw-short-emotion`、`/short-emotion` | 舊網址，轉到上面的新網址 |

每個看板放在自己的資料夾（`/看板名/…`），以後新增看板照同樣方式加。

## 運作方式

```
GitHub Actions（.github/workflows/short-emotion.yml，工作日 09:00–15:30 每 30 分鐘）
  └─ scripts/short-emotion/refresh.mjs 呼叫 Wind MCP 計算快照
       └─ 強制推送到 short-emotion-data 分支（A股在根目錄，台股在 tw/）
Vercel
  ├─ middleware.js                打開看板前檢查登入（未登入 → /login?next=原網址）
  ├─ public/about/、public/login/ 介紹頁、登入頁（共用 public/shared/lang.js 簡繁切換）
  ├─ public/short-emotion/        短線情緒看板頁面
  ├─ api/auth.js                  登入：驗證碼通過後把憑證寫進 HttpOnly cookie、查詢登入狀態、退出
  └─ api/short-emotion.js         只讀資料分支（summary 公開，其餘需登入）；POST action=refresh 觸發上面的工作流
Supabase Auth                     寄送與驗證郵箱驗證碼（經 Resend 寄出，不使用資料表）
```

頁面不直接呼叫 Wind。「刷新」按鈕每個瀏覽器每小時一次，同一市場 2 分鐘內多人點擊共用同一次任務。

## A股看板內容

- 情緒分中的「連板梯隊」取最近交易日的漲停名單計算；「成交環境」取最近 60 個交易日的成交額分位數。盤初資料不足或取數失敗時暫用中性分，來源狀態會標明限制。
- 異動題材合併相近分支，候選股需有概念、主營或當日催化依據；看板展示個股的歸屬和主歸因，以及未入選歸因的數量。
- 這次情緒評分口徑標為 v2。歷史圖在 v1 / v2 交界處斷線；同一天的日均分只合併最新口徑的快照。

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
- **活躍用戶（只保留 30 天）**：`supabase/migrations/20261015_daily_active.sql` 建立 `daily_active` 表，每人每天一行，
  記錄看過的市場（cn / tw）與刷新次數。打開看板時由 middleware 寫入（每人每天每個市場一次，`se_seen` cookie 去重），
  點刷新時由 `/api/short-emotion` 寫入；寫入用的是登入用戶自己的憑證呼叫 `record_activity()`，不需要 secret key。
  函數每次寫入時順手刪除 30 天前的記錄。
- 查看：Supabase → Table Editor 的 `activity_summary`（註冊數、近 7 天新註冊、今日 / 7 天 / 30 天活躍）與 `activity_daily`（每天活躍人數、A股 / 台股、刷新次數）。
  表與視圖都不對網站訪客開放。

## 部署設定（只需做一次）

1. **GitHub 倉庫 Secret**：Settings → Secrets and variables → Actions → 新增 `WIND_API_KEY`。
   沒設定之前，定時任務會自動跳過（只留一條警告），不會寄失敗通知。
2. **Vercel**：匯入本倉庫，Framework 選 Other，其餘保持預設（`vercel.json` 已指定輸出目錄 `public`）。
3. **Vercel 環境變數** `GITHUB_ACTIONS_TOKEN`：GitHub fine-grained token，只授權本倉庫，
   權限 Actions: Read and write、Contents: Read-only。沒有它頁面照常顯示，只是「刷新」不可用。

## 本地開發

```bash
npm install
npm test            # 單元測試
npm run dev         # http://localhost:3000 ，預設讀線上資料分支，登入用真實 Supabase
SHORT_EMOTION_AUTH=off npm run dev                        # 不登入直接看看板
SHORT_EMOTION_DATA_DIR=./short-emotion-data npm run dev   # 改讀本地檢出的資料分支
```

手動跑一次取數（需要 `WIND_API_KEY`）：`WIND_API_KEY=... npm run refresh -- --force --market=all`

## 協作

`main` 是線上版本，受保護規則限制，所有改動都走「分支 → PR → 合併」。流程、分工與衝突處理見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 第二階段待辦

- 正式品牌與 Logo（目前 `public/short-emotion/logo.svg` 是臨時標識）
- 外觀設定的 localStorage 鍵名仍為 `twsvp_theme`、`twsvp_price_scheme`；樣式檔仍叫 `twsvp.css`
