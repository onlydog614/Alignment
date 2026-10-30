# 視覺對位除錯工具（Vision Alignment Debugger）

線上版：<https://onlydog614.github.io/Alignment/>

用來檢查視覺對位計算是否正確、並模擬整套對位流程的網頁工具。純前端，下載後雙擊 `index.html` 也能離線使用。

## 功能

| 分頁 | 內容 |
|---|---|
| 對位計算 | 任意數量相機（含光學計算：焦距／遠心）與拍照點；XY 線馬拍照位置；多步驟（粗→精）；平台 XYθ／θXY／XXY／XYY／UVW／自訂；最小平方或最大誤差最小化；軸指令、警告、誤差放大圖、影像視圖、單步模擬與誤差來源推測 |
| 校正工具 | N 點（9 點）校正求 A–F 與殘差；旋轉中心擬合（含不確定度、θ 比例檢查、線馬跟隨模式） |
| 情境模擬 | Monte-Carlo：隨機擺放、量測雜訊、旋轉中心／比例／重複定位／Z／伸縮／校正誤差 → 成功率、最終真實誤差、收斂圖、散佈圖、參數掃描 |
| 說明 | 快速上手與座標慣例 |

## 快速開始

1. 右上「載入範例」→「FPC 四 mark：XYθ＋線馬＋粗/精相機」。
2. 「對位計算」切換步驟、按「執行 1 次」看收斂。
3. 「情境模擬」按「執行模擬」或「掃描一個參數」。

## 檔案

| 路徑 | 內容 |
|---|---|
| `index.html`、`css/style.css` | 頁面 |
| `js/geometry.js` | 校正轉換、剛體擬合（最小平方／minimax）、仿射與圓擬合、軸指令 |
| `js/platforms.js` | 平台種類預設 |
| `js/optics.js` | 感光元件、鏡頭 → 像素當量、視野、Z 影響 |
| `js/model.js` | 資料模型（相機、拍照點、步驟、線馬）與對位計算 |
| `js/simulator.js` | 情境模擬（真實世界誤差模型、Monte-Carlo） |
| `js/diagnose.js` | 由迭代紀錄推測誤差來源 |
| `js/scenarios.js` | 範例情境 |
| `js/app.js`、`js/calib-ui.js`、`js/scen-ui.js` | 介面 |
| `tests/run.js` | 單元測試：`node tests/run.js` |
| `tests/scenario-report.js` | 產生參數掃描數據 |
| `docs/vision-alignment-notes.md` | 視覺對位知識整理與除錯清單（含 Omron FH 對應） |
| `docs/simulation-report.md` | FPC 四 mark 架構的模擬測試報告 |
| `docs/ROADMAP.md` | 分段開發計畫 |

推送到 `main` 時 GitHub Actions 會先跑測試，通過後發佈到 `gh-pages`（GitHub Pages）。
