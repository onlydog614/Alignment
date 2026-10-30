// 「校正手順」頁：選擇配置 → 產生校正步驟與圖解
(function () {
  'use strict';
  const VA = window.VA, App = window.App;
  const $ = id => document.getElementById(id);
  const esc = s => App.esc(s);
  const KIND_CLASS = { focus: 'k-focus', nine: 'k-nine', rc: 'k-rc', link: 'k-link', teach: 'k-teach', verify: 'k-verify' };

  function ensureProc() {
    const s = App.state;
    s.proc = Object.assign(VA.defaultProc(), s.proc || {});
    const gm = s.platform.gantry && s.platform.gantry.enabled && s.platform.gantry.mode === 'camera' ? 'gantry' : 'down';
    s.cameras.forEach((c, i) => { if (!s.proc.mounts[i]) s.proc.mounts[i] = gm; });
    s.proc.mounts.length = s.cameras.length;
  }

  // ---------- 設定面板 ----------
  function renderConfig() {
    const s = App.state, P = s.proc;
    const plat = VA.PLATFORMS[s.platform.preset] || { label: s.platform.preset };
    const g = s.platform.gantry;
    const fin = s.steps[Math.max(0, ...s.shots.filter(x => x.enabled).map(x => +x.step))] || s.steps[0];
    $('procSummary').innerHTML = `
      <div class="kv">
        <span>平台</span><b>${esc(plat.label)}</b>
        <span>XY 線馬</span><b>${g && g.enabled ? (g.mode === 'camera' ? '有（移動相機）' : '有（移動平台）') : '無'}</b>
        <span>相機 / 拍照點</span><b>${s.cameras.length} 台 / ${s.shots.length} 點</b>
        <span>步驟</span><b>${s.steps.map(x => esc(x.name)).join(' → ')}</b>
        <span>最終公差</span><b>${fin.tol} mm</b>
      </div>
      <p class="hint">以上來自「對位計算」頁；在那裡修改平台、相機或步驟後，這裡會自動更新。</p>`;
    $('procMounts').innerHTML = s.cameras.map((c, i) => {
      const o = VA.opticsSummary(c.optics);
      return `<div class="field"><label><span class="swatch" style="background:${App.camColor(i)}"></span> ${esc(c.name)}
        <span class="hint">（${c.optics.lens === 'telecentric' ? '遠心 ' + c.optics.mag + '×' : c.optics.f + ' mm 鏡頭'}，視野約 ${o.fovX.toFixed(o.fovX < 10 ? 2 : 0)} mm）</span></label>
        <select data-bind="proc.mounts.${i}">${Object.entries(VA.MOUNTS).map(([k, l]) => `<option value="${k}"${P.mounts[i] === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
    }).join('');
    document.querySelectorAll('#tab-proc [data-bind^="proc."]').forEach(el => {
      if (el.closest('#procMounts') || el === document.activeElement) return;
      const v = el.dataset.bind.split('.').reduce((o, k) => o[k], s);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
  }

  // ---------- SVG 圖 ----------
  const svg = (w, h, inner, cls = '') => `<svg class="fig ${cls}" viewBox="0 0 ${w} ${h}" role="img" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="f-ahead"/></marker></defs>${inner}</svg>`;
  const T = (x, y, t, cls = 'f-t', anchor = 'middle', size) => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}"${size ? ` font-size="${size}"` : ''}>${esc(t)}</text>`;
  const arrowLine = (x1, y1, x2, y2, cls = 'f-arrow') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" marker-end="url(#ah)"/>`;
  const fmtLen = v => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));

  function figFlow(steps) {
    const W = 600, bh = 54, gap = 34;
    const rows = [];
    steps.forEach((st, i) => {
      const last = rows[rows.length - 1];
      if (st.group && last && last[0].st.group === st.group) last.push({ st, n: i + 1 });
      else rows.push([{ st, n: i + 1 }]);
    });
    let y = 10, inner = '';
    const pos = [];
    rows.forEach(row => {
      const n = row.length, bw = Math.min(260, (W - 20 - (n - 1) * 16) / n), total = n * bw + (n - 1) * 16;
      let x = (W - total) / 2;
      row.forEach(r => {
        pos.push({ ...r, x, y, w: bw });
        const k = KIND_CLASS[r.st.kind];
        inner += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6" class="f-box ${k}"/>`;
        inner += T(x + bw / 2, y + 22, `${r.n}. ${r.st.title}`, `f-title ${k}`, 'middle', n > 2 ? 12 : 14);
        inner += T(x + bw / 2, y + 41, r.st.sub, 'f-m', 'middle', n > 2 ? 10 : 11.5);
        x += bw + 16;
      });
      y += bh + gap;
    });
    // 箭頭：每一列的每個框 → 下一列的每個框
    for (let r = 0; r < rows.length - 1; r++) {
      const a = pos.filter(p => rows[r].some(q => q.n === p.n)), b = pos.filter(p => rows[r + 1].some(q => q.n === p.n));
      a.forEach(p => b.forEach(q => { inner += arrowLine(p.x + p.w / 2, p.y + bh, q.x + q.w / 2 + (a.length > 1 ? (p.x < q.x ? -20 : 20) : 0), q.y - 2); }));
    }
    // 超出規格回到連結（或旋轉中心）
    const v = pos.find(p => p.st.kind === 'verify'), back = pos.find(p => p.st.kind === 'link') || pos.find(p => p.st.kind === 'rc');
    if (v && back) {
      const x1 = v.x + v.w, y1 = v.y + bh / 2, x2 = back.x + back.w, y2 = back.y + bh / 2;
      inner += `<path d="M${x1},${y1} C${x1 + 60},${y1} ${x2 + 60},${y2} ${x2 + 2},${y2}" class="f-loop" marker-end="url(#ah)"/>`;
      inner += T(Math.max(x1, x2) + 48, (y1 + y2) / 2, '超出規格', 'f-loopt', 'middle', 11);
      inner += T(Math.max(x1, x2) + 48, (y1 + y2) / 2 + 14, `回到 ${back.n}`, 'f-loopt', 'middle', 11);
    }
    return svg(W, y - gap + 20, inner, 'flow');
  }

  function figNine(f) {
    const W = 360, H = 250, ar = f.fovY / f.fovX;
    const fw = 220, fh = Math.min(170, fw * ar), x0 = 30, y0 = 30 + (170 - fh) / 2;
    let inner = `<rect x="${x0}" y="${y0}" width="${fw}" height="${fh}" class="f-fov"/>` + T(x0 + fw / 2, y0 - 8, `相機視野 ${fmtLen(f.fovX)} × ${fmtLen(f.fovY)} mm`, 'f-m', 'middle', 11);
    const sx = fw * f.spacing / f.fovX, sy = fh * f.spacing / f.fovY;
    const cx = x0 + fw / 2, cy = y0 + fh / 2;
    let path = '';
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const k = j * 3 + i + 1, px = cx + (i - 1) * sx, py = cy + (j - 1) * sy;
      path += (k === 1 ? 'M' : 'L') + px + ',' + py;
      inner += `<circle cx="${px}" cy="${py}" r="9" class="f-dot"/>` + T(px, py + 22, String(k), 'f-t', 'middle', 11);
    }
    inner = `<path d="${path}" class="f-path"/>` + inner;
    inner += T(270, 70, '記錄', 'f-title', 'start', 13) + T(270, 90, '平台位置', 'f-t', 'start', 11) + T(270, 105, 'Mark 像素座標', 'f-t', 'start', 11);
    inner += T(270, 140, '求出', 'f-title', 'start', 13) + T(270, 160, 'mm/pixel', 'f-t', 'start', 11) + T(270, 175, '相機與軸夾角', 'f-t', 'start', 11);
    inner += T(W / 2, H - 10, `Mark 固定，${f.mover}走 3×3（間距 ${f.spacing} mm）`, 'f-m', 'middle', 11.5);
    return svg(W, H, inner);
  }

  function figRc(f) {
    const W = 360, H = 260, c = { x: 70, y: 120 }, Rd = 210;
    const disp = Math.max(f.alpha, 14); // 圖上放大角度以便看見
    const k = disp / f.alpha;
    let inner = '';
    const a0 = -disp * 1.35 * Math.PI / 180, a1 = disp * 1.35 * Math.PI / 180;
    inner += `<path d="M${c.x + Rd * Math.cos(a0)},${c.y + Rd * Math.sin(a0)} A${Rd},${Rd} 0 0 1 ${c.x + Rd * Math.cos(a1)},${c.y + Rd * Math.sin(a1)}" class="f-arc"/>`;
    [-1, -0.5, 0, 0.5, 1].forEach(fr => {
      const a = fr * f.alpha * k * Math.PI / 180, px = c.x + Rd * Math.cos(a), py = c.y + Rd * Math.sin(a);
      inner += `<line x1="${c.x}" y1="${c.y}" x2="${px}" y2="${py}" class="f-dash"/>`;
      if (f.method === 'follow') inner += `<rect x="${px - 11}" y="${py - 11}" width="22" height="22" class="f-fov"/>`;
      inner += `<circle cx="${px}" cy="${py}" r="7" class="f-dot"/>`;
      if (fr !== 0.5 && fr !== -0.5) inner += T(px + 14, py + 4, fr === 0 ? '0°' : `${fr > 0 ? '+' : '−'}${f.alpha.toFixed(f.alpha < 1 ? 3 : 2)}°`, 'f-t', 'start', 11);
    });
    inner += `<circle cx="${c.x}" cy="${c.y}" r="10" class="f-rc"/>` + T(c.x, c.y + 32, '旋轉中心 R', 'f-title k-link', 'middle', 13);
    inner += T(c.x, c.y + 48, '以已知角度擬合', 'f-m', 'middle', 11);
    const note = f.method === 'follow' ? '每個角度用線馬把 Mark 追回視野中心' : f.method === 'near' ? `Mark 放在距中心約 ${fmtLen(f.R)} mm 內` : `Mark 距中心約 ${fmtLen(f.R)} mm，不可跑出視野`;
    inner += T(W / 2, H - 28, `XY 不動，只轉 θ（圖上角度放大顯示）`, 'f-m', 'middle', 11);
    inner += T(W / 2, H - 10, note, 'f-m', 'middle', 11);
    return svg(W, H, inner);
  }

  function figLinkUpDown(f) {
    const W = 520, H = 250;
    let inner = '';
    inner += T(110, 18, `步驟 A：${f.a} 往下量`, 'f-title', 'middle', 12);
    inner += `<rect x="80" y="35" width="60" height="28" class="f-cam"/>` + T(110, 54, f.a, 'f-camt', 'middle', 11);
    inner += arrowLine(110, 63, 110, 150, 'f-arrow cam');
    inner += `<rect x="55" y="152" width="110" height="10" class="f-glass"/><ellipse cx="110" cy="157" rx="7" ry="4" class="f-mark"/>`;
    inner += `<rect x="25" y="162" width="170" height="30" class="f-stage"/>` + T(110, 182, '平台', 'f-t', 'middle', 11);
    inner += T(110, 212, '得到 Mark 相對平台位置', 'f-m', 'middle', 11);
    inner += arrowLine(220, 120, 270, 120);
    inner += T(395, 18, `步驟 B：${f.z ? '上升後' : '移動後'}${f.b} 往上量`, 'f-title', 'middle', 12);
    inner += `<rect x="300" y="35" width="190" height="28" class="f-stage"/>` + T(395, 54, '載台', 'f-t', 'middle', 11);
    inner += `<rect x="340" y="66" width="110" height="10" class="f-glass"/><ellipse cx="395" cy="71" rx="7" ry="4" class="f-mark"/>`;
    inner += `<rect x="300" y="79" width="190" height="30" class="f-stage"/>` + T(395, 99, f.z ? '平台（Z 上升）' : '平台', 'f-t', 'middle', 11);
    inner += `<rect x="440" y="150" width="60" height="28" class="f-cam"/>` + T(470, 169, f.b, 'f-camt', 'middle', 11);
    inner += `<path d="M470,150 C470,110 430,80 404,73" class="f-arrow cam dashed" marker-end="url(#ah)"/>`;
    inner += T(395, 212, `同一點，得到 ${f.b} 讀值`, 'f-m', 'middle', 11);
    inner += `<rect x="120" y="222" width="280" height="24" rx="4" class="f-box k-link"/>` + T(260, 239, 'B_off ＝ 已知位置 − P_B − 影像偏移', 'f-title k-link', 'middle', 12);
    return svg(W, H, inner);
  }

  function figLinkGantry(f) {
    const W = 480, H = 240;
    const cams = f.cams.slice(0, 3);
    const maxF = Math.max(...cams.map(c => c.fovMin));
    let inner = `<rect x="20" y="150" width="440" height="30" class="f-stage"/>` + T(240, 170, 'XYθ 平台（由線馬移動）', 'f-t', 'middle', 11);
    cams.forEach((c, i) => {
      const cx = 90 + i * 150, size = Math.max(14, 90 * Math.sqrt(c.fovMin / maxF));
      inner += `<rect x="${cx - 25}" y="20" width="50" height="24" class="f-cam"/>` + T(cx, 37, c.name, 'f-camt', 'middle', 10);
      inner += `<rect x="${cx - size / 2}" y="${100 - size / 2}" width="${size}" height="${size}" class="f-fov"/>`;
      inner += `<line x1="${cx}" y1="44" x2="${cx}" y2="${100 - size / 2}" class="f-dash"/>`;
      inner += T(cx, 100 + size / 2 + 12, `視野 ${fmtLen(c.fovMin)} mm`, 'f-m', 'middle', 10);
    });
    inner += `<circle cx="90" cy="100" r="5" class="f-mark"/>`;
    if (cams.length > 1) inner += arrowLine(90, 198, 230, 198) + T(160, 214, '線馬移動 G（記錄實際位置）', 'f-m', 'middle', 10);
    inner += T(W / 2, H - 4, '同一個 Mark 依序送到每台相機中心', 'f-m', 'middle', 11);
    return svg(W, H, inner);
  }

  function figLinkMulti(f) {
    const W = 480, H = 220, n = Math.min(f.cams.length, 4);
    let inner = `<rect x="20" y="140" width="440" height="30" class="f-stage"/>` + T(240, 160, '平台', 'f-t', 'middle', 11);
    for (let i = 0; i < n; i++) {
      const cx = 70 + i * (340 / Math.max(n - 1, 1));
      inner += `<rect x="${cx - 28}" y="20" width="56" height="24" class="f-cam"/>` + T(cx, 37, f.cams[i], 'f-camt', 'middle', 10);
      inner += `<line x1="${cx}" y1="44" x2="${cx}" y2="128" class="f-dash"/>`;
      inner += `<circle cx="${cx}" cy="133" r="5" class="${i === 0 ? 'f-mark' : 'f-ghost'}"/>`;
      if (i > 0) inner += arrowLine(70 + (i - 1) * (340 / Math.max(n - 1, 1)) + 10, 118, cx - 10, 118);
    }
    inner += T(W / 2, H - 14, '同一 Mark 以平台移到每台相機下（或用已知間距的精密治具）', 'f-m', 'middle', 11);
    return svg(W, H, inner);
  }

  function figFocus(f) {
    const W = 320, H = 230;
    let inner = `<rect x="125" y="15" width="70" height="30" class="f-cam"/>` + T(160, 35, '相機', 'f-camt', 'middle', 11);
    inner += `<rect x="140" y="45" width="40" height="${f.tele ? 45 : 25}" class="f-lens"/>`;
    inner += `<rect x="60" y="128" width="200" height="${f.tele ? 14 : 34}" class="f-dof"/>` + T(270, 140, '景深', 'f-m', 'start', 11);
    inner += `<line x1="60" y1="135" x2="260" y2="135" class="f-dash"/>`;
    inner += `<rect x="90" y="150" width="140" height="10" class="f-glass"/>`;
    inner += `<rect x="70" y="160" width="180" height="28" class="f-stage"/>` + T(160, 179, '平台', 'f-t', 'middle', 11);
    inner += arrowLine(40, 190, 40, 130) + arrowLine(40, 130, 40, 192) + T(30, 160, 'Z', 'f-title', 'end', 13);
    inner += T(W / 2, H - 12, f.tele ? '遠心鏡頭：景深小，取最清晰位置的中央' : '一般鏡頭：Z 改變會改變倍率', 'f-m', 'middle', 11);
    return svg(W, H, inner);
  }

  function figTeach() {
    const W = 320, H = 210;
    let inner = `<rect x="40" y="130" width="240" height="28" class="f-stage"/>` + T(160, 149, '平台', 'f-t', 'middle', 11);
    inner += `<rect x="70" y="112" width="180" height="18" class="f-glass"/>` + T(160, 125, '標準品', 'f-t', 'middle', 10);
    inner += `<rect x="110" y="20" width="100" height="70" class="f-fov"/>`;
    inner += `<line x1="160" y1="20" x2="160" y2="90" class="f-dash"/><line x1="110" y1="55" x2="210" y2="55" class="f-dash"/>`;
    inner += `<circle cx="166" cy="50" r="6" class="f-mark"/><circle cx="166" cy="50" r="11" class="f-target"/>`;
    inner += T(220, 50, '登錄為目標', 'f-title k-teach', 'start', 12);
    inner += T(W / 2, H - 14, '標準品放在正確位置 → 每個拍照點拍一次 → 目前→目標', 'f-m', 'middle', 11);
    return svg(W, H, inner);
  }

  function figVerify() {
    const W = 340, H = 220;
    let inner = `<rect x="70" y="25" width="200" height="150" class="f-glass"/>`;
    const pts = [[90, 45, -1, 1], [250, 45, 3, 2], [250, 155, 4, -3], [90, 155, 1, -1]];
    pts.forEach(([x, y, dx, dy], i) => {
      inner += `<circle cx="${x}" cy="${y}" r="9" class="f-target"/>`;
      inner += arrowLine(x, y, x + dx * 4, y - dy * 4, 'f-arrow err');
      inner += `<circle cx="${x + dx * 4}" cy="${y - dy * 4}" r="3" class="f-mark"/>`;
    });
    inner += T(90, 200, '近端', 'f-m', 'middle', 11) + T(250, 200, '遠端', 'f-m', 'middle', 11);
    inner += T(W / 2, H - 2, '誤差向量放大顯示：遠端偏移大 → 檢查旋轉中心／角度', 'f-m', 'middle', 10.5);
    return svg(W, H, inner);
  }

  const FIGS = { nine: figNine, rc: figRc, linkUpDown: figLinkUpDown, linkGantry: figLinkGantry, linkMulti: figLinkMulti, focus: figFocus, teach: figTeach, verify: figVerify };

  // ---------- 手順 ----------
  function renderProcedure() {
    ensureProc();
    const r = VA.buildProcedure(App.state);
    const list = (title, items) => (items && items.length ? `<div class="plist"><b>${title}</b><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
    $('procWarn').innerHTML = r.warnings.length ? `<ul class="warnings">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    $('procFlow').innerHTML = figFlow(r.steps);
    $('procSteps').innerHTML = r.steps.map((st, i) => `
      <article class="pstep ${KIND_CLASS[st.kind]}">
        <header><span class="pnum">${i + 1}</span><div><h3>${esc(st.title)}</h3><div class="hint">${esc(st.sub)}</div></div></header>
        <div class="pbody">
          <div class="pfig">${(FIGS[st.fig.type] || (() => ''))(st.fig)}</div>
          <div class="ptext">
            <ul class="pbul">${st.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
            <div class="pcols">${list('記錄', st.records)}${list('求出', st.outputs)}${list('判定', st.accept)}</div>
          </div>
        </div>
      </article>`).join('');
  }

  function refresh() {
    if ($('tab-proc').hidden) return;
    ensureProc();
    renderConfig();
    renderProcedure();
  }

  $('procPrint').addEventListener('click', () => window.print());
  $('procGoAlign').addEventListener('click', () => App.showTab('align'));
  App.onUpdate(o => { if (o.tab === 'proc' || !o.tab) refresh(); });
})();
