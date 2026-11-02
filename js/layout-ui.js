// 「圖形設定」頁：俯視配置圖（可點選、拖曳）＋ 屬性面板（圖卡選擇）＋ 流程管線
(function () {
  'use strict';
  const VA = window.VA, App = window.App;
  const $ = id => document.getElementById(id);
  const esc = s => App.esc(s);
  const fmt = VA.fmt;
  const ALL = { platform: true, steps: true, cameras: true, shots: true, static: true, fit: true };

  const LENS_PRESETS = [
    { key: 'e16', label: '16 mm 鏡頭', sub: '工作距離 360 mm・大視野粗對位', optics: { lens: 'entocentric', f: 16, wd: 360, mag: 0, dof: 5 } },
    { key: 'e25', label: '25 mm 鏡頭', sub: '工作距離 300 mm', optics: { lens: 'entocentric', f: 25, wd: 300, mag: 0, dof: 3 } },
    { key: 'e50', label: '50 mm 鏡頭', sub: '工作距離 300 mm', optics: { lens: 'entocentric', f: 50, wd: 300, mag: 0, dof: 1 } },
    { key: 't05', label: '0.5× 遠心', sub: '景深約 2 mm', optics: { lens: 'telecentric', f: 0, wd: 110, mag: 0.5, dof: 2 } },
    { key: 't1', label: '1× 遠心', sub: '景深約 0.8 mm', optics: { lens: 'telecentric', f: 0, wd: 110, mag: 1, dof: 0.8 } },
    { key: 't3', label: '3× 遠心', sub: '景深約 0.2 mm・精對位', optics: { lens: 'telecentric', f: 0, wd: 110, mag: 3, dof: 0.2 } }
  ];

  let sel = null;          // 'stage' | 'rc' | 'work' | 'cam:i' | 'mark:M1' | 'step:i' | null
  let view = null;         // { scale(px/mm), cx, cy }
  let busy = false;
  let lastBuild = null;

  const S = () => App.state;
  function ensure() {
    const s = S();
    s.layout = Object.assign(VA.defaultLayout(), s.layout || {});
    s.layout.work = Object.assign(VA.defaultLayout().work, s.layout.work || {});
    s.proc = Object.assign(VA.defaultProc(), s.proc || {});
    s.steps.forEach((st, i) => { if (!Array.isArray(st.cams)) st.cams = VA.stepCams(s, i); });
  }
  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, p, v) { const k = p.split('.'), l = k.pop(); k.reduce((a, x) => a[x], o)[l] = v; }

  // ---------- 共用：相機中心 ----------
  function camCenter(i) {
    const c = S().cameras[i], m = VA.cameraAffine(c);
    return VA.pixToWorld(m, c.width / 2, c.height / 2);
  }
  function moveCamera(i, dx, dy) {
    const c = S().cameras[i];
    if (c.calMode === 'simple') { c.simple.ox = +(+c.simple.ox + dx).toFixed(4); c.simple.oy = +(+c.simple.oy + dy).toFixed(4); }
    else { c.matrix.C = +(+c.matrix.C + dx).toFixed(6); c.matrix.F = +(+c.matrix.F + dy).toFixed(6); }
  }
  function camFov(i) {
    const c = S().cameras[i], m = VA.cameraAffine(c);
    return [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]].map(([u, v]) => VA.pixToWorld(m, u, v));
  }
  function applyLens(i, preset) {
    const c = S().cameras[i], sen = VA.SENSORS[c.optics.sensor] || VA.SENSORS['FH-5M'];
    const ctr = camCenter(i);
    c.optics = Object.assign({ sensor: c.optics.sensor === 'CUSTOM' ? 'FH-5M' : c.optics.sensor, width: sen.width, height: sen.height, pixel: sen.pixel }, preset.optics);
    if (c.optics.sensor === 'FH-5M') Object.assign(c.optics, { width: VA.SENSORS['FH-5M'].width, height: VA.SENSORS['FH-5M'].height, pixel: VA.SENSORS['FH-5M'].pixel });
    syncOptics(i, ctr);
  }
  // 依光學設定更新解析度與像素當量（保持相機中心位置）
  function syncOptics(i, ctr) {
    const c = S().cameras[i];
    ctr = ctr || camCenter(i);
    const o = VA.opticsSummary(c.optics);
    c.width = +c.optics.width; c.height = +c.optics.height;
    c.calMode = 'simple';
    c.simple = Object.assign(c.simple || {}, { mmppX: +o.mmpp.toFixed(8), mmppY: +o.mmpp.toFixed(8), ox: +ctr.x.toFixed(4), oy: +ctr.y.toFixed(4) });
    if (c.simple.flipY === undefined) c.simple.flipY = true;
  }

  // ---------- 提交變更 ----------
  function commit(structural) {
    const s = S();
    if (s.layout.auto) lastBuild = VA.applyBuild(s); else lastBuild = VA.buildShots(s);
    busy = true;
    App.update(structural ? ALL : {});
    busy = false;
    renderSvg(); renderPipeline();
    if (structural) renderInspector();
  }

  // ---------- 俯視圖 ----------
  const svgEl = $('guiSvg');
  function bounds() {
    const s = S(), L = s.layout, pts = [{ x: -L.stageW / 2, y: -L.stageH / 2 }, { x: L.stageW / 2, y: L.stageH / 2 }];
    s.cameras.forEach((c, i) => pts.push(...camFov(i)));
    pts.push(VA.effectiveRc(s));
    const xs = pts.map(p => p.x).filter(Number.isFinite), ys = pts.map(p => p.y).filter(Number.isFinite);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  function fit() {
    const b = bounds(), w = svgEl.clientWidth || 600, h = svgEl.clientHeight || 400;
    view = { scale: Math.min(w / Math.max(b.x1 - b.x0, 1), h / Math.max(b.y1 - b.y0, 1)) * 0.82, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
  }
  const W2S = p => ({ x: svgEl.clientWidth / 2 + (p.x - view.cx) * view.scale, y: svgEl.clientHeight / 2 - (p.y - view.cy) * view.scale });
  const S2W = (x, y) => ({ x: view.cx + (x - svgEl.clientWidth / 2) / view.scale, y: view.cy - (y - svgEl.clientHeight / 2) / view.scale });
  const poly = (pts, cls, extra = '') => `<polygon points="${pts.map(p => { const q = W2S(p); return q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' ')}" class="${cls}" ${extra}/>`;
  const txt = (p, t, cls = 'g-t', anchor = 'middle', dy = 0) => { const q = W2S(p); return `<text x="${q.x.toFixed(1)}" y="${(q.y + dy).toFixed(1)}" class="${cls}" text-anchor="${anchor}">${esc(t)}</text>`; };

  function renderSvg() {
    const s = S(), L = s.layout;
    if (!svgEl.clientWidth) return;
    if (!view) fit();
    const rc = VA.effectiveRc(s);
    let h = '';
    // 格線
    const target = 70 / view.scale, p10 = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map(m => m * p10).find(x => x >= target);
    const tl = S2W(0, 0), br = S2W(svgEl.clientWidth, svgEl.clientHeight);
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) { const q = W2S({ x, y: 0 }); h += `<line x1="${q.x}" y1="0" x2="${q.x}" y2="${svgEl.clientHeight}" class="g-grid"/>`; }
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) { const q = W2S({ x: 0, y }); h += `<line x1="0" y1="${q.y}" x2="${svgEl.clientWidth}" y2="${q.y}" class="g-grid"/>`; }
    h += `<text x="8" y="${svgEl.clientHeight - 8}" class="g-m">格線 ${+step.toPrecision(3)} mm</text>`;

    // 平台
    const sw = L.stageW / 2, sh = L.stageH / 2;
    h += `<g data-hit="stage" class="hit${sel === 'stage' ? ' sel' : ''}">${poly([{ x: -sw, y: -sh }, { x: sw, y: -sh }, { x: sw, y: sh }, { x: -sw, y: sh }], 'g-stage')}
      ${txt({ x: -sw, y: sh }, `平台 ${L.stageW}×${L.stageH}・${(VA.PLATFORMS[s.platform.preset] || {}).label || ''}`, 'g-m', 'start', -6)}</g>`;
    // 軸
    s.platform.axes.forEach(a => {
      if (a.kind === 'rotary') return;
      const b = W2S(a.kind === 'linear' ? { x: rc.x + +a.px, y: rc.y + +a.py } : rc);
      const d = +a.dir * VA.D2R, sg = a.sign < 0 ? -1 : 1, ex = b.x + Math.cos(d) * 34 * sg, ey = b.y - Math.sin(d) * 34 * sg;
      h += `<line x1="${b.x}" y1="${b.y}" x2="${ex}" y2="${ey}" class="g-axis" marker-end="url(#gah)"/><text x="${ex + 4}" y="${ey - 4}" class="g-axist">${esc(a.name)}</text>`;
    });
    // 工件
    const w = L.work, wx = +w.x || 0, wy = +w.y || 0;
    h += `<g data-hit="work" class="hit${sel === 'work' ? ' sel' : ''}">${poly([{ x: wx - w.w / 2, y: wy - w.h / 2 }, { x: wx + w.w / 2, y: wy - w.h / 2 }, { x: wx + w.w / 2, y: wy + w.h / 2 }, { x: wx - w.w / 2, y: wy + w.h / 2 }], 'g-work')}
      ${txt({ x: wx + w.w / 2, y: wy - w.h / 2 }, `工件 ${w.w}×${w.h}`, 'g-m', 'end', 14)}</g>`;

    // 各拍照點在平台上看到的視野（有線馬時才會與相機原位不同）
    const shown = new Set();
    s.shots.forEach(sh => {
      if (!sh.enabled || (!+sh.gx && !+sh.gy)) return;
      const c = s.cameras[sh.cam]; if (!c) return;
      const m = VA.cameraAffine(c);
      const corners = [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]].map(([u, v]) => VA.shotToStage(s, sh, VA.pixToWorld(m, u, v)));
      const key = sh.cam + '|' + sh.gx + '|' + sh.gy; if (shown.has(key)) return; shown.add(key);
      const sq = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) * view.scale;
      if (sq < 10) {
        // 視野在此縮放下太小：畫固定大小的方框標示線馬拍照位置
        const ce = W2S({ x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 });
        h += `<rect x="${ce.x - 7}" y="${ce.y - 7}" width="14" height="14" class="g-shotfov" style="stroke:${App.camColor(+sh.cam)}"/>`;
      } else h += poly(corners, 'g-shotfov', `style="stroke:${App.camColor(+sh.cam)}"`);
    });

    // 相機
    s.cameras.forEach((c, i) => {
      const fov = camFov(i), ctr = camCenter(i), col = App.camColor(i), q = W2S(ctr);
      const sz = Math.hypot(fov[1].x - fov[0].x, fov[1].y - fov[0].y) * view.scale;
      const mount = s.proc.mounts[i] || 'down';
      const o = VA.opticsSummary(c.optics);
      h += `<g data-hit="cam:${i}" class="hit${sel === 'cam:' + i ? ' sel' : ''}">${poly(fov, 'g-fovhit')}${poly(fov, 'g-fov', `style="stroke:${col}"`)}`;
      if (sz < 26) h += `<circle cx="${q.x}" cy="${q.y}" r="13" class="g-camsym" style="stroke:${col}"/><line x1="${q.x - 9}" y1="${q.y}" x2="${q.x + 9}" y2="${q.y}" style="stroke:${col}" class="g-cross"/><line x1="${q.x}" y1="${q.y - 9}" x2="${q.x}" y2="${q.y + 9}" style="stroke:${col}" class="g-cross"/>`;
      h += `<circle cx="${q.x}" cy="${q.y}" r="7" class="g-handle" style="stroke:${col}"/>`;
      const label = `${c.name}${mount === 'up' ? '（上視）' : mount === 'gantry' ? '（線馬）' : ''}`;
      const ty = Math.max(sz, 26) / 2 + 14;
      h += `<text x="${q.x}" y="${q.y - ty + 4}" class="g-camt" text-anchor="middle" style="fill:${col}">${esc(label)}</text>`;
      h += `<text x="${q.x}" y="${q.y + ty + 2}" class="g-m" text-anchor="middle">${esc(`${c.optics.lens === 'telecentric' ? c.optics.mag + '× 遠心' : c.optics.f + ' mm'}・${fmt(o.mmpp * 1000, 2)} µm/px`)}</text></g>`;
      // 相機在平台外（工位）且有線馬：畫線馬移動箭頭
      if (s.platform.gantry.enabled && (Math.abs(ctr.x) > L.stageW / 2 || Math.abs(ctr.y) > L.stageH / 2)) {
        const edge = { x: Math.max(-L.stageW / 2, Math.min(L.stageW / 2, ctr.x)), y: Math.max(-L.stageH / 2, Math.min(L.stageH / 2, ctr.y)) };
        const a = W2S(edge), b = W2S(ctr);
        const r = Math.max(sz, 26) / 2 + 4, d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x - (b.x - a.x) / d * r}" y2="${b.y - (b.y - a.y) / d * r}" class="g-gantry" marker-end="url(#gah)"/>`;
        h += `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}" class="g-m" text-anchor="middle">線馬移動</text>`;
      }
    });

    // Mark
    const rep = lastBuild || VA.buildShots(s);
    const failSet = new Set(rep.report.flatMap(r => r.fail));
    VA.markPositions(L).forEach(mk => {
      const q = W2S(mk), bad = failSet.has(mk.name);
      h += `<g data-hit="mark:${mk.name}" class="hit${sel === 'mark:' + mk.name ? ' sel' : ''}"><circle cx="${q.x}" cy="${q.y}" r="6" class="${bad ? 'g-markbad' : 'g-mark'}"/>
        <text x="${q.x + 9}" y="${q.y - 8}" class="g-t">${esc(mk.name)}</text></g>`;
    });
    // 旋轉中心
    const r = W2S(rc);
    h += `<g data-hit="rc" class="hit${sel === 'rc' ? ' sel' : ''}"><circle cx="${r.x}" cy="${r.y}" r="9" class="g-rc"/>
      <line x1="${r.x - 14}" y1="${r.y}" x2="${r.x + 14}" y2="${r.y}" class="g-rcl"/><line x1="${r.x}" y1="${r.y - 14}" x2="${r.x}" y2="${r.y + 14}" class="g-rcl"/>
      <text x="${r.x + 12}" y="${r.y + 22}" class="g-rct">旋轉中心</text></g>`;

    svgEl.innerHTML = `<defs><marker id="gah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="g-ahead"/></marker></defs>` + h;
  }

  // 拖曳 / 選取 / 平移 / 縮放
  let drag = null;
  svgEl.addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-hit]');
    const rect = svgEl.getBoundingClientRect();
    const w0 = S2W(e.clientX - rect.left, e.clientY - rect.top);
    svgEl.setPointerCapture(e.pointerId);
    if (g) {
      const hit = g.dataset.hit;
      if (sel !== hit) { sel = hit; renderInspector(); renderSvg(); }
      drag = { hit, last: w0, moved: false };
    } else {
      drag = { pan: true, x: e.clientX, y: e.clientY };
    }
  });
  svgEl.addEventListener('pointermove', e => {
    if (!drag) return;
    const rect = svgEl.getBoundingClientRect();
    if (drag.pan) {
      view.cx -= (e.clientX - drag.x) / view.scale; view.cy += (e.clientY - drag.y) / view.scale;
      drag.x = e.clientX; drag.y = e.clientY; renderSvg(); return;
    }
    const w = S2W(e.clientX - rect.left, e.clientY - rect.top);
    let dx = w.x - drag.last.x, dy = w.y - drag.last.y;
    if (!drag.moved && Math.hypot(dx, dy) * view.scale < 3) return;
    drag.moved = true; drag.last = w;
    const s = S();
    if (drag.hit.startsWith('cam:')) moveCamera(+drag.hit.slice(4), dx, dy);
    else if (drag.hit === 'rc') { s.platform.rc.x = +(+s.platform.rc.x + dx).toFixed(4); s.platform.rc.y = +(+s.platform.rc.y + dy).toFixed(4); }
    else if (drag.hit === 'work') { s.layout.work.x = +(+s.layout.work.x + dx).toFixed(3); s.layout.work.y = +(+s.layout.work.y + dy).toFixed(3); }
    else return;
    lastBuild = VA.buildShots(s);
    renderSvg();
  });
  svgEl.addEventListener('pointerup', () => {
    if (drag && drag.moved && !drag.pan) commit(true);
    drag = null;
  });
  svgEl.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svgEl.getBoundingClientRect(), sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const before = S2W(sx, sy);
    view.scale *= e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const after = S2W(sx, sy);
    view.cx += before.x - after.x; view.cy += before.y - after.y;
    renderSvg();
  }, { passive: false });

  // ---------- 圖示 ----------
  function platformIcon(key) {
    const p = VA.PLATFORMS[key];
    let h = '<rect x="10" y="10" width="40" height="40" rx="3" class="i-stage"/>';
    if (!p.axes.length) h += '<text x="30" y="36" text-anchor="middle" class="i-t">?</text>';
    p.axes.forEach(a => {
      if (a.kind === 'rotary') { h += '<path d="M38,22 A11,11 0 1 1 22,22" class="i-ax" marker-end="url(#iah)"/>'; return; }
      const bx = 30 + (a.kind === 'linear' ? +a.px : 0) * 0.2, by = 30 - (a.kind === 'linear' ? +a.py : 0) * 0.2;
      const d = +a.dir * VA.D2R, ex = bx + Math.cos(d) * 13, ey = by - Math.sin(d) * 13;
      h += `<line x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" class="i-ax${a.kind === 'linearRot' ? ' rot' : ''}" marker-end="url(#iah)"/><circle cx="${bx}" cy="${by}" r="2" class="i-pt"/>`;
    });
    return `<svg viewBox="0 0 60 60" class="icon"><defs><marker id="iah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="i-head"/></marker></defs>${h}</svg>`;
  }
  function patternIcon(key) {
    const L = { stageW: 60, stageH: 60, work: { w: 44, h: 32, inset: 5, pattern: key, x: 0, y: 0 } };
    const dots = VA.markPositions(L).map(m => `<circle cx="${30 + m.x}" cy="${30 - m.y}" r="3.5" class="i-mark"/>`).join('');
    return `<svg viewBox="0 0 60 60" class="icon"><rect x="8" y="14" width="44" height="32" rx="2" class="i-work"/>${dots}</svg>`;
  }
  function mountIcon(key) {
    const cam = (x, y) => `<rect x="${x - 9}" y="${y - 6}" width="18" height="12" rx="2" class="i-cam"/>`;
    if (key === 'up') return `<svg viewBox="0 0 60 60" class="icon"><rect x="8" y="12" width="44" height="8" class="i-stage"/>${cam(30, 46)}<line x1="30" y1="39" x2="30" y2="24" class="i-ax" marker-end="url(#iah2)"/>${iah2}</svg>`;
    if (key === 'gantry') return `<svg viewBox="0 0 60 60" class="icon"><line x1="6" y1="12" x2="54" y2="12" class="i-rail"/>${cam(24, 18)}<line x1="34" y1="18" x2="48" y2="18" class="i-ax" marker-end="url(#iah2)"/><rect x="8" y="44" width="44" height="8" class="i-stage"/>${iah2}</svg>`;
    return `<svg viewBox="0 0 60 60" class="icon">${cam(30, 14)}<line x1="30" y1="21" x2="30" y2="38" class="i-ax" marker-end="url(#iah2)"/><rect x="8" y="42" width="44" height="8" class="i-stage"/>${iah2}</svg>`;
  }
  const iah2 = '<defs><marker id="iah2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="i-head"/></marker></defs>';
  function lensIcon(p) {
    const tele = p.optics.lens === 'telecentric';
    return `<svg viewBox="0 0 60 60" class="icon"><rect x="18" y="6" width="24" height="14" rx="2" class="i-cam"/>
      <rect x="${tele ? 20 : 24}" y="20" width="${tele ? 20 : 12}" height="${tele ? 22 : 10}" class="i-lens"/>
      <path d="M${tele ? 20 : 24},${tele ? 42 : 30} L${tele ? 20 : 6},54 M${tele ? 40 : 36},${tele ? 42 : 30} L${tele ? 40 : 54},54" class="i-ray"/></svg>`;
  }
  const card = (attr, active, icon, title, sub) => `<button type="button" class="gcard${active ? ' on' : ''}" ${attr}>${icon}<span class="gc-t">${esc(title)}</span>${sub ? `<span class="gc-s">${esc(sub)}</span>` : ''}</button>`;
  const field = (path, label, val, extra = '') => `<div class="field"><label>${label}</label><input type="number" step="any" data-g="${path}" value="${val}" ${extra}></div>`;

  // ---------- 屬性面板 ----------
  function renderInspector() {
    const s = S(), box = $('guiInspector');
    if (!sel) { box.innerHTML = overviewHtml(); return; }
    if (sel === 'stage') {
      const g = s.platform.gantry;
      box.innerHTML = `<h2>平台</h2>
        <h3>平台種類</h3><div class="gcards">${Object.keys(VA.PLATFORMS).map(k => card(`data-platform="${k}"`, s.platform.preset === k, platformIcon(k), VA.PLATFORMS[k].label.replace(/（.*）/, ''), (VA.PLATFORMS[k].label.match(/（(.*)）/) || [])[1] || '')).join('')}</div>
        <p class="hint">${esc((VA.PLATFORMS[s.platform.preset] || {}).note || '')}</p>
        <h3>尺寸</h3><div class="grid2">${field('layout.stageW', '寬 (mm)', s.layout.stageW)}${field('layout.stageH', '深 (mm)', s.layout.stageH)}</div>
        <h3>XY 線馬（拍照位置移動）</h3>
        <div class="gcards three">
          ${card('data-gantry="off"', !g.enabled, '<svg viewBox="0 0 60 60" class="icon"><rect x="8" y="24" width="44" height="12" class="i-stage"/></svg>', '無', '')}
          ${card('data-gantry="stage"', g.enabled && g.mode === 'stage', '<svg viewBox="0 0 60 60" class="icon"><line x1="4" y1="46" x2="56" y2="46" class="i-rail"/><rect x="10" y="30" width="26" height="12" class="i-stage"/><line x1="38" y1="36" x2="52" y2="36" class="i-ax" marker-end="url(#iah3)"/><defs><marker id="iah3" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="i-head"/></marker></defs></svg>', '移動平台', '相機固定')}
          ${card('data-gantry="camera"', g.enabled && g.mode === 'camera', mountIcon('gantry'), '移動相機', '平台固定')}
        </div>
        ${s.platform.preset === 'XYT' ? `<h3>XYθ 目前 XY 軸位置</h3><div class="grid2">${field('platform.pos.x', 'X (mm)', s.platform.pos.x)}${field('platform.pos.y', 'Y (mm)', s.platform.pos.y)}</div>` : ''}
        <details><summary>軸參數（${s.platform.axes.length} 軸）</summary><p class="hint">致動點與方向可在「對位計算 → 軸設定」細調。</p>
          <table><tr><th>軸</th><th>類型</th><th>致動點</th><th>方向</th></tr>${s.platform.axes.map(a => `<tr><td>${esc(a.name)}</td><td>${a.kind === 'rotary' ? '旋轉' : '直線'}</td><td>${a.kind === 'linear' ? `${a.px}, ${a.py}` : '—'}</td><td>${a.kind === 'rotary' ? '—' : a.dir + '°'}</td></tr>`).join('')}</table></details>`;
    } else if (sel === 'rc') {
      box.innerHTML = `<h2>旋轉中心</h2>
        <div class="grid2">${field('platform.rc.x', 'X (mm)', s.platform.rc.x)}${field('platform.rc.y', 'Y (mm)', s.platform.rc.y)}</div>
        <p class="hint">可直接在圖上拖曳。實際數值請以「校正工具 → 旋轉中心」量測後套用；做法見「校正手順」。</p>
        <button type="button" class="small" data-goto="calib">到校正工具</button> <button type="button" class="small" data-goto="proc">看校正手順</button>`;
    } else if (sel === 'work') {
      const w = s.layout.work;
      box.innerHTML = `<h2>工件與 Mark</h2>
        <h3>Mark 排列</h3><div class="gcards">${Object.entries(VA.PATTERNS).map(([k, p]) => card(`data-pattern="${k}"`, w.pattern === k, patternIcon(k), p.label, '')).join('')}</div>
        <h3>尺寸與位置</h3>
        <div class="grid2">${field('layout.work.w', '寬 (mm)', w.w)}${field('layout.work.h', '高 (mm)', w.h)}</div>
        <div class="grid3">${field('layout.work.inset', 'Mark 距邊 (mm)', w.inset)}${field('layout.work.x', '中心 X', w.x)}${field('layout.work.y', '中心 Y', w.y)}</div>
        <p class="hint">可直接在圖上拖曳工件。Mark 座標：${VA.markPositions(s.layout).map(m => `${m.name} (${fmt(m.x, 1)}, ${fmt(m.y, 1)})`).join('、')}</p>`;
    } else if (sel.startsWith('cam:')) {
      const i = +sel.slice(4), c = s.cameras[i];
      if (!c) { sel = null; renderInspector(); return; }
      const o = VA.opticsSummary(c.optics), ctr = camCenter(i), tele = c.optics.lens === 'telecentric';
      const mount = s.proc.mounts[i] || 'down';
      const lensKey = (LENS_PRESETS.find(p => p.optics.lens === c.optics.lens && (tele ? +p.optics.mag === +c.optics.mag : +p.optics.f === +c.optics.f)) || {}).key;
      box.innerHTML = `<h2><span class="swatch" style="background:${App.camColor(i)}"></span> 相機 <input class="gname" data-g="cameras.${i}.name" value="${esc(c.name)}" aria-label="相機名稱"></h2>
        <div class="readout"><div><b>${fmt(o.mmpp * 1000, 3)}</b><span>µm/px</span></div><div><b>${fmt(o.fovX, o.fovX < 10 ? 2 : 1)} × ${fmt(o.fovY, o.fovY < 10 ? 2 : 1)}</b><span>視野 mm</span></div><div><b>${c.width}×${c.height}</b><span>px</span></div></div>
        <h3>鏡頭（500 萬像素 FH 相機）</h3><div class="gcards three">${LENS_PRESETS.map(p => card(`data-lens="${p.key}"`, lensKey === p.key, lensIcon(p), p.label, p.sub)).join('')}</div>
        <details${lensKey ? '' : ' open'}><summary>自訂光學參數</summary>
          <div class="grid3">${field(`cameras.${i}.optics.pixel`, '像素 (µm)', c.optics.pixel)}${tele ? field(`cameras.${i}.optics.mag`, '倍率 ×', c.optics.mag) : field(`cameras.${i}.optics.f`, '焦距 (mm)', c.optics.f) + field(`cameras.${i}.optics.wd`, '工作距離 (mm)', c.optics.wd)}${field(`cameras.${i}.optics.dof`, '景深 (mm)', c.optics.dof)}</div>
          <div class="grid2">${field(`cameras.${i}.optics.width`, '寬 (px)', c.optics.width)}${field(`cameras.${i}.optics.height`, '高 (px)', c.optics.height)}</div>
        </details>
        <h3>安裝方式</h3><div class="gcards three">${Object.entries(VA.MOUNTS).map(([k, l]) => card(`data-mount="${k}"`, mount === k, mountIcon(k), l.split('・')[0], l.split('・')[1] || '')).join('')}</div>
        <h3>位置與角度</h3>
        <div class="grid3"><div class="field"><label>中心 X (mm)</label><input type="number" step="any" data-campos="x" value="${+ctr.x.toFixed(4)}"></div>
          <div class="field"><label>中心 Y (mm)</label><input type="number" step="any" data-campos="y" value="${+ctr.y.toFixed(4)}"></div>
          ${c.calMode === 'simple' ? field(`cameras.${i}.simple.angle`, '角度 (°)', c.simple.angle) : '<div class="field"><label>角度</label><span class="hint">矩陣模式</span></div>'}</div>
        <p class="hint">可直接在圖上拖曳相機。${c.calMode === 'matrix' ? '此相機使用校正矩陣，拖曳只平移 C、F。' : '套用鏡頭圖卡時，像素當量以光學值計算；實機請用九點校正結果。'}</p>
        <button type="button" class="small danger" data-delcam="${i}">刪除此相機</button>`;
    } else if (sel.startsWith('mark:')) {
      const name = sel.slice(5), mk = VA.markPositions(s.layout).find(m => m.name === name);
      const shots = s.shots.filter(x => x.mark === name);
      box.innerHTML = `<h2>Mark ${esc(name)}</h2>
        <p>位置（平台座標）：(${fmt(mk ? mk.x : NaN, 2)}, ${fmt(mk ? mk.y : NaN, 2)}) mm</p>
        <h3>拍照點</h3>${shots.length ? `<table><tr><th>名稱</th><th>步驟</th><th>相機</th><th>線馬 X/Y</th></tr>${shots.map(x => `<tr><td>${esc(x.name)}</td><td>${esc((s.steps[x.step] || {}).name || '')}</td><td>${esc((s.cameras[x.cam] || {}).name || '')}</td><td>${fmt(+x.gx, 2)}, ${fmt(+x.gy, 2)}</td></tr>`).join('')}</table>` : '<p class="warnings">沒有任何相機拍得到此 Mark。</p>'}
        <p class="hint">Mark 位置由工件尺寸與排列決定，點工件可修改。</p>`;
    }
    box.insertAdjacentHTML('afterbegin', '<button type="button" class="small back" data-desel="1">← 總覽</button>');
  }

  function overviewHtml() {
    const s = S(), b = lastBuild || VA.buildShots(s), L = s.layout, w = L.work;
    const checks = [];
    const fits = Math.abs(+w.x) + w.w / 2 <= L.stageW / 2 + 1e-9 && Math.abs(+w.y) + w.h / 2 <= L.stageH / 2 + 1e-9;
    checks.push([fits, fits ? `工件 ${w.w}×${w.h} mm 在平台 ${L.stageW}×${L.stageH} mm 內` : '工件超出平台範圍']);
    b.report.forEach(r => {
      const names = r.cams.map(i => (s.cameras[i] || {}).name).join('、') || '（未指定相機）';
      const okStep = !r.fail.length && r.single + r.gantry > 0;
      checks.push([okStep, `${r.name}：${names} — ${[r.single ? `${r.single} 點直接拍` : '', r.gantry ? `${r.gantry} 點靠線馬移動` : '', r.fail.length ? `${r.fail.join('、')} 看不到` : ''].filter(Boolean).join('，')}`]);
    });
    const rc = VA.effectiveRc(s), rcIn = Math.abs(rc.x) <= L.stageW / 2 && Math.abs(rc.y) <= L.stageH / 2;
    checks.push([rcIn, rcIn ? `旋轉中心 (${fmt(rc.x, 1)}, ${fmt(rc.y, 1)})` : '旋轉中心不在平台上，請確認']);
    return `<h2>總覽</h2>
      <ul class="checks">${checks.map(([ok, t]) => `<li class="${ok ? 'ok' : 'bad'}"><span>${ok ? '✓' : '✗'}</span>${esc(t)}</li>`).join('')}</ul>
      <h3>怎麼設定</h3>
      <ol class="howto">
        <li>點圖上的<b>平台</b>選平台種類、線馬。</li>
        <li>點<b>工件</b>設定尺寸與 Mark 排列。</li>
        <li>按「＋ 相機」新增相機，點相機選鏡頭、安裝方式，<b>拖曳</b>到要拍的位置。</li>
        <li>下方<b>流程</b>為每個步驟勾選相機與公差。</li>
        <li>拍照點會自動產生；到「對位計算」看修正量，到「校正手順」看校正方法。</li>
      </ol>
      <div class="btn-row"><button type="button" class="small" data-select="stage">設定平台</button><button type="button" class="small" data-select="work">設定工件</button><button type="button" class="small" data-goto="align">對位計算</button><button type="button" class="small" data-goto="proc">校正手順</button></div>`;
  }

  // ---------- 流程管線 ----------
  function renderPipeline() {
    const s = S(), b = lastBuild || VA.buildShots(s);
    $('guiPipeline').innerHTML = s.steps.map((st, si) => {
      const r = b.report[si] || { single: 0, gantry: 0, fail: [] };
      const ok = !r.fail.length && r.single + r.gantry > 0;
      return `${si ? '<div class="parrow">→</div>' : ''}<div class="pcard${ok ? '' : ' bad'}">
        <div class="pc-h"><span class="pc-n">${si + 1}</span><input data-g="steps.${si}.name" value="${esc(st.name)}" aria-label="步驟名稱">${s.steps.length > 1 ? `<button type="button" class="small" data-delstep="${si}" title="刪除步驟">✕</button>` : ''}</div>
        <div class="chips">${s.cameras.map((c, ci) => `<button type="button" class="chip${(st.cams || []).includes(ci) ? ' on' : ''}" data-stepcam="${si},${ci}" style="--cc:${App.camColor(ci)}">${esc(c.name)}</button>`).join('')}</div>
        <div class="grid2"><div class="field"><label>公差 (mm)</label><input type="number" step="any" data-g="steps.${si}.tol" value="${st.tol}"></div>
          <div class="field"><label>最多次數</label><input type="number" step="1" min="0" data-g="steps.${si}.maxIter" value="${st.maxIter}"></div></div>
        <div class="pc-s">${[r.single ? `${r.single} 點直接拍` : '', r.gantry ? `線馬 ${r.gantry} 個位置` : '', r.fail.length ? `✗ ${r.fail.join('、')} 看不到` : ''].filter(Boolean).join('・') || '✗ 沒有拍照點'}</div>
      </div>`;
    }).join('') + `<button type="button" class="pcard add" id="guiAddStep">＋ 步驟</button>`;
  }

  // ---------- 事件 ----------
  function onField(el, live) {
    const s = S();
    if (el.dataset.campos) {
      const i = +sel.slice(4), ctr = camCenter(i), v = +el.value;
      if (el.value === '' || isNaN(v)) return;
      moveCamera(i, el.dataset.campos === 'x' ? v - ctr.x : 0, el.dataset.campos === 'y' ? v - ctr.y : 0);
      commit(false); return;
    }
    const path = el.dataset.g;
    if (!path) return;
    let v = el.value;
    if (el.type === 'number') { if (v === '' || isNaN(+v)) return; v = +v; }
    setPath(s, path, v);
    if (/^cameras\.\d+\.optics\./.test(path)) syncOptics(+path.split('.')[1]);
    commit(!live && /\.name$/.test(path));
  }
  ['guiInspector', 'guiPipeline'].forEach(id => {
    $(id).addEventListener('input', e => { if (e.target.tagName === 'INPUT') onField(e.target, true); });
    $(id).addEventListener('change', e => { if (e.target.tagName === 'INPUT') onField(e.target, false); });
  });
  document.getElementById('tab-layout').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const s = S(), d = t.dataset;
    if (d.desel) { sel = null; renderInspector(); renderSvg(); return; }
    if (d.select) { sel = d.select; renderInspector(); renderSvg(); return; }
    if (d.goto) { App.showTab(d.goto); return; }
    if (d.platform) {
      s.platform.preset = d.platform;
      if (d.platform !== 'CUSTOM') s.platform.axes = VA.clone(VA.PLATFORMS[d.platform].axes);
      commit(true); return;
    }
    if (d.gantry) {
      s.platform.gantry.enabled = d.gantry !== 'off';
      if (d.gantry !== 'off') s.platform.gantry.mode = d.gantry;
      commit(true); return;
    }
    if (d.pattern) { s.layout.work.pattern = d.pattern; commit(true); return; }
    if (d.lens) { applyLens(+sel.slice(4), LENS_PRESETS.find(p => p.key === d.lens)); commit(true); return; }
    if (d.mount) { s.proc.mounts[+sel.slice(4)] = d.mount; commit(true); return; }
    if (d.delcam !== undefined) {
      const i = +d.delcam;
      if (s.cameras.length <= 1 || !confirm(`刪除 ${s.cameras[i].name}？`)) return;
      s.cameras.splice(i, 1); s.proc.mounts.splice(i, 1);
      s.shots = s.shots.filter(x => +x.cam !== i).map(x => Object.assign(x, { cam: +x.cam > i ? +x.cam - 1 : +x.cam }));
      s.steps.forEach(st => { st.cams = (st.cams || []).filter(c => c !== i).map(c => (c > i ? c - 1 : c)); });
      if (!s.shots.length) s.shots.push(VA.newShot(0, 0));
      sel = null; view = null; commit(true); return;
    }
    if (d.stepcam) {
      const [si, ci] = d.stepcam.split(',').map(Number), st = s.steps[si];
      st.cams = st.cams || [];
      st.cams = st.cams.includes(ci) ? st.cams.filter(c => c !== ci) : st.cams.concat(ci).sort((a, b) => a - b);
      commit(true); return;
    }
    if (d.delstep !== undefined) {
      const i = +d.delstep;
      s.steps.splice(i, 1);
      s.shots = s.shots.filter(x => +x.step !== i).map(x => Object.assign(x, { step: +x.step > i ? +x.step - 1 : +x.step }));
      if (s.activeStep >= s.steps.length) s.activeStep = 0;
      commit(true); return;
    }
    if (t.id === 'guiAddStep') {
      const last = s.steps[s.steps.length - 1];
      s.steps.push({ name: '步驟' + (s.steps.length + 1), tol: last ? +last.tol : 0.01, maxIter: 5, gain: 100, minMoves: 0, cams: last ? (last.cams || []).slice() : [0] });
      commit(true); return;
    }
  });
  $('guiAddCam').addEventListener('click', () => {
    const s = S(), n = s.cameras.length;
    if (n >= 16) return;
    const c = VA.newCamera(n);
    c.name = 'CAM' + (n + 1);
    c.optics.sensor = 'FH-5M';
    s.cameras.push(c);
    applyLens(n, LENS_PRESETS[0]);
    moveCamera(n, -camCenter(n).x + n * 10, -camCenter(n).y + n * 10);
    s.proc.mounts[n] = 'down';
    sel = 'cam:' + n; view = null;
    commit(true);
  });
  $('guiFit').addEventListener('click', () => { view = null; renderSvg(); });
  $('guiAuto').addEventListener('change', e => { S().layout.auto = e.target.checked; if (e.target.checked) commit(true); else App.save(); });
  $('guiBuild').addEventListener('click', () => { const s = S(); lastBuild = VA.applyBuild(s); busy = true; App.update(ALL); busy = false; renderAll(); flash('已依配置產生 ' + s.shots.length + ' 個拍照點'); });
  $('guiOffset').addEventListener('click', () => {
    const s = S(), r = () => Math.random() * 2 - 1;
    const dx = +(r() * 0.8).toFixed(3), dy = +(r() * 0.8).toFixed(3), dt = +(r() * 0.3).toFixed(3);
    s.shots.forEach(x => { x.cur = Object.assign({}, x.tgt); });
    VA.offsetCurrent(s, dx, dy, dt);
    s.history = [];
    busy = true; App.update(ALL); busy = false;
    flash(`已模擬工件偏移 ΔX ${dx}、ΔY ${dy} mm、Δθ ${dt}°，到「對位計算」看修正量`);
  });
  function flash(t) {
    const el = $('guiFlash'); el.textContent = t; el.hidden = false;
    clearTimeout(flash.t); flash.t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  function renderAll() {
    ensure();
    $('guiAuto').checked = !!S().layout.auto;
    lastBuild = VA.buildShots(S());
    renderSvg(); renderPipeline(); renderInspector();
  }
  App.onUpdate(o => {
    if (busy) return;
    if (o.tab === 'layout') { view = null; renderAll(); return; }
    // 外部變更（載入範例、匯入、其他分頁修改）：重新置中
    view = null;
    if (!$('tab-layout').hidden) renderAll();
  });
  window.addEventListener('resize', () => { if (!$('tab-layout').hidden) { view = null; renderSvg(); } });
  if (!$('tab-layout').hidden) setTimeout(renderAll, 0);
})();
