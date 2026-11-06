// ===== 版面：電腦版／手機版切換、表格手機排法、更新紀錄 =====
(function (G) {
  'use strict';
  const D = document, H = D.documentElement, $ = s => D.querySelector(s), $$ = s => [...D.querySelectorAll(s)];
  const KEY = 'cal-layout', DESK_W = 1240, AUTO_W = 900;

  // 每次更新的簡要（最新的放最上面；時間為台灣時間）
  const CHANGELOG = [
    ['2026-11-06 10:30', '新增「機構調校」分頁：整合千分表架設示範（X 軸偏擺與直線度、Y 滑座重心耦合、導軌調整），並新增 7 項視覺機構檢查（相機支架穩定時間、相機與 X 軸夾角、光軸垂直度、對焦與景深、下相機沿 X 偏差、DD 轉動偏擺、重複定位與反向間隙），每項有 3D 動畫、相機畫面、量測曲線、判定與處理方式，另附症狀對照表。'],
    ['2026-11-06 07:50', '切換鈕移到標題右邊：放在標題旁的空白處，不再蓋住分頁名稱；分頁列整條都能點、可左右滑。'],
    ['2026-11-06 07:30', '版面切換鈕整併成一顆：固定在分頁列最右邊（捲動時也看得到），手機版顯示「電腦版」、電腦版顯示「手機版」，點一下切換並記住；移除頁首與右下角重複的切換鈕，不再擋到內容。'],
    ['2026-11-06 01:30', '手機版排版：分頁列固定在上方可左右滑、步驟改成橫向選單、相機畫面四格並排、上一步／下一步固定在底部、表格改成一列一張卡、輸入框放大（iPhone 不會自動放大畫面）。加「電腦版／手機版」切換鈕，會記住你的選擇；網頁內加這份更新紀錄。'],
    ['2026-11-05 22:55', '相機預設改為 5M＋3 倍鏡（2448×2040 px、視野 2.8152×2.346 mm）；Mark 直徑預設 0.3 mm。視野小時設計位置不一定看得到 Mark：先螺旋搜尋、找到後對中再拍（九點、上下連結、SPB Mark、四角都套用）；參數檢查會算出手動放料最壞每片要多拍幾張。'],
    ['2026-11-05 12:38', '「旋轉中心計算」改成表格逐點手填，可匯入 CSV、下載／複製 CSV，也能從 Excel 複製多列直接貼上。'],
    ['2026-11-05 11:33', '新增「旋轉中心計算」分頁：輸入多點機械座標（可附 DD 角度），最小二乘圓擬合算圓心、半徑、殘差、DD 角度比例與方向，附 2D 圖與 3D 動畫。'],
    ['2026-11-05 08:32', 'DD 旋轉中心校正改成 XY 跟隨：每轉一格 XY 把 Mark 移回上相機畫面，不會轉出視野；可設定 Mark 半徑、可轉角度範圍與點數。'],
    ['2026-11-05 08:14', '實放驗證：每片放料前都重新用上相機拍四角對位。'],
    ['2026-11-05 07:58', '生產流程改為人工放料、每片重拍上相機；SPB Mark A–D 只量第一次。'],
    ['2026-11-05 07:47', '料盤改為四顆 SPB Mark：左平台看 A、B，右平台看 C、D；料盤配置圖改成字母圓圈。'],
    ['2026-11-05 03:01', '平台3 料盤改為 2×12 穴：左平台放 1–6 欄、右平台放 7–12 欄，交界兩側標成誤差疊加區。'],
    ['2026-11-05 02:45', '上相機逐顆拍料的四角 Mark（平台移動）做四點擬合；下相機拍兩邊 Mark。'],
    ['2026-11-05 02:20', '支援長方形料（長邊方向、對角 Mark），並重新檢查你填的參數。'],
    ['2026-11-05 02:01', '「機台參數」分頁：可手動填或匯入 CSV（相機視野、XY 行程、Mark 尺寸、治具與產品尺寸），自動檢查做不做得起來。'],
    ['2026-11-05 01:55', '改成每個平台一上一下兩台相機（上相機1／2 固定、下相機3／4 隨平台）。'],
    ['2026-11-05 01:23', '第一版：雙平台放料校正手順，含 3D 動作、四台相機畫面、公式、判定標準、偏移排查、實測資料分析與自我驗證。']
  ];

  let pref = H.getAttribute('data-layout-pref') || 'auto';
  function eff() { return pref === 'auto' ? ((G.innerWidth || H.clientWidth) < AUTO_W ? 'mobile' : 'desktop') : pref; }
  function apply() {
    const e = eff(), w = G.innerWidth || H.clientWidth, wrap = $('.wrap');
    H.setAttribute('data-layout', e); H.setAttribute('data-layout-pref', pref);
    H.toggleAttribute('data-wide', e === 'mobile' && w > 600);
    // 強制電腦版但螢幕比電腦版窄：整頁照 1240 px 排，再縮小到螢幕寬
    const zoom = e === 'desktop' && w < DESK_W - 20;
    H.toggleAttribute('data-zoomed', zoom);
    if (wrap) wrap.style.zoom = zoom ? String(w / DESK_W) : '';
    H.style.setProperty('--unzoom', zoom ? String(DESK_W / w) : '1');
    const lb = $('#laybtn'); if (lb) { const to = e === 'mobile' ? '電腦版' : '手機版'; lb.querySelector('.lb-t').textContent = to; lb.setAttribute('aria-label', '切換成' + to); lb.dataset.lay = e === 'mobile' ? 'desktop' : 'mobile'; }
    G.dispatchEvent(new Event('resize'));
  }
  function setPref(p) { pref = p; try { localStorage.setItem(KEY, p); } catch (e) { /* 無儲存空間 */ } apply(); }
  const lbtn = $('#laybtn'); if (lbtn) lbtn.addEventListener('click', () => setPref(lbtn.dataset.lay));
  let lastW = G.innerWidth;
  G.addEventListener('resize', () => { if (G.innerWidth !== lastW) { lastW = G.innerWidth; apply(); } });

  // 手機版：頁首說明點一下展開
  const hp = $('header.top p'); if (hp) hp.addEventListener('click', () => hp.classList.toggle('open'));

  // 表格：加 data-label，手機版每列疊成一張卡（自訂排法的表格除外）
  const SKIP = ['ptbl', 'rctbl', 'rcsum', 'vtbl'];
  function label() {
    $$('.view table').forEach(t => {
      if (SKIP.some(c => t.classList.contains(c))) return;
      const hs = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
      if (hs.length < 3 || t.classList.contains('stk') || t.classList.contains('cmp')) return;
      // 文字多的表格每列疊成卡；短數字為主、列數多的表格保留表格（可左右滑）
      const cells = [...t.querySelectorAll('tbody td')], longest = Math.max(0, ...cells.map(td => td.textContent.trim().length));
      const nRows = t.querySelectorAll('tbody tr').length;
      t.classList.add(longest <= 22 && nRows > 3 ? 'cmp' : 'stk');
      if (t.classList.contains('cmp')) return;
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', hs[i] || ''); }));
    });
  }
  let pend = false;
  new MutationObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; label(); }); }).observe($('.wrap'), { childList: true, subtree: true });

  // 更新紀錄
  const cl = $('#changelog');
  if (cl) {
    const [t0, s0] = CHANGELOG[0];
    cl.innerHTML = `<summary><b>最新更新</b><time>${t0.slice(5)}</time><span>${s0.split('：')[0]}</span><span class="more">全部更新紀錄（${CHANGELOG.length}）</span></summary><ol>${CHANGELOG.map(([t, x]) => `<li><time>${t.slice(5)}</time><span>${x}</span></li>`).join('')}</ol>`;
  }

  apply(); label();
  G.LAYOUT = { apply, setPref, eff, CHANGELOG, label };
})(typeof window !== 'undefined' ? window : globalThis);
