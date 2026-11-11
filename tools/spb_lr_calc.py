"""SPB 左右兩側 tile mark：分開計算與整合計算比較。
左側 Mark 1~6（機台 X 負），右側 Mark 7~12（機台 X 正），兩側欄號都往 -X 增加。
玻璃格點 A 組對應左側、B 組對應右側（alignment_data.csv）。"""
import csv, json, math, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SIDES = {
    "左側": {"cols": (1, 6), "grid": "A", "m": {
        (1, 1): (-43.6522, 1004.1377), (1, 6): (-718.6154, 1004.9193),
        (2, 1): (-43.5210, 1148.2364), (2, 6): (-718.4602, 1149.0500)}},
    "右側": {"cols": (7, 12), "grid": "B", "m": {
        (1, 7): (736.1080, 1004.2420), (1, 12): (60.9690, 1005.1100),
        (2, 7): (736.3030, 1148.3460), (2, 12): (61.0828, 1149.2000)}},
}
D = math.degrees

def ang_x(v):  # 向量對 +X 的角度（v 指向 +X）
    return math.atan2(v[1], v[0])

def ang_y(v):  # 向量對 +Y 的角度（v 指向 +Y），逆時針為正
    return math.atan2(-v[0], v[1])

def side_calc(s):
    c0, c1 = s["cols"]; n = c1 - c0
    m = {k: np.array(v) for k, v in s["m"].items()}
    a, b, c, d = m[(1, c0)], m[(1, c1)], m[(2, c0)], m[(2, c1)]
    rows = {"列1": a - b, "列2": c - d}          # c0 在 +X 側
    cols = {f"欄{c0}": c - a, f"欄{c1}": d - b}
    thx = np.mean([ang_x(v) for v in rows.values()]); thy = np.mean([ang_y(v) for v in cols.values()])
    px = np.mean([np.hypot(*v) for v in rows.values()]) / n
    py = np.mean([np.hypot(*v) for v in cols.values()])
    top = [a + (b - a) * i / n for i in range(n + 1)]; bot = [c + (d - c) * i / n for i in range(n + 1)]
    ctr = [((t + u) / 2, ang_y(u - t)) for t, u in zip(top, bot)]
    return dict(m=m, rows=rows, cols=cols, thx=thx, thy=thy, px=px, py=py, top=top, bot=bot, ctr=ctr,
                center=(a + b + c + d) / 4, edge_th={**{k: ang_x(v) for k, v in rows.items()}, **{k: ang_y(v) for k, v in cols.items()}})

def model(p, keys):
    """整體剛體模型：θ, tx, ty, px, py, G。左側欄 c 在 u=-(c-1)px；右側欄 c 在 u=G+(12-c)px。"""
    th, tx, ty, px, py, G = p[:6]
    H = p[6] if len(p) > 6 else 0.0     # 右側相對左側的 Y 位移（台階）
    out = []
    for r, c in keys:
        u = -(c - 1) * px if c <= 6 else G + (12 - c) * px
        v = (r - 1) * py + (H if c > 6 else 0.0)
        out.append([tx + math.cos(th) * u - math.sin(th) * v, ty + math.sin(th) * u + math.cos(th) * v])
    return np.array(out)

def fit(keys, pts, p0, free):
    p = np.array(p0, float)
    for _ in range(50):
        r = (model(p, keys) - pts).ravel()
        J = np.zeros((r.size, len(free)))
        for j, i in enumerate(free):
            dp = p.copy(); dp[i] += 1e-7
            J[:, j] = ((model(dp, keys) - pts).ravel() - r) / 1e-7
        step = np.linalg.lstsq(J, -r, rcond=None)[0]
        p[free] += step
        if np.abs(step).max() < 1e-12: break
    return p, model(p, keys) - pts

def grid_axes(group):
    """玻璃格點：回傳在機台座標中 +X 方向角、+Y 方向角、X/Y 比例（量測/名義）。"""
    S, N = [], []
    with open(os.path.join(HERE, "..", "alignment_data.csv"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["組別"] == group:
                N.append([float(r["名義X"]), float(r["名義Y"]), 1]); S.append([float(r["量測X"]), float(r["量測Y"])])
    M = np.linalg.lstsq(np.array(N), np.array(S), rcond=None)[0]   # machine = [x y 1] @ M
    ex, ey = M[0], M[1]
    sign = 1 if ex[0] > 0 else -1          # B 組名義 X 與機台 X 反向
    return dict(thx=ang_x(sign * ex), thy=ang_y(ey), sx=np.hypot(*ex), sy=np.hypot(*ey), mirror=sign < 0)

def main():
    L = ["# SPB 左右兩側：分開計算 vs 整合計算", "",
         "機台座標 (mm)，θ 逆時針為正。左側欄 1→6、右側欄 7→12 都往 -X 方向排。", ""]
    res = {k: side_calc(s) for k, s in SIDES.items()}
    grids = {k: grid_axes(SIDES[k]["grid"]) for k in SIDES}

    # ---- 分開計算
    L += ["## 一、分開計算", "", "| 項目 | 左側 (1~6) | 右側 (7~12) | 右 − 左 |", "|---|---|---|---|"]
    def row(name, f, fmt):
        a, b = f(res["左側"]), f(res["右側"]); L.append(f"| {name} | {fmt(a)} | {fmt(b)} | {fmt(b - a)} |")
    fd = lambda v: f"{D(v):+.5f}°"; f4 = lambda v: f"{v:.4f}"
    row("θx 列1", lambda r: r["edge_th"]["列1"], fd); row("θx 列2", lambda r: r["edge_th"]["列2"], fd)
    row("θx 平均", lambda r: r["thx"], fd); row("θy 平均", lambda r: r["thy"], fd)
    row("直交誤差 θx−θy", lambda r: r["thx"] - r["thy"], fd)
    row("X 間距", lambda r: r["px"], f4); row("Y 間距", lambda r: r["py"], f4)
    L.append(f"| 側中心 | {res['左側']['center'][0]:.4f}, {res['左側']['center'][1]:.4f} | {res['右側']['center'][0]:.4f}, {res['右側']['center'][1]:.4f} | |")
    L.append(f"| 欄{SIDES['左側']['cols'][1]}/欄{SIDES['左側']['cols'][0]}（左）、欄12/欄7（右）θy | "
             f"{D(res['左側']['edge_th']['欄6']):+.5f}° / {D(res['左側']['edge_th']['欄1']):+.5f}° | {D(res['右側']['edge_th']['欄12']):+.5f}° / {D(res['右側']['edge_th']['欄7']):+.5f}° | |")
    L.append("")

    # 各側剛體擬合（G 不用）
    side_fit = {}
    for k, s in SIDES.items():
        keys = list(s["m"]); pts = np.array([s["m"][q] for q in keys]); r = res[k]
        if k == "左側":
            p0 = [r["thx"], *s["m"][(1, 1)], r["px"], r["py"], 0]
        else:  # 右側以 12 欄為 u=G，令 G=0 讓 tx 落在欄 12
            p0 = [r["thx"], *s["m"][(1, 12)], r["px"], r["py"], 0]
        p, e = fit(keys, pts, p0, [0, 1, 2])
        side_fit[k] = (p, e, keys)
    L += ["### 各側剛體擬合（固定該側 pitch）", "", "| 側 | θ | 殘差 RMS (µm) | 最大殘差 (µm) |", "|---|---|---|---|"]
    for k, (p, e, _) in side_fit.items():
        L.append(f"| {k} | {D(p[0]):+.5f}° | {np.sqrt((e**2).sum(1).mean())*1000:.1f} | {np.hypot(*e.T).max()*1000:.1f} |")
    L.append("")

    # ---- 整合計算（同一機台座標、視為一整片剛體）
    keys = list(SIDES["左側"]["m"]) + list(SIDES["右側"]["m"])
    pts = np.array([{**SIDES["左側"]["m"], **SIDES["右側"]["m"]}[q] for q in keys])
    rl, rr = res["左側"], res["右側"]
    G0 = SIDES["右側"]["m"][(1, 12)][0] - SIDES["左側"]["m"][(1, 1)][0]
    p, e = fit(keys, pts, [rl["thx"], *SIDES["左側"]["m"][(1, 1)], (rl["px"] + rr["px"]) / 2, (rl["py"] + rr["py"]) / 2, G0], [0, 1, 2, 3, 4, 5])
    L += ["## 二、整合計算（8 點視為同一片剛體，同一 θ、同一 pitch）", "",
          f"- 整合 θ = **{D(p[0]):+.5f}°**，X 間距 {p[3]:.4f}，Y 間距 {p[4]:.4f}，中央間隙 G（欄1↔欄12）= {p[5]:.4f}（= pitch + {p[5]-p[3]:.4f}）",
          f"- 殘差 RMS = **{np.sqrt((e**2).sum(1).mean())*1000:.1f} µm**，最大 {np.hypot(*e.T).max()*1000:.1f} µm", "",
          "| Mark | 殘差 dX (µm) | 殘差 dY (µm) |", "|---|---|---|"]
    for q, d in zip(keys, e):
        L.append(f"| {q[0]}-{q[1]} | {d[0]*1000:+.1f} | {d[1]*1000:+.1f} |")
    p2, e2 = fit(keys, pts, list(p) + [0.0], [0, 1, 2, 3, 4, 5, 6])
    L += ["", "### 整合計算 B：同一 θ、同一 pitch，但允許右側整體 Y 位移（台階）", "",
          f"- 整合 θ = **{D(p2[0]):+.5f}°**，X 間距 {p2[3]:.4f}，Y 間距 {p2[4]:.4f}，中央間隙 G = {p2[5]:.4f}，右側 Y 台階 H = **{p2[6]:+.4f} mm**",
          f"- 殘差 RMS = **{np.sqrt((e2**2).sum(1).mean())*1000:.1f} µm**，最大 {np.hypot(*e2.T).max()*1000:.1f} µm", "",
          "| Mark | 殘差 dX (µm) | 殘差 dY (µm) |", "|---|---|---|"]
    for q, d in zip(keys, e2):
        L.append(f"| {q[0]}-{q[1]} | {d[0]*1000:+.1f} | {d[1]*1000:+.1f} |")
    # 長基線與中央台階
    a6, a7 = SIDES["左側"]["m"][(1, 6)], SIDES["右側"]["m"][(1, 7)]
    th_long = ang_x(np.array(a7) - np.array(a6))
    slope_l = math.tan(rl["edge_th"]["列1"])
    y_ext = SIDES["左側"]["m"][(1, 1)][1] + slope_l * (SIDES["右側"]["m"][(1, 12)][0] - SIDES["左側"]["m"][(1, 1)][0])
    step = SIDES["右側"]["m"][(1, 12)][1] - y_ext
    slope_l2 = math.tan(rl["edge_th"]["列2"])
    y_ext2 = SIDES["左側"]["m"][(2, 1)][1] + slope_l2 * (SIDES["右側"]["m"][(2, 12)][0] - SIDES["左側"]["m"][(2, 1)][0])
    step2 = SIDES["右側"]["m"][(2, 12)][1] - y_ext2
    L += ["", f"- 長基線（1-6 → 1-7，跨距 {np.hypot(*(np.array(a7)-np.array(a6))):.3f}）θ = {D(th_long):+.5f}°",
          f"- 左側列線延伸到欄 12 位置時，右側實際高出 **列1 {step:+.4f} mm、列2 {step2:+.4f} mm**（中央 Y 台階）", ""]

    # ---- 玻璃格點相對角度
    L += ["## 三、以各側玻璃格點為基準（A→左、B→右）", "",
          "| 項目 | 左側 / 格點 A | 右側 / 格點 B | 右 − 左 |", "|---|---|---|---|"]
    for name, key in [("格點 +X 方向角", "thx"), ("格點 +Y 方向角", "thy")]:
        a, b = grids["左側"][key], grids["右側"][key]; L.append(f"| {name} | {D(a):+.5f}° | {D(b):+.5f}° | {D(b-a):+.5f}° |")
    for name, key in [("格點 X 比例", "sx"), ("格點 Y 比例", "sy")]:
        a, b = grids["左側"][key], grids["右側"][key]; L.append(f"| {name}（量測/名義） | {a:.6f} | {b:.6f} | {(b-a)*1e6:+.0f} ppm |")
    rel = {k: (res[k]["thx"] - grids[k]["thx"], res[k]["thy"] - grids[k]["thy"]) for k in SIDES}
    for i, nm in enumerate(["SPB θx 相對格點", "SPB θy 相對格點"]):
        a, b = rel["左側"][i], rel["右側"][i]; L.append(f"| {nm} | {D(a):+.5f}° | {D(b):+.5f}° | {D(b-a):+.5f}° |")
    pc = {k: res[k]["px"] / grids[k]["sx"] for k in SIDES}
    L.append(f"| SPB X 間距（格點比例修正） | {pc['左側']:.4f} | {pc['右側']:.4f} | {pc['右側']-pc['左側']:+.4f} |")
    pyc = {k: res[k]["py"] / grids[k]["sy"] for k in SIDES}
    L.append(f"| SPB Y 間距（格點比例修正） | {pyc['左側']:.4f} | {pyc['右側']:.4f} | {pyc['右側']-pyc['左側']:+.4f} |")
    L.append("")
    md = "\n".join(L)
    open(os.path.join(HERE, "..", "docs", "spb-lr-calc.md"), "w", encoding="utf-8").write(md)

    # 每片中心 CSV（分開計算 A 解讀）
    with open(os.path.join(HERE, "..", "spb_lr_centers.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["側", "位置", "中心X", "中心Y", "θ(上下Mark,deg)", "θx(該側,deg)", "θ(整合,deg)"])
        for k, s in SIDES.items():
            for i, (c, t) in enumerate(res[k]["ctr"]):
                w.writerow([k, s["cols"][0] + i, f"{c[0]:.4f}", f"{c[1]:.4f}", f"{D(t):+.5f}", f"{D(res[k]['thx']):+.5f}", f"{D(p[0]):+.5f}"])
    print(md)

if __name__ == "__main__":
    main()
