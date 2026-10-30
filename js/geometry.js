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

  global.VA = Object.assign(global.VA || {}, {
    D2R, R2D, rot, cameraAffine, pixToWorld, worldToPix, describeAffine,
    fitRigid, applyMove, axisCommands, gauss
  });
})(typeof window !== 'undefined' ? window : globalThis);
