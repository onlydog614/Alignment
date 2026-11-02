// 範例情境
(function (global) {
  'use strict';
  const VA = global.VA;

  // 把 shot 的目前位置設成「工件相對目標有 (dx, dy, dθ) 偏移」時應看到的像素
  function offsetCurrent(state, dx, dy, dtDeg) {
    const rc = VA.effectiveRc(state);
    state.shots.forEach(shot => {
      const m = VA.cameraAffine(state.cameras[shot.cam]);
      const tgt = VA.shotToStage(state, shot, VA.pixToWorld(m, shot.tgt.u, shot.tgt.v));
      const p = VA.applyMove(tgt, dtDeg * VA.D2R, { x: dx, y: dy }, rc);
      const w = VA.stageToCamWorld(state, shot, p);
      const px = VA.worldToPix(m, w.x, w.y);
      shot.cur = { u: +px.u.toFixed(3), v: +px.v.toFixed(3), ang: +((+shot.tgt.ang) + dtDeg).toFixed(5) };
    });
    return state;
  }

  // 範例 1：雙相機 XXY 平台
  function demoXXY() {
    const s = VA.defaultState();
    s.sim = { noisePx: 0.3, gainErr: 0, rcErrX: 0, rcErrY: 0 };
    return offsetCurrent(s, 0.3, -0.2, 0.15);
  }

  // 範例 2：XYθ 平台＋XY 線馬＋Z 升降；FPC 135×135 mm 四角 mark
  //   CAM1：500 萬像素＋16 mm 鏡頭，一次拍到 4 個 mark（粗對位）
  //   CAM2：500 萬像素＋3 倍遠心鏡頭，由線馬把各 mark 送到視野中（精對位）
  function fpc4Mark() {
    const s = VA.defaultState();
    const sensor = VA.SENSORS['FH-5M'];
    s.platform = {
      preset: 'XYT', rc: { x: 0, y: 0 }, pos: { x: 0, y: 0 },
      axes: VA.clone(VA.PLATFORMS.XYT.axes),
      gantry: { enabled: true, mode: 'stage' }
    };
    s.steps = [
      { name: '粗對位', tol: 0.2, maxIter: 3, gain: 100, minMoves: 0 },
      { name: '精對位', tol: 0.005, maxIter: 5, gain: 100, minMoves: 1 }
    ];
    const mkCam = (name, optics, center) => {
      const c = VA.newCamera(0);
      c.name = name; c.width = sensor.width; c.height = sensor.height;
      c.optics = Object.assign({ sensor: 'FH-5M', width: sensor.width, height: sensor.height, pixel: sensor.pixel }, optics);
      const o = VA.opticsSummary(c.optics);
      c.simple = { mmppX: +o.mmpp.toFixed(7), mmppY: +o.mmpp.toFixed(7), angle: 0, flipX: false, flipY: true, ox: center.x, oy: center.y };
      return c;
    };
    // 粗對位相機在平台中心正上方（線馬原點）；精對位相機在 X+400 mm 工位
    const fineAt = { x: 400, y: 0 };
    s.cameras = [
      mkCam('粗-16mm', { lens: 'entocentric', f: 16, wd: 360, mag: 0, dof: 5 }, { x: 0, y: 0 }),
      mkCam('精-3x遠心', { lens: 'telecentric', f: 0, wd: 110, mag: 3, dof: 0.2 }, fineAt)
    ];
    const half = 135 / 2 - 5; // mark 距板邊 5 mm
    const marks = [
      { mark: 'M1', x: -half, y: half }, { mark: 'M2', x: half, y: half },
      { mark: 'M3', x: half, y: -half }, { mark: 'M4', x: -half, y: -half }
    ];
    const coarseM = VA.cameraAffine(s.cameras[0]);
    s.shots = [];
    marks.forEach(mk => {
      const px = VA.worldToPix(coarseM, mk.x, mk.y);
      s.shots.push({
        name: '粗' + mk.mark, mark: mk.mark, enabled: true, cam: 0, step: 0, gx: 0, gy: 0,
        cur: { u: 0, v: 0, ang: 0 }, tgt: { u: +px.u.toFixed(3), v: +px.v.toFixed(3), ang: 0 }
      });
    });
    marks.forEach(mk => {
      // 線馬把平台移動 G，使 mark 落在精對位相機中心：mark + G = fineAt
      s.shots.push({
        name: '精' + mk.mark, mark: mk.mark, enabled: true, cam: 1, step: 1,
        gx: fineAt.x - mk.x, gy: fineAt.y - mk.y,
        cur: { u: 0, v: 0, ang: 0 }, tgt: { u: sensor.width / 2, v: sensor.height / 2, ang: 0 }
      });
    });
    s.activeStep = 0;
    s.steps[0].cams = [0]; s.steps[1].cams = [1];
    s.layout = { stageW: 250, stageH: 250, work: { w: 135, h: 135, inset: 5, pattern: '4corner', x: 0, y: 0 }, auto: true };
    s.scen = Object.assign(VA.defaultScen(), { initX: 3, initY: 3, initT: 1, noisePx: 0.15 });
    s.sim = { noisePx: 0.15, gainErr: 0, rcErrX: 0, rcErrY: 0 };
    return offsetCurrent(s, 0.8, -0.5, 0.3);
  }

  const SCENARIOS = {
    xxy: { label: '雙相機 XXY 平台', make: demoXXY },
    fpc: { label: 'FPC 四 mark：XYθ＋線馬＋粗/精相機', make: fpc4Mark }
  };

  global.VA = Object.assign(global.VA || {}, { SCENARIOS, offsetCurrent });
})(typeof window !== 'undefined' ? window : globalThis);
