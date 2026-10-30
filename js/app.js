// 視覺對位除錯工具 — 介面與狀態
(function () {
  'use strict';
  const VA = window.VA;
  const STORE_KEY = 'va-debug-state-v1';
  const CAM_COLORS = ['#e11d48', '#0891b2', '#ca8a04', '#7c3aed', '#059669', '#ea580c', '#2563eb', '#db2777'];
  const $ = id => document.getElementById(id);
  const fmt = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : '—');

  // ---------- 狀態 ----------
  function newCamera(i) {
    // 預設依序擺在旋轉中心左、右、下、上、四角…，第 9 台起往外一圈
    const ANG = [180, 0, 270, 90, 225, 315, 135, 45];
    const ang = ANG[i % 8], r = 150 * (1 + Math.floor(i / 8));
    const ox = +(r * Math.cos(ang * VA.D2R)).toFixed(3);
    const oy = +(r * Math.sin(ang * VA.D2R)).toFixed(3);
    return {
      name: 'CAM' + (i + 1), enabled: true, width: 2448, height: 2048,
      calMode: 'simple',
      simple: { mmppX: 0.01, mmppY: 0.01, angle: 0, flipX: false, flipY: true, ox, oy },
      matrix: { A: 0.01, B: 0, C: ox - 12.24, D: 0, E: -0.01, F: oy + 10.24 },
      cur: { u: 1224, v: 1024, ang: 0 },
      tgt: { u: 1224, v: 1024, ang: 0 }
    };
  }

  function defaultState() {
    return {
      version: 1,
      platform: { preset: 'XXY', rc: { x: 0, y: 0 }, axes: clone(VA.PLATFORMS.XXY.axes) },
      fit: { gain: 100, tol: 0.01 },
      sim: { noisePx: 0, gainErr: 0, rcErrX: 0, rcErrY: 0 },
      cameras: [newCamera(0), newCamera(1)],
      history: []
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  let state = load() || defaultState();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      return s && s.version === 1 ? s : null;
    } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 無法儲存時忽略 */ }
  }

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], obj);
    target[last] = val;
  }

  // ---------- 計算 ----------
  function compute() {
    const rc = { x: +state.platform.rc.x, y: +state.platform.rc.y };
    const cams = state.cameras.map((cam, i) => {
      const m = VA.cameraAffine(cam);
      const cur = VA.pixToWorld(m, +cam.cur.u, +cam.cur.v);
      const tgt = VA.pixToWorld(m, +cam.tgt.u, +cam.tgt.v);
      const err = { x: cur.x - tgt.x, y: cur.y - tgt.y };
      err.d = Math.hypot(err.x, err.y);
      return { i, cam, m, info: VA.describeAffine(m), cur, tgt, err };
    });
    const used = cams.filter(c => c.cam.enabled);
    const warnings = [];
    let fit = null;
    if (used.length === 0) {
      warnings.push('沒有啟用的相機。');
    } else {
      // 單相機：角度由「目前角度 → 目標角度」的差決定
      let fixedTheta = 0;
      if (used.length === 1) {
        const c = used[0].cam;
        fixedTheta = ((+c.tgt.ang) - (+c.cur.ang)) * VA.D2R;
        warnings.push('只有 1 台相機：旋轉量取自量測角度差，無法由多點驗證。');
      }
      fit = VA.fitRigid(used.map(c => ({ p: c.cur, q: c.tgt })), rc, fixedTheta);
      used.forEach((c, k) => { c.residual = fit.residuals[k]; });
    }
    const gain = (+state.fit.gain) / 100;
    let move = null, axes = [];
    if (fit) {
      move = { theta: fit.theta * gain, T: { x: fit.T.x * gain, y: fit.T.y * gain } };
      axes = VA.axisCommands(state.platform.axes, move.theta, move.T);
      cams.forEach(c => { if (c.cam.enabled) c.pred = VA.applyMove(c.cur, move.theta, move.T, rc); });
      if (used.length >= 2 && Math.abs(fit.scale - 1) > 1e-3) {
        warnings.push(`標記間距比 ${fmt(fit.scale, 5)}（偏離 1 達 ${fmt((fit.scale - 1) * 100, 3)}%）：工件伸縮、校正尺度錯誤或量測到錯誤特徵。`);
      }
      const maxRes = Math.max(0, ...fit.residuals.map(r => r.d));
      if (maxRes > +state.fit.tol) {
        warnings.push(`剛體擬合殘差 ${fmt(maxRes)} mm 已超過公差，即使完全照算出的量移動也無法同時對準所有標記。`);
      }
    }
    cams.forEach(c => {
      if (Math.abs(c.info.skew) > 1) warnings.push(`${c.cam.name}：校正兩軸不正交（${fmt(c.info.skew, 2)}°），請檢查校正資料。`);
    });
    if (used.length >= 2 && new Set(used.map(c => c.info.handed)).size > 1) {
      warnings.push('各相機校正手性（行列式正負）不一致：若不是上下視混用，請確認 X/Y 反向設定。');
    }
    if (state.platform.axes.length === 0) warnings.push('尚未設定任何軸。');
    const maxErr = Math.max(0, ...used.map(c => c.err.d));
    return { rc, cams, used, fit, move, axes, warnings, maxErr, pass: used.length > 0 && maxErr <= +state.fit.tol };
  }

  // ---------- 介面：平台 ----------
  function renderPlatform() {
    const sel = $('platformPreset');
    if (!sel.options.length) {
      for (const [k, p] of Object.entries(VA.PLATFORMS)) sel.add(new Option(p.label, k));
    }
    sel.value = state.platform.preset;
    $('platformNote').textContent = (VA.PLATFORMS[state.platform.preset] || {}).note || '';
    $('axisCount').textContent = state.platform.axes.length;
    const kinds = [['linear', '直線'], ['linearRot', '直線-隨θ'], ['rotary', '旋轉']];
    $('axisRows').innerHTML = state.platform.axes.map((ax, i) => `
      <tr>
        <td><input class="name" data-bind="platform.axes.${i}.name" value="${esc(ax.name)}"></td>
        <td><select data-bind="platform.axes.${i}.kind">${kinds.map(([v, l]) =>
          `<option value="${v}"${ax.kind === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input type="number" step="any" data-bind="platform.axes.${i}.px" value="${ax.px}"></td>
        <td><input type="number" step="any" data-bind="platform.axes.${i}.py" value="${ax.py}"></td>
        <td><input type="number" step="any" data-bind="platform.axes.${i}.dir" value="${ax.dir}"></td>
        <td><input type="checkbox" data-bind-sign="${i}"${ax.sign < 0 ? ' checked' : ''}></td>
        <td><button type="button" class="small" data-del-axis="${i}">✕</button></td>
      </tr>`).join('');
  }

  // ---------- 介面：相機 ----------
  function renderCameras() {
    $('camCount').textContent = state.cameras.length;
    $('cameraList').innerHTML = state.cameras.map((cam, i) => {
      const p = `cameras.${i}`;
      const num = (path, label) =>
        `<div class="field"><label>${label}</label><input type="number" step="any" data-bind="${p}.${path}" value="${getPath(cam, path)}"></div>`;
      const simple = cam.calMode === 'simple';
      return `
      <div class="cam${cam.enabled ? '' : ' disabled'}">
        <div class="cam-head">
          <span class="swatch" style="background:${CAM_COLORS[i % CAM_COLORS.length]}"></span>
          <input class="name" data-bind="${p}.name" value="${esc(cam.name)}">
          <label title="參與計算"><input type="checkbox" data-bind="${p}.enabled"${cam.enabled ? ' checked' : ''}> 啟用</label>
        </div>
        <div class="grid2">${num('width', '影像寬 (px)')}${num('height', '影像高 (px)')}</div>
        <div class="field"><label>校正方式</label>
          <select data-bind="${p}.calMode" data-rerender="1">
            <option value="simple"${simple ? ' selected' : ''}>簡易（像素當量＋角度＋位置）</option>
            <option value="matrix"${simple ? '' : ' selected'}>仿射矩陣 A–F</option>
          </select></div>
        ${simple ? `
          <div class="grid2">${num('simple.mmppX', 'X 像素當量 (mm/px)')}${num('simple.mmppY', 'Y 像素當量 (mm/px)')}</div>
          <div class="grid3">${num('simple.angle', '相機角度°')}${num('simple.ox', '中心 X (mm)')}${num('simple.oy', '中心 Y (mm)')}</div>
          <label><input type="checkbox" data-bind="${p}.simple.flipX"${cam.simple.flipX ? ' checked' : ''}> X 反向</label>
          <label><input type="checkbox" data-bind="${p}.simple.flipY"${cam.simple.flipY ? ' checked' : ''}> Y 反向（影像 v 向下）</label>
        ` : `
          <p class="hint">X = A·u + B·v + C；Y = D·u + E·v + F</p>
          <div class="grid3">${num('matrix.A', 'A')}${num('matrix.B', 'B')}${num('matrix.C', 'C')}</div>
          <div class="grid3">${num('matrix.D', 'D')}${num('matrix.E', 'E')}${num('matrix.F', 'F')}</div>
        `}
        <div class="cam-sub">目前量測（像素）</div>
        <div class="grid3">${num('cur.u', 'u')}${num('cur.v', 'v')}${num('cur.ang', '角度°')}</div>
        <div class="cam-sub">目標（像素） <button type="button" class="small" data-set-target="${i}">目前→目標</button></div>
        <div class="grid3">${num('tgt.u', 'u')}${num('tgt.v', 'v')}${num('tgt.ang', '角度°')}</div>
      </div>`;
    }).join('');
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- 介面：結果 ----------
  function renderResults(r) {
    const st = $('status');
    if (!r.fit) { st.className = 'status warn'; st.textContent = '無法計算'; }
    else if (r.pass) { st.className = 'status ok'; st.textContent = `OK：最大誤差 ${fmt(r.maxErr)} mm ≤ 公差`; }
    else { st.className = 'status ng'; st.textContent = `NG：最大誤差 ${fmt(r.maxErr)} mm > 公差 ${state.fit.tol} mm`; }

    let html = '';
    if (r.move) {
      html += `<div class="kv">
        <span>平台修正 ΔX</span><b>${fmt(r.move.T.x)} mm</b>
        <span>平台修正 ΔY</span><b>${fmt(r.move.T.y)} mm</b>
        <span>平台修正 Δθ</span><b>${fmt(r.move.theta * VA.R2D, 5)} °</b>
        <span>旋轉中心</span><b>(${fmt(r.rc.x, 3)}, ${fmt(r.rc.y, 3)})</b>
        <span>使用相機數</span><b>${r.used.length}</b>
        ${r.used.length >= 2 ? `<span>標記間距比</span><b>${fmt(r.fit.scale, 6)}</b>` : ''}
      </div>`;
    }
    if (r.warnings.length) html += `<ul class="warnings">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
    $('correction').innerHTML = html;

    $('camTable').innerHTML = `<thead><tr><th>相機</th><th>目前 X</th><th>目前 Y</th><th>誤差 X</th><th>誤差 Y</th><th>|誤差|</th><th>擬合殘差</th><th>mm/px</th><th>手性</th></tr></thead><tbody>` +
      r.cams.map(c => `<tr${c.cam.enabled ? '' : ' style="opacity:.5"'}>
        <td><span class="dot" style="background:${CAM_COLORS[c.i % CAM_COLORS.length]}"></span>${esc(c.cam.name)}</td>
        <td>${fmt(c.cur.x, 3)}</td><td>${fmt(c.cur.y, 3)}</td>
        <td>${fmt(c.err.x)}</td><td>${fmt(c.err.y)}</td><td>${fmt(c.err.d)}</td>
        <td>${c.residual ? fmt(c.residual.d) : '—'}</td>
        <td>${fmt(c.info.sx, 5)}</td><td>${c.info.handed < 0 ? '−' : '+'}</td></tr>`).join('') + '</tbody>';

    $('axisTable').innerHTML = `<thead><tr><th>軸</th><th>指令</th><th>單位</th></tr></thead><tbody>` +
      r.axes.map(a => `<tr><td>${esc(a.name)}</td><td>${fmt(a.value, a.unit === 'deg' ? 5 : 4)}</td><td>${a.unit}</td></tr>`).join('') + '</tbody>';

    $('histTable').innerHTML = state.history.length ? `<thead><tr><th>#</th><th>移動前最大誤差</th><th>ΔX</th><th>ΔY</th><th>Δθ°</th></tr></thead><tbody>` +
      state.history.map((h, k) => `<tr><td>${k + 1}</td><td>${fmt(h.maxErr)}</td><td>${fmt(h.dx)}</td><td>${fmt(h.dy)}</td><td>${fmt(h.dt, 5)}</td></tr>`).join('') +
      `<tr><td>現在</td><td>${fmt(r.maxErr)}</td><td colspan="3"></td></tr></tbody>` : '';
  }

  function resultText(r) {
    const lines = [`平台: ${VA.PLATFORMS[state.platform.preset].label}`, `旋轉中心: ${fmt(r.rc.x, 3)}, ${fmt(r.rc.y, 3)}`];
    if (r.move) lines.push(`ΔX=${fmt(r.move.T.x)} ΔY=${fmt(r.move.T.y)} Δθ=${fmt(r.move.theta * VA.R2D, 5)}°`);
    r.cams.forEach(c => lines.push(`${c.cam.name}${c.cam.enabled ? '' : '(停用)'}: 誤差 ${fmt(c.err.x)}, ${fmt(c.err.y)} |${fmt(c.err.d)}| 殘差 ${c.residual ? fmt(c.residual.d) : '-'}`));
    r.axes.forEach(a => lines.push(`${a.name} = ${fmt(a.value, 5)} ${a.unit}`));
    r.warnings.forEach(w => lines.push('! ' + w));
    return lines.join('\n');
  }

  // ---------- 繪圖 ----------
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  let view = null; // {scale, cx, cy}：世界座標中心與 px/mm
  let lastResult = null;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function worldBounds(r) {
    const pts = [r.rc];
    r.cams.forEach(c => {
      const w = c.cam.width, h = c.cam.height;
      [[0, 0], [w, 0], [w, h], [0, h]].forEach(([u, v]) => pts.push(VA.pixToWorld(c.m, u, v)));
    });
    state.platform.axes.forEach(a => { if (a.kind === 'linear') pts.push({ x: r.rc.x + +a.px, y: r.rc.y + +a.py }); });
    const xs = pts.map(p => p.x).filter(Number.isFinite), ys = pts.map(p => p.y).filter(Number.isFinite);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  function fitView(r) {
    const b = worldBounds(r);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bw = Math.max(b.x1 - b.x0, 1), bh = Math.max(b.y1 - b.y0, 1);
    view = { scale: Math.min(w / bw, h / bh) * 0.85, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
  }

  function toScreen(p) {
    return { x: canvas.clientWidth / 2 + (p.x - view.cx) * view.scale, y: canvas.clientHeight / 2 - (p.y - view.cy) * view.scale };
  }
  function toWorld(sx, sy) {
    return { x: view.cx + (sx - canvas.clientWidth / 2) / view.scale, y: view.cy - (sy - canvas.clientHeight / 2) / view.scale };
  }

  function draw(r) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!view) fitView(r);

    drawGrid(w, h);
    const k = Math.max(1, +$('exaggerate').value || 1);

    // 軸
    if ($('showAxes').checked) {
      ctx.strokeStyle = css('--axis'); ctx.fillStyle = css('--axis'); ctx.lineWidth = 2;
      ctx.font = '12px system-ui';
      state.platform.axes.forEach(a => {
        if (a.kind === 'rotary') return;
        const base = a.kind === 'linear' ? { x: r.rc.x + +a.px, y: r.rc.y + +a.py } : { x: r.rc.x, y: r.rc.y };
        const s = toScreen(base);
        const d = +a.dir * VA.D2R;
        const len = 40, sg = a.sign < 0 ? -1 : 1;
        const ex = s.x + Math.cos(d) * len * sg, ey = s.y - Math.sin(d) * len * sg;
        arrow(s.x, s.y, ex, ey);
        ctx.fillText(a.name, ex + 4, ey - 4);
      });
    }

    // 旋轉中心
    const rcs = toScreen(r.rc);
    ctx.strokeStyle = css('--rc'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(rcs.x, rcs.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rcs.x - 11, rcs.y); ctx.lineTo(rcs.x + 11, rcs.y); ctx.moveTo(rcs.x, rcs.y - 11); ctx.lineTo(rcs.x, rcs.y + 11); ctx.stroke();

    r.cams.forEach(c => {
      const color = CAM_COLORS[c.i % CAM_COLORS.length];
      if ($('showFov').checked) {
        const corners = [[0, 0], [c.cam.width, 0], [c.cam.width, c.cam.height], [0, c.cam.height]]
          .map(([u, v]) => toScreen(VA.pixToWorld(c.m, u, v)));
        ctx.strokeStyle = color; ctx.globalAlpha = c.cam.enabled ? 0.8 : 0.3; ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); corners.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        // 影像原點 (0,0) 標示，用來確認影像方向
        ctx.fillStyle = color; ctx.fillRect(corners[0].x - 3, corners[0].y - 3, 6, 6);
        // u 方向箭頭
        const ou = toScreen(VA.pixToWorld(c.m, 0, 0)), uu = toScreen(VA.pixToWorld(c.m, c.cam.width * 0.2, 0));
        ctx.strokeStyle = color; arrow(ou.x, ou.y, uu.x, uu.y);
        ctx.font = '12px system-ui'; ctx.fillText(c.cam.name, corners[0].x + 6, corners[0].y - 6);
        ctx.globalAlpha = 1;
      }
      const t = toScreen(c.tgt);
      // 誤差向量（放大）
      const curDraw = toScreen({ x: c.tgt.x + c.err.x * k, y: c.tgt.y + c.err.y * k });
      ctx.globalAlpha = c.cam.enabled ? 1 : 0.35;
      ctx.strokeStyle = css('--cur'); ctx.lineWidth = 1.5; arrow(t.x, t.y, curDraw.x, curDraw.y);
      dot(t, css('--tgt'), 5, true);
      dot(curDraw, css('--cur'), 5, true);
      if (c.pred) {
        const pd = toScreen({ x: c.tgt.x + (c.pred.x - c.tgt.x) * k, y: c.tgt.y + (c.pred.y - c.tgt.y) * k });
        dot(pd, css('--pred'), 6, false);
      }
      ctx.globalAlpha = 1;
    });
  }

  function drawGrid(w, h) {
    // 依縮放自動選擇格線間距（1、2、5 × 10^n mm）
    const target = 80 / view.scale;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map(m => m * p).find(s => s >= target);
    const tl = toWorld(0, 0), br = toWorld(w, h);
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1; ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui';
    ctx.beginPath();
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) { const s = toScreen({ x, y: 0 }); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, h); }
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) { const s = toScreen({ x: 0, y }); ctx.moveTo(0, s.y); ctx.lineTo(w, s.y); }
    ctx.stroke();
    ctx.fillText(`格線 ${+step.toPrecision(3)} mm`, 6, h - 6);
    // 世界原點軸
    const o = toScreen({ x: 0, y: 0 });
    ctx.strokeStyle = css('--fov'); ctx.beginPath(); ctx.moveTo(o.x, 0); ctx.lineTo(o.x, h); ctx.moveTo(0, o.y); ctx.lineTo(w, o.y); ctx.stroke();
  }

  function dot(p, color, r, filled) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (filled) { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
  }
  function arrow(x0, y0, x1, y1) {
    const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    if (L > 6) {
      ctx.moveTo(x1, y1); ctx.lineTo(x1 - 7 * Math.cos(a - 0.4), y1 - 7 * Math.sin(a - 0.4));
      ctx.moveTo(x1, y1); ctx.lineTo(x1 - 7 * Math.cos(a + 0.4), y1 - 7 * Math.sin(a + 0.4));
    }
    ctx.stroke();
  }

  // ---------- 模擬 ----------
  function simulateStep() {
    const r = compute();
    if (!r.move) return;
    const sim = state.sim;
    const g = 1 + (+sim.gainErr) / 100;
    const th = r.move.theta * g, T = { x: r.move.T.x * g, y: r.move.T.y * g };
    const rcTrue = { x: r.rc.x + +sim.rcErrX, y: r.rc.y + +sim.rcErrY };
    state.history.push({ maxErr: r.maxErr, dx: r.move.T.x, dy: r.move.T.y, dt: r.move.theta * VA.R2D });
    r.cams.forEach(c => {
      const moved = VA.applyMove(c.cur, th, T, rcTrue);
      const px = VA.worldToPix(c.m, moved.x, moved.y);
      const n = +sim.noisePx || 0;
      c.cam.cur.u = +(px.u + n * VA.gauss()).toFixed(3);
      c.cam.cur.v = +(px.v + n * VA.gauss()).toFixed(3);
      c.cam.cur.ang = +((+c.cam.cur.ang) + th * VA.R2D).toFixed(5);
    });
  }

  // ---------- 事件 ----------
  function update(opts = {}) {
    if (opts.platform) renderPlatform();
    if (opts.cameras) renderCameras();
    lastResult = compute();
    renderResults(lastResult);
    if (opts.fit) view = null;
    draw(lastResult);
    save();
  }
  // 寫死在 HTML 中的欄位（旋轉中心、公差、模擬參數）由狀態回填
  function syncStatic() {
    document.querySelectorAll('[data-bind]').forEach(el => {
      if (el.closest('#cameraList, #axisRows')) return;
      const v = getPath(state, el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
  }
  function fullRender() { syncStatic(); update({ platform: true, cameras: true, fit: true }); }

  document.addEventListener('input', e => {
    const el = e.target;
    const path = el.dataset && el.dataset.bind;
    if (path) {
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') { if (el.value === '' || isNaN(+el.value)) return; val = +el.value; }
      else val = el.value;
      setPath(state, path, val);
      const structural = el.dataset.rerender || /\.enabled$|\.kind$/.test(path);
      update({ cameras: structural && path.startsWith('cameras'), platform: false });
      return;
    }
    if (el.dataset && el.dataset.bindSign !== undefined) {
      state.platform.axes[+el.dataset.bindSign].sign = el.checked ? -1 : 1;
      update();
    }
    if (el.id === 'exaggerate' || el.id === 'showFov' || el.id === 'showAxes') draw(lastResult);
  });
  document.addEventListener('change', e => {
    // select 在部分瀏覽器只觸發 change
    if (e.target.tagName === 'SELECT' && e.target.dataset.bind) e.target.dispatchEvent(new Event('input', { bubbles: true }));
  });

  $('platformPreset').addEventListener('change', e => {
    const key = e.target.value;
    state.platform.preset = key;
    if (key !== 'CUSTOM') state.platform.axes = clone(VA.PLATFORMS[key].axes);
    update({ platform: true, fit: true });
  });
  $('btnAddAxis').addEventListener('click', () => {
    state.platform.axes.push({ name: 'A' + (state.platform.axes.length + 1), kind: 'linear', px: 0, py: 0, dir: 0, sign: 1 });
    update({ platform: true });
  });
  $('axisRows').addEventListener('click', e => {
    const i = e.target.dataset.delAxis;
    if (i !== undefined) { state.platform.axes.splice(+i, 1); update({ platform: true }); }
  });
  $('cameraList').addEventListener('click', e => {
    const i = e.target.dataset.setTarget;
    if (i !== undefined) {
      const c = state.cameras[+i];
      c.tgt = clone(c.cur);
      update({ cameras: true });
    }
  });
  $('btnCamPlus').addEventListener('click', () => {
    if (state.cameras.length >= 16) return;
    const n = state.cameras.length + 1;
    state.cameras.push(newCamera(n - 1));
    update({ cameras: true, fit: true });
  });
  $('btnCamMinus').addEventListener('click', () => {
    if (state.cameras.length <= 1) return;
    state.cameras.pop();
    update({ cameras: true, fit: true });
  });

  $('btnStep').addEventListener('click', () => { simulateStep(); update({ cameras: true }); });
  $('btnStep5').addEventListener('click', () => { for (let k = 0; k < 5; k++) simulateStep(); update({ cameras: true }); });
  $('btnClearHist').addEventListener('click', () => { state.history = []; update(); });
  $('btnFit').addEventListener('click', () => { view = null; draw(lastResult); });
  $('btnCopy').addEventListener('click', () => {
    const txt = resultText(lastResult);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => prompt('複製以下內容', txt));
    else prompt('複製以下內容', txt);
  });

  $('btnDemo').addEventListener('click', () => { state = demoState(); fullRender(); });
  $('btnReset').addEventListener('click', () => {
    if (confirm('確定要清除所有設定？')) { state = defaultState(); fullRender(); }
  });
  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `alignment-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('fileImport').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then(t => {
      const s = JSON.parse(t);
      if (!s || s.version !== 1 || !Array.isArray(s.cameras)) throw new Error('格式不符');
      state = Object.assign(defaultState(), s);
      fullRender();
    }).catch(err => alert('匯入失敗：' + err.message));
    e.target.value = '';
  });

  // 範例：雙相機 XXY，工件有已知偏移 (0.3, −0.2, 0.15°)
  function demoState() {
    const s = defaultState();
    s.cameras.forEach(cam => {
      const m = VA.cameraAffine(cam);
      const tgt = VA.pixToWorld(m, cam.tgt.u, cam.tgt.v);
      const p = VA.applyMove(tgt, 0.15 * VA.D2R, { x: 0.3, y: -0.2 }, s.platform.rc);
      const px = VA.worldToPix(m, p.x, p.y);
      cam.cur = { u: +px.u.toFixed(3), v: +px.v.toFixed(3), ang: 0.15 };
    });
    s.sim = { noisePx: 0.3, gainErr: 0, rcErrX: 0, rcErrY: 0 };
    return s;
  }

  // 平移 / 縮放
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    const wpt = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    $('cursorPos').textContent = `X ${fmt(wpt.x, 3)}  Y ${fmt(wpt.y, 3)} mm`;
    if (drag) {
      view.cx -= (e.clientX - drag.x) / view.scale;
      view.cy += (e.clientY - drag.y) / view.scale;
      drag = { x: e.clientX, y: e.clientY };
      draw(lastResult);
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const before = toWorld(sx, sy);
    view.scale *= e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const after = toWorld(sx, sy);
    view.cx += before.x - after.x; view.cy += before.y - after.y;
    draw(lastResult);
  }, { passive: false });
  window.addEventListener('resize', () => draw(lastResult));

  fullRender();
})();
