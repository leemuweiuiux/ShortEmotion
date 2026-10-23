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
Supabase Cron（supabase/migrations/20261023033000_cron_dispatch.sql，工作日北京時間 09:02、09:32–11:32、13:02–15:02 每 30 分鐘；早報 06:50）
  └─ POST /api/cron → 經 GitHub API 手動運行工作流（準點觸發；GitHub 自帶的定時常晚 25–30 分鐘，還會整次丟掉）
GitHub Actions（.github/workflows/short-emotion.yml；A股盤中每 30 分鐘、新聞每小時。自帶的定時 09:07–16:37 每 30 分鐘留作備用，同一時段只呼叫一次 Wind；延遲到窗口外時自動補抓 11:30 / 15:00 收盤快照）
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
- **關鍵價位**（2026-10-21）：數值照原算法，每個價位標出來源（例如「前 60 日最高」「布林上軌」「10 日均線」）；日 K 圖只畫 60 根，取自更早的標「（圖外）」。
  補充參考不進賠率計算：創新高時（原算法的波段壓力不高於現價）列「歷史前高」（近 6 年波段高點，附日期），沒有就列「波動推算」（現價 + 2 倍 14 日平均波幅）；
  波段壓力取自布林上軌且離現價不到 2% 時列「下一檔壓力」。創新高時賠率照原算法顯示「極低（上方無近 120 日壓力）」。
- **最近分析**：每次分析成功後把完整結果存進 Supabase（`supabase/migrations/20261021b_analysis_history.sql`，每人保留最近 10 筆，只有本人看得到）。首頁與個股分析頁的輸入框下方顯示最近 3 條（同一支股票只留最新一次），點開直接看當時的結果（`/technicalanalysis?id=<記錄>`），不調用行情、不扣分；頂部標明分析時間，「重新分析」才扣分。
- 首頁按「開始分析」會帶著股票跳到 `/technicalanalysis` 直接分析；網址上的 `?q=` 只預填、不自動分析（避免打開分享連結就扣分）。
- 上線前要做：Vercel 環境變數加 `WIND_API_KEY`（Production）；Supabase SQL Editor 執行 `supabase/migrations/20261021_points_analysis.sql`。沒有 Key 時頁面顯示「暫未開通」，不扣分。

## A股看板內容

- 情緒分中的「連板梯隊」取最近交易日的漲停名單計算；「成交環境」按参考版本取前60个自然日内的成交额样本计算分位数。盤初資料不足或取數失敗時暫用中性分，來源狀態會標明限制。
- 異動題材合併相近分支，候選股需有概念、主營或當日催化依據；看板展示個股的歸屬和主歸因，以及未入選歸因的數量。
- **2026-10-22 看板规则迁移（评分版本 v4）**：严格采用 [lfjDashboard／??????20261022](https://github.com/MuWeiLee/lfjDashboard/tree/d1637eb70534a4e6964a73b81b492952a94d321d/%3F%3F%3F%3F%3F%3F20261022) 的A股评分、个股分层、候选筛选及异动展示逻辑。仅保留A股，不迁入台股。
  - 权重：市场广度20%、极端反馈20%、连板梯队10%、赚钱效应25%、题材聚焦15%、成交环境10%。跌停2.5倍、昨日涨停溢价中位数、正负斜率+10/−8、成交U型外推、方向与连续热区阶段判断均采用参考代码。
  - 成交历史按原版查询前60个自然日，成交分位采用原版实现（超出全部样本时最高为 `(n−1)/n`）；空表为0、未返回payload为未知。原版缺失数据兜底及诊断口径不另作优化。
  - 个股分层：点火、核心梯队（领涨／龙头／中军）、跟风、候选上车。沪深主板及创业板可入选，科创板、北交所排除；展示时每只股票仅保留一个角色，依次优先领涨、龙头、中军、其他点火、跟风、候选。涨停统计与评分仍使用完整点火名单。
  - 候选涨幅范围为 `[2.5%, 5.5%)`，按题材归属、涨幅、量比、换手、成交额及题材分钟动能评分。领涨优先最早封板；龙头按归属评分与涨幅；中军按成交额／市值排名，字段不足时按涨幅中位兜底。
  - 页面分类仅保留全部、涨停点火、消息催化。批量动能仍参与底层识别与计算，综合卡片可正常显示该信号标签，不设独立入口。按原版精简统计及个股明细，不展示归属、主归因及候选触发／失效条件。
  - 后端题材上榜门槛通常60，无题材涨停≥3家时放宽至55；**前端仍按原版60分过滤**。不擅自统一这一差异。
  - 继续保留评分版本隔离：新快照标v4，日均分不混算口径，阶段连续性仅参考同版本历史，历史曲线跨版本断线；初期无同版历史时按原版无历史规则判断。
  - 保留当前登录、积分、题材解锁、手动刷新、收盘补抓、板块资金采集、二维码分享及站点导航。适配仅补全 `batch` 标签文案，避免原版出现 `undefined`；当前已有“启动”文案继续保留。
  - 合并后须由正常数据工作流生成一次完整行情与题材快照，旧快照不会因部署自动重算。无需新增环境变量或数据库迁移。
- 收盤後若當日已有15:00收盤快照，普通定時更新不重複取行情與題材；管理端工作流明確指定force時仍完整重算，供規則更新後替換舊快照。
- 接口对新旧题材快照统一执行候选边界与角色互斥校验；无合适候选时显示空列表，不用不合格标的补位。

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
- 手動刷新在交易時段（工作日北京時間 09:15–15:05）開放；收盤後若當日還沒有 15:00 收盤快照，也可以刷新補收盤數據；別人正在刷新或 10 分鐘內剛更新過時不觸發、不扣分；觸發失敗自動退回；觸發成功但任務沒跑成（排隊時被取消、失敗、2 分鐘內沒出現），頁面查進度時自動退回（`se_rf` cookie，10 分鐘有效）。定時更新照舊，不扣分。
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
5. **準點定時**（見 `supabase/migrations/20261023033000_cron_dispatch.sql` 開頭的步驟）：Supabase Vault 生成密鑰 `shortemotion_cron_secret`，
   同一個值填到 **Vercel 環境變數** `CRON_SECRET` 並 Redeploy，再在 SQL Editor 執行該檔案。沒做之前只靠 GitHub 自帶的定時（會延遲）。

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

## 看点早报

首页最下方展示最新一期（标题、板块、100—150字摘要）；点击进入 `/kandian/article?id=YYYYMMDD`。`/kandian?tab=reports` 倒序分页保留全部文章，`?tab=views` 保留原观点预览。阅读不扣积分，接口需登录。

生成由 `.github/workflows/morning-report.yml` 执行，复用 Wind MCP 和数据分支，不新增数据库。北京时间工作日06:50由 Supabase Cron 准点触发生成（同上，经 /api/cron），GitHub 自带的06:50、07:10、07:30定时留作备用补跑；接口在07:20前隐藏当日内容。GitHub定时任务可能延迟，因此07:20是最早可见时间，不能保证准点完成。与原行情任务使用相同并发组，避免覆盖数据。已生成的日期不重写，已报道的行情日不重复生成；失败不写索引、保留上一期。首次节假日仍可能总结未报道的上一交易日（尚未接入权威的前瞻交易日历），后续无新收盘数据则跳过。

启用前在GitHub配置：

- Secret `WIND_API_KEY`：沿用现有配置。
- Secret `MORNING_REPORT_API_KEY`：模型接口密钥。
- Variable `MORNING_REPORT_BASE_URL`：支持 `/chat/completions` 的HTTPS API基础地址，通常以 `/v1` 结尾。
- Variable `MORNING_REPORT_MODEL`：该接口支持的模型ID；须支持JSON模式和足够长的上下文。可使用提供兼容接口的Alice服务；仅有Alice聊天界面不能直接接入。

手动运行 Morning report 工作流验证首篇；缺少配置会明确失败，不发布占位文章。详情先生成、同次输出摘要并验证长度、五段正文、候选板块和引用id；留存原始证据以便核查。当前校验不等同人工事实审核；历史对照基于真实日K由模型解释，尚不提供经过回测的相似度/胜率，也未独立计算历史事件样本。上线前需人工检查首篇数字、消息时间与历史案例，按实际效果补充研究规则。不能把这部分当作已完成的量化回测系统。



## 资金流向曲线

首页资金模块与 `/sectorflow` 共用 `public/shared/fund-flow.js`：首页展示今日流入/流出各前三，点击板块带入详情；详情支持今天、5日、20日以及金额/占比、最多10个板块选择。板块颜色按代码固定，支持浅色/深色主题。今天为盘中累计净流入，多日为每日净流入；多日默认选线按区间合计排序，右端数值是最后一个有效采样值。范围沿用短线情绪概念池（非全市场资金排名）。

数据复用原有 `sectorflow` 盘中与每日快照，新增存成交额，用对应时点的净流入额/成交额计算占比；老快照无成交额时不回填占比。Actions 首轮及收盘后通过 Wind analytics 按区间合计筛选的概念查询真实20日序列，5日与20日共用查询并缓存到 `sectorflow:windows:v1`，同日盘中、盘后分别最多尝试一次；失败保留旧序列并记录错误。首次查询可能增加运行时间。没有新增密钥、数据库或浏览器端 Wind 调用。

已有数据可立即展示；历史接口不返回序列时仅展示已存的真实每日点，明确提示不足，不使用区间总额补造每日点或开盘零点。读取 summary/full 仍需登录、不扣积分，新增 `dashboard` 字段并保留旧协议字段。上线后需在真实 Actions 取数中确认 Wind 返回的历史字段、单位及日期范围；本地验证使用模拟数据，未消耗真实 Wind 配额。

### 看点晚报
北京时间每个交易日16:05触发生成盘后总结，完成后自动进入「要闻」及首页最新文章，作者统一「官方看点」。正文700—1400字、摘要100—150字，覆盖全天盘面、主线演变、驱动与分歧、回看日内观察、下一交易日观察。必须有当日15:00收盘快照；休市跳过，数据缺失报错，GitHub16:15、16:35备用补跑。消息截点固定16:05，盘后消息不能反推盘中涨跌。独立id为日期-evening，不阻断次日早报。复用现有模型配置与数据存储。16:05是触发时间，排队和生成可能延后。
