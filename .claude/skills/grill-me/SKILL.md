---
name: grill-me
description: Interview the user relentlessly about a plan, design, or decision until both sides reach a shared understanding. Use when the user says "grill me", "拷問我", "質問我的計畫", or wants a plan stress-tested before implementation.
---

# Grill Me

逐一追問使用者計畫或設計的每個面向，直到雙方對它有一致的理解。

## 做法

1. **確認標的**：若使用者沒說要拷問什麼，先問清楚（某份計畫、docs/ROADMAP.md 的某項、某個功能設計）。
2. **先自己查**：能從程式碼、文件或 repo 中找到答案的問題，自己查，不要問使用者。
3. **走遍決策樹**：把計畫拆成一連串決策，依相依順序逐一處理；前面的決策會影響後面的問題。
4. **一次只問一題**：每題附上你的建議答案與理由，讓使用者同意、修改或否決。
5. **追問到底**：答案模糊、有矛盾、遺漏邊界情況（失敗模式、量測誤差、使用者操作錯誤、相容性）時繼續追問，不要輕易放過。
6. **記錄共識**：每解決一個分支，簡短記下結論；全部問完後輸出決策摘要與尚未解決的問題清單。

## 原則

- 用繁體中文溝通。
- 不要在達成共識前開始實作。
- 問題要具體、可回答，避免一次丟出多個問題。
