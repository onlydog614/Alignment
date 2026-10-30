// 光學計算：感光元件 × 鏡頭 → 像素當量、視野、Z 偏移造成的倍率變化
(function (global) {
  'use strict';

  // 規格請以相機型錄為準；可在介面上選「自訂」自行輸入
  const SENSORS = {
    'FH-5M': { label: 'Omron FH 500 萬像素（FH-SC05R / SM05R 類）', width: 2448, height: 2044, pixel: 3.45 },
    CUSTOM: { label: '自訂', width: 2448, height: 2048, pixel: 3.45 }
  };

  // optics: { sensor, width, height, pixel(µm), lens:'entocentric'|'telecentric', f(mm), wd(mm), mag, dof(mm) }
  function magnification(o) {
    if (o.lens === 'telecentric') return +o.mag;
    // 薄透鏡近似：m = f / (WD − f)，WD 視為物距
    const f = +o.f, wd = +o.wd;
    return wd > f ? f / (wd - f) : NaN;
  }

  function opticsSummary(o) {
    const m = magnification(o);
    const mmpp = (+o.pixel / 1000) / m;
    return {
      mag: m,
      mmpp,
      fovX: mmpp * o.width,
      fovY: mmpp * o.height,
      // 一般鏡頭：物距改變 dz（平台上升為正，物體靠近鏡頭）時的像素當量比例
      zScale: dz => (o.lens === 'telecentric' ? 1 : (+o.wd - dz - +o.f) / (+o.wd - +o.f)),
      dof: +o.dof || NaN
    };
  }

  global.VA = Object.assign(global.VA || {}, { SENSORS, magnification, opticsSummary });
})(typeof window !== 'undefined' ? window : globalThis);
