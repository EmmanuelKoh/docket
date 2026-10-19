#!/usr/bin/env python3
"""Pack the head unit's column (layers/<theme>, from post.py) for the page:
  public/hardware/feed/head-<theme>-c.webp   colour atlas, straight-alpha RGBA, 2x, 2 columns of cells
  public/hardware/feed/head-<theme>-a.webp   1x: R = height (u8, 255 = zs px above the desk), G = shadow (u8, linear-light share)
  public/hardware/feed/head-<theme>-{1x,2x}.png   the static fallback: the hold-height render, colour over its shadow
  public/hardware/feed/head.json             cells, anchors (eye-relative, desk level), crop, scale, eye height
Frames: window px of the 1440 x 900 reference window; d (DOM) = head-unit px, desk-level anchor (0, ANCHOR_Y) = slot.
  python3 pack.py"""
import glob, json, os
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'public', 'hardware', 'feed', open(os.path.join(HERE, 'version.txt')).read().strip())
ANCHOR_Y = 147.92          # the printer's front at the desk (model y -147.92) in head-unit px
EYE_REF = (720.0, 1380.0)
HOLD = 260.0


def lin(c):
    c = np.asarray(c, np.float64); return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


os.makedirs(PUB, exist_ok=True)
man = {'scale': 2.0, 'anchor_y': ANCHOR_Y, 'eye_front': 480.0, 'themes': {}}
OUT = os.path.join(HERE, 'out')
for theme in ('light', 'dark'):
    D = os.path.join(HERE, 'layers', theme)
    names = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(D, 'L*.json')))
    if not names:
        continue
    metas = [json.load(open(os.path.join(D, n + '.json'))) for n in names]
    sc = metas[0]['scale']; cw, ch = int(metas[0]['crop'][2] * sc), int(metas[0]['crop'][3] * sc)
    cols = 2; rows = (len(names) + 1) // 2
    col = np.zeros((rows * ch, cols * cw, 4), np.uint8); aux = np.zeros((rows * ch, cols * cw, 3), np.uint8)
    cells = []; zmax = 0.0
    for k, (n, m) in enumerate(zip(names, metas)):
        i, j = k % cols, k // cols
        c = np.asarray(Image.open(os.path.join(D, n + '_c.png')).convert('RGBA'))
        h = np.asarray(Image.open(os.path.join(D, n + '_h.png')))
        s = np.asarray(Image.open(os.path.join(D, n + '_s.png')).resize((cw, ch), Image.BILINEAR))
        col[j * ch:(j + 1) * ch, i * cw:(i + 1) * cw] = c; zmax = max(zmax, float(h.max()) * metas[0]['zs'] / 255)
        aux[j * ch:(j + 1) * ch, i * cw:(i + 1) * cw, 0] = h; aux[j * ch:(j + 1) * ch, i * cw:(i + 1) * cw, 1] = s
        sx, sy = m['slot']; x0, y0 = m['crop'][0], m['crop'][1]
        cells.append(dict(name=n, cell=[i * cw, j * ch], e=[sx - EYE_REF[0], sy - EYE_REF[1]],
                          o=[x0 - sx, y0 - sy + ANCHOR_Y], head=m['head']))
    Image.fromarray(col).save(os.path.join(PUB, 'head-%s-c.webp' % theme), quality=92, alpha_quality=100, method=6)
    # height and shadow at 1x (the warp moves pixels 3px at most; the shadow is soft), lossless
    ah = Image.fromarray(aux).resize((cols * cw // 2, rows * ch // 2), Image.BILINEAR)
    ah.save(os.path.join(PUB, 'head-%s-a.webp' % theme), lossless=True, method=6)
    # static fallback: the render nearest the hold line, colour over its shadow (shadow as black at the alpha that
    # darkens the theme's desk by the linear-light fraction)
    k = min(range(len(metas)), key=lambda q: abs(metas[q]['head'][1] - HOLD))
    n = names[k]
    c = np.asarray(Image.open(os.path.join(D, n + '_c.png')).convert('RGBA')).astype(np.float64) / 255
    s = np.asarray(Image.open(os.path.join(D, n + '_s.png')).resize((cw, ch), Image.BILINEAR)).astype(np.float64) / 255
    g = json.load(open(os.path.join(HERE, 'ground.json')))[theme]
    gl = lin(g).mean(); gs = np.mean(g)
    sa = 1 - srgb(gl * (1 - s)) / gs
    a = c[..., 3] + (1 - c[..., 3]) * sa
    rgb = np.where(a[..., None] > 1e-4, c[..., :3] * c[..., 3:4] / np.maximum(a, 1e-4)[..., None], 0)
    fb = (np.dstack([rgb, a]) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(fb).save(os.path.join(PUB, 'head-%s-2x.png' % theme), optimize=True)
    Image.fromarray(fb).resize((cw // 2, ch // 2), Image.LANCZOS).save(os.path.join(PUB, 'head-%s-1x.png' % theme), optimize=True)
    # the roller's turn: frames side by side, straight alpha (build.py ROLL)
    rm = json.load(open(os.path.join(OUT, 'roll_%s_roll.json' % theme)))
    fr = np.load(os.path.join(OUT, 'roll_%s_roll.npz' % theme))['frames'].astype(np.float64)
    al = np.clip(fr[..., 3], 0, 1); st = np.where(al[..., None] > 1e-4, fr[..., :3] / np.maximum(al, 1e-4)[..., None], 0)
    fr = (np.concatenate([srgb(st), al[..., None]], -1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(np.concatenate(list(fr), 1)).save(os.path.join(PUB, 'roll-%s.png' % theme), optimize=True)
    rsx, rsy = rm['slot']
    roll = dict(n=rm['n'], size=[rm['crop'][2], rm['crop'][3]], o=[rm['crop'][0] - rsx, rm['crop'][1] - rsy + ANCHOR_Y],
                e=[rsx - EYE_REF[0], rsy - EYE_REF[1]], z=rm['z'] + 6.0)
    man['themes'][theme] = dict(atlas=[cols * cw, rows * ch], cell=[cw, ch], crop=[metas[0]['crop'][2], metas[0]['crop'][3]],
                                zs=metas[0]['zs'], zmax=round(zmax + 1.0, 1), eye_h=metas[0]['eye'][2], cells=cells,
                                fallback=dict(name=n, o=cells[k]['o']), ground=g, roll=roll)
    for f in ('roll-%s.png' % theme, 'head-%s-c.webp' % theme, 'head-%s-a.webp' % theme, 'head-%s-2x.png' % theme, 'head-%s-1x.png' % theme):
        print(f, os.path.getsize(os.path.join(PUB, f)) // 1024, 'KB')
json.dump(man, open(os.path.join(PUB, 'head.json'), 'w'), indent=1)
print('cells', len(man['themes'].get('light', {}).get('cells', [])))
# the page must point at this version's folder (the /hardware files are cached for good, so a re-render ships under a
# new folder name; docs/rendering.md)
V = os.path.basename(PUB); ROOT = os.path.dirname(os.path.dirname(HERE))
for f in ('app/(dashboard)/slips/slips.css', 'app/(dashboard)/slips/slip-lens.ts'):
    if '/hardware/feed/%s/' % V not in open(os.path.join(ROOT, f)).read():
        print('WARNING: %s does not point at /hardware/feed/%s/ yet' % (f, V))
