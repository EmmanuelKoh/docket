# Shared geometry for build.py (Blender) and compare.py (python3): the shipped scenes' numbers and both projections.
# Model frame = carriage.py's world frame in CSS px (4 px = 1 mm): x from .sl-mech's left edge, y toward the top of
# the page (away from the viewer), z up from the desk. The oblique (shipped) drawing: screen y = -(y + K z).
K = 0.62
ZT = 58.0645            # carriage top plane / printer lid top (14.5 mm)
ZLEDGE = 16.129         # printer front ledge
AXZ = 44.0              # roller and motor axis height
Z_SUP = 40.3226         # rod support top
ROD_X, ROD_Z, ROD_R = 8.0, 24.1935, 8.0


def wy(s, z=ZT):
    """model y of a point drawn at head-unit screen y s at height z (carriage.py)"""
    return -s - K * z


AXY = wy(-40, AXZ)                                   # 12.72
Y_BACK, Y_BEAMF, Y_BEAMB, Y_CAPF, Y_LID = wy(-88), wy(-2), wy(-22), wy(112), wy(0)   # 52, -34, 14, -148, -36

# live page, 1440 x 900, printer pinned (shots/live-*.json): head-unit origin and the module box
import os
# HEAD_X / HEAD_Y / MECH_TOP / CROP from the environment place the scene elsewhere in the window (stage 3 renders)
HEAD = (float(os.environ.get('HEAD_X', '992')), float(os.environ.get('HEAD_Y', '260')))   # review fix 1: 257.6 was the beam front edge (s -2)
MECH_TOP, MECH_H = float(os.environ.get('MECH_TOP', HEAD[1] - 718.5)), float(os.environ.get('MECH_H', '1258.6'))
B = MECH_H

# shift-lens eye: window centre in x, 120 mm in front of the bottom edge, 550 mm up (window px)
EYE = (720.0, 900.0 + 480.0, 2200.0)


def fz(z):
    return EYE[2] / (EYE[2] - z)


# the model is placed so the head-unit origin on the top plane (x 0, s 0) projects to HEAD exactly
DX = (HEAD[0] - EYE[0]) / fz(ZT) + EYE[0] - HEAD[0]
DY = (EYE[1] + (HEAD[1] - EYE[1]) / fz(ZT)) - HEAD[1] + wy(0)


def plan(x, y):
    """model (x, y) -> window px of its foot on the desk"""
    return HEAD[0] + DX + x, HEAD[1] + DY - y


def to_model(wx, wyy):
    return wx - HEAD[0] - DX, HEAD[1] + DY - wyy


def proj(x, y, z):
    """model point -> window px through the shift-lens camera"""
    px, py = plan(x, y); F = fz(z)
    return EYE[0] + (px - EYE[0]) * F, EYE[1] + (py - EYE[1]) * F


def deck_y(m):
    """model y of a deck point at module y m (px from .sl-mech's top)"""
    return HEAD[1] + DY - (MECH_TOP + m)


def oblique(x, y, z, deck=False):
    """the live page's drawing of the same model point (sprites are oblique, head unit at HEAD)"""
    return HEAD[0] + x, HEAD[1] - (y + K * z) + (DY if deck else 0.0)


CROP = tuple(float(v) for v in os.environ['CROP'].split(',')) if 'CROP' in os.environ else (940, 100, 500, 740)   # window px: x0, y0, w, h
