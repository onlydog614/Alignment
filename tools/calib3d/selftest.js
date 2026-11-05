// 自我驗證：在頁面與 node 中都可執行，回傳 [{name, pass, detail}]
(function (G) {
  'use strict';
  function selfTest(CAL) {
    const { V, D2R, R2D } = CAL, T = [];
    const ok = (name, pass, detail) => T.push({ name, pass: !!pass, detail });
    const um = v => (v * 1000).toFixed(3) + ' µm';
    const m = CAL.defaultMachine(CAL.loadParams());

    // 1. 無雜訊校正：相機參數還原
    const est = CAL.calibrateAll(m, { px: 0 });
    [0, 1].forEach(k => {
      const i = est.top[k].info, c = m.top[k];
      const tv = Math.sqrt(c.mmpp * c.mmppY);
      ok(`上${c.name} 九點（平台${k + 1}）：mm/px 還原`, Math.abs(i.mmpp - tv) < 1e-9, `${i.mmpp.toFixed(6)} vs 真值 ${tv.toFixed(6)}`);
      ok(`上${c.name} 九點（平台${k + 1}）：相機角度還原（含平台軸安裝角）`, Math.abs(i.angDeg - (c.ang - m.plat[k].axisRot) * R2D) < 1e-6, `${i.angDeg.toFixed(4)}° vs ${((c.ang - m.plat[k].axisRot) * R2D).toFixed(4)}°`);
      ok(`上${c.name} 九點（平台${k + 1}）：殘差 ≈ 0`, est.top[k].maxRes < 1e-9, um(est.top[k].maxRes));
    });
    [3, 4].forEach(j => {
      const b = m.bcam[j], i = est.b[j].info;
      const tv = Math.sqrt(b.mmpp * b.mmppY);
      ok(`相機${j} 九點：mm/px 還原`, Math.abs(i.mmpp - tv) < 1e-9, `${i.mmpp.toFixed(6)} vs ${tv.toFixed(6)}`);
      ok(`相機${j} 九點：G 行列式為正（往上看、相機隨平台動）`, est.b[j].Ginfo.det > 0, `det(G)=${est.b[j].Ginfo.det.toExponential(3)}；上相機 det=${est.top[b.plat].info.det.toExponential(3)}`);
    });
    // 2. 旋轉中心與相機偏移：D_j − R 應等於「相機中心 − 旋轉中心」的載台座標（真值）
    [3, 4].forEach(j => {
      const b = m.bcam[j], k = b.plat, p = m.plat[k];
      const truth = V.sub(b.d, p.rcOff), got = V.sub(est.D[j], est.R[k]);
      const d = V.len(V.sub(truth, got));
      ok(`相機${j}：D − R 還原（相機到旋轉中心的向量）`, d < 1e-6, `(${got[0].toFixed(4)}, ${got[1].toFixed(4)}) vs 真值 (${truth[0].toFixed(4)}, ${truth[1].toFixed(4)})，差 ${um(d)}`);
    });
    // 3. 理想機台放料誤差 ≈ 0（含 Z 傾斜與放料轉移：在連結步驟被吸收）
    const m2 = CAL.clone(m); m2.plat[0].tilt = [0.8, -0.5]; m2.plat[1].transfer = [0.012, -0.008]; m2.plat[0].yaw = 0; m2.hCal = m2.hPlace; // 治具與料同厚
    const est2 = CAL.calibrateAll(m2, { px: 0 });
    const pr = CAL.runProduction(m2, m2, est2, { px: 0, reps: 2 });
    const maxE = Math.max(...pr.map(r => V.len(r.err))), maxA = Math.max(...pr.map(r => Math.abs(r.angErr)));
    ok('無誤差機台：所有穴位放料偏移 ≈ 0（Z 傾斜、轉移量已被連結吸收）', maxE < 1e-6 && maxA < 1e-9, `最大 ${um(maxE)}、角度 ${(maxA * R2D * 3600).toExponential(2)}″`);

    // 3b. 治具與料厚度不同：Z 傾斜 t 時，平台多一個固定偏移 t × Δh
    const m3 = CAL.clone(m); m3.plat[0].tilt = [2, 0]; m3.hCal = m3.hPlace + 0.5;
    const pr3 = CAL.runProduction(m3, m3, CAL.calibrateAll(m3, { px: 0 }), { px: 0, reps: 1 }).filter(r => r.k === 0);
    const e3 = pr3.reduce((a, r) => a + r.err[0], 0) / pr3.length, exp3 = -2e-3 * 0.5 * Math.cos(m3.plat[0].axisRot - m3.tray.ang);
    ok('治具比料薄 0.5 mm、Z 傾斜 2 mrad → 平台1 固定偏移 ≈ 傾斜 × 行程差 = −1 µm', Math.abs(e3 - exp3) < 2e-5, `模擬 ${um(e3)}，公式 ${um(exp3)}`);
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
    // 6. 上相機1 移動 → 只有平台1 偏移 ≈ +δ，平台2 不受影響
    const mc1 = CAL.applyDrift(m, { top: [[0.03, 0.01], null] });
    const pc1 = CAL.runProduction(m, mc1, est, { px: 0, reps: 1 });
    const mean0 = pc1.filter(r => r.k === 0).reduce((a, r, _, A) => V.add(a, V.mul(r.err, 1 / A.length)), [0, 0]);
    const mean1 = pc1.filter(r => r.k === 1).reduce((a, r, _, A) => V.add(a, V.mul(r.err, 1 / A.length)), [0, 0]);
    ok('上相機1 移動 δ → 平台1 偏移 ≈ +δ、平台2 不受影響', V.len(V.sub(mean0, [0.03, 0.01])) < 2e-3 && V.len(mean1) < 2e-4, `平台1 (${um(mean0[0])}, ${um(mean0[1])})；平台2 (${um(mean1[0])}, ${um(mean1[1])})`);

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
    for (let s = 1; s <= 200; s++) { const N = CAL.noiseCtx({ px: 0.1, seed: s * 17 }); const c1 = CAL.calibTop(m, 0, N); const rc = CAL.calibRC(m, 0, c1, N); sims.push(rc.R); }
    const mu = sims.reduce((a, r) => V.add(a, V.mul(r, 1 / sims.length)), [0, 0]);
    const sdx = Math.sqrt(sims.reduce((a, r) => a + (r[0] - mu[0]) ** 2, 0) / sims.length);
    const theo = 0.1 * m.top[0].mmpp * Math.sqrt(2 / 8);
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
    // 10. 料盤配置：2×12 穴，左平台 1–6 欄（Mark A、B）、右平台 7–12 欄（Mark C、D）
    const h = m.tray.nC / 2, cntL = pr.filter(r => r.k === 0).length, cntR = pr.filter(r => r.k === 1).length;
    ok('料盤配置：左平台負責 1–6 欄、右平台 7–12 欄，各 12 穴', m.tray.nC === 12 && m.tray.nR === 2 && cntL === cntR && pr.filter(r => r.k === 0).every(r => r.pocket.ci < h), `欄 ${m.tray.nC}、列 ${m.tray.nR}；每輪左 ${cntL / 2}、右 ${cntR / 2} 穴`);
    const dA = Math.abs(m.tray.cols[h - 1] - m.fidT.A[0]), dC = Math.abs(m.fidT.D[0] - m.tray.cols[h]);
    const dflt = ['tray_pitch_x', 'tray_cols', 'fidA_x', 'fidD_x'].every(k => m.P[k] === CAL.defaultParams()[k]);
    ok(dflt ? '料盤配置：Mark A 到 1-6、1-7 到 Mark D 的 X 距離 = 742.5 mm（配置圖）' : '料盤配置：Mark 到交界欄的 X 距離（自訂參數，只列出）', !dflt || (Math.abs(dA - 742.5) < 1e-9 && Math.abs(dC - 742.5) < 1e-9), `A→6 欄 ${dA.toFixed(1)} mm；7 欄→D ${dC.toFixed(1)} mm`);
    const t0 = est.tray[0], t1 = est.tray[1];
    ok('料盤座標：左平台用 A、B，右平台用 C、D，兩邊都量到料盤角度（= 料盤角 − 平台軸安裝角）', !t0.single && !t1.single && t0.pts.map(p => p.key).join('') === 'AB' && t1.pts.map(p => p.key).join('') === 'CD' && Math.abs(t0.ang - (m.tray.ang - m.plat[0].axisRot)) < 1e-6 && Math.abs(t1.ang - (m.tray.ang - m.plat[1].axisRot)) < 1e-6, `左 ${(t0.ang * R2D * 3600).toFixed(2)}″、右 ${(t1.ang * R2D * 3600).toFixed(2)}″；兩者差 ${((t0.ang - t1.ang) * R2D).toFixed(3)}° = 兩平台軸安裝角差 ${((m.plat[1].axisRot - m.plat[0].axisRot) * R2D).toFixed(3)}°`);
    const pB0 = CAL.runProduction(m, m, est, { px: 0, reps: 1, modeB: true });
    const mxB = Math.max(...pB0.map(r => V.len(r.err)));
    ok('模式 B（只拍 SPB Mark＋設計間距）：料盤無加工誤差時兩平台放料偏移 ≈ 0', mxB < 1e-4, `最大 ${um(mxB)}`);
    // 雜訊下：A–B 基線量角度的精度
    const angs2 = []; for (let i = 0; i < 100; i++) { const Ni = CAL.noiseCtx({ px: 0.1 / Math.sqrt(3), rep: 1, seed: 300 + i }); angs2.push(CAL.measureTray(m, 0, est, Ni).ang - t0.ang); }
    const sd2 = Math.sqrt(angs2.reduce((a, x) => a + x * x, 0) / angs2.length), th2 = Math.SQRT2 * Math.hypot(0.1 / Math.sqrt(3) * m.bcam[3].mmpp, 0.001) / V.len(V.sub(m.fidT.A, m.fidT.B));
    ok('料盤角度精度：A–B 基線、0.1 px（3 次平均）＋1 µm 重複性，Monte-Carlo 接近理論', sd2 < th2 * 1.6 && sd2 > th2 * 0.5, `模擬 ${(sd2 * R2D * 3600).toFixed(2)}″；理論 ${(th2 * R2D * 3600).toFixed(2)}″`);
    // 10b. 目前機台流程：人工放料（每片重拍上相機四角）＋ A–D 只量第一次
    const pMan = CAL.runProduction(m, m, est, { px: 0, reps: 1, modeB: true, qTol: 1, phiDeg: 1 });
    ok('人工放料 ±1 mm、±1°，每片重拍四角＋A–D 推算穴位：無誤差機台偏移 ≈ 0', Math.max(...pMan.map(r => V.len(r.err))) < 1e-4, `最大 ${um(Math.max(...pMan.map(r => V.len(r.err))))}`);
    const pC4 = CAL.runProduction(m, mC, est, { px: 0, reps: 1, modeB: true }).filter(r => r.k === 1);
    ok('A–D 只量第一次：之後相機4 鬆動，生產不用下相機 → 放料不受影響（要等重量 A–D 才會進來）', Math.max(...pC4.map(r => V.len(r.err))) < 1e-4, `最大 ${um(Math.max(...pC4.map(r => V.len(r.err))))}`);
    const estRe = Object.assign({}, est, { tray: [0, 1].map(k => CAL.measureTray(mC, k, est, N0)) });
    const pC4r = CAL.runProduction(m, mC, estRe, { px: 0, reps: 1, modeB: true }).filter(r => r.k === 1);
    const mC4r = pC4r.reduce((a, r) => V.add(a, V.mul(r.err, 1 / pC4r.length)), [0, 0]);
    ok('相機4 鬆動後換盤重量 A–D → 平台2 固定偏移 ≈ −δ', V.len(V.add(mC4r, V.rot(dc, m.plat[1].axisRot - m.tray.ang))) < 2e-4, `平均 (${um(mC4r[0])}, ${um(mC4r[1])})`);
    const mTr = CAL.applyDrift(m, { trayAng: 20 / 3600 });
    const pTr = CAL.runProduction(m, mTr, est, { px: 0, reps: 1, modeB: true });
    const aTr = [0, 1].map(k => CAL.analyze(pTr.filter(r => r.k === k).map(r => ({ x: r.pt[0], y: r.pt[1], dth: r.dth, dx: r.err[0], dy: r.err[1], dang: r.angErr }))));
    ok('量完 A–D 後料盤轉 20″ → 兩平台偏移都隨位置旋轉約 −20″', aTr.every(a => a && Math.abs(a.rotXY * R2D * 3600 + 20) < 1.5), aTr.map(a => (a.rotXY * R2D * 3600).toFixed(1) + '″').join('、'));
    // 10c. 實放驗證：同一穴位重放 10 次，每次人工重放＋重拍上相機（只有雜訊）→ 3σ 小、平均 ≈ 0
    const Nv = CAL.noiseCtx({ px: 0.1, rep: 1, thRep: 2, slip: 1, seed: 71 }), rv = [];
    for (let i = 0; i < 10; i++) rv.push(CAL.placeOne(m, estN, 0, { ci: h - 1, ri: 0 }, { qc: [(Nv.r() * 2 - 1), (Nv.r() * 2 - 1)], phi: (Nv.r() * 2 - 1) * D2R }, { modeB: true }, Nv));
    const mv = rv.reduce((a2, r) => V.add(a2, V.mul(r.err, 0.1)), [0, 0]), s3 = 3 * Math.sqrt(rv.reduce((a2, r) => a2 + V.len(V.sub(r.err, mv)) ** 2, 0) / rv.length);
    const fk = Math.max(1, m.top[0].mmpp / 0.015);   // 上相機像素越大，雜訊越大：門檻跟著放大
    ok(`實放驗證：同一穴位重放 10 次、每次重拍上相機四角，3σ < ${(10 * fk).toFixed(0)} µm 且四點殘差 < ${(5 * fk).toFixed(0)} µm（只有雜訊）`, s3 < 0.010 * fk && rv.every(r => r.cornerMax < 0.005 * fk), `3σ ${um(s3)}、平均 (${um(mv[0])}, ${um(mv[1])})；上相機 ${(m.top[0].mmpp * 1000).toFixed(1)} µm/px`);
    // 交界落差：相機4 鬆動只影響 7–12 欄，交界 6/7 欄出現落差 ≈ −δ
    const bs = CAL.boundaryStep(m, CAL.runProduction(m, mC, est, { px: 0, reps: 1 }));
    ok('交界落差：相機4 移動 → 1-6／2-6 與 1-7／2-7 之間出現落差 ≈ 相機移動量', bs && V.len(V.add(bs.step, V.rot(dc, m.plat[1].axisRot - m.tray.ang))) < 2e-4 && V.len(bs.left) < 2e-4, bs ? `落差 (${um(bs.step[0])}, ${um(bs.step[1])})，左側 ${um(V.len(bs.left))}` : '無');
    // 12. 長方形料：長邊沿 Y（轉 90°）、斜對角 Mark；治具 Mark 也斜放
    const base = CAL.loadParams();
    const PR = Object.assign({}, base, { part_len: 90, part_wid: 30, part_mark_dx: 80, part_mark_dy: 22, pocket_mark_dx: 80, pocket_mark_dy: 20, part_orient: 90, jig_mark_dx: 60, jig_mark_dy: 12, jig_wid: 22 });
    const mRc = CAL.defaultMachine(PR);
    ok('長方形料（長邊沿 Y）：穴位 Mark 向量轉到料盤座標', V.len(V.sub(mRc.tray.markV, [-10, 40])) < 1e-9 && V.len(V.sub(mRc.part.ext, [15, 45])) < 1e-9, `半 Mark 向量 (${mRc.tray.markV.map(v => v.toFixed(2)).join(', ')})、料盤上半外形 (${mRc.part.ext.map(v => v.toFixed(1)).join(', ')})`);
    const mRi = CAL.clone(mRc); mRi.hCal = mRi.hPlace; mRi.plat[0].tilt = [0.8, -0.5];
    const estRc = CAL.calibrateAll(mRi, { px: 0 });
    const prRc = CAL.runProduction(mRi, mRi, estRc, { px: 0, reps: 2, phiDeg: 2 });
    const mxR = Math.max(...prRc.map(r => V.len(r.err))), mxRa = Math.max(...prRc.map(r => Math.abs(r.angErr)));
    ok('長方形料＋斜對角 Mark：無誤差機台放料偏移 ≈ 0（Mark 連線的固定角度在 Δθ 中抵消）', mxR < 1e-6 && mxRa < 1e-9, `最大 ${um(mxR)}、角度 ${(mxRa * R2D * 3600).toExponential(2)}″`);
    const mRd = CAL.applyDrift(mRi, { rc: [shift, null] });
    const rR = CAL.placeOne(mRd, estRc, 0, { ci: 1, ri: 1 }, { qc: [0.3, 0.2], phi: 1.2 * D2R }, {}, N0);
    const exR = V.rot(V.sub(V.rot(e, rR.dth), e), -mRc.tray.ang);
    ok('長方形料：旋轉中心誤差公式一樣成立', V.len(V.sub(exR, rR.err)) < 2e-6, `模擬 (${um(rR.err[0])}, ${um(rR.err[1])})；公式 (${um(exR[0])}, ${um(exR[1])})`);
    const mRt = CAL.applyDrift(mRi, { trayScale: 200 });
    const pRB = CAL.runProduction(mRi, mRt, estRc, { px: 0, reps: 1, modeB: true }).filter(r => r.k === 0);
    const aRB = CAL.analyze(pRB.map(r => ({ x: r.pt[0], y: r.pt[1], dth: r.dth, dx: r.err[0], dy: r.err[1] })));
    ok('長方形料＋模式 B：料盤 +200 ppm → 回歸 X 比例 ≈ −200 ppm', aRB && Math.abs(aRB.scaleX * 1e6 + 200) < 5, aRB ? `X ${(aRB.scaleX * 1e6).toFixed(1)} ppm` : '無');
    const jl = estRc.link[0].check.diff;
    ok('斜放治具 Mark：上下連結第二點檢查 ≈ 0', V.len(jl) < 1e-6, `差 ${um(V.len(jl))}`);
    // 12b. 四角 Mark：上相機逐顆拍、四點擬合
    const rC = CAL.placeOne(mRi, estRc, 1, { ci: 4, ri: 0 }, { qc: [0.4, -0.3], phi: -0.9 * D2R }, {}, N0);
    ok('四角 Mark：上相機拍 4 次、四點擬合殘差 ≈ 0、量到的料角度 = 真值', rC.tops.length === 4 && rC.cornerMax < 1e-6 && Math.abs(rC.phiHat + 0.9 * D2R) < 1e-7, `殘差 ${um(rC.cornerMax)}、φ̂ ${(rC.phiHat * R2D).toFixed(5)}°（真值 −0.9°）`);
    const ex0 = CAL.placeOne(m, est, 0, { ci: 0, ri: 0 }, { qc: [0, 0], phi: 0 }, {}, N0);
    const cs = ex0.tops.map(t => t.S), spanX = Math.max(...cs.map(v => v[0])) - Math.min(...cs.map(v => v[0])), spanY = Math.max(...cs.map(v => v[1])) - Math.min(...cs.map(v => v[1]));
    ok('四角逐顆拍：平台在上相機下走出的範圍 = 四角 Mark 間距（含料的方向）', Math.abs(spanX - 2 * Math.max(...m.part.corners.map(c => c[0]))) < 1e-9 && Math.abs(spanY - 2 * Math.max(...m.part.corners.map(c => c[1]))) < 1e-9, `X ${spanX.toFixed(2)}、Y ${spanY.toFixed(2)} mm`);
    const Nn = CAL.noiseCtx({ px: 0.1, rep: 1, seed: 21 }), angs = [];
    for (let i = 0; i < 200; i++) angs.push(CAL.placeOne(m, est, 0, { ci: 1, ri: 0 }, { qc: [0, 0], phi: 0 }, {}, Nn).phiHat);
    const sdA = Math.sqrt(angs.reduce((a, x) => a + x * x, 0) / angs.length);
    const thA = Math.hypot(0.1 * m.top[0].mmpp, 0.001) / Math.hypot(m.P.part_mark_dx, m.P.part_mark_dy);
    ok('四角擬合角度精度（0.1 px＋1 µm 平台重複性，Monte-Carlo）接近理論 σ/√(Σr²)', sdA < thA * 1.6 && sdA > thA * 0.6, `模擬 ${(sdA * R2D * 3600).toFixed(2)}″；理論 ${(thA * R2D * 3600).toFixed(2)}″`);
    // 13. 舊版 CSV（只有 part_pitch、jig_pitch）仍可匯入
    const old = CAL.parseParamsCSV('part_pitch,產品,舊,55,mm,\njig_pitch,校正片,舊,50,mm,\n', base);
    ok('舊版 CSV 代碼 part_pitch／jig_pitch 自動對應到穴位／治具 Mark 間距', old.params.pocket_mark_dx === 55 && old.params.jig_mark_dx === 50 && old.params.part_mark_dx === base.part_mark_dx, `pocket_mark_dx=${old.params.pocket_mark_dx}、jig_mark_dx=${old.params.jig_mark_dx}`);
    return T;
  }
  G.selfTest = selfTest;
})(typeof window !== 'undefined' ? window : globalThis);
