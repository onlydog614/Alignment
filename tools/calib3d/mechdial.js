// ===== 機構調校：千分表架設示範（X 軸偏擺、Y 滑座重心耦合、導軌調整） =====
// 由「千分表架設示範」頁移植；第一次打開分頁才建立 3D 場景，看不到時不算圖
(function (G) {
  let started = false;
  const vis = () => { const v = document.getElementById('view-mech'), d = document.getElementById('mk-dial'); return !!(v && !v.hidden && d && !d.hidden); };
  function init() {
  if (started || !G.THREE) return; started = true;
  const $ = id => document.getElementById('mk-' + id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SEC = 206264.8;

  // ---------- 模擬誤差模型(示意) ----------
  // 基準軌在 X≈585 附近有 0.04 mm 的局部偏移(沒有完全靠緊定位面)
  const rail = x => 0.04 * Math.exp(-0.5 * Math.pow((x - 585) / 90, 2));
  // 從動軌在 X≈300 附近有 0.025 mm 的偏移
  const fol = x => 0.025 * Math.exp(-0.5 * Math.pow((x - 300) / 110, 2));
  const RESID = 0.1;      // 調整後殘留比例
  const B_HALF = 60;      // X 滑塊前後間距一半 (mm)
  const L1 = 120;         // 測試一兩表間距 (mm)
  function poseX(x, k = 1) {
    const yc = k * (rail(x + B_HALF) + rail(x - B_HALF)) / 2;
    const th = k * (rail(x + B_HALF) - rail(x - B_HALF)) / (2 * B_HALF);
    return { yc, th };
  }
  const L2 = 900;         // 測試二兩表間距 (mm)
  const thY = x => 4e-5 * (x - 425) / 325;
  const mmOf = u => u * 10 + 425;   // 場景 x(單位)→ 機台 X (mm)

  // ---------- 3D ----------
  const stage = $('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  camera.up.set(0, 1, 0);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 15; controls.maxDistance = 400;

  const VIEWS = {
    1: { pos: [38, 42, 62], tgt: [0, 9, 3] },
    2: { pos: [95, 85, 150], tgt: [0, 4, 6] },
    3: { pos: [34, 40, 40], tgt: [6, 7, -6] },
  };
  function setView(t) {
    const v = VIEWS[t], asp = (stage.clientWidth || 1) / (stage.clientHeight || 1), f = Math.max(1, Math.min(1.9, 1.5 / asp));   // 畫面窄（手機）時鏡頭拉遠
    camera.position.set(...v.pos.map((p, i) => v.tgt[i] + (p - v.tgt[i]) * f)); controls.target.set(...v.tgt); controls.update();
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(60, 120, 80); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-80, 40, -60); scene.add(fill);

  const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.2 }, o));
  const M = {
    base: mat(0x3b434a, { roughness: 0.8 }),
    rail: mat(0xb9c2c8, { metalness: 0.7, roughness: 0.3 }),
    railHot: mat(0xe0874a, { metalness: 0.4, roughness: 0.4 }),
    block: mat(0x6f7b84, { metalness: 0.5 }),
    plate: mat(0xc9d0d4, { metalness: 0.4, roughness: 0.45 }),
    xcar: mat(0x0d7a87, { metalness: 0.3 }),
    head: mat(0x2a3136),
    granite: mat(0x1b1d1f, { roughness: 0.35, metalness: 0.1 }),
    magA: mat(0x0d7a87), magB: mat(0xc8611f),
    chrome: mat(0xd8dde0, { metalness: 0.85, roughness: 0.2 }),
    face: mat(0xffffff, { roughness: 0.6, metalness: 0 }),
    needle: mat(0xd2332b, { metalness: 0 }),
    arm: mat(0x8d979e, { metalness: 0.6, roughness: 0.3 }),
    motor: mat(0x50585f, { roughness: 0.6 }),
    shoulder: mat(0x7d6a52, { roughness: 0.6 }),
    bolt: mat(0x30363b, { metalness: 0.6, roughness: 0.4 }),
    boltDone: mat(0x0d7a87, { metalness: 0.4 }),
    screw: mat(0x9aa4ab, { metalness: 0.7, roughness: 0.3 }),
    screwDone: mat(0x0d7a87, { metalness: 0.4 }),
    ring: mat(0xc8611f, { emissive: 0x6a2a00, emissiveIntensity: 0.5 }),
  };
  function box(w, h, d, m, x = 0, y = 0, z = 0, parent) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); (parent || scene).add(o); return o;
  }

  // 機台底座 + Y 導軌
  box(124, 6, 260, M.base, 0, -3, 0);
  [-48, 48].forEach(x => box(2.4, 2, 250, M.rail, x, 1, 0));
  box(6, 1.2, 240, M.motor, 0, 0.6, 0);

  // Y 滑座群組
  const yG = new THREE.Group(); scene.add(yG);
  [-48, 48].forEach(x => [-9, 9].forEach(z => box(4.6, 2.2, 6, M.block, x, 3.1, z, yG)));
  const yPlate = box(112, 2.5, 30, M.plate, 0, 5.45, 0, yG);
  const solidRef = box(84, 1.6, 2, M.rail, 0, 7.5, -10, yG);   // X 基準軌
  const solidFol = box(84, 1.6, 2, M.rail, 0, 7.5, -2, yG);    // X 從動軌
  box(84, 0.8, 2.4, M.motor, 0, 7.1, -5, yG);                  // X 磁軌
  const straight = box(84, 4, 3, M.granite, 0, 8.7, 9, yG);    // 直規

  // ---------- 導軌調整用物件(分頁三) ----------
  const adj = new THREE.Group(); yG.add(adj);
  const adjParts = new THREE.Group(); adj.add(adjParts);
  const NSEG = 42, segX = i => -41 + 2 * i;
  const segRef = [], segFol = [];
  for (let i = 0; i < NSEG; i++) {
    segRef.push(box(2.02, 1.6, 2, M.rail, segX(i), 7.5, -10, adj));
    segFol.push(box(2.02, 1.6, 2, M.rail, segX(i), 7.5, -2, adj));
  }
  const shoulder = box(84, 1.4, 0.8, M.shoulder, 0, 7.4, -11.4, adj);
  const screws = [];
  for (let i = 0; i < 9; i++) {
    const x = -40 + 10 * i;
    box(1.6, 1.4, 1.6, M.arm, x, 7.4, -7.2, adjParts);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 12), M.screw);
    s.rotation.x = Math.PI / 2; adjParts.add(s);
    screws.push({ x, mesh: s });
  }
  const bolts = { ref: [], fol: [] };
  for (let j = 0; j < 14; j++) {
    const x = -39 + 6 * j;
    ['ref', 'fol'].forEach(k => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.25, 14), M.bolt);
      b.position.set(x, 8.42, k === 'ref' ? -10 : -2); adjParts.add(b); bolts[k].push({ x, mesh: b });
    });
  }
  const wrench = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.12, 8, 24), M.ring);
  wrench.rotation.x = Math.PI / 2; adjParts.add(wrench);

  // X 滑座群組
  const xG = new THREE.Group(); yG.add(xG);
  [-4, 4].forEach(x => [-10, -2].forEach(z => box(4, 1.8, 3, M.block, x, 9.2, z, xG)));
  box(18, 1.6, 14, M.xcar, 0, 10.9, -5, xG);
  box(6, 8, 6, M.head, 0, 15.7, -6, xG);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.2, 24), M.chrome);
  lens.rotation.x = Math.PI / 2; lens.position.set(0, 16.5, -2.4); xG.add(lens);

  // 千分表
  function makeDial(magMat) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.9, 40), M.chrome));
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), M.face);
    face.rotation.x = -Math.PI / 2; face.position.y = 0.46; g.add(face);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 8, 40), magMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.47; g.add(ring);
    const piv = new THREE.Group(); piv.position.y = 0.5; g.add(piv);
    const nd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 1.25), M.needle); nd.position.z = -0.5; piv.add(nd);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1, 14), M.chrome);
    stem.rotation.x = Math.PI / 2; g.add(stem);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), M.chrome); g.add(tip);
    return { g, piv, stem, tip };
  }
  function setPlunger(d, len, dir) {
    len = Math.max(0.15, len);
    const start = 1.6 * dir;
    d.stem.scale.y = len; d.stem.position.set(0, 0, start + dir * len / 2);
    d.tip.position.set(0, 0, start + dir * len);
  }

  // 測試一:表座在 X 滑座上，測頭頂直規
  const t1 = new THREE.Group(); xG.add(t1);
  const d1 = {};
  [['A', -6, M.magA], ['B', 6, M.magB]].forEach(([k, x, mm]) => {
    box(3, 2.4, 3, mm, x, 12.9, 0.5, t1);
    box(0.6, 0.6, 4.3, M.arm, x, 13.4, 2.65, t1);
    box(0.6, 3.35, 0.6, M.arm, x, 11.7, 4.8, t1);
    const d = makeDial(mm); d.g.position.set(x, 9.6, 4.8); t1.add(d.g); d1[k] = d;
  });

  // 測試二:表座在底座，測頭頂 Y 滑座正面
  const t2 = new THREE.Group(); scene.add(t2);
  const d2 = {};
  [['A', 45, M.magA], ['B', -45, M.magB]].forEach(([k, x, mm]) => {
    box(3, 2.4, 3, mm, x, 1.2, 24, t2);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4.8, 12), M.arm); post.position.set(x, 4.8, 24); t2.add(post);
    box(0.6, 0.6, 6.4, M.arm, x, 7.0, 21.0, t2);
    box(0.6, 1.2, 0.6, M.arm, x, 6.4, 18.2, t2);
    const d = makeDial(mm); d.g.position.set(x, 5.45, 18.2); t2.add(d.g); d2[k] = d;
  });

  // 分頁三步驟四：平行度治具(滑塊在基準軌上，表頂從動軌)
  const jig = new THREE.Group(); yG.add(jig);
  box(3, 1.6, 2.4, M.magA, 0, 9.1, -10, jig);
  box(0.6, 0.6, 4.4, M.arm, 0, 9.7, -7.4, jig);
  box(0.5, 1.6, 0.5, M.arm, 0, 9.0, -5.4, jig);
  const d3 = makeDial(M.magA); d3.g.scale.setScalar(0.75); d3.g.position.set(0, 8.0, -5.4); jig.add(d3.g);

  // ---------- 3D 標籤 ----------
  const labelBox = $('labels');
  const LABELS = {
    1: [
      { t: '表 A', obj: () => d1.A.g, off: [0, 1.4, 0], c: 'a' },
      { t: '表 B', obj: () => d1.B.g, off: [0, 1.4, 0], c: 'b' },
      { t: '直規(固定在 Y 滑座上)', obj: () => straight, off: [30, 2.6, 0] },
      { t: 'X 滑座', obj: () => xG, off: [0, 20.5, -6] },
      { t: 'Y 滑座', obj: () => yPlate, off: [-46, 1.6, 10] },
    ],
    2: [
      { t: '表 A(表座吸在底座)', obj: () => d2.A.g, off: [0, 2.2, 0], c: 'a' },
      { t: '表 B', obj: () => d2.B.g, off: [0, 2.2, 0], c: 'b' },
      { t: 'Y 滑座正面', obj: () => yPlate, off: [0, 1.6, 15] },
      { t: 'X 滑座(移動)', obj: () => xG, off: [0, 20.5, -6] },
      { t: 'Y 導軌', obj: () => scene, off: [48, 2.2, 60] },
    ],
    3: [
      { t: '基準軌', obj: () => yPlate, off: [-30, 3.2, -10], show: s => s < 5 },
      { t: '從動軌', obj: () => yPlate, off: [-22, 3.2, -2], show: s => s < 5 },
      { t: '定位靠邊', obj: () => yPlate, off: [-36, 2.8, -11.6], show: s => s <= 2 },
      { t: '偏移處(沒靠緊)', obj: () => yPlate, off: [16, 3.6, -10], c: 'b', show: s => s === 1 },
      { t: '頂絲', obj: () => screws[1].mesh, off: [0, 1.0, 0], show: s => s === 2 },
      { t: '固定螺絲', obj: () => wrench, off: [0, 1.0, 0], c: 'b', show: s => s === 3 },
      { t: '平行度治具', obj: () => d3.g, off: [0, 2.0, 0], c: 'a', show: s => s === 4 },
      { t: '表 A', obj: () => d1.A.g, off: [0, 1.4, 0], c: 'a', show: s => s === 5 },
      { t: '表 B', obj: () => d1.B.g, off: [0, 1.4, 0], c: 'b', show: s => s === 5 },
    ],
  };
  let labelEls = [];
  function buildLabels(t) {
    labelBox.innerHTML = '';
    labelEls = LABELS[t].map(l => {
      const el = document.createElement('div'); el.className = 'mk-lbl' + (l.c ? ' mk-' + l.c : ''); el.textContent = l.t;
      labelBox.appendChild(el); return { el, l };
    });
  }
  const tmp = new THREE.Vector3();
  function placeLabels(w, h) {
    labelEls.forEach(({ el, l }) => {
      if (l.show && !l.show(step)) { el.hidden = true; return; }
      const o = l.obj(); o.updateWorldMatrix(true, false);
      tmp.set(...l.off);
      if (o !== scene) o.localToWorld(tmp);
      tmp.project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      el.hidden = !vis;
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h - 4}px) translate(-50%, -100%)`;
    });
  }

  // ---------- SVG 小工具 ----------
  const NS = 'http://www.w3.org/2000/svg';
  function el(svg, n, a, txt) {
    const e = document.createElementNS(NS, n);
    for (const k in a) { const v = String(a[k]); if (v.startsWith('var(')) e.style.setProperty(k, v); else e.setAttribute(k, v); }
    if (txt != null) e.textContent = txt;
    svg.appendChild(e); return e;
  }

  // 儀表
  function buildGauge(svg, colorVar) {
    svg.innerHTML = '';
    el(svg, 'circle', { cx: 60, cy: 60, r: 56, fill: 'var(--surface)', stroke: `var(${colorVar})`, 'stroke-width': 4 });
    for (let i = 0; i < 100; i++) {
      const a = i / 100 * 2 * Math.PI, long = i % 10 === 0, r1 = long ? 42 : 47, r2 = 51;
      el(svg, 'line', { x1: 60 + r1 * Math.sin(a), y1: 60 - r1 * Math.cos(a), x2: 60 + r2 * Math.sin(a), y2: 60 - r2 * Math.cos(a),
        stroke: 'var(--fg)', 'stroke-width': long ? 1.4 : 0.6, opacity: long ? 0.9 : 0.5 });
      if (long) {
        const v = i <= 50 ? i : 100 - i, rt = 34;
        el(svg, 'text', { x: 60 + rt * Math.sin(a), y: 60 - rt * Math.cos(a) + 3, 'text-anchor': 'middle',
          'font-size': 8, fill: 'var(--muted)', 'font-family': 'IBM Plex Mono, monospace' }, v);
      }
    }
    el(svg, 'text', { x: 60, y: 82, 'text-anchor': 'middle', 'font-size': 7, fill: 'var(--muted)' }, '0.001 mm');
    const nd = el(svg, 'line', { x1: 60, y1: 68, x2: 60, y2: 14, stroke: '#d2332b', 'stroke-width': 1.8, 'stroke-linecap': 'round' });
    el(svg, 'circle', { cx: 60, cy: 60, r: 3.5, fill: 'var(--fg)' });
    return nd;
  }
  const needleA = buildGauge($('gA'), '--accent');
  const needleB = buildGauge($('gB'), '--warn');
  const setNeedle = (nd, mm) => nd.setAttribute('transform', `rotate(${mm / 0.1 * 360} 60 60)`);

  // 偏擺(角秒),k = 誤差保留比例
  function yawSec(kind, x, k) {
    if (kind === 2) return (thY(x) - thY(100)) * k * SEC;
    return -(poseX(x, k).th - poseX(100, k).th) * SEC;
  }
  function ppOf(kind, k) {
    let lo = Infinity, hi = -Infinity;
    for (let x = 100; x <= 750; x += 5) { const v = yawSec(kind, x, k); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo;
  }
  const ADJ_NOTE = {
    1: '拖動拉霸模擬把基準軌推回定位靠邊:偏移越小，X 滑座走過去的偏擺越小。',
    2: '拖動拉霸模擬調整 Y 滑塊預壓與 Y 導軌平行度:X 移動時 Y 滑座的轉動越小。',
  };
  function updateAdjUI() {
    if (test !== 3) {
      const k = kAdj[test];
      $('adjNote').textContent = ADJ_NOTE[test];
      $('adjLbl').textContent = test === 1 ? '基準軌偏移' : 'Y 滑座轉動量';
      $('adjVal').textContent = test === 1 ? `${(40 * k).toFixed(0)} µm` : `${(100 * k).toFixed(0)} %`;
      $('adjMax').textContent = test === 1 ? '40 µm(目前)' : '100 %(目前)';
      $('adjK').value = Math.round(k * 100);
      const a = ppOf(test, 1), b2 = ppOf(test, k);
      $('ppYaw').textContent = k < 1 ? `${a.toFixed(1)}″ → ${b2.toFixed(1)}″` : `${a.toFixed(1)}″`;
    } else {
      $('ppYaw').textContent = `${ppOf(1, 1).toFixed(1)}″ → ${ppOf(1, RESID).toFixed(1)}″`;
    }
  }

  // 偏擺記錄曲線
  const TR = { x0: 40, x1: 308, y0: 14, y1: 140 };
  let traceCfg, samples = new Map();
  const sx = x => TR.x0 + (x - 100) / 650 * (TR.x1 - TR.x0);
  const sy = v => { const m = traceCfg.ymax; return TR.y0 + (m - Math.max(-m, Math.min(m, v))) / (2 * m) * (TR.y1 - TR.y0); };
  function buildTrace(kind) {
    const svg = $('trace'); svg.innerHTML = ''; samples = new Map();
    const big = kind !== 2;
    traceCfg = big ? { ymax: 80, ticks: [-80, -40, 0, 40, 80] } : { ymax: 12, ticks: [-12, -6, 0, 6, 12] };
    if (big) {
      [['1-11', 189, 306], ['1-9', 459, 576], ['1-8', 594, 711]].forEach(([n, a, b]) => {
        el(svg, 'rect', { x: sx(a), y: TR.y0, width: sx(b) - sx(a), height: TR.y1 - TR.y0, fill: 'var(--accent-soft)', opacity: 0.7 });
        el(svg, 'text', { x: (sx(a) + sx(b)) / 2, y: TR.y0 + 10, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' }, n);
      });
    }
    traceCfg.ticks.forEach(v => {
      el(svg, 'line', { x1: TR.x0, x2: TR.x1, y1: sy(v), y2: sy(v), stroke: 'var(--line)', 'stroke-width': v === 0 ? 1.2 : 0.6 });
      el(svg, 'text', { x: TR.x0 - 5, y: sy(v) + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)', 'font-family': 'IBM Plex Mono, monospace' }, v);
    });
    [100, 300, 500, 700].forEach(v => el(svg, 'text', { x: sx(v), y: 156, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)', 'font-family': 'IBM Plex Mono, monospace' }, v));
    el(svg, 'text', { x: TR.x1, y: 168, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)' }, 'X (mm)');
    const k12 = kind === 3 ? 1 : kAdj[kind];
    if (kind === 3 || k12 < 1) {
      let d = '';
      for (let x = 100; x <= 750; x += 5) d += (x === 100 ? 'M' : 'L') + sx(x).toFixed(1) + ' ' + sy(yawSec(kind === 2 ? 2 : 1, x, 1)).toFixed(1);
      el(svg, 'path', { d, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' });
    }
    traceCfg.path = el(svg, 'path', { d: '', fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round' });
    traceCfg.dot = el(svg, 'circle', { r: 4, fill: 'var(--warn)', cx: -10, cy: -10 });
    $('traceLegend').hidden = !(kind === 3 || k12 < 1);
    $('lgNow').textContent = kind === 3 ? '調整後' : '目前';
    if (kind !== 3) {
      let d = '';
      for (let x = 100; x <= 750; x += 5) d += (x === 100 ? 'M' : 'L') + sx(x).toFixed(1) + ' ' + sy(yawSec(kind, x, k12)).toFixed(1);
      traceCfg.path.setAttribute('d', d); traceCfg.live = true;
    }
  }
  function updateTrace(x, v) {
    if (traceCfg.live) { traceCfg.dot.setAttribute('cx', sx(x)); traceCfg.dot.setAttribute('cy', sy(v)); return; }
    samples.set(Math.round(x / 5) * 5, v);
    const keys = [...samples.keys()].sort((a, b) => a - b);
    traceCfg.path.setAttribute('d', keys.map((k, i) => (i ? 'L' : 'M') + sx(k).toFixed(1) + ' ' + sy(samples.get(k)).toFixed(1)).join(' '));
    traceCfg.dot.setAttribute('cx', sx(x)); traceCfg.dot.setAttribute('cy', sy(v));
  }

  // 導軌直線度變化圖
  const CG = { x0: 40, x1: 308, y0: 14, y1: 140, ymin: -10, ymax: 50 };
  const cx = x => CG.x0 + (x - 25) / 800 * (CG.x1 - CG.x0);
  const cy = v => CG.y0 + (CG.ymax - v) / (CG.ymax - CG.ymin) * (CG.y1 - CG.y0);
  let chg = {};
  function buildChange() {
    const svg = $('chg'); svg.innerHTML = '';
    [-10, 0, 10, 20, 30, 40, 50].forEach(v => {
      el(svg, 'line', { x1: CG.x0, x2: CG.x1, y1: cy(v), y2: cy(v), stroke: 'var(--line)', 'stroke-width': v === 0 ? 1.2 : 0.6 });
      if (v % 20 === 0 || v === -10) el(svg, 'text', { x: CG.x0 - 5, y: cy(v) + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)', 'font-family': 'IBM Plex Mono, monospace' }, v);
    });
    [100, 300, 500, 700].forEach(v => el(svg, 'text', { x: cx(v), y: 156, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)', 'font-family': 'IBM Plex Mono, monospace' }, v));
    el(svg, 'text', { x: CG.x1, y: 168, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)' }, 'X (mm)');
    let d = '';
    for (let i = 0; i < NSEG; i++) { const x = mmOf(segX(i)); d += (i ? 'L' : 'M') + cx(x).toFixed(1) + ' ' + cy(rail(x) * 1000).toFixed(1); }
    el(svg, 'path', { d, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' });
    chg.ref = el(svg, 'path', { d: '', fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 });
    chg.fol = el(svg, 'path', { d: '', fill: 'none', stroke: 'var(--warn)', 'stroke-width': 2 });
  }
  function updateChange(refK, folK) {
    let dr = '', df = '', rmax = 0, fmax = 0;
    for (let i = 0; i < NSEG; i++) {
      const x = mmOf(segX(i)), r = rail(x) * refK[i] * 1000, f = fol(x) * folK[i] * 1000;
      rmax = Math.max(rmax, r); fmax = Math.max(fmax, f);
      dr += (i ? 'L' : 'M') + cx(x).toFixed(1) + ' ' + cy(r).toFixed(1);
      df += (i ? 'L' : 'M') + cx(x).toFixed(1) + ' ' + cy(f).toFixed(1);
    }
    chg.ref.setAttribute('d', dr); chg.fol.setAttribute('d', df);
    $('ppRef').textContent = rmax.toFixed(1) + ' µm'; $('ppFol').textContent = fmax.toFixed(1) + ' µm';
  }

  // ---------- 文字說明 ----------
  const STEPS = [
    { t: '檢查現況', b: '拆下 X 滑座和上方負載，露出兩條 X 導軌。基準軌在 X≈585 附近沒有完全貼住定位靠邊，往外偏了一點(橘色段)。', dur: 6 },
    { t: '基準軌推靠定位面', b: '把基準軌的固定螺絲鬆到可以推動。從一端開始用頂絲把導軌推向定位靠邊，一支一支往另一端推，邊推邊確認貼緊。', dur: 9 },
    { t: '依序鎖緊基準軌', b: '頂絲維持頂住，從同一端依序鎖固定螺絲：先全部用約一半扭力預鎖，再用型錄規定扭力鎖第二輪。', dur: 8 },
    { t: '調整從動軌平行度', b: '在基準軌滑塊上架千分表，頂住從動軌側面，沿全長移動。讀數偏大的地方用頂絲調整，調到型錄容許值內再鎖緊。', dur: 9 },
    { t: '裝回並驗證', b: '裝回 X 滑座，用測試一的方法重量一次偏擺。虛線是調整前，實線是調整後，X≈580~600 的變號應該消失。', dur: 13 },
  ];
  const GUIDE = {
    1: `
      <div>
        <h3>架設步驟</h3>
        <ol class="mk-steps">
          <li><span>把<b>直規</b>放在 Y 滑座板上，和 X 導軌大致平行，長度要涵蓋要量的 X 行程。兩端墊穩或輕夾，量測中不能動。</span></li>
          <li><span>在 <b>X 滑座</b>上吸兩個磁性表座，沿 X 方向左右相距 <b>L</b>(例如 120 mm,距離越大越靈敏)。兩支表的測頭高度要一致。</span></li>
          <li><span>測頭<b>垂直</b>頂在直規同一側面，壓入約 0.2~0.3 mm 預壓，兩支表都歸零。</span></li>
          <li><span>X 走到行程兩端，看表 A 讀數差。差太多就輕敲直規一端修正，讓兩端讀數接近。不必完全為 0,之後計算時會扣掉線性部分。</span></li>
          <li><span>X <b>低速</b>移動，每 25 或 50 mm 停一下，等表針穩定再記錄 A、B。正向走完，再反向走一次。</span></li>
          <li><span>計算:<b>偏擺角 = (A − B) ÷ L</b>(rad,× 206265 換成角秒);<b>直線度 = (A + B) ÷ 2</b>,扣掉頭尾連線後看剩下的彎曲。</span></li>
        </ol>
      </div>
      <div>
        <h3>怎麼判讀</h3>
        <div class="mk-judge">
          <div class="mk-hit"><strong>偏擺在 X≈580~600 附近突然變號</strong>和 1-8 是 +、1-9 是 − 的現象一致。查那一段的 X 導軌安裝面、兩軌平行度、鎖附螺絲扭力。</div>
          <div><strong>偏擺整段大致固定</strong>直規沒放平行，或 X 軸整體裝斜。這是線性部分，用單一角度就能補正。</div>
          <div><strong>正向、反向曲線不重合</strong>滑塊預壓不足或有間隙，量到的值會受移動方向影響。</div>
        </div>
      </div>`,
    2: `
      <div>
        <h3>架設步驟</h3>
        <ol class="mk-steps">
          <li><span>Y 停在量測時的位置(例如 Y≈1002),保持伺服鎖住。</span></li>
          <li><span>兩個磁性表座吸在<b>機台底座</b>這種不會動的地方，不要吸在 Y 滑座或任何會跟著動的零件上。</span></li>
          <li><span>兩支表分別頂在 <b>Y 滑座板正面</b>的左右兩端，距離越遠越好(例如 900 mm)。測頭垂直於面，預壓後歸零。</span></li>
          <li><span>X 從一端慢慢走到另一端，每 100 mm 停一下，記錄 A、B。來回各一次。</span></li>
          <li><span>計算:<b>Y 滑座偏擺 = (A − B) ÷ 兩表間距</b>;A、B 同方向變化，代表整個滑座前後平移。</span></li>
        </ol>
      </div>
      <div>
        <h3>怎麼判讀</h3>
        <div class="mk-judge">
          <div class="mk-hit"><strong>A − B 隨 X 位置明顯變化</strong>X 的重量移動讓 Y 滑座轉動，這個角度會疊加到量測結果上。要檢查 Y 滑塊預壓和 Y 滑座板剛性。</div>
          <div><strong>A、B 幾乎不變</strong>可以排除重心耦合，問題集中在 X 軸本身或治具，回頭看測試一。</div>
        </div>
      </div>`,
    3: `
      <div>
        <h3>調整步驟</h3>
        <ol class="mk-steps">
          <li><span><b>拆下 X 滑座</b>和上方的旋轉平台、負載。有鐵芯的線馬，動子和磁軌之間吸力很大，要用治具或頂出螺絲慢慢分離，避免撞到磁鐵。</span></li>
          <li><span>鬆開<b>基準軌</b>全部固定螺絲，只鬆到能推動。用頂絲或壓板從一端開始把導軌推向<b>定位靠邊</b>,邊推邊用薄規確認沒有縫隙。</span></li>
          <li><span>頂絲維持頂住，從同一端<b>依序鎖緊</b>:先全部用約一半扭力預鎖，再用導軌型錄規定的扭力鎖第二輪。</span></li>
          <li><span><b>從動軌</b>:在基準軌滑塊上架千分表，頂住從動軌側面沿全長移動，用頂絲把讀數調到型錄的平行度容許值內，再依序鎖緊。</span></li>
          <li><span>裝回 X 滑座，用<b>測試一</b>重量偏擺與直線度，和調整前的曲線比較。</span></li>
        </ol>
      </div>
      <div>
        <h3>調整後會跟著變的地方</h3>
        <div class="mk-judge">
          <div class="mk-hit"><strong>線馬氣隙</strong>導軌位置一動，動子和磁軌的間隙可能改變。沿全行程用塞規確認在線馬廠商規格內。</div>
          <div><strong>光學尺讀頭</strong>讀頭和尺的間隙、平行度可能跑掉。在驅動器軟體看全行程的訊號強度。</div>
          <div><strong>伺服參數</strong>摩擦力改變了，這時候重新自動調諧才有意義。</div>
          <div><strong>機台座標</strong>原點、相機校正、θ 旋轉中心、角度與定位補正表都要重做。</div>
        </div>
      </div>
      <div class="mk-span2">
        <h3>怎麼判讀調整結果</h3>
        <ul class="mk-tips">
          <li><b>凸起消失、偏擺不再變號</b>:靠邊問題已解決。</li>
          <li><b>剩下固定斜率</b>:整支 X 軸裝斜，用單一角度補正即可。</li>
          <li><b>凸起還在</b>:可能是安裝面本身不平，需要研磨或加墊片，不是靠邊的問題。</li>
        </ul>
      </div>`,
  };
  const TIPS = `
    <div class="mk-span2">
      <h3>共通注意事項</h3>
      <ul class="mk-tips">
        <li>表座吸附面擦乾淨，表座臂盡量短，越長越容易晃。</li>
        <li>測頭要垂直於量測面，斜頂會有餘弦誤差，讀數偏小。</li>
        <li>停下後等表針完全穩定再讀，馬達維持伺服鎖定。</li>
        <li>機台開機暖機後再量，避免熱變形影響。</li>
      </ul>
    </div>`;

  // ---------- 狀態 ----------
  let test = 1, playing = !reduce, t0 = performance.now(), phase = 0, xNow = 100, exagOn = true;
  let step = 1, stepT = 0, lastNow = performance.now();
  const kAdj = { 1: 1, 2: 1 };   // 誤差保留比例(拉霸)
  const EXAG = { 1: 150, 2: 600, 3: 150 };
  let zero = { A: 0, B: 0 };
  const chipsBox = $('chips');
  STEPS.forEach((s, i) => {
    const b = document.createElement('button'); b.className = 'mk-chip'; b.textContent = i + 1; b.title = s.t;
    b.onclick = () => { step = i + 1; stepT = 0; samples = new Map(); if (step === 5) buildTrace(3); renderStep(); };
    chipsBox.appendChild(b);
  });

  function readings(x) {
    if (test === 1) { const { yc, th } = poseX(x, kAdj[1]); return { A: yc - th * (L1 / 2), B: yc + th * (L1 / 2), yc, th }; }
    if (test === 3) { const { yc, th } = poseX(x, RESID); return { A: yc - th * (L1 / 2), B: yc + th * (L1 / 2), yc, th }; }
    const th = thY(x) * kAdj[2];
    return { A: th * (L2 / 2), B: -th * (L2 / 2), th };
  }

  function show(id, on) { $(id).hidden = !on; }
  function setTest(t) {
    test = t;
    ['tab1', 'tab2', 'tab3'].forEach((id, i) => $(id).setAttribute('aria-selected', t === i + 1));
    solidRef.visible = solidFol.visible = t === 2;
    adj.visible = t !== 2; adjParts.visible = t === 3;
    t2.visible = t === 2;
    $('guide').innerHTML = GUIDE[t] + TIPS;
    $('tTitle').textContent = t === 2 ? 'Y 滑座偏擺角對 X 位置(″)' : 'X 軸偏擺角對 X 位置(″)';
    $('c1n').textContent = t === 2 ? 'Y 滑座偏擺角' : 'X 軸偏擺角';
    $('c2n').textContent = t === 2 ? '前後平移 (A+B)/2' : '直線度 (A+B)/2';
    $('formula').textContent = t === 2
      ? 'Y 滑座偏擺 = (A − B) ÷ L,L = 900 mm;rad × 206265 = 角秒'
      : '偏擺角 = (A − B) ÷ L,L = 120 mm;rad × 206265 = 角秒';
    $('exagLbl').textContent = '誤差放大 ×' + EXAG[t];
    show('sliderRow', t !== 3); show('chips', t === 3); show('adjSeg', t !== 3); show('adjNote', t !== 3); show('xposLine', t !== 3 || step === 5);
    const r0 = readings(100); zero = { A: r0.A, B: r0.B };
    buildTrace(t); buildLabels(t); setView(t);
    yG.rotation.y = 0; xG.position.z = 0; xG.rotation.y = 0;
    if (t === 3) { step = 1; stepT = 0; buildChange(); }
    renderStep(); updateAdjUI();
  }

  function renderStep() {
    const t3 = test === 3, s5 = t3 && step === 5;
    show('cStep', t3); show('cChange', t3);
    show('cGauge', !t3 || s5); show('cCalc', !t3 || s5); show('cTrace', !t3 || s5);
    show('xposLine', !t3 || s5);
    xG.visible = !t3 || s5;
    t1.visible = test === 1 || s5; straight.visible = test === 1 || s5;
    jig.visible = t3 && step === 4;
    if (t3) {
      const s = STEPS[step - 1];
      $('stepNo').textContent = `步驟 ${step} / 5`; $('stepTitle').textContent = s.t; $('stepBody').textContent = s.b;
      [...chipsBox.children].forEach((c, i) => { if (i + 1 === step) c.setAttribute('aria-current', 'step'); else c.removeAttribute('aria-current'); });
    }
  }

  const f3 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3);
  function showReadings(A, B, L, x) {
    setNeedle(needleA, A); setNeedle(needleB, B);
    [d1, d2].forEach(d => { d.A.piv.rotation.y = -A / 0.1 * 2 * Math.PI; d.B.piv.rotation.y = -B / 0.1 * 2 * Math.PI; });
    $('vA').textContent = f3(A); $('vB').textContent = f3(B);
    const yaw = (A - B) / L, sec = yaw * SEC;
    $('c1').textContent = (sec >= 0 ? '+' : '−') + Math.abs(sec).toFixed(1) + '″';
    $('c1b').textContent = (sec >= 0 ? '+' : '−') + Math.abs(yaw * 180 / Math.PI).toFixed(5) + '°';
    $('c2').textContent = f3((A + B) / 2) + ' mm';
    updateTrace(x, sec);
  }

  function poseCarriageT1(x, ex) {
    const r = readings(x);
    xG.position.x = (x - 425) / 10;
    xG.position.z = r.yc * ex / 10;
    xG.rotation.y = -r.th * ex;
    xG.updateMatrixWorld(true);
    ['A', 'B'].forEach(k => {
      const p = new THREE.Vector3(); d1[k].g.getWorldPosition(p);
      setPlunger(d1[k], 7.5 - (p.z + 1.6), 1);
    });
    return r;
  }

  function apply(x) {
    xNow = x;
    $('xval').textContent = Math.round(x);
    if (document.activeElement !== $('xpos')) $('xpos').value = Math.round(x);
    const ex = exagOn ? EXAG[test] : 1;
    xG.position.x = (x - 425) / 10;
    const r = readings(x);
    if (test === 1) {
      yG.rotation.y = 0;
      for (let i = 0; i < NSEG; i++) {
        const xm = mmOf(segX(i)), v = rail(xm) * kAdj[1];
        segRef[i].position.z = -10 + v * ex / 10; segFol[i].position.z = -2;
        segRef[i].material = v > 0.012 ? M.railHot : M.rail; segFol[i].material = M.rail;
      }
      poseCarriageT1(x, ex);
    } else {
      xG.position.z = 0; xG.rotation.y = 0;
      const ph = -r.th * ex; yG.rotation.y = ph;
      [['A', 45], ['B', -45]].forEach(([k, a]) => {
        const faceZ = 15 * Math.cos(ph) - a * Math.sin(ph);
        setPlunger(d2[k], 16.6 - faceZ, -1);
      });
    }
    showReadings(r.A - zero.A, r.B - zero.B, test === 1 ? L1 : L2, x);
  }

  // 分頁三：依步驟與進度 p 計算整個狀態
  const refK = new Array(NSEG).fill(1), folK = new Array(NSEG).fill(1);
  function apply3(p) {
    const ex = exagOn ? EXAG[3] : 1;
    const xs = -42 + 84 * p;                       // 掃過位置(場景單位)
    for (let i = 0; i < NSEG; i++) {
      const x = segX(i);
      refK[i] = step < 2 ? 1 : step === 2 ? (x < xs ? RESID : 1) : RESID;
      folK[i] = step < 4 ? 1 : step === 4 ? (x < xs ? RESID : 1) : RESID;
      const xm = mmOf(x);
      const or = rail(xm) * refK[i] * ex / 10, of = fol(xm) * folK[i] * ex / 10;
      segRef[i].position.z = -10 + or; segFol[i].position.z = -2 + of;
      const hot = step === 1 && rail(xm) > 0.012;
      segRef[i].material = hot ? M.railHot : M.rail;
      segFol[i].material = step === 4 && x >= xs && fol(xm) > 0.008 ? M.railHot : M.rail;
    }
    const railOff = x => rail(mmOf(x)) * (step < 2 ? 1 : step === 2 ? (x < xs ? RESID : 1) : RESID) * ex / 10;
    const folOff = x => fol(mmOf(x)) * (step < 4 ? 1 : step === 4 ? (x < xs ? RESID : 1) : RESID) * ex / 10;
    screws.forEach(s => {
      const engaged = step > 2 || (step === 2 && s.x < xs);
      const front = -9 + railOff(s.x);
      const tip = engaged ? front : front + 0.6;
      const back = -8.0;
      const len = Math.max(0.1, back - tip);
      s.mesh.scale.y = len; s.mesh.position.set(s.x, 7.6, tip + len / 2);
      s.mesh.material = engaged ? M.screwDone : M.screw;
    });
    const nB = bolts.ref.length;
    const cur = Math.min(nB - 1, Math.floor(p * nB));
    bolts.ref.forEach((b, j) => {
      const done = step > 3 || (step === 3 && j < cur);
      b.mesh.material = done ? M.boltDone : M.bolt;
      b.mesh.position.z = -10 + railOff(b.x);
    });
    bolts.fol.forEach(b => {
      const done = step > 4 || (step === 4 && b.x < xs);
      b.mesh.material = done ? M.boltDone : M.bolt;
      b.mesh.position.z = -2 + folOff(b.x);
    });
    wrench.visible = step === 3;
    if (step === 3) { const b = bolts.ref[cur]; wrench.position.set(b.x, 8.75, b.mesh.position.z); wrench.rotation.z = performance.now() / 300; }
    if (step === 4) {
      jig.position.x = xs; jig.position.z = 0;
      const off = folOff(xs);
      setPlunger(d3, (1.2 + off) / 0.75, 1);
      const before = fol(mmOf(xs)), after = before * RESID;
      $('stepLive').textContent = `X ${Math.round(mmOf(xs))} mm:量到 ${f3(before)} mm → 調整後 ${f3(after)} mm`;
    } else if (step === 2) {
      const xm = Math.round(mmOf(Math.max(-40, Math.min(40, xs))));
      $('stepLive').textContent = `頂絲推到 X ${xm} mm;偏移處 X≈585 調整前 +0.040 mm`;
    } else if (step === 3) {
      $('stepLive').textContent = `鎖緊第 ${cur + 1} / ${nB} 支(第一輪預鎖 → 第二輪全扭力)`;
    } else if (step === 1) {
      $('stepLive').textContent = '基準軌偏移峰值 +0.040 mm(X≈585),從動軌 +0.025 mm(X≈300)';
    } else {
      $('stepLive').textContent = '調整後殘留約 10%(示意)';
    }
    updateChange(refK, folK);
    if (step === 5) {
      const x = 100 + 650 * p;
      xNow = x; $('xval').textContent = Math.round(x);
      yG.rotation.y = 0;
      const r = poseCarriageT1(x, ex);
      const r0 = readings(100);
      showReadings(r.A - r0.A, r.B - r0.B, L1, x);
    }
  }

  // ---------- 事件 ----------
  $('tab1').onclick = () => { setTest(1); apply(xNow); };
  $('tab2').onclick = () => { setTest(2); apply(xNow); };
  $('tab3').onclick = () => { setTest(3); apply3(0); };
  $('play').onclick = () => {
    playing = !playing; $('play').textContent = playing ? '暫停' : '播放';
    if (playing && test !== 3) { phase = Math.acos(1 - 2 * (xNow - 100) / 650); t0 = performance.now(); }
  };
  $('resetView').onclick = () => setView(test);
  $('adjK').oninput = e => {
    kAdj[test] = +e.target.value / 100;
    const r0 = readings(100); zero = { A: r0.A, B: r0.B };
    buildTrace(test); updateAdjUI(); apply(xNow);
  };
  $('exag').onchange = e => { exagOn = e.target.checked; if (test === 3) apply3(curP()); else apply(xNow); };
  $('xpos').oninput = e => {
    if (playing) { playing = false; $('play').textContent = '播放'; }
    apply(+e.target.value);
  };
  $('play').textContent = playing ? '暫停' : '播放';

  // ---------- 尺寸 / 主題 ----------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  function theme() { try { renderer.setClearColor(new THREE.Color(css('--stage') || '#e4e9ec')); } catch (e) {} }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  setTest(1); resize(); theme(); apply(100);

  const PERIOD = 22000;
  const curP = () => Math.min(1, stepT / (STEPS[step - 1].dur * 0.85));
  function loop(now) {
    if (!vis()) { lastNow = now; requestAnimationFrame(loop); return; }
    const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    if (test === 3) {
      if (playing) {
        stepT += dt;
        if (stepT > STEPS[step - 1].dur) {
          step = step % 5 + 1; stepT = 0;
          if (step === 5) buildTrace(3);
          renderStep();
        }
      }
      apply3(curP());
    } else if (playing) {
      const p = phase + (now - t0) / PERIOD * 2 * Math.PI;
      apply(100 + 650 * (0.5 - 0.5 * Math.cos(p)));
    }
    controls.update();
    renderer.render(scene, camera);
    placeLabels(stage.clientWidth, stage.clientHeight);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  }
  G.MECHDIAL = { init, vis, tab: n => { init(); const b = document.getElementById('mk-tab' + n); if (b) b.click(); } };
})(typeof window !== 'undefined' ? window : globalThis);
