// 幾何與對位計算核心（不依賴 DOM，可單獨測試）
// 座標慣例：世界/平台座標單位 mm，Y 軸朝上，角度逆時針為正（deg）。
(function (global) {
  'use strict';

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  function rot(x, y, th) {
    const c = Math.cos(th), s = Math.sin(th);
    return { x: c * x - s * y, y: s * x + c * y };
  }

  // 相機校正 → 仿射參數：X = A·u + B·v + C, Y = D·u + E·v + F
  function cameraAffine(cam) {
    if (cam.calMode === 'matrix') {
      const m = cam.matrix;
      return { A: +m.A, B: +m.B, C: +m.C, D: +m.D, E: +m.E, F: +m.F };
    }
    const s = cam.simple;
    const sx = +s.mmppX * (s.flipX ? -1 : 1);
    const sy = +s.mmppY * (s.flipY ? -1 : 1);
    const th = +s.angle * D2R;
    const c = Math.cos(th), si = Math.sin(th);
    const A = c * sx, B = -si * sy, D = si * sx, E = c * sy;
    // 影像中心像素對應到世界座標 (ox, oy)
    const cx = cam.width / 2, cy = cam.height / 2;
    return { A, B, C: +s.ox - (A * cx + B * cy), D, E, F: +s.oy - (D * cx + E * cy) };
  }

  function pixToWorld(m, u, v) {
    return { x: m.A * u + m.B * v + m.C, y: m.D * u + m.E * v + m.F };
  }

  function worldToPix(m, x, y) {
    const det = m.A * m.E - m.B * m.D;
    if (Math.abs(det) < 1e-15) return { u: NaN, v: NaN };
    const dx = x - m.C, dy = y - m.F;
    return { u: (m.E * dx - m.B * dy) / det, v: (-m.D * dx + m.A * dy) / det };
  }

  // 由仿射矩陣反推像素當量與相機角度（用於檢查校正是否合理）
  function describeAffine(m) {
    const sx = Math.hypot(m.A, m.D);
    const sy = Math.hypot(m.B, m.E);
    const det = m.A * m.E - m.B * m.D;
    const angX = Math.atan2(m.D, m.A) * R2D;
    // u、v 兩軸在世界座標的夾角，理想為 ±90°；skew 為偏離量
    let between = Math.atan2(m.E, m.B) * R2D - angX;
    between = ((between + 540) % 360) - 180;
    const skew = Math.abs(between) - 90;
    // det < 0：影像 v 向下、世界 Y 向上的一般下視相機；det > 0：影像與世界同手性（例如由下往上看的相機）
    return { sx, sy, det, handed: det < 0 ? -1 : 1, angle: angX, skew };
  }

  // 剛體擬合：找 θ、T 使 R(θ)(P−c)+c+T ≈ Q（最小平方法）
  // pairs: [{p:{x,y}, q:{x,y}}]；c：旋轉中心；fixedTheta：單點時使用的角度（rad）
  function fitRigid(pairs, c, fixedTheta) {
    const n = pairs.length;
    if (n === 0) return null;
    let theta;
    let mp = { x: 0, y: 0 }, mq = { x: 0, y: 0 };
    for (const { p, q } of pairs) { mp.x += p.x; mp.y += p.y; mq.x += q.x; mq.y += q.y; }
    mp.x /= n; mp.y /= n; mq.x /= n; mq.y /= n;
    if (n === 1) {
      theta = fixedTheta || 0;
    } else {
      let sDot = 0, sCross = 0;
      for (const { p, q } of pairs) {
        const px = p.x - mp.x, py = p.y - mp.y, qx = q.x - mq.x, qy = q.y - mq.y;
        sDot += px * qx + py * qy;
        sCross += px * qy - py * qx;
      }
      theta = Math.atan2(sCross, sDot);
    }
    const r = rot(mp.x - c.x, mp.y - c.y, theta);
    const T = { x: mq.x - (r.x + c.x), y: mq.y - (r.y + c.y) };
    const residuals = pairs.map(({ p, q }) => {
      const m = applyMove(p, theta, T, c);
      return { x: q.x - m.x, y: q.y - m.y, d: Math.hypot(q.x - m.x, q.y - m.y) };
    });
    // 尺度比（目標間距 / 目前間距），用來察覺工件伸縮或校正尺度錯誤
    let scale = NaN;
    if (n >= 2) {
      let sp = 0, sq = 0;
      for (const { p, q } of pairs) {
        sp += Math.hypot(p.x - mp.x, p.y - mp.y);
        sq += Math.hypot(q.x - mq.x, q.y - mq.y);
      }
      scale = sp > 0 ? sq / sp : NaN;
    }
    return { theta, T, residuals, scale };
  }

  function applyMove(p, theta, T, c) {
    const r = rot(p.x - c.x, p.y - c.y, theta);
    return { x: r.x + c.x + T.x, y: r.y + c.y + T.y };
  }

  // 由平台修正量 (θ, T) 計算各軸指令
  // axis: {name, kind:'linear'|'linearRot'|'rotary', px, py, dir(deg), sign}
  //   linear   ：致動點固定於平台上（XXY / UVW 類），位移 = dir·(R·a − a + T)
  //   linearRot：XY 位於 θ 之上（θXY），位移 = dir·(R(−θ)·T)
  //   rotary   ：旋轉軸，位移 = θ（deg）
  function axisCommands(axes, theta, T) {
    return axes.map(ax => {
      const sign = ax.sign < 0 ? -1 : 1;
      const dir = +ax.dir * D2R;
      const ux = Math.cos(dir), uy = Math.sin(dir);
      let value;
      if (ax.kind === 'rotary') {
        value = theta * R2D;
      } else if (ax.kind === 'linearRot') {
        const t = rot(T.x, T.y, -theta);
        value = ux * t.x + uy * t.y;
      } else {
        const a = { x: +ax.px, y: +ax.py };
        const ra = rot(a.x, a.y, theta);
        value = ux * (ra.x - a.x + T.x) + uy * (ra.y - a.y + T.y);
      }
      return { name: ax.name, kind: ax.kind, value: sign * value, unit: ax.kind === 'rotary' ? 'deg' : 'mm' };
    });
  }

  // 簡易常態亂數（模擬量測雜訊）
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // 3×3 線性方程組（高斯消去，部分選主元）
  function solve3(M, b) {
    const a = M.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-14) return null;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  }

  // N 點校正：由 (u, v) ↔ (x, y) 求仿射參數 A–F（最小平方）
  function fitAffine(rows) {
    if (rows.length < 3) return null;
    // 以平均值為中心改善數值條件
    const n = rows.length;
    const mu = rows.reduce((s, r) => s + r.u, 0) / n, mv = rows.reduce((s, r) => s + r.v, 0) / n;
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    for (const r of rows) {
      const z = [r.u - mu, r.v - mv, 1];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) M[i][j] += z[i] * z[j];
        bx[i] += z[i] * r.x; by[i] += z[i] * r.y;
      }
    }
    const sx = solve3(M, bx), sy = solve3(M, by);
    if (!sx || !sy) return null;
    const m = {
      A: sx[0], B: sx[1], C: sx[2] - sx[0] * mu - sx[1] * mv,
      D: sy[0], E: sy[1], F: sy[2] - sy[0] * mu - sy[1] * mv
    };
    const info = describeAffine(m);
    const residuals = rows.map(r => {
      const w = pixToWorld(m, r.u, r.v);
      const dx = r.x - w.x, dy = r.y - w.y, d = Math.hypot(dx, dy);
      return { x: dx, y: dy, d, px: d / Math.sqrt(Math.abs(info.det)) };
    });
    const rms = Math.sqrt(residuals.reduce((s, r) => s + r.d * r.d, 0) / n);
    return { m, info, residuals, rms, max: Math.max(...residuals.map(r => r.d)) };
  }

  // 圓擬合（代數 Kasa 初值 + 幾何 Gauss-Newton 修正），用於求旋轉中心
  function fitCircle(pts) {
    const n = pts.length;
    if (n < 3) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const p of pts) {
      const x = p.x - mx, y = p.y - my, z = [x, y, 1], w = -(x * x + y * y);
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += z[i] * z[j]; b[i] += z[i] * w; }
    }
    const s = solve3(M, b);
    if (!s) return null;
    let cx = -s[0] / 2, cy = -s[1] / 2, r = Math.sqrt(Math.max(cx * cx + cy * cy - s[2], 0));
    for (let it = 0; it < 30; it++) {
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (const p of pts) {
        const dx = p.x - mx - cx, dy = p.y - my - cy, d = Math.hypot(dx, dy) || 1e-12;
        const row = [-dx / d, -dy / d, -1], e = d - r;
        for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) J[i][j] += row[i] * row[j]; g[i] -= row[i] * e; }
      }
      const step = solve3(J, g);
      if (!step) break;
      cx += step[0]; cy += step[1]; r += step[2];
      if (Math.hypot(step[0], step[1], step[2]) < 1e-12) break;
    }
    cx += mx; cy += my;
    const residuals = pts.map(p => Math.hypot(p.x - cx, p.y - cy) - r);
    // 參數標準差：cov = σ²·(JᵀJ)⁻¹；短圓弧時圓心沿半徑方向的不確定度會很大
    let sd = null;
    if (n > 3) {
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const p of pts) {
        const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1e-12, row = [-dx / d, -dy / d, -1];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) J[i][j] += row[i] * row[j];
      }
      const s2 = residuals.reduce((a, e) => a + e * e, 0) / (n - 3);
      const inv = [0, 1, 2].map(k => solve3(J, [0, 1, 2].map(i => (i === k ? 1 : 0))));
      if (inv.every(Boolean)) sd = { cx: Math.sqrt(s2 * inv[0][0]), cy: Math.sqrt(s2 * inv[1][1]), r: Math.sqrt(s2 * inv[2][2]) };
    }
    return { cx, cy, r, residuals, max: Math.max(...residuals.map(Math.abs)), sd };
  }

  // N×N 線性方程組（高斯消去）
  function solveN(M, b) {
    const n = b.length, a = M.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-18) return null;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
      }
    }
    return a.map((row, i) => row[n] / row[i]);
  }

  // 已知指令角度的旋轉中心擬合（線性）：p_i = R(θ_i)·p0 + (I − R(θ_i))·c
  // 未知數 [p0x, p0y, cx, cy]。精度約為 σ / 角度範圍，與半徑無關；
  // 若 θ 軸有比例誤差，得到的是「以指令角度計算時最一致」的有效中心，正是對位計算需要的。
  function rotCenterNormal(angles) {
    const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const rows = [];
    angles.forEach(t => {
      const c = Math.cos(t), s = Math.sin(t);
      rows.push([c, -s, 1 - c, s], [s, c, -s, 1 - c]);
    });
    rows.forEach(r => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) N[i][j] += r[i] * r[j]; });
    return { N, rows };
  }
  function fitRotCenterKnown(pts) {
    if (pts.length < 2) return null;
    const angles = pts.map(p => p.th * D2R);
    const { N, rows } = rotCenterNormal(angles);
    const b = [0, 0, 0, 0];
    pts.forEach((p, i) => {
      [p.x, p.y].forEach((v, k) => { const r = rows[2 * i + k]; for (let j = 0; j < 4; j++) b[j] += r[j] * v; });
    });
    const x = solveN(N, b);
    if (!x) return null;
    const p0 = { x: x[0], y: x[1] }, c = { x: x[2], y: x[3] };
    const residuals = pts.map((p, i) => {
      const q = applyMove(p0, angles[i], { x: 0, y: 0 }, c);
      return { x: p.x - q.x, y: p.y - q.y, d: Math.hypot(p.x - q.x, p.y - q.y) };
    });
    const dof = 2 * pts.length - 4;
    const s2 = dof > 0 ? residuals.reduce((a, r) => a + r.x * r.x + r.y * r.y, 0) / dof : NaN;
    const ix = [2, 3].map(k => solveN(N, [0, 1, 2, 3].map(i => (i === k ? 1 : 0))));
    const sd = ix.every(Boolean) && Number.isFinite(s2) ? Math.sqrt(s2 * Math.max(ix[0][2], 0) + s2 * Math.max(ix[1][3], 0)) : NaN;
    return { cx: c.x, cy: c.y, p0, residuals, max: Math.max(...residuals.map(r => r.d)), sd, r: Math.hypot(p0.x - c.x, p0.y - c.y) };
  }
  // 預估：角度 anglesDeg、每點雜訊 sigma 時，圓心 1σ 不確定度（與半徑無關）
  function rotCenterUncertainty(anglesDeg, sigma) {
    const { N } = rotCenterNormal(anglesDeg.map(a => a * D2R));
    const ix = [2, 3].map(k => solveN(N, [0, 1, 2, 3].map(i => (i === k ? 1 : 0))));
    if (!ix.every(Boolean)) return Infinity;
    return sigma * Math.sqrt(Math.max(ix[0][2], 0) + Math.max(ix[1][3], 0));
  }

  // Nelder–Mead 單純形最佳化
  function nelderMead(f, x0, steps, iters = 2000, tol = 1e-15) {
    const n = x0.length;
    let simplex = [x0.slice()];
    for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; simplex.push(x); }
    let vals = simplex.map(f);
    for (let k = 0; k < iters; k++) {
      const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
      simplex = idx.map(i => simplex[i]); vals = idx.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) <= tol) break;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
      const pt = t => c.map((cj, j) => cj + t * (simplex[n][j] - cj));
      const xr = pt(-1), fr = f(xr);
      if (fr < vals[0]) {
        const xe = pt(-2), fe = f(xe);
        if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
      } else if (fr < vals[n - 1]) {
        simplex[n] = xr; vals[n] = fr;
      } else {
        const xc = fr < vals[n] ? pt(-0.5) : pt(0.5), fc = f(xc);
        if (fc < Math.min(fr, vals[n])) { simplex[n] = xc; vals[n] = fc; } else {
          for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = f(simplex[i]); }
        }
      }
    }
    let best = 0;
    for (let i = 1; i <= n; i++) if (vals[i] < vals[best]) best = i;
    return { x: simplex[best], f: vals[best] };
  }

  // 最大誤差最小化（minimax）剛體擬合：以最小平方解為初值
  function fitRigidMinimax(pairs, c, fixedTheta) {
    const ls = fitRigid(pairs, c, fixedTheta);
    if (!ls || pairs.length < 2) return ls && Object.assign(ls, { method: 'minimax' });
    // 角度以「標記到中心的平均距離」換算為長度，讓三個參數尺度相近
    const mp = pairs.reduce((s, { p }) => ({ x: s.x + p.x / pairs.length, y: s.y + p.y / pairs.length }), { x: 0, y: 0 });
    const L = Math.max(1, pairs.reduce((s, { p }) => s + Math.hypot(p.x - mp.x, p.y - mp.y), 0) / pairs.length);
    const cost = x => {
      const th = x[0] / L, T = { x: x[1], y: x[2] };
      let worst = 0;
      for (const { p, q } of pairs) { const m = applyMove(p, th, T, c); worst = Math.max(worst, Math.hypot(q.x - m.x, q.y - m.y)); }
      return worst;
    };
    let x = [ls.theta * L, ls.T.x, ls.T.y];
    let step = Math.max(1e-4, Math.max(...ls.residuals.map(r => r.d)));
    for (let round = 0; round < 4; round++) {
      x = nelderMead(cost, x, [step, step, step], 600, 1e-13).x;
      step /= 4;
    }
    const theta = x[0] / L, T = { x: x[1], y: x[2] };
    const residuals = pairs.map(({ p, q }) => {
      const m = applyMove(p, theta, T, c);
      return { x: q.x - m.x, y: q.y - m.y, d: Math.hypot(q.x - m.x, q.y - m.y) };
    });
    return { theta, T, residuals, scale: ls.scale, method: 'minimax' };
  }

  global.VA = Object.assign(global.VA || {}, {
    D2R, R2D, rot, cameraAffine, pixToWorld, worldToPix, describeAffine,
    fitRigid, fitRigidMinimax, applyMove, axisCommands, gauss,
    solve3, solveN, fitAffine, fitCircle, fitRotCenterKnown, rotCenterUncertainty, nelderMead
  });
})(typeof window !== 'undefined' ? window : globalThis);
