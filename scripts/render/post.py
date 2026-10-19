#!/usr/bin/env python3
"""Stage 3 post: per height npz (build.py LAYERS) -> colour (straight-alpha sRGB RGBA, 2x), height (u8, 2x), shadow (u8, 1x)
  python3 post.py <theme> <tag> [--sheet]"""
import json, os, sys, glob
import numpy as np
from PIL import Image
B = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(B, 'out')
sys.path.insert(0, B)
from compare import KV, KA  # noqa: E402
theme, tag = sys.argv[1], sys.argv[2]
TEAR_M = float(os.environ.get('TEAR_M_' + theme, '0.45'))
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'layers', theme); os.makedirs(D, exist_ok=True)


def srgb(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


for f in sorted(glob.glob(os.path.join(OUT, 'lay_%s_%s_L*.npz' % (theme, tag)))):
    z = np.load(f); P = {k: z[k].astype(np.float64) for k in z.files}; meta = json.load(open(f[:-4] + '.json'))
    C = P['Combined']; al = np.clip(C[..., 3], 0, 1)
    Gl = (P['GlossDir'][..., :3] + P['GlossInd'][..., :3]) * P['GlossCol'][..., :3]
    on, off = P['Vis_on'][..., :3].mean(-1), P['Vis_off'][..., :3].mean(-1)
    vis = np.where(off > 1e-4, np.clip(on / np.maximum(off, 1e-4), 0, 1), 1.0)
    ao = np.where(al > 1e-3, np.clip(P['AO'][..., :3].mean(-1) / np.maximum(al, 1e-3), 0, 1), 1.0)
    m = (1 - KV + KV * vis) * ao ** KA
    m = np.where(np.abs(P['IndexOB'][..., 0] - 7) < 0.5, np.maximum(m, TEAR_M), m)
    rgb = np.nan_to_num(C[..., :3] + Gl * (m - 1)[..., None])          # premultiplied, linear
    st = np.where(al[..., None] > 1e-4, rgb / np.maximum(al, 1e-4)[..., None], 0)
    col = np.dstack([srgb(st), al]); col = (col * 255 + 0.5).astype(np.uint8)
    h = np.clip(np.round(P['H'] / meta['zs'] * 255), 0, 255).astype(np.uint8)
    s = np.clip(P['S'], 0, 1)
    n = meta['name']
    Image.fromarray(col).save(os.path.join(D, n + '_c.png'))
    Image.fromarray(h).save(os.path.join(D, n + '_h.png'))
    Image.fromarray((s * 255 + 0.5).astype(np.uint8)).save(os.path.join(D, n + '_s.png'))
    json.dump(meta, open(os.path.join(D, n + '.json'), 'w'), indent=1)
    print(n, meta['head'], 'alpha max', round(float(al.max()), 3), 'z max', round(float(P['H'].max()), 1), 'shadow max', round(float(s.max()), 3))
