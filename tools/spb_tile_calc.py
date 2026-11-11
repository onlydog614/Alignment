"""SPB tile mark 預放位置計算：XYθ、間距、X/Y 方向斜率差（直交誤差），
並可選用玻璃格點（alignment_data.csv A 組）做機台座標校正後再算一次。"""
import csv, math, os
import numpy as np

ROWS, COLS = 2, 6
# 量測值（機台座標, mm）
MARKS = {
    (1, 1): (-43.6522, 1004.1377),
    (1, 6): (-718.6154, 1004.9193),
    (2, 1): (-43.5210, 1148.2364),
    (2, 6): (-718.4602, 1149.0500),
}

def deg(r): return math.degrees(r)

def analyse(m, title):
    p11, p16, p21, p26 = (np.array(m[k]) for k in [(1,1),(1,6),(2,1),(2,6)])
    out = [f"## {title}", ""]
    # X 方向（欄 6 → 欄 1 為 +X），Y 方向（列 1 → 列 2 為 +Y）
    vx = {"列1": p11 - p16, "列2": p21 - p26}
    vy = {"欄1": p21 - p11, "欄6": p26 - p16}
    thx = {k: math.atan2(v[1], v[0]) for k, v in vx.items()}
    thy = {k: math.atan2(-v[0], v[1]) for k, v in vy.items()}
    out += ["| 邊 | ΔX | ΔY | 長度 | 間距(÷段數) | θ (deg) |", "|---|---|---|---|---|---|"]
    for k, v in vx.items():
        L = np.hypot(*v); out.append(f"| {k} X 向 (1-6→1-1) | {v[0]:.4f} | {v[1]:.4f} | {L:.4f} | {L/(COLS-1):.4f} | {deg(thx[k]):+.5f} |")
    for k, v in vy.items():
        L = np.hypot(*v); out.append(f"| {k} Y 向 (1→2) | {v[0]:.4f} | {v[1]:.4f} | {L:.4f} | {L/(ROWS-1):.4f} | {deg(thy[k]):+.5f} |")
    tx = np.mean(list(thx.values())); ty = np.mean(list(thy.values()))
    th = (tx + ty) / 2
    d1 = np.hypot(*(p26 - p11)); d2 = np.hypot(*(p21 - p16))
    out += ["",
        f"- X 方向平均 θx = {deg(tx):+.5f}°，Y 方向平均 θy = {deg(ty):+.5f}°",
        f"- **直交誤差 θx − θy = {deg(tx-ty):+.5f}°**（{(tx-ty)*1e6:+.1f} µrad；換算 Y 跨距 144 mm 上 X 偏 {(tx-ty)*144.1*1000:+.1f} µm，X 跨距 675 mm 上 Y 偏 {(tx-ty)*675*1000:+.1f} µm）",
        f"- 建議整體 θ（X、Y 平均）= **{deg(th):+.5f}°**",
        f"- 對角線長 1-1↔2-6 = {d1:.4f}，1-6↔2-1 = {d2:.4f}，差 {d1-d2:+.4f}",
        f"- 平行度：列1/列2 θ 差 {deg(thx['列1']-thx['列2']):+.5f}°；欄1/欄6 θ 差 {deg(thy['欄1']-thy['欄6']):+.5f}°（梯形）", ""]
    # 每片 tile 預放位置：四角雙線性內插
    out += ["### 每片預放位置（四角雙線性內插）", "",
            "| Tile | X | Y | θ (deg) | 與前一片 X 間距 |", "|---|---|---|---|---|"]
    rows = []
    for r in range(1, ROWS + 1):
        prev = None
        for c in range(1, COLS + 1):
            u = (c - 1) / (COLS - 1); v = (r - 1) / (ROWS - 1)
            p = (1-u)*(1-v)*p11 + u*(1-v)*p16 + (1-u)*v*p21 + u*v*p26
            # 局部 θ：該處 X 向與 Y 向切線角平均
            dx = ((1-v)*(p11-p16) + v*(p21-p26)); dy = ((1-u)*(p21-p11) + u*(p26-p16))
            t = (math.atan2(dx[1], dx[0]) + math.atan2(-dy[0], dy[1])) / 2
            pitch = "" if prev is None else f"{np.hypot(*(p-prev)):.4f}"
            out.append(f"| {r}-{c} | {p[0]:.4f} | {p[1]:.4f} | {deg(t):+.5f} | {pitch} |")
            rows.append((f"{r}-{c}", p[0], p[1], deg(t)))
            prev = p
    out.append("")
    # 剛體最佳擬合（以理想矩形 pitch 計算殘差）
    px = np.mean([np.hypot(*v) for v in vx.values()]) / (COLS - 1)
    py = np.mean([np.hypot(*v) for v in vy.values()]) / (ROWS - 1)
    ideal = {k: np.array([-(k[1]-1)*px, (k[0]-1)*py]) for k in m}
    A = np.array([ideal[k] for k in m]); B = np.array([m[k] for k in m])
    ca, cb = A.mean(0), B.mean(0)
    H = (A-ca).T @ (B-cb); U, _, Vt = np.linalg.svd(H); R = (U @ Vt).T
    if np.linalg.det(R) < 0: Vt[-1] *= -1; R = (U @ Vt).T
    tr = cb - R @ ca; thr = math.atan2(R[1,0], R[0,0])
    out += [f"### 剛體最佳擬合（理想矩形 pitch X={px:.4f}, Y={py:.4f}）", "",
            f"- 原點(1-1) = ({(R@ideal[(1,1)]+tr)[0]:.4f}, {(R@ideal[(1,1)]+tr)[1]:.4f})，θ = {deg(thr):+.5f}°", "",
            "| Mark | 殘差 dX (µm) | 殘差 dY (µm) |", "|---|---|---|"]
    for k in m:
        e = np.array(m[k]) - (R @ ideal[k] + tr)
        out.append(f"| {k[0]}-{k[1]} | {e[0]*1000:+.1f} | {e[1]*1000:+.1f} |")
    out.append("")
    return out, rows

def grid_affine(path):
    """用 A 組玻璃格點擬合 機台→名義 的仿射，回傳轉換與殘差 RMS。"""
    src, dst = [], []
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["組別"] != "A": continue
            src.append([float(r["量測X"]), float(r["量測Y"]), 1]); dst.append([float(r["名義X"]), float(r["名義Y"])])
    S, D = np.array(src), np.array(dst)
    M, *_ = np.linalg.lstsq(S, D, rcond=None)
    res = S @ M - D
    return M, np.sqrt((res**2).sum(1).mean())

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    lines = ["# SPB tile mark 預放位置計算結果", "",
             "座標：機台座標 (mm)。θ 正值為逆時針。X 向以 1-6→1-1 為 +X，Y 向以列1→列2 為 +Y。", ""]
    l1, rows = analyse(MARKS, "一、原始量測")
    lines += l1
    M, rms = grid_affine(os.path.join(here, "..", "alignment_data.csv"))
    a, b = M[0], M[1]
    sx, sy = np.hypot(M[0,0], M[0,1]), np.hypot(M[1,0], M[1,1])
    lines += ["## 二、玻璃格點（A 組）機台座標仿射校正", "",
              f"- 機台→名義 仿射：X' = {M[0,0]:.6f}·X + {M[1,0]:.6f}·Y + {M[2,0]:.4f}；Y' = {M[0,1]:.6f}·X + {M[1,1]:.6f}·Y + {M[2,1]:.4f}",
              f"- X 軸比例 {M[0,0]:.6f}（{(M[0,0]-1)*1e6:+.0f} ppm），Y 軸比例 {M[1,1]:.6f}（{(M[1,1]-1)*1e6:+.0f} ppm）",
              f"- 軸直交（skew）= {deg(math.atan2(M[1,0], M[1,1]) + math.atan2(M[0,1], M[0,0])):+.5f}°；擬合殘差 RMS = {rms*1000:.1f} µm", ""]
    cal = {k: tuple(np.array([v[0], v[1], 1]) @ M) for k, v in MARKS.items()}
    l2, _ = analyse(cal, "三、校正後 SPB（名義格點座標，僅看 θ 與間距，原點不同）")
    lines += l2
    md = os.path.join(here, "..", "docs", "spb-tile-calc.md")
    open(md, "w", encoding="utf-8").write("\n".join(lines))
    with open(os.path.join(here, "..", "spb_tile_preplace.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["Tile", "X", "Y", "θ(deg)"])
        for r in rows: w.writerow([r[0], f"{r[1]:.4f}", f"{r[2]:.4f}", f"{r[3]:+.5f}"])
    print("\n".join(lines))
