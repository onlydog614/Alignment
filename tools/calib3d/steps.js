// ===== 校正步驟：動畫時間軸＋內容 =====
(function (G) {
  'use strict';
  const CAL = G.CAL, { V, D2R, R2D } = CAL;
  const M0 = CAL.defaultMachine(CAL.loadParams());
  const MR = M0.markDia / 2, f1 = v => +v.toFixed(2);
  const HOME = () => ({ S: [0, 0], th: 0, h: 0 });

  // ---------- 時間軸建構 ----------
  function TL() {
    const segs = []; let t = 0;
    let cur = { p: [HOME(), HOME()], chuck: [null, null], plate: [] };
    const snap = () => JSON.parse(JSON.stringify(cur));
    function push(dur, cap, mut, extra) {
      const from = snap(); if (mut) mut(cur); const to = snap();
      segs.push(Object.assign({ t0: t, dur, from, to, cap }, extra || {})); t += dur;
    }
    const api = {
      go(k, pose, dur, cap) { push(dur || 1.2, cap, c => { c.p[k] = Object.assign({}, c.p[k], pose); }); return api; },
      go2(poses, dur, cap) { push(dur || 1.2, cap, c => { Object.keys(poses).forEach(k => { c.p[k] = Object.assign({}, c.p[k], poses[k]); }); }); return api; },
      set(fn, cap, dur) { push(dur || 0.5, cap, fn); return api; },
      shot(cams, cap, hold) { push(hold || 0.75, cap, null, { shot: { cams, img: shotImages(cur, cams) } }); return api; },
      wait(dur, cap) { push(dur, cap); return api; },
      cur: () => cur, segs, total: () => t
    };
    return api;
  }
  function itemMarks(it) {
    if (!it) return [];
    if (it.type === 'mark') return [[0, 0]];
    if (it.type === 'rcmark') return [[0, 0]];
    if (it.type === 'wp') return M0.part.corners.slice();   // 料：四角 Mark
    const mv = M0.jig.mv;
    return [V.mul(mv, -1), mv];
  }
  function itemOutline(it) { const b = (l, w, a) => [[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]].map(p => V.rot(p, a)); return it && it.type === 'wp' ? b(M0.part.len, M0.part.wid, M0.part.orient) : (it && it.type === 'jig' ? b(M0.jig.len, M0.jig.wid, 0) : null); }
  function shotImages(cur, cams) {
    const out = {};
    cams.forEach(id => {
      const marks = [], polys = [];
      if (id === 1 || id === 2) {
        const k = id - 1, it = cur.chuck[k], P = cur.p[k];
        if (it) {
          itemMarks(it).forEach(q0 => {
            const q = V.add(it.q, V.rot(q0, it.ang || 0));
            const u = CAL.pixTop(M0, k, CAL.chuckPt(M0, k, P.S, P.th, 0, q));
            if (CAL.inImage(M0.top[k], u, -40)) marks.push({ u, kind: 'chuck', r: MR });
          });
          const ol = itemOutline(it);
          if (ol) polys.push(ol.map(q0 => CAL.pixTop(M0, k, CAL.chuckPt(M0, k, P.S, P.th, 0, V.add(it.q, V.rot(q0, it.ang || 0))))));
        }
      } else {
        const b = M0.bcam[id], S = cur.p[b.plat].S;
        const add = (W, kind, r) => { const u = CAL.pixB(M0, id, S, W); if (CAL.inImage(b, u, -150)) marks.push({ u, kind, r }); };
        M0.tray.cols.forEach(cx => M0.tray.rows.forEach(ry => [-1, 1].forEach(s => add(CAL.trayW(M0, CAL.trayMarkT(M0, [cx, ry], s)), 'pocket', MR))));
        Object.values(M0.fidT).forEach(f => add(CAL.trayW(M0, f), 'fid', MR * 1.2));
        cur.plate.forEach(it => itemMarks(it).forEach(q0 => add(V.add(it.W, V.rot(q0, it.ang || 0)), 'jig', MR)));
      }
      out[id] = { marks, polys };
    });
    return out;
  }

  // 常用位置（指令值）
  const Sc = k => CAL.nomSc(M0, k);
  const SvT = (j, t) => CAL.nomSv(M0, j, CAL.trayNom(M0, t));
  const SpT = (k, t) => CAL.nomSp(M0, k, CAL.trayNom(M0, t));
  const JIG = { type: 'jig', q: CAL.JIG.qc, ang: CAL.JIG.ang };
  function release(k, it) { // 把吸盤上的物件交給平台3
    return c => {
      const P = c.p[k], q = it.q;
      const W = CAL.chuckPt(M0, k, P.S, P.th, P.h, q);
      c.plate.push({ type: it.type, W, ang: (it.ang || 0) + P.th + M0.plat[k].axisRot });
      c.chuck[k] = null;
    };
  }

  // ---------- 估算結果（模擬，含雜訊）----------
  const SIMOPT = { px: 0.1, rep: 1, thRep: 2, slip: 0, seed: 11 };
  const EST = CAL.calibrateAll(M0, SIMOPT);
  const EST0 = CAL.calibrateAll(M0, { px: 0 });
  const f3 = v => (v >= 0 ? '+' : '') + v.toFixed(3), f4 = v => (v >= 0 ? '+' : '') + v.toFixed(4), um = v => (v * 1000).toFixed(1);
  const pt = (p, f) => `(${(f || f3)(p[0])}, ${(f || f3)(p[1])})`;
  function table(head, rows) { return `<div class="tbl"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }

  // ---------- 圖解（SVG）----------
  // 平台3 料盤配置圖（依 mm 比例）：左平台 1–h 欄、右平台 h+1–n 欄、SPB Mark A／B／C、交界區
  function trayFig() {
    const T = M0.tray, F = M0.fidT, h = T.nC / 2, pe = M0.part.ext;
    const xs = [...T.cols.map(c => Math.abs(c) + pe[0]), ...Object.values(F).map(f => Math.abs(f[0]))], ys = [...T.rows.map(r => r + pe[1]), ...T.rows.map(r => r - pe[1]), ...Object.values(F).map(f => f[1])];
    const X = Math.max(...xs) + 30, Y0 = Math.min(...ys) - 25, Y1 = Math.max(...ys) + 25;
    const W = 760, s = (W - 40) / (2 * X), H = (Y1 - Y0) * s + 120;
    const sx = x => W / 2 + x * s, sy = y => 50 + (Y1 - y) * s;
    let g = `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" class="fig" style="max-width:760px" role="img" aria-label="平台3 料盤配置">`;
    g += `<rect x="${sx(-X + 10)}" y="${sy(Y1 - 8)}" width="${(2 * X - 20) * s}" height="${(Y1 - Y0 - 16) * s}" rx="4" class="f-tray"/>`;
    g += `<rect x="${sx(T.cols[h - 1] - pe[0] - 4)}" y="${sy(Math.max(...T.rows) + pe[1] + 6)}" width="${(T.cols[h] - T.cols[h - 1] + 2 * pe[0] + 8) * s}" height="${(Math.max(...T.rows) - Math.min(...T.rows) + 2 * pe[1] + 12) * s}" class="f-bz"/>`;
    T.cols.forEach((cx, ci) => T.rows.forEach((ry, ri) => {
      g += `<rect x="${sx(cx - pe[0])}" y="${sy(ry + pe[1])}" width="${2 * pe[0] * s}" height="${2 * pe[1] * s}" class="${ci < h ? 'f-p1' : 'f-p2'}"/>`;
      g += `<text x="${sx(cx)}" y="${sy(ry) + 4}" class="t-c t-s">${ri + 1}-${ci + 1}</text>`;
    }));
    const xb = (T.cols[h - 1] + T.cols[h]) / 2;
    g += `<line x1="${sx(xb)}" y1="${sy(Y1) - 22}" x2="${sx(xb)}" y2="${sy(Y0) + 8}" class="l-err" stroke-dasharray="4 3"/>`;
    g += `<text x="${sx((T.cols[0] + T.cols[h - 1]) / 2)}" y="${sy(Y1) - 20}" class="t-c">左平台（第 1–${h} 欄）</text><text x="${sx((T.cols[h] + T.cols[T.nC - 1]) / 2)}" y="${sy(Y1) - 20}" class="t-c">右平台（第 ${h + 1}–${T.nC} 欄）</text>`;
    Object.keys(F).forEach(k => { const f = F[k]; g += `<circle cx="${sx(f[0])}" cy="${sy(f[1])}" r="6" class="f-fid"/><text x="${sx(f[0]) + (f[0] < 0 ? -10 : 10)}" y="${sy(f[1]) + (f[1] > 0 ? -10 : 18)}" class="${f[0] < 0 ? '' : ''}" text-anchor="${f[0] < 0 ? 'start' : 'end'}">Mark ${k}</text>`; });
    const yd = sy(Y0) + 30, dimL = [F.A[0], T.cols[h - 1]], dimR = [T.cols[h], F.C[0]];
    [[dimL, 'l-p1'], [dimR, 'l-p2']].forEach(([d, c]) => {
      g += `<line x1="${sx(d[0])}" y1="${yd}" x2="${sx(d[1])}" y2="${yd}" class="${c}"/><line x1="${sx(d[0])}" y1="${yd - 6}" x2="${sx(d[0])}" y2="${yd + 6}" class="${c}"/><line x1="${sx(d[1])}" y1="${yd - 6}" x2="${sx(d[1])}" y2="${yd + 6}" class="${c}"/>`;
      g += `<text x="${sx((d[0] + d[1]) / 2)}" y="${yd + 20}" class="t-c">${Math.abs(d[1] - d[0]).toFixed(1)} mm</text>`;
    });
    g += `<text x="${sx(xb)}" y="${yd + 20}" class="t-c t-e t-s">交界（誤差疊加）</text></svg>`;
    return `<div class="tbl">${g}</div><p class="note">依 mm 比例繪製。粗框顏色：藍＝左平台負責、橘＝右平台負責；紅色虛線框是交界兩側的誤差疊加區。尺寸線是「自己的 Mark 到最遠穴位中心」的 X 距離。</p>`;
  }
  const FIG = {
    chain: `<svg viewBox="0 0 640 250" class="fig" role="img" aria-label="放料計算鏈">
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="f-ink"/></marker></defs>
      <rect x="10" y="20" width="180" height="70" rx="8" class="f-cam"/><text x="100" y="48" class="t-c">上相機1/2 拍料</text><text x="100" y="70" class="t-c t-s">ŵ、φ̂（料相對旋轉中心）</text>
      <rect x="10" y="150" width="180" height="70" rx="8" class="f-cam"/><text x="100" y="178" class="t-c">下相機3/4 拍穴位</text><text x="100" y="200" class="t-c t-s">T̂、ψ̂（穴位在平台座標）</text>
      <rect x="250" y="85" width="170" height="80" rx="8" class="f-calc"/><text x="335" y="115" class="t-c">Δθ = ψ̂ − φ̂</text><text x="335" y="140" class="t-c t-s">S_p = T̂ − R̂ − Rot(Δθ)·ŵ</text>
      <rect x="480" y="85" width="150" height="80" rx="8" class="f-p1"/><text x="555" y="115" class="t-c">平台移到 S_p</text><text x="555" y="140" class="t-c t-s">DD 轉 Δθ → Z 上升放料</text>
      <path d="M190,55 L250,110" class="l-ink" marker-end="url(#ar)"/><path d="M190,185 L250,140" class="l-ink" marker-end="url(#ar)"/><path d="M420,125 L478,125" class="l-ink" marker-end="url(#ar)"/>
      <text x="215" y="30" class="t-s t-m">Â_top、Ĉ_top（步驟2）R̂（步驟3）</text><text x="200" y="240" class="t-s t-m">A_j（步驟4）D_j（步驟5）</text>
    </svg>`,
    sign: `<svg viewBox="0 0 640 210" class="fig" role="img" aria-label="下相機符號">
      <defs><marker id="ar2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="f-ink"/></marker></defs>
      <text x="150" y="22" class="t-c">相機不動、平台帶 Mark（上相機1/2）</text>
      <rect x="40" y="40" width="220" height="140" rx="6" class="f-img"/><circle cx="150" cy="110" r="8" class="f-dot o-25"/><circle cx="200" cy="110" r="8" class="f-dot"/>
      <path d="M160,110 L190,110" class="l-ink" marker-end="url(#ar2)"/><text x="150" y="200" class="t-c t-s">平台 +X → 影像中 Mark 也往 +X（同向）</text>
      <text x="470" y="22" class="t-c">相機跟平台走、Mark 固定（下相機3/4）</text>
      <rect x="360" y="40" width="220" height="140" rx="6" class="f-img"/><circle cx="470" cy="110" r="8" class="f-dot o-25"/><circle cx="420" cy="110" r="8" class="f-dot"/>
      <path d="M460,110 L430,110" class="l-ink" marker-end="url(#ar2)"/><text x="470" y="200" class="t-c t-s">平台 +X → 相機看到 Mark 反向移動 → A = −G</text>
    </svg>`,
    rc: `<svg viewBox="0 0 640 230" class="fig" role="img" aria-label="旋轉中心誤差">
      <circle cx="160" cy="120" r="80" class="l-dash"/><circle cx="160" cy="120" r="4" class="f-ink"/><text x="160" y="140" class="t-c t-s">實際旋轉中心 R</text>
      <circle cx="${160 + 80 * Math.cos(0)}" cy="120" r="7" class="f-dot"/>
      ${[45, 90, 135, 180, 225, 270, 315].map(a => `<circle cx="${(160 + 80 * Math.cos(a * D2R)).toFixed(1)}" cy="${(120 - 80 * Math.sin(a * D2R)).toFixed(1)}" r="6" class="f-dot o-60"/>`).join('')}
      <text x="160" y="222" class="t-c t-s">轉 0°、45° … 315°，用已知角度擬合圓心</text>
      <circle cx="420" cy="110" r="4" class="f-ink"/><text x="420" y="96" class="t-c t-s">R</text><circle cx="470" cy="135" r="4" class="f-err"/><text x="490" y="150" class="t-s">程式用的 R̂</text>
      <path d="M420,110 L470,135" class="l-err"/><text x="430" y="135" class="t-s t-e">e</text>
      <text x="470" y="200" class="t-c t-s">放料誤差 = (Rot(Δθ) − I)·e ≈ Δθ·(−e_y, e_x)</text><text x="470" y="220" class="t-c t-s">→ 料轉越多，偏越多；Δθ=0 時看不到</text>
    </svg>`,
    link: `<svg viewBox="0 0 640 240" class="fig" role="img" aria-label="玻璃治具轉移法">
      <defs><marker id="ar3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="f-ink"/></marker></defs>
      <rect x="20" y="20" width="600" height="14" class="f-p3"/><text x="320" y="16" class="t-c t-s">平台3 下表面</text>
      <rect x="40" y="150" width="120" height="14" class="f-p1"/><rect x="70" y="140" width="60" height="6" class="f-glass"/><rect x="85" y="60" width="30" height="30" class="f-cam"/><path d="M100,90 L100,136" class="l-cam"/>
      <text x="100" y="190" class="t-c t-s">① 上相機量治具 → q̂</text>
      <path d="M170,150 L240,90" class="l-ink" marker-end="url(#ar3)"/>
      <rect x="250" y="34" width="60" height="6" class="f-glass"/><rect x="220" y="90" width="120" height="14" class="f-p1"/><path d="M280,90 L280,44" class="l-ink" marker-end="url(#ar3)"/>
      <text x="280" y="125" class="t-c t-s">② S_p、Z 上升 h，交給平台3</text>
      <path d="M350,100 L410,100" class="l-ink" marker-end="url(#ar3)"/>
      <rect x="440" y="34" width="60" height="6" class="f-glass"/><rect x="420" y="150" width="160" height="14" class="f-p1"/><rect x="455" y="110" width="20" height="40" class="f-cam"/><path d="M465,110 L465,44" class="l-cam"/>
      <text x="510" y="190" class="t-c t-s">③ 平台移 S_v，下相機往上量</text>
      <text x="320" y="225" class="t-c t-s">D_j = S_p + R̂ + q̂ − S_v − A_j·u（Z 傾斜與放料轉移一起被量進去）</text>
    </svg>`
  };

  // ---------- 步驟 ----------
  const STEPS = [];
  // 0 總覽
  STEPS.push({
    id: 'overview', title: '機台與座標', sub: '先認識誰動、誰不動',
    build() {
      const tl = TL();
      tl.wait(0.8, '平台1（藍）、平台2（橙）在下方；平台3 固定在上方，料盤放料面朝下');
      tl.go(0, { S: [80, 0] }, 1, '平台1 X 軸：吸盤與下相機3 一起移動').go(0, { S: [0, 0] }, 0.8);
      tl.go(0, { S: [0, 80] }, 1, '平台1 Y 軸').go(0, { S: [0, 0] }, 0.8);
      tl.go(0, { th: 35 * D2R }, 1, '平台1 DD 旋轉：只有吸盤轉，下相機不轉').go(0, { th: 0 }, 0.8);
      tl.go(0, { h: 30 }, 0.8, '平台1 Z 軸：吸盤升降，下相機不動').go(0, { h: 0 }, 0.7);
      tl.go(1, { S: [-80, 60] }, 1.1, '平台2 XY：吸盤與下相機4 一起移動').go(1, { th: -35 * D2R }, 0.9, '平台2 DD').go(1, { th: 0, S: [0, 0] }, 1);
      tl.go2({ 0: { S: Sc(0) }, 1: { S: Sc(1) } }, 1.6, '平台1 到上相機1 下方、平台2 到上相機2 下方（各有一台固定上相機）').wait(0.8).go2({ 0: { S: [0, 0] }, 1: { S: [0, 0] } }, 1.4);
      return tl;
    },
    html: () => `
      <p class="lead">放料要準，靠的是一條計算鏈：上相機量「料在吸盤上的位置與角度」，下相機量「穴位在哪裡」，兩者在同一個平台座標系裡相減，才知道平台要走多少、DD 要轉多少。每個校正步驟就是在求這條鏈上的一個參數。</p>
      ${FIG.chain}
      <h4>本手順的機構假設</h4>
      <ul>
        <li>每個平台各有一上一下兩台相機：<b>上相機1</b>（固定）拍平台1、<b>上相機2</b>（固定）拍平台2；<b>下相機3</b> 裝在平台1 的 XY 載台、<b>下相機4</b> 裝在平台2 的 XY 載台。兩個平台的校正彼此獨立。</li>
        <li>下相機跟著 XY 移動，<b>不隨 DD 旋轉、不隨 Z 升降</b>。如果實際上裝在 DD 或 Z 上，步驟 4、5 要改寫。</li>
        <li>上相機1、2 各在平台3 前方的取像站往下看（不被平台3 擋住）。</li>
        <li>平台3 固定在上方，料盤的放料面朝下；下相機往上看料盤的穴位 Mark 與平台3 上的 SPB Mark（A 左上：左平台用；B 右上、C 右下：右平台用）。</li>
        <li>料的四個角各有一顆 Mark，上相機視野只拍得到一顆，所以<b>平台移動逐顆拍四角</b>，再四點擬合求料的中心與角度。穴位兩邊各有一顆 Mark，由該平台的下相機各拍一次。目前設定：料 ${M0.part.len}×${M0.part.wid} mm（${M0.part.len === M0.part.wid ? '正方形' : '長方形'}，${M0.P.part_orient % 180 ? '長邊沿 Y 放' : '長邊沿 X 放'}），四角 Mark 間距 ${M0.P.part_mark_dx}×${M0.P.part_mark_dy} mm，穴位兩邊 Mark 間距 ${M0.P.pocket_mark_dx} mm${M0.P.pocket_mark_dy ? `（短邊方向 ${M0.P.pocket_mark_dy} mm）` : ''}。料盤 ${M0.tray.nR}×${M0.tray.nC} 穴：左平台（平台1）放第 1–${M0.tray.nC / 2} 欄，右平台（平台2）放第 ${M0.tray.nC / 2 + 1}–${M0.tray.nC} 欄。左平台只看得到 SPB Mark A，右平台看得到 B、C；配置圖見步驟 6。</li>
        <li>座標：X 往右、Y 往後、Z 往上，θ 由上往下看逆時針為正。尺寸與誤差數值是模擬用的示意值，請換成機台實際值。</li>
      </ul>
      <h4>參數總表</h4>
      ${table(['參數', '意義', '求法', '錯了會怎樣'], [
        ['Â_top、Ĉ_top（相機1↔平台1、相機2↔平台2）', '上相機像素 → 平台座標', '步驟 2', '料位置量錯 → 該平台固定偏移'],
        ['R̂（每平台）', 'DD 旋轉中心', '步驟 3', '偏移隨 Δθ 變'],
        ['A3、A4', '下相機像素 → mm（含正負號）', '步驟 4', '偏移跟 Mark 在畫面的位置有關'],
        ['D3、D4', '下相機影像中心 = S + D', '步驟 5', '單一平台固定偏移'],
        ['料盤姿態', '料盤設計座標 → 平台座標', '步驟 6', '隨位置線性變化或旋轉'],
        ['h、放料轉移量', 'Z 行程與放下時的位移', '步驟 5 吸收、步驟 8 驗證', '換料厚、換行程後固定偏移']
      ])}`
  });
  // 1 前置
  STEPS.push({
    id: 'prep', title: '前置確認', sub: '熱機、鎖固、方向表、Z 高度、治具',
    build() {
      const tl = TL();
      tl.set(c => { c.chuck[0] = { type: 'mark', q: [3, -2], ang: 0 }; }, '吸盤放單點玻璃 Mark');
      tl.go(0, { S: Sc(0) }, 1.6, '平台1 到上相機1 下方').shot([1], '上相機1 拍一張（基準）');
      tl.go(0, { S: V.add(Sc(0), [5, 0]) }, 0.7, '只點動 +X 5 mm').shot([1], '看影像：Mark 往右 → 方向表填「+X = 影像 +u」');
      tl.go(0, { S: V.add(Sc(0), [0, 5]) }, 0.7, '只點動 +Y 5 mm').shot([1], 'Mark 往影像上方（v 減少）＝往下看相機的正常現象');
      tl.go(0, { S: Sc(0) }, 0.6).go(0, { S: SvT(3, M0.fidT.A) }, 2, '換下相機：下相機3 移到平台3 的 SPB Mark A 下方').shot([3], '下相機3 拍基準 Mark');
      tl.go(0, { S: V.add(SvT(3, M0.fidT.A), [1, 0]) }, 0.7, '平台 +X 1 mm').shot([3], '下相機3 影像中 Mark 往右移：相機往 +X，Mark 相對相機往 −X，往上看的影像左右相反');
      tl.go(0, { S: [0, 0] }, 1.6).set(c => { c.chuck[0] = null; });
      return tl;
    },
    html: () => `
      <p class="lead">這一步不求任何參數，但大部分「怎麼校都不準」的問題都出在這裡沒做好。</p>
      <h4>動作</h4>
      <ol>
        <li><b>熱機 30 分鐘</b>：XY、DD 來回運轉到溫度穩定。光學尺與鋁件熱膨脹約 10–23 ppm/°C，300 mm 行程差 1°C 就有 3–7 µm。</li>
        <li><b>鎖固並做記號</b>：相機、鏡頭、光源、吸盤。下相機跟著平台加減速，最容易鬆。</li>
        <li><b>方向表</b>：每一軸單獨點動（XY +5 mm、θ +1°），記錄上相機與下相機影像中 Mark 的移動方向，跟軟體設定比對。下相機的影像方向與上相機不同是正常的。平台2 用上相機2、下相機4 再做一次。</li>
        <li><b>θ 正方向與原點</b>：本手順以「由上往下看逆時針為正」。機台若相反，公式中所有 sin 項變號。</li>
        <li><b>Z 高度</b>：記錄上相機取像時的 Z（Z_cam）與放料行程 h（= 平台3 下表面 − 料厚 − 吸盤面）。之後所有校正都在這兩個高度做。</li>
        <li><b>準備治具</b>：單點玻璃 Mark（步驟 2、3）；平台3 的 SPB Mark A／B／C（下方看得到）；雙 Mark 玻璃治具（Mark 間距與厚度和料相同、雙面可視，步驟 5）；有的話再加玻璃尺（檢查軸比例）。</li>
      </ol>
      <h4>記錄</h4><p>方向表、Z_cam、h、環境溫度、治具編號。</p>
      <h4>判定</h4><ul><li>方向表與軟體設定完全一致。</li><li>同一位置重複對焦 5 次，Z 差小於景深的 1/4。</li></ul>
      <h4>常見錯誤</h4><ul><li>度與弧度混用（sin、cos 要用弧度；0.0148 若當弧度等於 0.848°）。</li><li>拍照時抓的是指令位置而不是光學尺的實際位置。</li></ul>`
  });
  // 2 上相機九點
  STEPS.push({
    id: 'top', title: '上相機 1/2 九點校正', sub: '相機1 配平台1、相機2 配平台2',
    build() {
      const tl = TL();
      [0, 1].forEach(k => {
        tl.set(c => { c.chuck[k] = { type: 'mark', q: [3, -2], ang: 0 }; }, `平台${k + 1} 吸盤放單點玻璃 Mark（θ=0、Z=Z_cam）`);
        tl.go(k, { S: V.sub(Sc(k), [3, -2]) }, 1.8, `平台${k + 1} 移到 S_0：玻璃 Mark 在上相機${k + 1} 畫面中心`);
        let n = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          n++; const g = M0.top[k].grid; tl.go(k, { S: V.add(V.sub(Sc(k), [3, -2]), [i * g, j * g]) }, 0.45, `第 ${n}/9 點：S = S_0 + (${i * g}, ${j * g}) mm`).shot([k + 1], `拍照，記錄 S_${n} 與像素 u_${n}`, 0.45);
        }
        tl.go(k, { S: [0, 0] }, 1.5).set(c => { c.chuck[k] = null; });
      });
      return tl;
    },
    html: () => {
      const rows = [0, 1].map(k => { const e = EST.top[k], i = e.info; return [`上相機${k + 1}／平台${k + 1}`, i.mmpp.toFixed(5), i.angDeg.toFixed(3) + '°', i.orthoDeg.toFixed(4) + '°', i.det.toExponential(2), (e.rms / i.mmpp).toFixed(3) + ' px']; });
      return `
      <p class="lead">求上相機的像素 → 平台座標轉換：上相機1 用平台1 的 XY 校，上相機2 用平台2 的 XY 校，得到兩組 Â_top、Ĉ_top。相機要用「它實際服務的那個平台」來校，因為結果同時包含相機角度和該平台 XY 軸的方向。</p>
      <h4>動作</h4><ol>
        <li>單點玻璃 Mark 吸在吸盤上，θ = 0、Z = Z_cam。</li>
        <li>平台1 移到上相機1 下方（平台2 對上相機2），讓 Mark 在影像中心，記這個位置 S_0。之後步驟 3 用的 S_c 是「吸盤中心在相機下方」的位置。</li>
        <li>XY 走 3×3，間距 ${M0.top[0].grid} mm（約視野 ${f1(M0.top[0].fov[0])}×${f1(M0.top[0].fov[1])} mm 的 1/3；相機2 為 ${M0.top[1].grid} mm）。每點停穩 200 ms 以上再拍，同一點拍 3 次取平均。</li>
        <li>記錄 S_i（光學尺實際值）與 Mark 像素 u_i。平台2／上相機2 重做。</li></ol>
      <h4>公式</h4>
      <pre>S_i = G·u_i + c          （每平台 6 個未知數，最小平方）
Â_top = G，Ĉ_top = c
上相機看到的點 → 平台座標：P = Â_top·u + Ĉ_top
mm/px = √|det G|，相機角度 = atan2(G₂₁, G₁₁)
往下看的相機：det G &lt; 0（因為影像 v 往下）</pre>
      <h4>判定</h4><ul><li>九點殘差 &lt; 0.3 px（約 ${(0.3 * M0.top[0].mmpp * 1000).toFixed(0)} µm）。</li><li>X、Y 像素當量差 &lt; 0.5%，正交偏差 &lt; 0.1°。</li><li>兩台上相機若是同規格，mm/px 差應 &lt; 0.5%；差很多表示工作距離（Z）不同，或某一軸比例錯。</li></ul>
      <h4>模擬結果（含 0.1 px 雜訊、1 µm 重複性；真值 ${M0.top[0].mmpp.toFixed(4)} mm/px；相機角度 0.35°、−0.28°）</h4>
      ${table(['相機／平台', 'mm/px', '相機角度', '正交偏差', 'det G', '殘差 RMS'], rows)}
      <p class="note">求得的相機角度 = 相機本身角度 − 平台 XY 軸安裝角（模擬設定平台1 0.05°、平台2 −0.08°），所以 0.30° 與 −0.20° 才是對的。</p>`;
    }
  });
  // 3 旋轉中心
  STEPS.push({
    id: 'rc', title: 'DD 旋轉中心', sub: '上相機看 Mark，DD 轉整圈',
    build() {
      const tl = TL();
      [0, 1].forEach(k => {
        tl.set(c => { c.chuck[k] = { type: 'rcmark', q: [M0.rcR, 1.5], ang: 0 }; }, `平台${k + 1}：玻璃 Mark 放在離中心約 ${M0.rcR} mm`);
        tl.go(k, { S: Sc(k), th: 0 }, 1.8, `平台${k + 1} 到 S_c，XY 之後不動`);
        for (let a = 0; a < 360; a += 45) tl.go(k, { th: a * D2R }, 0.55, `θ = ${a}°（同一方向轉到位）`).shot([k + 1], `拍照：θ = ${a}°`, 0.45);
        tl.go(k, { th: 0 }, 1.2, '轉回 0°').go(k, { S: [0, 0] }, 1.4).set(c => { c.chuck[k] = null; });
      });
      return tl;
    },
    html: () => {
      const rows = [0, 1].map(k => { const r = EST.rc[k], t = V.sub(CAL.rcWorld(M0, k, [0, 0]), M0.plat[k].base); return [`平台${k + 1}`, pt(r.R), pt(EST0.R[k]), um(r.rms) + ' µm', r.r.toFixed(2) + ' mm']; });
      return `
      <p class="lead">求 DD 旋轉中心 R̂（平台在 S = 0 時的位置，平台座標）。料轉 Δθ 時，平台要用 R̂ 才知道料會被轉到哪裡。</p>
      ${FIG.rc}
      <h4>動作</h4><ol>
        <li>玻璃 Mark 放在離吸盤中心約 ${M0.rcR} mm（越遠越準，但整圈都要在上相機視野內；平台1 用相機1、平台2 用相機2）。</li>
        <li>平台停在 S_c，XY 不動。θ = 0°、45° … 315° 共 8 點，每點都從同一方向轉到位（消背隙），拍照。</li>
        <li>重做 3 次，比較 R̂。</li></ol>
      <h4>公式（已知指令角度擬合，線性）</h4>
      <pre>P_i = Â_top·u_i + Ĉ_top
P_i = c + Rot(θ_i)·v          → 解 c、v（4 個未知數）
R̂ = c − S_c
吸盤上任一點：P = S + R̂ + Rot(θ)·q
圓心精度 1σ ≈ σ_P·√(2/N)      （σ_P = 像素雜訊 × mm/px）</pre>
      <p>只能轉小角度 ±α 時，圓心誤差約放大成 σ_P ÷ α（α 用弧度，與半徑無關），所以 DD 能轉整圈就轉整圈。</p>
      <h4>判定</h4><ul><li>擬合殘差 &lt; 0.5 px。</li><li>重做 3 次 R̂ 差 &lt; 5 µm。</li><li>θ 比例：轉 90° 用雙 Mark 量角度，量到 ÷ 指令 = 1 ± 0.0001。</li></ul>
      <h4>它影響多大</h4><p>放料誤差 = (Rot(Δθ) − I)·e ≈ Δθ·(−e_y, e_x)。e = 50 µm、Δθ = 1° 只有 0.9 µm；e = 1 mm、Δθ = 1° 就有 17 µm。料放上吸盤時角度越亂，這項越重要。</p>
      <h4>模擬結果</h4>${table(['平台', 'R̂（含雜訊）', 'R̂（無雜訊）', '殘差 RMS', '|v|'], rows)}
      <p class="note">R̂ 的絕對值會隨上相機九點的原點定義改變，有意義的是它和 D_j（步驟 5）的相對位置。</p>`;
    }
  });
  // 4 下相機九點
  STEPS.push({
    id: 'bottom', title: '下相機 3/4 九點校正', sub: '相機跟平台走，看平台3 固定 Mark',
    build() {
      const tl = TL();
      [[3, 0, 'A'], [4, 1, 'C']].forEach(([j, k, key]) => {
        const S0 = SvT(j, M0.fidT[key]);
        tl.go(k, { S: S0 }, 1.8, `相機${j} 移到平台3 的 SPB Mark ${key} 下方`);
        let n = 0;
        for (let jj = -1; jj <= 1; jj++) for (let i = -1; i <= 1; i++) { n++; const g = M0.bcam[j].grid; tl.go(k, { S: V.add(S0, [i * g, jj * g]) }, 0.35, `相機${j} 第 ${n}/9 點：平台走 (${i * g}, ${jj * g}) mm`).shot([j], `拍照，Mark 在畫面中反向移動`, 0.4); }
        tl.go(k, { S: [0, 0] }, 1.4);
      });
      return tl;
    },
    html: () => {
      const rows = [3, 4].map(j => { const b = EST.b[j], i = b.info; return [`相機${j}`, i.mmpp.toFixed(5), i.angDeg.toFixed(3) + '°', b.Ginfo.det.toExponential(2), (b.rms / i.mmpp).toFixed(3) + ' px']; });
      return `
      <p class="lead">求下相機3、4 的像素 → mm 轉換。和上相機最大的不同：相機跟著平台走，Mark 不動，所以平台往 +X，Mark 在影像中相對相機往 −X。</p>
      ${FIG.sign}
      <h4>動作</h4><ol>
        <li>平台移到使相機 j 看到平台3 的固定基準 Mark（相機3 用 SPB Mark A，相機4 用 Mark C）。</li>
        <li>基準 Mark 不動，平台 XY 走 3×3，間距 ${M0.bcam[3].grid} mm（相機3 視野約 ${f1(M0.bcam[3].fov[0])}×${f1(M0.bcam[3].fov[1])} mm；相機4 間距 ${M0.bcam[4].grid} mm）。</li>
        <li>記錄 S_i 與 u_i。兩台下相機各做一次。</li></ol>
      <h4>公式</h4>
      <pre>相機中心跟平台走：P_Mark = S_i + D_j + A_j·u_i   （P_Mark 固定）
→ S_i = −A_j·u_i + (P_Mark − D_j)
擬合 S_i = G·u_i + c  →  A_j = −G      ← 一定要取負號
c = P_Mark − D_j（D_j 在步驟 5 才分開）</pre>
      <h4>判定</h4><ul><li>殘差 &lt; 0.3 px（約 3 µm）。</li><li>相機3、4 的 det G 同號，而且和上相機相反（上相機為負、下相機為正）。若同號，表示影像被翻轉過，要確認軟體的影像翻轉設定。</li></ul>
      <h4>常見錯誤</h4><ul><li>直接套用「相機不動、平台帶 Mark」的九點公式 → A 正負相反。Mark 剛好在影像中心時看不出來，偏離中心 0.2 mm 就會多出約 0.4 mm 偏移（每片不同，看起來像隨機）。驗證頁有這個情況的模擬。</li></ul>
      <h4>模擬結果（真值 0.010 mm/px；角度 0.25°、0.60°）</h4>${table(['相機', 'mm/px', '相機角度（A）', 'det G', '殘差 RMS'], rows)}`;
    }
  });
  // 5 上下連結
  STEPS.push({
    id: 'link', title: '上下相機連結', sub: '玻璃治具轉移法，求 D3、D4',
    build() {
      const tl = TL();
      [0, 1].forEach(k => {
        const t = CAL.linkPocket(M0, k), Sp = SpT(k, t);
        tl.set(c => { c.chuck[k] = Object.assign({}, JIG); }, `平台${k + 1}：雙 Mark 玻璃治具放上吸盤`);
        tl.go(k, { S: V.add(Sc(k), M0.jig.mv) }, 1.8, `① 平台移動，治具左 Mark 到上相機${k + 1} 下方`).shot([k + 1], '拍左 Mark → q̂_L')
          .go(k, { S: V.sub(Sc(k), M0.jig.mv) }, 0.9, `平台移動，右 Mark 到上相機${k + 1} 下方`).shot([k + 1], '拍右 Mark → q̂_R');
        tl.go(k, { S: Sp }, 2, '② 移到放料位置 S_p（θ = 0）').go(k, { h: M0.hCal }, 1, 'Z 上升到治具行程').set(release(k, JIG), '治具交給平台3（破真空、平台3 吸附）').go(k, { h: 0 }, 0.8, 'Z 下降');
        const j = k + 3;
        tl.go(k, { S: SvT(j, V.sub(t, M0.jig.mv)) }, 1.2, `③ 下相機${j} 對治具左 Mark`).shot([j], `拍 → D${j}`);
        tl.go(k, { S: SvT(j, V.add(t, M0.jig.mv)) }, 0.9, `下相機${j} 移到右 Mark（檢查點）`).shot([j], '預測 vs 實測：檢查間距與 X 軸偏擺');
        tl.go(k, { S: Sp }, 1.1, '④ 回到 S_p 把治具取回').go(k, { h: M0.hCal }, 0.8).set(c => { c.plate.pop(); c.chuck[k] = Object.assign({}, JIG); }, '吸盤吸回治具').go(k, { h: 0 }, 0.7).go(k, { S: [0, 0] }, 1.5).set(c => { c.chuck[k] = null; });
      });
      return tl;
    },
    html: () => {
      const rows = [3, 4].map(j => { const k = M0.bcam[j].plat, got = V.sub(EST.D[j], EST.R[k]), tr = V.sub(M0.bcam[j].d, M0.plat[k].rcOff); return [`相機${j}`, pt(got), pt(tr), um(V.len(V.sub(got, tr))) + ' µm']; });
      const c0 = EST.link[0].check, c1 = EST.link[1].check;
      return `
      <p class="lead">這是最關鍵的一步：求每台下相機影像中心在平台座標的位置 D_j（相機中心 = S + D_j），把「上相機量的料」和「下相機量的穴位」接到同一個座標系。平台1（上相機1＋下相機3）、平台2（上相機2＋下相機4）各做一次。偏移量大多從這裡來。</p>
      ${FIG.link}
      <h4>動作</h4><ol>
        <li>雙 Mark 玻璃治具吸在吸盤上（θ = 0、Z = Z_cam）。上相機（平台1 用相機1、平台2 用相機2）一次只拍一顆：平台移到 S_L 讓左 Mark 在相機下方拍一張，再移到 S_R 拍右 Mark，得到 q̂_L、q̂_R（相對旋轉中心）。</li>
        <li>平台移到放料位置 S_p（θ = 0），Z 上升到放料行程 h，把治具交給平台3（和放料完全相同的動作：破真空、吹氣、平台3 吸附），Z 下降。</li>
        <li>平台移到 S_v，下相機（3 或 4）先拍左 Mark 求 D_j，再移到右 Mark 拍一張當檢查點。</li>
        <li>回到 S_p 把治具取回。治具轉 180° 再做一次取平均（消除治具上下面 Mark 不同心），共做 3 次。</li></ol>
      <h4>公式</h4>
      <pre>治具放下後 Mark 的平台座標（預測）：P_m = S_p + R̂ + q̂_m
下相機量到：                       P_m = S_v + D_j + A_j·u
→ D_j = S_p + R̂ + q̂_m − S_v − A_j·u
其中 q̂_m = Â_top·u_m + Ĉ_top − S_m − R̂     （S_m：拍這顆 Mark 時的平台位置；R̂ 會抵銷，D_j 不受旋轉中心誤差影響）</pre>
      <p>因為治具是用「和放料一樣的動作」放下去再量，Z 軸傾斜 × 行程、破真空時的位移都會被量進 D_j。代價是：Z 行程、料厚、放料參數一改，就要重做這一步。</p>
      <h4>判定</h4><ul><li>3 次 D_j 變異 &lt; 3 µm。</li><li>右 Mark 檢查點：預測與實測差 &lt; 5 µm。太大表示下相機比例 A、X 軸直線度或偏擺有問題，或上相機量到的治具間距不準。</li></ul>
      <h4>精度預估</h4><p>上相機目前是 ${M0.top[0].mmpp.toFixed(4)} mm/px，單次辨識雜訊 0.1 px 就是 ${(M0.top[0].mmpp * 100).toFixed(1)} µm；上相機逐顆拍時，平台重複性（約 1 µm）也會加進每一顆 Mark。每點拍 3 次、整個連結做 3 次取平均後，D_j 的誤差約為 ${(Math.hypot(0.1 * M0.top[0].mmpp / Math.sqrt(3), 0.001) / Math.sqrt(3) * 1000 * 1.5).toFixed(1)} µm 等級；要更準就要提高上相機倍率，或增加平均次數。</p>
      <h4>沒有雙面治具時</h4><p>用真的料做「放一片 → 下相機拍料的 Mark 與穴位 Mark → 差值修正 D」的迭代，原理相同，但料的 Mark 若不是雙面可視，要改拍料的外形邊。</p>
      <h4>模擬結果：D_j − R̂（相機中心到旋轉中心的向量）</h4>${table(['相機', '求得', '真值', '差'], rows)}
      <p class="note">右 Mark 檢查點差：下相機3 (${um(c0.diff[0])}, ${um(c0.diff[1])}) µm；下相機4 (${um(c1.diff[0])}, ${um(c1.diff[1])}) µm。</p>`;
    }
  });
  // 6 料盤座標
  STEPS.push({
    id: 'tray', title: '料盤座標對應', sub: '平台3 料盤 ↔ 平台1、平台2',
    build() {
      const tl = TL();
      tl.go(0, { S: SvT(3, M0.fidT.A) }, 1.8, '左平台：下相機3 量 SPB Mark A（左平台只看得到這一顆）').shot([3], 'P_A：只有位置，量不到角度');
      tl.go(0, { S: [0, 0] }, 1.4);
      tl.go(1, { S: SvT(4, M0.fidT.B) }, 1.8, '右平台：下相機4 量 SPB Mark B（右上）').shot([4], 'P_B');
      tl.go(1, { S: SvT(4, M0.fidT.C) }, 1.4, '下相機4 量 SPB Mark C（右下）').shot([4], 'P_C → 料盤角度');
      tl.go(1, { S: [0, 0] }, 1.4);
      return tl;
    },
    html: () => {
      const rows = [0, 1].map(k => { const t = EST.tray[k]; return [k ? '右平台（平台2）' : '左平台（平台1）', t.pts.map(p => 'Mark ' + p.key).join('、'), t.single ? '量不到（只有一顆）' : (t.ang * R2D).toFixed(4) + '°', t.single ? '量不到' : t.scalePpm.toFixed(1) + ' ppm']; });
      const h = M0.tray.nC / 2, F = M0.fidT;
      const armA = Math.abs(M0.tray.cols[h - 1] - F.A[0]), armC = Math.abs(F.C[0] - M0.tray.cols[h]), dBC = V.len(V.sub(F.B, F.C));
      const um1 = v => (v * 1000).toFixed(1);
      return `
      <p class="lead">把料盤的設計座標（每個穴位在哪）對到兩個平台的座標，並決定生產時穴位位置怎麼來。料盤 ${M0.tray.nR}×${M0.tray.nC} 穴：左平台（平台1）放第 1–${h} 欄，右平台（平台2）放第 ${h + 1}–${M0.tray.nC} 欄。</p>
      ${trayFig()}
      <h4>配置重點</h4><ul>
        <li><b>左平台只看得到 SPB Mark A</b>（左上），右平台看得到 <b>Mark B</b>（右上）與 <b>Mark C</b>（右下）。</li>
        <li>離自己 Mark 最遠的穴位剛好在交界兩側：Mark A 到 1-${h}／2-${h} 的 X 距離 ${armA.toFixed(1)} mm，1-${h + 1}／2-${h + 1} 到 Mark C ${armC.toFixed(1)} mm。這兩欄是誤差疊加區：角度誤差 × 力臂最大，而且左右兩平台各自的誤差在這裡碰頭，交界兩側的料最容易看出落差。</li>
        <li>角度誤差的放大：力臂 ${armA.toFixed(1)} mm 時，每 1″ 角度誤差 = ${um1(armA / 3600 * D2R)} µm 偏移；要控制在 10 µm 內，角度只容許約 ${(0.010 / armA * R2D * 3600).toFixed(1)}″。</li>
        <li>兩個平台同時在交界附近作業（左平台放 ${h} 欄、右平台放 ${h + 1} 欄）時距離最近，要有防撞互鎖。</li></ul>
      <h4>動作</h4><ol>
        <li>左平台用下相機3 量 Mark A；右平台用下相機4 量 Mark B、Mark C。</li>
        <li>右平台：由 B、C 兩點算料盤在右平台座標中的角度；B–C 實測距離 ÷ 設計距離（${dBC.toFixed(1)} mm）− 1 → 比例誤差。</li>
        <li>左平台：只有一點，只能得到位置。料盤角度只能用設計值，所以左平台一定要每個穴位都拍（方式 A）。</li></ol>
      <h4>公式</h4>
      <pre>右平台：ψ = ang(P_C − P_B) − ang(C − B)
        穴位 i（設計座標 t_i）：T̂_i = P_B + Rot(ψ)·(t_i − B)
        比例 = |P_C − P_B| ÷ |C − B| − 1
左平台：T̂_i = P_A + (t_i − A)      （ψ 量不到；料盤實際角度差 δ 會變成 δ × 距離的偏移）</pre>
      <h4>兩種生產方式</h4>
      ${table(['方式', '穴位位置怎麼來', '受哪些誤差影響'], [
        ['A（建議，也是目前機台的做法）', '每個穴位都用下相機拍穴位兩邊的 Mark；推算值只用來決定拍照位置', '只有 D_j、A_j、R̂；軸比例、料盤角度、料盤間距都不影響。交界兩側仍可能因兩平台各自的 D_j 誤差出現落差'],
        ['B', '只拍 SPB Mark，穴位用設計間距推算', `另外加上：比例 × 距離（${armA.toFixed(0)} mm × 100 ppm = ${um1(armA * 1e-4)} µm）、料盤角度誤差 × 距離。左平台只有 Mark A，角度量不到，不能用方式 B`]
      ])}
      <h4>判定</h4><ul>
        <li>方式 A：穴位 Mark 實拍位置與推算位置差 &lt; 下相機半視野的一半；超過時先修正 Mark A／B／C 位置或料盤設計座標。</li>
        <li>右平台 B–C 比例 |ppm| &lt; 20；重量 3 次料盤角度變異 &lt; 5″。</li>
        <li>交界落差（1-${h}／2-${h} 與 1-${h + 1}／2-${h + 1} 的平均偏移差）&lt; 10 µm，超過時看「實放驗證」的拆解。</li></ul>
      <h4>模擬結果</h4>${table(['平台', '量到的 SPB Mark', '料盤角度（平台座標）', '比例'], rows)}
      <p class="note">Mark A／B／C、欄距與列距目前是依配置圖比例換算的估計值（欄距 135 mm 由「742.5 mm ＝ 5.5 欄距」算出），請在「機台參數」改成圖面實際值。</p>`;
    }
  });
  // 7 放料一循環
  let demo = null;
  function demoPlace() {
    if (demo) return demo;
    const N = CAL.noiseCtx({ px: 0.1, rep: 1, thRep: 2, seed: 5 });
    demo = [CAL.placeOne(M0, EST, 0, { ci: M0.tray.nC / 2 - 1, ri: 0 }, { qc: [0.35, -0.22], phi: 0.8 * D2R }, {}, N), CAL.placeOne(M0, EST, 1, { ci: M0.tray.nC / 2, ri: M0.tray.nR - 1 }, { qc: [-0.4, 0.3], phi: -1.1 * D2R }, {}, N)];
    return demo;
  }
  const CORNER_NAMES = M0.P.part_orient % 180 ? ['右前', '右後', '左後', '左前'] : ['左前', '右前', '右後', '左後'];
  STEPS.push({
    id: 'cycle', title: '放料一個循環', sub: '生產時的完整計算',
    build() {
      const tl = TL(), d = demoPlace();
      [[0, d[0].pocket, { qc: [0.35, -0.22], phi: 0.8 * D2R }, d[0]], [1, d[1].pocket, { qc: [-0.4, 0.3], phi: -1.1 * D2R }, d[1]]].forEach(([k, pk, wp, res]) => {
        const it = { type: 'wp', q: wp.qc, ang: wp.phi }, t = CAL.pocketT(M0, pk.ci, pk.ri);
        tl.set(c => { c.chuck[k] = it; }, `平台${k + 1}：料放上吸盤（位置、角度隨機）`);
        const j = k + 3;
        M0.part.corners.forEach((cq, i) => {
          tl.go(k, { S: V.sub(Sc(k), cq) }, i ? 0.8 : 1.8, `1. 平台移動，料的第 ${i + 1} 顆角 Mark（${CORNER_NAMES[i]}）到上相機${k + 1} 下方`).shot([k + 1], i < 3 ? `拍角 Mark ${i + 1} → q̂_${i + 1}` : `四點擬合：φ̂ = ${(res.phiHat * R2D).toFixed(3)}°，殘差 ${um(res.cornerMax)} µm`, 0.55);
        });
        tl.go(k, { S: SvT(j, CAL.trayMarkT(M0, t, -1)) }, 2, `2. 下相機${j} 拍穴位第 1 顆 Mark`).shot([j], '穴位 Mark 1').go(k, { S: SvT(j, CAL.trayMarkT(M0, t, 1)) }, 0.9, `下相機${j} 拍穴位另一邊的 Mark`).shot([j], `ψ̂ = ${(res.psiHat * R2D).toFixed(3)}°`);
        tl.go(k, { S: res.Sp, th: res.dth }, 1.3, `3. 移到 S_p、DD 轉 Δθ = ${(res.dth * R2D).toFixed(3)}°`);
        tl.go(k, { h: M0.hPlace }, 0.9, '4. Z 上升放料').set(release(k, it), '破真空，料留在平台3').go(k, { h: 0 }, 0.7, 'Z 下降').go(k, { S: [0, 0], th: 0 }, 1.6, `完成：偏移 (${um(res.err[0])}, ${um(res.err[1])}) µm`);
      });
      return tl;
    },
    html: () => {
      const d = demoPlace();
      const rows = d.map((r, i) => [`平台${r.k + 1}`, `${r.pocket.ri + 1}-${r.pocket.ci + 1}`, pt(r.wHat), (r.phiHat * R2D).toFixed(4) + '°', (r.psiHat * R2D).toFixed(4) + '°', (r.dth * R2D).toFixed(4) + '°', um(r.cornerMax) + ' µm', pt(r.Sp), `(${um(r.err[0])}, ${um(r.err[1])}) µm`]);
      return `
      <p class="lead">把前面所有參數串起來，就是生產時每一片料的計算。偏移排查時，請拿機台的 log 逐項對照這幾個中間值。</p>
      <h4>流程與公式</h4>
      <pre>1. 料放上吸盤（θ = 0），上相機（平台1→相機1、平台2→相機2）一次拍一顆：
   平台依序移到 S_i = S_c − R̂ − c_i，讓第 i 顆角 Mark 到相機下方（i = 1…4）
   （c_i：第 i 顆角 Mark 的設計位置，相對料中心）
   q̂_i = Â_top·u_i + Ĉ_top − S_i − R̂
   四點擬合 q̂_i ≈ ŵ + Rot(φ̂)·c_i  →  料中心 ŵ、料角度 φ̂、殘差

2. 平台移到穴位下方，下相機（平台1→相機3、平台2→相機4）拍穴位兩邊的 Mark
   P_m = S_v,m + D_j + A_j·u_m        （S_v,m：拍該 Mark 時的平台位置）
   T̂ = (P_1 + P_2)/2，  ψ̂ = ang(P_2 − P_1) − α0
   （α0：穴位兩 Mark 連線的設計角度，兩 Mark 在長邊中心線且長邊沿 X 時 α0 = 0）

3. Δθ = ψ̂ − φ̂
   S_p = T̂ − R̂ − Rot(Δθ)·ŵ

4. 平台移到 S_p，DD 轉 Δθ，Z 上升 h，破真空放料，Z 下降</pre>
      <h4>注意</h4><ul>
        <li>第 3 步的 Rot(Δθ)·ŵ：料不在旋轉中心上，轉 Δθ 時料中心會跟著移動，平台要一起補。</li>
        <li><b>上相機四角都是移動平台拍的</b>：q̂_i 一定要用「拍這一張時」的平台位置 S_i 去算，不能四張都用同一個 S_c。用錯的話四點會擠在同一點附近，φ̂ 和 ŵ 都是錯的。</li>
        <li><b>四點擬合殘差</b>是很好用的健康指標：正常應 &lt; 5 µm。殘差大表示某顆角 Mark 辨識錯、料變形，或平台在四個點之間走得不準（XY 比例、直交度）。擬合出來的比例若和設計差超過 200 ppm，先查 XY 軸比例或料的實際尺寸。</li>
        <li>每個平台只有一台下相機，ψ̂ 由穴位兩邊各拍一次得到；兩次之間的 X 軸偏擺、直線度和光學尺誤差會直接變成角度誤差（${(2 * M0.tray.markHalf).toFixed(0)} mm 間距差 1 µm 約 ${(0.001 / (2 * M0.tray.markHalf) * R2D * 3600).toFixed(1)}″）。</li>
        <li><b>φ̂ 和 ψ̂ 必須同基準</b>：料的四角 c_i 與穴位兩 Mark 都要用同一個「料座標」定義（長邊方向為 0°）。穴位兩 Mark 的連線若不是沿長邊（α0 ≠ 0，目前設定 ${(CAL.V.ang(M0.tray.markV) * R2D).toFixed(2)}°），ψ̂ 要扣掉 α0。角 Mark 的編號順序在程式和料上要一致；順序錯開一格時 φ̂ 會差 90°，對稱的料尤其容易搞錯。</li>
        <li>長邊沿 Y 放時，四角和穴位 Mark 的名稱跟著轉 90°。</li>
        <li>θ 轉完若能再用下相機確認料的位置（料 Mark 從下方看得到時），可再修一次 XY，旋轉中心誤差的影響就會消失。</li></ul>
      <h4>模擬一片（含雜訊）</h4>${table(['平台', '穴位', 'ŵ', 'φ̂', 'ψ̂', 'Δθ', '四角殘差', 'S_p', '放料偏移'], rows)}`;
    }
  });
  // 8 實放驗證
  STEPS.push({
    id: 'verify', title: '實放驗證', sub: '全盤放料、故意轉角度、重放統計',
    build() {
      const tl = TL();
      // 全盤：左平台從 1 欄往交界放、右平台從 12 欄往交界放，兩邊輪流
      const h = M0.tray.nC / 2, order = [];
      for (let i = 0; i < h; i++) for (let r = 0; r < M0.tray.nR; r++) { order.push([0, i, r]); order.push([1, M0.tray.nC - 1 - i, r]); }
      order.forEach(([k, ci, ri], i) => {
        const t = CAL.pocketT(M0, ci, ri), it = { type: 'wp', q: [0, 0], ang: ((i % 5) - 2) * 0.5 * D2R };
        const Sp = SpT(k, t);
        tl.set(c => { c.chuck[k] = it; }, null, 0.2).go(k, { S: Sp, th: -it.ang }, 0.8, `平台${k + 1} 放 ${ri + 1}-${ci + 1}（料故意轉 ${(it.ang * R2D).toFixed(1)}°）${ci === h - 1 || ci === h ? '　← 交界' : ''}`).go(k, { h: M0.hPlace }, 0.3).set(release(k, it), null, 0.15).go(k, { h: 0 }, 0.25);
      });
      tl.go2({ 0: { S: [0, 0], th: 0 }, 1: { S: [0, 0], th: 0 } }, 1.4, '全盤放完 → 量每片偏移，貼到「實測分析」');
      return tl;
    },
    html: () => `
      <p class="lead">用實際的料把整盤（${M0.tray.nR}×${M0.tray.nC} 穴）放滿，量每一片的偏移，再用「實測分析」把偏移拆成固定偏移、比例、旋轉中心誤差與隨機量。</p>
      <h4>動作</h4><ol>
        <li>兩個平台都放，每個穴位至少 3 片。料放上吸盤時故意偏 ±0.5 mm、轉 −1°、−0.5°、0、+0.5°、+1°（讓旋轉中心誤差現形）。</li>
        <li>記錄每片的 Δθ（機台 log）與放料後偏移 dX、dY（離線量測，或用下相機拍料與穴位 Mark 的差）。</li>
        <li>資料貼到「實測分析」頁。</li>
        <li>同一片料、同一穴位重放 10 次，統計 3σ。</li></ol>
      <h4>判定</h4><ul><li>所有片的偏移 ≤ 公差。</li><li>3σ ≤ 公差 × 0.6（保留 40% 餘裕）。</li><li>回歸後的固定偏移、比例、旋轉中心誤差都在「偏移排查」表的門檻內。</li><li><b>交界落差</b>：右平台 ${M0.tray.nC / 2 + 1} 欄平均偏移 − 左平台 ${M0.tray.nC / 2} 欄平均偏移 &lt; 10 µm。這兩欄離自己的 Mark 最遠、又緊鄰另一個平台，兩邊各自的誤差在這裡碰頭，最容易看出對不齊。「實測分析」與模擬都會算出這個落差。</li></ul>
      <p>任何一項不合格，到「偏移排查」頁依樣子找原因，修正後從對應的步驟重做。</p>`
  });

  G.STEPS = STEPS; G.M0 = M0; G.EST = EST; G.SIMOPT = SIMOPT; G.stepUtil = { table, um, pt, f3 };
})(window);
