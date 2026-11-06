// ===== 機構調校：視覺機構檢查（用相機本身找出是哪個機構有問題） =====
// 每一項檢查：3D 動作示意＋相機畫面＋量測曲線＋判定。數值為模擬示意，用來說明怎麼量、怎麼判斷。
(function (G) {
  'use strict';
  const D = document, $ = s => D.querySelector(s), $$ = s => [...D.querySelectorAll(s)];
  const css = n => getComputedStyle(D.documentElement).getPropertyValue(n).trim() || '#888';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
  const f1 = v => (isFinite(v) ? v.toFixed(1) : '–'), f2 = v => (isFinite(v) ? v.toFixed(2) : '–'), f3 = v => (isFinite(v) ? v.toFixed(3) : '–');
  const sg = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  // 固定亂數（每次結果相同）
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

  // 相機規格（跟「機台參數」一致）
  function camSpec() {
    const c = G.M0 && G.M0.top && G.M0.top[0];
    const fov = c ? c.fov : [2.8152, 2.346], w = c ? c.w : 2448, h = c ? c.h : 2040;
    return { fov, w, h, um: fov[0] / w * 1000 };   // um = 每像素幾 µm
  }
  // 最小二乘直線 y = a + b·x
  function linfit(P) {
    const n = P.length; if (n < 2) return { a: 0, b: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0; P.forEach(([x, y]) => { sx += x; sy += y; sxx += x * x; sxy += x * y; });
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1); return { a: (sy - b * sx) / n, b };
  }
  // 停留式時間軸：n 個點，每點「移動 mv、停留 dw」；回傳 {i, u(移動進度), dwell}
  function stops(p, n, mv = 0.55) {
    const s = clamp(p, 0, 0.9999) * n, i = Math.floor(s), f = s - i;
    return { i, u: ease(f / mv), dwell: f >= mv };
  }

  // ---------- 七項檢查 ----------
  // k = 問題程度（0 = 正常機台，1 = 問題明顯）；frame(p,k) 回傳 3D 狀態與相機畫面；data(k) 回傳曲線；res(k) 回傳判定
  const CHECKS = [
    {
      id: 'settle', title: '相機支架剛性與穩定時間', sub: '平台停下後畫面晃多久', cam: 'top',
      sev: k => `支架晃動振幅 ${f1(1 + 14 * k)} µm、衰減時間 ${Math.round(40 + 80 * k)} ms`,
      dur: 9, exi: 8,
      model(k) { const A = 1 + 14 * k, tau = 40 + 80 * k, f = 22, thr = 0.5 * camSpec().um; const off = t => A * Math.exp(-t / tau) * Math.cos(2 * Math.PI * f * t / 1000) + 0.15 * Math.sin(t * 0.9); const ts = A > thr ? tau * Math.log(A / thr) : 0; return { A, tau, f, thr, off, ts }; },
      tms: p => p < 0.3 ? -1 : (p - 0.3) / 0.7 * 400,
      frame(p, k) {
        const m = this.model(k), t = this.tms(p);
        if (t < 0) { const u = ease(p / 0.3); return { px: -42 * (1 - u), sway: 0, img: { u: -(1 - u) * 2600, v: 0 }, cap: '平台高速移到相機下方（加速度跟生產時一樣）' }; }
        const o = m.off(t);
        return { px: 0, sway: o * 0.004, img: { u: o / camSpec().um * this.exi, v: 0 }, cap: `停下後 ${Math.round(t)} ms：Mark 偏 ${sg(o, 2)} µm` };
      },
      data(k) { const m = this.model(k), pts = []; for (let t = 0; t <= 400; t += 4) pts.push({ x: t, y: m.off(t), tp: 0.3 + t / 400 * 0.7 }); return { pts, m }; },
      chart(k) { const { pts, m } = this.data(k), Y = Math.max(4, Math.ceil(m.A + 1)); return { xr: [0, 400], yr: [-Y, Y], xl: '停下後時間 (ms)', yl: 'Mark 偏移 (µm)', band: [-m.thr, m.thr], bandLb: '±0.5 px', vl: [{ x: Math.min(400, m.ts), lb: `穩定 ${Math.round(m.ts)} ms`, c: '--hot' }, { x: 100, lb: '拍照延遲 100', c: '--muted' }], s: [{ pts, kind: 'line', c: '--accent' }] }; },
      live(p, k) { const m = this.model(k), t = this.tms(p); return t < 0 ? `移動中…<br>穩定門檻 ±${f2(m.thr)} µm（0.5 px）` : `停下後 <b>${Math.round(t)} ms</b>：偏移 <b>${sg(m.off(t), 2)} µm</b>（${sg(m.off(t) / camSpec().um, 2)} px）<br>穩定門檻 ±${f2(m.thr)} µm（0.5 px）`; },
      res(k) { const m = this.model(k), ts = Math.round(m.ts); return { c: ts <= 100 ? 'ok' : ts <= 200 ? 'warnp' : 'bad', t: `穩定時間 ${ts} ms；拍照延遲至少要 ${Math.max(20, ts + 20)} ms`, n: ts <= 100 ? '目前 100 ms 延遲足夠。' : '延遲 100 ms 時會拍到還在晃的畫面，量到的位置每次不同。' }; },
      doc: {
        why: '相機或支架只要會晃，平台停下來的那一刻畫面還在動，拍到的 Mark 位置就每次不一樣。九點校正、旋轉中心、放料補正全部都建立在「拍到的位置是準的」上面，所以這項要最先做。',
        how: ['玻璃治具放在平台上，Mark 移到上相機中心。', '<b>靜止重複性</b>：平台不動，連拍 30 張，記錄 Mark 位置。', '<b>停下後穩定時間</b>：用生產時的速度與加速度從遠處移到同一點，停下後分別延遲 0、20、50、100、150、200、300 ms 拍照，每個延遲做 5 次。', '把「Mark 位置對延遲時間」畫成曲線，看多久之後才進到 ±0.5 px 內。', '上下相機都做；下相機跟著平台跑，晃動通常更明顯。'],
        judge: ['靜止連拍 30 張：3σ ≤ 0.3 px。超過代表相機、光源或影像處理本身就不穩，先不要往下做。', '停下後穩定時間 ≤ 目前設定的拍照延遲。', '曲線是「衰減的正弦波」→ 機構在共振；頻率高（>50 Hz）多半是支架或相機座，低（10–30 Hz）多半是龍門或整台機架。'],
        fix: ['支架懸臂太長、截面太薄：加肋或改短；相機座四顆螺絲都要鎖到規定扭力。', '龍門或機架共振：降低加速度、加 S 曲線（jerk 限制），或在拍照前加延遲。', '拍照延遲設在穩定時間＋20 ms；不要用「到位訊號一出現就拍」。'],
        link: null
      }
    },
    {
      id: 'rot', title: '相機與平台 X 軸夾角', sub: '平台走直線，畫面裡 Mark 走斜線', cam: 'top',
      sev: k => `相機相對 X 軸轉了 ${f2(0.15 + 2.35 * k)}°`,
      dur: 11, exi: 1, n: 9,
      ang: k => 0.15 + 2.35 * k,
      pos(i) { const fx = camSpec().fov[0]; return (-0.4 + 0.8 * i / (this.n - 1)) * fx; },
      frame(p, k) {
        const s = stops(p, this.n), x0 = s.i ? this.pos(s.i - 1) : this.pos(0) - 0.25 * camSpec().fov[0], x = x0 + (this.pos(s.i) - x0) * s.u;
        const a = this.ang(k) * D2R, c = camSpec();
        return { px: x / c.fov[0] * 10, camYaw: a * 4, img: { u: x * Math.cos(a) * 1000 / c.um, v: -x * Math.sin(a) * 1000 / c.um }, trail: this.data(k).pts.filter((q, j) => j < s.i || (j === s.i && s.dwell)).map(q => [q.x, q.y]), cap: s.dwell ? `第 ${s.i + 1} 點：X = ${f3(this.pos(s.i))} mm，拍照` : '平台只走 X，Y 不動' };
      },
      data(k) { const a = this.ang(k) * D2R, c = camSpec(), r = rng(11), pts = []; for (let i = 0; i < this.n; i++) { const x = this.pos(i); pts.push({ x: x * Math.cos(a) * 1000 / c.um + gauss(r) * 0.3, y: -x * Math.sin(a) * 1000 / c.um + gauss(r) * 0.3, tp: (i + 0.56) / this.n }); } return { pts }; },
      chart(k) { const { pts } = this.data(k), c = camSpec(), W = c.w / 2, H = Math.max(40, Math.ceil(Math.max(...pts.map(q => Math.abs(q.y))) / 20 + 1) * 20); const L = linfit(pts.map(q => [q.x, q.y])); return { xr: [-W, W], yr: [-H, H], xl: '影像 u (px)', yl: '影像 v (px)', s: [{ pts, kind: 'dot', c: '--accent' }], fit: L }; },
      live(p, k) { const s = stops(p, this.n), pts = this.data(k).pts.slice(0, s.i + (s.dwell ? 1 : 0)); if (pts.length < 2) return '至少拍 2 點才能算角度'; const L = linfit(pts.map(q => [q.x, q.y])); return `已拍 ${pts.length} 點：斜率 ${f3(L.b)}<br>夾角 = atan(Δv/Δu) = <b>${f2(-Math.atan(L.b) * R2D)}°</b>`; },
      res(k) { const a = this.ang(k); return { c: a <= 0.5 ? 'ok' : a <= 1.5 ? 'warnp' : 'bad', t: `相機相對 X 軸 ${f2(a)}°`, n: '九點校正會把這個角度算進去，所以角度本身不會讓放料偏；要注意的是<b>每次校正的角度差 > 0.05°</b>（相機座在動），或<b>換一個 Y 位置量出來角度不同</b>（X 軸本身走歪 → 做千分錶測試一）。' }; },
      doc: {
        why: '相機裝上去一定會有一點旋轉。九點校正會把它補掉，但如果這個角度「會變」——相機座鬆了、或 X 軸本身走的不是直線——校正完還是會偏。這項用很簡單的方法把角度量出來，並確認它穩不穩定。',
        how: ['Mark 移到上相機畫面左側，<b>只動 X、Y 不動</b>。', '每次走固定距離（約視野的 1/10），停下等穩定後拍照，走到畫面右側，共 7–9 點。', '把 Mark 的像素座標 (u, v) 做直線擬合，夾角 = atan(Δv/Δu)。', '在 Y 行程前、中、後三個位置各做一次。', '每週或每次撞機後重做，跟上次比較。'],
        judge: ['三個 Y 位置的角度差 ≤ 0.02°：X 軸走得直，相機座穩。', '跟上次比差 > 0.05°：相機座在動，檢查鎖附。', '直線擬合殘差 > 0.5 px：X 軸走的不是直線（直線度問題），用千分錶測試一確認。'],
        fix: ['相機座加定位銷，鎖附後點漆做記號，下次一看就知道有沒有動。', '角度 > 1.5° 時把相機轉正再校正，畫面邊緣的鏡頭變形影響會比較小。', '不同 Y 角度不同 → X 導軌偏擺，見「千分錶：X 軸偏擺與直線度」與「導軌調整」。'],
        link: 1
      }
    },
    {
      id: 'tilt', title: '光軸垂直度（相機歪頭）', sub: 'Z 高度一變，Mark 位置就跟著跑', cam: 'top',
      sev: k => `光軸傾斜 ${f2(0.1 + 1.4 * k)}°`,
      dur: 11, exi: 10, n: 9,
      ang: k => 0.1 + 1.4 * k,
      z: i => -1 + 2 * i / 8,
      frame(p, k) {
        const s = stops(p, this.n), z0 = s.i ? this.z(s.i - 1) : 0, z = z0 + (this.z(s.i) - z0) * s.u, b = this.ang(k) * D2R, du = z * 1000 * Math.tan(b);
        return { pz: z, camTilt: b * 5, img: { u: du / camSpec().um * this.exi, v: 0 }, trail: this.data(k).pts.filter((q, j) => j < s.i || (j === s.i && s.dwell)).map(q => [q.y / camSpec().um * this.exi, 0]), cap: `Z = ${sg(z, 2)} mm：Mark 偏 ${sg(du, 2)} µm` };
      },
      data(k) { const b = this.ang(k) * D2R, r = rng(23), pts = []; for (let i = 0; i < this.n; i++) { const z = this.z(i); pts.push({ x: z, y: z * 1000 * Math.tan(b) + gauss(r) * 0.25, tp: (i + 0.56) / this.n }); } return { pts }; },
      chart(k) { const { pts } = this.data(k), Y = Math.max(5, Math.ceil(Math.max(...pts.map(q => Math.abs(q.y))) / 5 + 1) * 5); return { xr: [-1.1, 1.1], yr: [-Y, Y], xl: 'Z 高度 (mm)', yl: 'Mark 偏移 (µm)', s: [{ pts, kind: 'dot', c: '--accent' }], fit: linfit(pts.map(q => [q.x, q.y])) }; },
      live(p, k) { const s = stops(p, this.n), pts = this.data(k).pts.slice(0, s.i + (s.dwell ? 1 : 0)); if (pts.length < 2) return '至少拍 2 個高度'; const L = linfit(pts.map(q => [q.x, q.y])); return `斜率 <b>${f2(L.b)} µm/mm</b><br>傾斜角 = atan(斜率) = <b>${f2(Math.atan(L.b / 1000) * R2D)}°</b>`; },
      res(k) { const b = this.ang(k) * D2R, e = 200 * Math.tan(b); return { c: e <= 1 ? 'ok' : e <= 3 ? 'warnp' : 'bad', t: `高度差 0.2 mm 會偏 ${f2(e)} µm`, n: '校正時 Mark 的高度跟生產時料面高度不一樣（料厚、吸嘴長度、治具厚度），就會吃到這個誤差。' }; },
      doc: {
        why: '相機光軸沒有垂直平台時，同一個 XY 位置、不同高度的東西，在畫面裡的位置會不一樣。校正用的玻璃治具和實際的料厚度不同，或下相機看吸嘴時吸嘴高度不同，就會產生固定偏移，而且換料號就變。',
        how: ['玻璃治具 Mark 移到上相機中心，記下 Z。', 'Z 每次往上或往下 0.25 mm（要在景深內，影像要清楚），每個高度停下拍照，共 9 個高度。', '畫出「Mark 偏移對 Z」，直線斜率就是 tan(傾斜角)。', 'u、v 兩個方向都要看；兩個方向合起來才是完整的傾斜。', '下相機用同樣方法：吸嘴吸住治具，Z 上下走。'],
        judge: ['料厚差（或高度差）× tan(傾斜角) ≤ 放料容許誤差的 1/5。', '常見要求：傾斜 ≤ 0.3°（每 1 mm 高度差 ≤ 5 µm）。'],
        fix: ['相機座安裝面墊片調整，或改用可調角度的相機座。', '校正治具的 Mark 高度做成跟料面一樣（同厚度治具），誤差就不會出現。', '用遠心鏡頭可以消除「高度變 → 放大倍率變」的問題，但光軸傾斜造成的平移仍然存在。'],
        link: null
      }
    },
    {
      id: 'focus', title: '對焦與景深', sub: '校正高度和料面高度都要拍得清楚', cam: 'top',
      sev: k => `最佳焦點偏離校正高度 ${f2(0.05 + 0.35 * k)} mm`,
      dur: 10, exi: 1,
      z0: k => 0.05 + 0.35 * k, W: 0.22, hs: [[0, '校正高度'], [0.1, '料面高度']],
      sharp(z, k) { return Math.exp(-Math.pow((z - this.z0(k)) / this.W, 2)); },
      zp: p => -0.6 + 1.2 * clamp(p, 0, 1),
      frame(p, k) { const z = this.zp(p), s = this.sharp(z, k); return { pz: z, img: { u: 0, v: 0, blur: 1 - s }, cap: `Z = ${sg(z, 2)} mm：清晰度 ${Math.round(s * 100)}%` }; },
      data(k) { const pts = []; for (let i = 0; i <= 48; i++) { const z = -0.6 + 1.2 * i / 48; pts.push({ x: z, y: this.sharp(z, k) * 100, tp: i / 48 }); } return { pts }; },
      chart(k) { return { xr: [-0.6, 0.6], yr: [0, 100], xl: 'Z 高度 (mm)', yl: '清晰度 (%)', band: [80, 100], bandLb: '景深內（≥ 80%）', vl: this.hs.map(([z, lb]) => ({ x: z, lb, c: '--p2' })), s: [{ pts: this.data(k).pts, kind: 'line', c: '--accent' }] }; },
      live(p, k) { const z = this.zp(p); return `Z = <b>${sg(z, 2)} mm</b>，清晰度 <b>${Math.round(this.sharp(z, k) * 100)}%</b><br>` + this.hs.map(([h, lb]) => `${lb}：${Math.round(this.sharp(h, k) * 100)}%`).join('　'); },
      res(k) { const a = this.hs.map(([h]) => this.sharp(h, k)), mn = Math.min(...a), d = this.W * Math.sqrt(Math.log(1 / 0.8)); return { c: mn >= 0.8 ? 'ok' : mn >= 0.5 ? 'warnp' : 'bad', t: `景深約 ±${f2(d)} mm；最佳焦點在 ${sg(this.z0(k), 2)} mm`, n: mn >= 0.8 ? '校正高度與料面高度都在景深內。' : '有一個高度不在景深內：影像模糊時 Mark 邊緣抓得不準，位置會飄，也容易找不到。' }; },
      doc: {
        why: '模糊的影像不一定找不到 Mark，但邊緣會變軟，抓到的中心會隨光線、雜訊飄動。如果最佳焦點剛好在校正高度、生產時料面卻偏出景深，校正很好看、生產卻不穩。',
        how: ['Mark 移到相機中心，Z 從低到高每次走 0.05 mm，每個高度拍一張。', '每張算清晰度（影像軟體的 focus / contrast 分數，或 Mark 邊緣的灰階斜率）。', '畫出清晰度對 Z，找最高點（最佳焦點）和掉到 80% 的兩個高度（景深）。', '標出校正時 Mark 的高度和生產時料面的高度，兩個都要在景深內。'],
        judge: ['兩個高度的清晰度都 ≥ 80%。', '同一高度連拍 30 張，Mark 位置 3σ ≤ 0.3 px（跟第 1 項一起做）。'],
        fix: ['重新對焦到兩個高度的中間。', '高度差大於景深：校正用的治具做成跟料面同高，或生產時用不同的 Z 拍照高度（Z 要先確認垂直度，見第 3 項）。', '光圈縮小可以加大景深，但要補光。'],
        link: null
      }
    },
    {
      id: 'bcam', title: '下相機隨平台：沿 X 的位置偏差', sub: '平台走到不同位置，看同一把玻璃尺', cam: 'bottom',
      sev: k => `X≈420 mm 處導軌局部偏移 ${f1(18 * k)} µm`,
      dur: 12, exi: 10, n: 7,
      X: i => i * 100,
      off(x, k) { const g = Math.exp(-Math.pow((x - 420) / 90, 2)); return { u: 4 * k * x / 600 + 0.2 * Math.sin(x / 37), v: 18 * k * g + 0.25 * Math.cos(x / 53) }; },
      frame(p, k) {
        const s = stops(p, this.n), x0 = s.i ? this.X(s.i - 1) : 0, x = x0 + (this.X(s.i) - x0) * s.u, o = this.off(x, k), c = camSpec();
        return { px: -45 + 90 * x / 600, yawP: 0.0035 * o.v, bcam: true, img: { u: o.u / c.um * this.exi, v: -o.v / c.um * this.exi }, cap: s.dwell ? `X = ${this.X(s.i)} mm：玻璃尺第 ${s.i + 1} 個 Mark` : '平台帶著下相機往下一個刻線走' };
      },
      data(k) { const pts = [], pu = []; for (let i = 0; i < this.n; i++) { const x = this.X(i), o = this.off(x, k), tp = (i + 0.56) / this.n; pts.push({ x, y: o.v, tp }); pu.push({ x, y: o.u, tp }); } return { pts, pu }; },
      chart(k) { const d = this.data(k), Y = Math.max(5, Math.ceil(Math.max(...d.pts.map(q => Math.abs(q.y)), ...d.pu.map(q => Math.abs(q.y))) / 5 + 1) * 5); return { xr: [0, 600], yr: [-Y, Y], xl: '平台 X (mm)', yl: '偏差 (µm)', s: [{ pts: d.pts, kind: 'line', c: '--accent', lb: 'Y 方向' }, { pts: d.pu, kind: 'line', c: '--p2', lb: 'X 方向' }] }; },
      live(p, k) { const s = stops(p, this.n), pts = this.data(k).pts.slice(0, s.i + (s.dwell ? 1 : 0)); if (!pts.length) return '—'; const ys = pts.map(q => q.y); return `已量 ${pts.length} 個位置<br>Y 方向偏差 峰-峰 <b>${f1(Math.max(...ys) - Math.min(...ys))} µm</b>`; },
      res(k) { const ys = this.data(k).pts.map(q => q.y), pp = Math.max(...ys) - Math.min(...ys); return { c: pp <= 3 ? 'ok' : pp <= 8 ? 'warnp' : 'bad', t: `Y 方向偏差 峰-峰 ${f1(pp)} µm（X≈400 附近凸起）`, n: '玻璃尺本身是直的，所以這條曲線就是平台走 X 時「實際走出來的路線」（直線度＋偏擺造成的相機位移）。局部凸起 → 用千分錶測試一確認是不是該段 X 導軌沒靠緊。' }; },
      doc: {
        why: '下相機裝在平台上跟著跑，平台走 X 時只要導軌有一段不直或偏擺，下相機就跟著偏移或轉動。光學尺只量 X 方向的位置，量不到這些，所以會變成「某些位置放料特別偏」。',
        how: ['在平台3（固定）裝一把玻璃尺或一排 Mark（間距已知，例如 100 mm）。', '平台走到每個 Mark 下方，停下等穩定，用下相機拍。', '記錄每個位置 Mark 在畫面裡的偏差 (u, v)，減掉玻璃尺本身的已知誤差。', 'Y 方向（垂直於運動方向）的變化 = X 軸直線度＋偏擺 × 相機到旋轉中心的距離。', '來回各走一次，比較是否重合。'],
        judge: ['Y 方向偏差 峰-峰 ≤ 3 µm。', '局部凸起（某一段特別大）→ 導軌安裝問題；整體一條斜線 → 玻璃尺沒放正，可扣掉。', '來回不重合 → 滑塊預壓不足或有間隙。'],
        fix: ['局部凸起：用千分錶測試一量那一段的偏擺，必要時重新靠緊導軌（見「導軌調整」）。', '整體一致的彎曲：可以做成沿 X 的補正表，但要先確認每天量都一樣。'],
        link: 1
      }
    },
    {
      id: 'dd', title: 'DD 轉動偏擺（吸盤／吸嘴跳動）', sub: 'DD 轉一圈，千分錶與相機一起看', cam: 'top',
      sev: k => `吸盤偏心 ${f1(0.8 + 9 * k)} µm`,
      dur: 10, exi: 20, ph: 30,
      e: k => 0.8 + 9 * k,
      frame(p, k) {
        const th = 360 * clamp(p, 0, 1), e = this.e(k), r = e * Math.cos((th - this.ph) * D2R), c = camSpec();
        return { dd: th, ecc: e, gauge: r, img: { u: e * Math.cos((th - this.ph) * D2R) / c.um * this.exi, v: -e * Math.sin((th - this.ph) * D2R) / c.um * this.exi }, trailFn: true, cap: `DD = ${Math.round(th)}°：千分錶 ${sg(r, 2)} µm` };
      },
      data(k) { const e = this.e(k), pts = []; for (let a = 0; a <= 360; a += 7.5) pts.push({ x: a, y: e * Math.cos((a - this.ph) * D2R), tp: a / 360 }); return { pts }; },
      chart(k) { const e = this.e(k), Y = Math.max(3, Math.ceil(e + 1)); return { xr: [0, 360], yr: [-Y, Y], xl: 'DD 角度 (°)', yl: '千分錶讀數 (µm)', s: [{ pts: this.data(k).pts, kind: 'line', c: '--accent' }] }; },
      live(p, k) { const th = 360 * clamp(p, 0, 1), pts = this.data(k).pts.filter(q => q.x <= th), ys = pts.map(q => q.y); return `DD = <b>${Math.round(th)}°</b>，讀數 ${sg(this.e(k) * Math.cos((th - this.ph) * D2R), 2)} µm<br>目前 TIR（最大−最小）<b>${f1(ys.length ? Math.max(...ys) - Math.min(...ys) : 0)} µm</b>`; },
      res(k) { const t = 2 * this.e(k); return { c: t <= 3 ? 'ok' : t <= 10 ? 'warnp' : 'bad', t: `TIR ${f1(t)} µm（偏心 ${f1(t / 2)} µm）`, n: '偏心會被旋轉中心校正一起量進去，所以固定的偏心不會讓放料偏；問題在於<b>每次換吸嘴、重新鎖吸盤偏心都不同</b>，或 TIR 在不同高度不一樣（軸歪）。' }; },
      doc: {
        why: 'DD 轉動時如果吸盤或吸嘴不是對著轉軸中心，料在吸盤上的位置會隨角度畫圓。旋轉中心校正可以補固定的偏心，但吸嘴換過、鎖歪、錐度沾膠，偏心就變了，放料偏移會跟 DD 角度有關。',
        how: ['千分錶表座吸在不跟 DD 轉的地方（平台本體），測頭頂吸盤或吸嘴的外圓。', 'DD 慢慢轉一圈，每 15° 停一下記錄讀數；TIR = 最大 − 最小，偏心 = TIR ÷ 2。', '測頭換到上下兩個高度各量一次：兩個高度的 TIR 不同 → 吸嘴或 DD 軸是歪的。', '相機方法：吸盤上貼 Mark，DD 轉一圈每 30° 拍一次，Mark 畫出的圓半徑就是偏心（同時也是旋轉中心校正的資料）。', '吸嘴拆下重裝 3 次，各量一次，看偏心是否變化。'],
        judge: ['TIR ≤ 3 µm（吸嘴外圓）。', '重裝 3 次偏心變化 ≤ 2 µm；超過的話每次換吸嘴都要重做旋轉中心校正。', '上下兩個高度 TIR 差 ≤ 2 µm。'],
        fix: ['清潔吸嘴錐度與吸盤定位面，換磨損的吸嘴。', '吸盤加定位銷或改用定心夾具。', '偏心穩定但偏大：可以接受，但旋轉中心校正要在換吸嘴後重做（見「校正手順」步驟 3、「旋轉中心計算」）。'],
        link: null
      }
    },
    {
      id: 'rep', title: '重複定位與反向間隙', sub: '從兩個方向回到同一點各拍 5 次', cam: 'top',
      sev: k => `反向間隙 ${f1(0.3 + 6 * k)} µm、重複性 σ ${f2(0.35 + 0.5 * k)} µm`,
      dur: 14, exi: 30, n: 10,
      model(k) { const b = 0.3 + 6 * k, s = 0.35 + 0.5 * k, r = rng(41), pts = []; for (let i = 0; i < this.n; i++) { const d = i % 2 ? -1 : 1; pts.push({ x: d * b / 2 + gauss(r) * s, y: gauss(r) * s * 0.8, d, tp: (i + 0.8) / this.n }); } return { b, s, pts }; },
      frame(p, k) {
        const m = this.model(k), s = clamp(p, 0, 0.9999) * this.n, i = Math.floor(s), f = s - i, d = i % 2 ? -1 : 1;
        const away = f < 0.35 ? ease(f / 0.35) : f < 0.7 ? 1 - ease((f - 0.35) / 0.35) : 0, c = camSpec();
        const q = m.pts[i], arrived = f >= 0.7;
        const u = arrived ? q.x : d * away * 2600 * c.um / this.exi, v = arrived ? q.y : 0;
        return { px: d * 18 * away, img: { u: u / c.um * this.exi, v: -v / c.um * this.exi }, dots: m.pts.slice(0, i + (f >= 0.8 ? 1 : 0)).map(q => [q.x / c.um * this.exi, -q.y / c.um * this.exi, q.d]), cap: `第 ${i + 1} 次：從 ${d > 0 ? '+X' : '−X'} 方向回到目標點` };
      },
      data(k) { const m = this.model(k); return { pts: m.pts }; },
      chart(k) { const m = this.model(k), Y = Math.max(2, Math.ceil(m.b / 2 + 3 * m.s + 0.5)); return { xr: [-Y, Y], yr: [-Y, Y], xl: 'X 偏差 (µm)', yl: 'Y 偏差 (µm)', s: [{ pts: m.pts.filter(q => q.d > 0), kind: 'dot', c: '--accent', lb: '從 +X 回來' }, { pts: m.pts.filter(q => q.d < 0), kind: 'dot', c: '--p2', lb: '從 −X 回來' }], sq: true }; },
      stats(pts) { const g = d => pts.filter(q => q.d === d).map(q => q.x), mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1), sd = a => Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / Math.max(1, a.length - 1)); const A = g(1), B = g(-1); return { b: mean(A) - mean(B), s3: 3 * Math.max(sd(A), sd(B)), nA: A.length, nB: B.length }; },
      live(p, k) { const m = this.model(k), n = Math.floor(clamp(p, 0, 0.9999) * this.n + 0.2), st = this.stats(m.pts.slice(0, n)); return st.nA >= 2 && st.nB >= 2 ? `+X ${st.nA} 次、−X ${st.nB} 次<br>雙向平均差 <b>${f2(st.b)} µm</b>，單向 3σ <b>${f2(st.s3)} µm</b>` : `已拍 ${n} 次（兩個方向各 2 次以上才能算）`; },
      res(k) { const st = this.stats(this.model(k).pts); return { c: Math.abs(st.b) <= 1 && st.s3 <= 2 ? 'ok' : Math.abs(st.b) <= 3 ? 'warnp' : 'bad', t: `雙向平均差 ${f2(st.b)} µm；單向 3σ ${f2(st.s3)} µm`, n: '雙向差大 → 反向間隙（滑塊預壓、聯軸器、光學尺讀頭鬆）；兩個方向都很散 → 停下後還在晃（回第 1 項）或伺服增益。' }; },
      doc: {
        why: '放料偏移忽大忽小、或跟「從哪個方向過來」有關，通常是重複定位或反向間隙。用相機量最直接：同一個點，從兩個方向各回來幾次，看拍到的位置。',
        how: ['Mark 放在上相機中心當目標點。', '平台從 +X 方向 5 mm 外回到目標點，等穩定後拍照；再從 −X 方向 5 mm 外回來拍照。交替做，兩個方向各 5 次以上。', 'Y 方向用同樣方法再做一次。', '分兩群算：每個方向的平均與 3σ；兩個方向平均的差就是反向間隙。'],
        judge: ['單向 3σ ≤ 2 µm。', '雙向平均差 ≤ 1 µm。', '生產時如果每次都從同一個方向進來，反向間隙影響較小，但校正時的進入方向也要一樣。'],
        fix: ['反向間隙：檢查滑塊預壓、聯軸器、光學尺讀頭與尺的間隙與鎖附。', '單向就很散：先確認第 1 項穩定時間，再看伺服到位判定（in-position 範圍）是否太寬。', '暫時對策：校正與生產都改成「同方向進入」（最後一段固定從同一側靠近）。'],
        link: null
      }
    },
    {
      id: 'chuck', title: '吸盤平面度與料件滑移', sub: '拍完四角後，料在吸盤上有沒有跑', cam: 'top',
      sev: k => `吸盤局部高點 ${Math.round(4 + 26 * k)} µm（孔口毛邊／異物）`,
      dur: 16, exi: 20, n: 8, th: 30,
      // 高點是一條稜線：料架在上面像蹺蹺板，平台往某些方向加速時往稜線兩側滑 → 只在特定方向（位置）出現、而且是兩個相反方向
      slip(i, k) { const a = i * 45, c = Math.cos((a - this.th) * D2R), r = rng(53 + i); return k * 12 * Math.sign(c) * Math.pow(Math.abs(c), 3) + gauss(r) * 0.25; },
      frame(p, k) {
        const s = clamp(p, 0, 0.9999) * this.n, i = Math.floor(s), f = s - i, a = i * 45 * D2R, c = camSpec();
        const out = f < 0.4 ? ease(f / 0.4) : f < 0.75 ? 1 - ease((f - 0.4) / 0.35) : 0;
        const sl = this.slip(i, k) * ease(clamp(f / 0.12, 0, 1)), nx = Math.cos(this.th * D2R), ny = Math.sin(this.th * D2R);
        const dots = []; for (let j = 0; j < i + (f >= 0.8 ? 1 : 0); j++) { const v = this.slip(j, k); dots.push([v * nx / c.um * this.exi, -v * ny / c.um * this.exi, Math.sign(v) || 1]); }
        const shot = f >= 0.75;
        return { px: Math.cos(a) * 26 * out, pyP: -Math.sin(a) * 18 * out, slip: [sl * nx, sl * ny], ridge: true, img: shot ? { u: sl * nx / c.um * this.exi, v: -sl * ny / c.um * this.exi } : { u: 0, v: 0, hide: !shot && out > 0.15 }, dots,
          cap: f < 0.4 ? `第 ${i + 1} 次：拍完四角後往 ${i * 45}° 方向加速（Z 不上升、不放料）` : f < 0.75 ? '走回原位' : `回原位再拍：料滑了 ${sg(this.slip(i, k), 1)} µm` };
      },
      data(k) { const nx = Math.cos(this.th * D2R), pts = []; for (let i = 0; i < this.n; i++) pts.push({ x: i * 45, y: this.slip(i, k), tp: (i + 0.8) / this.n }); return { pts }; },
      chart(k) { const { pts } = this.data(k), Y = Math.max(3, Math.ceil(Math.max(...pts.map(q => Math.abs(q.y))) + 1)); return { xr: [-20, 335], yr: [-Y, Y], xl: '加速方向 (°)', yl: '料件滑移 (µm，沿高點法線)', band: [-1, 1], bandLb: '±1 µm', s: [{ pts: pts.filter(q => q.y >= 0), kind: 'dot', c: '--accent', lb: '往 + 側滑' }, { pts: pts.filter(q => q.y < 0), kind: 'dot', c: '--p2', lb: '往 − 側滑' }] }; },
      live(p, k) { const n = Math.floor(clamp(p, 0, 0.9999) * this.n + 0.2), ys = []; for (let j = 0; j < n; j++) ys.push(this.slip(j, k)); return ys.length ? `已測 ${ys.length} 個方向<br>最大滑移 <b>${f1(Math.max(...ys.map(Math.abs)))} µm</b>；超過 1 µm 的方向：<b>${ys.map((v, j) => Math.abs(v) > 1 ? j * 45 + '°' : '').filter(Boolean).join('、') || '無'}</b>` : '每個方向：放料 → 拍四角 → 照生產速度走出去再走回來 → 再拍'; },
      res(k) { const ys = []; for (let j = 0; j < this.n; j++) ys.push(this.slip(j, k)); const m = Math.max(...ys.map(Math.abs)), pos = ys.filter(v => v > 1).length, neg = ys.filter(v => v < -1).length; return { c: m <= 1 ? 'ok' : m <= 3 ? 'warnp' : 'bad', t: `最大滑移 ${f1(m)} µm${pos && neg ? '，出現在兩個相反方向' : ''}`, n: m <= 1 ? '拍完到放料之間料沒有跑，偏移要往放料接觸（料盤高度、Z 垂直）找。' : '料在吸盤上滑動：只有往某些方向加速時才滑，所以只在特定位置偏、而且是兩個方向——典型是吸盤上有一條高點（孔口毛邊、異物、平面度不良），料像蹺蹺板架在上面。' }; },
      doc: {
        why: '吸盤靠孔洞真空吸住料件。孔口有毛邊、表面有異物或吸盤不平時，料不會完全貼平，真空也會漏，吸附力變小。上相機拍完四角以後，平台加速去放料的途中，料就可能在吸盤上滑一點點——拍照時是對的，放下去卻偏了。因為只有往某些方向加速才會滑，偏移就只出現在特定位置，而且常常是兩個相反方向（料架在高點兩側翹）。',
        how: ['<b>滑移測試（最直接）</b>：放料、上相機拍四角記下位置；平台照生產的速度與加速度走到有問題的那個位置，<b>Z 不上升、不放料</b>；走回來再拍四角。位置變了就是料在吸盤上滑。', '每個有問題的位置、以及 8 個加速方向各做 3 次，畫出「滑移量對方向」。', '<b>吸盤平面度</b>：千分錶表座吸在 Z 軸本體，平台 XY 走格點（例如每 10 mm）掃過吸盤面，做成高度表；孔口周圍要特別量。', '<b>端面跳動</b>：千分錶頂在吸盤面靠外緣，DD 轉一圈，TIR 就是吸盤面跟轉軸的不垂直量。', '同時看真空表：有問題的位置真空度是否比較低（料沒貼平會漏氣）。'],
        judge: ['滑移量 ≤ 1 µm（在所有方向）。', '吸盤平面度 ≤ 5 µm，孔口不能有凸起的毛邊。', '端面跳動 TIR ≤ 5 µm（在吸盤外緣量）。', '有吸料時真空度要達到規格，且各位置一樣。'],
        fix: ['孔口毛邊：用油石輕推平、倒角，清潔吸盤面與料件背面。', '平面度不良：研磨吸盤，或加一層平整的吸附墊。', '端面跳動大：吸盤重新鎖附、清潔 DD 與吸盤接合面，必要時加墊片調整。', '真空不足：加大真空、檢查漏氣；必要時降低平台加速度或加 S 曲線，減少把料甩動的力。', '滑移測試沒有滑：問題在放料接觸，量平台3 料盤那幾個穴位的高度與 Z 軸垂直度。'],
        link: null
      }
    }
  ];

  // 症狀 → 先做哪一項
  const SYMS = [
    ['同一點連拍，位置就在跳', 'settle', '千分錶不用；先把相機穩住'],
    ['放料偏移忽大忽小、跟進入方向有關', 'rep', 'settle'],
    ['每次九點校正角度都不一樣', 'rot', 'settle'],
    ['換料號（料厚不同）就偏', 'tilt', 'focus'],
    ['某些料盤位置特別偏（跟 X 位置有關）', 'bcam', 'dial1'],
    ['角度補償只在某幾欄需要、正負號不同', 'dial2', 'chuck'],
    ['只在特定位置偏、而且有兩個方向', 'chuck', 'dd'],
    ['偏移跟 DD 角度有關', 'dd', 'rot'],
    ['平台移動時 Y 滑座整個在轉', 'dial2', 'bcam']
  ];
  const NAME = { dial1: '千分錶：X 軸偏擺與直線度', dial2: '千分錶：Y 滑座重心耦合', dial3: '導軌調整' };
  CHECKS.forEach((c, i) => { NAME[c.id] = `${i + 1}. ${c.title}`; });

  // ---------- 3D 場景 ----------
  let R = null;
  function ensure3() {
    if (R || !G.THREE) return R;
    const THREE = G.THREE, host = $('#vk3d');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, G.devicePixelRatio || 1));
    host.insertBefore(renderer.domElement, host.firstChild);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(36, 1, 0.5, 2000); cam.up.set(0, 1, 0);
    const ctl = new THREE.OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.maxPolarAngle = Math.PI * 0.62;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(60, 120, 80); scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.25); dl2.position.set(-80, 40, -60); scene.add(dl2);
    const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.2 }, o || {}));
    const M = {
      base: mat(0x4a5452, { roughness: 0.85 }), rail: mat(0xb9c2c8, { metalness: 0.7, roughness: 0.3 }), plat: mat(0x2f6db5), z: mat(0x5b7fae),
      dd: mat(0x8d979e, { metalness: 0.6, roughness: 0.3 }), glass: mat(0x9fd3d8, { transparent: true, opacity: 0.55, roughness: 0.1 }), mark: mat(0x111111, { roughness: 0.9 }),
      gantry: mat(0x7f9a90), cam: mat(0x6a4fbd), lens: mat(0xd8dde0, { metalness: 0.85, roughness: 0.2 }), nozzle: mat(0xcf7a22),
      gauge: mat(0xd8dde0, { metalness: 0.8, roughness: 0.25 }), face: mat(0xffffff, { metalness: 0, roughness: 0.6 }), needle: mat(0xd2332b, { metalness: 0 }), magB: mat(0x1f6f78)
    };
    const box = (w, h, d, m, x, y, z, p) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x || 0, y || 0, z || 0); (p || scene).add(o); return o; };
    const cyl = (r, h, m, x, y, z, p, seg) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 32), m); o.position.set(x || 0, y || 0, z || 0); (p || scene).add(o); return o; };
    const lineMat = c => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.85 });

    // 底座、X 導軌
    box(130, 4, 70, M.base, 0, -2, 0);
    [-8, 8].forEach(z => box(120, 1.4, 2, M.rail, 0, 0.7, z));
    // 平台（X）→ Z → DD → 吸盤/玻璃治具
    const plat = new THREE.Group(); scene.add(plat);
    box(26, 3, 22, M.plat, 0, 2.9, 0, plat);
    const zG = new THREE.Group(); zG.position.y = 4.4; plat.add(zG);
    box(10, 3, 10, M.z, 0, 1.5, 0, zG);
    const dd = new THREE.Group(); dd.position.y = 3; zG.add(dd);
    cyl(5.5, 1.6, M.dd, 0, 0.8, 0, dd, 40);
    const chuck = new THREE.Group(); dd.add(chuck);
    box(12, 0.8, 12, M.glass, 0, 2, 0, chuck);
    cyl(0.75, 0.12, M.mark, 0, 2.46, 0, chuck, 24);
    const nozzle = cyl(1.6, 3.2, M.nozzle, 0, 4.0, 0, chuck, 28);
    const ridge = box(11, 0.5, 0.7, mat(0xe0457b, { emissive: 0x6a1030, emissiveIntensity: 0.4 }), 0, 1.75, 0, dd); ridge.rotation.y = -60 * D2R;
    // 下相機（裝在平台上往上看）
    const bcam = new THREE.Group(); bcam.position.set(16, 4.4, 0); plat.add(bcam);
    box(4, 5, 4, M.cam, 0, 2.5, 0, bcam); cyl(1.3, 2, M.lens, 0, 6, 0, bcam);
    // 龍門與上相機
    [-52, 52].forEach(x => box(4, 42, 4, M.gantry, x, 21, -14));
    box(108, 4, 4, M.gantry, 0, 42, -14);
    box(8, 6, 14, M.gantry, 0, 38, -8);
    const camG = new THREE.Group(); camG.position.set(0, 34, 0); scene.add(camG);
    box(6, 9, 6, M.cam, 0, 0, 0, camG); cyl(1.6, 3, M.lens, 0, -6, 0, camG);
    // 視野框（上相機往下、下相機往上）
    function frustum(parent, y0, y1, w, h, color) {
      const g = new THREE.Group(), pts = [], c = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      c.forEach(([x, z]) => { pts.push(new THREE.Vector3(0, y0, 0), new THREE.Vector3(x, y1, z)); });
      c.forEach(([x, z], i) => { const [x2, z2] = c[(i + 1) % 4]; pts.push(new THREE.Vector3(x, y1, z), new THREE.Vector3(x2, y1, z2)); });
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color))); parent.add(g); return g;
    }
    const fTop = frustum(camG, -7.5, -34 + 9.95, 10, 10 * 2040 / 2448, 0x9b83e6);
    const RULER_Y = 26;
    const fBot = frustum(bcam, 7, RULER_Y - 4.4 - 0.4, 6, 5, 0x9b83e6);
    // 玻璃尺（平台3 上，給下相機看）
    const ruler = new THREE.Group(); scene.add(ruler);
    box(104, 0.8, 6, M.glass, 16, RULER_Y, 0, ruler);
    for (let i = 0; i < 7; i++) cyl(0.6, 0.1, M.mark, -45 + 15 * i + 16, RULER_Y - 0.45, 0, ruler, 20);
    [-38, 70].forEach(x => box(3, RULER_Y - 1, 3, M.gantry, x, (RULER_Y - 1) / 2, 6, ruler));
    // 千分錶（表座吸在平台本體、測頭頂吸嘴外圓）
    const gauge = new THREE.Group(); gauge.position.set(9, 0, 0); zG.add(gauge);
    box(3, 2.4, 3, M.magB, 0, 4.2, 6, gauge);
    box(0.6, 0.6, 6, M.dd, 0, 5.4, 3, gauge);
    const gBody = new THREE.Group(); gBody.position.set(0, 7, 0); gauge.add(gBody);
    const gc = cyl(1.6, 0.9, M.gauge, 0, 0, 0, gBody, 40);
    const gf = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), M.face); gf.rotation.x = -Math.PI / 2; gf.position.y = 0.46; gBody.add(gf);
    const gPiv = new THREE.Group(); gPiv.position.y = 0.5; gBody.add(gPiv);
    const gN = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 1.25), M.needle); gN.position.z = -0.5; gPiv.add(gN);
    const stem = cyl(0.22, 1, M.gauge, 0, 0, 0, gBody, 12); stem.rotation.z = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), M.gauge); gBody.add(tip);
    // 3D 標籤（DOM）
    const lbBox = $('#vklabels');
    const LBL = [
      { t: '上相機', o: camG, off: [0, 6, 0], c: 'c', show: id => true },
      { t: '平台（XY＋Z＋DD）', o: plat, off: [-10, 5, 10], show: id => true },
      { t: '玻璃治具 Mark', o: chuck, off: [0, 3, 6], show: id => id !== 'bcam' && id !== 'chuck' },
      { t: '料件', o: chuck, off: [0, 3, 6], show: id => id === 'chuck' },
      { t: '下相機', o: bcam, off: [0, 9, 0], c: 'c', show: id => id === 'bcam' },
      { t: '玻璃尺（平台3）', o: ruler, off: [50, RULER_Y + 2, 0], show: id => id === 'bcam' },
      { t: '千分錶', o: gBody, off: [0, 2.2, 0], c: 'a', show: id => id === 'dd' },
      { t: '吸嘴', o: nozzle, off: [0, 2.6, 0], c: 'b', show: id => id === 'dd' },
      { t: '吸盤高點（孔口毛邊／異物）', o: ridge, off: [5, 0.6, 0], c: 'b', show: id => id === 'chuck' }
    ].map(l => { const el = D.createElement('div'); el.className = 'vklbl' + (l.c ? ' ' + l.c : ''); el.textContent = l.t; lbBox.appendChild(el); return Object.assign(l, { el }); });
    R = { THREE, renderer, scene, cam, ctl, host, plat, zG, dd, chuck, nozzle, ridge, bcam, camG, fTop, fBot, ruler, gauge, gPiv, stem, tip, LBL, v: new THREE.Vector3() };
    new ResizeObserver(resize3).observe(host);
    const th = () => { try { renderer.setClearColor(new THREE.Color(css('--stage'))); } catch (e) { /* 無 */ } };
    th(); if (G.matchMedia) G.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', th);
    new MutationObserver(th).observe(D.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    resize3(); view(); requestAnimationFrame(loop);
    return R;
  }
  function resize3() { if (!R) return; const w = R.host.clientWidth || 400, h = R.host.clientHeight || 300; R.renderer.setSize(w, h, false); R.renderer.domElement.style.width = w + 'px'; R.renderer.domElement.style.height = h + 'px'; R.cam.aspect = w / h; R.cam.updateProjectionMatrix(); }
  const VIEWS = { top: { pos: [46, 46, 70], tgt: [0, 14, 0] }, bottom: { pos: [40, 30, 78], tgt: [10, 14, 0] }, dd: { pos: [24, 26, 34], tgt: [2, 10, 0] } };
  function view() { if (!R) return; const c = CHECKS[cur], v = VIEWS[c.id === 'dd' ? 'dd' : c.cam]; const asp = (R.host.clientWidth || 1) / (R.host.clientHeight || 1), f = Math.max(1, Math.min(1.8, 1.45 / asp)); R.cam.position.set(...v.pos.map((p, i) => v.tgt[i] + (p - v.tgt[i]) * f)); R.ctl.target.set(...v.tgt); R.ctl.update(); }

  function pose(st) {
    const c = CHECKS[cur];
    R.plat.position.set(st.px || 0, 0, st.pyP || 0); R.plat.rotation.y = st.yawP || 0;
    R.zG.position.y = 4.4 + (st.pz || 0) * 3;
    R.dd.rotation.y = -(st.dd || 0) * D2R;
    const e = (st.ecc || 0) * 0.12;     // 偏心放大顯示
    const sl = st.slip || [0, 0];     // 料件滑移（µm，放大顯示）
    R.chuck.position.set(e * Math.cos(this_ph()) + sl[0] * 0.15, st.slip ? 0.25 : 0, -e * Math.sin(this_ph()) - sl[1] * 0.15);
    R.chuck.rotation.set(st.slip ? 0.012 : 0, 0, 0);
    R.ridge.visible = c.id === 'chuck';
    R.camG.rotation.set(0, st.camYaw || 0, (st.sway || 0) + (st.camTilt || 0));
    R.bcam.visible = R.fBot.visible = R.ruler.visible = c.id === 'bcam';
    R.fTop.visible = c.id !== 'bcam';
    R.gauge.visible = c.id === 'dd'; R.nozzle.visible = c.id === 'dd';
    if (c.id === 'dd') {
      // 測頭頂吸嘴外圓：吸嘴中心在世界座標的 x 位置 + 半徑
      R.chuck.updateWorldMatrix(true, false); R.nozzle.getWorldPosition(R.v);
      R.gauge.updateWorldMatrix(true, false); const gp = R.gauge.localToWorld(new R.THREE.Vector3(0, 7, 0));
      const len = Math.max(0.2, gp.x - (R.v.x + 1.6) - 1.6);
      R.stem.scale.y = len; R.stem.position.set(-1.6 - len / 2, 0, 0); R.tip.position.set(-1.6 - len, 0, 0);
      R.gPiv.rotation.y = -(st.gauge || 0) / 10 * 2 * Math.PI;
    }
  }
  function this_ph() { return (CHECKS[cur].ph || 0) * D2R; }
  function placeLabels() {
    const w = R.host.clientWidth, h = R.host.clientHeight, id = CHECKS[cur].id;
    R.LBL.forEach(l => {
      if (!l.show(id)) { l.el.hidden = true; return; }
      l.o.updateWorldMatrix(true, false); R.v.set(...l.off); l.o.localToWorld(R.v); R.v.project(R.cam);
      const ok = R.v.z < 1 && Math.abs(R.v.x) < 1.05 && Math.abs(R.v.y) < 1.05; l.el.hidden = !ok;
      l.el.style.transform = `translate(${(R.v.x * 0.5 + 0.5) * w}px,${(-R.v.y * 0.5 + 0.5) * h}px) translate(-50%,-100%)`;
    });
  }

  // ---------- 相機畫面（2D） ----------
  function drawImg(st) {
    const cv = $('#vkimg'), c = CHECKS[cur], sp = camSpec();
    const W = cv.clientWidth || 320, H = Math.round(W * sp.h / sp.w), dpr = Math.min(2, G.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = W / sp.w, cx = W / 2, cy = H / 2;
    g.fillStyle = css('--img-bg'); g.fillRect(0, 0, W, H);
    g.strokeStyle = css('--img-grid'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.moveTo(0, cy); g.lineTo(W, cy); g.stroke();
    // 0.5 px 門檻圈（放大後）
    const rMark = 0.3 / 2 * 1000 / sp.um * s;   // Mark 直徑 0.3 mm
    const img = st.img || { u: 0, v: 0 };
    if (st.trail) { g.fillStyle = css('--img-jig'); st.trail.forEach(([u, v]) => { g.beginPath(); g.arc(cx + u * s, cy + v * s, 2.5, 0, 7); g.fill(); }); }
    if (st.dots) st.dots.forEach(([u, v, d]) => { g.fillStyle = d > 0 ? css('--img-jig') : '#f0a35e'; g.beginPath(); g.arc(cx + u * s, cy + v * s, 3, 0, 7); g.fill(); });
    if (c.id === 'dd') { const e = CHECKS[cur].e(kOf()) / sp.um * c.exi * s; g.strokeStyle = css('--img-jig'); g.setLineDash([3, 3]); g.beginPath(); g.arc(cx, cy, e, 0, 7); g.stroke(); g.setLineDash([]); }
    if (c.id === 'rot' && st.trail && st.trail.length >= 2) { const L = linfit(st.trail); g.strokeStyle = css('--img-jig'); g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, cy + (L.a + L.b * (-W / 2 / s)) * s); g.lineTo(W, cy + (L.a + L.b * (W / 2 / s)) * s); g.stroke(); g.setLineDash([]); }
    if (img.hide) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '12px ' + css('--f-body'); g.fillText('平台移動中（料不在視野內）', 10, 18); }
    const mx = img.hide ? -999 : cx + img.u * s, my = img.hide ? -999 : cy + img.v * s, blur = clamp(img.blur || 0, 0, 1);
    if (blur > 0.02) {
      const gr = g.createRadialGradient(mx, my, Math.max(0, rMark * (1 - blur * 0.9)), mx, my, rMark * (1 + blur * 1.4));
      gr.addColorStop(0, css('--img-mark')); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr;
      g.beginPath(); g.arc(mx, my, rMark * (1 + blur * 1.4), 0, 7); g.fill();
    } else { g.fillStyle = css('--img-mark'); g.beginPath(); g.arc(mx, my, rMark, 0, 7); g.fill(); }
    g.strokeStyle = css('--hot'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(mx - 6, my); g.lineTo(mx + 6, my); g.moveTo(mx, my - 6); g.lineTo(mx, my + 6); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '11px ' + css('--f-mono');
    g.fillText(`${sp.w}×${sp.h} px`, 6, H - 6);
    if (c.exi > 1) { const t = `位移放大 ×${c.exi}`; g.fillText(t, W - g.measureText(t).width - 6, H - 6); }
  }

  // ---------- 曲線圖（SVG） ----------
  const NS = 'http://www.w3.org/2000/svg';
  function el(p, n, a, txt) { const e = D.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; p.appendChild(e); return e; }
  let CH = null;
  function buildChart() {
    const svg = $('#vkchart'); svg.innerHTML = '';
    const c = CHECKS[cur], cfg = c.chart(kOf()), Wd = 340, Ht = cfg.sq ? 250 : 200, x0 = 44, x1 = Wd - 10, y0 = 22, y1 = Ht - 34;
    svg.setAttribute('viewBox', `0 0 ${Wd} ${Ht}`);
    const sx = x => x0 + (x - cfg.xr[0]) / (cfg.xr[1] - cfg.xr[0]) * (x1 - x0), sy = y => y1 - (clamp(y, cfg.yr[0], cfg.yr[1]) - cfg.yr[0]) / (cfg.yr[1] - cfg.yr[0]) * (y1 - y0);
    const nice = (a, b, n) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / n))), m = [1, 2, 2.5, 5, 10].find(m => (b - a) / (st * m) <= n) * st, out = []; for (let v = Math.ceil(a / m) * m; v <= b + 1e-9; v += m) out.push(+v.toFixed(6)); return out; };
    if (cfg.band) { el(svg, 'rect', { x: x0, y: sy(cfg.band[1]), width: x1 - x0, height: sy(cfg.band[0]) - sy(cfg.band[1]), class: 'vk-band' }); if (cfg.bandLb) el(svg, 'text', { x: x1 - 4, y: sy(cfg.band[1]) + 11, 'text-anchor': 'end', class: 'vk-t' }, cfg.bandLb); }
    nice(cfg.yr[0], cfg.yr[1], 5).forEach(v => { el(svg, 'line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v), class: v === 0 ? 'vk-ax0' : 'vk-ax' }); el(svg, 'text', { x: x0 - 5, y: sy(v) + 3.5, 'text-anchor': 'end', class: 'vk-t' }, v); });
    nice(cfg.xr[0], cfg.xr[1], 6).forEach(v => el(svg, 'text', { x: sx(v), y: y1 + 14, 'text-anchor': 'middle', class: 'vk-t' }, v));
    el(svg, 'text', { x: x1, y: Ht - 4, 'text-anchor': 'end', class: 'vk-t' }, cfg.xl);
    el(svg, 'text', { x: 4, y: 9, class: 'vk-t' }, cfg.yl);
    (cfg.vl || []).forEach(v => { el(svg, 'line', { x1: sx(v.x), x2: sx(v.x), y1: y0, y2: y1, style: `stroke:var(${v.c})`, class: 'vk-vl' }); el(svg, 'text', { x: sx(v.x) + 3, y: y0 + 9, class: 'vk-t', style: `fill:var(${v.c})` }, v.lb); });
    const fit = cfg.fit ? el(svg, 'line', { class: 'vk-fit', x1: sx(cfg.xr[0]), x2: sx(cfg.xr[1]), y1: sy(cfg.fit.a + cfg.fit.b * cfg.xr[0]), y2: sy(cfg.fit.a + cfg.fit.b * cfg.xr[1]) }) : null;
    const S = cfg.s.map(s => ({ s, path: s.kind === 'line' ? el(svg, 'path', { class: 'vk-ln', style: `stroke:var(${s.c})` }) : null, g: s.kind === 'dot' ? el(svg, 'g', { style: `fill:var(${s.c})` }) : null, n: -1 }));
    const leg = cfg.s.filter(s => s.lb);
    if (leg.length) leg.forEach((s, i) => { const lx = x0 + 6 + i * 92; el(svg, 'rect', { x: lx, y: y1 - 14, width: 10, height: 3, style: `fill:var(${s.c})` }); el(svg, 'text', { x: lx + 14, y: y1 - 10, class: 'vk-t' }, s.lb); });
    CH = { S, sx, sy, fit };
  }
  function updChart(p) {
    if (!CH) return;
    let shown = 0;
    CH.S.forEach(o => {
      const vis = o.s.pts.filter(q => q.tp <= p + 1e-9); if (vis.length === o.n) { shown += vis.length; return; } o.n = vis.length; shown += vis.length;
      if (o.path) o.path.setAttribute('d', vis.map((q, i) => (i ? 'L' : 'M') + CH.sx(q.x).toFixed(1) + ' ' + CH.sy(q.y).toFixed(1)).join(''));
      if (o.g) { o.g.innerHTML = ''; vis.forEach(q => el(o.g, 'circle', { cx: CH.sx(q.x), cy: CH.sy(q.y), r: 3.6 })); }
    });
    if (CH.fit) CH.fit.style.opacity = p >= 0.999 ? 1 : 0;
  }

  // ---------- 狀態、播放 ----------
  let cur = 0, t = 0, playing = true, lastTs = 0, hold = 0;
  const K = CHECKS.map(() => 0.6);
  const kOf = () => K[cur];
  const reduce = G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pOf() { return clamp(t / CHECKS[cur].dur, 0, 1); }
  function renderList() {
    $('#vklist').innerHTML = CHECKS.map((c, i) => `<button class="vkbtn" data-i="${i}" ${i === cur ? 'aria-current="step"' : ''}><span class="num">${i + 1}</span><span class="st"><b>${c.title}</b><small>${c.sub}</small></span></button>`).join('');
    $$('#vklist .vkbtn').forEach(b => b.addEventListener('click', () => select(+b.dataset.i, true)));
  }
  function renderDoc() {
    const c = CHECKS[cur], d = c.doc, r = c.res(kOf());
    $('#vkdoc').innerHTML = `<h3>${cur + 1}. ${c.title}</h3>
      <p class="lead">${d.why}</p>
      <div class="two"><div><h4>怎麼做</h4><ol>${d.how.map(x => `<li>${x}</li>`).join('')}</ol></div>
      <div><h4>判定標準</h4><ul>${d.judge.map(x => `<li>${x}</li>`).join('')}</ul><h4>常見原因與處理</h4><ul>${d.fix.map(x => `<li>${x}</li>`).join('')}</ul>
      ${d.link ? `<p><button class="btn" data-goto="dial${d.link}">→ 用千分錶確認：${NAME['dial' + d.link]}</button></p>` : ''}</div></div>
      <p class="note">動畫與曲線是模擬示意，用來說明怎麼量、怎麼判斷；實際數值請用你機台的量測結果。</p>`;
    $$('#vkdoc [data-goto]').forEach(b => b.addEventListener('click', () => G.MECH && G.MECH.sub(b.dataset.goto)));
    $('#vkres').innerHTML = `<span class="pill ${r.c}">${r.c === 'ok' ? '正常' : r.c === 'bad' ? '要處理' : '注意'}</span> <b>${r.t}</b><br><span class="note">${r.n}</span>`;
  }
  function renderSev() { const c = CHECKS[cur]; $('#vksev').value = Math.round(K[cur] * 100); $('#vksevt').textContent = c.sev(K[cur]); $('#vkimgt').textContent = c.cam === 'bottom' ? '下相機3 畫面（往上看）' : '上相機1 畫面（往下看）'; }
  function select(i, scroll) {
    cur = i; t = 0; hold = 0; playing = !reduce; setBtn();
    $$('#vklist .vkbtn').forEach(b => b.toggleAttribute('aria-current', +b.dataset.i === i));
    if (scroll) { const b = $(`#vklist .vkbtn[data-i="${i}"]`); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    renderSev(); renderDoc(); buildChart(); view(); frame();
  }
  function frame() {
    const c = CHECKS[cur], p = pOf(), st = c.frame(p, kOf());
    if (R) pose(st);
    drawImg(st); updChart(p);
    $('#vkcap').textContent = st.cap || '';
    $('#vklive').innerHTML = c.live(p, kOf());
    $('#vkscrub').value = Math.round(p * 1000);
  }
  function setBtn() { const b = $('#vkplay'); if (!b) return; b.textContent = playing ? '暫停' : '播放'; b.setAttribute('aria-pressed', playing ? 'true' : 'false'); }
  const vis = () => { const v = $('#view-mech'), d = $('#vk'); return !!(v && !v.hidden && d && !d.hidden); };
  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0); lastTs = ts;
    if (vis()) {
      if (playing) { const T = CHECKS[cur].dur; if (t < T) t = Math.min(T, t + dt); else { hold += dt; if (hold > 2.5) { t = 0; hold = 0; } } }
      frame(); R.ctl.update(); R.renderer.render(R.scene, R.cam); placeLabels();
    }
    requestAnimationFrame(loop);
  }

  // ---------- 初始化 ----------
  let inited = false;
  function init() {
    if (inited) return; inited = true;
    $('#vksym').innerHTML = `<table class="vksymt"><thead><tr><th>放料時看到的狀況</th><th>先做</th><th>再確認</th></tr></thead><tbody>${SYMS.map(([s, a, b]) => `<tr><td>${s}</td><td><button class="linkbtn" data-goto="${a}">${NAME[a]}</button></td><td>${NAME[b] ? `<button class="linkbtn" data-goto="${b}">${NAME[b]}</button>` : b}</td></tr>`).join('')}</tbody></table>`;
    $$('#vksym [data-goto]').forEach(b => b.addEventListener('click', () => { const g = b.dataset.goto, i = CHECKS.findIndex(c => c.id === g); if (i >= 0) { select(i, true); const s = $('#vkmain'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); } else if (G.MECH) G.MECH.sub(g); }));
    renderList();
    $('#vkplay').addEventListener('click', () => { if (t >= CHECKS[cur].dur) { t = 0; hold = 0; } playing = !playing; setBtn(); });
    $('#vkrestart').addEventListener('click', () => { t = 0; hold = 0; playing = true; setBtn(); });
    $('#vkscrub').addEventListener('input', e => { t = +e.target.value / 1000 * CHECKS[cur].dur; playing = false; setBtn(); frame(); });
    $('#vksev').addEventListener('input', e => { K[cur] = +e.target.value / 100; renderSev(); renderDoc(); buildChart(); frame(); });
    ensure3(); select(0, false);
  }
  function show() { init(); resize3(); view(); frame(); }
  G.VISCHK = { init, show, select, CHECKS, state: () => ({ cur, t, p: pOf(), k: K[cur], playing }), setK: (i, k) => { K[i] = k; if (i === cur) { renderSev(); renderDoc(); buildChart(); frame(); } }, seek: p => { t = p * CHECKS[cur].dur; playing = false; setBtn(); frame(); }, linfit };
})(typeof window !== 'undefined' ? window : globalThis);
