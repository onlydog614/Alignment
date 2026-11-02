// 視覺對位除錯工具 — 共用狀態與「對位計算」頁
(function () {
  'use strict';
  const VA = window.VA;
  const STORE_KEY = 'va-debug-state';
  const CAM_COLORS = ['#e11d48', '#0891b2', '#ca8a04', '#7c3aed', '#059669', '#ea580c', '#2563eb', '#db2777'];
  const $ = id => document.getElementById(id);
  const fmt = VA.fmt;
  const clone = VA.clone;

  // ---------- 狀態 ----------
  let state = load() || VA.defaultState();

  function load() {
    try {
      return VA.migrate(JSON.parse(localStorage.getItem(STORE_KEY)) || JSON.parse(localStorage.getItem('va-debug-state-v1')));
    } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 無法儲存時忽略 */ }
  }
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = val;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const camColor = i => CAM_COLORS[i % CAM_COLORS.length];

  // ---------- 平台 ----------
  function renderPlatform() {
    const sel = $('platformPreset');
    if (!sel.options.length) for (const [k, p] of Object.entries(VA.PLATFORMS)) sel.add(new Option(p.label, k));
    sel.value = state.platform.preset;
    $('platformNote').textContent = (VA.PLATFORMS[state.platform.preset] || {}).note || '';
    document.querySelectorAll('.only-xyt').forEach(el => { el.hidden = state.platform.preset !== 'XYT'; });
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

  function renderSteps() {
    $('stepCount').textContent = state.steps.length;
    $('stepRows').innerHTML = state.steps.map((st, i) => `
      <tr>
        <td><input class="name wide" data-bind="steps.${i}.name" value="${esc(st.name)}" data-rerender-all="1"></td>
        <td><input type="number" step="any" data-bind="steps.${i}.tol" value="${st.tol}"></td>
        <td><input type="number" step="1" min="0" data-bind="steps.${i}.maxIter" value="${st.maxIter}"></td>
        <td><input type="number" step="any" data-bind="steps.${i}.gain" value="${st.gain}"></td>
        <td><input type="number" step="1" min="0" data-bind="steps.${i}.minMoves" value="${st.minMoves || 0}"></td>
      </tr>`).join('');
    const a = $('activeStep');
    if (state.activeStep >= state.steps.length) state.activeStep = 0;
    a.innerHTML = state.steps.map((st, i) => `<option value="${i}">${i + 1}. ${esc(st.name)}</option>`).join('');
    a.value = state.activeStep;
  }

  // ---------- 相機 ----------
  function numField(path, label, val) {
    return `<div class="field"><label>${label}</label><input type="number" step="any" data-bind="${path}" value="${val}"></div>`;
  }

  function renderCameras() {
    $('camCount').textContent = state.cameras.length;
    const openSet = new Set([...document.querySelectorAll('#cameraList details[open]')].map(d => d.dataset.idx));
    const first = !$('cameraList').children.length;
    $('cameraList').innerHTML = state.cameras.map((cam, i) => {
      const p = `cameras.${i}`;
      const num = (path, label) => numField(`${p}.${path}`, label, getPath(cam, path));
      const simple = cam.calMode === 'simple';
      const o = cam.optics;
      const os = VA.opticsSummary(o);
      const tele = o.lens === 'telecentric';
      const isOpen = first ? state.cameras.length <= 2 : openSet.has(String(i));
      return `
      <details class="cam" data-idx="${i}"${isOpen ? ' open' : ''}>
        <summary class="cam-head">
          <span class="swatch" style="background:${camColor(i)}"></span>
          <b>${esc(cam.name)}</b> <span class="hint">${cam.width}×${cam.height}・${fmt(VA.describeAffine(VA.cameraAffine(cam)).sx * 1000, 3)} µm/px</span>
        </summary>
        <div class="field"><label>名稱</label><input data-bind="${p}.name" value="${esc(cam.name)}" data-rerender-all="1"></div>
        <div class="cam-sec">
          <div class="cam-sub">光學</div>
          <div class="grid2">
            <div class="field"><label>感光元件</label><select data-sensor="${i}">
              ${Object.entries(VA.SENSORS).map(([k, s]) => `<option value="${k}"${o.sensor === k ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select></div>
            <div class="field"><label>鏡頭</label><select data-bind="${p}.optics.lens" data-rerender="1">
              <option value="entocentric"${tele ? '' : ' selected'}>一般（焦距）</option>
              <option value="telecentric"${tele ? ' selected' : ''}>遠心（倍率）</option>
            </select></div>
          </div>
          <div class="grid3">${num('optics.pixel', '像素 (µm)')}${tele ? num('optics.mag', '倍率 ×') : num('optics.f', '焦距 (mm)') + num('optics.wd', '工作距離 (mm)')}${num('optics.dof', '景深 (mm)')}</div>
          <div class="optsum">倍率 ${fmt(os.mag, 4)}×・${fmt(os.mmpp * 1000, 3)} µm/px・視野 ${fmt(os.fovX, 2)} × ${fmt(os.fovY, 2)} mm
            ${tele ? '・Z 改變不影響倍率' : `・Z +1 mm → 尺度 ${fmt((os.zScale(1) - 1) * 100, 3)}%`}</div>
          <button type="button" class="small" data-apply-optics="${i}">以光學值設定解析度與像素當量</button>
        </div>
        <div class="cam-sec">
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
        </div>
      </details>`;
    }).join('');
  }

  // ---------- 拍照點 ----------
  function renderShots() {
    $('shotCount').textContent = state.shots.length;
    const gantry = state.platform.gantry.enabled;
    $('shotList').innerHTML = state.shots.map((s, i) => {
      const p = `shots.${i}`;
      const num = (path, label) => numField(`${p}.${path}`, label, getPath(s, path));
      const other = +s.step !== +state.activeStep && state.steps.length > 1;
      return `
      <details class="cam${s.enabled ? '' : ' disabled'}"${other ? '' : ' open'}>
        <summary class="cam-head">
          <span class="swatch" style="background:${camColor(+s.cam)}"></span>
          <b>${esc(s.name)}</b><span class="hint">${esc(s.mark)}・${esc((state.cameras[s.cam] || {}).name || '?')}・${+s.step + 1}. ${esc((state.steps[s.step] || {}).name || '')}</span>
        </summary>
        <div class="grid3">
          <div class="field"><label>名稱</label><input data-bind="${p}.name" value="${esc(s.name)}"></div>
          <div class="field"><label>Mark</label><input data-bind="${p}.mark" value="${esc(s.mark)}"></div>
          <div class="field"><label>&nbsp;</label><label><input type="checkbox" data-bind="${p}.enabled"${s.enabled ? ' checked' : ''}> 啟用</label></div>
        </div>
        <div class="grid2">
          <div class="field"><label>相機</label><select data-bind="${p}.cam" data-num="1" data-rerender="1">
            ${state.cameras.map((c, k) => `<option value="${k}"${+s.cam === k ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>步驟</label><select data-bind="${p}.step" data-num="1" data-rerender="1">
            ${state.steps.map((st, k) => `<option value="${k}"${+s.step === k ? ' selected' : ''}>${k + 1}. ${esc(st.name)}</option>`).join('')}</select></div>
        </div>
        ${gantry ? `<div class="grid2">${num('gx', '線馬 X (mm)')}${num('gy', '線馬 Y (mm)')}</div>` : ''}
        <div class="cam-sub">目前量測（像素）</div>
        <div class="grid3">${num('cur.u', 'u')}${num('cur.v', 'v')}${num('cur.ang', '角度°')}</div>
        <div class="cam-sub">目標（像素） <button type="button" class="small" data-set-target="${i}">目前→目標</button></div>
        <div class="grid3">${num('tgt.u', 'u')}${num('tgt.v', 'v')}${num('tgt.ang', '角度°')}</div>
      </details>`;
    }).join('');
  }

  // ---------- 結果 ----------
  function renderResults(r) {
    const st = $('status');
    if (!r.fit) { st.className = 'status warn'; st.textContent = '無法計算'; }
    else if (r.pass) { st.className = 'status ok'; st.textContent = `OK：最大誤差 ${fmt(r.maxErr)} mm ≤ 公差 ${r.step.tol} mm`; }
    else { st.className = 'status ng'; st.textContent = `NG：最大誤差 ${fmt(r.maxErr)} mm > 公差 ${r.step.tol} mm`; }

    let html = '';
    if (r.move) {
      html += `<div class="kv">
        <span>步驟</span><b>${esc(r.step.name)}</b>
        <span>平台修正 ΔX</span><b>${fmt(r.move.T.x)} mm</b>
        <span>平台修正 ΔY</span><b>${fmt(r.move.T.y)} mm</b>
        <span>平台修正 Δθ</span><b>${fmt(r.move.theta * VA.R2D, 5)} °</b>
        <span>旋轉中心（實際使用）</span><b>(${fmt(r.rc.x, 3)}, ${fmt(r.rc.y, 3)})</b>
        <span>擬合方法</span><b>${state.fit.method === 'minimax' ? '最大誤差最小化' : '最小平方法'}</b>
        <span>擬合後最大殘差</span><b>${fmt(Math.max(0, ...r.fit.residuals.map(x => x.d)))} mm</b>
        ${r.used.length >= 2 ? `<span>標記間距比</span><b>${fmt(r.fit.scale, 6)}</b>` : ''}
      </div>`;
    }
    if (r.warnings.length) html += `<ul class="warnings">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
    $('correction').innerHTML = html;

    const rows = r.shots.filter(s => !s.invalid && (s.inStep || $('showAll').checked));
    $('shotTable').innerHTML = `<thead><tr><th>拍照點</th><th>X</th><th>Y</th><th>誤差 X</th><th>誤差 Y</th><th>|誤差|</th><th>誤差 px</th><th>殘差</th></tr></thead><tbody>` +
      rows.map(s => `<tr${s.shot.enabled && s.inStep ? '' : ' style="opacity:.5"'}>
        <td><span class="dot" style="background:${camColor(+s.shot.cam)}"></span>${esc(s.shot.name)}</td>
        <td>${fmt(s.cur.x, 3)}</td><td>${fmt(s.cur.y, 3)}</td>
        <td>${fmt(s.err.x)}</td><td>${fmt(s.err.y)}</td><td>${fmt(s.err.d)}</td>
        <td>${fmt(Math.hypot(+s.curPix.u - s.shot.tgt.u, +s.curPix.v - s.shot.tgt.v), 1)}</td>
        <td>${s.residual ? fmt(s.residual.d) : '—'}</td></tr>`).join('') + '</tbody>';

    $('axisTable').innerHTML = `<thead><tr><th>軸</th><th>指令</th><th>單位</th></tr></thead><tbody>` +
      r.axes.map(a => `<tr><td>${esc(a.name)}</td><td>${fmt(a.value, a.unit === 'deg' ? 5 : 4)}</td><td>${a.unit}</td></tr>`).join('') + '</tbody>';

    $('histTable').innerHTML = state.history.length ? `<thead><tr><th>#</th><th>步驟</th><th>移動前最大誤差</th><th>ΔX</th><th>ΔY</th><th>Δθ°</th></tr></thead><tbody>` +
      state.history.map((h, k) => `<tr><td>${k + 1}</td><td>${esc(h.step || '')}</td><td>${fmt(h.maxErr)}</td><td>${fmt(h.dx)}</td><td>${fmt(h.dy)}</td><td>${fmt(h.dt, 5)}</td></tr>`).join('') +
      `<tr><td>現在</td><td></td><td>${fmt(r.maxErr)}</td><td colspan="3"></td></tr></tbody>` : '';

    // 推測只用目前步驟的紀錄
    const hist = state.history.filter(h => (h.stepIdx || 0) === r.stepIdx);
    const noise = (+state.sim.noisePx || 0) * Math.max(0, ...r.used.map(s => s.ci.info.sx));
    const cen = r.used.reduce((a, s) => ({ x: a.x + s.cur.x / r.used.length, y: a.y + s.cur.y / r.used.length }), { x: 0, y: 0 });
    const arm = r.used.length >= 2 ? r.used.reduce((a, s) => a + Math.hypot(s.cur.x - cen.x, s.cur.y - cen.y), 0) / r.used.length : 100;
    $('diagList').innerHTML = VA.diagnose(hist, { noise, tol: +r.step.tol, arm }).map(d => `<li class="${d.level}">${esc(d.text)}</li>`).join('');
  }

  function resultText(r) {
    const lines = [`平台: ${VA.PLATFORMS[state.platform.preset].label}`, `步驟: ${r.step.name}`, `旋轉中心: ${fmt(r.rc.x, 3)}, ${fmt(r.rc.y, 3)}`];
    if (r.move) lines.push(`ΔX=${fmt(r.move.T.x)} ΔY=${fmt(r.move.T.y)} Δθ=${fmt(r.move.theta * VA.R2D, 5)}°`);
    r.used.forEach(s => lines.push(`${s.shot.name}: 誤差 ${fmt(s.err.x)}, ${fmt(s.err.y)} |${fmt(s.err.d)}| 殘差 ${s.residual ? fmt(s.residual.d) : '-'}`));
    r.axes.forEach(a => lines.push(`${a.name} = ${fmt(a.value, 5)} ${a.unit}`));
    r.warnings.forEach(w => lines.push('! ' + w));
    return lines.join('\n');
  }

  // ---------- 主圖 ----------
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  let view = null;
  let lastResult = null;

  function fovCorners(s) {
    const c = s.ci.cam;
    return [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]]
      .map(([u, v]) => VA.shotToStage(state, s.shot, VA.pixToWorld(s.ci.m, u, v)));
  }
  function visibleShots(r) { return r.shots.filter(s => !s.invalid && (s.inStep || $('showAll').checked)); }

  function worldBounds(r) {
    const pts = [r.rc];
    visibleShots(r).forEach(s => { pts.push(s.tgt, s.cur); if ($('showFov').checked) pts.push(...fovCorners(s)); });
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
  const toScreen = p => ({ x: canvas.clientWidth / 2 + (p.x - view.cx) * view.scale, y: canvas.clientHeight / 2 - (p.y - view.cy) * view.scale });
  const toWorld = (sx, sy) => ({ x: view.cx + (sx - canvas.clientWidth / 2) / view.scale, y: view.cy - (sy - canvas.clientHeight / 2) / view.scale });

  function prepCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    return { c, w, h };
  }

  function draw(r) {
    if (!r || canvas.clientWidth === 0) return;
    const { w, h } = prepCanvas(canvas);
    if (!view) fitView(r);
    drawGrid(w, h);
    const k = Math.max(1, +$('exaggerate').value || 1);

    if ($('showAxes').checked) {
      ctx.strokeStyle = css('--axis'); ctx.fillStyle = css('--axis'); ctx.lineWidth = 2; ctx.font = '12px system-ui';
      state.platform.axes.forEach(a => {
        if (a.kind === 'rotary') return;
        const s = toScreen(a.kind === 'linear' ? { x: r.rc.x + +a.px, y: r.rc.y + +a.py } : r.rc);
        const d = +a.dir * VA.D2R, sg = a.sign < 0 ? -1 : 1;
        const ex = s.x + Math.cos(d) * 40 * sg, ey = s.y - Math.sin(d) * 40 * sg;
        arrow(ctx, s.x, s.y, ex, ey);
        ctx.fillText(a.name, ex + 4, ey - 4);
      });
    }
    const rcs = toScreen(r.rc);
    ctx.strokeStyle = css('--rc'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(rcs.x, rcs.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rcs.x - 11, rcs.y); ctx.lineTo(rcs.x + 11, rcs.y); ctx.moveTo(rcs.x, rcs.y - 11); ctx.lineTo(rcs.x, rcs.y + 11); ctx.stroke();

    const drawnFov = new Set();
    visibleShots(r).forEach(s => {
      const color = camColor(+s.shot.cam);
      const active = s.inStep && s.shot.enabled;
      ctx.globalAlpha = active ? 1 : 0.3;
      const key = `${s.shot.cam}|${s.shot.gx}|${s.shot.gy}`;
      if ($('showFov').checked && !drawnFov.has(key)) {
        drawnFov.add(key);
        const cs = fovCorners(s).map(toScreen);
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.beginPath(); cs.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.fillRect(cs[0].x - 3, cs[0].y - 3, 6, 6);
      }
      const t = toScreen(s.tgt);
      const cd = toScreen({ x: s.tgt.x + s.err.x * k, y: s.tgt.y + s.err.y * k });
      ctx.strokeStyle = css('--cur'); ctx.lineWidth = 1.5; arrow(ctx, t.x, t.y, cd.x, cd.y);
      dot(ctx, t, css('--tgt'), 5, true);
      dot(ctx, cd, css('--cur'), 5, true);
      if (s.pred) dot(ctx, toScreen({ x: s.tgt.x + (s.pred.x - s.tgt.x) * k, y: s.tgt.y + (s.pred.y - s.tgt.y) * k }), css('--pred'), 6, false);
      ctx.fillStyle = css('--text'); ctx.font = '12px system-ui';
      ctx.fillText(s.shot.name, t.x + 8, t.y - 8);
      ctx.globalAlpha = 1;
    });
  }

  function drawGrid(w, h) {
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
    const o = toScreen({ x: 0, y: 0 });
    ctx.strokeStyle = css('--fov'); ctx.beginPath(); ctx.moveTo(o.x, 0); ctx.lineTo(o.x, h); ctx.moveTo(0, o.y); ctx.lineTo(w, o.y); ctx.stroke();
  }

  function dot(c, p, color, r, filled) {
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (filled) { c.fillStyle = color; c.fill(); } else { c.strokeStyle = color; c.lineWidth = 2; c.stroke(); }
  }
  function arrow(c, x0, y0, x1, y1) {
    const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
    if (L > 6) {
      c.moveTo(x1, y1); c.lineTo(x1 - 7 * Math.cos(a - 0.4), y1 - 7 * Math.sin(a - 0.4));
      c.moveTo(x1, y1); c.lineTo(x1 - 7 * Math.cos(a + 0.4), y1 - 7 * Math.sin(a + 0.4));
    }
    c.stroke();
  }

  // 影像視圖：每個拍照點在自己相機影像中的實際像素位置（看 mark 是否還在視野內）
  function drawPixViews(r) {
    if (!r) return;
    const list = r.shots.filter(s => !s.invalid && s.inStep);
    const box = $('pixViews');
    if (box.children.length !== list.length) {
      box.innerHTML = list.map(() => '<div class="pixview"><div class="cap"><b></b><span></span></div><canvas></canvas></div>').join('');
    }
    list.forEach((s, k) => {
      const el = box.children[k];
      el.querySelector('b').textContent = s.shot.name;
      const dpx = Math.hypot(+s.curPix.u - s.shot.tgt.u, +s.curPix.v - s.shot.tgt.v);
      el.querySelector('span').textContent = `${fmt(dpx, 1)} px${s.outside ? '・超出視野' : ''}`;
      const cv = el.querySelector('canvas');
      if (!cv.clientWidth) return;
      const { c, w, h } = prepCanvas(cv);
      const W = s.ci.cam.width, H = s.ci.cam.height;
      const sc = Math.min(w / W, h / H) * 0.9, ox = (w - W * sc) / 2, oy = (h - H * sc) / 2;
      const P = (u, v) => ({ x: ox + u * sc, y: oy + v * sc });
      c.strokeStyle = camColor(+s.shot.cam); c.lineWidth = 1.5; c.strokeRect(ox, oy, W * sc, H * sc);
      c.strokeStyle = css('--grid'); c.beginPath();
      c.moveTo(ox + W * sc / 2, oy); c.lineTo(ox + W * sc / 2, oy + H * sc); c.moveTo(ox, oy + H * sc / 2); c.lineTo(ox + W * sc, oy + H * sc / 2); c.stroke();
      const t = P(+s.shot.tgt.u, +s.shot.tgt.v);
      const cu = P(Math.max(-W * 0.04, Math.min(W * 1.04, +s.curPix.u)), Math.max(-H * 0.04, Math.min(H * 1.04, +s.curPix.v)));
      c.strokeStyle = css('--cur'); c.lineWidth = 1; arrow(c, t.x, t.y, cu.x, cu.y);
      dot(c, t, css('--tgt'), 4, true);
      dot(c, cu, css('--cur'), 4, true);
    });
  }

  // ---------- 模擬迭代（單步） ----------
  function simulateStep() {
    const r = VA.compute(state);
    if (!r.move) return;
    const sim = state.sim;
    const g = 1 + (+sim.gainErr) / 100;
    const th = r.move.theta * g, T = { x: r.move.T.x * g, y: r.move.T.y * g };
    const rcTrue = { x: r.rc.x + +sim.rcErrX, y: r.rc.y + +sim.rcErrY };
    state.history.push({ step: r.step.name, stepIdx: r.stepIdx, maxErr: r.maxErr, dx: r.move.T.x, dy: r.move.T.y, dt: r.move.theta * VA.R2D });
    // 工件實際移動 → 所有拍照點（含其他步驟）的影像位置跟著改變
    r.shots.forEach(s => {
      if (s.invalid) return;
      const moved = VA.applyMove(s.cur, th, T, rcTrue);
      const w = VA.stageToCamWorld(state, s.shot, moved);
      const px = VA.worldToPix(s.ci.m, w.x, w.y);
      const n = +sim.noisePx || 0;
      s.shot.cur.u = +(px.u + n * VA.gauss()).toFixed(3);
      s.shot.cur.v = +(px.v + n * VA.gauss()).toFixed(3);
      s.shot.cur.ang = +((+s.shot.cur.ang) + th * VA.R2D).toFixed(5);
    });
    if (state.platform.preset === 'XYT') {
      state.platform.pos.x = +(+state.platform.pos.x + r.move.T.x).toFixed(6);
      state.platform.pos.y = +(+state.platform.pos.y + r.move.T.y).toFixed(6);
    }
  }

  // ---------- 更新 ----------
  const listeners = [];
  function update(opts = {}) {
    if (opts.platform) renderPlatform();
    if (opts.steps) renderSteps();
    if (opts.cameras) renderCameras();
    if (opts.shots) renderShots();
    if (opts.static) syncStatic();
    lastResult = VA.compute(state);
    renderResults(lastResult);
    if (opts.fit) view = null;
    draw(lastResult);
    drawPixViews(lastResult);
    save();
    listeners.forEach(fn => fn(opts));
  }
  function syncStatic() {
    document.querySelectorAll('[data-bind]').forEach(el => {
      if (el.closest('#cameraList, #axisRows, #shotList, #stepRows, #procMounts, #tab-multi')) return;
      const v = getPath(state, el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
  }
  const ALL = { platform: true, steps: true, cameras: true, shots: true, static: true, fit: true };
  function fullRender() { update(ALL); }

  // ---------- 事件 ----------
  // live：輸入中（不重繪輸入框以免失去焦點）；否則為 change（可重繪）
  function onBound(el, live) {
    const path = el.dataset.bind;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'number' || el.dataset.num) { if (el.value === '' || isNaN(+el.value)) return; val = +el.value; }
    else val = el.value;
    setPath(state, path, val);
    if (path.startsWith('scen.')) { save(); return; }
    if (live) { update({}); return; }
    if (el.dataset.rerenderAll) { update({ steps: true, shots: true, cameras: true }); return; }
    const rer = !!el.dataset.rerender || /\.enabled$/.test(path);
    update({
      cameras: (rer && path.startsWith('cameras')) || /^cameras\.\d+\.(optics|width|height)/.test(path),
      shots: (rer && path.startsWith('shots')) || path.startsWith('platform.gantry'),
      fit: /\.cam$|\.step$|gantry/.test(path)
    });
  }
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.bind) onBound(el, false);
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset && el.dataset.bind && el.tagName === 'INPUT' && el.type !== 'checkbox') { onBound(el, true); return; }
    if (el.dataset && el.dataset.bindSign !== undefined) {
      state.platform.axes[+el.dataset.bindSign].sign = el.checked ? -1 : 1;
      update();
    }
    if (['exaggerate', 'showFov', 'showAxes'].includes(el.id)) draw(lastResult);
    if (el.id === 'showAll') update({ fit: true });
  });

  $('platformPreset').addEventListener('change', e => {
    const key = e.target.value;
    state.platform.preset = key;
    if (key !== 'CUSTOM') state.platform.axes = clone(VA.PLATFORMS[key].axes);
    update({ platform: true, fit: true });
  });
  $('activeStep').addEventListener('change', e => { state.activeStep = +e.target.value; update({ shots: true, fit: true }); });
  $('btnAddAxis').addEventListener('click', () => {
    state.platform.axes.push({ name: 'A' + (state.platform.axes.length + 1), kind: 'linear', px: 0, py: 0, dir: 0, sign: 1 });
    update({ platform: true });
  });
  $('axisRows').addEventListener('click', e => {
    const i = e.target.dataset.delAxis;
    if (i !== undefined) { state.platform.axes.splice(+i, 1); update({ platform: true }); }
  });
  $('cameraList').addEventListener('change', e => {
    const i = e.target.dataset.sensor;
    if (i === undefined) return;
    const cam = state.cameras[+i], s = VA.SENSORS[e.target.value];
    cam.optics.sensor = e.target.value;
    if (e.target.value !== 'CUSTOM') Object.assign(cam.optics, { width: s.width, height: s.height, pixel: s.pixel });
    update({ cameras: true });
  });
  $('cameraList').addEventListener('click', e => {
    const i = e.target.dataset.applyOptics;
    if (i === undefined) return;
    const cam = state.cameras[+i], o = VA.opticsSummary(cam.optics);
    cam.width = +cam.optics.width; cam.height = +cam.optics.height;
    cam.simple.mmppX = cam.simple.mmppY = +o.mmpp.toFixed(8);
    cam.calMode = 'simple';
    update({ cameras: true, fit: true });
  });
  $('shotList').addEventListener('click', e => {
    const i = e.target.dataset.setTarget;
    if (i !== undefined) { const s = state.shots[+i]; s.tgt = clone(s.cur); update({ shots: true }); }
  });
  $('btnCamPlus').addEventListener('click', () => {
    if (state.cameras.length >= 16) return;
    const n = state.cameras.length;
    state.cameras.push(VA.newCamera(n));
    const s = VA.newShot(state.shots.length, n, state.activeStep);
    s.name = state.cameras[n].name;
    state.shots.push(s);
    update({ cameras: true, shots: true, fit: true });
  });
  $('btnCamMinus').addEventListener('click', () => {
    if (state.cameras.length <= 1) return;
    const last = state.cameras.length - 1;
    state.cameras.pop();
    state.shots = state.shots.filter(s => +s.cam !== last);
    if (!state.shots.length) state.shots.push(VA.newShot(0, 0));
    update({ cameras: true, shots: true, fit: true });
  });
  $('btnShotPlus').addEventListener('click', () => {
    if (state.shots.length >= 64) return;
    const prev = state.shots[state.shots.length - 1];
    const s = VA.newShot(state.shots.length, prev ? +prev.cam : 0, state.activeStep);
    if (prev) { s.gx = prev.gx; s.gy = prev.gy; }
    state.shots.push(s);
    update({ shots: true, fit: true });
  });
  $('btnShotMinus').addEventListener('click', () => {
    if (state.shots.length <= 1) return;
    state.shots.pop();
    update({ shots: true, fit: true });
  });
  $('btnStepPlus').addEventListener('click', () => {
    if (state.steps.length >= 6) return;
    state.steps.push({ name: '步驟' + (state.steps.length + 1), tol: 0.01, maxIter: 5, gain: 100 });
    update({ steps: true, shots: true });
  });
  $('btnStepMinus').addEventListener('click', () => {
    if (state.steps.length <= 1) return;
    const last = state.steps.length - 1;
    state.steps.pop();
    state.shots.forEach(s => { if (+s.step === last) s.step = last - 1; });
    update({ steps: true, shots: true, fit: true });
  });

  $('btnStep').addEventListener('click', () => { simulateStep(); update({ shots: true, static: true }); });
  $('btnStep5').addEventListener('click', () => { for (let k = 0; k < 5; k++) simulateStep(); update({ shots: true, static: true }); });
  $('btnClearHist').addEventListener('click', () => { state.history = []; update(); });
  $('btnFit').addEventListener('click', () => { view = null; draw(lastResult); });
  $('btnCopy').addEventListener('click', () => {
    const txt = resultText(lastResult);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => prompt('複製以下內容', txt));
    else prompt('複製以下內容', txt);
  });

  const scSel = $('scenarioSelect');
  for (const [k, sc] of Object.entries(VA.SCENARIOS)) scSel.add(new Option(sc.label, k));
  scSel.addEventListener('change', () => {
    const k = scSel.value; scSel.value = '';
    if (!k) return;
    state = VA.SCENARIOS[k].make();
    $('cameraList').innerHTML = '';
    fullRender();
  });
  $('btnReset').addEventListener('click', () => {
    if (confirm('確定要清除所有設定？')) { state = VA.defaultState(); $('cameraList').innerHTML = ''; fullRender(); }
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
      const s = VA.migrate(JSON.parse(t));
      if (!s) throw new Error('格式不符');
      state = s;
      $('cameraList').innerHTML = '';
      fullRender();
    }).catch(err => alert('匯入失敗：' + err.message));
    e.target.value = '';
  });

  // 分頁
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tabpage').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
    try { localStorage.setItem('va-tab', name); } catch (e) { /* 忽略 */ }
    if (name === 'align') { view = null; draw(lastResult); drawPixViews(lastResult); }
    listeners.forEach(fn => fn({ tab: name }));
  }
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  // 平移 / 縮放
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', e => {
    if (!view) return;
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
    if (!view) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const before = toWorld(sx, sy);
    view.scale *= e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const after = toWorld(sx, sy);
    view.cx += before.x - after.x; view.cy += before.y - after.y;
    draw(lastResult);
  }, { passive: false });
  window.addEventListener('resize', () => { draw(lastResult); drawPixViews(lastResult); });

  window.App = {
    get state() { return state; },
    set state(s) { state = s; },
    update, fullRender, save, esc, css, camColor, prepCanvas, dot, arrow, showTab,
    onUpdate: fn => listeners.push(fn),
    get result() { return lastResult; }
  };

  fullRender();
  // 初始分頁：網址 #multi / #calib… 優先，其次上次使用的分頁。
  // 等所有 script 都執行完（DOMContentLoaded）再切換，各分頁的監聽才都已註冊。
  function initialTab() {
    let t = (location.hash || '').slice(1);
    if (!['layout', 'align', 'multi', 'proc', 'calib', 'scen', 'help'].includes(t)) { try { t = localStorage.getItem('va-tab'); } catch (e) { t = null; } }
    showTab(t || 'layout');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialTab);
  else setTimeout(initialTab, 0);
})();
