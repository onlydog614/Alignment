// 用法：node check-config.js [config.json | --scenario <xxy|fpc>]
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../../..');
['geometry', 'platforms', 'optics', 'model', 'builder', 'scenarios']
  .forEach(f => require(path.join(root, 'js', f + '.js')));
const VA = globalThis.VA;

const file = process.argv[2];
const state = file === '--scenario' ? VA.SCENARIOS[process.argv[3]].make()
  : file ? VA.migrate(JSON.parse(fs.readFileSync(file, 'utf8'))) : VA.defaultState();
const out = [];
const add = (lvl, what, msg) => out.push(`${lvl.padEnd(4)} ${what}: ${msg}`);
const f = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

state.cameras.forEach((cam, i) => {
  const name = cam.name || 'CAM' + (i + 1);
  const m = VA.cameraAffine(cam);
  const a = VA.describeAffine(m);
  add('INFO', name, `mm/px X=${f(a.sx, 5)} Y=${f(a.sy, 5)} 角度=${f(a.angle, 3)}° det=${a.det < 0 ? '<0' : '>0'}（${a.handed < 0 ? '一般下視' : '同手性/上視'}）`);
  const sk = Math.abs(a.skew);
  add(sk < 0.1 ? 'OK' : sk < 0.5 ? 'WARN' : 'FAIL', name, `正交偏差 ${f(sk, 3)}°`);
  const r = Math.abs(a.sx / a.sy - 1) * 100;
  add(r < 0.5 ? 'OK' : r < 1 ? 'INFO' : 'WARN', name, `X/Y 比例差 ${f(r, 2)}%`);
  if (cam.optics && VA.opticsSummary) {
    try {
      const mmpp = VA.opticsSummary(cam.optics).mmpp;
      if (mmpp) {
        const d = Math.abs(((a.sx + a.sy) / 2) / mmpp - 1) * 100;
        add(d < 3 ? 'OK' : 'WARN', name, `校正 vs 光學 mm/px 差 ${f(d, 1)}%（光學 ${f(mmpp, 5)}）`);
      }
    } catch (e) { /* 光學資料不完整時略過 */ }
  }
});

const noisePx = (state.scen && state.scen.noisePx) || 0.1;
const camMmpp = c => { const a = VA.describeAffine(VA.cameraAffine(c)); return (a.sx + a.sy) / 2; };
state.steps.forEach((st, si) => {
  const shots = state.shots.filter(s => s.enabled !== false && (s.step || 0) === si);
  const cams = [...new Set(shots.map(s => s.cam))].map(k => state.cameras[k]).filter(Boolean);
  if (cams.length) {
    // 該步驟所用相機中最粗的像素當量決定雜訊下限
    const floor = 3 * noisePx * Math.max(...cams.map(camMmpp));
    add(st.tol >= floor ? 'OK' : 'WARN', `步驟 ${st.name || si + 1}`, `公差 ${st.tol} mm vs 3×雜訊 ${f(floor, 4)} mm`);
  }
  add(shots.length >= 2 ? 'OK' : 'FAIL', `步驟 ${st.name || si + 1}`, `拍照點 ${shots.length} 個${shots.length < 2 ? '（無法求 θ）' : ''}`);
  shots.forEach(s => {
    const cam = state.cameras[s.cam];
    if (!cam) { add('FAIL', `拍照點 ${s.name}`, '相機不存在'); return; }
    ['cur', 'tgt'].forEach(k => {
      const p = s[k];
      if (p && (p.u < 0 || p.v < 0 || p.u > cam.width || p.v > cam.height)) add('WARN', `拍照點 ${s.name}`, `${k} 超出 ${cam.name} 視野`);
    });
  });
});

console.log(out.join('\n'));
const n = k => out.filter(l => l.startsWith(k)).length;
console.log(`\n合計：FAIL ${n('FAIL')}、WARN ${n('WARN')}、OK ${n('OK')}`);
