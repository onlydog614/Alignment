"""以實際貼附位置（預設 1-11）推算 24 個預放位置的貼附中心與貼合座標。
Mark→中心偏移先扣除基準位置局部 θ（換成 SPB 自身方向），再依各位置局部 θ 轉回。
相機→貼合 只有一點，僅求平移；只套用到同側。"""
import csv, math, os
HERE = os.path.dirname(os.path.abspath(__file__))
REF, CAM, BOND = "1-11", (257.3578, 1000.6750), (208.1318, 1318.9640)
# 貼附後 Tile 四角（右機台座標）：左上、右上、左下、右下
CORNERS = [(312.9066, 1003.8826), (195.8776, 1003.8551), (312.8498, 1135.9840), (195.8122, 1135.9500)]
TC = (sum(c[0] for c in CORNERS) / 4, sum(c[1] for c in CORNERS) / 4)
rows = list(csv.DictReader(open(os.path.join(HERE, "..", "spb_preplace_24.csv"), encoding="utf-8-sig")))
rot = lambda v, t: (math.cos(t) * v[0] - math.sin(t) * v[1], math.sin(t) * v[0] + math.cos(t) * v[1])
r0 = next(r for r in rows if r["預放位置"] == REF)
m0 = (float(r0["X(該側機台)"]), float(r0["Y"])); t0 = math.radians(float(r0["θ局部(deg)"]))
dS = rot((CAM[0] - m0[0], CAM[1] - m0[1]), -t0); dT = rot((TC[0] - m0[0], TC[1] - m0[1]), -t0); dB = (BOND[0] - CAM[0], BOND[1] - CAM[1])
with open(os.path.join(HERE, "..", "spb_center_bond_24.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f); w.writerow(["預放位置", "側", "MarkX", "MarkY", "θ局部(deg)", "相機中心X", "相機中心Y", "Tile中心X(四角)", "Tile中心Y(四角)", "貼合X", "貼合Y", "備註"])
    for r in rows:
        m = (float(r["X(該側機台)"]), float(r["Y"])); d = rot(dS, math.radians(float(r["θ局部(deg)"])))
        c = (m[0] + d[0], m[1] + d[1]); t = rot(dT, math.radians(float(r["θ局部(deg)"]))); same = r["側"] == r0["側"]
        b = (f"{c[0]+dB[0]:.4f}", f"{c[1]+dB[1]:.4f}") if same else ("", "")
        note = "基準（實測）" if r["預放位置"] == REF else ("同側推算" if same else "另一側需實測貼合平移")
        w.writerow([r["預放位置"], r["側"], r["X(該側機台)"], r["Y"], r["θ局部(deg)"], f"{c[0]:.4f}", f"{c[1]:.4f}", f"{m[0]+t[0]:.4f}", f"{m[1]+t[1]:.4f}", *b, note])
print("Mark→中心(機台)", CAM[0] - m0[0], CAM[1] - m0[1], " SPB方向", dS, " 相機→貼合", dB)
