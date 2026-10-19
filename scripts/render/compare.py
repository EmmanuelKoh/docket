# Composite a full render's passes: metal reflections darkened where the lamp is blocked (KV) and by ambient
# occlusion (KA), so shadows read on metal (the one departure from plain physics; docs/rendering.md), then the desk
# colour under the transparent desk.
# usage: python3 compare.py post <tag> [light|dark]   -> out/render-<theme>-<tag>.png
import sys, os, json, math
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import geo as G  # noqa: E402

KV, KA = 0.85, 1.0
OUT = os.path.join(HERE, 'out')


def srgb(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)


def lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def bg_lin(theme):
    """the page's ground under the module (ground.json, sRGB), linear"""
    return lin(np.array(json.load(open(os.path.join(HERE, 'ground.json')))[theme], np.float64))


def post(theme, tag):
    z = np.load(os.path.join(OUT, 'passes_%s_%s.npz' % (theme, tag)))
    P = {k: z[k].astype(np.float64) for k in z.files}                # OIIO reads top-down
    C = P['Combined']; al = np.clip(C[..., 3], 0, 1)
    Gl = (P['GlossDir'][..., :3] + P['GlossInd'][..., :3]) * P['GlossCol'][..., :3]
    on, off = P['Vis_on'][..., :3].mean(-1), P['Vis_off'][..., :3].mean(-1)
    vis = np.where(off > 1e-4, np.clip(on / np.maximum(off, 1e-4), 0, 1), 1.0)
    ao = np.where(al > 1e-3, np.clip(P['AO'][..., :3].mean(-1) / np.maximum(al, 1e-3), 0, 1), 1.0)
    m = (1 - KV + KV * vis) * ao ** KA
    # the tear bar (pass index 7) sits wholly in the body's own shadow and reflects the sky in front, away from the
    # key, so the key-visibility darkening (a proxy for the lamp's reflection being blocked) does not apply to it
    if 'IndexOB' in P:
        m = np.where(np.abs(P['IndexOB'][..., 0] - 7) < 0.5, np.maximum(m, float(os.environ.get('TEAR_M_' + theme, '0.45'))), m)
    rgb = C[..., :3] + Gl * (m - 1)[..., None]
    rgb = np.nan_to_num(rgb)
    outl = rgb + bg_lin(theme)[None, None] * (1 - al)[..., None]
    im = Image.fromarray((srgb(outl) * 255 + 0.5).astype(np.uint8))
    meta = json.load(open(os.path.join(OUT, 'meta_%s_%s.json' % (theme, tag))))
    s = meta['scale']
    if s != 2:
        im = im.resize((G.CROP[2] * 2, G.CROP[3] * 2), Image.LANCZOS)
    p = os.path.join(OUT, 'render-%s-%s.png' % (theme, tag)); im.save(p); print(p)
    return im


# ---------------------------------------------------------------- measurements (window px)
if __name__ == '__main__':
    for th in sys.argv[3:] or ('light', 'dark'):
        post(th, sys.argv[2])
