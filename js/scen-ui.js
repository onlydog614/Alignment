// 「情境模擬」頁
(function () {
  'use strict';
  const VA = window.VA, App = window.App;
  const $ = id => document.getElementById(id);
  const fmt = VA.fmt;
  const MARK_COLORS = ['#e11d48', '#0891b2', '#ca8a04', '#7c3aed', '#059669', '#ea580c', '#2563eb', '#db2777'];
  let last = null;

  const SWEEPS = {
    rcErrX: { label: '旋轉中心偏差 X (mm)', values: [0, 0.5, 1, 2, 5] },
    axisScaleErr: { label: 'XY 比例誤差 (%)', values: [0, 0.5, 1, 2, 5] },
    thetaScaleErr: { label: 'θ 比例誤差 (%)', values: [0, 0.5, 1, 2, 5] },
    zErr: { label: 'Z 高度偏差 (mm)', values: [0, 0.1, 0.2, 0.5, 1] },
    stretchPpm: { label: '工件伸縮 (ppm)', values: [0, 10, 20, 50, 100] },
    noisePx: { label: '量測雜訊 σ (px)', values: [0.05, 0.1, 0.2, 0.5, 1] },
    camScaleErr: { label: '校正尺度誤差 (%)', values: [0, 0.2, 0.5, 1, 2] },
    camAngleErr: { label: '校正角度誤差 (°)', values: [0, 0.1, 0.3, 1, 2] },
    initX: { label: '初始擺放 ±X (mm)', values: [1, 3, 5, 10, 15] },
    initT: { label: '初始擺放 ±θ (°)', values: [0.5, 1, 2, 3, 5] },
    axisRepeatUm: { label: 'XY 重複定位 σ (µm)', values: [0, 1, 2, 5, 10] },
    gantryRepeatUm: { label: '線馬重複定位 σ (µm)', values: [0, 1, 2, 5, 10] }
  };
  const sel = $('sweepParam');
  for (const [k, v] of Object.entries(SWEEPS)) sel.add(new Option(v.label, k));

  function lastTol() {
    const s = App.state;
    const steps = [...new Set(s.shots.filter(x => x.enabled).map(x => +x.step))];
    return +s.steps[Math.max(...steps)].tol;
  }

  function trialCap() { return App.state.fit.method === 'minimax' ? 500 : 5000; }

  function run() {
    const btn = $('scenRun');
    btn.disabled = true; btn.textContent = '計算中…';
    setTimeout(() => {
      const t0 = performance.now();
      try {
        last = VA.runScenario(App.state, App.state.scen, { maxTrials: trialCap() });
        last.ms = performance.now() - t0;
        renderSummary();
        drawTrace(); drawScatter();
      } catch (e) {
        $('scenSummary').innerHTML = `<p class="warnings">模擬失敗：${App.esc(e.message)}</p>`;
      }
      btn.disabled = false; btn.textContent = '執行模擬';
    }, 20);
  }

  function renderSummary() {
    const r = last, tol = lastTol();
    const trueOver = r.trials.filter(t => t.ok && t.finalTrueErr > tol).length;
    const rate = r.okCount / r.n;
    const reasons = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]);
    const camLines = r.camSummary.map(c => `${App.esc(c.name)}：真實尺度 ×${fmt(c.S, 6)}${c.blur > 1 ? `、超出景深雜訊 ×${fmt(c.blur, 2)}` : ''}`);
    $('scenSummary').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v" style="color:${rate >= 0.999 ? 'var(--ok)' : 'var(--ng)'}">${fmt(rate * 100, 1)}%</div><div class="k">成功率（${r.okCount}/${r.n}）</div></div>
        <div class="stat"><div class="v">${fmt(r.err.p50 * 1000, 2)}</div><div class="k">最終真實誤差中位數 µm</div></div>
        <div class="stat"><div class="v">${fmt(r.err.p95 * 1000, 2)}</div><div class="k">P95 µm</div></div>
        <div class="stat"><div class="v">${fmt(r.err.max * 1000, 2)}</div><div class="k">最大 µm（公差 ${fmt(tol * 1000, 1)}）</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>步驟</th><th>平均移動次數</th><th>最多</th></tr></thead><tbody>
        ${r.stepStats.map(s => `<tr><td>${App.esc(s.name)}</td><td>${fmt(s.meanIter, 2)}</td><td>${Number.isFinite(s.maxIter) ? s.maxIter : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      ${reasons.length ? `<h3>失敗原因</h3><ul class="warnings">${reasons.map(([k, v]) => `<li>${App.esc(k)}：${v} 次</li>`).join('')}</ul>` : ''}
      ${trueOver ? `<p class="warnings">有 ${trueOver} 次「視覺判定通過」但真實誤差超過公差：量測雜訊、線馬重複定位或校正誤差使視覺看不到真正的誤差。</p>` : ''}
      <p class="hint">${camLines.join('；')}。耗時 ${fmt(r.ms, 0)} ms。</p>`;
  }

  // ---------- 收斂圖 ----------
  let traceGeom = null;
  function drawTrace() {
    const cv = $('scenTrace');
    if (!cv.clientWidth) return;
    const { c, w, h } = App.prepCanvas(cv);
    if (!last) { c.fillStyle = App.css('--muted'); c.font = '12px system-ui'; c.fillText('按「執行模擬」', 10, 20); return; }
    const trials = last.trials.slice(0, 60);
    const maxN = Math.max(2, ...trials.map(t => t.trace.length));
    const vals = trials.flatMap(t => t.trace.flatMap(p => [p.seen, p.truth])).filter(v => v > 0);
    const tols = App.state.steps.map(s => +s.tol);
    let lo = Math.log10(Math.max(1e-6, Math.min(...vals, ...tols))), hi = Math.log10(Math.max(...vals, ...tols));
    lo = Math.floor(lo); hi = Math.ceil(hi);
    const pad = { l: 52, r: 10, t: 10, b: 26 };
    const X = i => pad.l + (w - pad.l - pad.r) * i / (maxN - 1);
    const Y = v => pad.t + (h - pad.t - pad.b) * (hi - Math.log10(Math.max(v, 1e-9))) / (hi - lo);
    traceGeom = { X, Y, maxN, pad, w, h };
    c.font = '11px system-ui'; c.fillStyle = App.css('--muted'); c.strokeStyle = App.css('--grid'); c.lineWidth = 1;
    for (let e = lo; e <= hi; e++) {
      const y = Y(Math.pow(10, e));
      c.beginPath(); c.moveTo(pad.l, y); c.lineTo(w - pad.r, y); c.stroke();
      const v = Math.pow(10, e);
      c.fillText(v >= 1 ? `${v} mm` : v >= 1e-3 ? `${+(v * 1000).toPrecision(3)} µm` : `${+(v * 1e6).toPrecision(3)} nm`, 4, y + 4);
    }
    for (let i = 0; i < maxN; i++) c.fillText(i + 1, X(i) - 3, h - 8);
    c.fillText('拍照次數', w - pad.r - 50, h - 8);
    c.setLineDash([5, 4]); c.strokeStyle = App.css('--muted');
    App.state.steps.forEach(s => { const y = Y(+s.tol); c.beginPath(); c.moveTo(pad.l, y); c.lineTo(w - pad.r, y); c.stroke(); c.fillText(`${s.name} 公差`, w - pad.r - 90, y - 3); });
    c.setLineDash([]);
    const line = (t, key, color) => {
      c.strokeStyle = color; c.globalAlpha = 0.35; c.lineWidth = 1.5; c.beginPath();
      t.trace.forEach((p, i) => (i ? c.lineTo(X(i), Y(p[key])) : c.moveTo(X(i), Y(p[key]))));
      c.stroke(); c.globalAlpha = 1;
    };
    trials.forEach(t => { line(t, 'truth', App.css('--cur')); line(t, 'seen', App.css('--pred')); });
  }

  // ---------- 散佈圖 ----------
  let scatterPts = [];
  function drawScatter() {
    const cv = $('scenScatter');
    if (!cv.clientWidth) return;
    const { c, w, h } = App.prepCanvas(cv);
    scatterPts = [];
    if (!last) return;
    const marks = [...new Set(last.trials.filter(t => t.ok).flatMap(t => Object.keys(t.finalVec)))];
    $('scatterLegend').innerHTML = marks.map((m, i) => `<span><i class="dot" style="background:${MARK_COLORS[i % 8]}"></i>${App.esc(m)}</span>`).join('') +
      '<span class="hint">虛線圓 = 最後步驟公差</span>';
    const tol = lastTol() * 1000;
    let R = tol;
    last.trials.forEach(t => t.ok && Object.values(t.finalVec).forEach(v => { R = Math.max(R, Math.abs(v.x) * 1000, Math.abs(v.y) * 1000); }));
    R *= 1.1;
    const S = Math.min(w, h) / 2 - 24, cx = w / 2, cy = h / 2;
    const P = (x, y) => ({ x: cx + x / R * S, y: cy - y / R * S });
    c.strokeStyle = App.css('--grid'); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - S, cy); c.lineTo(cx + S, cy); c.moveTo(cx, cy - S); c.lineTo(cx, cy + S); c.stroke();
    c.setLineDash([5, 4]); c.strokeStyle = App.css('--muted');
    c.beginPath(); c.arc(cx, cy, tol / R * S, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    c.fillStyle = App.css('--muted'); c.font = '11px system-ui';
    c.fillText(`軸範圍 ±${fmt(R, 2)} µm`, 6, 14); c.fillText('X', cx + S - 10, cy + 14); c.fillText('Y', cx + 6, cy - S + 10);
    marks.forEach((m, i) => {
      last.trials.forEach(t => {
        if (!t.ok || !t.finalVec[m]) return;
        const v = t.finalVec[m], p = P(v.x * 1000, v.y * 1000);
        c.globalAlpha = 0.7; App.dot(c, p, MARK_COLORS[i % 8], 3, true); c.globalAlpha = 1;
        scatterPts.push({ p, m, v });
      });
    });
  }

  // 滑鼠提示
  const tip = document.createElement('div');
  tip.className = 'tooltip'; tip.hidden = true; document.body.appendChild(tip);
  $('scenScatter').addEventListener('mousemove', e => {
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 12;
    scatterPts.forEach(s => { const d = Math.hypot(s.p.x - x, s.p.y - y); if (d < bd) { bd = d; best = s; } });
    if (!best) { tip.hidden = true; return; }
    tip.hidden = false; tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY + 12 + 'px';
    tip.textContent = `${best.m}: X ${fmt(best.v.x * 1000, 2)} µm, Y ${fmt(best.v.y * 1000, 2)} µm`;
  });
  $('scenTrace').addEventListener('mousemove', e => {
    if (!traceGeom || !last) return;
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left;
    const i = Math.round((x - traceGeom.pad.l) / (traceGeom.w - traceGeom.pad.l - traceGeom.pad.r) * (traceGeom.maxN - 1));
    const pts = last.trials.slice(0, 60).map(t => t.trace[i]).filter(Boolean);
    if (i < 0 || !pts.length) { tip.hidden = true; return; }
    const med = a => { const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    tip.hidden = false; tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY + 12 + 'px';
    tip.textContent = `第 ${i + 1} 次拍照（${pts.length} 筆）：看到中位數 ${fmt(med(pts.map(p => p.seen)) * 1000, 2)} µm、真實 ${fmt(med(pts.map(p => p.truth)) * 1000, 2)} µm`;
  });
  ['scenScatter', 'scenTrace'].forEach(id => $(id).addEventListener('mouseleave', () => { tip.hidden = true; }));

  // ---------- 參數掃描 ----------
  function sweep() {
    const key = sel.value, def = SWEEPS[key];
    const btn = $('scenSweep');
    btn.disabled = true; btn.textContent = '掃描中…';
    setTimeout(() => {
      const tol = lastTol();
      const n = Math.min(+App.state.scen.trials || 100, App.state.fit.method === 'minimax' ? 100 : 300);
      const rows = def.values.map(v => {
        const P = Object.assign({}, App.state.scen, { [key]: v, trials: n });
        if (key === 'initX') P.initY = v;
        const r = VA.runScenario(App.state, P);
        const reason = Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0];
        const over = r.trials.filter(t => t.ok && t.finalTrueErr > tol).length;
        return `<tr><td>${v}</td><td>${fmt(r.okCount / r.n * 100, 1)}%</td><td>${fmt(r.err.p95 * 1000, 2)}</td>
          <td>${r.stepStats.map(s => fmt(s.meanIter, 2)).join(' / ')}</td><td>${over}</td><td>${reason ? App.esc(reason[0]) + '（' + reason[1] + '）' : '—'}</td></tr>`;
      });
      $('sweepTitle').textContent = `參數掃描：${def.label}（每點 ${n} 次，其他參數維持目前設定）`;
      $('sweepTable').innerHTML = `<thead><tr><th>${App.esc(def.label)}</th><th>成功率</th><th>P95 µm</th><th>平均移動次數（各步驟）</th><th>真實超公差</th><th>主要失敗原因</th></tr></thead><tbody>${rows.join('')}</tbody>`;
      btn.disabled = false; btn.textContent = '掃描一個參數…';
    }, 20);
  }

  $('scenRun').addEventListener('click', run);
  $('scenSweep').addEventListener('click', sweep);
  $('scenReset').addEventListener('click', () => {
    const keep = { trials: App.state.scen.trials, seed: App.state.scen.seed };
    App.state.scen = Object.assign(VA.defaultScen(), keep);
    App.update({ static: true });
  });
  App.onUpdate(o => { if (o.tab === 'scen') { drawTrace(); drawScatter(); } });
  window.addEventListener('resize', () => { drawTrace(); drawScatter(); });
})();
