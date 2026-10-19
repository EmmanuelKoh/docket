#!/usr/bin/env python3
"""Deck renders (build.py HIDE_HEAD; tags from argv, default decka deckb) -> straight-alpha RGBA PNGs (deck/<theme>-<tag>.png) + meta
  python3 deckpost.py"""
import json, os, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); B = HERE; OUT = os.path.join(B, 'out')
sys.path.insert(0, B)
from compare import KV, KA  # noqa: E402
D = os.path.join(HERE, 'deck'); os.makedirs(D, exist_ok=True)


def srgb(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


for theme in ('light', 'dark'):
    for tag in (sys.argv[1:] or ['decka', 'deckb']):
        f = os.path.join(OUT, 'passes_%s_%s.npz' % (theme, tag))
        if not os.path.exists(f):
            continue
        z = np.load(f); P = {k: z[k].astype(np.float64) for k in z.files}
        C = P['Combined']; al = np.clip(C[..., 3], 0, 1)
        Gl = (P['GlossDir'][..., :3] + P['GlossInd'][..., :3]) * P['GlossCol'][..., :3]
        on, off = P['Vis_on'][..., :3].mean(-1), P['Vis_off'][..., :3].mean(-1)
        vis = np.where(off > 1e-4, np.clip(on / np.maximum(off, 1e-4), 0, 1), 1.0)
        ao = np.where(al > 1e-3, np.clip(P['AO'][..., :3].mean(-1) / np.maximum(al, 1e-3), 0, 1), 1.0)
        m = (1 - KV + KV * vis) * ao ** KA
        rgb = np.nan_to_num(C[..., :3] + Gl * (m - 1)[..., None])
        st = np.where(al[..., None] > 1e-4, rgb / np.maximum(al, 1e-4)[..., None], 0)
        Image.fromarray((np.dstack([srgb(st), al]) * 255 + 0.5).astype(np.uint8)).save(os.path.join(D, '%s-%s.png' % (theme, tag)))
        meta = json.load(open(os.path.join(OUT, 'meta_%s_%s.json' % (theme, tag))))
        json.dump(meta, open(os.path.join(D, '%s-%s.json' % (theme, tag)), 'w'), indent=1)
        print(theme, tag, C.shape, meta['crop'])
