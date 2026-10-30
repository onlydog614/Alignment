// 校正手順產生器：依目前的平台／相機配置，排出校正步驟與建議參數（不依賴 DOM）
(function (global) {
  'use strict';
  const VA = global.VA;

  const MOUNTS = {
    down: '固定・往下看平台',
    up: '固定・往上看（載台／工件背面）',
    gantry: '裝在線馬上（相機移動）'
  };

  function defaultProc() {
    return { mode: 'teach', zAxis: true, glass: true, maxCorrDeg: 1, noisePx: 0.15, gantryRepeatUm: 1, mounts: [] };
  }

  // 1–2–5 系列取整
  function nice(v) {
    if (!(v > 0)) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 5, 10].map(m => m * p).filter(s => s <= v).pop() || p;
  }

  // 圓擬合圓心的 1σ 不確定度（解析）：點在半徑 R 的圓上、角度 anglesDeg、每點量測雜訊 sigma
  function circleUncertainty(R, anglesDeg, sigma) {
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    anglesDeg.forEach(a => {
      const t = a * VA.D2R, row = [-Math.cos(t), -Math.sin(t), -1];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) J[i][j] += row[i] * row[j];
    });
    const inv = [0, 1, 2].map(k => VA.solve3(J, [0, 1, 2].map(i => (i === k ? 1 : 0))));
    if (!inv.every(Boolean)) return Infinity;
    return sigma * Math.hypot(Math.sqrt(Math.max(inv[0][0], 0)), Math.sqrt(Math.max(inv[1][1], 0)));
  }

  function camInfo(state, i) {
    const cam = state.cameras[i];
    const m = VA.cameraAffine(cam), info = VA.describeAffine(m);
    const mmpp = info.sx;
    const fovX = cam.width * mmpp, fovY = cam.height * mmpp;
    // 此相機看到的位置（平台座標）：優先用拍照點目標，否則用影像中心
    const shots = state.shots.filter(s => +s.cam === i && s.enabled);
    const pts = shots.length
      ? shots.map(s => VA.shotToStage(state, s, VA.pixToWorld(m, +s.tgt.u, +s.tgt.v)))
      : [VA.pixToWorld(m, cam.width / 2, cam.height / 2)];
    return { i, cam, m, mmpp, fovX, fovY, fovMin: Math.min(fovX, fovY), pts, tele: cam.optics && cam.optics.lens === 'telecentric' };
  }

  function buildProcedure(state) {
    const P = Object.assign(defaultProc(), state.proc || {});
    const gantry = state.platform.gantry && state.platform.gantry.enabled;
    const preset = state.platform.preset;
    const rc = VA.effectiveRc(state);
    const cams = state.cameras.map((c, i) => {
      const ci = camInfo(state, i);
      ci.mount = P.mounts[i] || (gantry && state.platform.gantry.mode === 'camera' ? 'gantry' : 'down');
      // 九點間距：約視野的 35%，取 1–2–5 系列
      ci.spacing = nice(ci.fovMin * 0.35);
      ci.resTolUm = 0.3 * ci.mmpp * 1000; // 九點殘差判定：0.3 px
      ci.R = Math.max(...ci.pts.map(p => Math.hypot(p.x - rc.x, p.y - rc.y)));
      return ci;
    });
    const finalStep = state.steps[Math.max(0, ...state.shots.filter(s => s.enabled).map(s => +s.step))] || state.steps[0];
    const tol = +finalStep.tol;
    const warnings = [];
    const steps = [];

    // ---- 0. Z 工作高度 ----
    if (P.zAxis) {
      const teles = cams.filter(c => c.tele), ento = cams.filter(c => !c.tele);
      steps.push({
        kind: 'focus', title: 'Z 工作高度與對焦', sub: '所有校正都在生產時的 Z 高度進行',
        bullets: [
          '放上標準品（或玻璃 Mark），Z 移到對焦位置，記錄 Z 值作為「工作高度」。',
          teles.length ? `遠心鏡頭（${teles.map(c => c.cam.name).join('、')}）景深 ${teles.map(c => c.cam.optics.dof + ' mm').join('、')}：先以 Z 掃描找最清晰位置，再取景深中央。` : null,
          ento.length ? `一般鏡頭（${ento.map(c => c.cam.name).join('、')}）倍率隨 Z 改變：${ento.map(c => `${c.cam.name} Z +1 mm 約 ${((VA.opticsSummary(c.cam.optics).zScale(1) - 1) * 100).toFixed(2)}%`).join('、')}，校正與生產必須同一高度。` : null,
          '工件厚度不同時，以「工件表面」對焦，不是平台表面。'
        ].filter(Boolean),
        outputs: ['工作高度 Z₀'],
        accept: ['同一位置重複對焦 5 次，Z 差異 < 景深的 1/4'],
        fig: { type: 'focus', tele: teles.length > 0 }
      });
    }

    // ---- 1. 各相機九點校正 ----
    cams.forEach(c => {
      const mover = c.mount === 'gantry' ? '線馬帶相機' : (c.mount === 'up' ? '平台帶玻璃 Mark' : '平台帶 Mark');
      steps.push({
        kind: 'nine', group: 'nine', cam: c.i,
        title: `${c.cam.name} 九點校正`, sub: '求 mm/pixel、相機角度',
        bullets: [
          `${c.mount === 'gantry' ? 'Mark 固定在平台上，線馬帶相機' : 'Mark 固定在平台上（相機不動），平台 XY'}走 3×3，間距 ${c.spacing} mm（約視野 ${c.fovX.toFixed(c.fovX < 10 ? 2 : 1)} × ${c.fovY.toFixed(c.fovY < 10 ? 2 : 1)} mm 的 35%）。`,
          c.mount === 'up' ? '往上看的相機：Mark 必須從下方可見（雙面可視玻璃 Mark），影像為鏡像，校正結果手性（行列式）會與往下看的相機相反。' : null,
          '開始前先單軸 +X 移動一小段，確認影像中 Mark 的移動方向，避免 X/Y 對調或正負號錯。',
          '每一點等平台停穩（整定時間）再拍；同一點可拍 3 次取平均。',
          gantry && c.mount !== 'gantry' ? '線馬保持在拍照位置不動，只用 XYθ 平台的 XY 走 9 點。' : null,
          '本工具「校正工具」頁可貼上 9 組「u v X Y」直接計算與檢查殘差。'
        ].filter(Boolean),
        records: [`${mover}的位置 (X, Y)`, 'Mark 像素座標 (u, v)'],
        outputs: ['mm/pixel（X、Y）', '相機與軸的夾角', '仿射參數 A–F'],
        accept: [`每點殘差 < 0.3 px（約 ${c.resTolUm.toFixed(c.resTolUm < 1 ? 2 : 1)} µm）`, 'X/Y 像素當量差 < 0.5%', '兩軸正交偏差 < 0.1°'],
        fig: { type: 'nine', spacing: c.spacing, fovX: c.fovX, fovY: c.fovY, mover }
      });
    });

    // ---- 2. 旋轉中心 ----
    // 每台可用的相機（往下看平台或在線馬上）各估一個方案，選圓心精度最好的
    const plan = c => {
      const sigma = (+P.noisePx || 0.1) * c.mmpp;
      const R = Math.max(c.R, 1);
      const alphaFov = 0.35 * c.fovMin / R * VA.R2D;
      const p = { c, R, alphaFov, sigmaEff: sigma, Rnear: null };
      if (alphaFov >= 1) { p.method = 'direct'; p.alpha = Math.min(3, alphaFov); }
      else if (gantry) { p.method = 'follow'; p.alpha = 3; p.sigmaEff = Math.hypot(sigma, (+P.gantryRepeatUm || 0) / 1000); }
      else { p.method = 'near'; p.alpha = 3; p.Rnear = 0.35 * c.fovMin / (3 * VA.D2R); }
      p.Ruse = p.method === 'near' ? p.Rnear : R;
      p.angles = [-1, -0.5, 0, 0.5, 1].map(f => f * p.alpha);
      p.sd = VA.rotCenterUncertainty(p.angles, p.sigmaEff);
      p.sdCircle = circleUncertainty(p.Ruse, p.angles, p.sigmaEff);
      return p;
    };
    const rcCands = cams.filter(c => c.mount !== 'up');
    const plans = (rcCands.length ? rcCands : cams).map(plan).sort((a, b) => a.sd - b.sd);
    const best = plans[0], alt = plans[1];
    const rcCam = best.c, R = best.R, alphaFov = best.alphaFov, method = best.method, alpha = best.alpha;
    const Rnear = best.Rnear, Ruse = best.Ruse, angles = best.angles, sd = best.sd;
    const required = tol / ((+P.maxCorrDeg || 1) * VA.D2R);
    const rcOk = sd * 3 <= required;
    const rcBullets = [
      `使用 ${rcCam.cam.name}${plans.length > 1 ? '（各相機中預估精度最好）' : ''}。XY 不動，只轉 θ：${angles.map(a => (a > 0 ? '+' : '') + a.toFixed(alpha < 1 ? 3 : 2) + '°').join('、')}，共 5 點。`,
      method === 'direct' ? `Mark 距旋轉中心約 ${R.toFixed(1)} mm，轉 ±${alpha.toFixed(2)}° 時 Mark 移動約 ${(R * alpha * VA.D2R).toFixed(2)} mm，仍在視野內。` : null,
      method === 'follow' ? `此相機視野只有 ${rcCam.fovMin.toFixed(2)} mm，Mark 距旋轉中心約 ${R.toFixed(1)} mm，直接轉只能轉 ±${alphaFov.toFixed(3)}°（太小）。改為每轉一個角度，用線馬把 Mark 追回視野中心再拍，並記錄線馬位置（校正工具輸入格式：u v θ 線馬X 線馬Y）。` : null,
      '計算時使用「已知指令角度」的擬合（校正工具預設）：精度約 雜訊 ÷ 角度範圍，與半徑無關；只做幾何圓擬合在短圓弧時誤差會大很多' + (Number.isFinite(best.sdCircle) ? `（本例約 ${(best.sdCircle * 1000).toFixed(0)} µm）` : '') + '。',
      method === 'near' ? `此相機視野只有 ${rcCam.fovMin.toFixed(2)} mm，直接轉角度太小。請把 Mark 放在距旋轉中心約 ${Rnear.toFixed(1)} mm 以內的位置（或改用較大視野的相機），再轉 ±3°。` : null,
      preset === 'XYT' ? 'XYθ 平台：旋轉中心隨 XY 軸移動，請同時記錄當下 XY 軸位置（工具會換算回 XY 原點時的旋轉中心）。' : null,
      ['XXY', 'XYY', 'UVW3', 'UVW4'].includes(preset) ? '此平台以多支直線軸差動產生旋轉：量到的旋轉中心應接近機構圖上的位置，差很多時檢查軸設定中的致動點座標與方向。' : null,
      alt ? `比較：改用 ${alt.c.cam.name}（${({ direct: '直接轉', follow: '線馬跟隨', near: 'Mark 靠近中心' })[alt.method]}）預估精度約 ${(alt.sd * 1000).toFixed(1)} µm。` : null,
      '角度要對稱、單一方向逼近（例如都從負方向轉過去）以消除背隙。'
    ].filter(Boolean);
    steps.push({
      kind: 'rc', title: '旋轉中心 R', sub: `${rcCam.cam.name} 拍，平台轉 −α / 0 / +α`,
      bullets: rcBullets,
      records: ['θ 指令角度', 'Mark 像素座標 (u, v)', method === 'follow' ? '線馬位置' : null, preset === 'XYT' ? 'XY 軸位置' : null].filter(Boolean),
      outputs: ['旋轉中心 R (X, Y)', '量測角度 / 指令角度（θ 比例）'],
      accept: [
        `預估圓心精度 1σ ≈ ${(sd * 1000).toFixed(sd < 0.01 ? 2 : 1)} µm；需求 ≈ ${required.toFixed(3)} mm（公差 ${tol} mm ÷ 單次最大修正 ${P.maxCorrDeg}°）${rcOk ? ' → 足夠' : ' → 不足，請加大角度或改方法'}`,
        '圓擬合殘差 < 0.5 px',
        '量測角度 / 指令角度 在 1 ± 0.5% 內'
      ],
      fig: { type: 'rc', alpha, R: Ruse, method },
      calc: { cam: rcCam.i, R, alphaFov, alpha, method, sd, required, ok: rcOk }
    });
    if (!rcOk) warnings.push('旋轉中心的預估精度不足以達到公差，請參考「旋轉中心」步驟的建議。');

    // ---- 3. 相機連結 ----
    const ups = cams.filter(c => c.mount === 'up'), downs = cams.filter(c => c.mount !== 'up');
    if (cams.length >= 2) {
      if (ups.length && downs.length) {
        const A = downs[0], B = ups[0];
        steps.push({
          kind: 'link', title: `連結 ${A.cam.name} 與 ${B.cam.name}`, sub: '求 B_off（最關鍵）',
          bullets: [
            P.glass ? '使用雙面可視玻璃 Mark（上下都看得到同一個點）。' : '需要一個上下都可視的基準（雙面可視玻璃 Mark 或穿孔治具）；沒有時無法直接連結上下相機。',
            `步驟 A：${A.cam.name} 往下量玻璃 Mark，得到 Mark 相對平台的位置 P_A。`,
            `步驟 B：平台${P.zAxis ? '（Z 上升）' : ''}移到 ${B.cam.name} 上方，${B.cam.name} 往上量同一點，得到讀值 P_B。`,
            '兩次讀值相減：B_off = 已知位置 − P_B − 影像偏移。',
            '玻璃 Mark 轉 180° 再做一次取平均，可消除 Mark 本身的上下偏心。'
          ],
          records: ['平台位置（兩次）', `${A.cam.name}、${B.cam.name} 像素座標`],
          outputs: ['B_off（兩相機座標系的偏移）'],
          accept: ['重複 5 次，B_off 變異 < 公差的 1/5'],
          fig: { type: 'linkUpDown', a: A.cam.name, b: B.cam.name, z: P.zAxis }
        });
        if (!P.glass) warnings.push('上下視連結需要雙面可視的基準 Mark。');
      } else if (gantry) {
        steps.push({
          kind: 'link', title: '連結各相機（線馬）', sub: '同一個 Mark 依序送到每台相機',
          bullets: [
            '平台上固定一個 Mark，線馬依序把它送到每台相機視野中心，記錄線馬位置與像素座標。',
            '各相機中心在平台座標中的位置 = 線馬位置 ＋ 像素換算；之後拍照點的「線馬 X/Y」以此為基準。',
            `粗／精兩段時：先用大視野相機（${cams.slice().sort((a, b) => b.fovMin - a.fovMin)[0].cam.name}）找到 Mark，再算出精對位相機需要的線馬位置。`,
            '使用光學尺回授的實際位置，不要用指令位置（模擬顯示線馬重複定位是精對位最大的誤差來源）。'
          ],
          records: ['線馬實際位置（每台相機）', '像素座標'],
          outputs: ['各相機中心的平台座標（相機間偏移）'],
          accept: ['重複 5 次，偏移變異 < 公差的 1/5'],
          fig: { type: 'linkGantry', cams: cams.map(c => ({ name: c.cam.name, fovMin: c.fovMin })) }
        });
      } else {
        steps.push({
          kind: 'link', title: '連結各相機', sub: '讓所有相機在同一個平台座標系',
          bullets: [
            '方法 1（行程夠）：同一個 Mark 用平台 XY 依序移到每台相機下，記錄平台位置；相機間距 = 平台位置差 ＋ 像素換算。',
            '方法 2（相機間距超過行程）：使用已知間距的精密玻璃尺／治具，同時被各相機看到，以治具的已知尺寸連結。',
            '九點校正若都以同一個平台座標記錄（同一 Mark、絕對位置），此步驟可直接驗證，不必另外計算。'
          ],
          records: ['平台位置', '各相機像素座標'],
          outputs: ['各相機在平台座標中的位置'],
          accept: ['重複 5 次變異 < 公差的 1/5', '以治具驗證時，量到的 Mark 間距與已知值差 < 公差的 1/5'],
          fig: { type: 'linkMulti', cams: cams.map(c => c.cam.name) }
        });
      }
    }

    // ---- 4. 教導 ----
    if (P.mode === 'teach') {
      steps.push({
        kind: 'teach', title: '標準品教導', sub: '登錄每個拍照點的目標像素',
        bullets: [
          '把標準品放在正確位置（可用量測儀確認），依流程拍每個拍照點，登錄為目標（本工具「目前→目標」）。',
          '多步驟時每一步都要教導；精對位的目標通常設在影像中心附近。',
          '教導完不要再動相機與 Z 高度；任何一個改了都要重新教導。'
        ],
        records: ['各拍照點目標像素 (u, v, 角度)'],
        outputs: ['目標位置'],
        accept: ['教導後立即重拍，誤差 < 公差的 1/5'],
        fig: { type: 'teach' }
      });
    }

    // ---- 5. 實放驗證 ----
    steps.push({
      kind: 'verify', title: '實放驗證', sub: '近端、遠端格子量偏移',
      bullets: [
        '放上實際工件，故意偏移（近端、遠端、正負角度）各試數次，執行完整對位。',
        '對位後以獨立量測（或高倍相機）量各 Mark 的殘差，比較近端與遠端：遠端偏移較大通常是旋轉中心或角度問題。',
        '同一工件重複上下料 10 次，統計 3σ。',
        '超出規格時回到「相機連結」（再往前檢查旋轉中心）；本工具「情境模擬」可先推估各誤差來源的影響。'
      ],
      records: ['每次對位後的殘差（各 Mark）'],
      outputs: ['重複精度 3σ', '近端／遠端偏移'],
      accept: [`所有 Mark 殘差 ≤ ${tol} mm`, `3σ ≤ ${(tol * 0.6).toFixed(4)} mm（保留 40% 餘裕）`],
      fig: { type: 'verify' }
    });

    return { P, cams, steps, warnings, tol, rc: steps.find(s => s.kind === 'rc').calc };
  }

  global.VA = Object.assign(global.VA || {}, { MOUNTS, defaultProc, buildProcedure, circleUncertainty, niceStep: nice });
})(typeof window !== 'undefined' ? window : globalThis);
