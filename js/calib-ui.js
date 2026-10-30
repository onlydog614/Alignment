// 「校正工具」頁：N 點校正、旋轉中心
(function () {
  'use strict';
  const VA = window.VA, App = window.App;
  const $ = id => document.getElementById(id);
  const fmt = VA.fmt;
  let calFit = null, rcFit = null;

  function camOptions() {
    const html = App.state.cameras.map((c, i) => `<option value="${i}">${App.esc(c.name)}</option>`).join('');
    ['calCam', 'rcCam'].forEach(id => {
      const el = $(id), v = el.value;
      if (el.innerHTML !== html) { el.innerHTML = html; el.value = v && +v < App.state.cameras.length ? v : '0'; }
    });
  }

  function parseRows(text, n) {
    return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => l.split(/[\s,;]+/).map(Number)).filter(a => a.length >= n && a.slice(0, n).every(Number.isFinite));
  }

  // ---------- N 點校正 ----------
  function genCal() {
    const cam = App.state.cameras[+$('calCam').value];
    const m = VA.cameraAffine(cam);
    const se = 1 + (+$('calScaleErr').value || 0) / 100, ae = (+$('calAngErr').value || 0) * VA.D2R, nz = +$('calNoise').value || 0;
    const cx = cam.width / 2, cy = cam.height / 2, c0 = VA.pixToWorld(m, cx, cy);
    // 「真實」相機 = 目前設定加上尺度與角度誤差；平台移動量 d 讓 mark 出現在 3×3 格點
    const truth = (u, v) => { const w = VA.pixToWorld(m, u, v), r = VA.rot(w.x - c0.x, w.y - c0.y, ae); return { x: r.x * se, y: r.y * se }; };
    const sign = +$('calSign').value;
    const lines = ['# u v X Y（模擬：尺度 ' + $('calScaleErr').value + '%、角度 ' + $('calAngErr').value + '°）'];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const u = cx + i * cam.width * 0.35, v = cy + j * cam.height * 0.35;
      const d = truth(u, v);
      lines.push([u + VA.gauss() * nz, v + VA.gauss() * nz, sign * d.x, sign * d.y].map((x, k) => x.toFixed(k < 2 ? 3 : 6)).join('\t'));
    }
    $('calText').value = lines.join('\n');
    fitCal();
  }

  function fitCal() {
    const sign = +$('calSign').value;
    const rows = parseRows($('calText').value, 4).map(a => ({ u: a[0], v: a[1], x: sign * a[2], y: sign * a[3] }));
    const out = $('calResult');
    if (rows.length < 3) { out.innerHTML = '<p class="warnings">至少需要 3 點（建議 9 點）。</p>'; calFit = null; drawCal(); return; }
    calFit = VA.fitAffine(rows);
    if (!calFit) { out.innerHTML = '<p class="warnings">點位共線或重複，無法求解。</p>'; drawCal(); return; }
    calFit.rows = rows;
    const cam = App.state.cameras[+$('calCam').value];
    const cur = VA.describeAffine(VA.cameraAffine(cam)), f = calFit.info, m = calFit.m;
    const pxSize = Math.sqrt(Math.abs(f.det));
    const warn = [];
    if (calFit.max / pxSize > 0.5) warn.push(`最大殘差 ${fmt(calFit.max / pxSize, 2)} px：有點位找錯特徵或平台沒到位，檢查殘差最大的那一點。`);
    if (Math.abs(f.sx / f.sy - 1) > 0.005) warn.push(`X/Y 像素當量差 ${fmt((f.sx / f.sy - 1) * 100, 2)}%：像素非正方、相機傾斜或平台 X/Y 比例不同。`);
    if (Math.abs(f.skew) > 0.1) warn.push(`兩軸不正交 ${fmt(f.skew, 3)}°：平台 XY 不垂直或相機傾斜。`);
    if (rows.length < 6) warn.push('點數少於 6，殘差無法有效檢查錯誤點。');
    out.innerHTML = `
      <div class="kv">
        <span>A, B, C</span><b class="mono">${fmt(m.A, 8)}, ${fmt(m.B, 8)}, ${fmt(m.C, 5)}</b>
        <span>D, E, F</span><b class="mono">${fmt(m.D, 8)}, ${fmt(m.E, 8)}, ${fmt(m.F, 5)}</b>
        <span>像素當量 X / Y</span><b>${fmt(f.sx * 1000, 4)} / ${fmt(f.sy * 1000, 4)} µm/px</b>
        <span>相機角度</span><b>${fmt(f.angle, 4)}°</b>
        <span>正交偏差</span><b>${fmt(f.skew, 4)}°</b>
        <span>手性</span><b>${f.handed < 0 ? '−（一般下視）' : '+（上視或鏡像）'}</b>
        <span>殘差 RMS / 最大</span><b>${fmt(calFit.rms * 1000, 3)} / ${fmt(calFit.max * 1000, 3)} µm（${fmt(calFit.max / pxSize, 3)} px）</b>
        <span>與目前相機設定比較</span><b>尺度 ${fmt((f.sx / cur.sx - 1) * 100, 3)}%・角度 ${fmt(f.angle - cur.angle, 4)}°</b>
      </div>
      ${warn.length ? `<ul class="warnings">${warn.map(w => `<li>${App.esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="table-wrap"><table><thead><tr><th>#</th><th>u</th><th>v</th><th>殘差 X µm</th><th>殘差 Y µm</th><th>px</th></tr></thead><tbody>
      ${calFit.residuals.map((r, i) => `<tr${r.d === calFit.max && rows.length > 3 ? ' style="font-weight:600"' : ''}><td>${i + 1}</td><td>${fmt(rows[i].u, 1)}</td><td>${fmt(rows[i].v, 1)}</td><td>${fmt(r.x * 1000, 3)}</td><td>${fmt(r.y * 1000, 3)}</td><td>${fmt(r.px, 3)}</td></tr>`).join('')}
      </tbody></table></div>`;
    drawCal();
  }

  function drawCal() {
    const cv = $('calCanvas');
    if (!cv.clientWidth) return;
    const { c, w, h } = App.prepCanvas(cv);
    const cam = App.state.cameras[+$('calCam').value];
    if (!cam) return;
    const W = cam.width, H = cam.height, sc = Math.min(w / W, h / H) * 0.9, ox = (w - W * sc) / 2, oy = (h - H * sc) / 2;
    c.strokeStyle = App.css('--border'); c.strokeRect(ox, oy, W * sc, H * sc);
    c.fillStyle = App.css('--muted'); c.font = '11px system-ui';
    if (!calFit) { c.fillText('殘差向量會顯示在此（以像素位置繪製）', ox + 6, oy + 16); return; }
    const maxPx = Math.max(1e-9, ...calFit.residuals.map(r => r.px));
    const k = 40 / maxPx; // 最大殘差畫成 40 px 長
    c.fillText(`殘差放大：最長箭頭 = ${fmt(maxPx, 3)} px`, ox + 6, oy + 16);
    calFit.rows.forEach((r, i) => {
      const p = { x: ox + r.u * sc, y: oy + r.v * sc };
      const res = calFit.residuals[i];
      // 世界殘差轉回像素方向
      const q = VA.worldToPix(calFit.m, VA.pixToWorld(calFit.m, r.u, r.v).x + res.x, VA.pixToWorld(calFit.m, r.u, r.v).y + res.y);
      c.strokeStyle = App.css('--cur'); c.lineWidth = 1.5;
      App.arrow(c, p.x, p.y, p.x + (q.u - r.u) * k, p.y + (q.v - r.v) * k);
      App.dot(c, p, App.css('--tgt'), 4, true);
      c.fillStyle = App.css('--text'); c.fillText(i + 1, p.x + 6, p.y - 6);
    });
  }

  $('calGen').addEventListener('click', genCal);
  $('calFit').addEventListener('click', fitCal);
  $('calApply').addEventListener('click', () => {
    if (!calFit) return;
    const cam = App.state.cameras[+$('calCam').value];
    const m = Object.assign({}, calFit.m);
    if ($('calPos').value === 'keep') {
      const c0 = VA.pixToWorld(VA.cameraAffine(cam), cam.width / 2, cam.height / 2);
      const c1 = VA.pixToWorld(m, cam.width / 2, cam.height / 2);
      m.C += c0.x - c1.x; m.F += c0.y - c1.y;
    }
    cam.calMode = 'matrix';
    cam.matrix = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toPrecision(12)]));
    App.update({ cameras: true, fit: true });
    $('calResult').insertAdjacentHTML('afterbegin', `<p class="status ok">已套用到 ${App.esc(cam.name)}</p>`);
  });

  // ---------- 旋轉中心 ----------
  function rcContext() {
    const s = App.state, ci = +$('rcCam').value, cam = s.cameras[ci];
    const shot = { gx: +$('rcGx').value || 0, gy: +$('rcGy').value || 0 };
    return { s, cam, m: VA.cameraAffine(cam), shot };
  }

  function genRc() {
    const { s, cam, m, shot } = rcContext();
    const c = { x: +$('rcTrueX').value || 0, y: +$('rcTrueY').value || 0 };
    const nz = +$('rcNoise').value || 0;
    // mark 放在影像中心看到的平台位置；依視野自動決定旋轉角度，避免轉出視野
    const wc = VA.pixToWorld(m, cam.width / 2, cam.height / 2);
    const p0 = VA.shotToStage(s, shot, wc);
    const R = Math.hypot(p0.x - c.x, p0.y - c.y);
    const fov = Math.min(cam.width, cam.height) * VA.describeAffine(m).sx;
    let maxDeg = Math.min(3, (0.35 * fov / Math.max(R, 1e-6)) * VA.R2D);
    // 視野太小時：若有線馬，就讓線馬跟著 mark 移動（每行多記錄線馬位置），角度可加大到 ±3°
    const sign = VA.gantrySign(s);
    const follow = maxDeg < 2 && sign !== 0;
    if (follow) maxDeg = 3;
    const angles = [-1, -0.5, 0, 0.5, 1].map(f => +(f * maxDeg).toFixed(4));
    const lines = [`# u v θ${follow ? ' 線馬X 線馬Y' : ''}（模擬：真實中心 ${c.x}, ${c.y}；半徑 ${R.toFixed(2)} mm；角度 ±${maxDeg.toFixed(4)}°${follow ? '，視野太小，線馬跟隨 mark' : ''}）`];
    angles.forEach(a => {
      const p = VA.applyMove(p0, a * VA.D2R, { x: 0, y: 0 }, c);
      let row = shot;
      if (follow) {
        // stageToCamWorld：w = p − sign·G → 要讓 mark 回到影像中心，G = (p − wc) / sign
        row = { gx: +((p.x - wc.x) / sign).toFixed(3), gy: +((p.y - wc.y) / sign).toFixed(3) };
      }
      const w = VA.stageToCamWorld(s, row, p);
      const px = VA.worldToPix(m, w.x, w.y);
      const cols = [px.u + VA.gauss() * nz, px.v + VA.gauss() * nz].map(x => x.toFixed(3)).concat(a);
      if (follow) cols.push(row.gx, row.gy);
      lines.push(cols.join('\t'));
    });
    $('rcText').value = lines.join('\n');
    fitRc();
  }

  function fitRc() {
    const { s, m, shot } = rcContext();
    const rows = parseRows($('rcText').value, 3);
    const out = $('rcResult');
    if (rows.length < 3) { out.innerHTML = '<p class="warnings">至少需要 3 點（建議 5 點以上）。</p>'; rcFit = null; drawRc(); return; }
    // 每行可帶第 4、5 欄線馬位置；沒有就用上方欄位
    const pts = rows.map(a => {
      const sh = a.length >= 5 ? { gx: a[3], gy: a[4] } : shot;
      return Object.assign(VA.shotToStage(s, sh, VA.pixToWorld(m, a[0], a[1])), { th: a[2] });
    });
    rcFit = VA.fitCircle(pts);
    if (!rcFit) { out.innerHTML = '<p class="warnings">點位共線，無法求解。</p>'; drawRc(); return; }
    rcFit.pts = pts;
    // 量到的角度 vs 指令角度：斜率 ≠ 1 代表 θ 軸比例誤差
    const meas = pts.map(p => Math.atan2(p.y - rcFit.cy, p.x - rcFit.cx));
    const base = meas[0];
    const md = meas.map(a => { let d = (a - base) * VA.R2D; d = ((d + 540) % 360) - 180; return d; });
    const cd = pts.map(p => p.th - pts[0].th);
    const n = pts.length, sx = cd.reduce((a, b) => a + b, 0), sy = md.reduce((a, b) => a + b, 0);
    const sxx = cd.reduce((a, b) => a + b * b, 0), sxy = cd.reduce((a, b, i) => a + b * md[i], 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const span = Math.max(...cd) - Math.min(...cd);
    const pos = s.platform.preset === 'XYT' ? s.platform.pos : { x: 0, y: 0 };
    const cur = VA.effectiveRc(s);
    const warn = [];
    const noiseMm = Math.max(...rcFit.residuals.map(Math.abs));
    const arc = rcFit.r * span * VA.D2R;
    // 圓心不確定度：由擬合共變異數估計（點數 > 3 才有）
    const unc = rcFit.sd ? Math.hypot(rcFit.sd.cx, rcFit.sd.cy) : NaN;
    if (!(unc < 0.05)) warn.push(`旋轉範圍 ${fmt(span, 3)}°（弧長 ${fmt(arc, 3)} mm）不足以準確定出圓心${Number.isFinite(unc) ? `（不確定度約 ±${fmt(unc, 3)} mm）` : ''}；請加大角度。視野小的相機可用線馬跟著 mark 移動（每行加上線馬 X、Y），或改用低倍率相機。`);
    if (Number.isFinite(slope) && span >= 2 && Math.abs(slope - 1) > 0.005) warn.push(`量測角度 / 指令角度 = ${fmt(slope, 4)}：θ 軸比例（減速比、脈波換算）可能有誤。`);
    out.innerHTML = `
      <div class="kv">
        <span>旋轉中心（平台座標）</span><b>(${fmt(rcFit.cx, 4)}, ${fmt(rcFit.cy, 4)}) mm</b>
        <span>半徑</span><b>${fmt(rcFit.r, 4)} mm</b>
        <span>圓擬合最大殘差</span><b>${fmt(noiseMm * 1000, 3)} µm</b>
        <span>旋轉範圍 / 弧長</span><b>${fmt(span, 4)}° / ${fmt(arc, 3)} mm</b>
        <span>圓心不確定度（1σ）</span><b>±${fmt(unc, 4)} mm</b>
        <span>量測角度 / 指令角度</span><b>${fmt(slope, 5)}</b>
        <span>與目前設定差</span><b>(${fmt(rcFit.cx - cur.x, 4)}, ${fmt(rcFit.cy - cur.y, 4)}) mm</b>
      </div>
      ${warn.length ? `<ul class="warnings">${warn.map(w => `<li>${App.esc(w)}</li>`).join('')}</ul>` : ''}
      ${s.platform.preset === 'XYT' ? `<p class="hint">XYθ：套用時會扣除目前 XY 軸位置 (${fmt(+pos.x, 3)}, ${fmt(+pos.y, 3)})。</p>` : ''}`;
    drawRc();
  }

  function drawRc() {
    const cv = $('rcCanvas');
    if (!cv.clientWidth) return;
    const { c, w, h } = App.prepCanvas(cv);
    c.fillStyle = App.css('--muted'); c.font = '11px system-ui';
    if (!rcFit) { c.fillText('量測點與擬合圓會顯示在此', 8, 16); return; }
    const pts = rcFit.pts.concat([{ x: rcFit.cx, y: rcFit.cy }]);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sc = Math.min(w / Math.max(x1 - x0, 1e-6), h / Math.max(y1 - y0, 1e-6)) * 0.8;
    const T = p => ({ x: w / 2 + (p.x - (x0 + x1) / 2) * sc, y: h / 2 - (p.y - (y0 + y1) / 2) * sc });
    const cc = T({ x: rcFit.cx, y: rcFit.cy });
    c.strokeStyle = App.css('--fov'); c.setLineDash([4, 4]);
    c.beginPath(); c.arc(cc.x, cc.y, rcFit.r * sc, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    rcFit.pts.forEach(p => { const q = T(p); c.strokeStyle = App.css('--grid'); c.beginPath(); c.moveTo(cc.x, cc.y); c.lineTo(q.x, q.y); c.stroke(); App.dot(c, q, App.css('--cur'), 4, true); });
    App.dot(c, cc, App.css('--rc'), 6, false);
    c.fillStyle = App.css('--text');
    c.fillText(`中心 (${fmt(rcFit.cx, 3)}, ${fmt(rcFit.cy, 3)})`, cc.x + 8, cc.y - 8);
  }

  $('rcGen').addEventListener('click', genRc);
  $('rcFit').addEventListener('click', fitRc);
  $('rcApply').addEventListener('click', () => {
    if (!rcFit) return;
    const s = App.state;
    const pos = s.platform.preset === 'XYT' ? s.platform.pos : { x: 0, y: 0 };
    s.platform.rc = { x: +(rcFit.cx - (+pos.x || 0)).toFixed(6), y: +(rcFit.cy - (+pos.y || 0)).toFixed(6) };
    App.update({ static: true, fit: true });
    $('rcResult').insertAdjacentHTML('afterbegin', '<p class="status ok">已套用為平台旋轉中心</p>');
  });

  App.onUpdate(o => {
    camOptions();
    if (o.tab === 'calib') { drawCal(); drawRc(); }
  });
  camOptions();
  window.addEventListener('resize', () => { drawCal(); drawRc(); });
})();
