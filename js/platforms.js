// 平台種類預設。軸位置 (px, py) 為致動點相對「旋轉中心」的座標（mm）。
// dir：軸正方向在世界座標的角度（0 = +X，90 = +Y）。sign：方向反相用（+1 / −1）。
(function (global) {
  'use strict';

  const L = 100; // 預設致動點距離（mm），載入後可於表格修改

  const PLATFORMS = {
    XYT: {
      label: 'XYθ（θ 在 XY 之上）',
      note: '旋轉中心隨 XY 移動。輸入的旋轉中心必須是「拍照當下」的旋轉中心世界座標。',
      axes: [
        { name: 'X', kind: 'linear', px: 0, py: 0, dir: 0, sign: 1 },
        { name: 'Y', kind: 'linear', px: 0, py: 0, dir: 90, sign: 1 },
        { name: 'θ', kind: 'rotary', px: 0, py: 0, dir: 0, sign: 1 }
      ]
    },
    TXY: {
      label: 'θXY（θ 在 XY 之下）',
      note: '旋轉中心固定，XY 隨 θ 一起轉動，XY 指令以旋轉後的座標系計算（假設拍照時 θ 軸位於校正時的角度）。',
      axes: [
        { name: 'θ', kind: 'rotary', px: 0, py: 0, dir: 0, sign: 1 },
        { name: 'X', kind: 'linearRot', px: 0, py: 0, dir: 0, sign: 1 },
        { name: 'Y', kind: 'linearRot', px: 0, py: 0, dir: 90, sign: 1 }
      ]
    },
    XXY: {
      label: 'XXY（X1, X2, Y）',
      note: '兩支 X 向致動器分別位於旋轉中心上下，以差動產生旋轉。',
      axes: [
        { name: 'X1', kind: 'linear', px: 0, py: L, dir: 0, sign: 1 },
        { name: 'X2', kind: 'linear', px: 0, py: -L, dir: 0, sign: 1 },
        { name: 'Y', kind: 'linear', px: L, py: 0, dir: 90, sign: 1 }
      ]
    },
    XYY: {
      label: 'XYY（X, Y1, Y2）',
      note: '兩支 Y 向致動器分別位於旋轉中心左右。',
      axes: [
        { name: 'X', kind: 'linear', px: 0, py: L, dir: 0, sign: 1 },
        { name: 'Y1', kind: 'linear', px: -L, py: 0, dir: 90, sign: 1 },
        { name: 'Y2', kind: 'linear', px: L, py: 0, dir: 90, sign: 1 }
      ]
    },
    UVW3: {
      label: 'UVW 三軸（U, V, W）',
      note: '常見配置：U、V 為 X 向，W 為 Y 向，致動點位於平台角落。實際位置請依機構圖修改。',
      axes: [
        { name: 'U', kind: 'linear', px: -L, py: L, dir: 0, sign: 1 },
        { name: 'V', kind: 'linear', px: L, py: -L, dir: 0, sign: 1 },
        { name: 'W', kind: 'linear', px: -L, py: -L, dir: 90, sign: 1 }
      ]
    },
    UVW4: {
      label: 'UVW 四軸（X1, X2, Y1, Y2）',
      note: '四角各一支致動器，對角兩軸同向。',
      axes: [
        { name: 'X1', kind: 'linear', px: -L, py: L, dir: 0, sign: 1 },
        { name: 'X2', kind: 'linear', px: L, py: -L, dir: 0, sign: 1 },
        { name: 'Y1', kind: 'linear', px: -L, py: -L, dir: 90, sign: 1 },
        { name: 'Y2', kind: 'linear', px: L, py: L, dir: 90, sign: 1 }
      ]
    },
    CUSTOM: {
      label: '自訂',
      note: '自行新增軸並設定致動點、方向與類型。',
      axes: []
    }
  };

  global.VA = Object.assign(global.VA || {}, { PLATFORMS });
})(typeof window !== 'undefined' ? window : globalThis);
