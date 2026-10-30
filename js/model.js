// 資料模型與對位計算（不依賴 DOM）
// 相機（光學＋校正）與拍照點（shot：某相機在某線馬位置看到的某個 mark）分開，
// 所以「1 台相機看 4 個 mark」或「1 台高倍相機靠線馬移動去看 4 個 mark」都能描述。
(function (global) {
  'use strict';
  const VA = global.VA;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function newCamera(i) {
    // 預設依序擺在旋轉中心左、右、下、上、四角…，第 9 台起往外一圈
    const ANG = [180, 0, 270, 90, 225, 315, 135, 45];
    const ang = ANG[i % 8], r = 150 * (1 + Math.floor(i / 8));
    const ox = +(r * Math.cos(ang * VA.D2R)).toFixed(3);
    const oy = +(r * Math.sin(ang * VA.D2R)).toFixed(3);
    return {
      name: 'CAM' + (i + 1), width: 2448, height: 2048,
      calMode: 'simple',
      simple: { mmppX: 0.01, mmppY: 0.01, angle: 0, flipX: false, flipY: true, ox, oy },
      matrix: { A: 0.01, B: 0, C: ox - 12.24, D: 0, E: -0.01, F: oy + 10.24 },
      optics: { sensor: 'CUSTOM', width: 2448, height: 2048, pixel: 3.45, lens: 'entocentric', f: 16, wd: 300, mag: 1, dof: 1 }
    };
  }

  function newShot(i, cam, step = 0) {
    return {
      name: 'P' + (i + 1), mark: 'M' + (i + 1), enabled: true, cam, step, gx: 0, gy: 0,
      cur: { u: cam != null ? 1224 : 0, v: 1024, ang: 0 },
      tgt: { u: 1224, v: 1024, ang: 0 }
    };
  }

  function defaultState() {
    return {
      version: 2,
      platform: {
        preset: 'XXY', rc: { x: 0, y: 0 }, pos: { x: 0, y: 0 },
        axes: clone(VA.PLATFORMS.XXY.axes),
        gantry: { enabled: false, mode: 'stage' }
      },
      fit: { method: 'lsq' },
      steps: [{ name: '對位', tol: 0.01, maxIter: 5, gain: 100, minMoves: 0 }],
      activeStep: 0,
      cameras: [newCamera(0), newCamera(1)],
      shots: [newShot(0, 0), newShot(1, 1)],
      sim: { noisePx: 0, gainErr: 0, rcErrX: 0, rcErrY: 0 },
      scen: defaultScen(),
      proc: { mode: 'teach', zAxis: true, glass: true, maxCorrDeg: 1, noisePx: 0.15, gantryRepeatUm: 1, mounts: [] },
      history: []
    };
  }

  // 情境模擬的「真實世界」偏差參數
  function defaultScen() {
    return {
      trials: 200, seed: 1,
      initX: 2, initY: 2, initT: 0.5,
      stretchPpm: 0, stretchSd: 0,
      rcErrX: 0, rcErrY: 0,
      axisScaleErr: 0, thetaScaleErr: 0, axisRepeatUm: 1,
      gantryRepeatUm: 1,
      camScaleErr: 0, camAngleErr: 0,
      zErr: 0,
      noisePx: 0.1
    };
  }

  // 舊版（v1：每台相機內含量測值）→ v2
  function migrate(s) {
    if (!s) return null;
    if (s.version === 2) {
      const d = defaultState();
      const out = Object.assign(d, s);
      out.platform = Object.assign(d.platform, s.platform);
      out.scen = Object.assign(defaultScen(), s.scen);
      out.proc = Object.assign(d.proc, s.proc);
      out.cameras.forEach(c => { if (!c.optics) c.optics = newCamera(0).optics; });
      return out;
    }
    if (s.version !== 1 || !Array.isArray(s.cameras)) return null;
    const d = defaultState();
    d.platform = Object.assign(d.platform, s.platform);
    d.steps[0].tol = s.fit ? +s.fit.tol : 0.01;
    d.steps[0].gain = s.fit ? +s.fit.gain : 100;
    d.sim = Object.assign(d.sim, s.sim);
    d.cameras = s.cameras.map((c, i) => {
      const nc = newCamera(i);
      ['name', 'width', 'height', 'calMode', 'simple', 'matrix'].forEach(k => { if (c[k] !== undefined) nc[k] = c[k]; });
      return nc;
    });
    d.shots = s.cameras.map((c, i) => Object.assign(newShot(i, i), {
      name: c.name, mark: 'M' + (i + 1), enabled: c.enabled !== false, cur: c.cur, tgt: c.tgt
    }));
    return d;
  }

  function effectiveRc(state) {
    const p = state.platform;
    const rc = { x: +p.rc.x, y: +p.rc.y };
    // XYθ：θ 疊在 XY 上，旋轉中心跟著 XY 軸位置移動
    if (p.preset === 'XYT') { rc.x += +p.pos.x || 0; rc.y += +p.pos.y || 0; }
    return rc;
  }

  // 相機世界座標 → 平台座標（扣除線馬位移）
  function gantrySign(state) {
    const g = state.platform.gantry;
    if (!g || !g.enabled) return 0;
    return g.mode === 'camera' ? 1 : -1;
  }
  function shotToStage(state, shot, w) {
    const s = gantrySign(state);
    return { x: w.x + s * (+shot.gx || 0), y: w.y + s * (+shot.gy || 0) };
  }
  function stageToCamWorld(state, shot, p, gErr) {
    const s = gantrySign(state);
    const gx = (+shot.gx || 0) + (gErr ? gErr.x : 0), gy = (+shot.gy || 0) + (gErr ? gErr.y : 0);
    return { x: p.x - s * gx, y: p.y - s * gy };
  }

  // 對位計算
  // opts.step：只計算該步驟的拍照點（預設 state.activeStep）；opts.cur：覆寫各 shot 的目前像素
  function compute(state, opts = {}) {
    const stepIdx = opts.step != null ? opts.step : state.activeStep;
    const step = state.steps[stepIdx] || state.steps[0];
    const rc = effectiveRc(state);
    const camInfo = state.cameras.map(cam => {
      const m = VA.cameraAffine(cam);
      return { cam, m, info: VA.describeAffine(m) };
    });
    const shots = state.shots.map((shot, i) => {
      const ci = camInfo[shot.cam];
      const cur0 = opts.cur && opts.cur[i] ? opts.cur[i] : shot.cur;
      const inStep = +shot.step === stepIdx || state.steps.length <= 1;
      if (!ci) return { i, shot, inStep, invalid: true };
      const cur = shotToStage(state, shot, VA.pixToWorld(ci.m, +cur0.u, +cur0.v));
      const tgt = shotToStage(state, shot, VA.pixToWorld(ci.m, +shot.tgt.u, +shot.tgt.v));
      const err = { x: cur.x - tgt.x, y: cur.y - tgt.y };
      err.d = Math.hypot(err.x, err.y);
      const outside = [cur0, shot.tgt].some(p => +p.u < 0 || +p.v < 0 || +p.u > ci.cam.width || +p.v > ci.cam.height);
      return { i, shot, inStep, ci, curPix: cur0, cur, tgt, err, outside };
    });
    const used = shots.filter(s => !s.invalid && s.inStep && s.shot.enabled);
    const warnings = [];
    let fit = null;
    if (used.length === 0) {
      warnings.push('此步驟沒有啟用的拍照點。');
    } else {
      let fixedTheta = 0;
      if (used.length === 1) {
        const s = used[0];
        fixedTheta = ((+s.shot.tgt.ang) - (+s.curPix.ang || 0)) * VA.D2R;
        warnings.push('只有 1 個拍照點：旋轉量取自量測角度差，無法由多點驗證。');
      }
      const pairs = used.map(s => ({ p: s.cur, q: s.tgt }));
      fit = state.fit.method === 'minimax' ? VA.fitRigidMinimax(pairs, rc, fixedTheta) : VA.fitRigid(pairs, rc, fixedTheta);
      used.forEach((s, k) => { s.residual = fit.residuals[k]; });
    }
    const gain = (+step.gain) / 100;
    let move = null, axes = [];
    if (fit) {
      move = { theta: fit.theta * gain, T: { x: fit.T.x * gain, y: fit.T.y * gain } };
      axes = VA.axisCommands(state.platform.axes, move.theta, move.T);
      used.forEach(s => { s.pred = VA.applyMove(s.cur, move.theta, move.T, rc); });
      if (used.length >= 2 && Math.abs(fit.scale - 1) > 1e-4) {
        warnings.push(`標記間距比 ${fmt(fit.scale, 6)}（${fmt((fit.scale - 1) * 1e6, 0)} ppm）：工件伸縮、校正尺度錯誤、Z 高度改變（一般鏡頭）或量測到錯誤特徵。`);
      }
      const maxRes = Math.max(0, ...fit.residuals.map(r => r.d));
      if (maxRes > +step.tol) {
        warnings.push(`剛體擬合殘差 ${fmt(maxRes)} mm 已超過公差，即使完全照算出的量移動也無法同時對準所有標記。`);
      }
    }
    used.forEach(s => { if (s.outside) warnings.push(`${s.shot.name}：座標超出影像範圍。`); });
    const usedCams = [...new Set(used.map(s => +s.shot.cam))].map(i => camInfo[i]).filter(Boolean);
    usedCams.forEach(c => {
      if (Math.abs(c.info.skew) > 1) warnings.push(`${c.cam.name}：校正兩軸不正交（${fmt(c.info.skew, 2)}°），請檢查校正資料。`);
    });
    if (usedCams.length >= 2 && new Set(usedCams.map(c => c.info.handed)).size > 1) {
      warnings.push('各相機校正手性（行列式正負）不一致：若不是上下視混用，請確認 X/Y 反向設定。');
    }
    if (state.platform.axes.length === 0) warnings.push('尚未設定任何軸。');
    const maxErr = Math.max(0, ...used.map(s => s.err.d));
    return { stepIdx, step, rc, camInfo, shots, used, fit, move, axes, warnings, maxErr, pass: used.length > 0 && maxErr <= +step.tol };
  }

  function fmt(v, d = 4) { return Number.isFinite(v) ? v.toFixed(d) : '—'; }

  global.VA = Object.assign(global.VA || {}, {
    clone, newCamera, newShot, defaultState, defaultScen, migrate, effectiveRc,
    shotToStage, stageToCamWorld, gantrySign, compute, fmt
  });
})(typeof window !== 'undefined' ? window : globalThis);
