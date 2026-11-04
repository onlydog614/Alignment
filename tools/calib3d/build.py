# 把 page.html 與各 js 合併成單一檔 calibration-3d.html（repo 根目錄）
import pathlib
d = pathlib.Path(__file__).resolve().parent
out = d.joinpath('page.html').read_text(encoding='utf-8')
out += '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>\n'
for f in ['core.js', 'selftest.js', 'scene.js', 'steps.js', 'app.js']:
    out += '<script>\n' + d.joinpath(f).read_text(encoding='utf-8') + '\n</script>\n'
full = '<!doctype html>\n<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head><body>\n' + out + '\n</body></html>\n'
d.parent.parent.joinpath('calibration-3d.html').write_text(full, encoding='utf-8')
