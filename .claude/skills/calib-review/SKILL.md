---
name: calib-review
description: Review a vision alignment configuration (exported JSON from the Vision Alignment Debugger) against a fixed checklist — camera handedness, orthogonality/skew, pixel size vs optics, X/Y scale mismatch, rotation center placement and uncertainty, tolerance vs noise floor, shot coverage. Use when the user provides a config JSON, asks "檢查校正", "這組設定合理嗎", or a simulation shows unexplained failures.
---

# Calib Review

依固定清單檢查一組對位設定是否合理，找出常見的校正錯誤。

## 步驟

1. **取得設定**：使用者提供的 JSON（工具右上「匯出」），或 `js/scenarios.js` 裡的範例。
2. **自動檢查**：
   ```bash
   node .claude/skills/calib-review/scripts/check-config.js <config.json>
   ```
   不帶參數時檢查預設設定；`--scenario fpc`（或 `xxy`）檢查內建範例。腳本輸出每台相機與整體的檢查結果（OK / WARN / FAIL）。
3. **人工判讀**：腳本無法判斷的項目，依下方清單逐項確認，必要時詢問使用者實際安裝情況。

## 檢查清單

| 項目 | 判定 |
|---|---|
| 手性 | 往下看的相機通常 det < 0；往上看（或鏡像）通常 det > 0。與安裝方式不符 → FAIL（九點校正點序或軸向反了） |
| 正交性 | \|skew\| < 0.1° OK；0.1–0.5° WARN；> 0.5° FAIL（九點校正資料錯誤或鏡頭畸變） |
| X/Y 比例 | \|sx/sy − 1\| < 0.5% OK；> 1% WARN（非方形像素少見，通常是校正誤差） |
| 像素當量 vs 光學 | 校正得到的 mm/px 與光學計算（像素尺寸 ÷ 倍率）差 > 3% → WARN（Z 高度或鏡頭設定不符） |
| 旋轉中心 | 不確定度（雜訊 ÷ 旋轉角度）應 < 對位公差的 1/3；旋轉中心距 Mark 越遠，θ 誤差造成的位移越大 |
| 雜訊下限 | 對位公差應 ≥ 3× 量測雜訊（px × mm/px）；否則會在公差邊緣來回振盪 |
| 拍照點 | 每步驟至少 2 個 Mark 才能求 θ；Mark 間距越大 θ 越準；拍照點要落在視野內 |
| 步驟 | 粗對位公差 > 精對位相機視野的一半時，精對位可能看不到 Mark |

## 回報

以表格列出每台相機與整體的檢查結果，FAIL/WARN 項附上可能原因與建議修正（例如重做九點校正、確認 flipY、增大旋轉角度）。可建議在「情境模擬」分頁以對應參數掃描驗證影響。
