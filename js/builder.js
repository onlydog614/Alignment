// 由「圖形設定」的配置（工件、Mark 排列、各步驟使用的相機）自動產生拍照點（不依賴 DOM）
(function (global) {
  'use strict';
  const VA = global.VA;

  const PATTERNS = {
    '4corner': { label: '四角 4 點', n: 4 },
    '2diag': { label: '對角 2 點', n: 2 },
    '2side': { label: '左右 2 點', n: 2 },
    '3corner': { label: '三角 3 點', n: 3 },
    '1center': { label: '中心 1 點', n: 1 }
  };

  function defaultLayout() {
    return { stageW: 400, stageH: 250, work: { w: 310, h: 60, inset: 5, pattern: '2side', x: 0, y: 0 }, auto: true };
  }

  // 工件上的 Mark 位置（平台座標）
  function markPositions(layout) {
    const w = layout.work, hx = w.w / 2 - w.inset, hy = w.h / 2 - w.inset, cx = +w.x || 0, cy = +w.y || 0;
    const P = (name, x, y) => ({ name, x: cx + x, y: cy + y });
    switch (w.pattern) {
      case '2diag': return [P('M1', -hx, hy), P('M2', hx, -hy)];
      case '2side': return [P('M1', -hx, 0), P('M2', hx, 0)];
      case '3corner': return [P('M1', -hx, hy), P('M2', hx, hy), P('M3', hx, -hy)];
      case '1center': return [P('M1', 0, 0)];
      default: return [P('M1', -hx, hy), P('M2', hx, hy), P('M3', hx, -hy), P('M4', -hx, -hy)];
    }
  }

  // 各步驟使用的相機；舊資料沒有 cams 時由現有拍照點推斷
  function stepCams(state, si) {
    const st = state.steps[si];
    if (st && Array.isArray(st.cams) && st.cams.length) return st.cams.filter(i => i < state.cameras.length);
    const fromShots = [...new Set(state.shots.filter(s => +s.step === si).map(s => +s.cam))].filter(i => i < state.cameras.length);
    if (fromShots.length) return fromShots;
    return state.cameras.map((c, i) => i);
  }

  // 以線馬原點 (G = 0) 時，平台座標 p 在相機 ci 中的像素
  function pixAtZero(state, ci, p) {
    const cam = state.cameras[ci], m = VA.cameraAffine(cam);
    const w = VA.stageToCamWorld(state, { gx: 0, gy: 0 }, p);
    return VA.worldToPix(m, w.x, w.y);
  }
  function inView(state, ci, px, margin = 0.05) {
    const cam = state.cameras[ci];
    return px.u >= cam.width * margin && px.v >= cam.height * margin && px.u <= cam.width * (1 - margin) && px.v <= cam.height * (1 - margin);
  }

  function buildShots(state) {
    const layout = Object.assign(defaultLayout(), state.layout || {});
    const marks = markPositions(layout);
    const sign = VA.gantrySign(state);
    const shots = [], report = [];
    state.steps.forEach((st, si) => {
      const cams = stepCams(state, si);
      const rep = { step: si, name: st.name, cams, single: 0, gantry: 0, fail: [] };
      marks.forEach(mk => {
        // 優先找不用移動線馬就看得到的相機
        let ci = cams.find(c => inView(state, c, pixAtZero(state, c, mk)));
        let gx = 0, gy = 0, tgt;
        if (ci !== undefined) {
          const px = pixAtZero(state, ci, mk);
          tgt = { u: +px.u.toFixed(3), v: +px.v.toFixed(3), ang: 0 };
          rep.single++;
        } else if (sign !== 0 && cams.length) {
          // 線馬把 Mark 送到相機中心：stageToCamWorld 為 w = p − sign·G → G = (p − w中心) / sign
          ci = cams[0];
          const cam = state.cameras[ci], m = VA.cameraAffine(cam);
          const wc = VA.pixToWorld(m, cam.width / 2, cam.height / 2);
          gx = +((mk.x - wc.x) / sign).toFixed(4); gy = +((mk.y - wc.y) / sign).toFixed(4);
          tgt = { u: cam.width / 2, v: cam.height / 2, ang: 0 };
          rep.gantry++;
        } else {
          rep.fail.push(mk.name);
          return;
        }
        const name = state.steps.length > 1 ? `${String(st.name).slice(0, 1)}${mk.name}` : mk.name;
        shots.push({ name, mark: mk.name, enabled: true, cam: ci, step: si, gx, gy, cur: Object.assign({}, tgt), tgt });
      });
      report.push(rep);
    });
    return { shots, report, marks };
  }

  // 套用：取代目前的拍照點，並記下各步驟的相機
  function applyBuild(state) {
    const b = buildShots(state);
    state.steps.forEach((st, si) => { st.cams = stepCams(state, si); });
    if (b.shots.length) state.shots = b.shots;
    return b;
  }

  global.VA = Object.assign(global.VA || {}, { PATTERNS, defaultLayout, markPositions, stepCams, buildShots, applyBuild });
})(typeof window !== 'undefined' ? window : globalThis);
