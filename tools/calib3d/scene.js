// ===== 3D 場景（three.js，Z 軸朝上，單位 mm）=====
(function (G) {
  'use strict';
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

  function createScene(host, m) {
    const THREE = G.THREE;
    THREE.Object3D.DefaultUp.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, G.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, 1, 5, 8000);
    cam.up.set(0, 0, 1);
    const controls = new THREE.OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    const HOME = { pos: [-520, -1020, 760], tgt: [0, 40, 90] };
    function resetView(v) { const h = v || HOME; cam.position.set(...h.pos); controls.target.set(...h.tgt); controls.update(); }
    resetView();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85); hemi.position.set(0, 0, 1); scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.55); dir.position.set(-400, -600, 900); scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.25); dir2.position.set(500, 300, -300); scene.add(dir2);

    const mats = {};
    function mat(key, colorVar, extra) {
      const mt = new THREE.MeshStandardMaterial(Object.assign({ color: css(colorVar), roughness: 0.65, metalness: 0.15 }, extra || {}));
      mats[key] = { mt, colorVar }; return mt;
    }
    const lineMats = [];
    function lmat(colorVar, opacity) { const l = new THREE.LineBasicMaterial({ color: css(colorVar), transparent: true, opacity: opacity == null ? 1 : opacity }); lineMats.push({ l, colorVar }); return l; }
    function box(w, d, h, mt, x, y, z) { const g = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mt); g.position.set(x || 0, y || 0, (z || 0) + h / 2); return g; }
    function cyl(r, h, mt, x, y, z, seg) { const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 40), mt); g.rotation.x = Math.PI / 2; g.position.set(x || 0, y || 0, (z || 0) + h / 2); return g; }
    function disc(r, mt, x, y, z) { const g = new THREE.Mesh(new THREE.CircleGeometry(r, 24), mt); g.position.set(x, y, z); return g; }
    function frustum(z0, z1, w, h, lm) { // 相機視野：從 z0 的點散開到 z1 的矩形
      const pts = [], c = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      c.forEach(p => { pts.push(new THREE.Vector3(0, 0, z0), new THREE.Vector3(p[0], p[1], z1)); });
      for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; pts.push(new THREE.Vector3(a[0], a[1], z1), new THREE.Vector3(b[0], b[1], z1)); }
      return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lm);
    }
    function label(text, colorVar, scale) {
      const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), fs = 44;
      ctx.font = `600 ${fs}px "Noto Sans TC", sans-serif`;
      const w = Math.ceil(ctx.measureText(text).width) + 36; cv.width = w; cv.height = fs + 26;
      const draw = () => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = css('--label-bg'); ctx.strokeStyle = css(colorVar); ctx.lineWidth = 5;
        const r = 14; ctx.beginPath(); ctx.moveTo(r, 3); ctx.arcTo(w - 3, 3, w - 3, cv.height - 3, r); ctx.arcTo(w - 3, cv.height - 3, 3, cv.height - 3, r); ctx.arcTo(3, cv.height - 3, 3, 3, r); ctx.arcTo(3, 3, w - 3, 3, r); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.font = `600 ${fs}px "Noto Sans TC", sans-serif`; ctx.fillStyle = css('--ink'); ctx.textBaseline = 'middle'; ctx.fillText(text, 18, cv.height / 2 + 2);
      };
      draw();
      const tex = new THREE.CanvasTexture(cv);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      const s = scale || 0.62; sp.scale.set(w * s, cv.height * s, 1); sp.renderOrder = 10;
      sp.userData.redraw = () => { draw(); tex.needsUpdate = true; };
      labels.push(sp); return sp;
    }
    const labels = [];

    // ---- 機台本體 ----
    const mTable = mat('table', '--m-table'), mSteel = mat('steel', '--m-steel'), mDark = mat('dark', '--m-dark');
    const mP1 = mat('p1', '--p1'), mP2 = mat('p2', '--p2'), mP3 = mat('p3', '--p3', { transparent: true, opacity: 0.42, depthWrite: false });
    const mCam = mat('cam', '--cam'), mMark = mat('mark', '--mark', { side: THREE.DoubleSide }), mWp = mat('wp', '--wp');
    const mGlass = mat('glass', '--glass', { transparent: true, opacity: 0.45, depthWrite: false }), mPocket = lmat('--p3-line', 0.95);
    const mHot = mat('hot', '--hot', { emissive: css('--hot'), emissiveIntensity: 0.6 });

    scene.add(box(1100, 800, 4, mTable, 0, 0, -4));
    // 平台3：固定板、四支柱
    const zP = m.zPlate;
    const p3 = new THREE.Group(); scene.add(p3);
    p3.add(box(880, 240, 12, mP3, 0, 205, zP));
    [[-455, 95], [455, 95], [-455, 315], [455, 315]].forEach(([x, y]) => p3.add(box(22, 22, zP + 12, mSteel, x, y, 0)));
    p3.add(box(932, 22, 14, mSteel, 0, 95, zP + 12)); p3.add(box(932, 22, 14, mSteel, 0, 315, zP + 12));
    // 料盤穴位（下表面）與基準 Mark
    const trayZ = zP - 0.6;
    m.tray.cols.forEach(cx => m.tray.rows.forEach(ry => {
      const c = [cx + m.tray.nomC[0], ry + m.tray.nomC[1]];
      const pl = m.part.len / 2 + 2, pw = m.part.wid / 2 + 2, ca = Math.cos(m.part.orient), sa = Math.sin(m.part.orient);
      const pts = [[-pl, -pw], [pl, -pw], [pl, pw], [-pl, pw], [-pl, -pw]].map(p => new THREE.Vector3(c[0] + ca * p[0] - sa * p[1], c[1] + sa * p[0] + ca * p[1], trayZ));
      p3.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mPocket));
      [-1, 1].forEach(s => p3.add(disc(2.4, mMark, c[0] + s * m.tray.markV[0], c[1] + s * m.tray.markV[1], trayZ)));
    }));
    Object.values(m.fidT).forEach(f => { const c = [f[0] + m.tray.nomC[0], f[1] + m.tray.nomC[1]]; const d = disc(4, mHot, c[0], c[1], trayZ); d.material = mMark; p3.add(d); const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7.5, 32), mMark); ring.position.set(c[0], c[1], trayZ); p3.add(ring); });
    const lb3 = label('平台3（固定，料盤在下表面）', '--p3-line'); lb3.position.set(0, 320, zP + 70); scene.add(lb3);

    // 上相機1、上相機2（固定，往下看；各拍自己的平台）
    const camMeshes = {}, fovs = {};
    m.top.forEach((tc, k) => {
      const g = new THREE.Group(); g.position.set(tc.C[0], tc.C[1], 0); scene.add(g);
      g.add(box(24, 24, 300, mSteel, 0, -90, 0)); g.add(box(24, 110, 18, mSteel, 0, -45, 282));
      const body = box(46, 46, 60, mCam, 0, 0, 222); g.add(body); g.add(cyl(13, 18, mDark, 0, 0, 204));
      const fv = frustum(204, 102, tc.w * tc.mmpp, tc.h * tc.mmpp, lmat('--cam', 0.75)); g.add(fv);
      const lb = label(`上${tc.name}（固定・拍平台${k + 1}）`, '--cam', 0.5); lb.position.set(0, 0, 320); g.add(lb);
      camMeshes[k + 1] = body; fovs[k + 1] = fv;
    });

    // 平台1、平台2
    const plats = m.plat.map((p, k) => {
      const mt = k === 0 ? mP1 : mP2, colorVar = k === 0 ? '--p1' : '--p2';
      const root = new THREE.Group(); root.position.set(p.base[0], p.base[1], 0); scene.add(root);
      root.add(box(30, 640, 12, mSteel, -55, 0, 0)); root.add(box(30, 640, 12, mSteel, 55, 0, 0));
      const yc = new THREE.Group(); root.add(yc);
      const xr = k === 0 ? [-140, 280] : [-280, 140];
      yc.add(box(xr[1] - xr[0] + 120, 100, 16, mt, (xr[0] + xr[1]) / 2, 0, 12));
      const xc = new THREE.Group(); yc.add(xc);
      xc.add(box(150, 200, 12, mSteel, 0, 38, 28));
      const dd = new THREE.Group(); dd.position.set(p.rcOff[0], p.rcOff[1], 0); xc.add(dd);
      dd.add(cyl(46, 30, mt, 0, 0, 40));
      dd.add(cyl(6, 31, mDark, 40, 0, 40, 12));
      const zg = new THREE.Group(); dd.add(zg);
      zg.add(box(60, 60, 20, mDark, 0, 0, 70));
      zg.add(box(92, 64, 10, mt, 0, 0, 90));
      const chuckItems = new THREE.Group(); chuckItems.position.set(0, 0, 100); zg.add(chuckItems);
      const lb = label(p.name + '（XY＋DD＋Z）', colorVar); lb.position.set(0, -70, 140); xc.add(lb);
      // 下相機（裝在 X 載台上，不隨 DD/Z）
      p.cams.forEach(j => {
        const b = m.bcam[j];
        const g = new THREE.Group(); g.position.set(b.dNom[0], b.dNom[1], 0); xc.add(g);
        const body = box(24, 24, 38, mCam, 0, 0, 40); g.add(body); g.add(cyl(9, 14, mDark, 0, 0, 78));
        const fv = frustum(92, zP - 1, b.w * b.mmpp, b.h * b.mmpp, lmat('--cam', 0.9)); g.add(fv); fovs[j] = fv;
        const l = label('下' + b.name, '--cam', 0.5); l.position.set(0, 18, 120); g.add(l);
        camMeshes[j] = body;
      });
      return { root, yc, xc, dd, zg, chuckItems, pose: { S: [0, 0], th: 0, h: 0 } };
    });

    // 料、治具、Mark 物件
    function makeItem(type) {
      const g = new THREE.Group();
      if (type === 'mark') { g.add(box(24, 24, 1.2, mGlass, 0, 0, 0)); g.add(disc(2.6, mMark, 0, 0, 1.3)); }
      else if (type === 'rcmark') { g.add(box(16, 16, 1.2, mGlass, 0, 0, 0)); g.add(disc(2.6, mMark, 0, 0, 1.3)); }
      else if (type === 'jig') { g.add(box(m.jig.len, m.jig.wid, m.jig.thick, mGlass, 0, 0, 0)); [-1, 1].forEach(s => { g.add(disc(2.6, mMark, s * m.jig.mv[0], s * m.jig.mv[1], m.jig.thick + 0.1)); const d = disc(2.6, mMark, s * m.jig.mv[0], s * m.jig.mv[1], -0.1); d.rotation.x = Math.PI; g.add(d); }); }
      else if (type === 'wp') { const b = box(m.part.len, m.part.wid, m.part.thick, mWp, 0, 0, 0); b.rotation.z = m.part.orient; g.add(b); [-1, 1].forEach(s => g.add(disc(2.6, mMark, s * m.tray.markV[0], s * m.tray.markV[1], m.part.thick + 0.1))); }
      g.userData.type = type; return g;
    }
    const chuckCache = [{}, {}];
    function setChuckItem(k, it) { // it: {type, q:[x,y], ang}
      const P = plats[k];
      P.chuckItems.children.slice().forEach(c => { c.visible = false; });
      if (!it) return;
      let g = chuckCache[k][it.type]; if (!g) { g = makeItem(it.type); chuckCache[k][it.type] = g; P.chuckItems.add(g); }
      g.visible = true; g.position.set(it.q[0], it.q[1], 0); g.rotation.z = it.ang || 0;
    }
    const plateItems = new THREE.Group(); scene.add(plateItems);
    function setPlateItems(list) {
      while (plateItems.children.length) plateItems.remove(plateItems.children[0]);
      (list || []).forEach(it => { const g = makeItem(it.type); const th = it.type === 'jig' ? m.jig.thick : m.part.thick; g.position.set(it.W[0], it.W[1], zP - th - 0.2); g.rotation.z = it.ang || 0; plateItems.add(g); });
    }
    function setPose(k, pose) {
      const P = plats[k]; P.pose = pose;
      P.yc.position.y = pose.S[1]; P.xc.position.x = pose.S[0];
      P.dd.rotation.z = pose.th; P.zg.position.z = pose.h;
    }
    let active = null, flashT = 0;
    function setActive(ids, flash) {
      active = ids; if (flash) flashT = 1;
      Object.keys(camMeshes).forEach(id => {
        const on = ids && ids.includes(+id);
        camMeshes[id].material = on ? mHot : mCam;
        fovs[id].material.opacity = on ? 1 : 0.35;
      });
    }
    function retheme() {
      Object.values(mats).forEach(o => { o.mt.color.set(css(o.colorVar)); if (o.mt.emissive && o.colorVar === '--hot') o.mt.emissive.set(css('--hot')); });
      lineMats.forEach(o => o.l.color.set(css(o.colorVar)));
      labels.forEach(l => l.userData.redraw());
      scene.background = new THREE.Color(css('--stage'));
    }
    retheme();
    function resize() {
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    resize();
    function render(dt) {
      if (flashT > 0) { flashT = Math.max(0, flashT - dt * 2.5); mHot.emissiveIntensity = 0.4 + flashT * 1.4; }
      controls.update(); renderer.render(scene, cam);
    }
    return { THREE, scene, cam, controls, renderer, setPose, setChuckItem, setPlateItems, setActive, resetView, resize, render, retheme, plats };
  }
  G.createScene = createScene;
})(window);
