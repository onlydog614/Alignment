// 由迭代紀錄推測誤差來源
// history：[{ maxErr, dx, dy, dt }]，dx/dy(mm)、dt(deg) 為每次「下達」的修正量
(function (global) {
  'use strict';
  const VA = global.VA;

  function diagnose(history, opts = {}) {
    const out = [];
    if (!history || history.length < 2) {
      return [{ level: 'info', text: '至少需要 2 次迭代紀錄才能分析。' }];
    }
    // 低於「雜訊底」的修正量視為雜訊，不拿來推論（雜訊底取量測雜訊與公差/5 較大者）
    const noise = Math.max(opts.noise || 0, (opts.tol || 0) / 5, 1e-6);
    const arm = opts.arm || 100; // mark 到中心的平均距離（mm），用來把角度換成位移
    const first = history[0], second = history[1];
    const big = (dx, dy, dt) => Math.hypot(dx, dy) + Math.abs(dt) * VA.D2R * arm;

    // 1) 比例：第 2 次修正量 / 第 1 次修正量。理想為 0；負值 = 走過頭，正值 = 走不夠
    const ratios = [];
    const T1 = Math.hypot(first.dx, first.dy), T2 = Math.hypot(second.dx, second.dy);
    const secondBig = big(second.dx, second.dy, second.dt) > noise * 3;
    if (T1 > noise * 10 && Math.abs(first.dt) * VA.D2R * arm < T1 * 0.1 && secondBig) {
      const r = (second.dx * first.dx + second.dy * first.dy) / (T1 * T1);
      ratios.push({ what: '平移', r });
    }
    if (Math.abs(first.dt) * VA.D2R * arm > noise * 10 && Math.abs(second.dt) * VA.D2R * arm > noise * 3) {
      ratios.push({ what: '旋轉', r: second.dt / first.dt });
    }
    ratios.forEach(({ what, r }) => {
      if (Math.abs(r) < 0.02) return;
      const actual = 1 - r; // 實際移動 / 指令
      out.push({
        level: 'warn',
        text: `${what}：第 2 次修正量是第 1 次的 ${(r * 100).toFixed(1)}%，推估實際移動量約為指令的 ${(actual * 100).toFixed(1)}%` +
          (r < 0 ? '（過衝：軸比例、導程或像素當量偏大）。' : '（不足：軸比例、導程或像素當量偏小，或 Gain < 100%）。'),
        gain: actual
      });
    });

    // 2) 旋轉中心：若第 1 次有旋轉，第 2 次的平移中與旋轉成正比且垂直的部分 → 旋轉中心偏差
    //    實際繞 c+δ 旋轉 θ 時，下一次平移 T2 ≈ (−θ·δy, θ·δx)
    if (Math.abs(first.dt) * VA.D2R * arm > noise * 10 && Math.hypot(second.dx, second.dy) > noise * 3) {
      const th = first.dt * VA.D2R;
      // 先扣掉與第 1 次平移同方向的比例誤差
      let rx = second.dx, ry = second.dy;
      if (T1 > 1e-9) {
        const k = (second.dx * first.dx + second.dy * first.dy) / (T1 * T1);
        rx -= k * first.dx; ry -= k * first.dy;
        // 若 T1 與推估偏移方向重疊會被一起扣掉，此時只能給出下限
      }
      const rc = { x: ry / th, y: -rx / th };
      const mag = Math.hypot(rc.x, rc.y);
      // 由雜訊推算的最小可辨識偏差
      if (mag > Math.max(0.05, noise * 3 / Math.abs(th))) {
        out.push({
          level: 'warn', rc,
          text: `第 1 次旋轉 ${first.dt.toFixed(4)}° 後出現與旋轉相關的平移殘量，推估實際旋轉中心偏離設定約 (${rc.x.toFixed(3)}, ${rc.y.toFixed(3)}) mm。` +
            (T1 > 1e-9 ? '（第 1 次同時有平移，推估值可能受軸比例誤差影響）' : '')
        });
      }
    }

    // 3) 收斂到雜訊底：最後幾次誤差不再下降
    if (history.length >= 4) {
      const tail = history.slice(-3).map(h => h.maxErr);
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      const trend = tail[2] - tail[0];
      if (Math.abs(trend) < mean * 0.5) {
        out.push({ level: 'info', text: `最後 3 次最大誤差約 ${(mean * 1000).toFixed(2)} µm 且不再下降：已到量測雜訊／機構重複精度的極限；若仍大於公差，增加迭代次數無效。` });
      }
    }

    // 4) 振盪：連續修正方向反覆
    let flips = 0;
    for (let i = 1; i < history.length; i++) {
      if (history[i].dx * history[i - 1].dx < 0 && Math.abs(history[i].dx) > noise * 3 && Math.abs(history[i - 1].dx) > noise * 3) flips++;
    }
    if (flips >= 2 && history.length >= 3 && history[history.length - 1].maxErr > history[0].maxErr * 0.3) {
      out.push({ level: 'warn', text: 'X 修正方向反覆變號且誤差未明顯縮小：可能是軸方向／符號錯誤或 Gain 過大。' });
    }

    // 5) 發散
    if (history.length >= 3 && history[2].maxErr > history[0].maxErr && history[2].maxErr > noise * 3) {
      out.push({ level: 'error', text: '誤差越修越大（發散）：優先檢查軸方向、θ 正負號與 X/Y 是否對調。' });
    }

    if (!out.length) out.push({ level: 'ok', text: '迭代紀錄未見明顯的比例、旋轉中心或方向問題。' });
    return out;
  }

  global.VA = Object.assign(global.VA || {}, { diagnose });
})(typeof window !== 'undefined' ? window : globalThis);
