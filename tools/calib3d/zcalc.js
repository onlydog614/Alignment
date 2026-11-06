// ===== 機構調校：Z 四角高低差 → 貼附誤差計算（公式＋圖解＋動畫） =====
(function (G) {
  'use strict';
  const D = document, $ = s => D.querySelector(s);
  const SEC = 206264.8, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
  const f1 = v => (isFinite(v) ? v.toFixed(1) : '–'), f2 = v => (isFinite(v) ? v.toFixed(2) : '–'), f3 = v => (isFinite(v) ? v.toFixed(3) : '–');
  const sg = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  const KEY = 'cal-zcalc-v1';
  const CN = ['左上', '右上', '左下', '右下'];
  // 預設：右上角比其他角高 30 µm（單角先接觸）、Z 每升 1 mm 往 X 偏 5 µm、接觸後再壓 0.2 mm
  const DEF = { lx: 117, ly: 90, t: 0.5, h0: 0, h1: 30, h2: 0, h3: 0, ux: 5, uy: 0, p: 0.2, tgt: 64 };
  const FIELDS = [
    ['lx', '料件 Mark 間距 X（左右）', 'mm', '你量角度用的兩個 Mark 距離（簡報裡是 117 mm）'],
    ['ly', '料件 Mark 間距 Y（前後）', 'mm', ''],
    ['t', 'Mark 到接觸面的高度（料厚）', 'mm', ''],
    ['h0', '左上角高度', 'µm', '越高越先碰到'], ['h1', '右上角高度', 'µm', ''], ['h2', '左下角高度', 'µm', ''], ['h3', '右下角高度', 'µm', ''],
    ['ux', 'Z 每上升 1 mm，X 跟著偏', 'µm/mm', 'Z 軸不垂直；1° ≈ 17.5 µm/mm'], ['uy', 'Z 每上升 1 mm，Y 跟著偏', 'µm/mm', ''],
    ['p', '全面貼平後再往上壓', 'mm', '下壓量／緩衝行程'],
    ['tgt', '實測角度誤差（反推用）', '″', '1-8、1-9 約 ±64″']
  ];
  let P = Object.assign({}, DEF);
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) P = Object.assign({}, DEF, s); } catch (e) { /* 無 */ }

  // ---------- 計算 ----------
  function calc(P) {
    const Lx = P.lx, Ly = P.ly, h = [P.h0, P.h1, P.h2, P.h3];
    const C = [[-Lx / 2, Ly / 2], [Lx / 2, Ly / 2], [-Lx / 2, -Ly / 2], [Lx / 2, -Ly / 2]];
    const ax = ((h[1] + h[3]) - (h[0] + h[2])) / (2 * Lx) / 1000;   // rad（µm/mm → ×1e-3）
    const ay = ((h[0] + h[1]) - (h[2] + h[3])) / (2 * Ly) / 1000;
    const w = ((h[0] + h[3]) - (h[1] + h[2])) / 2;                  // µm
    let ip = 0; h.forEach((v, i) => { if (v > h[ip]) ip = i; });
    const hmax = Math.max(...h), hmin = Math.min(...h), g = (hmax - hmin) / 1000;   // mm
    const flat = hmax - hmin < 1e-9;
    const shiftX = P.t * ax * 1000, shiftY = P.t * ay * 1000;                         // µm
    const shortX = Lx * ax * ax / 2 * 1000, shortY = Ly * ay * ay / 2 * 1000;       // µm
    const zc = g + P.p, s = [zc * P.ux, zc * P.uy];                                   // µm
    // 支點：最高的角；兩個角一樣高（差 < 0.5 µm）時是整條邊先接觸，支點取兩角中點
    const tie = flat ? [] : h.map((v, i) => i).filter(i => hmax - h[i] < 0.5);
    const piv = flat ? [0, 0] : [tie.reduce((a, i) => a + C[i][0], 0) / tie.length, tie.reduce((a, i) => a + C[i][1], 0) / tie.length], r = [-piv[0], -piv[1]], r2 = r[0] * r[0] + r[1] * r[1];
    const th = flat || r2 < 1e-9 ? 0 : (r[0] * s[1] - r[1] * s[0]) / r2 / 1000;      // rad
    const disp = C.map(c => th * Math.hypot(c[0] - piv[0], c[1] - piv[1]) * 1000);     // µm
    const ctr = th * Math.sqrt(r2) * 1000;
    // 反推：要轉出 tgt 角秒，需要多大的 Z 斜行
    const tg = P.tgt / SEC, sPerpNeed = tg * Math.sqrt(r2) * 1000, uNeed = zc > 0 ? sPerpNeed / zc : Infinity;
    const gNeed = P.ux || P.uy ? sPerpNeed / Math.hypot(P.ux, P.uy) - P.p : Infinity;  // 同樣 Z 斜度下要多大的高低差（mm）
    return { C, h, ax, ay, w, ip, tie, g, flat, shiftX, shiftY, shortX, shortY, zc, s, piv, r, th, disp, ctr, sPerpNeed, uNeed, betaNeed: Math.atan(uNeed / 1000) * 180 / Math.PI, gNeed };
  }

  // ---------- 圖 ----------
  const NS = 'http://www.w3.org/2000/svg';
  function el(p, n, a, txt) { const e = D.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; p.appendChild(e); return e; }
  let anim = 1, playing = false, lastTs = 0;
  function phase(a) {
    // 0–0.3 上升接近；0.3 最高角先接觸；0.3–0.65 其他角陸續貼上；0.65–1 再往上壓
    if (a < 0.3) return { k: 0, cap: 'Z 上升，料還沒碰到貼附面' };
    if (a < 0.65) return { k: ease((a - 0.3) / 0.35) * 0.999, cap: '最高的角先碰到，被摩擦卡住當支點；Z 繼續上升時平台跟著 Z 斜度橫移' };
    return { k: 0.999 + 0.001, cap: '四角都貼平後再往上壓：橫移繼續，料繞支點轉' };
  }
  function draw() {
    const R = calc(P), ph = phase(anim);
    const zFrac = anim < 0.3 ? 0 : anim < 0.65 ? (anim - 0.3) / 0.35 * (R.g / (R.zc || 1)) : R.g / (R.zc || 1) + (anim - 0.65) / 0.35 * (P.p / (R.zc || 1));
    const thNow = R.th * clamp(zFrac, 0, 1), sNow = [R.s[0] * clamp(zFrac, 0, 1), R.s[1] * clamp(zFrac, 0, 1)];
    // 俯視
    const top = $('#zctop'); top.innerHTML = '';
    const W = 340, H = 250, sc = Math.min(220 / P.lx, 150 / P.ly), cx = W / 2, cy = 128;
    const X = x => cx + x * sc, Y = y => cy - y * sc;
    const maxD = Math.max(...R.disp.map(Math.abs), 1e-9), E = clamp(14 / (maxD / 1000 * sc), 1, 1e6);   // 位移放大
    el(top, 'rect', { x: X(-P.lx / 2), y: Y(P.ly / 2), width: P.lx * sc, height: P.ly * sc, class: 'zc-part' });
    // 轉動後外框（放大）
    const thE = thNow * E, pv = R.piv, rot = c => { const dx = c[0] - pv[0], dy = c[1] - pv[1]; return [pv[0] + dx * Math.cos(thE) - dy * Math.sin(thE), pv[1] + dx * Math.sin(thE) + dy * Math.cos(thE)]; };
    if (!R.flat && Math.abs(thNow) > 0) { const q = [R.C[0], R.C[1], R.C[3], R.C[2]].map(rot); el(top, 'polygon', { points: q.map(c => X(c[0]) + ',' + Y(c[1])).join(' '), class: 'zc-rot' }); }
    const hmin = Math.min(...R.h), hmax = Math.max(...R.h);
    R.C.forEach((c, i) => {
      const k = hmax > hmin ? (R.h[i] - hmin) / (hmax - hmin) : 0;
      el(top, 'circle', { cx: X(c[0]), cy: Y(c[1]), r: 9, class: 'zc-cn', style: `fill:color-mix(in srgb,var(--hot) ${Math.round(k * 85)}%,var(--panel))` });
      const up = c[1] > 0, rt = c[0] > 0;
      el(top, 'text', { x: X(c[0]) + (rt ? -14 : 14), y: Y(c[1]) + (up ? 22 : -14), 'text-anchor': rt ? 'end' : 'start', class: 'zc-t' }, `${CN[i]} ${sg(R.h[i], 0)} µm`);
      if (Math.abs(R.disp[i]) > 0.005 && !R.flat) el(top, 'text', { x: X(c[0]) + (rt ? -14 : 14), y: Y(c[1]) + (up ? 35 : -27), 'text-anchor': rt ? 'end' : 'start', class: 'zc-t zc-d' }, `移 ${f1(R.disp[i] * clamp(zFrac, 0, 1))} µm`);
    });
    if (!R.flat) { el(top, 'circle', { cx: X(pv[0]), cy: Y(pv[1]), r: 14, class: 'zc-piv' }); el(top, 'text', { x: X(pv[0]), y: Y(pv[1]) + (pv[1] > 0 ? -18 : 28), 'text-anchor': 'middle', class: 'zc-t zc-pt' }, R.tie.length > 1 ? '整條邊先接觸（支點）' : '先接觸（支點）'); }
    // 橫移箭頭（從中心）
    const sl = Math.hypot(R.s[0], R.s[1]);
    if (sl > 0) { const L = 46 * clamp(zFrac, 0, 1), ux = R.s[0] / sl, uy = R.s[1] / sl; if (L > 2) { el(top, 'line', { x1: cx, y1: cy, x2: cx + ux * L, y2: cy - uy * L, class: 'zc-arr', 'marker-end': 'url(#zcah)' }); } el(top, 'text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'zc-t zc-pt' }, `平台橫移 ${f2(Math.hypot(sNow[0], sNow[1]))} µm`); }
    const defs = el(top, 'defs', {}); const m = el(defs, 'marker', { id: 'zcah', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }); el(m, 'path', { d: 'M0 0L10 5L0 10z', class: 'zc-ah' });
    el(top, 'text', { x: 6, y: 14, class: 'zc-t' }, `俯視（轉角放大 ×${E >= 100 ? Math.round(E) : f1(E)}）`);
    el(top, 'text', { x: W - 6, y: 14, 'text-anchor': 'end', class: 'zc-t zc-d' }, `θz = ${sg(thNow * SEC, 1)}″`);
    // 側視（沿 X）
    const sd = $('#zcside'); sd.innerHTML = '';
    const SW = 340, SH = 190, xL = 50, xR = 290, ex = 400;   // 高度放大
    const hl = (R.h[0] + R.h[2]) / 2, hr = (R.h[1] + R.h[3]) / 2;   // 左右兩邊平均高度（µm）
    const yTray = 40, gapPx = 34;                                        // 貼附面（上）
    const lift = anim < 0.3 ? gapPx * (1 - ease(anim / 0.3)) : 0;
    const pyL = yTray + 8 + lift + (hr - hl > 0 ? (hr - hl) / 1000 * ex * (1 - ph.k) : 0), pyR = yTray + 8 + lift + (hl - hr > 0 ? (hl - hr) / 1000 * ex * (1 - ph.k) : 0);
    el(sd, 'rect', { x: 20, y: yTray - 14, width: 300, height: 14, class: 'zc-tray' });
    el(sd, 'text', { x: 24, y: yTray - 3, class: 'zc-t' }, '平台3 貼附面');
    el(sd, 'polygon', { points: `${xL},${pyL - 8} ${xR},${pyR - 8} ${xR},${pyR} ${xL},${pyL}`, class: 'zc-part' });
    el(sd, 'polygon', { points: `${xL - 10},${pyL} ${xR + 10},${pyR} ${xR + 10},${pyR + 26} ${xL - 10},${pyL + 26}`, class: 'zc-chuck' });
    el(sd, 'text', { x: (xL + xR) / 2, y: (pyL + pyR) / 2 + 18, 'text-anchor': 'middle', class: 'zc-t' }, 'DD 吸盤（高低差放大 ×400）');
    // Z 斜行箭頭
    const bx = (P.ux || 0), ang = Math.atan(bx / 1000) * 8;   // 斜度放大 ×8
    const zx = 170, zy0 = 182, zy1 = Math.max(pyL, pyR) + 32;
    el(sd, 'line', { x1: zx - Math.tan(ang) * (zy0 - zy1), y1: zy0, x2: zx, y2: zy1, class: 'zc-arr', 'marker-end': 'url(#zcah2)' });
    const d2 = el(sd, 'defs', {}); const m2 = el(d2, 'marker', { id: 'zcah2', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }); el(m2, 'path', { d: 'M0 0L10 5L0 10z', class: 'zc-ah' });
    el(sd, 'text', { x: zx + 8, y: zy0 - 4, class: 'zc-t' }, `Z 上升（斜度 ${f1(P.ux)} µm/mm）`);
    if (Math.abs(hr - hl) > 0.01) { const hx = hr > hl ? xR : xL; el(sd, 'text', { x: hx, y: yTray + 18 + lift, 'text-anchor': 'middle', class: 'zc-t zc-pt' }, anim >= 0.3 ? '先碰' : ''); }
    $('#zccap').textContent = ph.cap;
    $('#zcz').value = Math.round(anim * 1000);
  }

  function results() {
    const R = calc(P), ar = v => `${f2(v * 1e6)} µrad（${f1(v * SEC)}″）`;
    const pill = (v, a, b) => `<span class="pill ${Math.abs(v) <= a ? 'ok' : Math.abs(v) <= b ? 'warnp' : 'bad'}">${Math.abs(v) <= a ? '可忽略' : Math.abs(v) <= b ? '注意' : '主要'}</span>`;
    const maxDisp = Math.max(...R.disp.map(Math.abs));
    $('#zcres').innerHTML = `<table class="zctbl"><thead><tr><th>項目</th><th>算式</th><th>結果</th></tr></thead><tbody>
      <tr><td>左右傾斜 αx</td><td>[(右上+右下)−(左上+左下)] ÷ 2Lx</td><td>${ar(R.ax)}</td></tr>
      <tr><td>前後傾斜 αy</td><td>[(左上+右上)−(左下+右下)] ÷ 2Ly</td><td>${ar(R.ay)}</td></tr>
      <tr><td>扭曲 w</td><td>[(左上+右下)−(右上+左下)] ÷ 2</td><td>${f1(R.w)} µm</td></tr>
      <tr><td>先接觸的角、行程差 g</td><td>最高角；g = 最高 − 最低</td><td>${R.flat ? '四角一樣高' : R.tie.length > 1 ? R.tie.map(i => CN[i]).join('＋') + '（整條邊）' : CN[R.ip]}；${f1(R.g * 1000)} µm</td></tr>
      <tr class="zc-h"><td colspan="3">貼附誤差</td></tr>
      <tr><td>① 傾斜造成 Mark 平移</td><td>t × α</td><td>X ${sg(R.shiftX, 2)}、Y ${sg(R.shiftY, 2)} µm ${pill(Math.hypot(R.shiftX, R.shiftY), 1, 3)}</td></tr>
      <tr><td>② 傾斜造成 Mark 間距縮短</td><td>L × α² ÷ 2</td><td>X ${f3(R.shortX)}、Y ${f3(R.shortY)} µm ${pill(Math.max(R.shortX, R.shortY), 1, 3)}</td></tr>
      <tr><td>③ 接觸後平台橫移</td><td>s = (g + p) × Z 斜度</td><td>${f2(Math.hypot(R.s[0], R.s[1]))} µm</td></tr>
      <tr><td>③ 繞支點轉動</td><td>θz = (r × s) ÷ |r|²</td><td><b>${sg(R.th * SEC, 1)}″（${sg(R.th * 180 / Math.PI, 4)}°）</b> ${pill(R.th * SEC, 5, 20)}</td></tr>
      <tr><td>③ 角落最大位移</td><td>θz × 角落到支點距離</td><td><b>${f1(maxDisp)} µm</b>（料中心 ${f1(Math.abs(R.ctr))} µm）</td></tr>
      <tr class="zc-h"><td colspan="3">反推：要轉出實測的 ${f1(P.tgt)}″</td></tr>
      <tr><td>需要的橫移（垂直於支點方向）</td><td>θ × |r|</td><td>${f1(R.sPerpNeed)} µm</td></tr>
      <tr><td>行程不變時需要的 Z 斜度</td><td>橫移 ÷ (g + p)</td><td>${isFinite(R.uNeed) ? `${f1(R.uNeed)} µm/mm（約 ${f2(R.betaNeed)}°）` : '—'}</td></tr>
      <tr><td>Z 斜度不變時需要的高低差 g</td><td>橫移 ÷ Z 斜度 − p</td><td>${isFinite(R.gNeed) ? (R.gNeed > 0 ? `${f1(R.gNeed * 1000)} µm` : '目前就夠') : '—（Z 斜度為 0）'}</td></tr>
      </tbody></table>`;
    const big = R.th * SEC;
    $('#zcsum').innerHTML = R.flat ? '四角一樣高：不會因為高低差造成轉動，只剩 Z 斜行的平移。' :
      `以這組數字，高低差本身（①②）只造成 <b>${f2(Math.max(Math.hypot(R.shiftX, R.shiftY), R.shortX, R.shortY))} µm</b> 以內的誤差；真正會讓料轉的是③：最高角先碰到當支點、Z 再往上走時平台跟著 Z 斜度橫移，料就繞支點轉 <b>${sg(big, 1)}″</b>。` +
      (Math.abs(big) < P.tgt * 0.5 ? ` 要轉出 ${f1(P.tgt)}″，Z 斜度要到 ${f1(R.uNeed)} µm/mm（${f2(R.betaNeed)}°），或接觸後的總行程要更長——如果實際 Z 斜度沒那麼大，就代表還有別的原因（料在吸盤上滑、貼附面有更大的段差、壓合時被推）。` : ' 已經跟實測同一個量級，Z 斜度＋單邊先接觸足以解釋實測角度。') +
      ' 轉動方向 = r × s 的正負：支點只要跑到料中心的另一側（相對於平台橫移的方向），轉動就反向——例如 Z 往 X 斜時，前側先碰和後側先碰會轉相反方向；這就是「相鄰兩個穴位正負號相反」的一種可能機制。';
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* 無 */ } }
  let inited = false;
  function init() {
    if (inited) return; inited = true;
    $('#zcin').innerHTML = FIELDS.map(([k, lb, u, n]) => `<label class="fld"><span>${lb}${n ? `<small class="note"> ${n}</small>` : ''}</span><span class="inp"><input type="number" step="any" id="zc-${k}" value="${P[k]}"><i>${u}</i></span></label>`).join('');
    FIELDS.forEach(([k]) => $('#zc-' + k).addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { P[k] = v; save(); results(); draw(); } }));
    $('#zcpresets').innerHTML = [['右邊高 30 µm', { h0: 0, h1: 30, h2: 0, h3: 30 }], ['左邊高 30 µm', { h0: 30, h1: 0, h2: 30, h3: 0 }], ['單角高 30 µm', { h0: 0, h1: 30, h2: 0, h3: 0 }], ['扭曲（對角）', { h0: 20, h1: 0, h2: 0, h3: 20 }], ['四角一樣高', { h0: 0, h1: 0, h2: 0, h3: 0 }], ['恢復預設', DEF]]
      .map(([n], i) => `<button class="chip" data-i="${i}">${n}</button>`).join('');
    const PR = [{ h0: 0, h1: 30, h2: 0, h3: 30 }, { h0: 30, h1: 0, h2: 30, h3: 0 }, { h0: 0, h1: 30, h2: 0, h3: 0 }, { h0: 20, h1: 0, h2: 0, h3: 20 }, { h0: 0, h1: 0, h2: 0, h3: 0 }, DEF];
    D.querySelectorAll('#zcpresets .chip').forEach(b => b.addEventListener('click', () => { Object.assign(P, PR[+b.dataset.i]); FIELDS.forEach(([k]) => { $('#zc-' + k).value = P[k]; }); save(); results(); anim = 0; playing = true; setBtn(); draw(); }));
    $('#zcplay').addEventListener('click', () => { if (anim >= 1) anim = 0; playing = !playing; setBtn(); });
    $('#zcz').addEventListener('input', e => { anim = +e.target.value / 1000; playing = false; setBtn(); draw(); });
    results(); draw(); requestAnimationFrame(loop);
  }
  function setBtn() { const b = $('#zcplay'); b.textContent = playing ? '暫停' : '播放'; b.setAttribute('aria-pressed', playing ? 'true' : 'false'); }
  const vis = () => { const v = $('#view-mech'), d = $('#zc'); return !!(v && !v.hidden && d && !d.hidden); };
  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0); lastTs = ts;
    if (playing && vis()) { anim += dt / 6; if (anim >= 1) { anim = 1; playing = false; setBtn(); } draw(); }
    requestAnimationFrame(loop);
  }
  function show() { init(); results(); draw(); }
  G.ZCALC = { init, show, calc, get P() { return P; }, set: o => { Object.assign(P, o); FIELDS.forEach(([k]) => { const e = $('#zc-' + k); if (e) e.value = P[k]; }); results(); draw(); }, seek: a => { anim = a; playing = false; setBtn(); draw(); } };
})(typeof window !== 'undefined' ? window : globalThis);
