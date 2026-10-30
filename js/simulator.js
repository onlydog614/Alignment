// 情境模擬：以「真實世界」（含各種偏差）產生影像量測，
// 再用目前設定（控制器以為的模型）計算修正，重複「拍照 → 計算 → 移動」直到通過或超過次數。
// 可做 Monte-Carlo：隨機初始擺放、雜訊、重複定位誤差，統計成功率與最終真實誤差。
(function (global) {
  'use strict';
  const VA = global.VA;

  function rng(seed) {
    // mulberry32
    let a = (seed >>> 0) || 1;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () => {
      let u = 0; while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    };
    return { next, gauss, uni: r => (next() * 2 - 1) * r };
  }

  // 每台相機的真實成像模型：以光軸（影像中心）為基準加入尺度與角度誤差
  function trueCameras(state, P) {
    return state.cameras.map(cam => {
      const m = VA.cameraAffine(cam);
      const center = VA.pixToWorld(m, cam.width / 2, cam.height / 2);
      const z = cam.optics ? VA.opticsSummary(cam.optics).zScale(+P.zErr || 0) : 1;
      const S = (1 + (+P.camScaleErr || 0) / 100) * z;
      const da = (+P.camAngleErr || 0) * VA.D2R;
      // 遠心鏡頭超出景深時影像變模糊，以雜訊放大近似
      let blur = 1;
      if (cam.optics && cam.optics.lens === 'telecentric' && +cam.optics.dof > 0) {
        const over = Math.abs(+P.zErr || 0) - cam.optics.dof / 2;
        if (over > 0) blur = 1 + 8 * over / cam.optics.dof;
      }
      return {
        cam, m, center, S, da, blur,
        // 真實世界座標 → 像素
        toPix(w) {
          const r = VA.rot(w.x - center.x, w.y - center.y, -da);
          return VA.worldToPix(m, center.x + r.x / S, center.y + r.y / S);
        },
        toWorld(u, v) {
          const w = VA.pixToWorld(m, u, v);
          const r = VA.rot(w.x - center.x, w.y - center.y, da);
          return { x: center.x + r.x * S, y: center.y + r.y * S };
        }
      };
    });
  }

  // 執行一次完整流程
  function runTrial(state, P, R, cams, opts = {}) {
    const lastStepOf = {};
    state.shots.forEach(s => { if (s.enabled) lastStepOf[s.mark] = Math.max(s.mark in lastStepOf ? lastStepOf[s.mark] : -1, +s.step); });
    // 各 mark 的「理想位置」：以最後一個步驟（通常是最高倍率）的目標像素在真實相機中的位置
    const nominal = {};
    state.shots.forEach(s => {
      if (!s.enabled || +s.step !== lastStepOf[s.mark] || nominal[s.mark]) return;
      const tc = cams[s.cam];
      nominal[s.mark] = VA.shotToStage(state, s, tc.toWorld(+s.tgt.u, +s.tgt.v));
    });
    const names = Object.keys(nominal);
    // 教導：用標準品（位於理想位置）在教導時的真實相機拍一次，登錄為各步驟的目標像素。
    // 校正誤差因此不會造成「目標本身不一致」，只影響修正量的大小；生產時的 Z 偏差則不在教導內。
    const work = VA.clone(state);
    if (P.teach !== false && opts.teachCams) {
      work.shots.forEach(s => {
        if (!s.enabled || +s.step === lastStepOf[s.mark] || !nominal[s.mark]) return;
        const px = opts.teachCams[s.cam].toPix(VA.stageToCamWorld(state, s, nominal[s.mark]));
        s.tgt = { u: px.u, v: px.v, ang: +s.tgt.ang };
      });
    }
    state = work;
    if (!names.length) return { ok: false, reason: '沒有啟用的拍照點', steps: [], trace: [] };
    const cen = names.reduce((a, n) => ({ x: a.x + nominal[n].x / names.length, y: a.y + nominal[n].y / names.length }), { x: 0, y: 0 });

    // 工件真實位置：伸縮 + 隨機擺放
    const k = 1 + ((+P.stretchPpm || 0) + R.gauss() * (+P.stretchSd || 0)) * 1e-6;
    const th0 = R.uni(+P.initT || 0) * VA.D2R, t0 = { x: R.uni(+P.initX || 0), y: R.uni(+P.initY || 0) };
    const marks = {};
    names.forEach(n => {
      const p = { x: cen.x + (nominal[n].x - cen.x) * k, y: cen.y + (nominal[n].y - cen.y) * k };
      marks[n] = VA.applyMove(p, th0, t0, cen);
    });

    const sim = VA.clone(state);
    sim.platform.pos = { x: 0, y: 0 };
    const truePos = { x: 0, y: 0 };
    const trueRc = () => {
      const rc = { x: +state.platform.rc.x + (+P.rcErrX || 0), y: +state.platform.rc.y + (+P.rcErrY || 0) };
      if (state.platform.preset === 'XYT') { rc.x += truePos.x; rc.y += truePos.y; }
      return rc;
    };
    const trace = [], steps = [];
    const trueErr = stepIdx => {
      let worst = 0;
      state.shots.forEach(s => {
        if (!s.enabled || +s.step !== stepIdx) return;
        const tc = cams[s.cam];
        const tgt = VA.shotToStage(state, s, tc.toWorld(+s.tgt.u, +s.tgt.v));
        worst = Math.max(worst, Math.hypot(marks[s.mark].x - tgt.x, marks[s.mark].y - tgt.y));
      });
      return worst;
    };

    for (let si = 0; si < state.steps.length; si++) {
      const step = state.steps[si];
      const stepShots = state.shots.map((s, i) => ({ s, i })).filter(({ s }) => s.enabled && +s.step === si);
      if (!stepShots.length) continue;
      let passed = false, iter = 0, last = null;
      for (; iter <= +step.maxIter; iter++) {
        // 拍照
        const cur = [];
        for (const { s, i } of stepShots) {
          const tc = cams[s.cam];
          const gErr = state.platform.gantry && state.platform.gantry.enabled
            ? { x: R.gauss() * (+P.gantryRepeatUm || 0) / 1000, y: R.gauss() * (+P.gantryRepeatUm || 0) / 1000 } : null;
          const w = VA.stageToCamWorld(state, s, marks[s.mark], gErr);
          const px = tc.toPix(w);
          const n = (+P.noisePx || 0) * tc.blur;
          const u = px.u + R.gauss() * n, v = px.v + R.gauss() * n;
          if (!(u >= 0 && v >= 0 && u <= tc.cam.width && v <= tc.cam.height)) {
            steps.push({ name: step.name, iters: iter, passed: false, fail: `${s.name} 不在視野內` });
            return { ok: false, reason: `${step.name}：mark 不在視野內`, steps, trace, finalTrueErr: trueErr(si) };
          }
          cur[i] = { u, v, ang: 0 };
        }
        // 計算（使用者模型）
        sim.activeStep = si;
        const r = VA.compute(sim, { step: si, cur });
        last = r;
        trace.push({ step: si, iter, seen: r.maxErr, truth: trueErr(si) });
        if (r.pass && iter >= (+step.minMoves || 0)) { passed = true; break; }
        if (iter === +step.maxIter || !r.move) break;
        // 移動（真實世界）
        const th = r.move.theta * (1 + (+P.thetaScaleErr || 0) / 100);
        const g = 1 + (+P.axisScaleErr || 0) / 100;
        const rep = (+P.axisRepeatUm || 0) / 1000;
        const T = { x: r.move.T.x * g + R.gauss() * rep, y: r.move.T.y * g + R.gauss() * rep };
        const rc = trueRc();
        names.forEach(n => { marks[n] = VA.applyMove(marks[n], th, T, rc); });
        truePos.x += T.x; truePos.y += T.y;
        sim.platform.pos.x = +sim.platform.pos.x + r.move.T.x;
        sim.platform.pos.y = +sim.platform.pos.y + r.move.T.y;
      }
      steps.push({ name: step.name, iters: iter, passed, seen: last ? last.maxErr : NaN, truth: trueErr(si) });
      if (!passed) return { ok: false, reason: `${step.name}：${step.maxIter} 次內未進公差`, steps, trace, finalTrueErr: trueErr(si) };
    }
    const lastStep = Math.max(...Object.values(lastStepOf));
    // 最後一步各 mark 的真實誤差向量（用於散佈圖）
    const finalVec = {};
    state.shots.forEach(s => {
      if (!s.enabled || +s.step !== lastStep) return;
      const tgt = VA.shotToStage(state, s, cams[s.cam].toWorld(+s.tgt.u, +s.tgt.v));
      finalVec[s.mark] = { x: marks[s.mark].x - tgt.x, y: marks[s.mark].y - tgt.y };
    });
    return { ok: true, steps, trace, finalTrueErr: trueErr(lastStep), finalVec };
  }

  function runScenario(state, P, opts = {}) {
    const R = rng(+P.seed || 1);
    const cams = trueCameras(state, P);
    opts = Object.assign({ teachCams: trueCameras(state, Object.assign({}, P, { zErr: 0 })) }, opts);
    const n = Math.max(1, Math.min(+P.trials || 1, opts.maxTrials || 5000));
    const trials = [];
    for (let t = 0; t < n; t++) trials.push(runTrial(state, P, R, cams, opts));
    const ok = trials.filter(t => t.ok);
    const reasons = {};
    trials.filter(t => !t.ok).forEach(t => { reasons[t.reason] = (reasons[t.reason] || 0) + 1; });
    const errs = ok.map(t => t.finalTrueErr).sort((a, b) => a - b);
    const q = p => (errs.length ? errs[Math.min(errs.length - 1, Math.floor(p * errs.length))] : NaN);
    const stepStats = state.steps.map((st, i) => {
      const its = trials.map(t => t.steps.find((x, j) => x.name === st.name)).filter(Boolean).map(x => x.iters);
      return { name: st.name, meanIter: its.length ? its.reduce((a, b) => a + b, 0) / its.length : NaN, maxIter: its.length ? Math.max(...its) : NaN };
    });
    return {
      n, okCount: ok.length, reasons, trials,
      err: { mean: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN, p50: q(0.5), p95: q(0.95), max: errs[errs.length - 1] },
      stepStats,
      camSummary: cams.map(c => ({ name: c.cam.name, S: c.S, blur: c.blur }))
    };
  }

  global.VA = Object.assign(global.VA || {}, { rng, trueCameras, runTrial, runScenario });
})(typeof window !== 'undefined' ? window : globalThis);
