# The Slips feed module in Blender: the carriage, printer, motor and drive, flat cable, rod and supports, way and
# shoe, and the desk, through the page's shift-lens camera (geo.py). docs/rendering.md explains the scene, the
# layers it writes and the rules behind them.
# usage: Blender -b --factory-startup --python build.py -- light|dark [samples 48] [scale 2] [tag]
#   with no mode env: one full render (passes in out/; then `python3 compare.py post <tag>`)
#   LAYERS=<head y,...>   the head unit's column (colour, lamp visibility, height, shadow) at those window heights
#   ROLL=<n>              the drive (tyre, boss, shafts, coupling, set screws) at n angles
#   HIDE_HEAD, HIDE_SUP, ROD_HOLD, PAPER=0   the deck renders (render-all.sh has the exact calls)
#   BK_EDGE=face          edges in each part's own material (what ships); unset keeps the old bright-cut edge band
import bpy, bmesh, sys, os, math, time, json
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
BK = HERE
sys.path.insert(0, HERE)
import geo as G  # noqa: E402

# ---- parts.py's helpers and materials (everything above its `if MODE` line; its argv parsing reads theme, samples)
_src = open(os.path.join(BK, 'parts.py')).read()
_src = _src[:_src.index("if MODE == 'proof'")]
_g = {'__name__': 'parts', '__file__': os.path.join(BK, 'parts.py')}
exec(compile(_src, os.path.join(BK, 'parts.py'), 'exec'), _g)
for _k in ('lin', 'pbsdf', 'principled', 'maprange', 'math_', 'machined', 'can_mat', 'cable_mat', 'make_mats', 'new_obj',
           'rpoly', 'prism', 'rbox', 'cyl_x', 'cyl_z', 'hex_drill', 'set_weights', 'add_bevel', 'setmats', 'add_bool',
           'apply_mods', 'finish', 'remove', 'setup_render', 'setup_world', 'np_image', 'clear'):
    globals()[_k] = _g[_k]
DDIFF, DBAND, RD, RL, LBAND = _g['DDIFF'], _g['DBAND'], _g['RD'], _g['RL'], _g['LBAND']
GA0, GA1 = _g['GA0'], _g['GA1']

ARGS = sys.argv[sys.argv.index('--') + 1:]
THEME = ARGS[0]
SAMPLES = int(ARGS[1]) if len(ARGS) > 1 else 48
SCALE = float(ARGS[2]) if len(ARGS) > 2 else 2.0
TAG = ARGS[3] if len(ARGS) > 3 else 'n%d' % SAMPLES
DARK = THEME == 'dark'
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
T0 = time.time()

K, ZT, AXZ, AXY, ZLEDGE = G.K, G.ZT, G.AXZ, G.AXY, G.ZLEDGE
wy = G.wy
Y_BACK, Y_BEAMF, Y_BEAMB, Y_CAPF, Y_LID = G.Y_BACK, G.Y_BEAMF, G.Y_BEAMB, G.Y_CAPF, G.Y_LID
ROD_X, ROD_Z, ROD_R, Z_SUP = G.ROD_X, G.ROD_Z, G.ROD_R, G.Z_SUP

# numbers (CSS px) -------------------------------------------------------------------------------------------
WIN = (-8.0, 26.0, wy(-26), wy(-80))                 # window x0 x1 y0 y1 (y -10..44), r6, floor z 14
FLOOR_Z = 14.0
POC = (34.0, 138.0, wy(-19), AXY + 16.6)             # saddle pocket, r6, floor at the axis
COV = (-12.0, 28.0, wy(110), wy(-18))                # bearing cover outline (y -146..-18), parting 0.25 each side
STRAP = dict(x0=68.0, x1=92.0, zt=AXZ + 19.2, yf=Y_BEAMF + 1.5); STRAP['yb'] = wy(-76, STRAP['zt'])
CAB = dict(x0=70.0, x1=90.0, y0=wy(-62), t=0.6, st=1.0, flat_to=44.0)
CAB['sy1'] = 79.25 - K * (ZT + CAB['t'] + CAB['st'])
SCREW_D = 10.0
PR = dict(x0=32.0, x1=372.0, yb=Y_LID, ylid=wy(60), yfront=-147.92)   # printer: lid top y 0..60, step 60..86
WAY = dict(x0=334.0, x1=354.0, s0=341.0, s1=347.0)
SLOT = dict(cx=80.0, hw=13.0)
DESK_LIN = dict(light=[0.54572, 0.54572, 0.50888], dark=[0.00605, 0.00605, 0.00605])   # compare.bg_lin
# step face and front: matched to the kit sprite's tone per theme (live lum 23 light, 22 dark)
FRONT_HEX = os.environ.get('FRONT_HEX', '#5a5753' if THEME == 'dark' else '#2e2c29')
TEAR_TILT = float(os.environ.get('TEAR_TILT', '28'))
ENV = lambda k, d: float(os.environ.get(k, d))
ENV_S = lambda k, d: os.environ.get(k, d)
# PR_ROOM and PR_BOUNCE paint light onto the moulding (a glow where it faces the viewer); off: only physical light
# (user, 2026-10-17: no painted-on highlights; the paper's real reflection comes in with the paper sheet)
PR_STIP, PR_ROOM, PR_MOTT = ENV('PR_STIP', '0.45'), ENV('PR_ROOM', '0.0'), ENV('PR_MOTT', '0.08')
ROD_HEX = os.environ.get('ROD_HEX', '#b8babc' if THEME == 'light' else '#b0b2b4')
ROD_RO, ROD_AN, ROD_DF = ENV('ROD_RO', '0.3'), ENV('ROD_AN', '0.6'), ENV('ROD_DF', '0.12')
BR_D0, BR_D1 = ENV('BR_D0', '3.0'), ENV('BR_D1', '1.5')
PR_SPEC = float(os.environ.get('PR_SPEC', '0.22'))
Y_TOP_END, Y_BOT_END = G.deck_y(8.0), G.deck_y(G.B - 8.0)   # deck parts end 8 px in from the module's ends


# ---- extra helpers -----------------------------------------------------------------------------------------
def cyl_y(name, cx, cz, R, y0, y1, seg=96):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=R, radius2=R, depth=y1 - y0)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    bmesh.ops.translate(bm, vec=(cx, (y0 + y1) / 2, cz), verts=bm.verts)
    return new_obj(name, bm)


def prism_y(name, poly_xz, y0, y1):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y0, z)) for x, z in poly_xz]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    vv = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, y1 - y0, 0), verts=vv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_obj(name, bm)


def ellipsoid(name, c, r):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1.0, location=c)
    ob = bpy.context.active_object; ob.name = name; ob.scale = r
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return ob


def torus_y(name, cx, cy, cz, R, r):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=96, minor_segments=16,
                                     location=(cx, cy, cz), rotation=(math.radians(90), 0, 0))
    ob = bpy.context.active_object; ob.name = name; return ob


def mat_of(ob, m):
    ob.data.materials.clear(); ob.data.materials.append(m); return ob


def moulded(name, base='#1e1d1b', radius=1.6, front=None):
    """study.py's moulded(): near-black plastic, Bevel-shader edge break shaded as a lit chamfer (px units)."""
    edge, ediff, dhex = '#c8c8c5', DDIFF, '#f2f2ee'
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    face = principled(nt, base, 0.0, 0.5, PR_SPEC)
    geo0 = nt.nodes.new('ShaderNodeNewGeometry')
    if front:
        # textured vertical faces (step face, front): lighter matte finish on faces turned toward the viewer
        sy = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo0.outputs['True Normal'], sy.inputs[0])
        fy = maprange(nt, math_(nt, 'MULTIPLY', sy.outputs['Y'], -1.0), 0.3, 0.9, 0.0, 1.0)
        mxc = nt.nodes.new('ShaderNodeMix'); mxc.data_type = 'RGBA'
        mxc.inputs[6].default_value = lin(base) + [1]; mxc.inputs[7].default_value = lin(front) + [1]
        nt.links.new(fy, mxc.inputs[0]); nt.links.new(mxc.outputs[2], face.inputs['Base Color'])
    bev = nt.nodes.new('ShaderNodeBevel'); bev.samples = 8; bev.inputs['Radius'].default_value = radius
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    nt.links.new(bev.outputs['Normal'], face.inputs['Normal'])
    tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 0.03; nz.inputs['Detail'].default_value = 2
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    # pass2: moulded stipple = irregular domes (Voronoi F1 on noise-warped coords, cells ~0.6 px) + a finer grain;
    # gloss varies broadly (40 px blotches) and a little per dome
    wn = nt.nodes.new('ShaderNodeTexNoise'); wn.inputs['Scale'].default_value = 0.7; wn.inputs['Detail'].default_value = 2
    nt.links.new(tc.outputs['Object'], wn.inputs['Vector'])
    wv = nt.nodes.new('ShaderNodeVectorMath'); wv.operation = 'MULTIPLY_ADD'
    nt.links.new(wn.outputs['Color'], wv.inputs[0]); wv.inputs[1].default_value = (0.5, 0.5, 0.5); nt.links.new(tc.outputs['Object'], wv.inputs[2])
    vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'F1'; vor.inputs['Scale'].default_value = ENV('PR_VS', '1.6')
    vor.inputs['Randomness'].default_value = 1.0; nt.links.new(wv.outputs['Vector'], vor.inputs['Vector'])
    dome = maprange(nt, vor.outputs['Distance'], 0.0, 0.5, 1.0, 0.0)
    rs = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(vor.outputs['Color'], rs.inputs[0])
    rgh = math_(nt, 'ADD', maprange(nt, nz.outputs['Factor'], 0.3, 0.7, 0.44, 0.54), maprange(nt, rs.outputs[0], 0.0, 1.0, -0.04, 0.04))
    nt.links.new(rgh, face.inputs['Roughness'])
    nzs = nt.nodes.new('ShaderNodeTexNoise'); nzs.inputs['Scale'].default_value = 3.1; nzs.inputs['Detail'].default_value = 2
    nt.links.new(tc.outputs['Object'], nzs.inputs['Vector'])
    hgt = math_(nt, 'ADD', math_(nt, 'MULTIPLY', dome, 0.75), math_(nt, 'MULTIPLY', nzs.outputs['Factor'], 0.25))
    bmp = nt.nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = PR_STIP; bmp.inputs['Distance'].default_value = 0.06
    nt.links.new(hgt, bmp.inputs['Height']); nt.links.new(bmp.outputs['Normal'], bev.inputs['Normal'])
    # mottle (ALBN 4% at 0.7 px)
    nzm = nt.nodes.new('ShaderNodeTexNoise'); nzm.inputs['Scale'].default_value = 0.9; nzm.inputs['Detail'].default_value = 2
    nt.links.new(tc.outputs['Object'], nzm.inputs['Vector'])
    bc = face.inputs['Base Color']
    srcc = bc.links[0].from_socket if bc.links else None
    mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'SCALE'
    if srcc is not None: nt.links.new(srcc, mul.inputs[0])
    else: mul.inputs[0].default_value = tuple(bc.default_value[:3])
    nt.links.new(maprange(nt, nzm.outputs['Factor'], 0.3, 0.7, 1.0 - PR_MOTT, 1.0 + PR_MOTT), mul.inputs['Scale'])
    nt.links.new(mul.outputs['Vector'], bc)
    if os.environ.get('BK_EDGE') == 'face':      # the moulded edge keeps the plastic: only real light lights it
        mo = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        nt.links.new(face.outputs['BSDF'], mo.inputs['Surface'])
        return m
    vm = lambda op: (lambda n: (setattr(n, 'operation', op), n)[1])(nt.nodes.new('ShaderNodeVectorMath'))
    d0 = vm('DOT_PRODUCT'); nt.links.new(bev.outputs['Normal'], d0.inputs[0]); nt.links.new(geo.outputs['True Normal'], d0.inputs[1])
    sc0 = vm('SCALE'); nt.links.new(geo.outputs['True Normal'], sc0.inputs[0]); nt.links.new(d0.outputs['Value'], sc0.inputs['Scale'])
    sb = vm('SUBTRACT'); nt.links.new(bev.outputs['Normal'], sb.inputs[0]); nt.links.new(sc0.outputs['Vector'], sb.inputs[1])
    n1 = vm('NORMALIZE'); nt.links.new(sb.outputs['Vector'], n1.inputs[0])
    ad = vm('ADD'); nt.links.new(geo.outputs['True Normal'], ad.inputs[0]); nt.links.new(n1.outputs['Vector'], ad.inputs[1])
    n2 = vm('NORMALIZE'); nt.links.new(ad.outputs['Vector'], n2.inputs[0])
    en = n2.outputs['Vector']
    eg = principled(nt, edge, 1.0, 0.08); nt.links.new(en, eg.inputs['Normal'])
    df = nt.nodes.new('ShaderNodeBsdfDiffuse'); df.inputs['Color'].default_value = lin(dhex) + [1]
    nt.links.new(en, df.inputs['Normal'])
    mx = nt.nodes.new('ShaderNodeMixShader'); mx.inputs[0].default_value = ediff
    nt.links.new(eg.outputs['BSDF'], mx.inputs[1]); nt.links.new(df.outputs[0], mx.inputs[2])
    dot = vm('DOT_PRODUCT'); nt.links.new(bev.outputs['Normal'], dot.inputs[0]); nt.links.new(geo.outputs['True Normal'], dot.inputs[1])
    dev = math_(nt, 'SUBTRACT', 1.0, dot.outputs['Value'])
    mask = maprange(nt, dev, DBAND[0], DBAND[1], 0.0, 1.0)
    # review fix 4: only edges turned toward the key get the light chamfer, clamp(2 dot(bevelN, keyDir), 0, 1)
    loc, _, _ = lamp_pose(); kd = (loc - Vector((200.0, -90.0, 30.0))).normalized()
    dk = vm('DOT_PRODUCT'); nt.links.new(bev.outputs['Normal'], dk.inputs[0]); dk.inputs[1].default_value = kd
    mask = math_(nt, 'MULTIPLY', mask, maprange(nt, dk.outputs['Value'], 0.0, 0.5, 0.0, 1.0))
    mask = math_(nt, 'MULTIPLY', mask, ENV('PR_CHF', '0.0'))          # pass2: real radii carry the edges
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mask, mix.inputs[0]); nt.links.new(face.outputs['BSDF'], mix.inputs[1]); nt.links.new(mx.outputs[0], mix.inputs[2])
    # the room sheen (gen_deep ROOM, peak where the surface tilts ~44 deg toward the viewer): the lit lips
    sn = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(bev.outputs['Normal'], sn.inputs[0])
    ph = math_(nt, 'ARCTAN2', math_(nt, 'MULTIPLY', sn.outputs['Y'], -1.0), sn.outputs['Z'])
    gq = math_(nt, 'DIVIDE', math_(nt, 'SUBTRACT', ph, 0.768), 0.28)
    ga = math_(nt, 'EXPONENT', math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', gq, gq), -0.5))
    gx = math_(nt, 'POWER', math_(nt, 'SUBTRACT', 1.0, math_(nt, 'ABSOLUTE', sn.outputs['X'])), 2.0)
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (1.0, 0.975, 0.93, 1)
    nt.links.new(math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', ga, gx), PR_ROOM), em.inputs['Strength'])
    sz = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sz.inputs[0])
    bz = math_(nt, 'MULTIPLY', maprange(nt, sz.outputs['Z'], ZT - 3.0, ZLEDGE + 1.0, 0.0, 1.0), maprange(nt, sz.outputs['Z'], ZLEDGE + 0.1, ZLEDGE + 0.6, 0.0, 1.0))
    bz = math_(nt, 'MULTIPLY', bz, maprange(nt, math_(nt, 'MULTIPLY', sn.outputs['Y'], -1.0), 0.6, 0.9, 0.0, 1.0))
    nt.links.new(math_(nt, 'ADD', math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', ga, gx), PR_ROOM), math_(nt, 'MULTIPLY', bz, ENV('PR_BOUNCE', '0.0'))), em.inputs['Strength'])
    ad = nt.nodes.new('ShaderNodeAddShader'); nt.links.new(mix.outputs[0], ad.inputs[0]); nt.links.new(em.outputs[0], ad.inputs[1])
    nt.links.new(ad.outputs[0], out.inputs['Surface'])
    return m


def with_diffuse(m, hexcol, share):
    nt = m.node_tree; out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    src = out.inputs['Surface'].links[0].from_socket
    df = nt.nodes.new('ShaderNodeBsdfDiffuse'); df.inputs['Color'].default_value = lin(hexcol) + [1]
    mx = nt.nodes.new('ShaderNodeMixShader'); mx.inputs[0].default_value = share
    nt.links.new(src, mx.inputs[1]); nt.links.new(df.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], out.inputs['Surface'])
    return m


def mixc(nt, fac, a, b):
    n = nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'
    for i, v in ((6, a), (7, b)):
        if isinstance(v, str): n.inputs[i].default_value = lin(v) + [1]
        else: nt.links.new(v, n.inputs[i])
    if isinstance(fac, (int, float)): n.inputs[0].default_value = fac
    else: nt.links.new(fac, n.inputs[0])
    return n.outputs[2]


def objxyz(nt, scale=None):
    tc = nt.nodes.new('ShaderNodeTexCoord'); v = tc.outputs['Object']
    if scale:
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = scale; nt.links.new(v, mp.inputs['Vector']); v = mp.outputs['Vector']
    return v


def noise(nt, vec, scale, detail=4):
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = detail
    nt.links.new(vec, nz.inputs['Vector']); return nz.outputs['Factor']


def newmat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    return m, nt, nt.nodes.new('ShaderNodeOutputMaterial')


def rod_mat():
    """ground steel (lab mat_ground-steel.py): crisp across the rod, haze along it, a little diffuse, a lengthwise grind"""
    m, nt, out = newmat('rod'); b = principled(nt, ROD_HEX, 1.0, ROD_RO)
    b.inputs['Anisotropic'].default_value = ROD_AN
    t = nt.nodes.new('ShaderNodeCombineXYZ'); t.inputs[1].default_value = 1.0; nt.links.new(t.outputs[0], b.inputs['Tangent'])
    g = maprange(nt, noise(nt, objxyz(nt, (5.0, 0.06, 5.0)), 1.0, 6), 0.3, 0.7, 0.0, 1.0)
    nt.links.new(mixc(nt, g, '#8e9092', ROD_HEX), b.inputs['Base Color'])
    nt.links.new(maprange(nt, g, 0.0, 1.0, ROD_RO + 0.05, ROD_RO - 0.03), b.inputs['Roughness'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    return with_diffuse(m, '#b4b6b8', ROD_DF)


def tyre_mat():
    """black PU tread; a worn band round the middle where it rides on the rod: a touch lighter and glossier, scuffed round the turn"""
    m, nt, out = newmat('tyre'); b = principled(nt, '#2a2a29', 0.0, 0.62, 0.35)
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(objxyz(nt), sep.inputs[0])
    ax = math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', sep.outputs['X'], ROD_X))
    band = maprange(nt, ax, 2.2, 4.8, 1.0, 0.0)
    sc = maprange(nt, noise(nt, objxyz(nt, (3.2, 0.35, 0.35)), 1.0, 6), 0.35, 0.65, 0.35, 1.0)
    w = math_(nt, 'MULTIPLY', band, sc)
    nt.links.new(mixc(nt, math_(nt, 'MULTIPLY', w, 0.85), '#2a2a29', '#42423f'), b.inputs['Base Color'])
    nt.links.new(maprange(nt, w, 0.0, 1.0, 0.62, 0.36), b.inputs['Roughness'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface']); return m


def way_mat():
    """lapped steel lands (deck3 D4): fine lengthwise grain, a polished track either side of the slot where the shoe
    rides, the left edge's lit break"""
    base = '#adb0b3' if not DARK else '#505152'
    m, nt, out = newmat('way'); b = principled(nt, base, 0.85, 0.42, 0.5)
    b.inputs['Anisotropic'].default_value = 0.4
    t = nt.nodes.new('ShaderNodeCombineXYZ'); t.inputs[1].default_value = 1.0; nt.links.new(t.outputs[0], b.inputs['Tangent'])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(objxyz(nt), sep.inputs[0]); x = sep.outputs['X']
    g = maprange(nt, noise(nt, objxyz(nt, (6.0, 1.0, 6.0)), 1.0, 6), 0.3, 0.7, 0.0, 1.0)
    f = maprange(nt, noise(nt, objxyz(nt), 5.0, 2), 0.35, 0.65, 0.0, 1.0)
    ax = math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', x, 0.5 * (WAY['s0'] + WAY['s1'])))
    trk = math_(nt, 'MULTIPLY', maprange(nt, ax, 3.1, 3.6, 0.0, 1.0), maprange(nt, ax, 5.6, 6.4, 1.0, 0.0))
    trk = math_(nt, 'MULTIPLY', trk, maprange(nt, g, 0.0, 1.0, 0.75, 1.0))
    c = mixc(nt, math_(nt, 'ADD', math_(nt, 'MULTIPLY', g, 0.55), math_(nt, 'MULTIPLY', f, 0.45)),
             '#8f9295' if not DARK else '#3f4042', '#c8cbce' if not DARK else '#5c5d5f')
    c = mixc(nt, math_(nt, 'MULTIPLY', trk, 0.55), c, '#d2d4d6' if not DARK else '#68696b')
    edge = maprange(nt, x, WAY['x0'], WAY['x0'] + 0.6, 1.0, 0.0)
    c = mixc(nt, edge, c, '#f4f4f4' if not DARK else '#c4c4c4')
    nt.links.new(c, b.inputs['Base Color'])
    r = math_(nt, 'SUBTRACT', maprange(nt, g, 0.0, 1.0, 0.38, 0.48), math_(nt, 'MULTIPLY', trk, 0.2))
    nt.links.new(math_(nt, 'SUBTRACT', r, math_(nt, 'MULTIPLY', edge, 0.2)), b.inputs['Roughness'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface']); return m


def bristle_mat():
    """black nylon filaments (lab mat_brush.py): a glossy coat on round strands, glossier and duller strands, the
    tips hazed"""
    m, nt, out = newmat('brush'); b = principled(nt, '#060606', 0.0, 0.35, 0.5)
    hi = nt.nodes.new('ShaderNodeHairInfo')
    tip = maprange(nt, hi.outputs['Intercept'], 0.82, 1.0, 0.0, 1.0)
    rnd = hi.outputs['Random']
    nt.links.new(mixc(nt, math_(nt, 'MULTIPLY', tip, 0.85), mixc(nt, rnd, '#060606', '#121212'), '#3c3c3c'), b.inputs['Base Color'])
    b.inputs['Specular IOR Level'].default_value = 0.65
    nt.links.new(math_(nt, 'ADD', maprange(nt, rnd, 0.0, 1.0, 0.14, 0.5), math_(nt, 'MULTIPLY', tip, 0.3)), b.inputs['Roughness'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface']); return m


def ffc_mat():
    """pass2: amber polyimide FFC. Semi-gloss film (soft coat), the copper conductors (1.2 px on a 2 px pitch) faint
    through it, a little thickness variation in the gloss"""
    m, nt, out = newmat('cable'); film = ENV_S('FFC_HEX', '#963c00')
    b = principled(nt, film, 0.0, ENV('FFC_RO', '0.4'), 0.4, ENV('FFC_CW', '0.8'), ENV('FFC_CR', '0.1'))
    b.inputs['Coat IOR'].default_value = 1.55
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(objxyz(nt), sep.inputs[0]); x = sep.outputs['X']
    d = math_(nt, 'PINGPONG', math_(nt, 'SUBTRACT', x, CAB['x0'] + 2.0), 1.0)
    cm = maprange(nt, d, 0.45, 0.75, 1.0, 0.0)
    cm = math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', cm, maprange(nt, x, CAB['x0'] + 1.2, CAB['x0'] + 1.5, 0.0, 1.0)),
               maprange(nt, x, CAB['x1'] - 1.5, CAB['x1'] - 1.2, 1.0, 0.0))
    nt.links.new(mixc(nt, math_(nt, 'MULTIPLY', cm, ENV('FFC_CU', '0.4')), film, '#bc5c12'), b.inputs['Base Color'])
    nt.links.new(math_(nt, 'MULTIPLY', cm, 0.1), b.inputs['Metallic'])
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.12; bu.inputs['Distance'].default_value = 0.03
    nt.links.new(cm, bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    nz = noise(nt, objxyz(nt), 0.12, 2)
    nt.links.new(maprange(nt, nz, 0.3, 0.7, 0.08, 0.13), b.inputs['Coat Roughness'])
    # thin polyimide passes light: a little amber translucency so the lamp-lit back leg glows through
    tr = nt.nodes.new('ShaderNodeBsdfTranslucent'); tr.inputs['Color'].default_value = lin('#c86a12') + [1]
    mx = nt.nodes.new('ShaderNodeMixShader'); mx.inputs[0].default_value = ENV('FFC_TR', '0.18')
    nt.links.new(b.outputs['BSDF'], mx.inputs[1]); nt.links.new(tr.outputs[0], mx.inputs[2])
    # pass2: the room's soft light on the film where the loop tilts toward the viewer: broad, following the bend
    nt.links.new(room_sheen(nt, mx.outputs[0], ENV('FFC_RP', '0.6'), ENV('FFC_RW', '0.35'), ENV('FFC_ROOM', '0.0'), (1.0, 0.8, 0.6)), out.inputs['Surface']); return m


def room_sheen(nt, bsdf_out, peak, width, strength, col=(1.0, 0.975, 0.93)):
    """the room's soft front light as in moulded(): emission where the shading normal tilts `peak` rad from up toward
    the viewer (gaussian `width`), fading as the normal turns sideways; added to bsdf_out"""
    g = nt.nodes.new('ShaderNodeNewGeometry'); sn = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(g.outputs['Normal'], sn.inputs[0])
    ph = math_(nt, 'ARCTAN2', math_(nt, 'MULTIPLY', sn.outputs['Y'], -1.0), sn.outputs['Z'])
    gq = math_(nt, 'DIVIDE', math_(nt, 'SUBTRACT', ph, peak), width)
    ga = math_(nt, 'EXPONENT', math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', gq, gq), -0.5))
    gx = math_(nt, 'POWER', math_(nt, 'SUBTRACT', 1.0, math_(nt, 'ABSOLUTE', sn.outputs['X'])), 2.0)
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = tuple(col) + (1,)
    nt.links.new(math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', ga, gx), strength), em.inputs['Strength'])
    ad = nt.nodes.new('ShaderNodeAddShader'); nt.links.new(bsdf_out, ad.inputs[0]); nt.links.new(em.outputs[0], ad.inputs[1])
    return ad.outputs[0]


def aniso_metal(name, hexcol, rough, aniso, axis):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = principled(nt, hexcol, 1.0, rough)
    b.inputs['Anisotropic'].default_value = aniso
    t = nt.nodes.new('ShaderNodeCombineXYZ'); t.inputs[axis].default_value = 1.0
    nt.links.new(t.outputs[0], b.inputs['Tangent'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface']); return m


def brush_mat(name, base):
    """nylon bristles across the slot from each wall, parting on the centre line (review fix 7: visible strands,
    dark roots at the walls, lighter tips at the parting, rougher anisotropic sheen along the strands)"""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = principled(nt, base, 0.0, 0.65, 0.15)
    b.inputs['Anisotropic'].default_value = 0.6
    tx = nt.nodes.new('ShaderNodeCombineXYZ'); tx.inputs[0].default_value = 1.0; nt.links.new(tx.outputs[0], b.inputs['Tangent'])
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.07, 0.45, 1.0)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.0; nz.inputs['Detail'].default_value = 6
    nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 1.0; bu.inputs['Distance'].default_value = 0.6
    nt.links.new(nz.outputs['Factor'], bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
    ax = math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', sep.outputs['X'], SLOT['cx']))
    part = maprange(nt, ax, 0.25, 0.9, 0.35, 1.0)
    root = maprange(nt, ax, 1.0, SLOT['hw'] - 1.0, 0.0, 1.0)          # 0 at the tips (centre), 1 at the roots (walls)
    mc = nt.nodes.new('ShaderNodeMix'); mc.data_type = 'RGBA'
    mc.inputs[6].default_value = lin('#262626') + [1]; mc.inputs[7].default_value = lin('#050505') + [1]
    nt.links.new(root, mc.inputs[0])
    strand = maprange(nt, nz.outputs['Factor'], 0.38, 0.62, 0.05, 1.7)   # tufts with dark gaps between
    sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'
    nt.links.new(mc.outputs[2], sc.inputs[0]); nt.links.new(math_(nt, 'MULTIPLY', part, strand), sc.inputs['Scale'])
    nt.links.new(sc.outputs['Vector'], b.inputs['Base Color'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface']); return m


def make_all_mats():
    M = make_mats(THEME)            # face, strap, wall, can, rim, shaft, cpl, cap, leadA/B, grom, oxide, screwrim, cable, stiff
    if not DARK:
        edge = ('#e8e9ea', 0.14, 0.2, '#e8e9ea')
        M['sup'] = machined('sup', '#cfd1d3', 0.6, 0.55, 0.5, edge, Z_SUP, RL, grain=(3.1, 0.45, 0.65, GA0, GA1), band=LBAND)
        # change 1: the bearing cover is a separate black-anodized part on the satin carriage
        M['cover'] = machined('cover', '#1f1e1d', 0.0, 0.55, 0.4, ('#c8c8c5', 0.08, DDIFF, '#f2f2ee'), ZT, RD,
                              chamfer=True, band=DBAND)
        M['way'] = machined('way', '#8e9194', 0.85, 0.42, 0.5, ('#d8dadc', 0.12, 0.2, '#e0e2e4'), 0.05, 0.5, band=LBAND)
    else:
        edge = ('#c8c8c5', 0.08, DDIFF, '#f2f2ee')
        M['sup'] = machined('sup', '#1f1e1d', 0.0, 0.55, 0.4, edge, Z_SUP, RD, chamfer=True, band=DBAND)
        # change 1, dark: a slightly deeper, glossier black so the cover reads as its own part on the anodized carriage
        M['cover'] = machined('cover', '#131313', 0.0, 0.42, 0.45, edge, ZT, RD, chamfer=True, band=DBAND)
        M['way'] = machined('way', '#4b4c4d', 0.8, 0.45, 0.5, ('#9a9c9e', 0.12, 0.2, '#a0a2a4'), 0.05, 0.5, band=LBAND)
    # screwed-on parts take the opposite finish to the carriage (user, 2026-10-17): the bearing cover and the motor
    # strap are black anodize on the satin carriage, and satin aluminium on the black-anodized one
    sat_edge, blk_edge = ('#e8e9ea', 0.14, 0.2, '#e8e9ea'), ('#c8c8c5', 0.08, DDIFF, '#f2f2ee')
    if not DARK:
        M['strap'] = machined('strap', '#1f1e1d', 0.0, 0.55, 0.4, blk_edge, STRAP['zt'], RD, chamfer=True, band=DBAND)
    else:
        M['cover'] = machined('cover', '#cfd1d3', 0.6, 0.55, 0.5, sat_edge, ZT, RL, grain=(3.7, 0.45, 0.65, GA0, GA1),
                              band=LBAND)
        M['strap'] = machined('strap', '#cfd1d3', 0.6, 0.55, 0.5, sat_edge, STRAP['zt'], RL,
                              grain=(7.3, 0.45, 0.65, GA0, GA1), band=LBAND)
    M['floor'] = pbsdf('floor', '#121110' if not DARK else '#0b0b0a', 0.0, 0.7, 0.3)
    M['rod'] = aniso_metal('rod', '#d6d8db' if not DARK else '#b9bbbe', 0.16, 0.5, 1)
    M['tyre'] = pbsdf('tyre', '#2a2a29', 0.0, 0.62, 0.35)
    M['boss'] = pbsdf('boss', '#c4c5c3' if not DARK else '#b0b1af', 1.0, 0.22)
    M['bronze'] = pbsdf('bronze', '#b08a5c', 1.0, 0.25)
    M['seal'] = pbsdf('seal', '#141312', 0.0, 0.5, 0.4)
    M['acetal'] = pbsdf('acetal', '#f2f0ea' if not DARK else '#d9d7d1', 0.0, 0.45, 0.4)
    M['wayslot'] = pbsdf('wayslot', '#3e3f3e' if not DARK else '#363736', 0.9, 0.3)
    M['brush'] = brush_mat('brush', '#0b0b0b')
    M['sub'] = pbsdf('sub', '#0c0c0c', 0.0, 0.8, 0.2)
    M['printer'] = moulded('printer', '#161513', radius=0.7)   # one material on every face: no colour by facing
    M['pseam'] = pbsdf('pseam', '#0e0d0c', 0.0, 0.6, 0.3)
    M['pslot'] = pbsdf('pslot', '#100f0e', 0.0, 0.7, 0.2)
    M['metal'] = pbsdf('metal', '#6a6761', 1.0, 0.32)
    M['tear'] = aniso_metal('tear', '#c4c2bc', 0.35, 0.6, 0)
    # fix8: the reviewed regressions
    M['rod'] = rod_mat(); M['tyre'] = tyre_mat(); M['way'] = way_mat(); M['brush'] = bristle_mat(); M['cable'] = ffc_mat()
    M['bronze'] = with_diffuse(pbsdf('bronze', '#d6ad6a', 1.0, 0.36), '#b08a5c', 0.18)
    M['seal'] = pbsdf('seal', '#0b0a0a', 0.0, 0.75, 0.1)
    M['seallip'] = pbsdf('seallip', '#0b0a0a', 0.0, 0.42, 0.3)
    M['holder'] = pbsdf('holder', '#55575a' if not DARK else '#3c3d3f', 0.75, 0.3)
    M['tear'] = aniso_metal('tear', ENV_S('TEAR_HEX', '#b4b2ad'), ENV('TEAR_RO', '0.3'), 0.6, 0)   # stamped stainless
    M['stiff'] = pbsdf('stiff', '#0e0e0d', 0.0, 0.8, 0.25)
    # pass2: the tear bar's rolled top edge catches the room light as a narrow line (the bar itself stays in shadow)
    tnt = M['tear'].node_tree; tout = [n for n in tnt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    tnt.links.new(room_sheen(tnt, tout.inputs['Surface'].links[0].from_socket, 0.768, ENV('TEAR_RW', '0.14'),
                             ENV('TEAR_ROOM', '0.0'), (0.95, 0.95, 0.94)), tout.inputs['Surface'])                                       # matte black stiffener
    M['catcher'] = pbsdf('catcher', '#000000', 0.0, 0.85, 0.3)
    M['catcher'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = DESK_LIN[THEME] + [1]
    return M


# ---- parts --------------------------------------------------------------------------------------------------
SCREWS = []      # (part, x, y, z top) for the joint audit


def screw(M, cx, cy, zface, sink, ang, joint, D=SCREW_D):
    k = 0.55 * D; zt = zface - sink; zb = zt - k
    h = cyl_z('screw', cx, cy, D / 2, zb, zt, seg=96, wt=1.0); setmats(h, [M['oxide'], M['screwrim']])
    add_bevel(h, 0.1 * D, 3, edge_mat=1)
    hexc = hex_drill('hex', cx, cy, (0.5 * D) / math.sqrt(3), zt, 0.6 * k, ang)
    add_bool(h, hexc); finish(h, [M['oxide'], M['screwrim']]); remove([hexc])
    SCREWS.append(dict(joint=joint, x=cx, y=round(cy, 2), z=round(zt, 2), D=D))
    return h


def cbore(cx, cy, zface, sink, D=SCREW_D, gap=0.7):
    return cyl_z('cbore', cx, cy, D / 2 + gap, zface - sink - 0.55 * D - 0.3, zface + 3, seg=64)


def build_carriage(M, objs):
    # casting: cap, extension, beam, right end in one plan; r3 outside, r6 inside at (144, 14), r1.5 beside the lid
    L = [(-14, Y_CAPF), (30, Y_CAPF), (30, Y_BEAMF), (372, Y_BEAMF), (372, Y_BEAMB), (144, Y_BEAMB), (144, Y_BACK), (-14, Y_BACK)]
    car = prism('carriage', rpoly(L, [3, 3, 1.5, 3, 3, 6, 3, 3], 16), 2.0, ZT); setmats(car, [M['face']])
    cut = [rbox('window', WIN[0], WIN[1], WIN[2], WIN[3], FLOOR_Z, ZT + 6, 6.0, seg=16),
           rbox('pocket', POC[0], POC[1], POC[2], POC[3], AXZ, ZT + 6, 6.0, seg=16),
           cyl_x('seat', 46.0, 138.2, 16.4, AXY, AXZ),
           cyl_x('relief', 33.0, 46.5, 6.0, AXY, AXZ),
           cyl_x('gromhole', 137.0, 142.0, 3.3, AXY, AXZ + 4.0, seg=48),
           cyl_y('rodbore', ROD_X, ROD_Z, ROD_R + 0.3, Y_CAPF - 2, Y_BACK + 2),
           cyl_y('sealcb', ROD_X, ROD_Z, 13.2, Y_CAPF - 2, Y_CAPF + 2.2),
           rbox('coverseat', COV[0], COV[1], COV[2], COV[3], ZT - 8.0, ZT + 6, 2.0)]
    # beam to printer flange (3) and the shoe screw on the right end (1), all on the screw line y -12
    BEAM_SCREWS = [(122.0, 'beam to printer flange'), (202.0, 'beam to printer flange'), (282.0, 'beam to printer flange'),
                   (344.0, 'shoe to right end')]
    for x, _ in BEAM_SCREWS:
        cut.append(cbore(x, wy(-12), ZT, 1.0))
    cut.append(rbox('flangeseat', 36.0, 334.0, Y_BEAMF - 1.0, -15.5, 0.0, 8.3))
    for c in cut:
        add_bool(car, c, name='cut_' + c.name, mat=M['wall'])
    finish(car, [M['face']]); remove(cut)
    # window floor: near black
    me = car.data; me.materials.append(M['floor']); fi = len(me.materials) - 1
    for p in me.polygons:
        c = p.center
        if p.normal.z > 0.9 and c.z < FLOOR_Z + 0.5 and WIN[0] - 1 < c.x < WIN[1] + 1 and WIN[2] - 1 < c.y < WIN[3] + 1:
            p.material_index = fi
    objs.append(car)
    for i, (x, j) in enumerate(BEAM_SCREWS):
        objs.append(screw(M, x, wy(-12), ZT, 1.0, 0.4 + 0.9 * i, j))

    # bearing cover: its own part, 0.25 px parting all round, two screws into the cap's lower half
    g = 0.25
    cv = rbox('cover', COV[0] + g, COV[1] - g, COV[2] + g, COV[3] - g, ZT - 8.0, ZT, 1.75, seg=8); setmats(cv, [M['cover']])
    cc = [cbore(x, wy(46), ZT, 1.0, gap=0.2) for x in (-4.5, 20.5)]
    for c in cc:
        add_bool(cv, c, name='cb', mat=M['cover'])
    finish(cv, [M['cover']]); remove(cc); objs.append(cv)
    for x, a in ((-4.5, 1.3), (20.5, 0.2)):
        objs.append(screw(M, x, wy(46), ZT, 1.0, a, 'bearing cover to cap'))

    # strap / cable clamp over the can's middle, its back foot tunnelled for the cable and stiffener
    st = rbox('strap', STRAP['x0'], STRAP['x1'], STRAP['yf'], STRAP['yb'], ZT - 1.0, STRAP['zt'], 1.0); setmats(st, [M['strap']])
    c1 = cyl_x('sbore', 60, 100, 16.15, AXY, AXZ)
    c2 = rbox('stunnel', CAB['x0'] - 0.6, CAB['x1'] + 0.6, AXY + 10.0, STRAP['yb'] + 4, ZT - 1.2, ZT + CAB['t'] + CAB['st'] + 0.15)
    add_bool(st, c1, name='b1'); add_bool(st, c2, name='b2')
    finish(st, [M['strap']]); objs.append(st); remove([c1, c2])
    zs = STRAP['zt']
    objs.append(screw(M, 80.0, wy(-69, zs), zs, -0.55 * SCREW_D, 1.1, 'strap to carriage'))
    objs.append(screw(M, 80.0, wy(-12, zs), zs, -0.55 * SCREW_D, 0.2, 'strap to carriage'))

    # front lip seal round the rod exit
    ring = cyl_y('seal', ROD_X, ROD_Z, 13.0, Y_CAPF + 0.25, Y_CAPF + 2.2, seg=96)
    hole = cyl_y('sealh', ROD_X, ROD_Z, ROD_R + 0.2, Y_CAPF - 1, Y_CAPF + 3, seg=96)
    setmats(ring, [M['seal']]); add_bool(ring, hole); finish(ring, [M['seal']]); setmats(ring, [M['seal']]); remove([hole]); objs.append(ring)
    lip = torus_y('seallip', ROD_X, Y_CAPF + 0.15, ROD_Z, ROD_R + 0.55, 0.6); mat_of(lip, M['seallip']); objs.append(lip)


def build_drive(M, objs):
    # drive roller: PU tyre with radiused shoulders, plain steel boss with its set screw, shaft, bronze flanges
    ty = cyl_x('tyre', -1.0, 17.0, 12.0, AXY, AXZ, seg=128, wf=1.0, wb=1.0); setmats(ty, [M['tyre']])
    add_bevel(ty, 1.2, 4, edge_mat=0); finish(ty, [M['tyre']]); objs.append(ty)
    bo = cyl_x('boss', 17.0, 25.0, 9.0, AXY, AXZ, seg=96, wf=1.0, wb=1.0); setmats(bo, [M['boss']])
    add_bevel(bo, 0.5, 3, edge_mat=0)
    # two 1.5 mm set screws a quarter turn apart, black oxide, their ends just below the boss (as roller bosses carry
    # them); they are what shows the roller turning
    about = lambda ob, a: setattr(ob, 'matrix_world', Matrix.Translation((0.0, AXY, AXZ)) @ Matrix.Rotation(a, 4, 'X')
                                  @ Matrix.Translation((0.0, -AXY, -AXZ)) @ ob.matrix_world)
    holes = []
    for a in (0.0, math.pi / 2):
        h = cyl_z('bsh', 21.0, AXY, 3.15, AXZ + 4.0, AXZ + 10.0, seg=48); about(h, a); add_bool(bo, h); holes.append(h)
    finish(bo, [M['boss']]); remove(holes); objs.append(bo)
    for a in (0.0, math.pi / 2):
        sc = screw(M, 21.0, AXY, AXZ + 9.0, 0.6, 0.4 + a, 'set screw, the roller boss on its shaft', D=6.0)
        sc.name = 'rscrew'; about(sc, a); objs.append(sc)
    sh = cyl_x('rshaft', -10.0, 35.8, 4.0, AXY, AXZ, seg=64); finish(sh, [M['shaft']]); objs.append(sh)
    for x0, x1 in ((WIN[0] - 2.0, WIN[0] + 1.6), (WIN[1] - 1.6, WIN[1] + 2.0)):
        b = cyl_x('bronze', x0, x1, 6.0, AXY, AXZ, seg=64, wf=1.0, wb=1.0); add_bevel(b, 0.3, 3, edge_mat=0)
        finish(b, [M['bronze']]); objs.append(b)

    # motor (carriage4.py / motor.py): coupling, shaft, boss, domed front bell, can with crimp ring, black encoder cap
    wmax = 3.0
    can = cyl_x('can', 51.6, 114.0, 16.0, AXY, AXZ, wf=1.1 / wmax, wb=1.1 / wmax)
    setmats(can, [M['can'], M['rim']]); add_bevel(can, wmax, 4, edge_mat=1)
    bpy.ops.mesh.primitive_torus_add(major_radius=16.0 + 1.05 - 0.75, minor_radius=1.05, major_segments=128,
                                     minor_segments=16, location=(56.5, AXY, AXZ), rotation=(0, math.radians(90), 0))
    tor = bpy.context.active_object
    add_bool(can, tor); finish(can, [M['can'], M['rim']]); remove([tor]); objs.append(can)
    bell = cyl_x('bell', 47.0, 52.0, 14.6, AXY, AXZ, wf=1.0, wb=0.0)
    add_bevel(bell, 2.0, 4, edge_mat=0); finish(bell, [M['rim']]); objs.append(bell)
    boss = cyl_x('mboss', 43.6, 47.2, 4.4, AXY, AXZ, wf=0.45 / 0.5, wb=0.0)
    add_bevel(boss, 0.45, 3, edge_mat=0); finish(boss, [M['rim']]); objs.append(boss)
    shaft = cyl_x('mshaft', 40.4, 44.1, 1.9, AXY, AXZ, seg=48); finish(shaft, [M['shaft']]); objs.append(shaft)
    cpl = cyl_x('cpl', 34.8, 41.4, 5.0, AXY, AXZ, wf=1.0, wb=1.0, seg=96); setmats(cpl, [M['cpl']])
    add_bevel(cpl, 0.55, 3, edge_mat=0)
    holes = []                                     # the coupling's screws half a turn from the boss's
    for a in (math.pi, 1.5 * math.pi):
        h = cyl_z('sshole', 38.1, AXY, 2.1, AXZ + 1.5, AXZ + 7.0, seg=32); about(h, a); add_bool(cpl, h); holes.append(h)
    finish(cpl, [M['cpl']]); remove(holes); objs.append(cpl)
    for a in (math.pi, 1.5 * math.pi):
        sc = screw(M, 38.1, AXY, AXZ + 5.0, 0.4, 0.9 + a, 'set screw, the coupling on the motor shaft', D=4.0)
        sc.name = 'cscrew'; about(sc, a); objs.append(sc)
    cap = cyl_x('enc', 113.6, 131.6, 15.6, AXY, AXZ, wf=0.0, wb=1.0)
    add_bevel(cap, 3.0, 5, edge_mat=0); finish(cap, [M['cap']]); objs.append(cap)
    gz = AXZ + 4.0
    gr = cyl_x('grom', 137.1, 140.0, 3.6, AXY, gz, seg=64, wf=0.0, wb=1.0)
    setmats(gr, [M['grom']]); add_bevel(gr, 0.6, 3, edge_mat=0)
    gh = cyl_x('grh', 136.0, 141.0, 3.25, AXY, gz, seg=48)
    add_bool(gr, gh); finish(gr, [M['grom']]); remove([gh]); objs.append(gr)
    for s, key in ((-1, 'leadA'), (1, 'leadB')):
        cu = bpy.data.curves.new('lead', 'CURVE'); cu.dimensions = '3D'
        sp = cu.splines.new('POLY'); pts = [(131.0, 0), (133.5, 0.5), (135.5, 0.6), (137.5, 0.3), (139.0, 0)]
        sp.points.add(len(pts) - 1)
        for i, (x, sag) in enumerate(pts):
            sp.points[i].co = (x, AXY + s * 2.1, gz - sag, 1)
        cu.bevel_depth = 1.0; cu.bevel_resolution = 6; cu.resolution_u = 12
        ob = bpy.data.objects.new('lead', cu); bpy.context.collection.objects.link(ob); ob.data.materials.append(M[key])
        objs.append(ob)


def cable_path():
    """carriage.py's fold: flat from under the strap's back foot to y 44, r4 up 85 deg, crest r12 through -175 deg,
    then the leg straight down behind the carriage into the slot. -> list of (y, z) on the centre line."""
    z0 = ZT + 0.5 * CAB['t']
    pts = [(CAB['y0'], z0)]
    y, z, h = CAB['flat_to'], z0, 0.0
    n = 24
    pts += [(CAB['y0'] + (y - CAB['y0']) * i / n, z0) for i in range(1, n + 1)]

    def arc(y, z, h, r, deg):
        sgn = 1.0 if deg > 0 else -1.0
        cy_, cz_ = y - sgn * r * math.sin(h), z + sgn * r * math.cos(h)        # centre left (+) or right (-) of the heading
        out = []
        steps = max(8, int(abs(deg) / 3))
        for i in range(1, steps + 1):
            hh = h + math.radians(deg) * i / steps
            out.append((cy_ + sgn * r * math.sin(hh), cz_ - sgn * r * math.cos(hh)))
        return out, h + math.radians(deg)
    a, h = arc(y, z, h, ENV('CAB_R1', '16.0'), ENV('CAB_A1', '40.0')); pts += a; y, z = a[-1]
    a, h = arc(y, z, h, ENV('CAB_R2', '12.0'), -90.0 - ENV('CAB_A1', '30.0')); pts += a; y, z = a[-1]
    for i in range(1, 31):
        pts.append((y + 90.0 * math.cos(h) * i / 30, z + 90.0 * math.sin(h) * i / 30))
    return pts


def ribbon(name, pts, x0, x1, t):
    """a flat strip of thickness t along the (y, z) centre line, x0..x1"""
    bm = bmesh.new()
    rings = []
    for i, (y, z) in enumerate(pts):
        a = pts[max(i - 1, 0)]; b = pts[min(i + 1, len(pts) - 1)]
        ty_, tz_ = b[0] - a[0], b[1] - a[1]; L = math.hypot(ty_, tz_) or 1.0
        ny, nz = -tz_ / L, ty_ / L
        q = [(x0, y - ny * t / 2, z - nz * t / 2), (x1, y - ny * t / 2, z - nz * t / 2),
             (x1, y + ny * t / 2, z + nz * t / 2), (x0, y + ny * t / 2, z + nz * t / 2)]
        rings.append([bm.verts.new(v) for v in q])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(4):
            bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_obj(name, bm)


def build_cable(M, objs):
    pts = cable_path()
    cb = ribbon('cable', pts, CAB['x0'], CAB['x1'], CAB['t']); finish(cb, [M['cable']]); objs.append(cb)
    zs0 = ZT + CAB['t']
    sf = rbox('stiff', CAB['x0'], CAB['x1'], CAB['y0'] - 2, CAB['sy1'], zs0, zs0 + CAB['st'])
    set_weights(sf, lambda a, b: 1.0 if abs(a.z - zs0 - CAB['st']) < 1e-4 and abs(b.z - zs0 - CAB['st']) < 1e-4 else 0.0)
    add_bevel(sf, 0.3, 3, edge_mat=0); finish(sf, [M['stiff']]); objs.append(sf)
    return pts


def build_printer(M, objs):
    # body: x 32..372, from the front foot to under the lid, up to the ledge; the kit's rounded front edge (r 6)
    yf = PR['yfront']
    body = rbox('pbody', PR['x0'], PR['x1'], yf, PR['yb'] - 2.0, 0.0, ZLEDGE, 5.5, seg=12)
    top = lambda a, b, z: abs(a.z - z) < 1e-4 and abs(b.z - z) < 1e-4
    ends = lambda a, b, x0, x1: (a.x < x0 + 1.6 and b.x < x0 + 1.6) or (a.x > x1 - 1.6 and b.x > x1 - 1.6)
    set_weights(body, lambda a, b: 1.0 if top(a, b, ZLEDGE) else 0.0)          # pass2: one 3.5 px round all round the ledge
    setmats(body, [M['printer'], M['pslot']]); add_bevel(body, ENV('PR_RLEDGE', '3.5'), 12, edge_mat=0)
    # paper slot mouth under the tear bar: dark between and below the teeth
    sl = rbox('pslotc', 40.0, 364.0, yf - 3, yf + 3.0, 0.4, 4.4)
    add_bool(body, sl, name='slot', mat=M['pslot']); finish(body, [M['printer']]); remove([sl]); objs.append(body)
    # tear bar: 1.56 px proud of the front face, serrated lower edge (pitch 4, teeth 1.7 deep)
    TZ = 2.0                     # pass2: bar raised so the dark slot mouth shows under the teeth
    poly = [(40.0, 6.8 + TZ)]
    poly.append((364.0, 6.8 + TZ))
    pts = []
    xx = 364.0
    while xx - 4.0 >= 40.0 - 1e-6:
        pts += [(xx, 3.7 + TZ), (xx - 2.0, 2.0 + TZ)]; xx -= 4.0
    pts.append((xx, 3.7 + TZ))
    poly += pts
    tb = prism_y('tearbar', poly, yf - 1.56, yf + 0.5)
    # review fix 2: the bar's face tilts up (real tear bars lean out at the teeth), pivot on its face at mid height
    pv = Vector((0.0, yf - 0.5, 4.5 + TZ))
    tb.data.transform(Matrix.Translation(pv) @ Matrix.Rotation(math.radians(-TEAR_TILT), 4, 'X') @ Matrix.Translation(-pv))
    add_bevel(tb, 0.22, 3, edge_mat=0, limit='ANGLE'); finish(tb, [M['tear']]); tb.pass_index = 7; objs.append(tb)
    # hidden flange on the printer's back under the beam: what the three beam screws fasten
    fl = rbox('pflange', 40.0, 330.0, PR['yb'] - 2.0, -16.0, 2.0, 8.0, 1.0, seg=3); finish(fl, [M['printer']]); objs.append(fl)
    # lid: 34..370, lid top y 0..60 (screen), 26 px step face down to the ledge, lit front lip, the finger notch
    # pass2: plan corners r 5.5, the top edges rolled 4.5 px (the lid lip), the step face's foot 1.1 px
    lid = rbox('lid', 34.0, 370.0, PR['ylid'] + 0.4, PR['yb'], ZLEDGE, ZT, 5.5, seg=12)
    set_weights(lid, lambda a, b: 1.0 if top(a, b, ZT) else (0.25 if top(a, b, ZLEDGE) else 0.0))
    setmats(lid, [M['printer']]); add_bevel(lid, ENV('PR_RLID', '4.5'), 12, edge_mat=0)
    # notch: x 193..211, screen y 56..66 -> 3.6 px into the lid top, 9.7 px down the step face
    sc = (wy(56) - (PR['ylid'] + 0.4))
    # pass2: a soft oval scoop (ellipsoid) moulded into the step face's top edge, its rim rounded 1 px
    fy = PR['ylid'] + 0.4
    nt = ellipsoid('notch', (202.0, fy - 1.5, ZT - 0.5), (11.5, 7.0, 10.0))
    add_bool(lid, nt, name='notch')
    rb = add_bevel(lid, ENV('PR_RNOTCH', '1.0'), 4, edge_mat=0, name='rim', limit='ANGLE'); rb.harden_normals = False
    finish(lid, [M['printer']]); remove([nt]); objs.append(lid)
    # 2 px side walls of the body between which the lid sits
    for x0, x1 in ((PR['x0'], 34.0), (370.0, PR['x1'])):
        w = rbox('pside', x0, x1, PR['ylid'], PR['yb'] - 2.0, ZLEDGE - 5.0, ZT - 0.4, 0.6, seg=4)
        set_weights(w, lambda a, b: 1.0 if top(a, b, ZT - 0.4) else 0.0); add_bevel(w, 0.8, 4, edge_mat=0)
        finish(w, [M['printer']]); objs.append(w)


def build_deck(M, objs):
    y0, y1 = Y_BOT_END, Y_TOP_END
    # rod between the supports
    rod = cyl_y('rod', ROD_X, ROD_Z, ROD_R, y0 + 8, y1 - 8, seg=128); finish(rod, [M['rod']]); objs.append(rod)
    # rod supports: 42 x 32 blocks, x -13..29, ends 8 px in; two screws into the deck and the set screw on the rod
    for tag, ya, yb_ in (('t', G.deck_y(40.0), G.deck_y(8.0)), ('b', G.deck_y(G.B - 8.0), G.deck_y(G.B - 40.0))):
        cy = 0.5 * (ya + yb_)
        s = rbox('sup' + tag, -13.0, 29.0, ya, yb_, -2.0, Z_SUP, 3.0, seg=8); setmats(s, [M['sup']])
        cs = [cbore(x, cy, Z_SUP, 0.5) for x in (-6.0, 22.0)] + [cyl_z('tap', ROD_X, cy, 3.6 + 0.22, Z_SUP - 4.0, Z_SUP + 2, seg=48)]
        for c in cs:
            add_bool(s, c, name='c', mat=M['wall'])
        finish(s, [M['sup']]); remove(cs); objs.append(s)
        for i, x in enumerate((-6.0, 22.0)):
            objs.append(screw(M, x, cy, Z_SUP, 0.5, 0.7 + 1.9 * i + (0.5 if tag == 'b' else 0), 'rod support to deck'))
        objs.append(screw(M, ROD_X, cy, Z_SUP, 0.08, 0.9, 'set screw holding the rod', D=7.2))
    # desk: a shadow catcher with the way and the brush slot routed out; a dark substrate under the openings
    desk = rbox('desk', -600.0, 900.0, -1400.0, 1400.0, -0.01, 0.0)
    ch = [rbox('hway', WAY['x0'] - 0.25, WAY['x1'] + 0.25, y0, y1, -1, 1),
]
    for c in ch:
        add_bool(desk, c, name='h')
    finish(desk, [M['sub']], smooth=False); remove(ch)
    desk.data.materials.clear(); desk.data.materials.append(M['catcher'])
    desk.is_shadow_catcher = True; objs.append(desk)
    sub = rbox('sub', -50.0, 450.0, y0 - 20, y1 + 20, -14.0, -12.0); finish(sub, [M['sub']], smooth=False); objs.append(sub)
    # way: two lapped lands either side of the centre slot, flush; the undercut slot floor
    for x0, x1 in ((WAY['x0'], WAY['s0']), (WAY['s1'], WAY['x1'])):
        l = rbox('land', x0, x1, y0, y1, -6.0, 0.02, 0.0); finish(l, [M['way']], smooth=False); objs.append(l)
    fl = rbox('wayfloor', WAY['s0'], WAY['s1'], y0, y1, -11.0, -10.0); finish(fl, [M['wayslot']], smooth=False); objs.append(fl)
    # shoe tongue in the way's slot behind the right end (white acetal), the screw's part under the right end
    tg = rbox('tongue', WAY['s0'] + 0.5, WAY['s1'] - 0.5, -30.0, wy(-30, 0.0), -5.0, -0.3, 1.2, seg=4)
    finish(tg, [M['acetal']]); objs.append(tg)


def build_bristles(M, ya, yb):
    """two strips of black nylon filaments from the holder's walls, meeting on the slot's centre line, two layers, a
    few strays (Cycles hair curves)"""
    rng = np.random.default_rng(7)
    cx, hw = SLOT['cx'], SLOT['hw'] - 1.0
    t = np.array([0.0, 0.3, 0.6, 0.85, 1.0])
    P, R = [], []
    for s in (-1.0, 1.0):
        for dens, zr, zt, r0 in ((BR_D0, -2.4, -0.75, 0.15), (BR_D1, -3.0, -1.5, 0.16)):
            n = int((yb - ya) * dens)
            y = rng.uniform(ya, yb, n); rx = cx + s * (hw - 0.15)
            tx = cx - s * rng.uniform(-0.35, 0.55, n)
            z0 = zr + rng.normal(0, 0.12, n); z1 = zt + rng.normal(0, 0.1, n)
            dy = rng.normal(0, 0.25, n)
            stray = rng.random(n) < 0.004
            z1 = np.where(stray, rng.uniform(-0.3, 0.35, n), z1); dy = np.where(stray, rng.normal(0, 1.8, n), dy)
            X = rx + (tx - rx)[:, None] * t[None]
            Z = z0[:, None] + (z1 - z0)[:, None] * t[None] ** 0.8
            Y = y[:, None] + dy[:, None] * t[None] ** 1.5 + rng.normal(0, 0.05, (n, len(t)))
            P.append(np.stack([X, Y, Z], -1)); R.append(np.broadcast_to(r0 * (1 - 0.35 * t), (n, len(t))))
    P = np.concatenate(P).astype(np.float32); R = np.concatenate(R).astype(np.float32)
    hc = bpy.data.hair_curves.new('bristles'); hc.add_curves([len(t)] * len(P))
    hc.position_data.foreach_set('vector', P.ravel())
    ra = hc.attributes.get('radius') or hc.attributes.new('radius', 'FLOAT', 'POINT'); ra.data.foreach_set('value', R.ravel())
    ob = bpy.data.objects.new('bristles', hc); bpy.context.collection.objects.link(ob); hc.materials.append(M['brush'])
    print('bristles', len(P), flush=True)
    return ob


# ---- camera, lamp, world -------------------------------------------------------------------------------------
def setup_camera(scale):
    x0, y0, w, h = G.CROP
    X0, Ytop = G.to_model(x0, y0); X1, Ybot = G.to_model(x0 + w, y0 + h)
    ex, ey = G.to_model(G.EYE[0], G.EYE[1]); eh = G.EYE[2]
    cam = bpy.data.cameras.new('cam'); cam.type = 'PERSP'; cam.sensor_fit = 'HORIZONTAL'; cam.sensor_width = 36.0
    cam.lens = eh * 36.0 / (X1 - X0)
    cam.shift_x = ((X0 + X1) / 2 - ex) / (X1 - X0); cam.shift_y = ((Ytop + Ybot) / 2 - ey) / (X1 - X0)
    cam.clip_start = 10; cam.clip_end = 10000
    ob = bpy.data.objects.new('cam', cam); bpy.context.collection.objects.link(ob)
    ob.location = (ex, ey, eh); ob.rotation_euler = (0, 0, 0)
    sc = bpy.context.scene; sc.camera = ob
    r = sc.render; r.resolution_x = int(round(w * scale)); r.resolution_y = int(round(h * scale)); r.resolution_percentage = 100
    r.pixel_aspect_x = r.pixel_aspect_y = 1.0
    return ob


LAMP_WIN = (-480.0, -480.0, 1600.0)      # (-120, -120, 400) mm from the window's top-left
LAMP_SIZE = 800.0                        # 200 mm disc
LAMP_E = 2.16                            # irradiance at the window centre, in sun-strength units


def lamp_pose():
    lx, ly = G.to_model(LAMP_WIN[0], LAMP_WIN[1]); tx, ty = G.to_model(720.0, 450.0)
    loc = Vector((lx, ly, LAMP_WIN[2])); rot = (Vector((tx, ty, 0.0)) - loc).to_track_quat('-Z', 'Y').to_euler()
    return loc, rot, Vector((tx, ty, 0.0))


def calibrate_lamp():
    """power so a horizontal white surface at the window centre gets LAMP_E (study.py's probe, px units)"""
    loc, rot, tgt = lamp_pose()

    def probe(light):
        clear()
        me = bpy.data.meshes.new('pl'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=50); bm.to_mesh(me); bm.free()
        pl = bpy.data.objects.new('pl', me); bpy.context.collection.objects.link(pl); pl.location = tgt
        m = bpy.data.materials.new('w'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (1, 1, 1, 1); b.inputs['Roughness'].default_value = 1.0
        b.inputs['Specular IOR Level'].default_value = 0.0; pl.data.materials.append(m)
        light()
        cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 4
        co = bpy.data.objects.new('c', cam); bpy.context.collection.objects.link(co); co.location = tgt + Vector((0, 0, 100))
        sc = bpy.context.scene; sc.camera = co; sc.render.engine = 'CYCLES'; sc.cycles.samples = 64; sc.cycles.device = 'CPU'
        sc.cycles.use_denoising = False; sc.render.resolution_x = 8; sc.render.resolution_y = 8; sc.render.film_transparent = False
        sc.view_settings.view_transform = 'Standard'
        w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0; sc.world = w
        sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'
        p = os.path.join(OUT, '_cal.exr'); sc.render.filepath = p; bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(p); a = np.array(im.pixels[:]).reshape(-1, 4); return float(a[:, 1].mean())

    def sun():
        l = bpy.data.lights.new('s', 'SUN'); l.energy = 1.0; o = bpy.data.objects.new('s', l); bpy.context.collection.objects.link(o)
    P0 = 1.0e7

    def lamp():
        l = bpy.data.lights.new('l', 'AREA'); l.shape = 'DISK'; l.size = LAMP_SIZE; l.energy = P0
        o = bpy.data.objects.new('l', l); bpy.context.collection.objects.link(o); o.location = loc; o.rotation_euler = rot
    vs = probe(sun); vl = probe(lamp)
    return P0 * LAMP_E * vs / vl


# ---- the room around the printer: a bounce card and the paper, both real, neither seen by the camera ----------------
# A photographer's white card in front of the window's bottom edge, facing back at the page: a large, dim, soft source,
# fixed in the room like the lamp, so faces turned toward the viewer get a subtle lift and metal shows it as a broad soft
# reflection. CARD_F is its power as a share of the lamp's (0 turns it off). CARD_WIN is its centre in window px.
CARD_F = ENV('CARD_F', '0.10')
CARD_WIN = (720.0, 900.0 + 640.0, 520.0)      # 160 mm in front of the window's bottom edge, 130 mm up
CARD_SIZE = (1600.0, 480.0)                   # 400 x 120 mm


def setup_card(power):
    if CARD_F <= 0:
        return None
    cx, cy = G.to_model(CARD_WIN[0], CARD_WIN[1]); tx, ty = G.to_model(720.0, 450.0)
    loc = Vector((cx, cy, CARD_WIN[2])); rot = (Vector((tx, ty, 0.0)) - loc).to_track_quat('-Z', 'Y').to_euler()
    li = bpy.data.lights.new('card', 'AREA'); li.shape = 'RECTANGLE'; li.size, li.size_y = CARD_SIZE
    li.energy = power * CARD_F; li.color = (1.0, 0.99, 0.97)
    ob = bpy.data.objects.new('card', li); bpy.context.collection.objects.link(ob)
    ob.location = loc; ob.rotation_euler = rot; ob.visible_camera = False
    return ob


# The paper: a plain white 80 mm sheet leaving the slot under the tear bar, a soft droop, then flat on the desk. It
# bounces light onto the printer and shows in its reflections, but the camera never sees it (the page draws the real
# receipt), and it casts no shadow of its own onto the desk layer.
PAPER = ENV('PAPER', '1')


def build_paper(M):
    if PAPER <= 0:
        return None
    yf, x0, x1 = PR['yfront'], 42.0, 362.0
    pts = []
    for i in range(0, 41):                         # leave the slot level at z 2.4, droop to the desk over 70 px
        t = i / 40.0; e = t * t * (3 - 2 * t)
        pts.append((yf + 2.0 - 72.0 * t, 2.4 * (1.0 - e) + 0.05 * e))
    pts.append((yf - 1400.0, 0.05))
    ob = ribbon('paper', pts, x0, x1, 0.15)
    m = pbsdf('paperm', '#f3f1ec', 0.0, 0.62, 0.3); setmats(ob, [m])
    ob.visible_camera = False; ob.visible_shadow = False
    return ob


def setup_lamp(power):
    loc, rot, _ = lamp_pose()
    li = bpy.data.lights.new('lamp', 'AREA'); li.shape = 'DISK'; li.size = LAMP_SIZE; li.energy = power
    ob = bpy.data.objects.new('lamp', li); bpy.context.collection.objects.link(ob); ob.location = loc; ob.rotation_euler = rot
    return ob


# ---- passes ------------------------------------------------------------------------------------------------
import OpenImageIO as oiio  # noqa: E402


def exr(path):
    sc = bpy.context.scene; s = sc.render.image_settings
    s.media_type = 'MULTI_LAYER_IMAGE'; s.file_format = 'OPEN_EXR_MULTILAYER'; s.color_depth = '32'; s.exr_codec = 'ZIP'
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    inp = oiio.ImageInput.open(path); res = {}; i = 0
    while inp.seek_subimage(i, 0):
        spec = inp.spec(); px = np.asarray(inp.read_image(i, 0, 0, spec.nchannels, oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
        part = spec.getattribute('name') or ''
        for j, n in enumerate(spec.channelnames):
            res[n if n.count('.') >= 2 else 'VL.%s.%s' % (part.split('.')[-1], n.split('.')[-1]) if '.' not in n else 'VL.' + n] = px[..., j]
        i += 1
    inp.close(); return res


def grab(ch, name):
    ks = [k for k in ch if k.split('.')[-2] == name] or [k for k in ch if name in k.split('.')]
    ks = sorted(ks, key=lambda k: 'RGBAXYZ'.index(k.split('.')[-1]) if k.split('.')[-1] in 'RGBAXYZ' else 9)
    return np.stack([ch[k] for k in ks], -1)


# ---- stage 3: the head unit's layers at a column of window heights ---------------------------------------------------
# One Blender session, one scene; per height the camera, lamp and card move (they are fixed to the window), never the
# model. Per height: colour (2x, the head unit alone: the deck is a holdout so the page's deck sprites show through,
# the paper still lights it), the lamp's visibility (for the metal's darkened reflections, compare.py), height (2x,
# px above the desk) and shadow (1x, the head unit's shadow on a flat desk, the head unit unseen by the camera).
ZS_PX = 128.0
CROP_REL = (-52.0, -160.0, 500.0, 440.0)


def card_pose():
    cx, cy = G.to_model(CARD_WIN[0], CARD_WIN[1]); tx, ty = G.to_model(720.0, 450.0)
    loc = Vector((cx, cy, CARD_WIN[2])); rot = (Vector((tx, ty, 0.0)) - loc).to_track_quat('-Z', 'Y').to_euler()
    return loc, rot


def height_material():
    hm = bpy.data.materials.new('height'); hm.use_nodes = True; nt = hm.node_tree; nt.nodes.clear()
    gp = nt.nodes.new('ShaderNodeNewGeometry'); sp = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(gp.outputs['Position'], sp.inputs[0])
    mz = nt.nodes.new('ShaderNodeMath'); mz.operation = 'MULTIPLY'; mz.inputs[1].default_value = 1.0 / ZS_PX
    nt.links.new(sp.outputs['Z'], mz.inputs[0])
    cm = nt.nodes.new('ShaderNodeCombineXYZ')
    for k in ('X', 'Y', 'Z'):
        nt.links.new(mz.outputs[0], cm.inputs[k])
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0; nt.links.new(cm.outputs[0], em.inputs['Color'])
    mo = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], mo.inputs['Surface'])
    return hm


def inner_rod(M):
    """the rod's length inside the cap, drawn with the head unit so the cap's walls shade it where the drive's window
    shows it (the deck's strip draws the rod outside the cap); a hair larger than the rod, casting nothing (the rod
    itself still casts)"""
    r = cyl_y('rodin', ROD_X, ROD_Z, ROD_R + 0.05, Y_CAPF + 1.0, Y_BACK - 1.0, seg=128); finish(r, [M['rod']])
    r.visible_shadow = False
    return r


def run_layers(M, cam, lamp, card, paper, geo_obs):
    import importlib
    sc = bpy.context.scene; vl = sc.view_layers[0]
    deck = [o for o in geo_obs if o.pass_index == 3]
    hold = [o for o in deck if o.name.startswith(('desk', 'rod', 'sub', 'land', 'wayfloor'))]
    for o in deck:
        if o not in hold:
            o.hide_render = True                   # the supports and their screws are page sprites
    desk = [o for o in hold if o.name.startswith('desk')][0]
    head = [o for o in geo_obs if o.pass_index != 3 and o is not paper] + [inner_rod(M)]
    flat = rbox('deskflat', -600.0, 900.0, -1400.0, 1400.0, -0.01, 0.0); finish(flat, [M['catcher']], smooth=False)
    flat.data.materials.clear(); flat.data.materials.append(M['catcher']); flat.is_shadow_catcher = True; flat.hide_render = True
    wm = bpy.data.materials.new('white'); wm.use_nodes = True; nt = wm.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    dif = nt.nodes.new('ShaderNodeBsdfDiffuse'); dif.inputs['Color'].default_value = (1, 1, 1, 1)
    mo = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]; nt.links.new(dif.outputs[0], mo.inputs['Surface'])
    wb = bpy.data.worlds.new('black'); wb.use_nodes = True; wb.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    world = sc.world; hm = height_material()
    base = (sc.cycles.samples, sc.cycles.max_bounces, sc.cycles.use_denoising)
    MAIN = ('combined', 'diffuse_direct', 'diffuse_indirect', 'diffuse_color', 'glossy_direct', 'glossy_indirect',
            'glossy_color', 'ambient_occlusion', 'emit', 'object_index')
    NM = dict(Combined='Combined', GlossDir='Glossy Direct', GlossInd='Glossy Indirect', GlossCol='Glossy Color',
              AO='Ambient Occlusion', IndexOB='Object Index')
    hx = float(os.environ.get('HEAD_X', '928')); ys = [float(v) for v in os.environ['LAYERS'].split(',')]
    os.environ.pop('MECH_TOP', None)
    for i, hy in enumerate(ys):
        t0 = time.time(); name = 'L%02d' % i
        os.environ['HEAD_X'] = repr(hx); os.environ['HEAD_Y'] = repr(hy)
        os.environ['CROP'] = '%r,%r,%r,%r' % (hx + CROP_REL[0], hy + CROP_REL[1], CROP_REL[2], CROP_REL[3])
        importlib.reload(G)
        bpy.data.objects.remove(cam, do_unlink=True); cam = setup_camera(SCALE)
        loc, rot, _ = lamp_pose(); lamp.location = loc; lamp.rotation_euler = rot
        if card is not None:
            loc, rot = card_pose(); card.location = loc; card.rotation_euler = rot
        pre = os.path.join(OUT, 'lay_%s_%s_%s' % (THEME, TAG, name))
        # (a) colour
        for p in MAIN:
            setattr(vl, 'use_pass_' + p, True)
        for o in hold:
            o.is_holdout = True
        desk.is_shadow_catcher = False
        vl.material_override = None; sc.world = world
        if paper is not None: paper.hide_render = False
        if card is not None: card.hide_render = False
        sc.cycles.samples, sc.cycles.max_bounces, sc.cycles.use_denoising = base; sc.render.resolution_percentage = 100
        ch = exr(pre + '_main.exr'); out = {n: grab(ch, l) for n, l in NM.items()}
        # (b) the lamp's visibility: the lamp alone, white diffuse, black world, shadows on and off
        if card is not None: card.hide_render = True
        if paper is not None: paper.hide_render = True
        vl.material_override = wm; sc.world = wb; sc.cycles.samples = max(16, base[0] // 4); sc.cycles.max_bounces = 1
        for p in MAIN[2:]:
            setattr(vl, 'use_pass_' + p, False)
        for tag, on in (('on', True), ('off', False)):
            lamp.data.use_shadow = on
            c2 = exr(pre + '_vis%s.exr' % tag); out['Vis_' + tag] = grab(c2, 'Diffuse Direct')
        lamp.data.use_shadow = True
        # (c) height: emission = z / ZS_PX, the desk a holdout (it hides the cable below the slot)
        vl.material_override = hm; sc.world = wb; sc.cycles.samples = 16; sc.cycles.use_denoising = False
        hz = grab(exr(pre + '_h.exr'), 'Combined')
        out['H'] = np.where(hz[..., 3] > 0.02, hz[..., 0] / np.maximum(hz[..., 3], 1e-6) * ZS_PX, 0.0)
        out['HA'] = hz[..., 3]
        # (d) shadow, 1x: the flat catcher lit by the lamp and the card, the head unit unseen but casting
        vl.material_override = None; sc.world = world; sc.cycles.samples = base[0]; sc.cycles.max_bounces = base[1]
        for o in hold:
            o.is_holdout = False; o.hide_render = True
        flat.hide_render = False
        for o in head:
            o.visible_camera = False
        if card is not None: card.hide_render = False
        sc.render.resolution_percentage = 50
        out['S'] = grab(exr(pre + '_s.exr'), 'Combined')[..., 3]
        for o in head:
            o.visible_camera = True
        flat.hide_render = True
        for o in hold:
            o.hide_render = False
        sc.render.resolution_percentage = 100
        np.savez_compressed(pre + '.npz', **{k: v.astype(np.float16) for k, v in out.items()})
        sx, sy = G.plan(0.0, PR['yfront'])
        json.dump(dict(theme=THEME, name=name, head=[hx, hy], crop=list(G.CROP), scale=SCALE, eye=list(G.EYE), zs=ZS_PX,
                       slot=[sx, sy], samples=base[0], t=round(time.time() - t0, 1)), open(pre + '.json', 'w'), indent=1)
        for f in ('_main', '_vison', '_visoff', '_h', '_s'):
            os.remove(pre + f + '.exr')
        print('LAYER', name, hy, 'slot', round(sx, 2), round(sy, 2), '%.0fs' % (time.time() - t0), flush=True)
    print('DONE layers', THEME, TAG, flush=True)


def run_roll(M, cam, card, paper, geo_obs):
    """the drive (tyre, boss, shaft, coupling and their set screws) alone at ROLL angles about its axle, at the hold height, everything else a
    holdout that still lights and shadows it: the page turns it with the carriage's travel (angle = travel / 12 px)"""
    import importlib
    sc = bpy.context.scene
    n = int(os.environ['ROLL'])
    roll = [o for o in geo_obs if o.name.startswith(('tyre', 'boss', 'rscrew', 'rshaft', 'cpl', 'cscrew', 'mshaft'))]
    for o in geo_obs:
        if o.pass_index == 3 and not o.name.startswith(('desk', 'rod', 'sub', 'land', 'wayfloor')):
            o.hide_render = True
        elif o not in roll and o is not paper:
            o.is_holdout = True
    [o for o in geo_obs if o.name.startswith('desk')][0].is_shadow_catcher = False
    inner_rod(M).is_holdout = True
    pts = [G.proj(x, AXY + dy, AXZ + dz) for x in (-1.0, 42.0) for dy in (-12.5, 12.5) for dz in (-12.5, 12.5)]
    x0 = math.floor(min(p[0] for p in pts)) - 2; y0 = math.floor(min(p[1] for p in pts)) - 2
    x1 = math.ceil(max(p[0] for p in pts)) + 2; y1 = math.ceil(max(p[1] for p in pts)) + 2
    os.environ['CROP'] = '%d,%d,%d,%d' % (x0, y0, x1 - x0, y1 - y0); importlib.reload(G)
    bpy.data.objects.remove(cam, do_unlink=True); setup_camera(SCALE)
    piv = Matrix.Translation((0.0, AXY, AXZ)); back = Matrix.Translation((0.0, -AXY, -AXZ))
    base = {o: o.matrix_world.copy() for o in roll}
    frames = []
    for i in range(n):
        R = piv @ Matrix.Rotation(2 * math.pi * i / n, 4, 'X') @ back
        for o in roll:
            o.matrix_world = R @ base[o]
        ch = exr(os.path.join(OUT, '_roll.exr'))
        frames.append(grab(ch, 'Combined'))
        print('ROLL', i, flush=True)
    np.savez_compressed(os.path.join(OUT, 'roll_%s_%s.npz' % (THEME, TAG)), frames=np.stack(frames).astype(np.float16))
    json.dump(dict(theme=THEME, n=n, crop=list(G.CROP), head=list(G.HEAD), scale=SCALE, slot=list(G.plan(0.0, PR['yfront'])),
                   z=AXZ), open(os.path.join(OUT, 'roll_%s_%s.json' % (THEME, TAG)), 'w'), indent=1)
    print('DONE roll', THEME, TAG, flush=True)


def main():
    power = calibrate_lamp()
    print('LAMP_POWER', round(power), flush=True)
    clear()
    M = make_all_mats(); objs = []
    build_carriage(M, objs); build_drive(M, objs); pts = build_cable(M, objs); build_printer(M, objs)
    n0 = len(objs); build_deck(M, objs)
    for o in objs[n0:]:                            # the deck (desk, way, rod, supports) is index 3: drawn without the paper
        if not o.name.startswith('tongue'):        # (the shoe's tongue rides with the carriage)
            o.pass_index = 3
    print('built', len(objs), 'objects', round(time.time() - T0, 1), 's', flush=True)
    cam = setup_camera(SCALE); setup_render(SAMPLES); setup_world(THEME); lamp = setup_lamp(power)
    card = setup_card(power); paper = build_paper(M)
    print('card', CARD_F, 'paper', PAPER, flush=True)
    sc = bpy.context.scene
    geo_obs = [o for o in sc.objects if o.type in ('MESH', 'CURVE', 'CURVES')]
    ledge = [o for o in geo_obs if o.name.startswith('pbody')]
    lidob = [o for o in geo_obs if o.name.startswith('lid')]
    ca = bpy.data.collections.new('rx_main')
    for o in geo_obs:
        if o not in ledge: ca.objects.link(o)
    # one real lamp lights everything; the lid's shadow on the ledge is real (no second lamp for the ledge)
    # self-check: Blender's camera vs geo.proj on landmarks
    from bpy_extras.object_utils import world_to_camera_view
    bpy.context.view_layer.update()
    x0, y0, w, h = G.CROP
    for p in ((0.0, wy(0), ZT), (372.0, wy(0), ZT), (-14.0, Y_CAPF, 2.0), (344.0, G.deck_y(600), 0.0)):
        v = world_to_camera_view(sc, cam, Vector(p))
        print('camcheck', p, 'blender', round(x0 + v.x * w, 2), round(y0 + (1 - v.y) * h, 2), 'geo', tuple(round(q, 2) for q in G.proj(*p)))
    vl = sc.view_layers[0]
    for p in ('combined', 'diffuse_direct', 'diffuse_indirect', 'diffuse_color', 'glossy_direct', 'glossy_indirect',
              'glossy_color', 'ambient_occlusion', 'emit', 'object_index'):
        setattr(vl, 'use_pass_' + p, True)
    sc.world.light_settings.distance = 3.0
    if os.environ.get('HIDE_HEAD'):               # the deck alone (stage 3 deck sprites)
        for o in geo_obs:
            if o.pass_index != 3: o.hide_render = True
    if os.environ.get('HIDE_SUP'):                # the rod and way strip: no supports
        for o in geo_obs:
            if o.pass_index == 3 and o.name.startswith(('sup', 'screw')): o.hide_render = True
    if os.environ.get('ROD_HOLD'):                # the supports alone: the page's strip draws the rod (it still casts,
        for o in geo_obs:                         # so the support's sprite can carry the shadow the strip lacks)
            if o.pass_index == 3 and o.name.startswith('rod'):
                o.is_holdout = True
    if os.environ.get('LAYERS'):
        return run_layers(M, cam, lamp, card, paper, geo_obs)
    if os.environ.get('ROLL'):
        return run_roll(M, cam, card, paper, geo_obs)
    t = time.time(); ch = exr(os.path.join(OUT, 'main_%s_%s.exr' % (THEME, TAG))); t_main = time.time() - t
    NM = dict(Combined='Combined', GlossDir='Glossy Direct', GlossInd='Glossy Indirect', GlossCol='Glossy Color', AO='Ambient Occlusion', IndexOB='Object Index')
    out = {n: grab(ch, l) for n, l in NM.items()}
    # The paper is there to light the printer. The desk's shadow catcher still sees it through bounce rays and draws
    # its outline as shadow, and the way under its edge loses the room it reflects, so the deck comes from a second
    # render with the paper gone (the page draws the real receipt and its shading over the desk).
    if paper is not None:
        paper.hide_render = True
        ch = exr(os.path.join(OUT, 'deck_%s_%s.exr' % (THEME, TAG)))
        dk = {n: grab(ch, l) for n, l in NM.items()}
        idx = out['IndexOB'][..., 0]; a = out['Combined'][..., 3]
        sel = ((np.abs(idx - 3) < 0.5) | (a < 0.999))[..., None]
        for n in NM:
            if n != 'IndexOB':
                out[n] = np.where(sel, dk[n], out[n])
    # the lamp's visibility is the lamp's alone: no card, no paper
    if card is not None:
        card.hide_render = True
    # the lamp's visibility: white diffuse everywhere, black world, the lamp alone, shadows on and off
    wm = bpy.data.materials.new('white'); wm.use_nodes = True; nt = wm.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    dif = nt.nodes.new('ShaderNodeBsdfDiffuse'); dif.inputs['Color'].default_value = (1, 1, 1, 1)
    mo = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]; nt.links.new(dif.outputs[0], mo.inputs['Surface'])
    vl.material_override = wm
    w = bpy.data.worlds.new('black'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    sc.world = w
    sc.cycles.samples = max(16, SAMPLES // 4); sc.cycles.max_bounces = 1
    for p in ('diffuse_indirect', 'diffuse_color', 'glossy_direct', 'glossy_indirect', 'glossy_color', 'ambient_occlusion', 'emit', 'object_index'):
        setattr(vl, 'use_pass_' + p, False)
    for tag, on in (('on', True), ('off', False)):
        lamp.data.use_shadow = on
        c2 = exr(os.path.join(OUT, 'vis%s_%s_%s.exr' % (tag, THEME, TAG))); out['Vis_' + tag] = grab(c2, 'Diffuse Direct')
    np.savez_compressed(os.path.join(OUT, 'passes_%s_%s.npz' % (THEME, TAG)), **out)
    json.dump(dict(theme=THEME, samples=SAMPLES, scale=SCALE, crop=G.CROP, lamp_power=power, DX=G.DX, DY=G.DY,
                   screws=SCREWS, t_main=round(t_main, 1), t_total=round(time.time() - T0, 1),
                   cable_crest_z=max(z for _, z in pts)),
              open(os.path.join(OUT, 'meta_%s_%s.json' % (THEME, TAG)), 'w'), indent=1)
    print('DONE', THEME, TAG, 'main %.0fs total %.0fs' % (t_main, time.time() - T0), flush=True)


main()
