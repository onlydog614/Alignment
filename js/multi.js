// 多平台貼附：一片大基板（SPB）由多個平台分區貼附 Tile，各平台只看得到部分 Mark。
// 以基板座標為共同座標，估算每片 Tile 的貼附誤差（解析式＋Monte-Carlo 驗證）。（不依賴 DOM）
(function (global) {
  'use strict';
  const VA = global.VA;
  const D2R = Math.PI / 180;

  function defaultMulti() {
    return {
      k: 3, // 顯示倍數（1σ / 2σ / 3σ）
      substrate: { name: 'SPB', w: 1620, h: 283 },
      marks: [
        { name: 'A', x: 0, y: 0 },
        { name: 'B', x: 1620, y: 0 },
        { name: 'C', x: 1620, y: 283 }
      ],
      tiles: { rows: 2, cols: 12, pitchX: 135, pitchY: 144, w: 117, h: 139, x0: 67.5, y0: 69.5 },
      platforms: [
        { name: '左平台', cols: [1, 6], marks: ['A'], thetaSrc: 'mech', sigmaThMech: 0.01 / 3, ppm: 50 / 3, color: '#2a6fc9' },
        { name: '右平台', cols: [7, 12], marks: ['B', 'C'], thetaSrc: 'marks', sigmaThMech: 0.01 / 3, ppm: 50 / 3, color: '#d4612a' }
      ],
      // σ 類參數存 1σ；dT 為溫差的 3σ 值
      common: { sigmaMark: 0.005 / 3, dT: 1, cte: 10, sigmaTile: 0.021 / 3 },
      // 對位基準：global＝只用 SPB 整體 Mark；local＝每片 Tile 四邊 Mark 對 SPB 預放位置 Mark
      align: 'global',
      evalAt: 'center', // 誤差評估點：Tile 中心或最遠角落
      local: { nSite: 4, nTile: 4, inset: 0, sigmaTileMark: 0.005 / 3, sigmaPattern: 0.005 / 3, sigmaLink: 0.005 / 3, sigmaMove: 0.003 / 3 },
      link: { from: 0, to: 1, model: 'rigid', text: '', conv: '', dir: 'ab', truth: { dx: 0.35, dy: -0.12, thetaDeg: 0.008, ppm: 30 } }
    };
  }

  // 三種 Mark 配置（對應雙平台分析的現況與改善方案）
  const MULTI_PRESETS = {
    now: {
      label: '現況：左 A、右 B–C',
      apply: m => {
        m.marks = [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: m.substrate.w, y: 0 }, { name: 'C', x: m.substrate.w, y: m.substrate.h }];
        m.platforms[0].marks = ['A']; m.platforms[0].thetaSrc = 'mech';
        m.platforms[1].marks = ['B', 'C']; m.platforms[1].thetaSrc = 'marks';
      }
    },
    markD: {
      label: '左平台加 Mark D',
      apply: m => {
        m.marks = [{ name: 'A', x: 0, y: 0 }, { name: 'D', x: 0, y: m.substrate.h }, { name: 'B', x: m.substrate.w, y: 0 }, { name: 'C', x: m.substrate.w, y: m.substrate.h }];
        m.platforms[0].marks = ['A', 'D']; m.platforms[0].thetaSrc = 'marks';
        m.platforms[1].marks = ['B', 'C']; m.platforms[1].thetaSrc = 'marks';
      }
    },
    shared: {
      label: '交界加共用 Mark',
      apply: m => {
        const jx = m.substrate.w / 2;
        m.marks = [{ name: 'A', x: 0, y: 0 }, { name: 'S1', x: jx, y: 0 }, { name: 'S2', x: jx, y: m.substrate.h }, { name: 'B', x: m.substrate.w, y: 0 }, { name: 'C', x: m.substrate.w, y: m.substrate.h }];
        m.platforms[0].marks = ['A', 'S1', 'S2']; m.platforms[0].thetaSrc = 'marks';
        m.platforms[1].marks = ['S1', 'S2', 'B', 'C']; m.platforms[1].thetaSrc = 'marks';
      }
    }
  };

  function tileList(m) {
    const t = m.tiles, out = [];
    for (let r = 1; r <= t.rows; r++) {
      for (let c = 1; c <= t.cols; c++) {
        // 第 1 列在下（y 大），與原圖一致：row = rows 在 y0
        out.push({ name: `${r}-${c}`, r, c, x: t.x0 + t.pitchX * (c - 1), y: t.y0 + t.pitchY * (t.rows - r) });
      }
    }
    return out;
  }
  function platformOf(m, col) { return m.platforms.findIndex(p => col >= +p.cols[0] && col <= +p.cols[1]); }

  // 每個平台由看得到的 Mark 估基板姿態的不確定度（1σ）
  function platformFit(m, pi) {
    const p = m.platforms[pi], s = m.common.sigmaMark;
    const mk = m.marks.filter(x => p.marks.includes(x.name));
    const n = mk.length;
    if (!n) return { ok: false, n: 0, reason: '沒有看得到的 Mark' };
    const c = { x: mk.reduce((a, q) => a + q.x, 0) / n, y: mk.reduce((a, q) => a + q.y, 0) / n };
    const S = mk.reduce((a, q) => a + (q.x - c.x) ** 2 + (q.y - c.y) ** 2, 0);
    let sTh, src;
    if (n >= 2 && p.thetaSrc !== 'mech' && S > 1e-9) { sTh = s / Math.sqrt(S); src = 'marks'; }
    else { sTh = (+p.sigmaThMech || 0) * D2R; src = 'mech'; }
    // 基線長（最遠兩點距離）
    let base = 0;
    mk.forEach(a => mk.forEach(b => { base = Math.max(base, Math.hypot(a.x - b.x, a.y - b.y)); }));
    return { ok: true, n, c, S, sT: s / Math.sqrt(n), sTh, src, base, marks: mk };
  }

  // 每片 Tile 四邊（或左右兩邊、三邊）的 Mark 相對 Tile 中心的位置
  function sideOffsets(m, n) {
    const t = m.tiles, e = +(m.local && m.local.inset) || 0, hx = t.w / 2 + e, hy = t.h / 2 + e;
    const all = [{ x: -hx, y: 0 }, { x: hx, y: 0 }, { x: 0, y: -hy }, { x: 0, y: hy }];
    return n >= 4 ? all : n === 3 ? all.slice(0, 3) : all.slice(0, 2);
  }
  function evalOffsets(m) {
    const t = m.tiles;
    return m.evalAt === 'corner' ? [{ x: -t.w / 2, y: -t.h / 2 }, { x: t.w / 2, y: -t.h / 2 }, { x: t.w / 2, y: t.h / 2 }, { x: -t.w / 2, y: t.h / 2 }] : [{ x: 0, y: 0 }];
  }
  const rss = comp => Math.sqrt(Object.values(comp).reduce((a, v) => a + v * v, 0));

  // 局部對位：Tile 四邊 Mark ↔ SPB 預放位置 Mark，兩組各自的辨識誤差合成相對姿態誤差
  function localInfo(m) {
    const L = m.local, so = sideOffsets(m, +L.nSite), to = sideOffsets(m, +L.nTile);
    const S = arr => arr.reduce((a, q) => a + q.x * q.x + q.y * q.y, 0);
    return { nS: so.length, nT: to.length, Ss: S(so), St: S(to), so, to };
  }

  // 解析式：各 Tile 的誤差分量，皆為「位置誤差半徑」的 1σ（2D RMS）
  function analyze(m) {
    const fits = m.platforms.map((p, i) => platformFit(m, i));
    const local = m.align === 'local';
    const li = local ? localInfo(m) : null;
    const tiles = tileList(m).map(t => {
      const pi = platformOf(m, t.c);
      const f = fits[pi];
      if (pi < 0) return Object.assign(t, { pi, bad: true });
      let best = null;
      evalOffsets(m).forEach(o => {
        const q = { x: t.x + o.x, y: t.y + o.y };
        let comp, d;
        if (local) {
          const L = m.local, ss = +L.sigmaPattern || 0, sm = m.common.sigmaMark, st = +L.sigmaTileMark || 0;
          d = Math.hypot(o.x, o.y);
          // 平移：√(2/n)·σ；旋轉：d·σ/√S（以 Tile 中心為擬合中心）
          const part = (sg, n, S) => sg * Math.sqrt(2 / n + d * d / S);
          comp = {
            'SPB 預放 Mark 辨識': part(sm, li.nS, li.Ss),
            'SPB Mark 圖形精度': part(ss, li.nS, li.Ss),
            'Tile Mark 辨識': part(st, li.nT, li.St),
            '相機連結（B_off）': (+L.sigmaLink || 0) * Math.SQRT2,
            '移動定位': (+L.sigmaMove || 0) * Math.SQRT2,
            'Tile 貼附': (+m.common.sigmaTile || 0) * Math.SQRT2
          };
        } else {
          if (!f || !f.ok) return;
          const p = m.platforms[pi];
          d = Math.hypot(q.x - f.c.x, q.y - f.c.y);
          comp = {
            'Mark 辨識': f.sT * Math.SQRT2,
            'θ（角度）': d * f.sTh,
            '軸比例': d * (+p.ppm || 0) * 1e-6,
            '熱脹冷縮': d * (+m.common.cte || 0) * (+m.common.dT || 0) / 3 * 1e-6,
            'Tile 貼附': (+m.common.sigmaTile || 0) * Math.SQRT2
          };
        }
        const tot = rss(comp);
        if (!best || tot > best.tot) best = { comp, tot, d, at: q };
      });
      if (!best) return Object.assign(t, { pi, bad: true });
      return Object.assign(t, { pi }, best);
    });
    // 交界：相鄰欄屬於不同平台的同列 Tile
    const joins = [];
    tiles.forEach(a => {
      const b = tiles.find(x => x.r === a.r && x.c === a.c + 1);
      if (b && a.pi !== b.pi && !a.bad && !b.bad) joins.push({ a, b, tot: Math.hypot(a.tot, b.tot) });
    });
    return { fits, tiles, joins, local, li };
  }

  // Monte-Carlo：Mark 量測加雜訊 → 各平台擬合（剛體；1 點時 θ 取機構誤差）→ 實際貼附位置誤差
  function monteCarlo(m, trials = 2000, seed = 1) {
    if (m.align === 'local') return monteCarloLocal(m, trials, seed);
    const R = VA.rng(seed);
    const tiles = tileList(m);
    const acc = tiles.map(() => ({ sx: 0, sy: 0 }));
    for (let t = 0; t < trials; t++) {
      // 基板真實的熱膨脹（相對各平台擬合中心）與每片貼附誤差
      const fits = m.platforms.map((p, pi) => {
        const mk = m.marks.filter(x => p.marks.includes(x.name));
        if (!mk.length) return null;
        const meas = mk.map(q => ({ p: { x: q.x + R.gauss() * m.common.sigmaMark, y: q.y + R.gauss() * m.common.sigmaMark }, q }));
        // 以量到的 Mark 擬合「名目 → 量測」的剛體（量測值當作 Mark 實際所在）
        let th, T, c;
        if (mk.length >= 2 && p.thetaSrc !== 'mech') {
          const f = VA.fitRigid(meas.map(x => ({ p: x.q, q: x.p })), { x: 0, y: 0 }, 0);
          th = f.theta; T = f.T; c = { x: 0, y: 0 };
        } else {
          // 只用平移：量測 Mark 的平均位置，θ 取機構誤差
          th = R.gauss() * (+p.sigmaThMech || 0) * D2R;
          c = { x: mk.reduce((a, q) => a + q.x, 0) / mk.length, y: mk.reduce((a, q) => a + q.y, 0) / mk.length };
          T = { x: meas.reduce((a, q) => a + q.p.x, 0) / mk.length - c.x, y: meas.reduce((a, q) => a + q.p.y, 0) / mk.length - c.y };
        }
        const n = mk.length, cen = { x: mk.reduce((a, q) => a + q.x, 0) / n, y: mk.reduce((a, q) => a + q.y, 0) / n };
        const scale = ((+p.ppm || 0) * R.gauss() + (+m.common.cte || 0) * (+m.common.dT || 0) / 3 * R.gauss()) * 1e-6;
        return { th, T, c, cen, scale };
      });
      tiles.forEach((tl, i) => {
        const pi = platformOf(m, tl.c), f = fits[pi];
        if (!f) return;
        // 估計位置（以擬合姿態算出的貼附點），真實 Tile 位置 = 名目（基板不動）
        const est = VA.applyMove(tl, f.th, f.T, f.c);
        // 比例與熱：以平台擬合中心為基準放大
        const ex = est.x + (tl.x - f.cen.x) * f.scale + R.gauss() * m.common.sigmaTile - tl.x;
        const ey = est.y + (tl.y - f.cen.y) * f.scale + R.gauss() * m.common.sigmaTile - tl.y;
        acc[i].sx += ex * ex; acc[i].sy += ey * ey;
      });
    }
    return tiles.map((tl, i) => Object.assign({}, tl, { rmsX: Math.sqrt(acc[i].sx / trials), rmsY: Math.sqrt(acc[i].sy / trials) }));
  }

  // 局部對位的 Monte-Carlo：每片分別量 SPB 預放 Mark 與 Tile Mark，擬合相對剛體後放置
  function monteCarloLocal(m, trials, seed) {
    const R = VA.rng(seed), L = m.local, li = localInfo(m);
    const tiles = tileList(m), evs = evalOffsets(m);
    const acc = tiles.map(() => evs.map(() => 0));
    const g = s => R.gauss() * s;
    for (let t = 0; t < trials; t++) {
      tiles.forEach((tl, i) => {
        // SPB 預放 Mark：實際位置（圖形誤差）＋辨識誤差；以 Tile 中心為原點
        const site = li.so.map(o => ({ q: o, p: { x: o.x + g(L.sigmaPattern) + g(m.common.sigmaMark), y: o.y + g(L.sigmaPattern) + g(m.common.sigmaMark) } }));
        const tm = li.to.map(o => ({ q: o, p: { x: o.x + g(L.sigmaTileMark), y: o.y + g(L.sigmaTileMark) } }));
        // 量到的 SPB 預放位置姿態、量到的 Tile 姿態（名目 → 量測）
        const fs = VA.fitRigid(site.map(x => ({ p: x.q, q: x.p })), { x: 0, y: 0 }, 0);
        const ft = VA.fitRigid(tm.map(x => ({ p: x.q, q: x.p })), { x: 0, y: 0 }, 0);
        // 放置後誤差 = (量到的 Tile 偏差 − 量到的預放偏差) 的反向殘留，再加連結、移動與貼附
        const extra = { x: g(L.sigmaLink) + g(L.sigmaMove) + g(m.common.sigmaTile), y: g(L.sigmaLink) + g(L.sigmaMove) + g(m.common.sigmaTile) };
        evs.forEach((o, k) => {
          const a = VA.applyMove(o, fs.theta, fs.T, { x: 0, y: 0 }), b = VA.applyMove(o, ft.theta, ft.T, { x: 0, y: 0 });
          const dx = a.x - b.x + extra.x, dy = a.y - b.y + extra.y;
          acc[i][k] += dx * dx + dy * dy;
        });
      });
    }
    return tiles.map((tl, i) => {
      const worst = Math.max(...acc[i].map(v => Math.sqrt(v / trials)));
      return Object.assign({}, tl, { rmsX: worst / Math.SQRT2, rmsY: worst / Math.SQRT2 });
    });
  }

  // ---------- 兩平台座標轉換（實測共同點） ----------
  // rows：[{ name, a:{x,y}, b:{x,y} }]，a 為「來源平台」座標、b 為「目標平台」座標
  // model：'rigid'（平移＋旋轉）、'similarity'（＋等比例）、'affine'（＋X/Y 比例差與直角度）
  const LINK_K = { rigid: 3, similarity: 4, affine: 6 };
  const LINK_MIN = { rigid: 2, similarity: 2, affine: 3 };

  function fitLink(rows, model) {
    const n = rows.length, k = LINK_K[model] || 3;
    if (n < (LINK_MIN[model] || 2)) return { ok: false, reason: `${model === 'affine' ? '仿射' : '此模型'}至少需要 ${LINK_MIN[model]} 個共同點` };
    const ca = { x: rows.reduce((a, r) => a + r.a.x, 0) / n, y: rows.reduce((a, r) => a + r.a.y, 0) / n };
    const cb = { x: rows.reduce((a, r) => a + r.b.x, 0) / n, y: rows.reduce((a, r) => a + r.b.y, 0) / n };
    const S = rows.reduce((a, r) => a + (r.a.x - ca.x) ** 2 + (r.a.y - ca.y) ** 2, 0);
    let m;
    if (model === 'affine') {
      const f = VA.fitAffine(rows.map(r => ({ u: r.a.x, v: r.a.y, x: r.b.x, y: r.b.y })));
      if (!f) return { ok: false, reason: '共同點共線，無法求仿射（請加一個不在同一直線上的點）' };
      m = f.m;
    } else {
      let sd = 0, sc = 0;
      rows.forEach(r => {
        const px = r.a.x - ca.x, py = r.a.y - ca.y, qx = r.b.x - cb.x, qy = r.b.y - cb.y;
        sd += px * qx + py * qy; sc += px * qy - py * qx;
      });
      if (S < 1e-12) return { ok: false, reason: '共同點重合，無法求旋轉' };
      const th = Math.atan2(sc, sd);
      const sca = model === 'similarity' ? Math.hypot(sd, sc) / S : 1;
      const c = Math.cos(th) * sca, si = Math.sin(th) * sca;
      m = { A: c, B: -si, D: si, E: c, C: 0, F: 0 };
      m.C = cb.x - (m.A * ca.x + m.B * ca.y); m.F = cb.y - (m.D * ca.x + m.E * ca.y);
    }
    const fwd = p => VA.pixToWorld(m, p.x, p.y);
    const inv = q => { const r = VA.worldToPix(m, q.x, q.y); return { x: r.u, y: r.v }; };
    const residuals = rows.map(r => { const q = fwd(r.a), dx = r.b.x - q.x, dy = r.b.y - q.y; return { name: r.name, x: dx, y: dy, d: Math.hypot(dx, dy) }; });
    const dof = 2 * n - k;
    const ss = residuals.reduce((a, r) => a + r.x * r.x + r.y * r.y, 0);
    const sigma = dof > 0 ? Math.sqrt(ss / dof) : NaN; // 單軸 1σ
    const info = VA.describeAffine(m);
    // 轉換後某點的不確定度（位置半徑 1σ）
    let sdAt;
    if (model === 'affine') {
      const mu = ca.x, mv = ca.y, Z = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      rows.forEach(r => { const z = [r.a.x - mu, r.a.y - mv, 1]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Z[i][j] += z[i] * z[j]; });
      const Zi = [0, 1, 2].map(c => VA.solveN(Z, [0, 1, 2].map(i => (i === c ? 1 : 0))));
      sdAt = p => {
        const z = [p.x - mu, p.y - mv, 1];
        let v = 0;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) v += z[i] * Zi[j][i] * z[j];
        return sigma * Math.sqrt(2 * Math.max(v, 0));
      };
    } else {
      const extra = model === 'similarity' ? 2 : 1; // 旋轉（＋比例）
      sdAt = p => sigma * Math.sqrt(2 / n + extra * ((p.x - ca.x) ** 2 + (p.y - ca.y) ** 2) / S);
    }
    return {
      ok: true, model, n, dof, m, fwd, inv, residuals, sigma, sdAt, ca, S,
      theta: info.angle, scaleX: info.sx, scaleY: info.sy, skew: info.skew,
      // 原點（來源座標 0,0）的平移量
      T: { x: m.C, y: m.F },
      sdTheta: sigma / Math.sqrt(S) * 180 / Math.PI,
      sdScalePpm: model === 'rigid' ? NaN : sigma / Math.sqrt(S) * 1e6,
      maxRes: Math.max(...residuals.map(r => r.d))
    };
  }

  function parseLinkRows(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const parts = t.split(/[\s,;]+/);
      let name = 'P' + (out.length + 1);
      if (isNaN(+parts[0])) name = parts.shift();
      const v = parts.slice(0, 4).map(Number);
      if (v.length === 4 && v.every(Number.isFinite)) out.push({ name, a: { x: v[0], y: v[1] }, b: { x: v[2], y: v[3] } });
    });
    return out;
  }

  // 模擬資料：在交界附近取共同點，加入已知轉換與量測雜訊
  function simulateLink(m, truth, R) {
    const fromP = m.platforms[truth.from] || m.platforms[0], toP = m.platforms[truth.to] || m.platforms[1];
    const shared = m.marks.filter(mk => fromP.marks.includes(mk.name) && toP.marks.includes(mk.name));
    let pts = shared.map(mk => ({ name: mk.name, x: mk.x, y: mk.y }));
    if (pts.length < 4) {
      const t = m.tiles, jx = t.x0 + t.pitchX * (+fromP.cols[1] - 1) + t.pitchX / 2; // 兩平台交界
      const h = m.substrate.h;
      pts = pts.concat([[-60, 0.15], [60, 0.15], [-60, 0.85], [60, 0.85]].map(([dx, fy], i) => ({ name: 'R' + (i + 1), x: +(jx + dx).toFixed(3), y: +(h * fy).toFixed(3) })))
        .slice(0, Math.max(4, shared.length));
    }
    const th = truth.thetaDeg * D2R, sc = 1 + truth.ppm * 1e-6;
    const s = m.common.sigmaMark;
    return pts.map(p => {
      const ax = p.x + R.gauss() * s, ay = p.y + R.gauss() * s;
      const bx = sc * (Math.cos(th) * p.x - Math.sin(th) * p.y) + truth.dx + R.gauss() * s;
      const by = sc * (Math.sin(th) * p.x + Math.cos(th) * p.y) + truth.dy + R.gauss() * s;
      return `${p.name}\t${ax.toFixed(6)}\t${ay.toFixed(6)}\t${bx.toFixed(6)}\t${by.toFixed(6)}`;
    }).join('\n');
  }

  global.VA = Object.assign(global.VA || {}, { defaultMulti, MULTI_PRESETS, multiTiles: tileList, multiPlatformOf: platformOf, multiAnalyze: analyze, multiMonteCarlo: monteCarlo, multiSideOffsets: sideOffsets, fitLink, parseLinkRows, simulateLink });
})(typeof window !== 'undefined' ? window : globalThis);
