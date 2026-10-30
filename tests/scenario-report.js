// 產生 FPC 四 mark 情境的參數掃描報告：node tests/scenario-report.js > docs/simulation-data.md
'use strict';
const path = require('path');
['geometry', 'platforms', 'optics', 'model', 'scenarios', 'simulator', 'diagnose']
  .forEach(f => require(path.join(__dirname, '..', 'js', f + '.js')));
const VA = globalThis.VA;
const N = +process.argv[2] || 300;
const base = VA.SCENARIOS.fpc.make();
const tolFine = base.steps[1].tol;
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function row(state, P) {
  const r = VA.runScenario(state, Object.assign({}, P, { trials: N }));
  const over = r.trials.filter(t => t.ok && t.finalTrueErr > tolFine).length;
  const reason = Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0];
  return `| ${f(r.okCount / r.n * 100, 1)}% | ${f(r.err.p50 * 1000)} | ${f(r.err.p95 * 1000)} | ${f(r.err.max * 1000)} | ${r.stepStats.map(s => f(s.meanIter)).join(' / ')} | ${over} | ${reason ? `${reason[0]}（${reason[1]}）` : '—'} |`;
}
const head = v => `| ${v} | 成功率 | 真實誤差 P50 µm | P95 µm | 最大 µm | 平均移動次數 粗/精 | 通過但真實超公差 | 主要失敗原因 |\n|---|---|---|---|---|---|---|---|`;

const sweeps = [
  ['旋轉中心偏差 X (mm)', 'rcErrX', [0, 1, 2, 5, 10]],
  ['XY 比例誤差 (%)', 'axisScaleErr', [0, 1, 2, 5, 10]],
  ['θ 比例誤差 (%)', 'thetaScaleErr', [0, 1, 2, 5, 10]],
  ['Z 高度偏差 (mm)', 'zErr', [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1]],
  ['FPC 伸縮 (ppm)', 'stretchPpm', [0, 10, 20, 30, 50, 100]],
  ['量測雜訊 σ (px)', 'noisePx', [0.05, 0.15, 0.3, 0.5, 1]],
  ['校正尺度誤差 (%)', 'camScaleErr', [0, 0.5, 1, 2, 5]],
  ['校正角度誤差 (°)', 'camAngleErr', [0, 0.5, 1, 2, 5]],
  ['初始擺放 ±X/±Y (mm)', 'initX', [1, 3, 5, 8, 10, 15]],
  ['初始擺放 ±θ (°)', 'initT', [0.5, 1, 2, 3, 5]],
  ['XY 重複定位 σ (µm)', 'axisRepeatUm', [0, 0.5, 1, 2, 3]],
  ['線馬重複定位 σ (µm)', 'gantryRepeatUm', [0, 0.5, 1, 2, 3]]
];
const out = [`<!-- 由 tests/scenario-report.js 產生，每格 ${N} 次試驗 -->`, ''];
out.push('### 基準條件', '', head('條件'), `| 基準 |${row(base, base.scen).slice(1)}`, '');
for (const [label, key, vals] of sweeps) {
  out.push(`### ${label}`, '', head(label));
  vals.forEach(v => {
    const P = Object.assign({}, base.scen, { [key]: v });
    if (key === 'initX') P.initY = v;
    out.push(`| ${v} |${row(base, P).slice(1)}`);
  });
  out.push('');
}
// 最小平方 vs 最大誤差最小化（FPC 伸縮時）
out.push('### 擬合方法比較（FPC 伸縮）', '', head('伸縮 ppm / 方法'));
const mm = VA.clone(base); mm.fit.method = 'minimax';
[10, 20, 30].forEach(v => {
  const P = Object.assign({}, base.scen, { stretchPpm: v });
  out.push(`| ${v} / 最小平方 |${row(base, P).slice(1)}`);
  out.push(`| ${v} / 最大誤差最小化 |${row(mm, Object.assign({}, P, { trials: Math.min(N, 150) })).slice(1)}`);
});
out.push('');
// Z 偏差時把粗對位公差放寬
out.push('### Z 偏差 1 mm 時放寬粗對位公差', '', head('粗對位公差 (mm)'));
[0.2, 0.3, 0.5].forEach(t => {
  const s = VA.clone(base); s.steps[0].tol = t;
  out.push(`| ${t} |${row(s, Object.assign({}, base.scen, { zErr: 1 })).slice(1)}`);
});
out.push('');
// 綜合：較實際的現場誤差組合
out.push('### 綜合情境', '', head('情境'));
const real = Object.assign({}, base.scen, { rcErrX: 1, rcErrY: -0.5, axisScaleErr: 0.5, thetaScaleErr: 0.5, camScaleErr: 0.3, camAngleErr: 0.2, zErr: 0.05, stretchPpm: 10, stretchSd: 5, axisRepeatUm: 1, gantryRepeatUm: 1 });
out.push(`| 一般現場 |${row(base, real).slice(1)}`);
out.push(`| 一般現場＋伸縮 30 ppm |${row(base, Object.assign({}, real, { stretchPpm: 30 })).slice(1)}`);
out.push(`| 一般現場＋重複定位 2 µm |${row(base, Object.assign({}, real, { axisRepeatUm: 2, gantryRepeatUm: 2 })).slice(1)}`);
console.log(out.join('\n'));
