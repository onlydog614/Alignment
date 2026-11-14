---
name: fh-import
description: Convert Omron FH vision controller output (scene measurement results, calibration data, serial/Ethernet/CSV logs) and linear-stage encoder positions into the Vision Alignment Debugger's JSON config or calibration-tool input. Use for ROADMAP stage 3 (Omron FH 資料串接), or when the user pastes FH output, says "匯入 FH", "FH 資料轉換", or wants to compare commanded vs encoder positions.
---

# FH Import

把 Omron FH 的輸出整理成本工具能使用的資料。FH 的輸出格式由使用者的場景與「處理項目」設定決定，**不要猜格式**。

## 步驟

1. **確認來源與格式**（缺資料時一次問一題，並附建議答案）：
   - 來源：串列／Ethernet 無協定輸出、PLC Link、CSV 記錄、Calibration 處理項目結果。
   - 每一行或每筆的欄位順序、分隔符號、單位（px 或 mm）、小數位數、是否已套用 FH 內建校正。
   - 每個量測值對應哪台相機、哪個 Mark、哪個步驟（粗／精）、拍照時的線馬位置。
   - 座標系：影像原點、v 軸方向、角度正方向與單位（° 或 rad）。
   請使用者提供 2–3 筆真實樣本，以樣本為準。

2. **建立對應表**：寫成表格（FH 欄位 → 本工具欄位），請使用者確認後再轉換。本工具的目標欄位：
   | 用途 | 欄位 |
   |---|---|
   | 拍照點量測 | `shots[i].cur.{u,v,ang}`（px、°）、`shots[i].cam`、`shots[i].step`、`shots[i].gx/gy`（線馬位置 mm） |
   | 教導目標 | `shots[i].tgt.{u,v,ang}` |
   | 相機校正 | `cameras[i].calMode = 'matrix'`、`cameras[i].matrix.{A..F}`（x = A·u + B·v + C，y = D·u + E·v + F） |
   | 九點校正輸入 | 每列 `u, v, x, y`（校正工具分頁可直接貼上） |
   | 旋轉中心輸入 | 每列 指令角度、u、v |
   | 共同點（多平台座標轉換） | 每列 A 平台 x、y，B 平台 x、y |
   | 線馬回授 | 每列 指令位置、光學尺位置 → 誤差 |
   FH 若輸出已校正的 mm 座標，需換回 px，或把該相機設成單位矩陣（A=E=1、其餘 0）並在報告中註明。

3. **轉換**：寫一個小腳本（放 scratchpad，以 `node` 執行）讀樣本 → 依對應表輸出：
   - 完整設定：以 `VA.defaultState()` 或使用者匯出的 JSON 為底，填入欄位，輸出 `version: 2` 的 JSON，可在工具右上「匯入」。
   - 或校正工具／共同點分頁可直接貼上的 TSV。
   轉換後用 `VA.migrate()` 載入確認不會出錯，並以 `calib-review` 技能檢查結果。

4. **線馬回授比較**（若有光學尺資料）：計算每點 指令 − 回授 的誤差、平均、標準差、最大值，判斷是比例誤差（誤差隨位置線性增加）還是重複性問題（隨機），並對應到「情境模擬」的 `axisScaleErr`、`gantryRepeatUm` 參數。

5. **若格式已穩定**：把對應表寫進 `docs/`，並考慮在工具中加入匯入功能（ROADMAP 第 3 階段），新增功能要附 `tests/run.js` 測試。

## 回報

列出：對應表、轉換出的檔案路徑、筆數、被略過或異常的資料列及原因。
