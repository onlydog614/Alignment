"""SPB 左右兩側 tile mark：分開計算與整合計算比較。

座標慣例（使用者確認）：
- 左側機台：原點在左，X 由左至右增加。Mark 1~6，實體上 6 在最左、1 靠中央。
- 右側機台：原點在右，X 由右至左增加（相對左側為鏡像）。Mark 7~12，7 靠中央、12 在最右。
- 實體排列由左至右：6 5 4 3 2 1 | 7 8 9 10 11 12。
- 整合時以左側機台座標為共同座標：右側 x = C − X_R（Y 不變），C 未知，
  以「欄 1 與欄 7 的中心距 = pitch」反推。
玻璃格點 A 組對應左側、B 組對應右側（alignment_data.csv）。"""
import csv, math, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
LEFT = {(1, 1): (-43.6522, 1004.1377), (1, 6): (-718.6154, 1004.9193),
        (2, 1): (-43.5210, 1148.2364), (2, 6): (-718.4602, 1149.0500)}
RIGHT = {(1, 7): (736.1080, 1004.2420), (1, 12): (60.9690, 1005.1100),
         (2, 7): (736.3030, 1148.3460), (2, 12): (61.0828, 1149.2000)}
D = math.degrees
ang_x = lambda v: math.atan2(v[1], v[0])        # v 指向 +X
ang_y = lambda v: math.atan2(-v[0], v[1])       # v 指向 +Y，逆時針為正

def side_calc(m, inner, outer):
    """inner = 靠中央的欄，outer = 外側欄；回傳在該座標中的各項。+X 方向自動判斷。"""
    a, b, c, d = (np.array(m[k]) for k in [(1, inner), (1, outer), (2, inner), (2, outer)])
    sgn = 1 if a[0] > b[0] else -1                      # inner 在 +X 側？
    rows = {"列1": (a - b) * sgn, "列2": (c - d) * sgn}  # 指向 +X
    cols = {"中央側欄": c - a, "外側欄": d - b}
    n = abs(outer - inner)
    e = {**{k: ang_x(v) for k, v in rows.items()}, **{k: ang_y(v) for k, v in cols.items()}}
    thx = (e["列1"] + e["列2"]) / 2; thy = (e["中央側欄"] + e["外側欄"]) / 2
    px = np.mean([np.hypot(*v) for v in rows.values()]) / n
    py = np.mean([np.hypot(*v) for v in cols.values()])
    step = 1 if outer > inner else -1
    ctr = []
    for i in range(n + 1):
        t = a + (b - a) * i / n; u = c + (d - c) * i / n
        ctr.append((inner + i * step, (t + u) / 2, ang_y(u - t)))
    return dict(e=e, thx=thx, thy=thy, px=px, py=py, ctr=ctr, center=(a + b + c + d) / 4,
                diag=np.hypot(*(d - a)) - np.hypot(*(c - b)))

def rigid_fit(pts, ideal):
    A, B = np.array(ideal), np.array(pts); ca, cb = A.mean(0), B.mean(0)
    u, v = A - ca, B - cb
    th = math.atan2((u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]).sum(), (u * v).sum())
    R = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    e = B - (A - ca) @ R.T - cb
    return th, e

# ---- 整合模型（共同座標 = 左側機台座標）
def phys(C):
    pts = {k: np.array(v) for k, v in LEFT.items()}
    pts.update({k: np.array([C - v[0], v[1]]) for k, v in RIGHT.items()})
    return pts

def model(p, k):
    th, tx, ty, px, py, C, H = p
    r, c = k
    u = -(c - 1) * px if c <= 6 else (c - 6) * px     # 欄1 在 u=0，欄7 在 u=+px
    v = (r - 1) * py + (H if c > 6 else 0.0)
    return np.array([tx + math.cos(th) * u - math.sin(th) * v, ty + math.sin(th) * u + math.cos(th) * v])

def fit(p0, free):
    keys = list(LEFT) + list(RIGHT); p = np.array(p0, float)
    res = lambda q: np.concatenate([model(q, k) - phys(q[5])[k] for k in keys])
    for _ in range(60):
        r = res(p); J = np.zeros((r.size, len(free)))
        for j, i in enumerate(free):
            dp = p.copy(); dp[i] += 1e-7; J[:, j] = (res(dp) - r) / 1e-7
        st = np.linalg.lstsq(J, -r, rcond=None)[0]; p[free] += st
        if np.abs(st).max() < 1e-12: break
    e = -res(p).reshape(-1, 2)
    return p, e, keys

def grid_axes(group, mirror):
    S, N = [], []
    with open(os.path.join(HERE, "..", "alignment_data.csv"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["組別"] == group:
                N.append([float(r["名義X"]), float(r["名義Y"]), 1])
                x = float(r["量測X"]); S.append([-x if mirror else x, float(r["量測Y"])])
    M = np.linalg.lstsq(np.array(N), np.array(S), rcond=None)[0]
    ex, ey = M[0], M[1]; sgn = 1 if ex[0] > 0 else -1
    return dict(thx=ang_x(sgn * ex), thy=ang_y(ey), sx=np.hypot(*ex), sy=np.hypot(*ey))

def main():
    fd = lambda v: f"{D(v):+.5f}°"; f4 = lambda v: f"{v:.4f}"; s4 = lambda v: f"{v:+.4f}"
    L_ = side_calc(LEFT, 1, 6)
    R_m = side_calc(RIGHT, 7, 12)                                     # 右側機台座標
    R_p = side_calc({k: (-v[0], v[1]) for k, v in RIGHT.items()}, 7, 12)  # 鏡像到實體方向
    out = ["# SPB 左右兩側：分開計算 vs 整合計算", "",
           "左側機台 X 由左至右；右側機台 X 由右至左（鏡像）。實體排列由左至右：6 5 4 3 2 1 | 7 8 9 10 11 12。",
           "「機台座標」值用於各側下指令；「實體方向」值為把右側鏡像後與左側同向比較。θ 逆時針為正。", ""]

    out += ["## 一、分開計算", "",
            "| 項目 | 左側（機台＝實體） | 右側（右機台座標） | 右側（實體方向） | 實體：右 − 左 |", "|---|---|---|---|---|"]
    for name, f in [("θx 列1", lambda r: r["e"]["列1"]), ("θx 列2", lambda r: r["e"]["列2"]),
                    ("θy 中央側欄", lambda r: r["e"]["中央側欄"]), ("θy 外側欄", lambda r: r["e"]["外側欄"]),
                    ("θx 平均", lambda r: r["thx"]), ("θy 平均", lambda r: r["thy"]),
                    ("直交誤差 θx−θy", lambda r: r["thx"] - r["thy"])]:
        out.append(f"| {name} | {fd(f(L_))} | {fd(f(R_m))} | {fd(f(R_p))} | {fd(f(R_p) - f(L_))} |")
    out.append(f"| X 間距 | {f4(L_['px'])} | {f4(R_m['px'])} | {f4(R_p['px'])} | {s4(R_p['px']-L_['px'])} |")
    out.append(f"| Y 間距 | {f4(L_['py'])} | {f4(R_m['py'])} | {f4(R_p['py'])} | {s4(R_p['py']-L_['py'])} |")
    out.append(f"| 對角線差 (µm) | {L_['diag']*1000:+.1f} | {R_m['diag']*1000:+.1f} | {R_p['diag']*1000:+.1f} | |")

    # 各側剛體擬合（各自座標）
    def side_rigid(m, inner, outer, px, py, sgn):
        keys = list(m); ideal = [(sgn * -(abs(c - inner)) * px, (r - 1) * py) for r, c in keys]
        return rigid_fit([m[k] for k in keys], ideal)
    thL, eL = side_rigid(LEFT, 1, 6, L_["px"], L_["py"], 1)
    thRm, eRm = side_rigid(RIGHT, 7, 12, R_m["px"], R_m["py"], 1)   # 右機台：欄 7 在 +X 側
    rms = lambda e: np.sqrt((e ** 2).sum(1).mean()) * 1000
    out.append(f"| 剛體擬合 θ（下指令用） | {fd(thL)} | {fd(thRm)} | {fd(-thRm)} | {fd(-thRm - thL)} |")
    out.append(f"| 剛體擬合殘差 RMS (µm) | {rms(eL):.1f} | {rms(eRm):.1f} | | |")
    out.append("")

    # ---- 整合
    px0 = (L_["px"] + R_m["px"]) / 2; py0 = (L_["py"] + R_m["py"]) / 2
    C0 = LEFT[(1, 1)][0] + px0 + RIGHT[(1, 7)][0]
    p1, e1, keys = fit([L_["thx"], *LEFT[(1, 1)], px0, py0, C0, 0.0], [0, 1, 2, 3, 4, 5])
    p2, e2, _ = fit(list(p1[:6]) + [0.0], [0, 1, 2, 3, 4, 5, 6])
    out += ["## 二、整合計算（右側鏡像後與左側合併；假設欄 1↔欄 7 中心距 = pitch）", "",
            f"- 反推兩原點關係 C = {p1[5]:.4f}（右側實體 x = C − X_右）",
            "", "| 項目 | 整合（剛體） | 整合（允許右側 Y 台階） |", "|---|---|---|",
            f"| θ | {fd(p1[0])} | {fd(p2[0])} |",
            f"| X 間距 | {f4(p1[3])} | {f4(p2[3])} |", f"| Y 間距 | {f4(p1[4])} | {f4(p2[4])} |",
            f"| C | {f4(p1[5])} | {f4(p2[5])} |", f"| 右側 Y 台階 H | 0（固定） | {s4(p2[6])} mm |",
            f"| 殘差 RMS (µm) | {rms(e1):.1f} | {rms(e2):.1f} |",
            f"| 最大殘差 (µm) | {np.hypot(*e1.T).max()*1000:.1f} | {np.hypot(*e2.T).max()*1000:.1f} |", "",
            "| Mark | 剛體 dX | 剛體 dY | 含台階 dX | 含台階 dY |", "|---|---|---|---|---|"]
    for k, a, b in zip(keys, e1, e2):
        out.append(f"| {k[0]}-{k[1]} | {a[0]*1000:+.1f} | {a[1]*1000:+.1f} | {b[0]*1000:+.1f} | {b[1]*1000:+.1f} |")
    out.append("")
    kink = R_p["thx"] - L_["thx"]
    out += [f"- 實體上左側 θx {fd(L_['thx'])}、右側 θx {fd(R_p['thx'])}：兩側從中央往外都往上翹（V 形），夾角 {fd(kink)}。",
            f"- 中央相鄰兩片 Mark 高度：1-1 Y={LEFT[(1,1)][1]:.4f}、1-7 Y={RIGHT[(1,7)][1]:.4f}（差 {RIGHT[(1,7)][1]-LEFT[(1,1)][1]:+.4f}）；"
            f"2-1 Y={LEFT[(2,1)][1]:.4f}、2-7 Y={RIGHT[(2,7)][1]:.4f}（差 {RIGHT[(2,7)][1]-LEFT[(2,1)][1]:+.4f}）", ""]

    # ---- 玻璃格點
    gA = grid_axes("A", False); gB = grid_axes("B", True)
    out += ["## 三、對照玻璃格點（實體方向；B 組已鏡像）", "",
            "| 項目 | 左 / A | 右 / B | 右 − 左 |", "|---|---|---|---|"]
    for nm, k in [("格點 +X 方向角", "thx"), ("格點 +Y 方向角", "thy")]:
        out.append(f"| {nm} | {fd(gA[k])} | {fd(gB[k])} | {fd(gB[k]-gA[k])} |")
    out.append(f"| 格點直交 θx−θy | {fd(gA['thx']-gA['thy'])} | {fd(gB['thx']-gB['thy'])} | |")
    out.append(f"| 格點 X 比例 | {gA['sx']:.6f} | {gB['sx']:.6f} | {(gB['sx']-gA['sx'])*1e6:+.0f} ppm |")
    out.append(f"| SPB θx 相對格點 | {fd(L_['thx']-gA['thx'])} | {fd(R_p['thx']-gB['thx'])} | |")
    out.append(f"| SPB θy 相對格點 | {fd(L_['thy']-gA['thy'])} | {fd(R_p['thy']-gB['thy'])} | |")
    out.append(f"| X 間距（比例修正） | {f4(L_['px']/gA['sx'])} | {f4(R_p['px']/gB['sx'])} | {s4(R_p['px']/gB['sx']-L_['px']/gA['sx'])} |")
    out.append("")
    md = "\n".join(out)
    open(os.path.join(HERE, "..", "docs", "spb-lr-calc.md"), "w", encoding="utf-8").write(md)
    with open(os.path.join(HERE, "..", "spb_lr_centers.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["側", "位置", "中心X(該側機台)", "中心Y", "θ上下Mark(該側機台,deg)", "θ剛體擬合(該側機台,deg)"])
        for nm, r, th in [("左側", L_, thL), ("右側", R_m, thRm)]:
            for c, p, t in r["ctr"]:
                w.writerow([nm, c, f"{p[0]:.4f}", f"{p[1]:.4f}", f"{D(t):+.5f}", f"{D(th):+.5f}"])
    # 24 個預放位置（每個 Mark 即一個位置），各側機台座標，局部 θ = 列向與欄向平均
    with open(os.path.join(HERE, "..", "spb_preplace_24.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["#", "預放位置", "側", "X(該側機台)", "Y", "θ局部(deg)", "θ列向(deg)", "θ欄向(deg)", "該側剛體θ(deg)", "來源"])
        n = 0
        for nm, m, inner, outer, th in [("左側", LEFT, 1, 6, thL), ("右側", RIGHT, 7, 12, thRm)]:
            r = side_calc(m, inner, outer)
            a, b, c, d = (np.array(m[k]) for k in [(1, inner), (1, outer), (2, inner), (2, outer)])
            sgn = 1 if a[0] > b[0] else -1
            k0, k1 = c - a, d - b; tr = [ang_x((a - b) * sgn), ang_x((c - d) * sgn)]
            for row, (p0, p1) in enumerate([(a, b), (c, d)], start=1):
                for i in range(6):
                    fu = i / 5; col = inner + i * (1 if outer > inner else -1)
                    pt = p0 + (p1 - p0) * fu; ty = ang_y(k0 * (1 - fu) + k1 * fu); tx = tr[row - 1]
                    n += 1
                    w.writerow([n, f"{row}-{col}", nm, f"{pt[0]:.4f}", f"{pt[1]:.4f}", f"{D((tx+ty)/2):+.5f}",
                                f"{D(tx):+.5f}", f"{D(ty):+.5f}", f"{D(th):+.5f}", "實測" if i in (0, 5) else "內插"])
    print(md)

if __name__ == "__main__":
    main()
