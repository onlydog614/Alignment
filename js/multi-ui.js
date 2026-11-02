// 「多平台」頁：多平台分區貼附的配置圖、誤差熱圖、各欄誤差、改善方案比較
(function () {
  'use strict';
  const VA = window.VA, App = window.App;
  const $ = id => document.getElementById(id);
  const esc = s => App.esc(s);
  const f3 = v => (Number.isFinite(v) ? v.toFixed(3) : '—');
  let sel = null;   // 'tile:1-6' | 'mark:A'
  let view = null;

  const M = () => {
    const s = App.state;
    if (!s.multi) s.multi = VA.defaultMulti();
    return s.multi;
  };
  const K = () => +M().k || 3;

  // ---------- 設定面板 ----------
  function renderConfig() {
    const m = M(), c = m.common;
    const slider = (key, label, min, max, step, scale, unit) => {
      const v = +c[key] * scale;
      return `<div class="ctl"><label>${label}<output>${(+v).toFixed(step < 0.01 ? 3 : step < 1 ? 1 : 0)} ${unit}</output></label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-mc="${key}" data-scale="${scale}"></div>`;
    };
    $('mpCommon').innerHTML =
      slider('sigmaMark', `Mark 辨識（${K()}σ）`, 0.001, 0.02, 0.001, K(), 'mm') +
      slider('sigmaTile', `Tile 貼附＋材料（${K()}σ）`, 0, 0.06, 0.001, K(), 'mm') +
      slider('dT', '量 Mark 到貼附的溫差（3σ）', 0, 5, 0.5, 1, '°C') +
      slider('cte', '基板熱膨脹係數', 0, 25, 0.5, 1, 'ppm/°C');
    $('mpPlatforms').innerHTML = m.platforms.map((p, i) => `
      <div class="mp-plat" style="--pc:${p.color}">
        <div class="mp-ph"><span class="swatch" style="background:${p.color}"></span><input data-mp="platforms.${i}.name" value="${esc(p.name)}" aria-label="平台名稱"></div>
        <div class="grid2">
          <div class="field"><label>負責欄（起）</label><input type="number" min="1" step="1" data-mp="platforms.${i}.cols.0" value="${p.cols[0]}"></div>
          <div class="field"><label>負責欄（迄）</label><input type="number" min="1" step="1" data-mp="platforms.${i}.cols.1" value="${p.cols[1]}"></div>
        </div>
        <div class="field"><label>看得到的 Mark</label><div class="chips">${m.marks.map(mk => `<button type="button" class="chip${p.marks.includes(mk.name) ? ' on' : ''}" style="--cc:${p.color}" data-pmark="${i},${esc(mk.name)}">${esc(mk.name)}</button>`).join('')}</div></div>
        <div class="field"><label>θ 來源</label><select data-mp="platforms.${i}.thetaSrc">
          <option value="marks"${p.thetaSrc === 'marks' ? ' selected' : ''}>由 Mark 計算（需 ≥ 2 點）</option>
          <option value="mech"${p.thetaSrc === 'mech' ? ' selected' : ''}>靠平台機構精度</option></select></div>
        <div class="grid2">
          <div class="field"><label>機構角度誤差（${K()}σ，°）</label><input type="number" step="any" data-mpk="platforms.${i}.sigmaThMech" value="${+(p.sigmaThMech * K()).toFixed(5)}"></div>
          <div class="field"><label>軸比例差（${K()}σ，ppm）</label><input type="number" step="any" data-mpk="platforms.${i}.ppm" value="${+(p.ppm * K()).toFixed(3)}"></div>
        </div>
      </div>`).join('');
    const t = m.tiles, sb = m.substrate;
    $('mpGeom').innerHTML = `
      <div class="grid2">
        <div class="field"><label>基板寬 (mm)</label><input type="number" step="any" data-mp="substrate.w" value="${sb.w}"></div>
        <div class="field"><label>基板高 (mm)</label><input type="number" step="any" data-mp="substrate.h" value="${sb.h}"></div>
        <div class="field"><label>Tile 列數</label><input type="number" step="1" min="1" data-mp="tiles.rows" value="${t.rows}"></div>
        <div class="field"><label>Tile 欄數</label><input type="number" step="1" min="1" data-mp="tiles.cols" value="${t.cols}"></div>
        <div class="field"><label>間距 X (mm)</label><input type="number" step="any" data-mp="tiles.pitchX" value="${t.pitchX}"></div>
        <div class="field"><label>間距 Y (mm)</label><input type="number" step="any" data-mp="tiles.pitchY" value="${t.pitchY}"></div>
        <div class="field"><label>Tile 寬 (mm)</label><input type="number" step="any" data-mp="tiles.w" value="${t.w}"></div>
        <div class="field"><label>Tile 高 (mm)</label><input type="number" step="any" data-mp="tiles.h" value="${t.h}"></div>
        <div class="field"><label>第 1 欄中心 X</label><input type="number" step="any" data-mp="tiles.x0" value="${t.x0}"></div>
        <div class="field"><label>上排中心 Y</label><input type="number" step="any" data-mp="tiles.y0" value="${t.y0}"></div>
      </div>
      <h3>Mark</h3>
      <table class="mp-marks"><tr><th>名稱</th><th>X</th><th>Y</th><th></th></tr>
      ${m.marks.map((mk, i) => `<tr><td><input data-mp="marks.${i}.name" value="${esc(mk.name)}"></td><td><input type="number" step="any" data-mp="marks.${i}.x" value="${mk.x}"></td><td><input type="number" step="any" data-mp="marks.${i}.y" value="${mk.y}"></td><td><button type="button" class="small" data-delmark="${i}">✕</button></td></tr>`).join('')}</table>
      <button type="button" class="small" id="mpAddMark">＋ Mark</button>
      <p class="hint">座標以基板左上 Mark 為原點，X 向右、Y 向下（與圖面一致）。</p>`;
    document.querySelectorAll('#mpPresets button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    $('mpK').value = m.k;
  }

  // ---------- 圖 ----------
  const svgEl = $('mpSvg');
  function heat(f) { return `fill:var(--heat);fill-opacity:${(0.08 + 0.85 * Math.max(0, Math.min(1, f))).toFixed(3)}`; }

  function renderSvg(a) {
    const m = M(), sb = m.substrate, t = m.tiles;
    const W = svgEl.clientWidth || 800, pad = 60;
    // 高度依基板長寬比調整，避免長條形基板留下大片空白
    const want = Math.max(220, Math.min(520, sb.h * (W - 2 * pad) / sb.w + 2 * pad + 50));
    if (Math.abs(svgEl.clientHeight - want) > 2) svgEl.style.height = want + 'px';
    const H = want;
    const sc = Math.min((W - 2 * pad) / sb.w, (H - 2 * pad - 30) / sb.h);
    const ox = (W - sb.w * sc) / 2, oy = pad + 10;
    view = { sc, ox, oy };
    const X = x => ox + x * sc, Y = y => oy + y * sc;
    // 顏色以三種 Mark 配置中最大的誤差為滿刻度，切換方案時顏色可直接比較
    let maxT = Math.max(1e-9, ...a.tiles.filter(x => !x.bad).map(x => x.tot));
    Object.values(VA.MULTI_PRESETS).forEach(pr => {
      const mm = VA.clone(m); pr.apply(mm);
      VA.multiAnalyze(mm).tiles.forEach(x => { if (!x.bad) maxT = Math.max(maxT, x.tot); });
    });
    let h = `<rect x="${X(-15)}" y="${Y(-15)}" width="${(sb.w + 30) * sc}" height="${(sb.h + 30) * sc}" rx="6" class="mp-spb"/>`;
    // 平台區域
    m.platforms.forEach((p, i) => {
      const x0 = t.x0 + t.pitchX * (p.cols[0] - 1) - t.pitchX / 2, x1 = t.x0 + t.pitchX * (p.cols[1] - 1) + t.pitchX / 2;
      h += `<rect x="${X(x0)}" y="${Y(-8)}" width="${(x1 - x0) * sc}" height="${(sb.h + 16) * sc}" class="mp-zone" style="fill:${p.color};stroke:${p.color}"/>`;
      h += `<text x="${X((x0 + x1) / 2)}" y="${Y(-8) - 10}" class="mp-zt" style="fill:${p.color}" text-anchor="middle">${esc(p.name)}（第 ${p.cols[0]}–${p.cols[1]} 欄）</text>`;
    });
    // Tile
    a.tiles.forEach(tl => {
      const f = tl.bad ? 0 : tl.tot / maxT;
      const p = m.platforms[tl.pi];
      h += `<g data-hit="tile:${tl.name}" class="hit${sel === 'tile:' + tl.name ? ' sel' : ''}">
        <rect x="${X(tl.x - t.w / 2)}" y="${Y(tl.y - t.h / 2)}" width="${t.w * sc}" height="${t.h * sc}" rx="2" class="mp-tile" style="${heat(f)};stroke:${p ? p.color : 'var(--danger)'}"/>
        <text x="${X(tl.x)}" y="${Y(tl.y) - 2}" text-anchor="middle" class="mp-tn${f > 0.6 ? ' inv' : ''}">${esc(tl.name)}</text>
        <text x="${X(tl.x)}" y="${Y(tl.y) + 12}" text-anchor="middle" class="mp-tv${f > 0.6 ? ' inv' : ''}">${tl.bad ? '無 Mark' : '±' + f3(tl.tot * K())}</text></g>`;
    });
    // 交界線
    a.joins.filter(j => j.a.r === 1).forEach(j => {
      const x = X((j.a.x + j.b.x) / 2);
      h += `<line x1="${x}" y1="${Y(-12)}" x2="${x}" y2="${Y(sb.h + 12)}" class="mp-join"/>`;
    });
    // 擬合中心與 Mark
    a.fits.forEach((f, i) => {
      if (!f.ok) return;
      const p = m.platforms[i];
      h += `<g class="mp-cen" style="stroke:${p.color}"><line x1="${X(f.c.x) - 7}" y1="${Y(f.c.y) - 7}" x2="${X(f.c.x) + 7}" y2="${Y(f.c.y) + 7}"/><line x1="${X(f.c.x) - 7}" y1="${Y(f.c.y) + 7}" x2="${X(f.c.x) + 7}" y2="${Y(f.c.y) - 7}"/></g>`;
    });
    m.marks.forEach(mk => {
      const seers = m.platforms.filter(p => p.marks.includes(mk.name));
      h += `<g data-hit="mark:${esc(mk.name)}" class="hit${sel === 'mark:' + mk.name ? ' sel' : ''}">`;
      seers.forEach((p, k) => { h += `<circle cx="${X(mk.x)}" cy="${Y(mk.y)}" r="${11 + k * 4}" class="mp-ring" style="stroke:${p.color}"/>`; });
      h += `<circle cx="${X(mk.x)}" cy="${Y(mk.y)}" r="7" class="mp-mark"/><text x="${X(mk.x) + 14}" y="${Y(mk.y) + (mk.y < sb.h / 2 ? -12 : 24)}" class="mp-mt">${esc(mk.name)}</text></g>`;
    });
    // 每平台到最遠 Tile 的距離標註
    a.fits.forEach((f, i) => {
      if (!f.ok) return;
      const far = a.tiles.filter(x => x.pi === i).sort((p, q) => q.d - p.d)[0];
      if (!far) return;
      const y = Y(sb.h + 15) + 22 + i * 18;
      h += `<line x1="${X(f.c.x)}" y1="${y}" x2="${X(far.x)}" y2="${y}" style="stroke:${m.platforms[i].color}" class="mp-dim"/>`;
      h += `<text x="${(X(f.c.x) + X(far.x)) / 2}" y="${y - 4}" text-anchor="middle" class="mp-dt" style="fill:${m.platforms[i].color}">擬合中心 → 最遠 ${esc(far.name)}：${far.d.toFixed(1)} mm</text>`;
    });
    svgEl.innerHTML = h;
  }

  function renderStats(a) {
    const m = M(), k = K();
    const cards = m.platforms.map((p, i) => {
      const ts = a.tiles.filter(x => x.pi === i && !x.bad);
      const f = a.fits[i];
      if (!ts.length || !f.ok) return `<div class="stat"><div class="k">${esc(p.name)}</div><div class="v" style="color:var(--danger)">—</div><div class="d">${f && f.reason ? esc(f.reason) : '沒有 Tile'}</div></div>`;
      const w = ts.slice().sort((x, y) => y.tot - x.tot)[0];
      const dom = Object.entries(w.comp).sort((x, y) => y[1] - x[1])[0][0];
      return `<div class="stat" style="border-color:${p.color}"><div class="k">${esc(p.name)} 最大（${esc(w.name)}）</div><div class="v">±${f3(w.tot * k)}</div>
        <div class="d">主要：${esc(dom)}・${f.n} 個 Mark・θ ${f.src === 'marks' ? `由 Mark（基線 ${f.base.toFixed(0)} mm）` : '靠機構'}</div></div>`;
    });
    const j = a.joins.slice().sort((x, y) => y.tot - x.tot)[0];
    if (j) cards.push(`<div class="stat warn"><div class="k">交界相對誤差（${esc(j.a.name)} ↔ ${esc(j.b.name)}）</div><div class="v">±${f3(j.tot * k)}</div><div class="d">兩側誤差 RSS 合併</div></div>`);
    $('mpStats').innerHTML = cards.join('');
  }

  // 各欄長條（各欄取最差的一列）
  function renderBars(a) {
    const m = M(), k = K(), svg = $('mpBars');
    const W = svg.clientWidth || 800, H = 260, L = 56, R = W - 10, T = 24, B = H - 34;
    const cols = [];
    for (let c = 1; c <= m.tiles.cols; c++) {
      const ts = a.tiles.filter(x => x.c === c && !x.bad);
      cols.push(ts.length ? ts.sort((x, y) => y.tot - x.tot)[0] : { c, bad: true });
    }
    const max = Math.max(1e-6, ...cols.filter(x => !x.bad).map(x => x.tot * k)) * 1.18;
    const pw = Math.pow(10, Math.floor(Math.log10(max / 4))), step = [1, 2, 5, 10].map(x => x * pw).find(s => max / s <= 6);
    let h = '';
    for (let v = 0; v <= max + 1e-12; v += step) {
      const y = B - (B - T) * v / max;
      h += `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" class="g-grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="g-m">${+v.toPrecision(3)}</text>`;
    }
    h += `<text x="8" y="14" class="g-m">位置誤差 ±${k}σ (mm)</text>`;
    const bw = (R - L) / cols.length;
    cols.forEach((t, i) => {
      const x = L + bw * i;
      if (!t.bad) {
        const hgt = (B - T) * t.tot * k / max, p = m.platforms[t.pi];
        h += `<rect x="${x + bw * 0.2}" y="${B - hgt}" width="${bw * 0.6}" height="${hgt}" rx="3" style="fill:${p.color}"/>`;
        h += `<text x="${x + bw / 2}" y="${B - hgt - 5}" text-anchor="middle" class="mp-bv">${f3(t.tot * k)}</text>`;
      }
      h += `<text x="${x + bw / 2}" y="${B + 16}" text-anchor="middle" class="g-m">${t.c}</text>`;
      h += `<rect x="${x}" y="${T}" width="${bw}" height="${B - T}" fill="transparent" data-bar="${i}"/>`;
    });
    a.joins.filter(j => j.a.r === 1).forEach(j => { const x = L + bw * j.a.c; h += `<line x1="${x}" y1="${T - 8}" x2="${x}" y2="${B}" class="mp-join"/>`; });
    h += `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" class="f-arrow"/><text x="${R}" y="${H - 4}" text-anchor="end" class="g-m">欄</text>`;
    svg.innerHTML = h;
    svg.onmousemove = e => {
      const i = e.target.dataset && e.target.dataset.bar;
      if (i === undefined) { tip.hidden = true; return; }
      const t = cols[+i];
      if (t.bad) { tip.hidden = true; return; }
      showTip(e, tileTip(t));
    };
    svg.onmouseleave = () => { tip.hidden = true; };
    $('mpLegend').innerHTML = m.platforms.map(p => `<span><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</span>`).join('') + '<span class="hint">紅色虛線＝平台交界；滑過長條看分量</span>';
  }

  function tileTip(t) {
    const k = K();
    return `<b>${esc(t.name)}</b>（${esc(M().platforms[t.pi].name)}，距擬合中心 ${t.d.toFixed(1)} mm）<br>` +
      Object.entries(t.comp).map(([n, v]) => `${esc(n)}：±${f3(v * k)}`).join('<br>') + `<br><b>綜合：±${f3(t.tot * k)}</b>`;
  }

  // 方案比較
  function renderCompare() {
    const m = M(), k = K();
    const rows = Object.entries(VA.MULTI_PRESETS).map(([key, pr]) => {
      const mm = VA.clone(m); pr.apply(mm);
      const a = VA.multiAnalyze(mm);
      const worst = i => Math.max(0, ...a.tiles.filter(x => x.pi === i && !x.bad).map(x => x.tot));
      const j = Math.max(0, ...a.joins.map(x => x.tot));
      return `<tr><td>${esc(pr.label)}</td>${m.platforms.map((p, i) => `<td class="num">±${f3(worst(i) * k)}</td>`).join('')}<td class="num">±${f3(j * k)}</td></tr>`;
    });
    $('mpCompare').innerHTML = `<thead><tr><th>Mark 配置</th>${m.platforms.map(p => `<th>${esc(p.name)} 最大</th>`).join('')}<th>交界相對</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  }

  function renderDetail(a) {
    const box = $('mpDetail'), m = M(), k = K();
    if (sel && sel.startsWith('tile:')) {
      const t = a.tiles.find(x => x.name === sel.slice(5));
      if (t && !t.bad) { box.innerHTML = `<h3>Tile ${esc(t.name)}</h3><table>${Object.entries(t.comp).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">±${f3(v * k)}</td></tr>`).join('')}<tr><td><b>綜合</b></td><td class="num"><b>±${f3(t.tot * k)}</b></td></tr></table><p class="hint">${esc(m.platforms[t.pi].name)}・位置 (${t.x.toFixed(1)}, ${t.y.toFixed(1)})・距擬合中心 ${t.d.toFixed(1)} mm</p>`; return; }
    }
    if (sel && sel.startsWith('mark:')) {
      const name = sel.slice(5), mk = m.marks.find(x => x.name === name);
      if (mk) {
        box.innerHTML = `<h3>Mark ${esc(name)}</h3><p>位置 (${mk.x}, ${mk.y}) mm（可拖曳）</p><div class="chips">${m.platforms.map((p, i) => `<button type="button" class="chip${p.marks.includes(name) ? ' on' : ''}" style="--cc:${p.color}" data-pmark="${i},${esc(name)}">${esc(p.name)} 看得到</button>`).join('')}</div>`;
        return;
      }
    }
    box.innerHTML = '<p class="hint">點選 Tile 看誤差分量；點選或拖曳 Mark 修改位置與可見平台。</p>';
  }

  // ---------- 兩平台座標轉換 ----------
  function L() {
    const m = M();
    if (!m.link) m.link = VA.defaultMulti().link;
    m.link.truth = Object.assign(VA.defaultMulti().link.truth, m.link.truth);
    return m.link;
  }
  function currentFit() {
    const lk = L();
    const rows = VA.parseLinkRows(lk.text);
    return { rows, fit: rows.length ? VA.fitLink(rows, lk.model) : null };
  }
  function renderLink() {
    const m = M(), lk = L(), k = K();
    const opts = m.platforms.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
    ['lkFrom', 'lkTo'].forEach(id => { if ($(id).innerHTML !== opts) $(id).innerHTML = opts; });
    $('lkFrom').value = lk.from; $('lkTo').value = lk.to; $('lkModel').value = lk.model; $('lkDir').value = lk.dir;
    if (document.activeElement !== $('lkText')) $('lkText').value = lk.text;
    if (document.activeElement !== $('lkConvIn')) $('lkConvIn').value = lk.conv;
    document.querySelectorAll('[data-lkt]').forEach(el => { if (el !== document.activeElement) el.value = lk.truth[el.dataset.lkt]; });
    const A = esc(m.platforms[lk.from] ? m.platforms[lk.from].name : 'A'), B = esc(m.platforms[lk.to] ? m.platforms[lk.to].name : 'B');
    const { rows, fit } = currentFit();
    const out = $('lkResult'), svg = $('lkSvg');
    if (!rows.length) { out.innerHTML = '<p class="hint">尚未輸入共同點。可先展開「產生模擬資料」試用。</p>'; svg.hidden = true; convert(null); return; }
    if (!fit.ok) { out.innerHTML = `<p class="warnings">${esc(fit.reason)}</p>`; svg.hidden = true; convert(null); return; }
    const um = v => (v * 1000).toFixed(2);
    const warn = [];
    if (fit.dof === 0) warn.push('點數剛好等於未知數，殘差必為 0，無法檢查量測是否正確；建議多量 1–2 點。');
    const sm = m.common.sigmaMark;
    if (Number.isFinite(fit.sigma) && fit.sigma > 3 * sm * Math.SQRT2 && fit.dof > 0) warn.push(`殘差（${um(fit.sigma)} µm）明顯大於 Mark 辨識誤差（${um(sm)} µm）：可能有點位對應錯誤，或兩平台之間有比例／直角度差（試試「相似」或「仿射」）。`);
    if (fit.dof > 1) {
      const worst = fit.residuals.slice().sort((a, b) => b.d - a.d)[0];
      if (worst.d > 3 * fit.sigma * Math.SQRT2 && rows.length >= 4) warn.push(`${worst.name} 的殘差特別大（${um(worst.d)} µm），請確認該點兩邊量的是同一個位置。`);
    }
    // 模型建議：比例是否顯著
    const alt = VA.fitLink(rows, 'similarity');
    if (lk.model === 'rigid' && alt.ok && alt.dof > 0 && Math.abs((alt.scaleX - 1) * 1e6) > 3 * alt.sdScalePpm && Math.abs((alt.scaleX - 1) * 1e6) > 5) {
      warn.push(`以相似模型估計兩平台比例差 ${((alt.scaleX - 1) * 1e6).toFixed(1)} ± ${alt.sdScalePpm.toFixed(1)} ppm，明顯不為 0，建議改用「相似」模型（或先校正軸比例）。`);
    }
    // 轉換對各 Tile 造成的不確定度
    const tiles = VA.multiTiles(m).map(t => ({ t, sd: fit.sdAt(t) }));
    const tmax = tiles.slice().sort((a, b) => b.sd - a.sd)[0], tmin = tiles.slice().sort((a, b) => a.sd - b.sd)[0];
    const ppmX = (fit.scaleX - 1) * 1e6, ppmY = (fit.scaleY - 1) * 1e6;
    out.innerHTML = `
      <div class="kv">
        <span>轉換</span><b>${A} → ${B}・${{ rigid: '剛體', similarity: '相似', affine: '仿射' }[fit.model]}・${fit.n} 點（自由度 ${fit.dof}）</b>
        <span>平移 ΔX, ΔY（A 原點）</span><b>${fit.T.x.toFixed(4)}, ${fit.T.y.toFixed(4)} mm</b>
        <span>旋轉 θ</span><b>${fit.theta.toFixed(5)}°${Number.isFinite(fit.sdTheta) ? ` ± ${(fit.sdTheta * k).toFixed(5)}°（${k}σ）` : ''}</b>
        ${fit.model === 'similarity' ? `<span>比例差</span><b>${ppmX.toFixed(1)} ppm${Number.isFinite(fit.sdScalePpm) ? ` ± ${(fit.sdScalePpm * k).toFixed(1)}` : ''}</b>` : ''}
        ${fit.model === 'affine' ? `<span>比例差 X / Y</span><b>${ppmX.toFixed(1)} / ${ppmY.toFixed(1)} ppm</b><span>直角度差</span><b>${fit.skew.toFixed(5)}°</b>` : ''}
        <span>殘差（單軸 1σ／最大）</span><b>${Number.isFinite(fit.sigma) ? um(fit.sigma) : '—'} / ${um(fit.maxRes)} µm</b>
        <span>轉換造成的誤差（${k}σ）</span><b>${Number.isFinite(tmax.sd) ? `${tmin.t.name} ±${f3(tmin.sd * k)} ～ ${tmax.t.name} ±${f3(tmax.sd * k)} mm` : '需多量點才能估計'}</b>
      </div>
      ${warn.length ? `<ul class="warnings">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="table-wrap"><table><thead><tr><th>共同點</th><th>A (X, Y)</th><th>B (X, Y)</th><th>殘差 X µm</th><th>殘差 Y µm</th><th>|殘差| µm</th></tr></thead><tbody>
      ${rows.map((r, i) => { const e = fit.residuals[i]; return `<tr><td>${esc(r.name)}</td><td class="num">${r.a.x.toFixed(4)}, ${r.a.y.toFixed(4)}</td><td class="num">${r.b.x.toFixed(4)}, ${r.b.y.toFixed(4)}</td><td class="num">${um(e.x)}</td><td class="num">${um(e.y)}</td><td class="num">${um(e.d)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="hint">「轉換造成的誤差」是把 A 平台座標換到 B 平台時，由共同點量測誤差帶來的不確定度；離共同點越遠越大，所以共同點應盡量分散並靠近要換算的區域。</p>`;
    drawLinkSvg(rows, fit);
    convert(fit);
  }

  function drawLinkSvg(rows, fit) {
    const svg = $('lkSvg'), m = M(), sb = m.substrate;
    svg.hidden = false;
    const W = svg.clientWidth || 700, H = svg.clientHeight || 220, pad = 30;
    const sc = Math.min((W - 2 * pad) / sb.w, (H - 2 * pad) / sb.h), ox = (W - sb.w * sc) / 2, oy = (H - sb.h * sc) / 2;
    const X = x => ox + x * sc, Y = y => oy + y * sc;
    const maxR = Math.max(1e-9, ...fit.residuals.map(r => r.d)), amp = 40 / maxR;
    let h = `<rect x="${X(0)}" y="${Y(0)}" width="${sb.w * sc}" height="${sb.h * sc}" class="mp-spb"/>`;
    h += `<text x="8" y="16" class="g-m">共同點（A 座標）與殘差向量：最長箭頭 = ${(maxR * 1000).toFixed(2)} µm</text>`;
    rows.forEach((r, i) => {
      const e = fit.residuals[i], x = X(r.a.x), y = Y(r.a.y);
      h += `<line x1="${x}" y1="${y}" x2="${x + e.x * amp}" y2="${y + e.y * amp}" class="lk-arrow" marker-end="url(#lkah)"/>`;
      h += `<circle cx="${x}" cy="${y}" r="5" class="lk-pt"/><text x="${x + 8}" y="${y - 8}" class="g-t">${esc(r.name)}</text>`;
    });
    svg.innerHTML = `<defs><marker id="lkah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" class="g-ahead"/></marker></defs>` + h;
  }

  function convert(fit) {
    const lk = L(), k = K(), outEl = $('lkConvOut');
    if (!fit || !fit.ok) { outEl.value = ''; return; }
    const lines = String(lk.conv || '').split(/\r?\n/);
    outEl.value = lines.map((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return t;
      const parts = t.split(/[\s,;]+/);
      let name = '';
      if (isNaN(+parts[0])) name = parts.shift();
      const x = +parts[0], y = +parts[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return `${t}\t（格式錯誤）`;
      const p = { x, y };
      const q = lk.dir === 'ab' ? fit.fwd(p) : fit.inv(p);
      const pa = lk.dir === 'ab' ? p : q;
      const sd = fit.sdAt(pa);
      return `${name ? name + '\t' : ''}${q.x.toFixed(4)}\t${q.y.toFixed(4)}\t${Number.isFinite(sd) ? '±' + (sd * k).toFixed(4) : ''}`;
    }).join('\n');
  }

  ['lkFrom', 'lkTo', 'lkModel', 'lkDir'].forEach(id => $(id).addEventListener('change', e => {
    const lk = L(), key = { lkFrom: 'from', lkTo: 'to', lkModel: 'model', lkDir: 'dir' }[id];
    lk[key] = id === 'lkFrom' || id === 'lkTo' ? +e.target.value : e.target.value;
    App.save(); renderLink();
  }));
  $('lkText').addEventListener('input', e => { L().text = e.target.value; App.save(); renderLink(); });
  $('lkConvIn').addEventListener('input', e => { L().conv = e.target.value; App.save(); convert(currentFit().fit); });
  document.querySelectorAll('[data-lkt]').forEach(el => el.addEventListener('input', () => {
    if (el.value === '' || isNaN(+el.value)) return;
    L().truth[el.dataset.lkt] = +el.value; App.save();
  }));
  $('lkGen').addEventListener('click', () => {
    const lk = L();
    lk.text = `# 模擬：ΔX ${lk.truth.dx}、ΔY ${lk.truth.dy} mm、θ ${lk.truth.thetaDeg}°、比例 ${lk.truth.ppm} ppm\n` +
      VA.simulateLink(M(), Object.assign({ from: lk.from, to: lk.to }, lk.truth), VA.rng((Date.now() & 0xffff) + 1));
    App.save(); renderLink();
  });
  $('lkFillTiles').addEventListener('click', () => {
    const lk = L();
    lk.conv = VA.multiTiles(M()).map(t => `${t.name}\t${t.x}\t${t.y}`).join('\n');
    App.save(); renderLink();
  });
  $('lkCopy').addEventListener('click', () => {
    const v = $('lkConvOut').value;
    if (navigator.clipboard) navigator.clipboard.writeText(v).catch(() => { $('lkConvOut').select(); });
    else $('lkConvOut').select();
  });

  function renderAll() {
    if ($('tab-multi').hidden) return;
    const a = VA.multiAnalyze(M());
    renderSvg(a); renderStats(a); renderBars(a); renderCompare(); renderDetail(a);
    renderLink();
  }
  function full() { renderConfig(); renderAll(); }

  // ---------- 提示 ----------
  const tip = document.createElement('div');
  tip.className = 'tooltip'; tip.hidden = true; document.body.appendChild(tip);
  function showTip(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 260) + 'px'; tip.style.top = e.clientY + 14 + 'px';
  }

  // ---------- 事件 ----------
  function setPath(o, p, v) { const k = p.split('.'), l = k.pop(); k.reduce((a, x) => a[x], o)[l] = v; }
  const page = $('tab-multi');
  page.addEventListener('input', e => {
    const el = e.target, m = M();
    if (el.dataset.mc) {
      m.common[el.dataset.mc] = +el.value / +el.dataset.scale;
      el.previousElementSibling.querySelector('output').textContent = `${(+el.value).toFixed(+el.step < 0.01 ? 3 : +el.step < 1 ? 1 : 0)} ${el.previousElementSibling.querySelector('output').textContent.split(' ').pop()}`;
    } else if (el.dataset.mp) {
      let v = el.value;
      if (el.type === 'number') { if (v === '' || isNaN(+v)) return; v = +v; }
      setPath(m, el.dataset.mp, v);
    } else if (el.dataset.mpk) {
      if (el.value === '' || isNaN(+el.value)) return;
      // 機構角度與軸比例以 kσ 輸入，內部存 1σ
      setPath(m, el.dataset.mpk, +el.value / K());
    } else return;
    App.save(); renderAll();
  });
  page.addEventListener('change', e => {
    if (e.target.dataset.mp && /marks\.\d+\.name|cols|tiles\.(rows|cols)/.test(e.target.dataset.mp)) { App.save(); full(); }
    if (e.target.id === 'mpK') { M().k = +e.target.value; App.save(); full(); }
  });
  page.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const m = M();
    if (b.dataset.preset) { VA.MULTI_PRESETS[b.dataset.preset].apply(m); App.save(); full(); b.setAttribute('aria-pressed', 'true'); return; }
    if (b.dataset.pmark) {
      const [i, name] = [+b.dataset.pmark.split(',')[0], b.dataset.pmark.split(',').slice(1).join(',')];
      const p = m.platforms[i];
      p.marks = p.marks.includes(name) ? p.marks.filter(x => x !== name) : p.marks.concat(name);
      if (p.marks.length >= 2 && p.thetaSrc === 'mech') p.thetaSrc = 'marks';
      App.save(); full(); return;
    }
    if (b.dataset.delmark !== undefined) {
      const mk = m.marks.splice(+b.dataset.delmark, 1)[0];
      m.platforms.forEach(p => { p.marks = p.marks.filter(x => x !== mk.name); });
      App.save(); full(); return;
    }
    if (b.id === 'mpAddMark') {
      let n = 1; while (m.marks.some(x => x.name === 'M' + n)) n++;
      m.marks.push({ name: 'M' + n, x: m.substrate.w / 2, y: 0 });
      App.save(); full(); return;
    }
    if (b.id === 'mpReset') { App.state.multi = VA.defaultMulti(); App.save(); full(); return; }
    if (b.id === 'mpMC') { runMC(); return; }
  });

  // SVG：點選 Tile/Mark、拖曳 Mark
  let drag = null;
  svgEl.addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-hit]');
    if (!g) { sel = null; renderAll(); return; }
    sel = g.dataset.hit; svgEl.setPointerCapture(e.pointerId);
    if (sel.startsWith('mark:')) drag = { name: sel.slice(5), x: e.clientX, y: e.clientY };
    renderAll();
  });
  svgEl.addEventListener('pointermove', e => {
    const g = e.target.closest('[data-hit]');
    if (!drag && g && g.dataset.hit.startsWith('tile:')) {
      const a = VA.multiAnalyze(M()), t = a.tiles.find(x => x.name === g.dataset.hit.slice(5));
      if (t && !t.bad) showTip(e, tileTip(t));
    } else if (!drag) tip.hidden = true;
    if (!drag) return;
    const mk = M().marks.find(x => x.name === drag.name);
    mk.x = Math.round((mk.x + (e.clientX - drag.x) / view.sc) * 2) / 2;
    mk.y = Math.round((mk.y + (e.clientY - drag.y) / view.sc) * 2) / 2;
    drag.x = e.clientX; drag.y = e.clientY;
    renderAll();
  });
  svgEl.addEventListener('pointerup', () => { if (drag) { drag = null; App.save(); renderConfig(); } });
  svgEl.addEventListener('mouseleave', () => { tip.hidden = true; });

  function runMC() {
    const btn = $('mpMC'); btn.disabled = true; btn.textContent = '計算中…';
    setTimeout(() => {
      const m = M(), k = K(), a = VA.multiAnalyze(m), mc = VA.multiMonteCarlo(m, 3000, 11);
      const pick = [];
      m.platforms.forEach((p, i) => {
        const ts = a.tiles.filter(x => x.pi === i && !x.bad).sort((x, y) => y.tot - x.tot);
        if (ts.length) pick.push(ts[ts.length - 1], ts[0]);
      });
      $('mpMCOut').innerHTML = `<table><thead><tr><th>Tile</th><th>解析式 ±${k}σ</th><th>模擬 ±${k}σ（3000 次）</th><th>差異</th></tr></thead><tbody>${pick.map(t => {
        const q = mc.find(x => x.name === t.name), r = Math.hypot(q.rmsX, q.rmsY);
        return `<tr><td>${esc(t.name)}</td><td class="num">${f3(t.tot * k)}</td><td class="num">${f3(r * k)}</td><td class="num">${((r / t.tot - 1) * 100).toFixed(1)}%</td></tr>`;
      }).join('')}</tbody></table><p class="hint">模擬：每次對 Mark 量測加入雜訊、各平台重新擬合、加入機構角度、軸比例、熱膨脹與貼附誤差，統計實際位置誤差。</p>`;
      btn.disabled = false; btn.textContent = 'Monte-Carlo 驗證';
    }, 20);
  }

  App.onUpdate(o => { if (o.tab === 'multi') full(); });
  window.addEventListener('resize', () => { if (!$('tab-multi').hidden) renderAll(); });
})();
