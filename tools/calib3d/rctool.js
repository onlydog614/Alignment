// ===== 旋轉中心計算分頁：手動輸入多點機械座標 → 圓擬合、2D 圖、3D 動畫 =====
(function (G) {
  'use strict';
  const CAL = G.CAL, { V, D2R, R2D } = CAL, M0 = G.M0;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  const KEY = 'cal-rc-input-v1';
  const f3 = v => (isFinite(v) ? v.toFixed(3) : '–'), f4 = v => (isFinite(v) ? v.toFixed(4) : '–');
  const um = v => (isFinite(v) ? (v * 1000).toFixed(1) : '–');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- 範例資料（已知真值，加 1 µm 雜訊） ----------
  function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  function sample(kind) {
    const r = CAL.rng(kind === 'half' ? 7 : 3), C = [123.456, -78.912], R = 30.0, ph0 = 12 * D2R, out = [];
    const angs = kind === 'half' ? [-45, -22.5, 0, 22.5, 45] : [0, 45, 90, 135, 180, 225, 270, 315];
    out.push(kind === 'noang' ? '# 範例：只有 XY，沒有 DD 角度（至少 3 點）' : kind === 'half' ? '# 範例：DD 只轉 ±45°，5 點' : '# 範例：DD 轉整圈，每 45° 一點');
    out.push('# X(mm)\tY(mm)' + (kind === 'noang' ? '' : '\tDD角度(°)'));
    angs.forEach(a => {
      // XY 跟隨：S = C − Rot(θ)·(r,0)；雜訊 1 µm
      const t = a * D2R + ph0, p = [C[0] - R * Math.cos(t) + gauss(r) * 0.001, C[1] - R * Math.sin(t) + gauss(r) * 0.001];
      out.push(p[0].toFixed(4) + '\t' + p[1].toFixed(4) + (kind === 'noang' ? '' : '\t' + a));
    });
    return out.join('\n');
  }
  const SAMPLES = [['整圈 8 點（XY 跟隨）', 'full'], ['只轉 ±45°（5 點）', 'half'], ['沒填角度（只有 XY）', 'noang']];

  // ---------- 解析 ----------
  // 文字（CSV／Tab／空白分隔）→ 列；# 註解、非數字的標題行略過
  function parseRows(txt) {
    const rows = [], bad = []; let header = 0;
    String(txt).replace(/^\uFEFF/, '').split(/\r?\n/).forEach((ln, i) => {
      const s = ln.replace(/#.*/, '').trim(); if (!s) return;
      const a = s.split(/[\t,;，；]+|\s+/).map(v => v.trim()).filter(v => v !== '');
      const num = a.slice(0, 3).map(v => v === '' ? NaN : Number(v));
      if (a.length >= 2 && isFinite(num[0]) && isFinite(num[1])) rows.push([a[0], a[1], a.length >= 3 && isFinite(num[2]) ? a[2] : '']);
      else if (!rows.length && !header && !bad.length) header++;
      else bad.push(i + 1);
    });
    return { rows, bad, header };
  }
  // 表格的列 → 計算用的點
  function rowsToPts(rows) {
    const pts = [], ths = [], bad = [];
    rows.forEach((r, i) => {
      const [x, y, t] = r.map(v => String(v == null ? '' : v).trim());
      if (x === '' && y === '' && t === '') return;
      if (x === '' || y === '' || !isFinite(+x) || !isFinite(+y) || (t !== '' && !isFinite(+t))) { bad.push(i + 1); return; }
      pts.push([+x, +y]); ths.push(t === '' ? null : +t);
    });
    return { pts, ths, bad };
  }
  function parse(txt) { return rowsToPts(parseRows(txt).rows); }

  // ---------- 表格 ----------
  let ROWS = [];
  function renderRows(focus) {
    const tb = $('#rcrows');
    tb.innerHTML = ROWS.map((r, i) => `<tr><td>${i + 1}</td>${[0, 1, 2].map(j => `<td><input type="text" inputmode="decimal" data-r="${i}" data-c="${j}" value="${esc(r[j])}" aria-label="第 ${i + 1} 點 ${['X', 'Y', 'DD 角度'][j]}"></td>`).join('')}<td><button class="del" data-del="${i}" aria-label="刪除第 ${i + 1} 點" title="刪除這一列">×</button></td></tr>`).join('');
    if (focus) { const el = tb.querySelector(`input[data-r="${focus[0]}"][data-c="${focus[1]}"]`); if (el) el.focus(); }
  }
  function markBad(bad) { $$('#rcrows tr').forEach((tr, i) => tr.querySelectorAll('input').forEach(el => { const v = el.value.trim(); el.setAttribute('aria-invalid', bad.includes(i + 1) && (v === '' ? el.dataset.c !== '2' : !isFinite(+v)) ? 'true' : 'false'); })); }
  function setRows(rows) { ROWS = rows.map(r => [0, 1, 2].map(j => r[j] == null ? '' : String(r[j]))); if (!ROWS.length) ROWS.push(['', '', '']); renderRows(); }
  function rowsCSV() { return 'X(mm),Y(mm),DD角度(deg)\n' + ROWS.filter(r => r.some(v => String(v).trim() !== '')).map(r => r.map(v => String(v).trim()).join(',')).join('\n') + '\n'; }
  function importText(txt, src) {
    const p = parseRows(txt);
    if (!p.rows.length) { $('#rcmsg').textContent = `${src}沒有讀到任何點（每行要有 X、Y 兩個數字）`; return false; }
    setRows(p.rows); compute();
    $('#rcmsg').textContent = `已從${src}讀入 ${p.rows.length} 點` + (p.bad.length ? `；第 ${p.bad.join('、')} 行看不懂，已略過` : '');
    return true;
  }

  // ---------- 計算 ----------
  let last = null;
  function compute() {
    const mode = $('#rcmode').value;
    try { localStorage.setItem(KEY, JSON.stringify({ rows: ROWS, mode, rx: $('#rcrefx').value, ry: $('#rcrefy').value, thr: $('#rcthr').value })); } catch (e) { /* 無儲存空間時略過 */ }
    const { pts, ths, bad } = rowsToPts(ROWS);
    markBad(bad);
    const anyTh = ths.some(v => v != null), allTh = ths.length > 0 && ths.every(v => v != null);
    const fit = CAL.rcFromPoints(pts, allTh ? ths : null);
    const thrUm = +$('#rcthr').value > 0 ? +$('#rcthr').value : 0.5 * M0.top[0].mmpp * 1000;
    // 主要結果：有角度用「已知角度擬合」（線性、2 點即可）；沒角度用幾何圓
    const main = fit.ang && fit.ang.ok ? { kind: 'ang', center: fit.ang.center, r: fit.ang.r, res: fit.ang.res, rms: fit.ang.rms } : (fit.geo.ok ? { kind: 'geo', center: fit.geo.center, r: fit.geo.r, res: fit.geo.res.map(Math.abs), rms: fit.geo.rms } : null);
    last = { pts, ths: allTh ? ths : null, fit, main, mode, thrUm };
    $('#rcmsg').textContent = `讀到 ${pts.length} 點` + (bad.length ? `；第 ${bad.join('、')} 列有格子不是數字（紅框），先略過` : '') + (anyTh && !allTh ? '；有些列沒填角度，角度全部不用' : '');
    render();
    anim.build(last);
    return last;
  }

  function refMeta(mode) {
    return mode === 'follow'
      ? { lg: '換算成 R̂（可省略）', note: '填上相機九點校正後「十字中心」對應的平台位置 Ĉ_top（u = 0 時的 Ĉ）。R̂ = Ĉ_top − 圓心。', lx: 'Ĉ_top X', ly: 'Ĉ_top Y' }
      : { lg: '換算成 R̂（可省略）', note: '填量 Mark 時平台停的 XY 位置 S。R̂ = 圓心 − S（平台在 S = 0 時的旋轉中心）。', lx: '平台 S X', ly: '平台 S Y' };
  }

  // ---------- 2D 圖 ----------
  function plot(L) {
    const g = L.fit.geo, c = L.main.center, r = L.main.r, W = 520, H = 400, pad = 46;
    const ext = Math.max(r, ...L.pts.map(p => V.len(V.sub(p, c)))) * 1.18;
    const s = (Math.min(W, H) - 2 * pad) / (2 * ext), sx = x => W / 2 + (x - c[0]) * s, sy = y => H / 2 - (y - c[1]) * s;
    const maxRes = Math.max(1e-9, ...L.main.res);
    // 殘差放大：最大殘差畫成半徑的 12%
    const mag = (0.12 * r) / maxRes, magTxt = mag >= 1 ? `殘差放大 ${mag >= 100 ? Math.round(mag).toLocaleString() : mag.toFixed(0)} 倍` : '';
    let o = `<svg viewBox="0 0 ${W} ${H}" class="rcplot" role="img" aria-label="量測點與擬合圓">`;
    o += `<line x1="${pad / 2}" y1="${H / 2}" x2="${W - pad / 2}" y2="${H / 2}" class="c-ax"/><line x1="${W / 2}" y1="${pad / 2}" x2="${W / 2}" y2="${H - pad / 2}" class="c-ax"/>`;
    o += `<circle cx="${W / 2}" cy="${H / 2}" r="${(r * s).toFixed(1)}" class="c-fit"/>`;
    o += `<path d="M${W / 2 - 9},${H / 2} h18 M${W / 2},${H / 2 - 9} v18" class="c-ctr"/>`;
    L.pts.forEach((p, i) => {
      const d = V.sub(p, c), dl = V.len(d) || 1, u = V.mul(d, 1 / dl), rr = dl - r;
      const ex = V.add(c, V.mul(u, r + rr * mag));
      const onC = V.add(c, V.mul(u, r));
      o += `<line x1="${sx(onC[0]).toFixed(1)}" y1="${sy(onC[1]).toFixed(1)}" x2="${sx(ex[0]).toFixed(1)}" y2="${sy(ex[1]).toFixed(1)}" class="c-res"/>`;
      o += `<circle cx="${sx(ex[0]).toFixed(1)}" cy="${sy(ex[1]).toFixed(1)}" r="5" class="c-pt"/>`;
      const lp = V.add(c, V.mul(u, r + 0.13 * ext));
      o += `<text x="${sx(lp[0]).toFixed(1)}" y="${(sy(lp[1]) + 4).toFixed(1)}" text-anchor="middle">${i + 1}</text>`;
    });
    o += `<text x="${W / 2 + 12}" y="${H / 2 - 10}">圓心</text>`;
    o += `<text x="8" y="16" style="fill:var(--muted)">X →、Y ↑（機械座標）　半徑 ${r.toFixed(3)} mm${magTxt ? '　' + magTxt : ''}</text>`;
    if (g.ok) o += `<text x="8" y="${H - 8}" style="fill:var(--muted)">涵蓋角度 ${(g.span * R2D).toFixed(0)}°</text>`;
    return o + '</svg>';
  }

  // ---------- 結果 ----------
  function pill(ok, t) { return `<span class="pill ${ok ? 'ok' : 'bad'}">${t}</span>`; }
  function render() {
    const L = last, out = $('#rcout'), meta = refMeta(L.mode);
    $('#rcreflg').textContent = meta.lg; $('#rcrefnote').textContent = meta.note; $('#rcreflx').textContent = meta.lx; $('#rcrefly').textContent = meta.ly;
    if (!$('#rcthr').value) $('#rcthr').placeholder = L.thrUm.toFixed(1);
    if (!L.main) { out.innerHTML = `<p class="note">${esc((L.fit.ang && !L.fit.ang.ok && L.fit.ang.msg) || L.fit.geo.msg || '至少要 3 點（有填 DD 角度時 2 點）')}</p>`; return; }
    const g = L.fit.geo, a = L.fit.ang && L.fit.ang.ok ? L.fit.ang : null, c = L.main.center;
    const rows = [];
    rows.push(['旋轉中心 X, Y', `<b>(${f4(c[0])}, ${f4(c[1])}) mm</b>`]);
    rows.push(['Mark 到中心半徑', f4(L.main.r) + ' mm']);
    rows.push(['用的方法', L.main.kind === 'ang' ? '已知 DD 角度擬合 P_i = c + Rot(θ_i)·v（線性）' : '幾何圓擬合（最小化徑向殘差，沒有角度資訊）']);
    rows.push(['殘差 RMS／最大', `${um(L.main.rms)}／${um(Math.max(...L.main.res))} µm　${pill(Math.max(...L.main.res) * 1000 <= L.thrUm, Math.max(...L.main.res) * 1000 <= L.thrUm ? '合格' : '超過門檻 ' + L.thrUm.toFixed(1) + ' µm')}`]);
    if (g.ok && isFinite(g.sig[0])) rows.push(['圓心精度 1σ（由殘差估計）', `(${um(g.sig[0])}, ${um(g.sig[1])}) µm${L.pts.length < 5 ? '　<span class="note">點數少，估計不可靠</span>' : ''}`]);
    if (g.ok) rows.push(['涵蓋角度', `${(g.span * R2D).toFixed(1)}°　${pill(g.span * R2D >= 180, g.span * R2D >= 180 ? '足夠' : '偏小：圓心精度變差')}`]);
    if (a && g.ok) {
      const d = V.sub(a.center, g.center);
      rows.push(['兩種方法圓心差', `(${um(d[0])}, ${um(d[1])}) µm${V.len(d) * 1000 > 2 * L.thrUm ? '　' + pill(false, '差太多：角度可能記錯') : ''}`]);
      rows.push(['DD 角度比例（實際 ÷ 指令）', `${isFinite(a.k) ? Math.abs(a.k).toFixed(5) : '–'}　${isFinite(a.k) ? pill(Math.abs(Math.abs(a.k) - 1) < 1e-3, Math.abs(Math.abs(a.k) - 1) < 1e-3 ? '正常' : '偏差大：查 DD 齒比或角度單位') : ''}`]);
      rows.push(['DD 正方向', a.sign > 0 ? '和機械座標同向（俯視逆時針為正）' : '<b>和機械座標相反</b>（俯視順時針為正）；計算已自動反過來']);
    }
    const rx = $('#rcrefx').value, ry = $('#rcrefy').value;
    if (rx !== '' && ry !== '' && isFinite(+rx) && isFinite(+ry)) {
      const ref = [+rx, +ry], R = L.mode === 'follow' ? V.sub(ref, c) : V.sub(c, ref);
      rows.push(['R̂（放料公式用）', `<b>(${f4(R[0])}, ${f4(R[1])}) mm</b>　<span class="note">${L.mode === 'follow' ? 'Ĉ_top − 圓心' : '圓心 − S'}</span>`]);
    }
    const interp = L.mode === 'follow'
      ? `圓心是「DD 軸心剛好在上相機十字正下方」時的平台 XY。XY 跟隨時記下的是平台位置，Mark 一直在十字上，所以平台位置繞著這一點畫圓。`
      : `圓心就是 DD 旋轉中心的機械座標（量的時候 XY 沒動）。`;
    let pr = [];
    L.pts.forEach((p, i) => {
      const ph = g.ok ? g.phis[i] * R2D : NaN;
      pr.push([i + 1, f4(p[0]), f4(p[1]), L.ths ? (+L.ths[i]).toFixed(3) : '–', isFinite(ph) ? ph.toFixed(3) : '–', um(L.main.kind === 'ang' ? L.main.res[i] : g.res[i]), a && a.angRes ? (a.angRes[i] * R2D * 3600).toFixed(1) : '–']);
    });
    const tbl = (h, rs, cls) => `<div class="tbl"><table class="${cls || ''}"><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rs.map(r => `<tr>${r.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const warn = [];
    if (g.ok && g.span * R2D < 90) warn.push(`涵蓋角度只有 ${(g.span * R2D).toFixed(0)}°：圓心精度約為整圈的 ${Math.max(1, (Math.PI / Math.max(1e-3, g.span / 2))).toFixed(0)} 倍差，能轉多大就轉多大。`);
    if (L.pts.length === 3 && !a) warn.push('只有 3 點時圓一定剛好通過，殘差永遠是 0，看不出量錯；建議至少 5 點。');
    if (L.main.kind === 'ang' && L.pts.length === 2) warn.push('只有 2 點時角度擬合剛好解出，沒有多餘資料檢查，而且假設 DD 正方向和機械座標相同；建議至少 5 點。');
    out.innerHTML = `<div class="two"><div><h4>結果</h4>${tbl(['項目', '值'], rows, 'rcsum')}<p class="note">${interp}</p>${warn.map(w => `<p class="note" style="color:var(--warn)">${esc(w)}</p>`).join('')}</div>
      <div><h4>量測點與擬合圓</h4>${plot(L)}<p class="note">紅線是每點的徑向殘差（放大顯示），十字是算出的旋轉中心。</p></div></div>
      <h4>每一點</h4>${tbl(['#', 'X (mm)', 'Y (mm)', 'DD 指令 (°)', '繞圓心的位置角 (°)', '徑向殘差 (µm)', '角度殘差 (″)'], pr)}
      <h4>公式</h4><pre>幾何圓：min Σ(|P_i − c| − r)²　（Kåsa 代數解當初值，Gauss–Newton 收斂）
已知角度：P_i = c + Rot(θ_i)·v　（4 個未知數 c、v 線性最小二乘；|v| = 半徑）
DD 角度比例：繞圓心的位置角 φ_i = φ₀ + k·θ_i，k 應 = 1
XY 跟隨：圓心 = 軸心在十字下的平台 XY，R̂ = Ĉ_top − 圓心
XY 不動：圓心 = 旋轉中心，R̂ = 圓心 − S</pre>`;
  }

  // ---------- 3D 動畫 ----------
  const anim = (function () {
    let R = null, tl = null, t = 0, playing = false, lastTs = 0, L = null;
    const reduce = G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function ensure() {
      if (R || !G.THREE) return R;
      const THREE = G.THREE, host = $('#rc3d');
      THREE.Object3D.DefaultUp.set(0, 0, 1);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, G.devicePixelRatio || 1));
      host.insertBefore(renderer.domElement, host.firstChild);
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(36, 1, 0.5, 20000); cam.up.set(0, 0, 1);
      const ctl = new THREE.OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.dampingFactor = 0.12;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85));
      const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(-400, -600, 900); scene.add(dl);
      R = { THREE, renderer, scene, cam, ctl, host, root: null, mats: [] };
      new ResizeObserver(() => resize()).observe(host);
      resize();
      if (G.matchMedia) G.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (L) build(L); });
      requestAnimationFrame(loop);
      return R;
    }
    function resize() { if (!R) return; const w = R.host.clientWidth || 400, h = R.host.clientHeight || 300; R.renderer.setSize(w, h, false); R.renderer.domElement.style.width = w + 'px'; R.renderer.domElement.style.height = h + 'px'; R.cam.aspect = w / h; R.cam.updateProjectionMatrix(); }
    function label(text, colorVar, h) {
      const THREE = R.THREE, cv = document.createElement('canvas'), ctx = cv.getContext('2d'), fs = 40;
      ctx.font = `600 ${fs}px "Noto Sans TC", sans-serif`; const w = Math.ceil(ctx.measureText(text).width) + 30; cv.width = w; cv.height = fs + 22;
      ctx.fillStyle = css('--label-bg'); ctx.strokeStyle = css(colorVar); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.rect(2, 2, w - 4, cv.height - 4); ctx.fill(); ctx.stroke();
      ctx.font = `600 ${fs}px "Noto Sans TC", sans-serif`; ctx.fillStyle = css('--ink'); ctx.textBaseline = 'middle'; ctx.fillText(text, 15, cv.height / 2 + 2);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
      sp.scale.set(w / cv.height * h, h, 1); sp.renderOrder = 10; return sp;
    }
    // 依量測點建場景（單位 mm，原點 = 相機十字／旋轉中心）
    function build(Ld) {
      L = Ld; if (!ensure()) return;
      const THREE = R.THREE, sc = R.scene;
      if (R.root) { sc.remove(R.root); R.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
      const root = new THREE.Group(); R.root = root; sc.add(root);
      $('#rc3d').style.background = css('--stage'); R.renderer.setClearColor(css('--stage'), 1);
      if (!L.main) { tl = null; $('#rccap').textContent = '輸入至少 3 點（有角度時 2 點）就會產生動畫'; render3(); return; }
      const c = L.main.center, r = Math.max(1e-3, L.main.r), follow = L.mode === 'follow';
      const rel = L.pts.map(p => V.sub(p, c));           // 相對圓心
      const mt = (v, o) => new THREE.MeshStandardMaterial(Object.assign({ color: css(v), roughness: 0.6, metalness: 0.15 }, o || {}));
      const lm = (v, o) => new THREE.LineBasicMaterial({ color: css(v), transparent: true, opacity: o == null ? 1 : o });
      const P = 1.55 * r, zTop = 0.5 * r;                // 轉盤半徑、上表面高度
      // 底座
      const base = new THREE.Mesh(new THREE.BoxGeometry(6.2 * r, 6.2 * r, 0.12 * r), mt('--m-table')); base.position.z = -0.45 * r; root.add(base);
      // XY 平台（隨點移動）＋ DD 轉盤
      const car = new THREE.Group(); root.add(car);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3.6 * r, 3.6 * r, 0.22 * r), mt('--m-steel')); slab.position.z = -0.28 * r; car.add(slab);
      const dd = new THREE.Group(); car.add(dd);
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(P, P, 0.34 * r, 64), mt('--p1')); disk.rotation.x = Math.PI / 2; disk.position.z = zTop - 0.17 * r; dd.add(disk);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(P, 0.06 * r, 0.02 * r), mt('--m-dark')); stripe.position.set(P / 2, 0, zTop + 0.01 * r); dd.add(stripe);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.42 * r, 0.42 * r, 0.04 * r), mt('--glass', { transparent: true, opacity: 0.85 })); glass.position.set(r, 0, zTop + 0.02 * r); dd.add(glass);
      const mark = new THREE.Mesh(new THREE.CircleGeometry(0.07 * r, 32), mt('--mark')); mark.position.set(r, 0, zTop + 0.045 * r); dd.add(mark);
      const axisLn = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.4 * r), new THREE.Vector3(0, 0, zTop + 1.2 * r)]), lm('--hot')); dd.add(axisLn);
      // 固定相機（XY 跟隨時在十字 = 原點上方；XY 不動時看整個圓）
      const camZ = zTop + 2.6 * r, camG = new THREE.Group(); root.add(camG);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5 * r, 0.5 * r, 0.8 * r), mt('--cam')); body.position.z = camZ + 0.4 * r; camG.add(body);
      const fw = follow ? Math.min(0.9 * r, M0.top[0].fov[0]) : 2.6 * r, fh = fw * 0.75, fz = zTop + 0.05 * r;
      const fr = [], cs = [[-fw / 2, -fh / 2], [fw / 2, -fh / 2], [fw / 2, fh / 2], [-fw / 2, fh / 2]];
      cs.forEach(p => fr.push(new THREE.Vector3(0, 0, camZ), new THREE.Vector3(p[0], p[1], fz)));
      for (let i = 0; i < 4; i++) fr.push(new THREE.Vector3(...cs[i], fz), new THREE.Vector3(...cs[(i + 1) % 4], fz));
      const frm = lm('--cam', 0.8), frustum = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fr), frm); camG.add(frustum);
      const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.15 * r, 0, fz), new THREE.Vector3(0.15 * r, 0, fz), new THREE.Vector3(0, -0.15 * r, fz), new THREE.Vector3(0, 0.15 * r, fz)]), lm('--cam'));
      camG.add(cross);
      const camLb = label(follow ? '上相機（固定）' : '相機（固定）', '--cam', 0.32 * r); camLb.position.set(0, 0, camZ + 1.2 * r); camG.add(camLb);
      // 量測點標記（浮在轉盤上方），擬合圓、圓心
      const zp = zTop + 0.35 * r, dots = [];
      rel.forEach((q, i) => {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.075 * r, 16, 12), mt('--hot', { depthTest: false })); d.renderOrder = 5;
        d.position.set(q[0], q[1], zp); d.visible = false; root.add(d);
        const lb = label(String(i + 1), '--hot', 0.22 * r); lb.position.set(q[0] * 1.14, q[1] * 1.14, zp + 0.12 * r); lb.visible = false; root.add(lb);
        dots.push([d, lb]);
      });
      const circ = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018 * r, 8, 160), mt('--ink', { depthTest: false })); circ.position.z = zp; circ.renderOrder = 4; circ.visible = false; root.add(circ);
      const ctr = new THREE.Group(), ctrM = mt('--hot', { depthTest: false });
      [[0.5 * r, 0.04 * r], [0.04 * r, 0.5 * r]].forEach(([w, h]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02 * r), ctrM); b.renderOrder = 4; ctr.add(b); });
      ctr.position.z = zp; ctr.visible = false; root.add(ctr);
      const ctrLb = label(`圓心 (${c[0].toFixed(3)}, ${c[1].toFixed(3)})`, '--accent', 0.26 * r); ctrLb.position.set(0, -0.55 * r, zp + 0.2 * r); ctrLb.visible = false; root.add(ctrLb);
      // 每一點的姿態：XY 跟隨 → 軸心在 rel_i、Mark 轉到原點；XY 不動 → 軸心在原點、Mark 轉到 rel_i
      let prevA = 0;
      const poses = rel.map((q, i) => {
        let a = follow ? Math.atan2(-q[1], -q[0]) : Math.atan2(q[1], q[0]);
        if (i) a = prevA + Math.atan2(Math.sin(a - prevA), Math.cos(a - prevA)); prevA = a;
        return { xy: follow ? q : [0, 0], a };
      });
      const home = { xy: follow ? [0, 0] : [0, 0], a: poses.length ? poses[0].a : 0 };
      // 時間軸
      const segs = []; let T = 0;
      const add = (dur, from, to, cap, extra) => { segs.push(Object.assign({ t0: T, dur, from, to, cap }, extra || {})); T += dur; };
      const start = follow ? { xy: [0, -0.0001], a: 0 } : { xy: [0, 0], a: 0 };
      add(0.8, start, start, follow ? '玻璃 Mark 放在轉盤上，離 DD 中心約 ' + r.toFixed(1) + ' mm' : '平台 XY 停著不動，DD 轉到各角度，相機量 Mark 的機械座標');
      poses.forEach((p, i) => {
        const from = i ? poses[i - 1] : start, th = L.ths ? `θ = ${(+L.ths[i]).toFixed(1)}°` : `第 ${i + 1} 點`;
        add(1.25, from, p, follow ? `${th}：DD 轉到位，XY 把 Mark 移回十字 → 記下平台 XY (${L.pts[i][0].toFixed(3)}, ${L.pts[i][1].toFixed(3)})` : `${th}：DD 轉到位 → 記下 Mark 座標 (${L.pts[i][0].toFixed(3)}, ${L.pts[i][1].toFixed(3)})`);
        add(0.5, p, p, `拍照／記錄第 ${i + 1} 點`, { shot: i });
      });
      const lastP = poses[poses.length - 1];
      add(1.4, lastP, lastP, `${L.pts.length} 點擬合圓：半徑 ${r.toFixed(3)} mm，殘差 RMS ${um(L.main.rms)} µm`, { circ: true });
      if (follow) add(1.6, lastP, { xy: [0, 0], a: lastP.a }, `平台移到圓心 (${c[0].toFixed(3)}, ${c[1].toFixed(3)})：DD 軸心正好在相機十字下`, { circ: true, ctr: true });
      else add(1.2, lastP, lastP, `旋轉中心 (${c[0].toFixed(3)}, ${c[1].toFixed(3)})`, { circ: true, ctr: true });
      add(0.8, segs[segs.length - 1].to, segs[segs.length - 1].to, segs[segs.length - 1].cap, { circ: true, ctr: true });
      tl = { segs, T, car, dd, dots, circ, ctr, ctrLb, frm, n: poses.length };
      // 視角
      const d = 7.5 * r; R.cam.near = r * 0.02; R.cam.far = r * 200; R.cam.updateProjectionMatrix();
      R.cam.position.set(-0.55 * d, -1.05 * d, 0.95 * d); R.ctl.target.set(0, 0, 0.3 * r); R.ctl.update();
      t = reduce ? T : 0; playing = !reduce && visible(); setBtn(); render3();
    }
    const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    function apply() {
      if (!tl) return;
      let s = tl.segs[tl.segs.length - 1]; for (const sg of tl.segs) { if (t < sg.t0 + sg.dur) { s = sg; break; } }
      const f = s.dur ? ease(Math.max(0, Math.min(1, (t - s.t0) / s.dur))) : 1;
      const xy = [s.from.xy[0] + (s.to.xy[0] - s.from.xy[0]) * f, s.from.xy[1] + (s.to.xy[1] - s.from.xy[1]) * f], a = s.from.a + (s.to.a - s.from.a) * f;
      tl.car.position.set(xy[0], xy[1], 0); tl.dd.rotation.z = a;
      let shown = 0; tl.segs.forEach(sg => { if (sg.shot != null && sg.t0 <= t) shown = Math.max(shown, sg.shot + 1); });
      tl.dots.forEach(([d, lb], i) => { d.visible = lb.visible = i < shown; });
      tl.circ.visible = !!s.circ || t >= tl.T; tl.ctr.visible = tl.ctrLb.visible = !!s.ctr || t >= tl.T;
      tl.frm.color.set(css(s.shot != null ? '--hot' : '--cam'));
      $('#rccap').textContent = s.cap;
      $('#rcscrub').value = String(Math.round(t / tl.T * 1000));
    }
    function render3() { if (!R) return; apply(); R.ctl.update(); R.renderer.render(R.scene, R.cam); }
    function visible() { const v = $('#view-rccalc'); return v && !v.hidden; }
    function loop(ts) {
      const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0); lastTs = ts;
      if (visible()) {
        if (playing && tl) { t += dt; if (t >= tl.T) { t = tl.T; playing = false; setBtn(); } }
        render3();
      }
      requestAnimationFrame(loop);
    }
    function setBtn() { const b = $('#rcplay'); b.textContent = playing ? '暫停' : '播放'; b.setAttribute('aria-pressed', playing ? 'true' : 'false'); }
    function bind() {
      $('#rcplay').addEventListener('click', () => { if (!tl) return; if (t >= tl.T) t = 0; playing = !playing; setBtn(); });
      $('#rcrestart').addEventListener('click', () => { t = 0; playing = true; setBtn(); });
      $('#rcscrub').addEventListener('input', e => { if (!tl) return; t = +e.target.value / 1000 * tl.T; playing = false; setBtn(); });
    }
    return { build, bind, resize, state: () => ({ t, T: tl && tl.T, playing, n: tl && tl.n }), seek: v => { t = v; playing = false; setBtn(); render3(); }, play: () => { playing = true; setBtn(); } };
  })();

  // ---------- 初始化 ----------
  let inited = false;
  function init() {
    if (inited) return; inited = true;
    let st = null; try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    $('#rcsamples').innerHTML = '<span class="note" style="margin-right:4px">範例：</span>' + SAMPLES.map(s => `<button class="chip" data-s="${s[1]}">${s[0]}</button>`).join('');
    $$('#rcsamples .chip').forEach(b => b.addEventListener('click', () => { importText(sample(b.dataset.s), '範例'); $('#rcmode').value = 'follow'; compute(); }));
    if (st && Array.isArray(st.rows)) setRows(st.rows); else if (st && st.txt != null) setRows(parseRows(st.txt).rows); else setRows(parseRows(sample('full')).rows);
    if (st && st.mode) $('#rcmode').value = st.mode;
    if (st) { $('#rcrefx').value = st.rx || ''; $('#rcrefy').value = st.ry || ''; $('#rcthr').value = st.thr || ''; }
    let tm = 0; const later = () => { clearTimeout(tm); tm = setTimeout(compute, 250); };
    const tb = $('#rcrows');
    tb.addEventListener('input', e => { const el = e.target; if (el.dataset.r == null) return; ROWS[+el.dataset.r][+el.dataset.c] = el.value; later(); });
    tb.addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; ROWS.splice(+b.dataset.del, 1); if (!ROWS.length) ROWS.push(['', '', '']); renderRows(); compute(); });
    // 從 Excel 複製多列／多欄貼到任一格：從這一格開始往右、往下填
    tb.addEventListener('paste', e => {
      const el = e.target; if (el.dataset.r == null) return;
      const txt = (e.clipboardData || G.clipboardData).getData('text');
      if (!/[\t\n,]/.test(txt.trim())) return;
      e.preventDefault();
      const r0 = +el.dataset.r, c0 = +el.dataset.c;
      const lines = txt.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '' && !/^\s*#/.test(l)).map(l => l.split(/\t|,/).map(v => v.trim()));
      if (lines.length && lines[0].some(v => v !== '' && !isFinite(+v))) lines.shift(); // 標題列
      lines.forEach((cells, k) => { const r = r0 + k; while (ROWS.length <= r) ROWS.push(['', '', '']); cells.slice(0, 3 - c0).forEach((v, j) => { ROWS[r][c0 + j] = v; }); });
      renderRows([r0, c0]); compute();
    });
    // Enter 跳到下一列同一欄，最後一列自動新增
    tb.addEventListener('keydown', e => {
      const el = e.target; if (e.key !== 'Enter' || el.dataset.r == null) return;
      e.preventDefault(); const r = +el.dataset.r + 1, c = +el.dataset.c;
      if (r >= ROWS.length) { ROWS.push(['', '', '']); renderRows([r, c]); } else { const n = tb.querySelector(`input[data-r="${r}"][data-c="${c}"]`); if (n) n.focus(); }
    });
    $('#rcadd').addEventListener('click', () => { ROWS.push(['', '', '']); renderRows([ROWS.length - 1, 0]); });
    $('#rcclear').addEventListener('click', () => { setRows([]); compute(); $('#rcmsg').textContent = '已清空，請填入至少 3 點（有角度時 2 點）'; });
    $('#rcfile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const rd = new FileReader(); rd.onload = () => importText(String(rd.result), `「${f.name}」`); rd.readAsText(f, 'utf-8'); e.target.value = '';
    });
    $('#rcdl').addEventListener('click', () => {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob(['\uFEFF' + rowsCSV()], { type: 'text/csv;charset=utf-8' }));
      a.href = url; a.download = 'rc-points.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('#rccopy').addEventListener('click', () => {
      const txt = rowsCSV(), fallback = () => { $('#rcpaste').open = true; $('#rcin').value = txt; $('#rcin').select(); $('#rcmsg').textContent = '已把 CSV 放進下方文字框並選取，請按 Ctrl+C 複製'; };
      try { navigator.clipboard.writeText(txt).then(() => { $('#rcmsg').textContent = '已複製 CSV，可以貼到 Excel 或記事本'; }, fallback); } catch (e) { fallback(); }
    });
    $('#rcparse').addEventListener('click', () => { if (importText($('#rcin').value, '貼上的內容')) { $('#rcin').value = ''; $('#rcpaste').open = false; } });
    ['#rcrefx', '#rcrefy', '#rcthr'].forEach(s => $(s).addEventListener('input', later));
    $('#rcmode').addEventListener('change', compute);
    anim.bind();
  }
  function show() { init(); compute(); anim.resize(); }
  G.RCT = { show, compute, parse, parseRows, rowsToPts, rowsCSV, importText, setRows, rows: () => ROWS, sample, anim, last: () => last };
})(typeof window !== 'undefined' ? window : globalThis);
