// ===== 機構調校分頁：子分頁切換（視覺機構檢查／千分錶三個測試） =====
(function (G) {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const SUBS = ['vis', 'dial1', 'dial2', 'dial3'];
  let cur = 'vis', bound = false;
  function sub(id, scroll) {
    if (!SUBS.includes(id)) id = 'vis';
    cur = id;
    $$('#mksub [data-sub]').forEach(b => b.setAttribute('aria-selected', b.dataset.sub === id ? 'true' : 'false'));
    $('#vk').hidden = id !== 'vis'; $('#mk-dial').hidden = id === 'vis';
    if (id === 'vis') { if (G.VISCHK) G.VISCHK.show(); } else if (G.MECHDIAL) G.MECHDIAL.tab(+id.slice(4));
    if (scroll !== false) { const s = $('#mksub'); if (s && s.getBoundingClientRect().top < 0 && s.scrollIntoView) s.scrollIntoView({ block: 'start' }); }
  }
  function show() {
    if (!bound) { bound = true; $$('#mksub [data-sub]').forEach(b => b.addEventListener('click', () => sub(b.dataset.sub))); }
    sub(cur, false);
  }
  G.MECH = { show, sub, cur: () => cur };
})(typeof window !== 'undefined' ? window : globalThis);
