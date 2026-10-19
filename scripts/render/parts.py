# Primitives, materials (machined metal with the Bevel-shader edge, bead-blast grain, the motor can, the flat
# cable), the render settings and the room light, shared by build.py, which runs everything above the `if MODE`
# line. It began as the bake-off render of the motor and strap (the rest of the file still runs that render:
# Blender -b --python parts.py -- proof | light | dark [samples]). env.npz holds the room light (an ambient map and
# a soft key per theme) from the old lab renderer; it cannot be regenerated, so it is kept here.
import bpy, bmesh, sys, math, time, os, json
import numpy as np
from mathutils import Vector, Matrix

T0 = time.time()
B = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:]
MODE = ARGS[0]
SAMPLES = int(ARGS[1]) if len(ARGS) > 1 else 256
SUN = float(ARGS[2]) if len(ARGS) > 2 else 3.0
AMB_DIFF = float(os.environ.get('BK_AMB', '0.5'))   # strength of the ambient seen by diffuse rays
ANISO = float(os.environ.get('BK_ANISO', '0'))      # 0.4 along the axis measured +1 level, -0.25 px: left off
OUT = os.environ.get('BK_OUT', 'after')
E = os.environ.get
KEYENV = float(E('BK_KEYENV', '1'))      # share of the env softbox kept in glossy rays
SUNG = float(E('BK_SUNG', '-1'))         # glossy key sun strength (-1: none, pre-fix)
SUNANG = float(E('BK_SUNANG', '14'))     # key sun angular diameter, deg
GSCALE, GDETAIL = float(E('BK_GS', '1.2')), float(E('BK_GD', '2'))
GA0, GA1 = float(E('BK_GA0', '0.955')), float(E('BK_GA1', '1.045'))   # bead-blast albedo range
RL, RD = float(E('BK_RL', '2.5')), float(E('BK_RD', '1.5'))           # Bevel shader radius, light / dark
DDIFF = float(E('BK_DDIFF', '0.9'))
DBAND = (float(E('BK_DB0', '0.012')), float(E('BK_DB1', '0.02')))
LBAND = (float(E('BK_LB0', '0.0015')), float(E('BK_LB1', '0.006')))       # light: edge material from ~4 deg (full at 16)                                 # dark bright-cut: satin (diffuse) share
WALL = E('BK_WALL', '#a2a4a6')
WALLM, WALLR = float(E('BK_WALLM', '0.6')), float(E('BK_WALLR', '0.55'))                                        # light pocket walls and floor
CAB_L = (E('BK_GAPL', '#5a2702'), E('BK_CUL', '#a04d05'))             # cable film / conductors, light
CAB_D = (E('BK_GAPD', '#461e02'), E('BK_CUD', '#7a3704'))
CCOAT = float(E('BK_COAT', '0.05'))
CSPEC = float(E('BK_CSPEC', '0.15'))                                  # film's own specular level (shipped: spec weight 0.12)
S = 4                                   # px per CSS px of the raw render
CROP = (28, -84, 120, 90)               # x0, y0 (screen, y down), W, H
K = 0.62
A = math.atan(K); CA = math.cos(A)

# ---------------------------------------------------------------- numbers from carriage.py / carriage4.py
ZT = 58.0645
AXZ = 44.0
def wy(s, z=ZT): return -s - K * z
AXY = wy(-40, AXZ)
Y_BEAMF, Y_BEAMB, Y_BACK = wy(-2), wy(-22), wy(-88)
POC = (34.0, 138.0, wy(-19), AXY + 16.6)
STRAP = dict(x0=68.0, x1=92.0, zt=AXZ + 19.2, yf=Y_BEAMF + 1.5); STRAP['yb'] = wy(-76, STRAP['zt'])
# flat cable: 5 mm (20 px) wide, 0.6 thick, from under the back foot to the extension's back edge;
# black stiffener (1.0 thick) laminated on top at the clamped end, 3.75 px of it showing behind the foot
CAB = dict(x0=70.0, x1=90.0, y0=wy(-62), y1=Y_BACK, t=0.6, st=1.0)
CAB['sy1'] = 79.25 - K * (ZT + CAB['t'] + CAB['st'])          # stiffener's back end: screen y -79.25 on its top

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]

def rough_of(sigma):                    # rm's normal-jitter sigma -> GGX roughness input
    return math.sqrt(min(1.0, 1.414 * sigma))

# ---------------------------------------------------------------- materials
def pbsdf(name, hexcol, metallic, rough, spec=0.5, coat=0.0, coat_rough=0.2):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(hexcol) + [1]
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = spec
    if coat: b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = coat_rough
    return m

def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if isinstance(k, str) and k in n.inputs: n.inputs[k].default_value = v
    return n

def maprange(nt, src, a, b, c, d):
    n = nt.nodes.new('ShaderNodeMapRange'); n.clamp = True
    for i, v in zip((1, 2, 3, 4), (a, b, c, d)): n.inputs[i].default_value = v
    nt.links.new(src, n.inputs[0]); return n.outputs[0]

def math_(nt, op, a, b=None):
    n = nt.nodes.new('ShaderNodeMath'); n.operation = op
    for i, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, (int, float)): n.inputs[i].default_value = v
        else: nt.links.new(v, n.inputs[i])
    return n.outputs[0]

def principled(nt, hexcol, metallic, rough, spec=0.5, coat=0.0, coat_rough=0.2):
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = lin(hexcol) + [1]
    b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = spec
    if coat: b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = coat_rough
    return b

def machined(name, base, metallic, rough, spec, edge, ztop, radius, grain=None, chamfer=False, band=(0.003, 0.04)):
    """Face shader with a Bevel-shader edge break. edge = (hex, rough, diffuse share, diffuse hex).
    The edge mask is 1 - dot(bevel normal, true normal) mapped 0.003..0.04, kept to the top
    ~1 px (z > ztop - 1.6) so concave corners deep in the pocket never get it.
    grain = (W, rough_lo, rough_hi, col_lo, col_hi): bead-blast cells about 0.9 px.
    chamfer: the edge band shades with a flat 45 deg chamfer normal (true normal + the outward
    direction of the bevel normal's tilt) instead of the round, so a break facing the key is lit
    and one facing away is not (a bright-cut chamfer). band: the mask's 1 - dot range."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    face = principled(nt, base, metallic, rough, spec)
    bev = nt.nodes.new('ShaderNodeBevel'); bev.samples = 8; bev.inputs['Radius'].default_value = radius
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    nt.links.new(bev.outputs['Normal'], face.inputs['Normal'])
    if grain:
        W, r0, r1, c0, c1 = grain
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.noise_dimensions = '4D'
        nz.inputs['W'].default_value = W; nz.inputs['Scale'].default_value = GSCALE
        nz.inputs['Detail'].default_value = GDETAIL; nz.inputs['Roughness'].default_value = 0.6
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        nt.links.new(maprange(nt, nz.outputs['Factor'], 0.35, 0.65, r0, r1), face.inputs['Roughness'])
        f = maprange(nt, nz.outputs['Factor'], 0.35, 0.65, c0, c1)
        sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'
        sc.inputs[0].default_value = lin(base)
        nt.links.new(f, sc.inputs['Scale']); nt.links.new(sc.outputs['Vector'], face.inputs['Base Color'])
    if os.environ.get('BK_EDGE') == 'face':      # edges keep the face's own material: only real light lights them
        nt.links.new(face.outputs['BSDF'], out.inputs['Surface'])
        return m
    ehex, erough, ediff, dhex = edge
    en = bev.outputs['Normal']
    if chamfer:
        d0 = nt.nodes.new('ShaderNodeVectorMath'); d0.operation = 'DOT_PRODUCT'
        nt.links.new(bev.outputs['Normal'], d0.inputs[0]); nt.links.new(geo.outputs['True Normal'], d0.inputs[1])
        sc0 = nt.nodes.new('ShaderNodeVectorMath'); sc0.operation = 'SCALE'
        nt.links.new(geo.outputs['True Normal'], sc0.inputs[0]); nt.links.new(d0.outputs['Value'], sc0.inputs['Scale'])
        sb = nt.nodes.new('ShaderNodeVectorMath'); sb.operation = 'SUBTRACT'
        nt.links.new(bev.outputs['Normal'], sb.inputs[0]); nt.links.new(sc0.outputs['Vector'], sb.inputs[1])
        n1 = nt.nodes.new('ShaderNodeVectorMath'); n1.operation = 'NORMALIZE'; nt.links.new(sb.outputs['Vector'], n1.inputs[0])
        ad = nt.nodes.new('ShaderNodeVectorMath'); ad.operation = 'ADD'
        nt.links.new(geo.outputs['True Normal'], ad.inputs[0]); nt.links.new(n1.outputs['Vector'], ad.inputs[1])
        n2 = nt.nodes.new('ShaderNodeVectorMath'); n2.operation = 'NORMALIZE'; nt.links.new(ad.outputs['Vector'], n2.inputs[0])
        en = n2.outputs['Vector']
    eg = principled(nt, ehex, 1.0, erough)
    nt.links.new(en, eg.inputs['Normal'])
    esh = eg.outputs['BSDF']
    if ediff:
        df = nt.nodes.new('ShaderNodeBsdfDiffuse'); df.inputs['Color'].default_value = lin(dhex) + [1]
        nt.links.new(en, df.inputs['Normal'])
        mx = nt.nodes.new('ShaderNodeMixShader'); mx.inputs[0].default_value = ediff
        nt.links.new(esh, mx.inputs[1]); nt.links.new(df.outputs[0], mx.inputs[2]); esh = mx.outputs[0]
    dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    nt.links.new(bev.outputs['Normal'], dot.inputs[0]); nt.links.new(geo.outputs['True Normal'], dot.inputs[1])
    dev = math_(nt, 'SUBTRACT', 1.0, dot.outputs['Value'])
    m1 = maprange(nt, dev, band[0], band[1], 0.0, 1.0)
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], sep.inputs[0])
    zm = maprange(nt, sep.outputs['Z'], ztop - 1.6, ztop - 0.9, 0.0, 1.0)
    mask = math_(nt, 'MULTIPLY', m1, zm)
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mask, mix.inputs[0]); nt.links.new(face.outputs['BSDF'], mix.inputs[1]); nt.links.new(esh, mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    if os.environ.get('BK_DEBUG'):                 # emission: R = mask, G = tilt off the true normal / 90 deg
        em = nt.nodes.new('ShaderNodeEmission'); cx = nt.nodes.new('ShaderNodeCombineXYZ')
        ang = math_(nt, 'DIVIDE', math_(nt, 'ARCCOSINE', dot.outputs['Value']), math.pi / 2)
        nt.links.new(mask, cx.inputs[0]); nt.links.new(ang, cx.inputs[1])
        nt.links.new(cx.outputs[0], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m

def can_mat(name, hexcol, rough, aniso):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = principled(nt, hexcol, 1.0, rough)
    if aniso:
        b.inputs['Anisotropic'].default_value = aniso
        t = nt.nodes.new('ShaderNodeCombineXYZ'); t.inputs[0].default_value = 1.0     # drawn along the axis
        nt.links.new(t.outputs[0], b.inputs['Tangent'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface']); return m

def cable_mat(name, gap, cond, rough, coat, coat_rough):
    """amber polyimide over copper: conductors 1.2 px on a 2.0 px pitch (0.5 mm FFC), 1.4 px bare film
    at each edge, raised a little under the coverlay"""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = principled(nt, gap, 0.0, rough, CSPEC, coat, coat_rough)
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0]); x = sep.outputs['X']
    c0 = CAB['x0'] + 1.4 + 0.6                                    # first conductor's centre
    d = math_(nt, 'PINGPONG', math_(nt, 'SUBTRACT', x, c0), 1.0)  # 0 at a conductor's centre, 1 midway
    cm = maprange(nt, d, 0.5, 0.7, 1.0, 0.0)
    e0 = maprange(nt, x, CAB['x0'] + 1.2, CAB['x0'] + 1.5, 0.0, 1.0)
    e1 = maprange(nt, x, CAB['x1'] - 1.5, CAB['x1'] - 1.2, 1.0, 0.0)
    cm = math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', cm, e0), e1)
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    ins = [s for s in mx.inputs if s.enabled]
    fac = [s for s in mx.inputs if s.name == 'Factor' and s.type == 'VALUE'][0]
    ca = [s for s in mx.inputs if s.name == 'A' and s.type == 'RGBA'][0]
    cb = [s for s in mx.inputs if s.name == 'B' and s.type == 'RGBA'][0]
    ca.default_value = lin(gap) + [1]; cb.default_value = lin(cond) + [1]
    nt.links.new(cm, fac)
    nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 1.0; bu.inputs['Distance'].default_value = 0.05
    nt.links.new(cm, bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface']); return m

def make_mats(theme):
    d = theme == 'dark'
    M = {}
    zs = STRAP['zt']
    if not d:
        edge = ('#e8e9ea', 0.14, 0.2, '#e8e9ea')                       # machined edge break (kit: rough 0.14, diff 0.20)
        g = (GA0, GA1); kw = dict(band=LBAND)
        M['face'] = machined('face', '#cfd1d3', 0.6, 0.55, 0.5, edge, ZT, RL, grain=(0.0, 0.45, 0.65) + g, **kw)
        M['strap'] = machined('strap', '#cfd1d3', 0.6, 0.55, 0.5, edge, zs, RL, grain=(7.3, 0.45, 0.65) + g, **kw)
        M['wall'] = machined('wall', WALL, WALLM, WALLR, 0.5, edge, ZT, RL, **kw)  # same satin, cut surfaces a shade darker
    else:
        edge = ('#c8c8c5', 0.08, DDIFF, '#f2f2ee')                     # bright cut: near mirror + satin share lit by the key
        kw = dict(chamfer=True, band=DBAND)
        M['face'] = machined('face', '#1f1e1d', 0.0, 0.55, 0.4, edge, ZT, RD, **kw)
        M['strap'] = machined('strap', '#1f1e1d', 0.0, 0.55, 0.4, edge, zs, RD, **kw)
        M['wall'] = machined('wall', '#1f1e1d', 0.0, 0.55, 0.4, edge, ZT, RD, **kw)
    M['can'] = can_mat('can', '#c8c9c6', 0.28, ANISO)
    M['rim'] = pbsdf('rim', '#b4b5b2' if not d else '#a5a6a4', 1.0, rough_of(0.08))
    M['shaft'] = pbsdf('shaft', '#c4c5c3' if not d else '#b6b7b5', 1.0, 0.2)
    M['cpl'] = pbsdf('cpl', '#9c9d9b' if not d else '#8e8f8d', 1.0, rough_of(0.12))
    M['cap'] = pbsdf('cap', '#1a1a19' if not d else '#2a2a29', 0.0, 0.42, 0.5)
    M['leadA'] = pbsdf('leadA', '#161615', 0.0, 0.45, 0.5)
    M['leadB'] = pbsdf('leadB', '#8a8a86' if not d else '#6a6a67', 0.0, 0.45, 0.5)
    M['grom'] = pbsdf('grom', '#141312', 0.0, 0.6, 0.4)
    M['oxide'] = pbsdf('oxide', '#383836', 1.0, 0.42, coat=0.2, coat_rough=0.12)     # oil film
    M['screwrim'] = pbsdf('screwrim', '#50504c', 1.0, 0.15)  # burnished oxide, not bare steel
    M['cable'] = cable_mat('cable', *(CAB_L if not d else CAB_D), 0.35, CCOAT, 0.06)
    M['stiff'] = pbsdf('stiff', '#161514', 0.0, 0.6, 0.3)
    return M

# ---------------------------------------------------------------- mesh helpers
def new_obj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); return ob

def rpoly(pts, radii, seg=10):
    out = []
    n = len(pts)
    for i in range(n):
        p = Vector(pts[i]); a = (Vector(pts[i - 1]) - p).normalized(); b = (Vector(pts[(i + 1) % n]) - p).normalized()
        r = radii[i]
        if r <= 0: out.append((p.x, p.y)); continue
        phi = math.acos(max(-1, min(1, a.dot(b))))
        d = r / math.tan(phi / 2); c = p + (a + b).normalized() * (r / math.sin(phi / 2))
        p1 = p + a * d; p2 = p + b * d
        v1 = (p1 - c); v2 = (p2 - c)
        ang = math.atan2(v1.x * v2.y - v1.y * v2.x, v1.dot(v2))
        a0 = math.atan2(v1.y, v1.x)
        for k in range(seg + 1):
            t = a0 + ang * k / seg
            out.append((c.x + r * math.cos(t), c.y + r * math.sin(t)))
    return out

def prism(name, poly, z0, z1):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in poly]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    vv = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=vv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_obj(name, bm)

def rbox(name, x0, x1, y0, y1, z0, z1, r=0.0, seg=8):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return prism(name, rpoly(pts, [r] * 4, seg) if r > 0 else pts, z0, z1)

def cyl_x(name, x0, x1, R, cy, cz, seg=128, wf=0.0, wb=0.0, wmax=1.0):
    """cylinder along x; bevel weights wf/wb (0..1 of wmax) on the front/back rim edges"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=R, radius2=R, depth=x1 - x0)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, cy, cz), verts=bm.verts)
    ob = new_obj(name, bm)
    set_weights(ob, lambda a, b: (wf if abs(a.x - x0) < 1e-4 and abs(b.x - x0) < 1e-4 else
                                  wb if abs(a.x - x1) < 1e-4 and abs(b.x - x1) < 1e-4 else 0.0))
    return ob

def cyl_z(name, cx, cy, R, z0, z1, seg=96, wt=0.0, wb=0.0, rot=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=R, radius2=R, depth=z1 - z0)
    if rot: bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'))
    bmesh.ops.translate(bm, vec=(cx, cy, (z0 + z1) / 2), verts=bm.verts)
    ob = new_obj(name, bm)
    set_weights(ob, lambda a, b: (wt if abs(a.z - z1) < 1e-4 and abs(b.z - z1) < 1e-4 else
                                  wb if abs(a.z - z0) < 1e-4 and abs(b.z - z0) < 1e-4 else 0.0))
    return ob

def hex_drill(name, cx, cy, r, ztop, depth, rot):
    """hex socket cutter: hex prism (circumradius r) 'depth' deep, then a 118 deg drill-point cone"""
    bm = bmesh.new()
    angs = [rot + k * math.pi / 3 for k in range(6)]
    top = [bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), ztop + 1.0)) for a in angs]
    bot = [bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), ztop - depth)) for a in angs]
    apex = bm.verts.new((cx, cy, ztop - depth - r / math.tan(math.radians(59))))
    bm.faces.new(top)
    for i in range(6):
        j = (i + 1) % 6
        bm.faces.new((top[i], bot[i], bot[j], top[j])); bm.faces.new((bot[i], apex, bot[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_obj(name, bm)

def set_weights(ob, fn):
    me = ob.data
    if 'bevel_weight_edge' not in me.attributes:
        me.attributes.new('bevel_weight_edge', 'FLOAT', 'EDGE')
    at = me.attributes['bevel_weight_edge']
    for i, e in enumerate(me.edges):
        at.data[i].value = fn(me.vertices[e.vertices[0]].co, me.vertices[e.vertices[1]].co)

def add_bevel(ob, width, seg, edge_mat=1, name='Bevel', profile=0.5, limit='WEIGHT'):
    m = ob.modifiers.new(name, 'BEVEL')
    m.limit_method = limit; m.width = width; m.segments = max(3, seg); m.profile = profile
    m.material = edge_mat; m.affect = 'EDGES'; m.angle_limit = math.radians(30)
    return m

def setmats(ob, mats):
    ob.data.materials.clear()
    for m in mats: ob.data.materials.append(m)
    return ob

def add_bool(ob, cutter, op='DIFFERENCE', name='Bool', mat=None):
    """mat: the cut faces take this material (Boolean 'Transfer'); otherwise the object's own slots"""
    m = ob.modifiers.new(name, 'BOOLEAN'); m.operation = op; m.solver = 'EXACT'; m.object = cutter
    cutter.data.materials.clear()
    if mat is not None:
        cutter.data.materials.append(mat); m.material_mode = 'TRANSFER'
    else:
        for mm in ob.data.materials: cutter.data.materials.append(mm)
    cutter.hide_render = True; cutter.display_type = 'WIRE'
    return m

def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects: o.select_set(False)
    ob.select_set(True)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)

def finish(ob, mats, smooth=True):
    """modifiers -> mesh, smooth with a 35 deg sharp threshold, materials"""
    apply_mods(ob)
    me = ob.data
    setmats(ob, mats) if len(me.materials) == 0 else None
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.set_sharp_from_angle(angle=math.radians(35))
    return ob

def remove(obs):
    for o in obs: bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------- the parts
def build(theme):
    M = make_mats(theme); dark = theme == 'dark'
    objs = []
    # ---- carriage top (L outline), pocket, seat, coupling relief, grommet hole, counterbore.
    # No geometric bevel: the Bevel shader in 'face'/'wall' breaks every top edge.
    L = [(10, -34), (200, -34), (200, Y_BEAMB), (144, Y_BEAMB), (144, Y_BACK), (10, Y_BACK)]
    car = prism('carriage', rpoly(L, [3, 0, 0, 6, 3, 3], 16), 2.0, ZT); setmats(car, [M['face']])
    cut = []
    cut.append(rbox('pocket', POC[0], POC[1], POC[2], POC[3], AXZ, ZT + 6, 6.0, seg=16))
    cut.append(cyl_x('seat', 46.0, 138.2, 16.4, AXY, AXZ))
    cut.append(cyl_x('relief', 33.0, 46.5, 6.0, AXY, AXZ))
    cut.append(cyl_x('gromhole', 137.0, 142.0, 3.3, AXY, AXZ + 4.0, seg=48))
    cut.append(cyl_z('cbore', 122.0, wy(-12), 5.9, ZT - 6.5, ZT + 3, seg=64))
    for c in cut: add_bool(car, c, name='cut_' + c.name, mat=M['wall'])
    finish(car, [M['face']]); objs.append(car)
    remove(cut)

    # ---- strap; its back foot has a tunnel underneath for the cable and stiffener
    st = rbox('strap', STRAP['x0'], STRAP['x1'], STRAP['yf'], STRAP['yb'], ZT - 1.0, STRAP['zt'], 1.0); setmats(st, [M['strap']])
    c1 = cyl_x('sbore', 60, 100, 16.15, AXY, AXZ)
    c2 = rbox('stunnel', CAB['x0'] - 0.6, CAB['x1'] + 0.6, AXY + 10.0, STRAP['yb'] + 4, ZT - 1.2, ZT + CAB['t'] + CAB['st'] + 0.15)
    add_bool(st, c1, name='b1'); add_bool(st, c2, name='b2')
    finish(st, [M['strap']]); objs.append(st); remove([c1, c2])

    # ---- flat cable (0.2 px rounds on its long edges) and the black stiffener on its clamped end
    cb = rbox('cable', CAB['x0'], CAB['x1'], CAB['y0'], CAB['y1'], ZT, ZT + CAB['t'])
    set_weights(cb, lambda a, b: 1.0 if abs(a.x - b.x) < 1e-4 and abs(a.y - b.y) > 1 else 0.0)
    add_bevel(cb, 0.2, 3, edge_mat=0); finish(cb, [M['cable']]); objs.append(cb)
    zs0 = ZT + CAB['t']
    sf = rbox('stiff', CAB['x0'], CAB['x1'], CAB['y0'] - 2, CAB['sy1'], zs0, zs0 + CAB['st'])
    set_weights(sf, lambda a, b: 1.0 if abs(a.z - zs0 - CAB['st']) < 1e-4 and abs(b.z - zs0 - CAB['st']) < 1e-4 else 0.0)
    add_bevel(sf, 0.3, 3, edge_mat=0); finish(sf, [M['stiff']]); objs.append(sf)

    # ---- screws (socket heads, black oxide; bright turned rim; socket 0.6 k deep + drill point)
    def screw(cx, cy, zface, sink, ang):
        D = 10.0; k = 0.55 * D; zt = zface - sink; zb = zt - k
        h = cyl_z('screw', cx, cy, D / 2, zb, zt, seg=96, wt=1.0); setmats(h, [M['oxide'], M['screwrim']])
        add_bevel(h, 0.1 * D, 3, edge_mat=1)
        hexc = hex_drill('hex', cx, cy, (0.5 * D) / math.sqrt(3), zt, 0.6 * k, ang)
        add_bool(h, hexc); finish(h, [M['oxide'], M['screwrim']]); remove([hexc]); return h
    objs.append(screw(122.0, wy(-12), ZT, 1.0, 0.4))
    objs.append(screw(80.0, wy(-69, STRAP['zt']), STRAP['zt'], -5.5, 1.1))
    objs.append(screw(80.0, wy(-12, STRAP['zt']), STRAP['zt'], -5.5, 0.2))

    # ---- motor
    wmax = 3.0
    can = cyl_x('can', 51.6, 114.0, 16.0, AXY, AXZ, wf=1.1 / wmax, wb=1.1 / wmax)
    setmats(can, [M['can'], M['rim']]); add_bevel(can, wmax, 4, edge_mat=1)
    bpy.ops.mesh.primitive_torus_add(major_radius=16.0 + 1.05 - 0.75, minor_radius=1.05, major_segments=128,
                                     minor_segments=16, location=(56.5, AXY, AXZ), rotation=(0, math.radians(90), 0))
    tor = bpy.context.active_object
    add_bool(can, tor); finish(can, [M['can'], M['rim']]); remove([tor]); objs.append(can)
    bell = cyl_x('bell', 47.0, 52.0, 14.6, AXY, AXZ, wf=2.0 / 2.0, wb=0.0)
    add_bevel(bell, 2.0, 4, edge_mat=0); finish(bell, [M['rim']]); objs.append(bell)
    boss = cyl_x('boss', 43.6, 47.2, 4.4, AXY, AXZ, wf=0.45 / 0.5, wb=0.0)
    add_bevel(boss, 0.45, 3, edge_mat=0); finish(boss, [M['rim']]); objs.append(boss)
    shaft = cyl_x('shaft', 40.4, 44.1, 1.9, AXY, AXZ, seg=48); finish(shaft, [M['shaft']]); objs.append(shaft)
    cpl = cyl_x('cpl', 34.8, 41.4, 5.0, AXY, AXZ, wf=1.0, wb=1.0, seg=96); setmats(cpl, [M['cpl']])
    add_bevel(cpl, 0.55, 3, edge_mat=0)
    hole = cyl_z('sshole', 38.1, AXY, 1.15, AXZ + 3.4, AXZ + 7.0, seg=32)
    add_bool(cpl, hole); finish(cpl, [M['cpl']]); remove([hole]); objs.append(cpl)
    rsh = cyl_x('rshaft', 28.0, 35.8, 4.0, AXY, AXZ, seg=64); finish(rsh, [M['shaft']]); objs.append(rsh)
    cap = cyl_x('cap', 113.6, 131.6, 15.6, AXY, AXZ, wf=0.0, wb=1.0)
    add_bevel(cap, 3.0, 5, edge_mat=0); finish(cap, [M['cap']]); objs.append(cap)
    # grommet and the two leads
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
        for o in bpy.context.selected_objects: o.select_set(False)
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.shade_smooth()
        objs.append(ob)
    return objs, M

# ---------------------------------------------------------------- scene: camera, light, world
def setup_camera(crop=CROP, s=S):
    x0, y0, W, H = crop
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = W
    cam.clip_start = 1; cam.clip_end = 2000; cam.sensor_fit = 'AUTO'
    ob = bpy.data.objects.new('cam', cam); bpy.context.collection.objects.link(ob)
    tx, ty = x0 + W / 2, -(y0 + H / 2)
    ob.rotation_euler = (A, 0, 0)
    ob.location = Vector((tx, ty, 0)) + Vector((0, -math.sin(A), math.cos(A))) * 400
    sc = bpy.context.scene; sc.camera = ob
    r = sc.render; r.resolution_x = int(W * s); r.resolution_y = int(H * s); r.resolution_percentage = 100
    r.pixel_aspect_x = 1.0 / CA; r.pixel_aspect_y = 1.0
    return ob

def setup_render(samples, transparent=True):
    sc = bpy.context.scene; r = sc.render
    r.engine = 'CYCLES'; c = sc.cycles
    c.samples = samples; c.use_denoising = False
    c.pixel_filter_type = 'BOX'; c.filter_width = 1.0
    c.max_bounces = 8; c.caustics_reflective = False; c.caustics_refractive = False
    c.sample_clamp_indirect = 20.0
    r.film_transparent = transparent
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    sc.display_settings.display_device = 'sRGB'
    r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.image_settings.color_depth = '8'
    c.device = 'CPU'                    # the Metal GPU hung on the full scene
    return 'cpu'

def np_image(name, arr):
    if arr.ndim == 2: arr = np.repeat(arr[..., None], 3, -1)
    h, w, _ = arr.shape
    im = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    rgba = np.concatenate([arr, np.ones((h, w, 1), np.float32)], -1).astype(np.float32)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(rgba.ravel()); im.update(); im.pack()
    return im

def setup_world(theme):
    E = np.load('%s/env.npz' % B); amb = E[theme + '_amb'].astype(np.float32); key = E[theme + '_key'].astype(np.float32)
    w = bpy.data.worlds.new('w'); w.use_nodes = True; bpy.context.scene.world = w
    nt = w.node_tree; nt.nodes.clear()
    ea = nt.nodes.new('ShaderNodeTexEnvironment'); ea.image = np_image('amb', amb)
    ek = nt.nodes.new('ShaderNodeTexEnvironment'); ek.image = np_image('ambkey', amb + KEYENV * key)   # KEYENV < 1: the sun is the key's reflection
    ba = nt.nodes.new('ShaderNodeBackground'); bk = nt.nodes.new('ShaderNodeBackground')
    ba.inputs['Strength'].default_value = AMB_DIFF          # diffuse rays: ambient only (the sun is the key's diffuse)
    nt.links.new(ea.outputs['Color'], ba.inputs['Color']); nt.links.new(ek.outputs['Color'], bk.inputs['Color'])
    lp = nt.nodes.new('ShaderNodeLightPath'); mix = nt.nodes.new('ShaderNodeMixShader'); out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(lp.outputs['Is Diffuse Ray'], mix.inputs['Fac'])
    nt.links.new(bk.outputs['Background'], mix.inputs[1]); nt.links.new(ba.outputs['Background'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return w

def _sun(name, strength, angle):
    # rm.light_dir(46, -0.42)
    h = Vector((-0.42, 1.0)).normalized(); e = math.radians(46)
    Ld = Vector((h.x * math.cos(e), h.y * math.cos(e), math.sin(e)))
    li = bpy.data.lights.new(name, 'SUN'); li.energy = strength; li.angle = math.radians(angle)
    ob = bpy.data.objects.new(name, li); bpy.context.collection.objects.link(ob)
    ob.rotation_euler = Ld.to_track_quat('Z', 'Y').to_euler()
    return ob

def setup_sun(strength):
    # BK_SUNG < 0 (default): the pre-fix key, a diffuse-only sun; the env softbox is the key's reflection.
    # BK_SUNG >= 0: the key's reflection is a sun too (same direction, rm's 6 directions over 7 deg ~ a 14 deg disc),
    # so metal is shadowed physically; equal strengths make it one light.
    if SUNG < 0:
        ob = _sun('sun', strength, 10); ob.visible_glossy = False; return ob
    if abs(SUNG - strength) < 1e-6:
        return _sun('sun', strength, SUNANG)
    ob = _sun('sun', strength, SUNANG); ob.visible_glossy = False
    og = _sun('sun_gloss', SUNG, SUNANG)
    og.visible_diffuse = False; og.visible_transmission = False; og.visible_volume_scatter = False
    return ob

def setup_ground(theme):
    pl = rbox('deck', -400, 700, -400, 400, -0.01, 0.0)
    pl.is_shadow_catcher = True
    m = bpy.data.materials.new('deck'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 0.85 if theme == 'light' else 0.03
    o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], o.inputs['Surface'])
    pl.data.materials.append(m)
    return pl

def render(path):
    bpy.context.scene.render.filepath = path
    t = time.time(); bpy.ops.render.render(write_still=True); return time.time() - t

# ---------------------------------------------------------------- camera proof
def proof():
    clear()
    crop = (-60, -45, 120, 90)
    setup_camera(crop, S); dev = setup_render(16, transparent=False)
    w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    bpy.context.scene.world = w
    res = {}
    for tag, (ctop, cfront) in dict(top=(1, 0), front=(0, 1)).items():
        for o in list(bpy.data.objects):
            if o.type == 'MESH': bpy.data.objects.remove(o, do_unlink=True)
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts: v.co = (v.co.x * 40 + 0, v.co.y * 40 - 5, v.co.z * 10 + 5)    # x -20..20, y -25..15, z 0..10
        bx = new_obj('box', bm)
        for nm, val in (('t', ctop), ('f', cfront)):
            m = bpy.data.materials.new(nm); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
            em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (val, val, val, 1); em.inputs['Strength'].default_value = 1.0
            o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], o.inputs['Surface']); bx.data.materials.append(m)
        m3 = bpy.data.materials.new('k'); m3.use_nodes = True; nt = m3.node_tree; nt.nodes.clear()
        em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (0, 0, 0, 1)
        o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], o.inputs['Surface']); bx.data.materials.append(m3)
        for p in bx.data.polygons:
            n = p.normal; p.material_index = 0 if n.z > 0.9 else (1 if n.y < -0.9 else 2)
        p_ = '%s/proof_%s.png' % (B, tag); render(p_)
        im = bpy.data.images.load(p_); a = np.array(im.pixels[:]).reshape(im.size[1], im.size[0], 4)[::-1, :, :3].mean(-1)
        res[tag] = a
        bpy.data.images.remove(im)
    ta, fa = res['top'], res['front']
    H_, W_ = ta.shape
    top_h = ta[:, W_ // 2].sum() / S
    front_h = fa[:, W_ // 2].sum() / S
    row = int(np.argmax(ta[:, W_ // 2] > 0.5)) + 20
    top_w = ta[row, :].sum() / S
    out = dict(res_px=(W_, H_), device=dev, top_w_units=round(float(top_w), 3), top_h_units=round(float(top_h), 3),
               front_h_units=round(float(front_h), 3), front_h_expected=6.2,
               top_w_px_at_1x=round(float(top_w), 2), front_h_px_at_1x=round(float(front_h), 2))
    print('PROOF', json.dumps(out)); json.dump(out, open(B + '/proof.json', 'w'), indent=1)

# ---------------------------------------------------------------- main render
def main(theme):
    clear(); t = time.time()
    objs, M = build(theme); t_build = time.time() - t
    setup_camera(); dev = setup_render(SAMPLES); setup_world(theme); setup_sun(SUN); setup_ground(theme)
    out = '%s/%s_raw_%s_4x.png' % (B, OUT, theme)
    t_r = render(out)
    print('TIMES', json.dumps(dict(theme=theme, build_s=round(t_build, 1), render_s=round(t_r, 1), samples=SAMPLES, device=dev,
                                  sun=SUN, amb=AMB_DIFF, aniso=ANISO, total_s=round(time.time() - T0, 1))))

if MODE == 'proof': proof()
else: main(MODE)
