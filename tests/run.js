// 執行：node tests/run.js
'use strict';
const path = require('path');
['geometry', 'platforms', 'optics', 'model', 'scenarios', 'simulator', 'diagnose', 'procedure']
  .forEach(f => { try { require(path.join(__dirname, '..', 'js', f + '.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } });
const VA = globalThis.VA;
let fails = 0, count = 0;
function ok(cond, msg) { count++; if (!cond) { fails++; console.log('FAIL', msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`); }
function test(name, fn) { try { fn(); } catch (e) { fails++; console.log('ERROR', name, e.stack); } }

test('rigid fit recovers known move', () => {
  const c = { x: 5, y: -3 }, th = 0.2 * VA.D2R, T = { x: 0.4, y: -0.25 };
  const Q = [{ x: -150, y: 0 }, { x: 150, y: 0 }, { x: 0, y: 120 }];
  const P = Q.map(q => { const r = VA.rot(q.x - c.x - T.x, q.y - c.y - T.y, -th); return { x: r.x + c.x, y: r.y + c.y }; });
  const f = VA.fitRigid(P.map((p, i) => ({ p, q: Q[i] })), c, 0);
  near(f.theta, th, 1e-12, 'theta'); near(f.T.x, T.x, 1e-10, 'Tx'); near(f.T.y, T.y, 1e-10, 'Ty');
  near(f.scale, 1, 1e-12, 'scale');
});

test('XXY axis = actuator point displacement', () => {
  const ax = VA.axisCommands(VA.PLATFORMS.XXY.axes, 0.01, { x: 0.1, y: 0.2 });
  // X1 at (0,100): R·a − a = (−100 sin, 100 cos − 100)
  near(ax[0].value, 0.1 - 100 * Math.sin(0.01), 1e-12, 'X1');
  near(ax[1].value, 0.1 + 100 * Math.sin(0.01), 1e-12, 'X2');
  near(ax[2].value, 0.2 + 100 * Math.sin(0.01), 1e-12, 'Y');
});

test('affine fit (9 point) exact + noise', () => {
  const m = { A: 0.0102, B: 0.0003, C: -12.5, D: 0.0002, E: -0.0099, F: 10.1 };
  const rows = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const u = 1224 + i * 800, v = 1024 + j * 700, w = VA.pixToWorld(m, u, v);
    rows.push({ u, v, x: w.x, y: w.y });
  }
  const f = VA.fitAffine(rows);
  ['A', 'B', 'C', 'D', 'E', 'F'].forEach(k => near(f.m[k], m[k], 1e-9, 'affine ' + k));
  ok(f.max < 1e-9, 'affine residual');
  rows[4].x += 0.05; // 一點錯誤
  const g = VA.fitAffine(rows);
  const worst = g.residuals.reduce((b, r, i) => (r.d > g.residuals[b].d ? i : b), 0);
  ok(worst === 4, 'outlier detected at the bad point');
});

test('circle fit recovers rotation center', () => {
  const c = { x: 12.3, y: -45.6 }, r = 80;
  const pts = [-3, -1.5, 0, 1.5, 3].map(d => ({ x: c.x + r * Math.cos((30 + d) * VA.D2R), y: c.y + r * Math.sin((30 + d) * VA.D2R) }));
  const f = VA.fitCircle(pts);
  near(f.cx, c.x, 1e-6, 'cx'); near(f.cy, c.y, 1e-6, 'cy'); near(f.r, r, 1e-6, 'r');
});

test('minimax <= lsq max residual on stretched marks', () => {
  const c = { x: 0, y: 0 };
  const Q = [{ x: -62.5, y: 62.5 }, { x: 62.5, y: 62.5 }, { x: 62.5, y: -62.5 }, { x: -62.5, y: -62.5 }, { x: 0, y: 70 }];
  const P = Q.map((q, i) => ({ x: q.x * 1.0003 + (i === 4 ? 0.02 : 0) + 0.1, y: q.y * 1.0003 - 0.05 }));
  const pairs = P.map((p, i) => ({ p, q: Q[i] }));
  const ls = VA.fitRigid(pairs, c, 0), mm = VA.fitRigidMinimax(pairs, c, 0);
  const mx = f => Math.max(...f.residuals.map(r => r.d));
  ok(mx(mm) <= mx(ls) + 1e-9, `minimax ${mx(mm)} <= lsq ${mx(ls)}`);
});

test('pixel <-> world round trip & optics', () => {
  const cam = { calMode: 'simple', width: 2448, height: 2048, simple: { mmppX: 0.01, mmppY: 0.012, angle: 30, flipX: false, flipY: true, ox: 10, oy: 20 } };
  const m = VA.cameraAffine(cam), w = VA.pixToWorld(m, 100, 200), p = VA.worldToPix(m, w.x, w.y);
  near(p.u, 100, 1e-9, 'u'); near(p.v, 200, 1e-9, 'v');
  near(VA.describeAffine(m).skew, 0, 1e-9, 'skew');
  if (VA.opticsSummary) {
    const t = VA.opticsSummary({ width: 2448, height: 2044, pixel: 3.45, lens: 'telecentric', mag: 3 });
    near(t.mmpp, 0.00115, 1e-12, 'telecentric mmpp');
    const e = VA.opticsSummary({ width: 2448, height: 2044, pixel: 3.45, lens: 'entocentric', f: 16, wd: 360 });
    near(e.mmpp, 0.00345 * 344 / 16, 1e-12, 'entocentric mmpp');
    near(e.zScale(1), 343 / 344, 1e-12, 'zScale');
  }
});

if (VA.compute) test('model: demo XXY move reverses offset', () => {
  const s = VA.SCENARIOS.xxy.make();
  const r = VA.compute(s);
  // 範例偏移 (0.3, −0.2, 0.15°) 的反運動
  near(r.move.theta, -0.15 * VA.D2R, 1e-6, 'theta');
  const inv = VA.rot(-0.3, 0.2, -0.15 * VA.D2R);
  near(r.move.T.x, inv.x, 2e-5, 'Tx'); near(r.move.T.y, inv.y, 2e-5, 'Ty');
});

if (VA.compute) test('model: FPC scenario both steps reverse same offset', () => {
  const s = VA.SCENARIOS.fpc.make();
  [0, 1].forEach(step => {
    const r = VA.compute(s, { step });
    near(r.move.theta, -0.3 * VA.D2R, 1e-6, `step${step} theta`);
    ok(r.used.length === 4, `step${step} uses 4 shots`);
    const back = VA.applyMove(r.used[0].cur, r.move.theta, r.move.T, r.rc);
    near(back.x, r.used[0].tgt.x, 2e-4, `step${step} lands x`);
  });
});

if (VA.runScenario) test('simulator: ideal world converges', () => {
  const s = VA.SCENARIOS.fpc.make();
  const P = Object.assign(VA.defaultScen(), { trials: 50, seed: 3, initX: 3, initY: 3, initT: 1, noisePx: 0.1, axisRepeatUm: 0.5, gantryRepeatUm: 0.5 });
  const res = VA.runScenario(s, P);
  ok(res.okCount === res.n, `ideal success ${res.okCount}/${res.n} ${JSON.stringify(res.reasons)}`);
  ok(res.err.max < 0.005, `ideal final err ${res.err.max}`);
});

if (VA.runScenario) test('simulator: rotation-center error slows convergence', () => {
  const s = VA.SCENARIOS.fpc.make();
  const base = Object.assign(VA.defaultScen(), { trials: 40, seed: 5, initT: 3, noisePx: 0.05 });
  const a = VA.runScenario(s, base), b = VA.runScenario(s, Object.assign({}, base, { rcErrX: 10, rcErrY: -5 }));
  const it = r => r.trials.reduce((t, x) => t + x.trace.length, 0) / r.n;
  ok(it(b) > it(a), `rc error more iterations ${it(b)} > ${it(a)}`);
});

if (VA.runScenario) test('simulator: FPC stretch makes fine step fail', () => {
  const s = VA.SCENARIOS.fpc.make();
  const res = VA.runScenario(s, Object.assign(VA.defaultScen(), { trials: 20, seed: 7, stretchPpm: 300 }));
  ok(res.okCount === 0, `stretch 300ppm should fail tol 5um: ${res.okCount}`);
});

if (VA.runScenario) test('simulator: telecentric ignores Z, coarse scale changes', () => {
  const s = VA.SCENARIOS.fpc.make();
  const cams = VA.trueCameras(s, Object.assign(VA.defaultScen(), { zErr: 2 }));
  ok(Math.abs(cams[0].S - 1) > 1e-3, 'coarse cam scale changes with Z');
  ok(cams[1].S === 1 && cams[1].blur > 1, 'fine cam no scale but blur');
});

if (VA.diagnose) test('diagnose: gain error detected', () => {
  const d = VA.diagnose([{ maxErr: 1, dx: 1, dy: 0.5, dt: 0 }, { maxErr: 0.2, dx: -0.2, dy: -0.1, dt: 0 }]);
  ok(d.some(x => /過衝|overshoot|比例/.test(x.text)), 'gain diagnosis: ' + JSON.stringify(d));
});

if (VA.diagnose) test('diagnose: rc error estimate', () => {
  // 指令旋轉 θ1 但實際旋轉中心偏 δ=(2,−1) → 下次平移 T2 = (−θδy, θδx)
  const th = 0.5, d = { x: 2, y: -1 }, t = th * VA.D2R;
  const d2 = VA.diagnose([{ maxErr: 1, dx: 0, dy: 0, dt: th }, { maxErr: 0.05, dx: -t * d.y, dy: t * d.x, dt: 0 }]);
  const rc = d2.find(x => x.rc);
  ok(rc && Math.abs(rc.rc.x - d.x) < 1e-6 && Math.abs(rc.rc.y - d.y) < 1e-6, 'rc estimate ' + JSON.stringify(d2));
});

if (VA.migrate) test('migrate v1 state', () => {
  const v1 = { version: 1, platform: { preset: 'XXY', rc: { x: 1, y: 2 }, axes: VA.PLATFORMS.XXY.axes }, fit: { gain: 90, tol: 0.02 },
    cameras: [{ name: 'A', enabled: true, width: 100, height: 100, calMode: 'simple', simple: { mmppX: 0.01, mmppY: 0.01, angle: 0, flipX: false, flipY: true, ox: 0, oy: 0 }, matrix: {}, cur: { u: 50, v: 50, ang: 0 }, tgt: { u: 51, v: 50, ang: 0 } }] };
  const s = VA.migrate(v1);
  ok(s.version === 2 && s.cameras.length === 1 && s.shots.length === 1 && s.steps[0].gain === 90 && s.platform.rc.x === 1, 'migrated');
  const r = VA.compute(s);
  near(r.maxErr, 0.01, 1e-12, 'migrated error');
});

if (VA.fitRotCenterKnown) test('known-angle rotation center', () => {
  const c = { x: 3, y: -2 }, p0 = { x: -60, y: 70 };
  const pts = [-3, -1.5, 0, 1.5, 3].map(a => Object.assign(VA.applyMove(p0, a * VA.D2R, { x: 0, y: 0 }, c), { th: a }));
  const f = VA.fitRotCenterKnown(pts);
  near(f.cx, c.x, 1e-8, 'cx'); near(f.cy, c.y, 1e-8, 'cy');
  // 預估不確定度與半徑無關，且遠小於幾何圓擬合
  const u = VA.rotCenterUncertainty([-3, -1.5, 0, 1.5, 3], 0.001);
  ok(u > 0.005 && u < 0.05, 'uncertainty ~ sigma/angle: ' + u);
  if (VA.circleUncertainty) ok(VA.circleUncertainty(90, [-3, -1.5, 0, 1.5, 3], 0.001) > 5 * u, 'circle fit much worse on short arc');
});

if (VA.buildProcedure) test('procedure for FPC scenario', () => {
  const s = VA.SCENARIOS.fpc.make();
  const r = VA.buildProcedure(s);
  const kinds = r.steps.map(x => x.kind);
  ok(kinds.join() === 'focus,nine,nine,rc,link,teach,verify', 'steps ' + kinds);
  ok(r.rc.method === 'follow' && r.rc.ok, 'rc via gantry follow and sufficient');
  s.proc.mounts = ['down', 'up'];
  ok(VA.buildProcedure(s).steps.some(x => x.fig.type === 'linkUpDown'), 'up/down link step');
});

console.log(`${count - fails}/${count} checks passed`);
process.exit(fails ? 1 : 0);
