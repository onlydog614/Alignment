---
name: alignment-verify
description: Verify the vision alignment math after changing js/ (geometry, model, simulator, multi, optics, diagnose, builder, platforms). Runs the unit tests and the FPC scenario report, then compares success rate, true error and convergence against the committed baseline in docs/simulation-data.md. Use after editing fitting, coordinate transforms, error propagation or simulator code, or when the user says "驗證對位", "跑測試", "檢查有沒有退步".
---

# Alignment Verify

修改對位計算相關程式後，確認數學正確且模擬結果沒有退步。

## 步驟

1. **單元測試**
   ```bash
   node tests/run.js
   ```
   必須輸出 `N/N checks passed`。有 `FAIL` 或 `ERROR` 時先修正，不要往下做。

2. **新增測試**：本次修改若新增或改變了計算（新擬合法、新平台種類、新誤差項），在 `tests/run.js` 用 `test(name, fn)` 加測試：
   - 用已知真值造資料 → 擬合 → 以 `near(a, b, tol, msg)` 比對還原值。
   - 無雜訊時容許誤差用 1e-9 等級；有雜訊時用統計界限，並固定亂數種子。
   - 至少涵蓋一個邊界情況（單點、共線點、θ=0、手性相反的相機）。

3. **模擬回歸比對**
   ```bash
   node tests/scenario-report.js > "$SCRATCH/sim-new.md"
   diff docs/simulation-data.md "$SCRATCH/sim-new.md"
   ```
   （`$SCRATCH` 用 session 的 scratchpad 目錄。）
   逐表檢查：成功率、真實誤差 P50/P95/最大、平均移動次數、「通過但真實超公差」、主要失敗原因。
   - 成功率下降 > 2 個百分點，或 P95 誤差增加 > 10%：視為退步，找出原因。
   - 變化是本次修改的預期效果時，說明原因，並以新結果更新 `docs/simulation-data.md`。
   - Monte-Carlo 有隨機性：變化很小時以較大 trials 重跑（`node tests/scenario-report.js 1000`）確認。

4. **UI 煙霧測試**（修改到 `*-ui.js` 或 `index.html` 時）：用 Playwright 開 `index.html`，載入範例「FPC 四 mark」，切換每個分頁，確認 console 沒有錯誤。

## 回報

列出：測試通過數、新增的測試、模擬指標的變化（有變化的列）、是否更新 baseline。
