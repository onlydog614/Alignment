// 自我驗證：在頁面與 node 中都可執行，回傳 [{name, pass, detail}]
(function (G) {
  'use strict';
  function selfTest(CAL) {
    const { V, D2R, R2D } = CAL, T = [];
    const ok = (name, pass, detail) => T.push({ name, pass: !!pass, detail });
    const um = v => (v * 1000).toFixed(3) + ' µm';
    const m = CAL.defaultMachine();

    // 1. 無雜訊校正：相機參數還原
    const est = CAL.calibrateAll(m, { px: 0 });
    [0, 1].forEach(k => {
      const i = est.cam1[k].info;
      ok(`相機1 九點（平台${k + 1}）：mm/px 還原`, Math.abs(i.mmpp - m.cam1.mmpp) < 1e-9, `${i.mmpp.toFixed(6)} vs 真值 ${m.cam1.mmpp}`);
      ok(`相機1 九點（平台${k + 1}）：殘差 ≈ 0`, est.cam1[k].maxRes < 1e-9, um(est.cam1[k].maxRes));
    });
    [2, 3, 4].forEach(j => {
      const b = m.bcam[j], i = est.b[j].info;
      ok(`相機${j} 九點：mm/px 還原`, Math.abs(i.mmpp - b.mmpp) < 1e-9, `${i.mmpp.toFixed(6)} vs ${b.mmpp}`);
      ok(`相機${j} 九點：G 行列式為正（往上看、相機隨平台動）`, est.b[j].Ginfo.det > 0, `det(G)=${est.b[j].Ginfo.det.toExponential(3)}；相機1 det=${est.cam1[0].info.det.toExponential(3)}`);
    });
    // 2. 旋轉中心與相機偏移：D_j − R 應等於「相機中心 − 旋轉中心」的載台座標（真值）
    [2, 3, 4].forEach(j => {
      const b = m.bcam[j], k = b.plat, p = m.plat[k];
      const truth = V.sub(b.d, p.rcOff), got = V.sub(est.D[j], est.R[k]);
      const d = V.len(V.sub(truth, got));
      ok(`相機${j}：D − R 還原（相機到旋轉中心的向量）`, d < 1e-6, `(${got[0].toFixed(4)}, ${got[1].toFixed(4)}) vs 真值 (${truth[0].toFixed(4)}, ${truth[1].toFixed(4)})，差 ${um(d)}`);
    });
    // 3. 理想機台放料誤差 ≈ 0（含 Z 傾斜與放料轉移：在連結步驟被吸收）
    const m2 = CAL.clone(m); m2.plat[0].tilt = [0.8, -0.5]; m2.plat[1].transfer = [0.012, -0.008]; m2.plat[0].yaw = 0;
    const est2 = CAL.calibrateAll(m2, { px: 0 });
    const pr = CAL.runProduction(m2, m2, est2, { px: 0, reps: 2 });
    const maxE = Math.max(...pr.map(r => V.len(r.err))), maxA = Math.max(...pr.map(r => Math.abs(r.angErr)));
    ok('無誤差機台：所有穴位放料偏移 ≈ 0（Z 傾斜、轉移量已被連結吸收）', maxE < 1e-6 && maxA < 1e-9, `最大 ${um(maxE)}、角度 ${(maxA * R2D * 3600).toExponential(2)}″`);

    // 4. 旋轉中心誤差：e = R̂ − R，誤差 = (Rot(Δθ) − I)e ≈ Δθ·(−ey, ex)
    const shift = [0.05, -0.03];
    const mNow = CAL.applyDrift(m, { rc: [shift, null] });
    const N0 = CAL.noiseCtx({});
    const wp = { qc: [0.2, -0.1], phi: -0.8 * D2R };
    const r1 = CAL.placeOne(mNow, est, 0, { ci: 1, ri: 0 }, wp, {}, N0);
    const e = V.mul(shift, -1), dth = r1.dth;
    const exact = V.rot(V.sub(V.rot(e, dth), e), -m.tray.ang);
    ok('旋轉中心誤差公式：(Rot(Δθ)−I)·e 與模擬一致', V.len(V.sub(exact, r1.err)) < 2e-6, `模擬 (${um(r1.err[0])}, ${um(r1.err[1])})；公式 (${um(exact[0])}, ${um(exact[1])})；Δθ=${(dth * R2D).toFixed(3)}°`);
    const prR = CAL.runProduction(m, mNow, est, { px: 0, reps: 3, phiDeg: 1.5 });
    const an = CAL.analyze(prR.filter(r => r.k === 0).map(r => ({ x: r.pt[0], y: r.pt[1], dth: r.dth, dx: r.err[0], dy: r.err[1] })));
    ok('偏移回歸：由多片資料反推出旋轉中心誤差 e', an && an.e && V.len(V.sub(an.e, e)) < 0.002, an && an.e ? `反推 (${an.e[0].toFixed(4)}, ${an.e[1].toFixed(4)}) vs 實際 (${e[0]}, ${e[1]})` : '無');

    // 5. 下相機鬆動 → 固定偏移 −δ
    const dc = [0.02, -0.015];
    const mC = CAL.applyDrift(m, { cam: { 4: dc } });
    const prC = CAL.runProduction(m, mC, est, { px: 0, reps: 2 }).filter(r => r.k === 1);
    const meanC = prC.reduce((a, r) => V.add(a, V.mul(r.err, 1 / prC.length)), [0, 0]);
    const spreadC = Math.max(...prC.map(r => V.len(V.sub(r.err, meanC))));
    ok('相機4 移動 δ → 平台2 每片固定偏移 ≈ −δ', V.len(V.add(meanC, V.rot(dc, m.plat[1].axisRot - m.tray.ang))) < 2e-4 && spreadC < 2e-4, `平均 (${um(meanC[0])}, ${um(meanC[1])})，散佈 ${um(spreadC)}`);
    // 6. 相機1 移動 → 兩平台同向偏移 ≈ +δ
    const mc1 = CAL.applyDrift(m, { cam1: [0.03, 0.01] });
    const pc1 = CAL.runProduction(m, mc1, est, { px: 0, reps: 1 });
    const mean0 = pc1.filter(r => r.k === 0).reduce((a, r, _, A) => V.add(a, V.mul(r.err, 1 / A.length)), [0, 0]);
    const mean1 = pc1.filter(r => r.k === 1).reduce((a, r, _, A) => V.add(a, V.mul(r.err, 1 / A.length)), [0, 0]);
    ok('相機1 移動 δ → 兩平台同向偏移 ≈ +δ', V.len(V.sub(mean0, [0.03, 0.01])) < 2e-3 && V.len(V.sub(mean1, [0.03, 0.01])) < 2e-3, `平台1 (${um(mean0[0])}, ${um(mean0[1])})；平台2 (${um(mean1[0])}, ${um(mean1[1])})`);

    // 7. 下相機九點沒有取負號 → 偏移隨 Mark 在畫面的位置變化（約 2 倍）
    const estF = CAL.calibrateAll(m, { px: 0, noFlip: true });
    const pF = CAL.runProduction(m, m, estF, { px: 0, reps: 3 });
    const maxF = Math.max(...pF.map(r => V.len(r.err)));
    ok('下相機符號錯（A = +G）：放料偏移明顯、且每片不同', maxF > 0.05, `最大偏移 ${um(maxF)}（拍照時 Mark 偏離影像中心 ±0.2 mm）`);

    // 8. 用基準 Mark 推算穴位（模式 B）＋ 料盤實際間距 +200 ppm → 回歸量到約 +200 ppm
    const mT = CAL.applyDrift(m, { trayScale: 200 });
    const pT = CAL.runProduction(m, mT, est, { px: 0, reps: 1, modeB: true }).filter(r => r.k === 0);
    const aT = CAL.analyze(pT.map(r => ({ x: r.pt[0], y: r.pt[1], dth: r.dth, dx: r.err[0], dy: r.err[1] })));
    ok('模式 B（基準 Mark＋設計間距）料盤間距 +200 ppm → 回歸 X 比例 ≈ −200 ppm', aT && Math.abs(aT.scaleX * 1e6 + 200) < 5, aT ? `X ${(aT.scaleX * 1e6).toFixed(1)} ppm` : '無');
    const pTA = CAL.runProduction(m, mT, est, { px: 0, reps: 1 }).filter(r => r.k === 0);
    const maxTA = Math.max(...pTA.map(r => V.len(r.err)));
    ok('模式 A（每穴位都拍）同樣條件 → 偏移 ≈ 0', maxTA < 1e-4, `最大 ${um(maxTA)}`);

    // 9. 雜訊下旋轉中心精度：Monte-Carlo 標準差 vs 理論 σ_P/√(N/2)/r·r …（圓心 σ ≈ σ_P·√(2/N)）
    const sims = [];
    for (let s = 1; s <= 200; s++) { const N = CAL.noiseCtx({ px: 0.1, seed: s * 17 }); const c1 = CAL.calibCam1(m, 0, N); const rc = CAL.calibRC(m, 0, c1, N); sims.push(rc.R); }
    const mu = sims.reduce((a, r) => V.add(a, V.mul(r, 1 / sims.length)), [0, 0]);
    const sdx = Math.sqrt(sims.reduce((a, r) => a + (r[0] - mu[0]) ** 2, 0) / sims.length);
    const theo = 0.1 * m.cam1.mmpp * Math.sqrt(2 / 8);
    ok('旋轉中心精度（0.1 px 雜訊、8 角度 Monte-Carlo）接近理論 σ·√(2/N)', sdx < theo * 2.2, `模擬 1σ ${um(sdx)}；理論（不含九點誤差）${um(theo)}`);

    // 11. 推測規則：理想機台（只有雜訊）不應出現高風險推測；Δθ 正負相反要被抓到
    const rowsK = (pr, k) => pr.filter(r => r.k === k).map(r => ({ x: r.pt[0], y: r.pt[1], dth: r.dth, dx: r.err[0], dy: r.err[1], dang: r.angErr }));
    const estN = CAL.calibrateAll(m, { px: 0.1, rep: 1, thRep: 2, seed: 11 });
    const prN = CAL.runProduction(m, m, estN, { px: 0.1, rep: 1, thRep: 2, slip: 1, seed: 14, reps: 3 });
    const dN = CAL.diagnose([0, 1].map(k => CAL.analyze(rowsK(prN, k))));
    ok('推測規則：只有雜訊時不誤判', !dN.some(d => d.lvl === 'hi'), dN.map(d => d.t).join('；'));
    const prS = CAL.runProduction(m, m, estN, { px: 0.1, rep: 1, thRep: 2, slip: 1, seed: 14, reps: 3, thetaSign: true });
    const dS = CAL.diagnose([0, 1].map(k => CAL.analyze(rowsK(prS, k))));
    ok('推測規則：Δθ 正負相反被抓到（角度誤差 ≈ 2 × 實際轉的 Δθ）', dS.filter(d => d.t.includes('2 × Δθ')).length === 2, dS.map(d => d.t).join('；'));
    const prR2 = CAL.runProduction(m, mNow, estN, { px: 0.1, rep: 1, thRep: 2, slip: 1, seed: 14, reps: 3, phiDeg: 2 });
    const mR3 = CAL.applyDrift(m, { rc: [[0.8, -0.4], null] });
    const dR = CAL.diagnose([0, 1].map(k => CAL.analyze(rowsK(CAL.runProduction(m, mR3, estN, { px: 0.1, rep: 1, thRep: 2, slip: 1, seed: 14, reps: 3, phiDeg: 2 }), k))));
    ok('推測規則：平台1 旋轉中心偏 0.8 mm 被抓到、平台2 沒被誤判', dR.some(d => d.t.startsWith('平台1 偏移隨 Δθ')) && !dR.some(d => d.t.startsWith('平台2 偏移隨 Δθ')), dR.map(d => d.t).join('；'));
    const dC4 = CAL.diagnose([0, 1].map(k => CAL.analyze(rowsK(CAL.runProduction(m, CAL.applyDrift(m, { cam: { 4: [0.02, -0.012] } }), estN, { px: 0.1, rep: 1, thRep: 2, slip: 1, seed: 14, reps: 3 }), k))));
    ok('推測規則：相機4 鬆動 → 只有平台2 固定偏移', dC4.some(d => d.t.startsWith('平台2 有固定偏移')), dC4.map(d => d.t).join('；'));
    // 10. 料盤座標：兩平台量同一個中間基準 Mark，換到世界座標應一致
    const P1 = est.tray[0].pts.find(p => p.key === 'C').P, P2 = est.tray[1].pts.find(p => p.key === 'C').P;
    ok('料盤中間共用 Mark：兩平台各自量到（各自座標系）', isFinite(P1[0]) && isFinite(P2[0]), `平台1 (${P1[0].toFixed(3)}, ${P1[1].toFixed(3)})；平台2 (${P2[0].toFixed(3)}, ${P2[1].toFixed(3)})`);
    return T;
  }
  G.selfTest = selfTest;
})(typeof window !== 'undefined' ? window : globalThis);
