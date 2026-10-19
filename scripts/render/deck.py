#!/usr/bin/env python3
"""Cut the deck's sprites (deckpost.py output for tags strip, supa, supb) into public/hardware/feed, 2x and 1x.
  feed-rod-*, feed-way-*   a strip as tall as the window (window y -40..1640) the page holds still while the deck
                           scrolls under it (background-attachment: fixed): the rod and the way are the same all along,
                           so the lamp's light on them belongs to the window, not to the page
  feed-support-t/b-*       each support (the rod a holdout that still casts), carrying only the shade the rod strip
                           under it lacks, so the two add up to the render where the page shows them
  feed-way-end-t/b-*       the way's two ends, 40px each
Shadow-only pixels are converted from the render's linear share of the light to the alpha that darkens the page's
ground by that share, and feathered to nothing at the sprites' sides. Module x 0 at desk level is window 922.5103."""
import json, os
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); PUB = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'public', 'hardware', 'feed', open(os.path.join(HERE, 'version.txt')).read().strip())
X0 = 922.5103
GROUND = json.load(open(os.path.join(HERE, 'ground.json')))


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def load(theme, tag):
    a = np.asarray(Image.open(os.path.join(HERE, 'deck', '%s-%s.png' % (theme, tag)))).astype(np.float64) / 255
    g = float(np.mean(GROUND[theme])); shadow = a[..., :3].max(-1) < 1e-3       # pure shadow: black at some alpha
    a[..., 3] = np.where(shadow, 1 - srgb(lin(g) * (1 - a[..., 3])) / g, a[..., 3])
    return np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]]), shadow          # premultiplied


def feather(p, shadow, n=16, sides='lrtb'):
    h, w = p.shape[:2]; f = np.ones((h, w))
    r = np.clip(np.arange(w) / n, 0, 1); c = np.clip(np.arange(h) / n, 0, 1)
    if 'l' in sides: f *= r[None, :]
    if 'r' in sides: f *= r[::-1][None, :]
    if 't' in sides: f *= c[:, None]
    if 'b' in sides: f *= c[::-1][:, None]
    f = np.where(shadow, f, 1.0); return p * f[..., None]


def unpremul(p):
    al = p[..., 3:4]; rgb = np.where(al > 1e-4, p[..., :3] / np.maximum(al, 1e-4), 0)
    return (np.dstack([rgb, al]) * 255 + 0.5).clip(0, 255).astype(np.uint8)


def save(p2, name, theme):
    Image.fromarray(unpremul(p2)).save(os.path.join(PUB, 'feed-%s-%s-2x.png' % (name, theme)), optimize=True)
    h, w = p2.shape[:2]
    p1 = np.dstack([np.asarray(Image.fromarray(p2[..., c].astype(np.float32)).resize((w // 2, h // 2), Image.LANCZOS))
                    for c in range(4)]).astype(np.float64).clip(0, 1)
    Image.fromarray(unpremul(p1)).save(os.path.join(PUB, 'feed-%s-%s-1x.png' % (name, theme)), optimize=True)


def cols(x0, x1, crop_x=898):
    c0 = int(round((x0 + X0 - crop_x) * 2)); c1 = int(round((x1 + X0 - crop_x) * 2))
    return c0, c1, round(crop_x + c0 / 2 - X0, 2)


def over_strip(p, shadow, strip, rows, c_off, on):
    """the support sprite carries only the shade the rod strip under it lacks: (1 - A_s)(1 - A_strip) = 1 - A_render
    for shadow pixels where the strip is drawn (rows: the strip's row for each sprite row, on: whether the strip's box
    covers that row; c_off: the sprite's column of the strip's first column)"""
    q = p.copy(); h, w = p.shape[:2]; sw = strip.shape[1]
    ar = np.zeros((h, w))
    for i in range(h):
        if on[i]:
            ar[i, c_off:c_off + sw] = strip[rows[i], :, 3]
    a = p[..., 3]; extra = np.where(ar > 0.995, 0.0, np.clip(1 - (1 - a) / np.maximum(1 - ar, 1e-3), 0, 1))
    q[..., 3] = np.where(shadow, extra, a)
    return q


os.makedirs(PUB, exist_ok=True)
boxes = {}
for theme in ('light', 'dark'):
    st, ss = load(theme, 'strip')                      # window y -40 .. 1640
    c0, c1, left = cols(-16, 56)
    rod = feather(st[:, c0:c1], ss[:, c0:c1], sides='lr'); save(rod, 'rod', theme); boxes['rod'] = dict(left=left, width=(c1 - c0) / 2)
    rod_left = left
    c0, c1, left = cols(328, 360)
    save(feather(st[:, c0:c1], ss[:, c0:c1], sides='lr'), 'way', theme); boxes['way'] = dict(left=left, width=(c1 - c0) / 2)
    a, sa = load(theme, 'supa')                        # window y 120..440, module top at 237
    b, sb = load(theme, 'supb')                        # window y 600..920, module bottom at 801
    ra = lambda m: int(round((237 + m - 120) * 2)); rb = lambda m: int(round((801 + m - 600) * 2))
    c0, c1, left = cols(-24, 100)
    off = int(round((rod_left - left) * 2))
    mt = np.arange(-100, 100, 0.5)[:2 * 200]            # module y of each 2x row
    t = over_strip(a[ra(-100):ra(100), c0:c1], sa[ra(-100):ra(100), c0:c1], rod,
                   np.round((237 + mt + 40) * 2).astype(int), off, mt >= 16)
    save(feather(t, sa[ra(-100):ra(100), c0:c1]), 'support-t', theme)
    mb = np.arange(-150, 60, 0.5)[:2 * 210]             # module y from the bottom
    u = over_strip(b[rb(-150):rb(60), c0:c1], sb[rb(-150):rb(60), c0:c1], rod,
                   np.round((801 + mb + 40) * 2).astype(int), off, mb < -16)
    save(feather(u, sb[rb(-150):rb(60), c0:c1]), 'support-b', theme)
    boxes['support'] = dict(left=left, width=(c1 - c0) / 2, t=dict(top=-100, height=200), b=dict(bottom=-60, height=210))
    c0, c1, left = cols(328, 360)
    save(a[ra(0):ra(40), c0:c1], 'way-end-t', theme); save(b[rb(-40):rb(0), c0:c1], 'way-end-b', theme)
print(boxes)
