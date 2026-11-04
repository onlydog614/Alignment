// ===== 介面：分頁、動畫播放、相機畫面、偏移模擬、實測分析、驗證 =====
(function (G) {
  'use strict';
  const CAL = G.CAL, { V, D2R, R2D } = CAL, STEPS = G.STEPS, M0 = G.M0, U = G.stepUtil;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const reduce = G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- 分頁 ----------
  const TABS = ['steps', 'trouble', 'analysis', 'params', 'verify'];
  function showTab(id) {
    if (!TABS.includes(id)) id = 'steps';
    $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false'));
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + id; });
    if (id === 'steps' && S3) { S3.resize(); }
    if (id === 'trouble') runSim();
    if (id === 'analysis') runAnalysis();
    if (id === 'verify') runVerify();
    if (id === 'params') renderParams();
  }
  $$('.tab').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', '#' + b.dataset.tab); showTab(b.dataset.tab); }));
  G.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  // ---------- 步驟清單 ----------
  const timelines = STEPS.map(s => s.build());
  let cur = 0;
  const list = $('#steplist');
  list.innerHTML = STEPS.map((s, i) => `<button class="stepbtn" data-i="${i}" id="stepbtn-${i}"><span class="num">${i}</span><span class="st"><b>${s.title}</b><small>${s.sub}</small></span></button>`).join('');
  $$('.stepbtn').forEach(b => b.addEventListener('click', () => selectStep(+b.dataset.i, true)));
  function selectStep(i, play) {
    cur = Math.max(0, Math.min(STEPS.length - 1, i));
    $$('.stepbtn').forEach(b => b.setAttribute('aria-current', +b.dataset.i === cur ? 'step' : 'false'));
    $('#stephead').innerHTML = `<span class="eyebrow">步驟 ${cur} / ${STEPS.length - 1}</span><h3>${STEPS[cur].title}</h3><p class="sub">${STEPS[cur].sub}</p>`;
    $('#stepbody').innerHTML = STEPS[cur].html();
    player.t = 0; player.playing = play && !reduce; lastShots = {}; updatePlayBtn();
    $('#prevstep').disabled = cur === 0; $('#nextstep').disabled = cur === STEPS.length - 1;
    try { localStorage.setItem('cal-step', String(cur)); } catch (e) { /* 無儲存空間時略過 */ }
  }
  $('#prevstep').addEventListener('click', () => selectStep(cur - 1, true));
  $('#nextstep').addEventListener('click', () => selectStep(cur + 1, true));

  // ---------- 3D 與播放 ----------
  let S3 = null;
  const player = { t: 0, playing: !reduce, speed: 1 };
  let lastShots = {};
  function updatePlayBtn() { $('#play').textContent = player.playing ? '暫停' : '播放'; $('#play').setAttribute('aria-pressed', player.playing ? 'true' : 'false'); }
  $('#play').addEventListener('click', () => { const tl = timelines[cur]; if (player.t >= tl.total()) player.t = 0; player.playing = !player.playing; updatePlayBtn(); });
  $('#restart').addEventListener('click', () => { player.t = 0; lastShots = {}; player.playing = true; updatePlayBtn(); });
  $('#speed').addEventListener('change', e => { player.speed = +e.target.value; });
  $('#scrub').addEventListener('input', e => { player.t = +e.target.value / 1000 * timelines[cur].total(); player.playing = false; updatePlayBtn(); });
  $('#viewreset').addEventListener('click', () => S3 && S3.resetView());
  $('#viewtop').addEventListener('click', () => S3 && S3.resetView({ pos: [0, 30, 1500], tgt: [0, 31, 0] }));
  $('#viewbelow').addEventListener('click', () => S3 && S3.resetView({ pos: [-300, -420, -10], tgt: [0, 200, 130] }));

  const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const lerp = (a, b, f) => a + (b - a) * f;
  function stateAt(tl, t) {
    const segs = tl.segs; let s = segs[segs.length - 1];
    for (const sg of segs) { if (t < sg.t0 + sg.dur) { s = sg; break; } }
    const f = s.dur ? ease(Math.max(0, Math.min(1, (t - s.t0) / s.dur))) : 1;
    const p = [0, 1].map(k => ({ S: [lerp(s.from.p[k].S[0], s.to.p[k].S[0], f), lerp(s.from.p[k].S[1], s.to.p[k].S[1], f)], th: lerp(s.from.p[k].th, s.to.p[k].th, f), h: lerp(s.from.p[k].h, s.to.p[k].h, f) }));
    const shots = {}; let activeShot = null;
    segs.forEach(sg => { if (sg.shot && sg.t0 <= t) { sg.shot.cams.forEach(id => { shots[id] = sg.shot.img[id]; }); if (t < sg.t0 + sg.dur) activeShot = sg.shot.cams; } });
    return { seg: s, p, chuck: s.to.chuck, plate: s.to.plate, shots, activeShot };
  }
  let lastSegRef = null, lastPlateKey = '';
  function applyState(st) {
    if (S3) {
      [0, 1].forEach(k => { S3.setPose(k, st.p[k]); S3.setChuckItem(k, st.chuck[k]); });
      const pk = JSON.stringify(st.plate);
      if (pk !== lastPlateKey) { S3.setPlateItems(st.plate); lastPlateKey = pk; }
      if (st.seg !== lastSegRef) { S3.setActive(st.activeShot, !!st.activeShot); lastSegRef = st.seg; }
    }
    if (st.seg.cap) $('#caption').textContent = st.seg.cap;
    lastShots = st.shots; drawCams(st.activeShot);
    $('#readout').textContent = `平台1 S=(${st.p[0].S[0].toFixed(1)}, ${st.p[0].S[1].toFixed(1)}) θ=${(st.p[0].th * R2D).toFixed(2)}° Z=${st.p[0].h.toFixed(1)}　平台2 S=(${st.p[1].S[0].toFixed(1)}, ${st.p[1].S[1].toFixed(1)}) θ=${(st.p[1].th * R2D).toFixed(2)}° Z=${st.p[1].h.toFixed(1)}`;
  }
  let lastTs = 0;
  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0); lastTs = ts;
    const tl = timelines[cur];
    if (player.playing) { player.t += dt * player.speed; if (player.t >= tl.total()) { player.t = tl.total(); player.playing = false; updatePlayBtn(); } }
    if (!$('#view-steps').hidden) {
      applyState(stateAt(tl, player.t));
      $('#scrub').value = String(Math.round(player.t / tl.total() * 1000));
      if (S3) S3.render(dt);
    }
    requestAnimationFrame(loop);
  }

  // ---------- 相機畫面 ----------
  function drawCam(cv, id, img, hot) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    const cam = id <= 2 ? M0.top[id - 1] : M0.bcam[id], sc = W / cam.w;
    ctx.fillStyle = css('--img-bg'); ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = css('--img-grid'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.strokeRect(W / 2 - 12, H / 2 - 12, 24, 24);
    if (img) {
      ctx.strokeStyle = css('--img-wp'); ctx.lineWidth = 1.5;
      img.polys.forEach(pl => { ctx.beginPath(); pl.forEach((u, i) => { const x = W / 2 + u[0] * sc, y = H / 2 + u[1] * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke(); });
      img.marks.forEach(mk => {
        const x = W / 2 + mk.u[0] * sc, y = H / 2 + mk.u[1] * sc, r = Math.max(3, mk.r / cam.mmpp * sc);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (mk.kind === 'fid') { ctx.lineWidth = 2; ctx.strokeStyle = css('--img-mark'); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = css('--img-mark'); ctx.fill(); }
        else if (mk.kind === 'jig') { ctx.lineWidth = 2; ctx.strokeStyle = css('--img-jig'); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - r * 1.4, y); ctx.lineTo(x + r * 1.4, y); ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x, y + r * 1.4); ctx.stroke(); }
        else { ctx.fillStyle = css('--img-mark'); ctx.fill(); }
      });
    }
    cv.parentElement.classList.toggle('hot', !!hot);
    const m = img && img.marks.slice().sort((a, b) => V.len(a.u) - V.len(b.u))[0];
    cv.parentElement.querySelector('.uv').textContent = m ? `u ${m.u[0].toFixed(1)}  v ${m.u[1].toFixed(1)} px` : '—';
  }
  function drawCams(active) { [1, 2, 3, 4].forEach(id => drawCam($('#cv' + id), id, lastShots[id], active && active.includes(id))); }

  // ---------- 偏移模擬 ----------
  const SIM_FIELDS = [
    { g: '校正後機台變了（沒重校）', items: [
      ['topSel', '上相機鬆動：哪一台', 'sel', '0', [['0', '相機1（平台1）'], ['1', '相機2（平台2）']]], ['topx', '　移動 X', 'µm', 0], ['topy', '　移動 Y', 'µm', 0],
      ['camSel', '下相機鬆動：哪一台', 'sel', '4', [['3', '相機3（平台1）'], ['4', '相機4（平台2）']]], ['camx', '　移動 X', 'µm', 0], ['camy', '　移動 Y', 'µm', 0],
      ['rcSel', '旋轉中心改變：哪個平台', 'sel', '0', [['0', '平台1'], ['1', '平台2']]], ['rcx', '　改變 X', 'µm', 0], ['rcy', '　改變 Y', 'µm', 0],
      ['dh', 'Z 行程改變（換料厚）', 'mm', 0], ['tilt', '　平台1 Z 軸傾斜', 'mrad', 0],
      ['trx', '放料轉移量改變（平台1）X', 'µm', 0], ['try', '放料轉移量改變（平台1）Y', 'µm', 0],
      ['trayppm', '料盤實際間距 − 設計', 'ppm', 0], ['axisppm', 'X 軸比例變化（兩平台，溫度）', 'ppm', 0]] },
    { g: '程式或流程錯誤', items: [
      ['noFlip', '下相機九點沒取負號（A = +G）', 'chk', false], ['thetaSign', 'Δθ 正負相反', 'chk', false], ['modeB', '穴位用基準 Mark＋設計間距推算（方式 B）', 'chk', false]] },
    { g: '隨機與料', items: [
      ['px', '影像雜訊', 'px', 0.1], ['rep', '平台重複性', 'µm', 1], ['slip', '放料滑移（隨機）', 'µm', 1], ['phi', '料放上吸盤的角度範圍 ±', '°', 1], ['thr', '推測門檻（影響小於此值不列出）', 'µm', 10]] }
  ];
  const PRESETS = [
    ['理想（只有雜訊）', {}],
    ['相機4 鬆動 20 µm', { camSel: '4', camx: 20, camy: -12 }],
    ['上相機1 被碰動', { topSel: '0', topx: 25, topy: 15 }],
    ['平台1 旋轉中心錯 0.8 mm', { rcSel: '0', rcx: 800, rcy: -400, phi: 2 }],
    ['下相機符號錯', { noFlip: true }],
    ['Δθ 正負相反', { thetaSign: true, phi: 0.5 }],
    ['方式 B＋料盤 +300 ppm', { modeB: true, trayppm: 300 }],
    ['換料厚 +2 mm、平台1 Z 傾斜 10 mrad', { dh: 2, tilt: 10 }]
  ];
  function buildSimForm() {
    $('#simform').innerHTML = SIM_FIELDS.map(gr => `<fieldset><legend>${gr.g}</legend>${gr.items.map(([id, lb, unit, def, opts]) => {
      if (unit === 'chk') return `<label class="chk"><input type="checkbox" id="sim-${id}" ${def ? 'checked' : ''}> ${lb}</label>`;
      if (unit === 'sel') return `<label class="fld"><span>${lb}</span><select id="sim-${id}">${opts.map(o => `<option value="${o[0]}" ${o[0] === def ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>`;
      return `<label class="fld"><span>${lb}</span><span class="inp"><input type="number" step="any" id="sim-${id}" value="${def}"><i>${unit}</i></span></label>`;
    }).join('')}</fieldset>`).join('');
    $('#presets').innerHTML = PRESETS.map((p, i) => `<button class="chip" data-p="${i}">${p[0]}</button>`).join('');
    $$('#presets .chip').forEach(b => b.addEventListener('click', () => { setSim(PRESETS[+b.dataset.p][1]); runSim(); }));
    $('#simform').addEventListener('input', () => runSim());
  }
  function setSim(vals) {
    SIM_FIELDS.forEach(gr => gr.items.forEach(([id, , unit, def]) => {
      const el = $('#sim-' + id), v = vals[id] != null ? vals[id] : def;
      if (unit === 'chk') el.checked = !!v; else el.value = v;
    }));
  }
  function getSim() {
    const o = {};
    SIM_FIELDS.forEach(gr => gr.items.forEach(([id, , unit]) => { const el = $('#sim-' + id); o[id] = unit === 'chk' ? el.checked : (unit === 'sel' ? el.value : (+el.value || 0)); }));
    return o;
  }
  function simulate(o, seed) {
    const mCal = CAL.clone(M0); mCal.plat[0].tilt = [o.tilt, 0];
    const drift = { top: [null, null], cam: { [o.camSel]: [o.camx / 1000, o.camy / 1000] }, rc: [null, null], transfer: [[o.trx / 1000, o.try / 1000], null], trayScale: o.trayppm, scale: [[o.axisppm, 0], [o.axisppm, 0]] };
    drift.rc[+o.rcSel] = [o.rcx / 1000, o.rcy / 1000];
    drift.top[+o.topSel] = [o.topx / 1000, o.topy / 1000];
    const mNow = CAL.applyDrift(mCal, drift);
    const noise = { px: o.px, rep: o.rep, thRep: 2, slip: 0, seed: seed || 11, noFlip: o.noFlip };
    const est = CAL.calibrateAll(mCal, noise);
    const prod = CAL.runProduction(mCal, mNow, est, { px: o.px, rep: o.rep, thRep: 2, slip: o.slip, seed: (seed || 11) + 3, reps: 3, phiDeg: o.phi, dh: o.dh, thetaSign: o.thetaSign, modeB: o.modeB });
    return prod;
  }
  function rowsOf(prod, k) { return prod.filter(r => r.k === k).map(r => ({ x: r.pt[0], y: r.pt[1], dth: r.dth, dx: r.err[0], dy: r.err[1], dang: r.angErr })); }
  function runSim() {
    if (!$('#sim-px')) return;
    const o = getSim(), prod = simulate(o);
    const an = [0, 1].map(k => CAL.analyze(rowsOf(prod, k)));
    renderResult('#simout', prod.map(r => ({ k: r.k, x: r.pt[0], y: r.pt[1], dx: r.err[0], dy: r.err[1] })), an, o.thr);
  }
  function renderResult(sel, pts, an, thrUm) {
    const host = $(sel);
    const maxE = Math.max(1e-6, ...pts.map(p => Math.hypot(p.dx, p.dy)));
    const unitTargets = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2];
    const ref = unitTargets.find(u => u >= maxE * 0.6) || 2, mag = 45 / ref;
    const W = 760, H = 300, sx = x => 380 + x * 0.95, sy = y => 150 - y * 0.95;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="vec" role="img" aria-label="各穴位偏移向量"><defs><marker id="va" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0L10,5L0,10z" class="f-ink"/></marker></defs>`;
    svg += `<rect x="${sx(-420)}" y="${sy(105)}" width="${840 * 0.95}" height="${210 * 0.95}" rx="6" class="f-tray"/>`;
    svg += `<line x1="${sx(0)}" y1="${sy(100)}" x2="${sx(0)}" y2="${sy(-100)}" class="l-dash"/>`;
    M0.tray.cols.forEach(cx => M0.tray.rows.forEach(ry => { svg += `<rect x="${sx(cx - 35)}" y="${sy(ry + 20)}" width="${70 * 0.95}" height="${40 * 0.95}" class="f-pocket"/>`; }));
    svg += `<text x="${sx(-210)}" y="${sy(92)}" class="t-c t-s">平台1</text><text x="${sx(210)}" y="${sy(92)}" class="t-c t-s">平台2</text>`;
    pts.forEach(p => { const x0 = sx(p.x), y0 = sy(p.y), x1 = x0 + p.dx * mag, y1 = y0 - p.dy * mag; svg += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="${p.k === 0 ? 'l-p1' : 'l-p2'}" marker-end="url(#va)"/>`; });
    svg += `<line x1="20" y1="${H - 14}" x2="${20 + ref * mag}" y2="${H - 14}" class="l-ink"/><text x="${28 + ref * mag}" y="${H - 10}" class="t-s">${ref >= 1 ? ref + ' mm' : (ref * 1000) + ' µm'}</text></svg>`;
    const fmt = v => v == null ? '–' : v;
    const rows = an.map((a, k) => a ? [`平台${k + 1}`, a.n, `(${U.um(a.offset[0])}, ${U.um(a.offset[1])})`, a.scaleX == null ? '–' : (a.scaleX * 1e6).toFixed(0), a.scaleY == null ? '–' : (a.scaleY * 1e6).toFixed(0), a.rotXY == null ? '–' : (a.rotXY * R2D * 3600).toFixed(1) + '″', a.e ? `(${a.e[0].toFixed(3)}, ${a.e[1].toFixed(3)})` : '–', U.um(a.sigma), U.um(a.maxAbs), a.ang ? (a.ang.maxAbs * R2D * 3600).toFixed(1) + '″' : '–'] : [`平台${k + 1}`, '資料不足', '', '', '', '', '', '', '', '']);
    const dg = CAL.diagnose(an, { minEffect: (thrUm > 0 ? thrUm : 10) / 1000 });
    host.innerHTML = `<div class="tbl">${svg}</div>
      ${U.table(['', '片數', '固定偏移 µm', 'X 比例 ppm', 'Y 比例 ppm', '旋轉', '旋轉中心誤差 e (mm)', '去趨勢後 1σ µm', '最大 µm', '最大角度誤差'], rows)}
      <ul class="diag">${dg.map(d => `<li class="lv-${d.lvl}"><b>${d.t}</b><span>${d.s}</span></li>`).join('')}</ul>`;
  }

  // ---------- 實測分析 ----------
  function sampleData() {
    const o = Object.assign({}, ...SIM_FIELDS.map(g => Object.fromEntries(g.items.map(i => [i[0], i[3]]))), { camSel: '4', camx: 18, camy: -10, rcSel: '0', rcx: 600, rcy: -300, phi: 1.5 });
    const prod = simulate(o, 29);
    return '# 範例資料（模擬：相機4 鬆動、平台1 旋轉中心偏）。請換成機台實測值\n# 平台  穴位X(mm)  穴位Y(mm)  Δθ(°)  dX(mm)  dY(mm)  角度誤差(°，可省略)\n' + prod.map(r => [r.k + 1, r.pt[0], r.pt[1], (r.dth * R2D).toFixed(4), r.err[0].toFixed(4), r.err[1].toFixed(4), (r.angErr * R2D).toFixed(5)].join('\t')).join('\n');
  }
  function parseData(txt) {
    const rows = [], bad = [];
    txt.split(/\r?\n/).forEach((ln, i) => {
      const s = ln.trim(); if (!s || s.startsWith('#')) return;
      const a = s.split(/[\s,;]+/).map(Number);
      if (a.length < 6 || a.slice(0, 6).some(x => !isFinite(x)) || (a[0] !== 1 && a[0] !== 2)) { bad.push(i + 1); return; }
      rows.push({ k: a[0] - 1, x: a[1], y: a[2], dth: a[3] * D2R, dx: a[4], dy: a[5], dang: a.length >= 7 && isFinite(a[6]) ? a[6] * D2R : null });
    });
    return { rows, bad };
  }
  function runAnalysis() {
    const ta = $('#datain'); if (!ta.value.trim()) ta.value = sampleData();
    const { rows, bad } = parseData(ta.value);
    $('#datamsg').textContent = `讀到 ${rows.length} 筆` + (bad.length ? `；第 ${bad.slice(0, 8).join('、')}${bad.length > 8 ? '…' : ''} 行格式不對，已略過（要 6 或 7 欄：平台 1 或 2、X、Y、Δθ、dX、dY、角度誤差）` : '');
    const an = [0, 1].map(k => CAL.analyze(rows.filter(r => r.k === k)));
    renderResult('#dataout', rows, an, +$('#thr').value);
  }
  $('#datain').addEventListener('input', () => runAnalysis());
  $('#thr').addEventListener('input', () => runAnalysis());
  $('#datasample').addEventListener('click', () => { $('#datain').value = sampleData(); runAnalysis(); });
  $('#dataclear').addEventListener('click', () => { $('#datain').value = '# 平台  穴位X  穴位Y  Δθ(°)  dX  dY\n'; runAnalysis(); });

  // ---------- 機台參數 ----------
  const APPLIED = M0.P;
  let draft = Object.assign({}, APPLIED);
  function renderParamTable() {
    let grp = '', html = '<div class="tbl"><table class="ptbl"><thead><tr><th>項目</th><th>數值</th><th>單位</th><th>代碼</th></tr></thead><tbody>';
    CAL.PARAMS.forEach(([key, g, label, def, unit, desc]) => {
      if (g !== grp) { grp = g; html += `<tr class="grp"><td colspan="4">${g}</td></tr>`; }
      const changed = draft[key] !== APPLIED[key];
      html += `<tr class="${changed ? 'changed' : ''}"><td><label for="pp-${key}">${label}</label>${desc ? `<div class="note">${desc}</div>` : ''}</td><td><input type="number" step="any" id="pp-${key}" data-k="${key}" value="${draft[key]}"></td><td>${unit}</td><td class="note"><code>${key}</code></td></tr>`;
    });
    $('#ptable').innerHTML = html + '</tbody></table></div>';
    $$('#ptable input').forEach(el => el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v)) draft[el.dataset.k] = v; el.closest('tr').classList.toggle('changed', draft[el.dataset.k] !== APPLIED[el.dataset.k]); updParamMsg(); }));
  }
  function updParamMsg(extra) {
    const n = CAL.PARAMS.filter(p => draft[p[0]] !== APPLIED[p[0]]).length;
    $('#pmsg').textContent = (extra ? extra + '　' : '') + (n ? `${n} 項尚未套用` : '目前顯示的就是套用中的數值');
  }
  function paramChecks() {
    const out = [], add = (item, val, lvl, note) => out.push({ item, val, lvl, note });
    const cams = [[1, M0.top[0], 'top'], [2, M0.top[1], 'top'], [3, M0.bcam[3], 'bot'], [4, M0.bcam[4], 'bot']];
    cams.forEach(([id, c, kind]) => {
      const nm = (kind === 'top' ? '上' : '下') + c.name;
      const ar = c.mmpp / c.mmppY;
      add(`${nm} 像素當量`, `X ${(c.mmpp * 1000).toFixed(2)}、Y ${(c.mmppY * 1000).toFixed(2)} µm/px`, Math.abs(ar - 1) > 0.02 ? 'warn' : 'ok', Math.abs(ar - 1) > 0.02 ? 'X、Y 差超過 2%：確認視野與解析度有沒有填反' : `單次辨識雜訊 0.1 px ≈ ${(0.1 * c.mmpp * 1000).toFixed(1)} µm`);
      const dpx = M0.markDia / c.mmpp, lim = Math.min(c.w, c.h) / 4;
      add(`${nm} Mark 在影像中的直徑`, `${dpx.toFixed(0)} px`, dpx < 6 || dpx > lim ? 'bad' : (dpx < 15 ? 'warn' : 'ok'), dpx < 15 ? 'Mark 太小，辨識會不穩（建議 ≥ 15 px）' : (dpx > lim ? 'Mark 太大，九點走動時容易出畫面' : '15 px 以上，辨識穩定'));
      add(`${nm} 九點間距`, `${c.grid} mm`, 'ok', `視野 ${c.fov[0]}×${c.fov[1]} mm 的約 1/3`);
      if (kind === 'top') {
        const need = 2 * M0.tray.markHalf + M0.markDia + 2, needJ = 2 * M0.jig.half + M0.markDia + 2;
        add(`${nm} 能否一次拍到料的兩個 Mark`, `需要 ${need.toFixed(1)} mm／視野 ${c.fov[0]} mm`, need <= c.fov[0] ? 'ok' : 'bad', need <= c.fov[0] ? '含料放偏 ±1 mm 的餘量' : '兩個 Mark 無法同時入鏡：要分兩次拍（平台移動會帶入軸誤差）或換大視野');
        add(`${nm} 能否一次拍到治具的兩個 Mark`, `需要 ${needJ.toFixed(1)} mm`, needJ <= c.fov[0] ? 'ok' : 'bad', needJ <= c.fov[0] ? '' : '步驟 5 會做不起來：縮小治具 Mark 間距或換大視野');
        const ang = Math.SQRT2 * 0.1 * c.mmpp / (2 * M0.tray.markHalf);
        add(`${nm} 料角度量測解析`, `約 ${(ang * R2D * 3600).toFixed(1)}″`, 'ok', `0.1 px 雜訊、Mark 間距 ${2 * M0.tray.markHalf} mm`);
      } else {
        const margin = Math.min(...c.fov) / 2 - M0.markDia / 2;
        add(`${nm} 可容許的穴位位置誤差`, `±${margin.toFixed(2)} mm`, margin < 0.5 ? 'warn' : 'ok', margin < 0.5 ? '料盤位置稍微偏一點 Mark 就出畫面，需要先粗定位' : '料盤或穴位位置誤差小於這個值才拍得到');
        const ang = Math.SQRT2 * Math.hypot(0.1 * c.mmpp, 0.001) / (2 * M0.tray.markHalf);
        add(`${nm} 穴位角度量測解析`, `約 ${(ang * R2D * 3600).toFixed(1)}″`, 'ok', '左右兩次拍照，含 1 µm 平台重複性');
        const dd = Math.hypot(...c.dNom), clear = Math.hypot(M0.part.len, M0.part.wid) / 2 + 10;
        add(`${nm} 與吸盤上料的距離`, `${dd.toFixed(0)} mm`, dd < clear ? 'warn' : 'ok', dd < clear ? `小於料對角線一半＋10 mm（${clear.toFixed(0)} mm），DD 轉動時料可能撞到或擋住相機` : '');
      }
    });
    const sR = 0.1 / Math.sqrt(3) * M0.top[0].mmpp * Math.sqrt(2 / 8);
    add('DD 旋轉中心：校正片 Mark 半徑', `${M0.rcR} mm`, 'ok', `整圈在上相機視野內；預估圓心精度 1σ ≈ ${(sR * 1000).toFixed(1)} µm`);
    // 行程：所有動畫用到的平台位置
    [0, 1].forEach(k => {
      const xs = [], ys = [], hs = [];
      timelines.forEach(tl => tl.segs.forEach(sg => { [sg.from, sg.to].forEach(st => { xs.push(st.p[k].S[0]); ys.push(st.p[k].S[1]); hs.push(st.p[k].h); }); }));
      const st = M0.plat[k].stroke, sx = Math.max(...xs) - Math.min(...xs), sy = Math.max(...ys) - Math.min(...ys), hz = Math.max(...hs);
      add(`平台${k + 1} X 行程`, `需要 ${sx.toFixed(0)}／可動 ${st[0]} mm`, sx <= st[0] ? 'ok' : 'bad', sx <= st[0] ? '上相機站、基準 Mark、所有穴位都到得了' : '行程不夠：上相機站、基準 Mark 或最外側穴位到不了');
      add(`平台${k + 1} Y 行程`, `需要 ${sy.toFixed(0)}／可動 ${st[1]} mm`, sy <= st[1] ? 'ok' : 'bad', sy <= st[1] ? '' : '行程不夠');
      add(`平台${k + 1} Z 行程`, `需要 ${hz.toFixed(1)}／可動 ${st[2]} mm`, hz <= st[2] && hz > 0 ? 'ok' : 'bad', hz <= 0 ? '料或治具比吸盤到平台3 的距離還厚' : (hz <= st[2] ? '' : 'Z 升不到平台3'));
    });
    const dh = M0.hCal - M0.hPlace;
    add('治具厚度 vs 料厚', `差 ${Math.abs(dh).toFixed(2)} mm`, Math.abs(dh) > 0.05 ? 'warn' : 'ok', Math.abs(dh) > 0.05 ? `步驟 5 的 Z 行程和生產差 ${Math.abs(dh).toFixed(2)} mm，Z 軸若傾斜 1 mrad 會多 ${(Math.abs(dh)).toFixed(1)} µm 固定偏移；建議治具與料同厚` : '步驟 5 與生產用同一個 Z 行程');
    const px = M0.P.tray_pitch_x, py = M0.P.tray_pitch_y;
    add('料與穴位間距', `料 ${M0.part.len}×${M0.part.wid}／間距 ${px}×${py} mm`, M0.part.len + 2 <= px && M0.part.wid + 2 <= py ? 'ok' : 'bad', M0.part.len + 2 <= px && M0.part.wid + 2 <= py ? '' : '料比穴位間距大，相鄰的料會互相干涉');
    add('料的兩個 Mark 是否在料上', `間距 ${2 * M0.tray.markHalf}／料長 ${M0.part.len} mm`, 2 * M0.tray.markHalf + M0.markDia <= M0.part.len ? 'ok' : 'bad', '');
    return out;
  }
  function renderParams() {
    if (!$('#ptable').innerHTML) renderParamTable();
    updParamMsg();
    const ck = paramChecks(), lv = { ok: ['ok', '可以'], warn: ['warn', '注意'], bad: ['bad', '不行'] };
    const nb = ck.filter(c => c.lvl === 'bad').length, nw = ck.filter(c => c.lvl === 'warn').length;
    $('#pchecks').innerHTML = `<p><span class="pill ${nb ? 'bad' : 'ok'}">${nb ? nb + ' 項做不起來' : '沒有做不起來的項目'}</span>${nw ? `<span class="pill warnp">${nw} 項要注意</span>` : ''}</p>` + U.table(['', '項目', '數值', '說明'], ck.map(c => [`<span class="pill ${lv[c.lvl][0] === 'warn' ? 'warnp' : lv[c.lvl][0]}">${lv[c.lvl][1]}</span>`, c.item, c.val, c.note])) + '<p class="note">XY 行程的「需要」是用本頁假設的配置估算的（上相機站在平台原點前方 250 mm、料盤中心在後方 205 mm、6 欄 2 列）。實際配置不同時，請以機台座標重新確認。</p>';
  }
  function importText(txt, src) {
    const r = CAL.parseParamsCSV(txt, draft);
    if (!r.applied.length) { $('#pmsg').textContent = `${src}沒有讀到任何參數。第一欄要是代碼（例如 top1_fov_x），第四欄是數值`; return; }
    draft = r.params; renderParamTable();
    updParamMsg(`${src}讀到 ${r.applied.length} 項` + (r.bad.length ? `，${r.bad.length} 項數值看不懂（第 ${r.bad.map(b => b.line).join('、')} 行）` : '') + (r.unknown.length ? `，${r.unknown.length} 行代碼不認得已略過` : '') + '，按「套用並重新計算」生效');
  }
  $('#pfile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => importText(String(rd.result), `「${f.name}」`); rd.readAsText(f, 'utf-8'); e.target.value = '';
  });
  $('#pparse').addEventListener('click', () => importText($('#pcsv').value, '貼上的內容'));
  $('#ppaste').addEventListener('toggle', () => { if ($('#ppaste').open && !$('#pcsv').value.trim()) $('#pcsv').value = CAL.paramsToCSV(draft); });
  $('#pcopy').addEventListener('click', () => {
    const txt = CAL.paramsToCSV(draft);
    const fallback = () => { $('#ppaste').open = true; $('#pcsv').value = txt; $('#pcsv').select(); updParamMsg('已把 CSV 放進下方文字框並選取，請按 Ctrl+C 複製'); };
    try { navigator.clipboard.writeText(txt).then(() => updParamMsg('已複製 CSV，可以貼到 Excel 或記事本'), fallback); } catch (e) { fallback(); }
  });
  $('#preset').addEventListener('click', () => { draft = CAL.defaultParams(); renderParamTable(); updParamMsg('已填回預設值'); });
  $('#papply').addEventListener('click', () => {
    if (!CAL.saveParams(draft)) { updParamMsg('這個瀏覽器不允許儲存設定，無法套用'); return; }
    try { history.replaceState(null, '', '#params'); } catch (e) { /* 略過 */ }
    location.reload();
  });

  // ---------- 驗證 ----------
  function animChecks() {
    const T = [];
    timelines.forEach((tl, i) => {
      let n = 0, miss = 0;
      tl.segs.forEach(sg => { if (!sg.shot) return; sg.shot.cams.forEach(id => { n++; const img = sg.shot.img[id]; const cam = id <= 2 ? M0.top[id - 1] : M0.bcam[id]; if (!img.marks.some(mk => CAL.inImage(cam, mk.u))) miss++; }); });
      if (n) T.push({ name: `動畫「${STEPS[i].title}」：每次拍照目標都在相機視野內`, pass: miss === 0, detail: `${n} 次拍照，${miss} 次看不到目標` + (miss ? '（請看「機台參數」檢查表：視野可能裝不下兩個 Mark）' : '') });
      let maxH = 0; tl.segs.forEach(sg => sg.to.p.forEach(p => { maxH = Math.max(maxH, p.h); }));
      if (maxH > Math.max(M0.hPlace, M0.hCal) + 1e-9) T.push({ name: `動畫「${STEPS[i].title}」：Z 不超過放料行程`, pass: false, detail: maxH });
    });
    // 吸盤放料位置：Z 上升到 h 時，料上表面 = 平台3 下表面
    T.push({ name: '幾何：Z 上升行程 h 後，料的上表面剛好碰到平台3 下表面', pass: Math.abs(100 + M0.hPlace + M0.part.thick - M0.zPlate) < 1e-9 && Math.abs(100 + M0.hCal + M0.jig.thick - M0.zPlate) < 1e-9, detail: `料 h = ${M0.hPlace} mm、治具 h = ${M0.hCal} mm` });
    // 放料步驟：放下後料中心與穴位中心（設計）差 < 1 mm（動畫用的 S_p 來自真實計算）
    const tlc = timelines[STEPS.findIndex(s => s.id === 'cycle')];
    const last = tlc.segs[tlc.segs.length - 1].to.plate;
    const tgt = [CAL.trayW(M0, CAL.pocketT(M0, 0, 0)), CAL.trayW(M0, CAL.pocketT(M0, 5, 1))];
    const d = last.map((it, i) => V.len(V.sub(it.W, tgt[i])));
    T.push({ name: '動畫「放料一個循環」：料放下的位置對準穴位', pass: last.length === 2 && d.every(x => x < 0.02), detail: d.map(x => (x * 1000).toFixed(1) + ' µm').join('、') });
    return T;
  }
  let verified = null;
  function runVerify() {
    if (!verified) {
      const t0 = performance.now();
      verified = G.selfTest(CAL).concat(animChecks());
      verified.ms = performance.now() - t0;
    }
    const pass = verified.filter(t => t.pass).length;
    $('#verifysum').innerHTML = `<span class="pill ${pass === verified.length ? 'ok' : 'bad'}">${pass} / ${verified.length} 通過</span><span class="muted">在你的瀏覽器上剛剛重新計算（${verified.ms.toFixed(0)} ms）</span>`;
    $('#verifylist').innerHTML = U.table(['結果', '項目', '數值'], verified.map(t => [`<span class="pill ${t.pass ? 'ok' : 'bad'}">${t.pass ? '通過' : '失敗'}</span>`, t.name, t.detail]));
    document.body.dataset.verify = pass === verified.length ? 'pass' : 'fail';
  }
  G.runVerifyNow = () => { verified = null; runVerify(); return document.body.dataset.verify; };

  // ---------- 啟動 ----------
  $('#pbadge').hidden = !CAL.PARAMS.some(p => APPLIED[p[0]] !== p[3]);
  buildSimForm();
  let saved = 0; try { saved = +(localStorage.getItem('cal-step') || 0) || 0; } catch (e) { saved = 0; }
  selectStep(saved, !reduce);
  try {
    if (!G.THREE || !G.THREE.OrbitControls) throw new Error('three.js 沒有載入');
    S3 = createScene($('#three'), M0);
    new ResizeObserver(() => S3.resize()).observe($('#three'));
    if (G.matchMedia) G.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(() => { S3.retheme(); drawCams(); }, 50));
    new MutationObserver(() => setTimeout(() => { S3.retheme(); drawCams(); }, 50)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) {
    $('#three').innerHTML = `<p class="fallback">3D 畫面無法顯示（${e.message}）。步驟內容、相機畫面與計算仍可使用。</p>`;
  }
  showTab(location.hash.slice(1) || 'steps');
  requestAnimationFrame(loop);
  G.__app = { player, timelines, selectStep, stateAt, showTab };
})(window);
