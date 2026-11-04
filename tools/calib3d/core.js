// ===== 機台數學模型：真實機台（truth）＋控制器校正演算法＋放料計算 =====
// 單位：mm、rad（介面顯示用度）。世界座標 X 右、Y 往後、Z 往上，θ 由上往下看逆時針為正。
// 影像像素 (u, v)：以影像中心為原點，u 往右、v 往下。
(function (G) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
    mul: (a, k) => [a[0] * k, a[1] * k],
    mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    rot: (v, t) => { const c = Math.cos(t), s = Math.sin(t); return [c * v[0] - s * v[1], s * v[0] + c * v[1]]; },
    len: a => Math.hypot(a[0], a[1]),
    ang: a => Math.atan2(a[1], a[0])
  };
  const M = {
    ap: (m, v) => [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]],
    inv: m => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d]; },
    rot: t => [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)],
    mul: (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]],
    neg: m => m.map(x => -x),
    det: m => m[0] * m[3] - m[1] * m[2]
  };
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---- 亂數（可重現）----
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function gaussFn(r) {
    return () => { let u = 0; while (u === 0) u = r(); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  }

  // ---- 最小平方 ----
  function solve(N, y) {
    const n = y.length, A = N.map((r, i) => r.concat([y[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-300) return null;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
    }
    return A.map((r, i) => r[n] / r[i]);
  }
  function lstsq(rows, b) {
    const n = rows[0].length, N = [...Array(n)].map(() => Array(n).fill(0)), y = Array(n).fill(0);
    rows.forEach((r, i) => { for (let p = 0; p < n; p++) { y[p] += r[p] * b[i]; for (let q = 0; q < n; q++) N[p][q] += r[p] * r[q]; } });
    return solve(N, y);
  }

  // 仿射擬合 S = G·u + c（九點校正）
  function fitAffine(us, Ss) {
    const rows = us.map(u => [u[0], u[1], 1]);
    const x = lstsq(rows, Ss.map(s => s[0])), y = lstsq(rows, Ss.map(s => s[1]));
    const Gm = [x[0], x[1], y[0], y[1]], c = [x[2], y[2]];
    const res = us.map((u, i) => V.len(V.sub(V.add(M.ap(Gm, u), c), Ss[i])));
    return { G: Gm, c, res, rms: Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length), maxRes: Math.max(...res) };
  }
  function describeG(Gm) {
    const sx = Math.hypot(Gm[0], Gm[2]), sy = Math.hypot(Gm[1], Gm[3]);
    const det = M.det(Gm);
    const a1 = Math.atan2(Gm[2], Gm[0]), a2 = Math.atan2(Gm[3], Gm[1]);
    let between = (a2 - a1) * R2D; while (between > 180) between -= 360; while (between < -180) between += 360;
    return { sx, sy, mmpp: Math.sqrt(Math.abs(det)), det, angDeg: a1 * R2D, orthoDeg: Math.abs(between) - 90, handed: det < 0 ? '左手（影像 v 往下）' : '右手' };
  }

  // 旋轉中心：已知指令角度擬合 P_i = c + Rot(θ_i)·v（線性，4 未知數）
  function fitRotCenter(thetas, Ps) {
    const rows = [], b = [];
    thetas.forEach((t, i) => {
      const c = Math.cos(t), s = Math.sin(t);
      rows.push([1, 0, c, -s]); b.push(Ps[i][0]);
      rows.push([0, 1, s, c]); b.push(Ps[i][1]);
    });
    const x = lstsq(rows, b), center = [x[0], x[1]], v = [x[2], x[3]];
    const res = thetas.map((t, i) => V.len(V.sub(V.add(center, V.rot(v, t)), Ps[i])));
    return { center, v, r: V.len(v), res, rms: Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length) };
  }

  // 相似轉換擬合（料盤設計座標 → 平台座標），回傳角度、比例、平移
  function fitSimilarity(src, dst) {
    const rows = [], b = [];
    src.forEach((p, i) => { rows.push([p[0], -p[1], 1, 0]); b.push(dst[i][0]); rows.push([p[1], p[0], 0, 1]); b.push(dst[i][1]); });
    const x = lstsq(rows, b);
    return { a: x[0], b: x[1], t: [x[2], x[3]], scale: Math.hypot(x[0], x[1]), ang: Math.atan2(x[1], x[0]), apply: p => [x[0] * p[0] - x[1] * p[1] + x[2], x[1] * p[0] + x[0] * p[1] + x[3]] };
  }

  // ===================== 真實機台 =====================
  function defaultMachine() {
    return {
      // 上相機（固定、往下看）：相機1 拍平台1，相機2 拍平台2
      top: [
        { name: '相機1', plat: 0, C: [-250, -250], mmpp: 0.065, ang: 0.35 * D2R, up: false, w: 1280, h: 960 },
        { name: '相機2', plat: 1, C: [250, -250], mmpp: 0.065, ang: -0.28 * D2R, up: false, w: 1280, h: 960 }
      ],
      // 下相機（裝在 XY 載台上、往上看）：相機3 隨平台1，相機4 隨平台2
      bcam: {
        3: { name: '相機3', plat: 0, d: [-0.35, 110.20], dNom: [0, 110], mmpp: 0.010, ang: 0.25 * D2R, up: true, w: 1280, h: 960 },
        4: { name: '相機4', plat: 1, d: [0.45, 110.35], dNom: [0, 110], mmpp: 0.010, ang: 0.60 * D2R, up: true, w: 1280, h: 960 }
      },
      plat: [
        { name: '平台1', base: [-250, 0], rcOff: [0.42, -0.31], axisRot: 0.05 * D2R, scale: [0, 0], ortho: 0, yaw: 0, thScale: 0, tilt: [0, 0], transfer: [0, 0], cams: [3] },
        { name: '平台2', base: [250, 0], rcOff: [-0.27, 0.38], axisRot: -0.08 * D2R, scale: [0, 0], ortho: 0, yaw: 0, thScale: 0, tilt: [0, 0], transfer: [0, 0], cams: [4] }
      ],
      // 平台3 料盤：中心、角度、間距誤差（ppm）。穴位設計座標（料盤座標系）
      tray: { c: [0.12, 205.08], ang: 0.03 * D2R, scale: 0, cols: [-300, -180, -60, 60, 180, 300], rows: [-55, 55], markHalf: 30, nomC: [0, 205] },
      // 平台3 固定基準 Mark（料盤座標系）：左、中（兩平台共用）、右
      fidT: { L: [-390, 0], C: [0, 0], R: [390, 0] },
      hPlace: 38,      // 放料 Z 行程（mm）
      zPlate: 140      // 平台3 下表面高度（mm）
    };
  }
  const trayW = (m, p) => V.add(m.tray.c, V.rot(V.mul(p, 1 + m.tray.scale * 1e-6), m.tray.ang));
  const trayNom = (m, p) => V.add(m.tray.nomC, p);
  // 穴位 col(0..5)、row(0..1) → 料盤座標
  const pocketT = (m, ci, ri) => [m.tray.cols[ci], m.tray.rows[ri]];
  const pocketPlat = (m, ci) => (ci < 3 ? 0 : 1);

  // 載台（XY 上的 DD 與相機座）在世界中的位置與姿態
  function carriage(m, k, S) {
    const p = m.plat[k];
    const sx = (1 + p.scale[0] * 1e-6) * S[0] + p.ortho * 1e-6 * S[1], sy = (1 + p.scale[1] * 1e-6) * S[1];
    const K = V.add(p.base, V.rot([sx, sy], p.axisRot));
    const ang = p.axisRot + p.yaw * 1e-6 / 100 * S[0];
    return { K, ang };
  }
  function rcWorld(m, k, S) { const c = carriage(m, k, S); return V.add(c.K, V.rot(m.plat[k].rcOff, c.ang)); }
  // 吸盤上一點 q（相對旋轉中心、θ=0 時的載台座標）在世界中的位置
  function chuckPt(m, k, S, th, h, q) {
    const p = m.plat[k], c = carriage(m, k, S);
    const R = V.add(c.K, V.rot(p.rcOff, c.ang));
    const tt = th * (1 + p.thScale * 1e-6);
    return V.add(V.add(R, V.rot(q, c.ang + tt)), V.rot(V.mul(p.tilt, h * 1e-3), c.ang));
  }
  function camLocalA(cam) { const D = cam.up ? [-1, 0, 0, -1] : [1, 0, 0, -1]; return M.mul(M.rot(cam.ang), D).map(x => x * cam.mmpp); }
  function bcamPose(m, j, S) { const b = m.bcam[j], c = carriage(m, b.plat, S); return { o: V.add(c.K, V.rot(b.d, c.ang)), ang: c.ang }; }
  function pixTop(m, k, W) { const c = m.top[k]; return M.ap(M.inv(camLocalA(c)), V.sub(W, c.C)); }
  function pixB(m, j, S, W) { const cp = bcamPose(m, j, S); return M.ap(M.inv(M.mul(M.rot(cp.ang), camLocalA(m.bcam[j]))), V.sub(W, cp.o)); }
  function inImage(cam, u, margin) { const mg = margin || 0; return Math.abs(u[0]) <= cam.w / 2 - mg && Math.abs(u[1]) <= cam.h / 2 - mg; }

  // 控制器拿來移動的「設計值」位置（不知道真實誤差）
  const nomSc = (m, k) => V.sub(m.top[k].C, m.plat[k].base);                       // 吸盤中心到上相機 k 下方
  const nomSv = (m, j, W) => V.sub(V.sub(W, m.plat[m.bcam[j].plat].base), m.bcam[j].dNom); // 相機 j 到世界點 W 下方
  const nomSp = (m, k, W) => V.sub(W, m.plat[k].base);                             // 吸盤中心到世界點 W

  function noiseCtx(o) {
    const r = rng(o.seed || 7), g = gaussFn(r);
    return { r, g, px: o.px || 0, rep: (o.rep || 0) / 1000, th: (o.thRep || 0) / 3600 * D2R, slip: (o.slip || 0) / 1000 };
  }
  const npx = (N, u) => [u[0] + N.g() * N.px, u[1] + N.g() * N.px];
  const nS = (N, S) => [S[0] + N.g() * N.rep, S[1] + N.g() * N.rep];

  // ===================== 校正演算法 =====================
  const JIG = { qc: [0.8, -0.6], ang: 0.15 * D2R };
  function jigMarks(m, qc, ang) { return [-1, 1].map(s => V.add(qc, V.rot([s * m.tray.markHalf, 0], ang))); }

  // 步驟1：上相機九點（平台 k 帶玻璃 Mark 走 3×3，相機1↔平台1、相機2↔平台2）
  function calibTop(m, k, N, g) {
    const Sc = nomSc(m, k), q0 = [3, -2], step = g || 20, us = [], Ss = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const S = V.add(Sc, [i * step, j * step]);
      us.push(npx(N, pixTop(m, k, chuckPt(m, k, nS(N, S), 0, 0, q0)))); Ss.push(S);
    }
    const f = fitAffine(us, Ss);
    return Object.assign(f, { Sc, info: describeG(f.G), us, Ss, step, q0 });
  }
  // 步驟2：DD 旋轉中心（上相機看半徑約 20 mm 的 Mark，轉 0,45,...,315°）
  function calibRC(m, k, est, N) {
    const Sc = est.Sc, q = [20, 1.5], ths = [], Ps = [], us = [];
    for (let a = 0; a < 360; a += 45) {
      const t = a * D2R + N.g() * N.th;
      const u = npx(N, pixTop(m, k, chuckPt(m, k, nS(N, Sc), t, 0, q)));
      us.push(u); ths.push(a * D2R); Ps.push(V.add(M.ap(est.G, u), est.c));
    }
    const f = fitRotCenter(ths, Ps);
    return Object.assign(f, { R: V.sub(f.center, Sc), ths, us, Ps });
  }
  // 步驟3：下相機九點（相機隨平台移動，看平台3 固定 Mark）→ A = −G
  function calibBottom(m, j, N, g, noFlip) {
    const b = m.bcam[j], F = trayW(m, b.plat === 0 ? m.fidT.L : m.fidT.R);
    const S0 = nomSv(m, j, F), step = g || 3, us = [], Ss = [];
    for (let jj = -1; jj <= 1; jj++) for (let i = -1; i <= 1; i++) {
      const S = V.add(S0, [i * step, jj * step]);
      us.push(npx(N, pixB(m, j, nS(N, S), F))); Ss.push(S);
    }
    const f = fitAffine(us, Ss);
    const A = noFlip ? f.G.slice() : M.neg(f.G);
    return Object.assign(f, { A, info: describeG(A), Ginfo: describeG(f.G), us, Ss, step, F });
  }
  // 步驟4：上下相機連結（玻璃雙 Mark 治具轉移法）→ D_j（相機 j 影像中心 = S + D_j，平台座標）
  function calibLink(m, k, est, N, hCal) {
    const p = m.plat[k], h = hCal == null ? m.hPlace : hCal;
    const qm = jigMarks(m, JIG.qc, JIG.ang);
    const Sc = est.top[k].Sc, R = est.R[k];
    const qh = qm.map(q => V.sub(V.sub(V.add(M.ap(est.top[k].G, npx(N, pixTop(m, k, chuckPt(m, k, nS(N, Sc), 0, 0, q)))), est.top[k].c), Sc), R));
    const Wp = trayW(m, [k === 0 ? -180 : 180, -55]);
    const Sp = nomSp(m, k, trayNom(m, [k === 0 ? -180 : 180, -55]));
    const Spa = nS(N, Sp);
    const jw = qm.map(q => V.add(V.add(chuckPt(m, k, Spa, 0, h, q), p.transfer), [N.g() * N.slip, N.g() * N.slip]));
    const D = {}, shots = [];
    p.cams.forEach((j, idx) => {
      const mi = p.cams.length === 2 ? idx : 0;
      const Sv = nomSv(m, j, jw[mi]);
      const u = npx(N, pixB(m, j, nS(N, Sv), jw[mi]));
      D[j] = V.sub(V.sub(V.add(V.add(Sp, R), qh[mi]), Sv), M.ap(est.A[j], u));
      shots.push({ j, mi, Sv, u });
    });
    let check = null;
    if (p.cams.length === 1) { // 相機4：第二點驗證（量右 Mark，與預測比較）
      const j = p.cams[0], Sv = nomSv(m, j, jw[1]), u = npx(N, pixB(m, j, nS(N, Sv), jw[1]));
      const meas = V.add(V.add(Sv, D[j]), M.ap(est.A[j], u)), pred = V.add(V.add(Sp, R), qh[1]);
      check = { diff: V.sub(meas, pred), Sv, u };
      shots.push({ j, mi: 1, Sv, u });
    } else { // （兩台下相機時）基線檢查
      const [j2, j3] = p.cams;
      const s2 = shots[0], s3 = shots[1];
      const P2 = V.add(V.add(s2.Sv, D[j2]), M.ap(est.A[j2], s2.u)), P3 = V.add(V.add(s3.Sv, D[j3]), M.ap(est.A[j3], s3.u));
      check = { baseline: V.sub(D[j3], D[j2]), spacingBottom: V.len(V.sub(P3, P2)), spacingTop: V.len(V.sub(qh[1], qh[0])) };
    }
    return { D, qh, Sp, Wp, jw, shots, check, h };
  }
  // 料盤座標對應：平台 k 用下相機量兩個基準 Mark（含共用中間 Mark）
  function measureTray(m, k, est, N) {
    const j = m.plat[k].cams[0], keys = k === 0 ? ['L', 'C'] : ['C', 'R'];
    const pts = keys.map(key => {
      const W = trayW(m, m.fidT[key]), Sv = nomSv(m, j, W);
      const u = npx(N, pixB(m, j, nS(N, Sv), W));
      return { key, design: m.fidT[key], P: V.add(V.add(Sv, est.D[j]), M.ap(est.A[j], u)) };
    });
    const dd = V.sub(pts[1].design, pts[0].design), dp = V.sub(pts[1].P, pts[0].P);
    const ang = V.ang(dp) - V.ang(dd);
    return { pts, ang, scalePpm: (V.len(dp) / V.len(dd) - 1) * 1e6, toPlat: t => V.add(pts[0].P, V.rot(V.sub(t, pts[0].design), ang)) };
  }

  // 完整校正（在 mCal 機台上執行）
  function calibrateAll(mCal, o) {
    o = o || {};
    // 校正時每個位置拍 3 次取平均 → 像素雜訊 ÷ √3；上下連結做 3 次取平均（手順中的建議做法）
    const N = noiseCtx(Object.assign({}, o, { px: (o.px || 0) / Math.sqrt(3) }));
    const est = { top: [], R: [], rc: [], A: {}, b: {}, D: {}, link: [], tray: [], noFlip: !!o.noFlip };
    [0, 1].forEach(k => { est.top[k] = calibTop(mCal, k, N); const rc = calibRC(mCal, k, est.top[k], N); est.rc[k] = rc; est.R[k] = rc.R; });
    [3, 4].forEach(j => { const b = calibBottom(mCal, j, N, 3, o.noFlip); est.b[j] = b; est.A[j] = b.A; });
    [0, 1].forEach(k => {
      const reps = o.linkReps || 3, ls = [...Array(reps)].map(() => calibLink(mCal, k, est, N));
      est.link[k] = ls[0]; est.linkAll = est.linkAll || []; est.linkAll[k] = ls;
      Object.keys(ls[0].D).forEach(j => { est.D[j] = ls.reduce((a, l) => V.add(a, V.mul(l.D[j], 1 / reps)), [0, 0]); });
    });
    [0, 1].forEach(k => { est.tray[k] = measureTray(mCal, k, est, N); });
    return est;
  }

  // ===================== 生產：放一片料 =====================
  // wp: { qc:[x,y] 料中心相對旋轉中心, phi: 料角度 }；pocket: {ci, ri}
  function placeOne(m, est, k, pocket, wp, o, N) {
    o = o || {};
    const p = m.plat[k], h = m.hPlace + (o.dh || 0);
    const qm = jigMarks(m, wp.qc, wp.phi);
    const Sc = est.top[k].Sc, R = est.R[k];
    // a. 上相機量料
    const qh = qm.map(q => V.sub(V.sub(V.add(M.ap(est.top[k].G, npx(N, pixTop(m, k, chuckPt(m, k, nS(N, Sc), 0, 0, q)))), est.top[k].c), Sc), R));
    const wHat = V.mid(qh[0], qh[1]), phiHat = V.ang(V.sub(qh[1], qh[0]));
    // b. 下相機量穴位（或用基準 Mark 推算）
    const pt = pocketT(m, pocket.ci, pocket.ri);
    const trueMarks = [-1, 1].map(s => trayW(m, V.add(pt, [s * m.tray.markHalf, 0])));
    const nomMarks = [-1, 1].map(s => trayNom(m, V.add(pt, [s * m.tray.markHalf, 0])));
    let PL, PR;
    if (o.modeB) {
      const tr = est.tray[k];
      PL = tr.toPlat(V.add(pt, [-m.tray.markHalf, 0])); PR = tr.toPlat(V.add(pt, [m.tray.markHalf, 0]));
    } else if (p.cams.length === 2) {
      const [j2, j3] = p.cams, ap = [N.r() - 0.5, N.r() - 0.5].map(x => x * 0.4);
      const Sv = V.add(nomSv(m, j2, nomMarks[0]), ap), Sva = nS(N, Sv);
      PL = V.add(V.add(Sv, est.D[j2]), M.ap(est.A[j2], npx(N, pixB(m, j2, Sva, trueMarks[0]))));
      PR = V.add(V.add(Sv, est.D[j3]), M.ap(est.A[j3], npx(N, pixB(m, j3, Sva, trueMarks[1]))));
    } else {
      const j = p.cams[0];
      const P2 = trueMarks.map((W, i) => {
        const Sv = V.add(nomSv(m, j, nomMarks[i]), [N.r() - 0.5, N.r() - 0.5].map(x => x * 0.4));
        return V.add(V.add(Sv, est.D[j]), M.ap(est.A[j], npx(N, pixB(m, j, nS(N, Sv), W))));
      });
      PL = P2[0]; PR = P2[1];
    }
    const That = V.mid(PL, PR), psiHat = V.ang(V.sub(PR, PL));
    // c. 計算
    let dth = psiHat - phiHat; if (o.thetaSign) dth = -dth;
    const Sp = V.sub(V.sub(That, R), V.rot(wHat, dth));
    // d. 實際放下
    const Spa = nS(N, Sp), tha = dth + N.g() * N.th;
    const placed = qm.map(q => V.add(V.add(V.add(chuckPt(m, k, Spa, tha, h, q), p.transfer), [N.g() * N.slip, N.g() * N.slip]), [0, 0]));
    const pc = V.mid(placed[0], placed[1]), tc = V.mid(trueMarks[0], trueMarks[1]);
    const errW = V.sub(pc, tc);
    const err = V.rot(errW, -m.tray.ang); // 以料盤座標表示
    const angErr = V.ang(V.sub(placed[1], placed[0])) - V.ang(V.sub(trueMarks[1], trueMarks[0]));
    return { k, pocket, pt, dth, Sp, err, angErr, wHat, phiHat, That, psiHat };
  }

  // 套用「校正後機台變化」與「隨機誤差」，跑多片
  function applyDrift(m0, d) {
    const m = clone(m0); d = d || {};
    [0, 1].forEach(k => { if (d.top && d.top[k]) m.top[k].C = V.add(m.top[k].C, d.top[k]); });
    [3, 4].forEach(j => { if (d.cam && d.cam[j]) m.bcam[j].d = V.add(m.bcam[j].d, d.cam[j]); });
    [0, 1].forEach(k => {
      const p = m.plat[k];
      if (d.rc && d.rc[k]) p.rcOff = V.add(p.rcOff, d.rc[k]);
      if (d.scale && d.scale[k]) p.scale = V.add(p.scale, d.scale[k]);
      if (d.transfer && d.transfer[k]) p.transfer = V.add(p.transfer, d.transfer[k]);
      if (d.thScale && d.thScale[k]) p.thScale += d.thScale[k];
    });
    if (d.trayScale) m.tray.scale += d.trayScale;
    if (d.trayAng) m.tray.ang += d.trayAng * D2R;
    return m;
  }
  function runProduction(mCal, mNow, est, o) {
    o = o || {}; const N = noiseCtx(Object.assign({}, o, { seed: (o.seed || 7) + 101 }));
    const out = [], reps = o.reps || 3, phiRange = (o.phiDeg == null ? 1 : o.phiDeg) * D2R;
    for (let r = 0; r < reps; r++) for (let ci = 0; ci < 6; ci++) for (let ri = 0; ri < 2; ri++) {
      const k = pocketPlat(mNow, ci);
      const wp = { qc: [(N.r() - 0.5) * 1.0, (N.r() - 0.5) * 1.0], phi: (N.r() * 2 - 1) * phiRange };
      out.push(placeOne(mNow, est, k, { ci, ri }, wp, o, N));
    }
    return out;
  }

  // ===================== 偏移特徵回歸 =====================
  // 每平台：dX = a0 + a1·X + a2·Y + a3·Δθ；dY = b0 + b1·X + b2·Y + b3·Δθ
  // → 固定偏移 (a0,b0)；比例 a1、b2；旋轉 (b1−a2)/2；旋轉中心誤差 e = (b3, −a3)
  // 角度：dang = c0 + c1·Δθ（Δθ = 實際轉的角度；c1 ≈ 2 表示 Δθ 正負相反）
  function regress(X, b) {
    const n = X.length, p = X[0].length;
    const N = [...Array(p)].map(() => Array(p).fill(0)), y = Array(p).fill(0);
    X.forEach((r, i) => { for (let a = 0; a < p; a++) { y[a] += r[a] * b[i]; for (let c = 0; c < p; c++) N[a][c] += r[a] * r[c]; } });
    const coef = solve(N, y); if (!coef) return null;
    const inv = [...Array(p)].map((_, k) => solve(N, [...Array(p)].map((_, i) => (i === k ? 1 : 0))));
    const res = X.map((r, i) => b[i] - r.reduce((a, v, j) => a + v * coef[j], 0));
    const s2 = n > p ? res.reduce((a, v) => a + v * v, 0) / (n - p) : 0;
    return { coef, se: inv.map((col, k) => Math.sqrt(Math.max(0, s2 * col[k]))), res, s2 };
  }
  function analyze(rows) {
    const n = rows.length; if (n < 3) return null;
    const mean = f => rows.reduce((a, r) => a + f(r), 0) / n;
    const sd = f => { const mu = mean(f); return Math.sqrt(rows.reduce((a, r) => a + (f(r) - mu) ** 2, 0) / n); };
    const xc = mean(r => r.x), yc = mean(r => r.y);
    const feats = [{ key: 'c', f: () => 1 }];
    if (sd(r => r.x) > 1) feats.push({ key: 'x', f: r => r.x - xc });
    if (sd(r => r.y) > 1) feats.push({ key: 'y', f: r => r.y - yc });
    if (sd(r => r.dth) > 0.02 * D2R) feats.push({ key: 't', f: r => r.dth });
    while (feats.length > 1 && feats.length >= n - 1) feats.pop();
    const X = rows.map(r => feats.map(F => F.f(r)));
    const rx = regress(X, rows.map(r => r.dx)), ry = regress(X, rows.map(r => r.dy));
    if (!rx || !ry) return null;
    const idx = key => feats.findIndex(F => F.key === key);
    const get = (R, key) => { const i = idx(key); return i < 0 ? null : { v: R.coef[i], se: R.se[i] }; };
    const sig = Math.sqrt((rx.res.concat(ry.res)).reduce((a, v) => a + v * v, 0) / Math.max(1, 2 * (n - feats.length)));
    const ax = get(rx, 'x'), ayx = get(ry, 'x'), axy = get(rx, 'y'), ay = get(ry, 'y'), at = get(rx, 't'), bt = get(ry, 't');
    let rot = null;
    if (ayx && axy) rot = { v: (ayx.v - axy.v) / 2, se: Math.hypot(ayx.se, axy.se) / 2 };
    else if (ayx) rot = ayx; else if (axy) rot = { v: -axy.v, se: axy.se };
    const out = {
      n, feats: feats.map(F => F.key), center: [xc, yc],
      offset: [rx.coef[0], ry.coef[0]], offsetSE: [rx.se[0], ry.se[0]],
      scaleX: ax ? ax.v : null, scaleXSE: ax ? ax.se : null, scaleY: ay ? ay.v : null, scaleYSE: ay ? ay.se : null,
      rotXY: rot ? rot.v : null, rotSE: rot ? rot.se : null,
      e: at && bt ? [bt.v, -at.v] : null, eSE: at && bt ? [bt.se, at.se] : null,
      spanX: Math.max(...rows.map(r => r.x)) - Math.min(...rows.map(r => r.x)),
      spanY: Math.max(...rows.map(r => r.y)) - Math.min(...rows.map(r => r.y)),
      maxDth: Math.max(...rows.map(r => Math.abs(r.dth))),
      sigma: sig, meanAbs: mean(r => Math.hypot(r.dx, r.dy)), maxAbs: Math.max(...rows.map(r => Math.hypot(r.dx, r.dy)))
    };
    const angRows = rows.filter(r => r.dang != null && isFinite(r.dang));
    if (angRows.length >= 3) {
      const useT = sd(r => r.dth) > 0.02 * D2R;
      const ra = regress(angRows.map(r => useT ? [1, r.dth] : [1]), angRows.map(r => r.dang));
      if (ra) out.ang = { c0: ra.coef[0], c0SE: ra.se[0], c1: useT ? ra.coef[1] : null, c1SE: useT ? ra.se[1] : null, sigma: Math.sqrt(ra.s2), maxAbs: Math.max(...angRows.map(r => Math.abs(r.dang))) };
    }
    return out;
  }

  // 由回歸結果寫出推測（中文）。只有「統計上顯著（> 3 倍標準誤差）」且「影響 > minEffect」才列出
  function diagnose(byPlat, opt) {
    const o = Object.assign({ minEffect: 0.010, minAng: 5 / 3600 * D2R }, opt || {});
    const out = [], um = v => (v * 1000).toFixed(1) + ' µm', sec = v => (v * R2D * 3600).toFixed(1) + '″';
    const sigOff = a => a && Math.hypot(a.offset[0], a.offset[1]) > o.minEffect && (Math.abs(a.offset[0]) > 3 * a.offsetSE[0] || Math.abs(a.offset[1]) > 3 * a.offsetSE[1]);
    const offs = byPlat.map(a => (sigOff(a) ? a.offset : null));
    if (offs[0] && offs[1]) {
      const same = V.len(V.sub(offs[0], offs[1])) < 0.35 * Math.max(V.len(offs[0]), V.len(offs[1]));
      out.push(same
        ? { lvl: 'hi', t: `兩個平台有相同方向的固定偏移（平台1 ${um(offs[0][0])}, ${um(offs[0][1])}；平台2 ${um(offs[1][0])}, ${um(offs[1][1])}）`, s: '兩個平台的相機都是各自獨立的，共用的只有料盤、料本身與校正治具。先查料的 Mark 與外形是否一致、料盤本身位置、雙 Mark 玻璃治具（兩平台都用它做步驟 5）的 Mark 是否偏心，以及量偏移時的基準。' }
        : { lvl: 'hi', t: `兩個平台各有不同的固定偏移（平台1 ${um(offs[0][0])}, ${um(offs[0][1])}；平台2 ${um(offs[1][0])}, ${um(offs[1][1])}）`, s: '各平台自己的上下相機連結 D 或放料轉移量不對。重做步驟 5（玻璃治具轉移法），並確認 Z 行程、料厚與校正時相同。' });
    } else offs.forEach((of, k) => { if (of) out.push({ lvl: 'hi', t: `平台${k + 1} 有固定偏移（${um(of[0])}, ${um(of[1])}），平台${2 - k} 沒有`, s: `查平台${k + 1}：上相機${k + 1} 或下相機${k + 3} 是否鬆動、步驟 5 的 D、Z 軸傾斜 × 行程（換過料厚？）、破真空與吹氣造成的滑移。` }); });
    byPlat.forEach((a, k) => {
      if (!a) return;
      const P = `平台${k + 1}`;
      if (a.e) {
        const eff = Math.hypot(a.e[0], a.e[1]) * a.maxDth, sig = Math.abs(a.e[0]) > 3 * a.eSE[0] || Math.abs(a.e[1]) > 3 * a.eSE[1];
        if (sig && eff > o.minEffect) out.push({ lvl: 'hi', t: `${P} 偏移隨 Δθ 改變：程式用的旋轉中心與實際差約 e = (${a.e[0].toFixed(3)}, ${a.e[1].toFixed(3)}) mm`, s: `每轉 1° 多出約 ${um(Math.hypot(a.e[0], a.e[1]) * D2R)}。重做步驟 3；確認 DD、吸盤更換或撞機後有沒有重新求旋轉中心。` });
      }
      [['X', a.scaleX, a.scaleXSE, a.spanX], ['Y', a.scaleY, a.scaleYSE, a.spanY]].forEach(([ax, v, se, span]) => {
        if (v != null && Math.abs(v) > 3 * se && Math.abs(v) * span / 2 > o.minEffect) out.push({ lvl: 'mid', t: `${P} 偏移隨 ${ax} 位置線性變化（${(v * 1e6).toFixed(0)} ppm，兩端差 ${um(Math.abs(v) * span)}）`, s: '穴位若是用基準 Mark＋設計間距推算：軸比例（光學尺、溫度）或料盤實際間距與設計不同。改成每個穴位都拍，或用玻璃尺校軸比例。' });
      });
      if (a.rotXY != null && Math.abs(a.rotXY) > 3 * a.rotSE && Math.abs(a.rotXY) * Math.max(a.spanX, a.spanY) / 2 > o.minEffect) out.push({ lvl: 'mid', t: `${P} 偏移隨位置旋轉（約 ${sec(a.rotXY)}）`, s: '料盤角度量錯（兩個基準 Mark 太近或辨識誤差），或 X 軸行進偏擺。' });
      if (a.ang) {
        const g = a.ang;
        if (g.c1 != null && Math.abs(g.c1 - 2) < 0.3 && Math.abs(g.c1) > 3 * g.c1SE) out.push({ lvl: 'hi', t: `${P} 放料角度誤差約等於 2 × Δθ（DD 實際轉的角度）`, s: 'DD 轉的方向和程式算的相反：檢查 Δθ = ψ̂ − φ̂ 的正負號，以及 DD 的正方向設定。' });
        else if (g.c1 != null && Math.abs(g.c1) > 3 * g.c1SE && Math.abs(g.c1) * a.maxDth > o.minAng) out.push({ lvl: 'mid', t: `${P} 角度誤差與 Δθ 成比例（斜率 ${g.c1.toFixed(4)}）`, s: 'θ 比例不對（DD 每圈脈波數、減速比）或相機1／下相機的角度定義不同。' });
        if (Math.abs(g.c0) > 3 * g.c0SE && Math.abs(g.c0) > o.minAng) out.push({ lvl: 'mid', t: `${P} 有固定角度偏差 ${sec(g.c0)}`, s: '上相機與下相機的角度零點不一致：步驟 5 用雙 Mark 治具比對角度；檢查下相機兩次拍照（左、右 Mark）之間 X 軸的偏擺。' });
      }
      if (a.sigma > 0.03) out.push({ lvl: 'hi', t: `${P} 去掉趨勢後還有 ${um(a.sigma)}（1σ）的亂跳`, s: '這麼大的亂跳通常不是機構重複性：先查下相機 A 的正負號（平台故意偏 0.3 mm 去拍穴位，算出的穴位位置應不變），再查影像翻轉設定。' });
      else if (a.sigma > o.minEffect / 2) out.push({ lvl: 'lo', t: `${P} 去掉趨勢後還有 ${um(a.sigma)}（1σ）的隨機偏移`, s: '做「同料同穴重放 10 次」與「不動連拍 20 次」，分開機構重複性、真空滑移、整定時間與影像雜訊。' });
    });
    if (!out.length) out.push({ lvl: 'ok', t: '沒有明顯的系統性偏移', s: '剩下的偏移在雜訊範圍內。' });
    return out;
  }

  G.CAL = { D2R, R2D, V, M, rng, gaussFn, lstsq, fitAffine, describeG, fitRotCenter, fitSimilarity, defaultMachine, trayW, trayNom, pocketT, pocketPlat, carriage, rcWorld, chuckPt, camLocalA, bcamPose, pixTop, pixB, inImage, nomSc, nomSv, nomSp, noiseCtx, jigMarks, JIG, calibTop, calibRC, calibBottom, calibLink, measureTray, calibrateAll, placeOne, applyDrift, runProduction, analyze, diagnose, clone };
})(typeof window !== 'undefined' ? window : globalThis);
