# 視覺對位除錯工具（Vision Alignment Debugger）

線上版：<https://onlydog614.github.io/Alignment/>

用來檢查視覺對位計算是否正確、並模擬整套對位流程的網頁工具。純前端，下載後雙擊 `index.html` 也能離線使用。

## 功能

| 分頁 | 內容 |
|---|---|
| 圖形設定 | 俯視配置圖：點選／拖曳平台、工件、相機、旋轉中心；圖卡選平台種類、鏡頭（16/25/50 mm、0.5×/1×/3× 遠心）、安裝方式、Mark 排列；流程管線勾選各步驟相機；拍照點（含線馬位置）自動產生；一鍵模擬工件偏移 |
| 對位計算 | 任意數量相機（含光學計算：焦距／遠心）與拍照點；XY 線馬拍照位置；多步驟（粗→精）；平台 XYθ／θXY／XXY／XYY／UVW／自訂；最小平方或最大誤差最小化；軸指令、警告、誤差放大圖、影像視圖、單步模擬與誤差來源推測 |
| 多平台 | 大基板由多個平台分區貼附；對位基準可選 SPB 整體 Mark 或每片預放位置 Mark（Tile 四邊 Mark 局部對位）：各平台看得到的 Mark、θ 來源（Mark／機構）、軸比例、熱膨脹、貼附誤差 → 每片 Tile 誤差熱圖、各欄長條、交界相對誤差、三種 Mark 配置比較、Monte-Carlo 驗證；可拖曳 Mark；兩平台座標轉換實測輸入（剛體／相似／仿射、殘差、不確定度、批次換算） |
| 校正手順 | 選擇每台相機安裝方式（往下看／往上看／裝在線馬上）等配置 → 產生校正順序、圖解、建議參數與判定標準，可列印 |
| 校正工具 | N 點（9 點）校正求 A–F 與殘差；旋轉中心擬合（已知指令角度擬合＋幾何圓交叉檢查，含不確定度、θ 比例檢查、線馬跟隨模式） |
| 情境模擬 | Monte-Carlo：隨機擺放、量測雜訊、旋轉中心／比例／重複定位／Z／伸縮／校正誤差 → 成功率、最終真實誤差、收斂圖、散佈圖、參數掃描 |
| 說明 | 快速上手與座標慣例 |

## 雙平台放料校正手順（3D）

`calibration-3d.html`（線上：<https://onlydog614.github.io/Alignment/calibration-3d.html>）：上相機1、2 固定（各拍平台1、平台2），下相機3 隨平台1、下相機4 隨平台2，平台1/2（XY＋DD＋Z）放料到上方固定平台3 料盤的完整校正手順。每一步有 three.js 3D 動作、四台相機畫面、公式、判定標準；另有放料偏移排查、誤差注入模擬、實測資料回歸分析、旋轉中心計算（貼上多點機械座標＋DD 角度，最小二乘圓擬合求圓心、半徑、殘差、1σ、DD 角度比例與方向，附 2D 圖與 3D 動畫）與自我驗證。相機視野、XY 行程、Mark 尺寸、治具與產品尺寸（含長方形料、長邊沿 X 或 Y、上相機逐顆拍四角 Mark、下相機拍穴位兩邊 Mark、2×12 料盤與 SPB Mark A–D）可在「機台參數」分頁修改或匯入 CSV（範本 `tools/calib3d/machine-params.csv`），並自動檢查是否做得起來。原始碼在 `tools/calib3d/`，改完執行 `python3 tools/calib3d/build.py` 重新產生，`node tests/calib3d.js` 跑驗證。

## 快速開始

1. 右上「載入範例」→「FPC 四 mark：XYθ＋線馬＋粗/精相機」，在「圖形設定」點選或拖曳各元件。
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
| `js/builder.js` | 由工件／Mark 排列／步驟相機自動產生拍照點 |
| `js/layout-ui.js` | 圖形設定頁 |
| `js/multi.js`、`js/multi-ui.js` | 多平台分區貼附的誤差模型與頁面 |
| `js/scenarios.js` | 範例情境 |
| `js/procedure.js`、`js/proc-ui.js` | 校正手順產生器與圖解 |
| `js/app.js`、`js/calib-ui.js`、`js/scen-ui.js` | 介面 |
| `tests/run.js` | 單元測試：`node tests/run.js` |
| `tests/scenario-report.js` | 產生參數掃描數據 |
| `docs/vision-alignment-notes.md` | 視覺對位知識整理與除錯清單（含 Omron FH 對應） |
| `docs/simulation-report.md` | FPC 四 mark 架構的模擬測試報告 |
| `docs/ROADMAP.md` | 分段開發計畫 |

推送到 `main` 時 GitHub Actions 會先跑測試，通過後發佈到 `gh-pages`（GitHub Pages）。
