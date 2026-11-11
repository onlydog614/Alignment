"""以實際貼附位置（預設 1-11）推算 24 個預放位置的貼附中心與貼合座標。
Mark→中心偏移先扣除基準位置局部 θ（換成 SPB 自身方向），再依各位置局部 θ 轉回。
相機→貼合 只有一點，僅求平移；只套用到同側。"""
import csv, math, os
HERE = os.path.dirname(os.path.abspath(__file__))
REF, CAM, BOND = "1-11", (257.3578, 1000.6750), (208.1318, 1318.9640)
# 預放位置四個邊角（相機量測，右機台座標）：左上、右上、左下、右下
CORNERS = [(312.9066, 1003.8826), (195.8776, 1003.8551), (312.8498, 1135.9840), (195.8122, 1135.9500)]
TC = (sum(c[0] for c in CORNERS) / 4, sum(c[1] for c in CORNERS) / 4)
# 片子圖面 135 x 144：量到的四點為 Mark (12,5.25)(129,5.25)(12,137.25)(129,137.25)，中心 (67.5,72)
# 右機台 X 與實體左右相反：實體 x = -X。以仿射擬合求圖面中心。
import numpy as _np
_Q = _np.array([[12, 5.25, 1], [129, 5.25, 1], [12, 137.25, 1], [129, 137.25, 1]])
_P = _np.array([[-c[0], c[1]] for c in CORNERS])
_T = _np.linalg.lstsq(_Q, _P, rcond=None)[0]
_c = _np.array([67.5, 72, 1]) @ _T
DC = (-_c[0], _c[1])
rows = list(csv.DictReader(open(os.path.join(HERE, "..", "spb_preplace_24.csv"), encoding="utf-8-sig")))
rot = lambda v, t: (math.cos(t) * v[0] - math.sin(t) * v[1], math.sin(t) * v[0] + math.cos(t) * v[1])
r0 = next(r for r in rows if r["預放位置"] == REF)
m0 = (float(r0["X(該側機台)"]), float(r0["Y"])); t0 = math.radians(float(r0["θ局部(deg)"]))
dS = rot((CAM[0] - m0[0], CAM[1] - m0[1]), -t0); dT = rot((TC[0] - m0[0], TC[1] - m0[1]), -t0); dDz = rot((DC[0] - m0[0], DC[1] - m0[1]), -t0); dB = (BOND[0] - CAM[0], BOND[1] - CAM[1])
with open(os.path.join(HERE, "..", "spb_center_bond_24.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f); w.writerow(["預放位置", "側", "MarkX", "MarkY", "θ局部(deg)", "相機中心X(原)", "相機中心Y(原)", "Mark四點中心X", "Mark四點中心Y", "圖面中心X", "圖面中心Y", "貼合X", "貼合Y", "備註"])
    for r in rows:
        m = (float(r["X(該側機台)"]), float(r["Y"])); d = rot(dS, math.radians(float(r["θ局部(deg)"])))
        c = (m[0] + d[0], m[1] + d[1]); t = rot(dT, math.radians(float(r["θ局部(deg)"]))); z = rot(dDz, math.radians(float(r["θ局部(deg)"]))); same = r["側"] == r0["側"]
        b = (f"{c[0]+dB[0]:.4f}", f"{c[1]+dB[1]:.4f}") if same else ("", "")
        note = "基準（實測）" if r["預放位置"] == REF else ("同側推算" if same else "另一側需實測貼合平移")
        w.writerow([r["預放位置"], r["側"], r["X(該側機台)"], r["Y"], r["θ局部(deg)"], f"{c[0]:.4f}", f"{c[1]:.4f}", f"{m[0]+t[0]:.4f}", f"{m[1]+t[1]:.4f}", f"{m[0]+z[0]:.4f}", f"{m[1]+z[1]:.4f}", *b, note])
print("Mark→中心(機台)", CAM[0] - m0[0], CAM[1] - m0[1], " SPB方向", dS, " 相機→貼合", dB)

# 24 個預放位置的四個邊角（以基準位置四角相對 Mark 的偏移，依各位置局部 θ 轉換）
dCs = [rot((c[0] - m0[0], c[1] - m0[1]), -t0) for c in CORNERS]
with open(os.path.join(HERE, "..", "spb_preplace_corners_24.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f); w.writerow(["預放位置", "側", "左上X", "左上Y", "右上X", "右上Y", "左下X", "左下Y", "右下X", "右下Y", "中心X", "中心Y"])
    for r in rows:
        m = (float(r["X(該側機台)"]), float(r["Y"])); t = math.radians(float(r["θ局部(deg)"]))
        pts = [rot(d, t) for d in dCs]; pts = [(m[0] + p[0], m[1] + p[1]) for p in pts]
        cx = sum(p[0] for p in pts) / 4; cy = sum(p[1] for p in pts) / 4
        w.writerow([r["預放位置"], r["側"], *[f"{v:.4f}" for p in pts for v in p], f"{cx:.4f}", f"{cy:.4f}"])
