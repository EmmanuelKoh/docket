// The travelling printer through one WebGL canvas (.sl-lens): Blender
// renders of the head unit (carriage, printer, cable, roller) at a column
// of heights in the window, warped to wherever it is now.
//
// The camera is a shift lens: the eye 550 mm above the desk and 120 mm in
// front of the window's bottom edge (1 mm = 4 px), its sensor parallel to
// the desk, so flat things (the slip, the deck) are drawn at real size
// everywhere and raised parts lean with their place in the window. Each
// render comes with its height map and its shadow on the desk
// (public/hardware/feed/head.json says where each was made). A point z px
// above the desk moves by D * z / (eye - z), D the head unit's move from
// the render (eye-relative, at desk level). The height is found by
// marching the line of sight down from the tallest part and taking the
// first surface (parallax occlusion), so edges stay whole. The nearest
// render gives the outline; inside it the lamp's light is mixed from the
// two renders either side, so it changes smoothly down the window. The
// shadow (black, over the slip and the deck) is mixed the same way.
//
// The drive roller turns: 48 renders of it, a turn apart / 48, chosen by
// the carriage's travel (it rolls on the rod, radius 12 px).
//
// Draws only when the head unit moves in the window or the carriage
// travels. Hidden until its first frame; until then, without WebGL 2, or
// with reduced motion, the static render (.sl-cast) shows.

type Cell = {
  name: string;
  cell: [number, number];
  e: [number, number];
  o: [number, number];
};
type Set = {
  atlas: [number, number];
  cell: [number, number];
  crop: [number, number];
  zs: number;
  zmax: number;
  eye_h: number;
  cells: Cell[];
  ground: [number, number, number];
  roll: {
    n: number;
    size: [number, number];
    o: [number, number];
    e: [number, number];
    z: number;
  };
};
type Manifest = {
  scale: number;
  anchor_y: number;
  eye_front: number;
  themes: Record<string, Set>;
};

const R_TYRE = 12; // the roller's radius on the rod
const MARGIN = 8; // room around the crops for the warp

const VS = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uCol,uAux,uRoll;
uniform vec2 uAtlas,uCrop,uBoxO,uBoxS,uCA,uOA,uDA,uCB,uOB,uDB,uRollO,uRollS,uRollD,uRollSheet;
uniform float uScale,uDpr,uW,uEye,uZs,uZmax,uGround,uRollF,uRollZ;
out vec4 o;
vec3 lin(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}
float srgb(float c){c=max(c,0.);return c<=.0031308?c*12.92:1.055*pow(c,1./2.4)-.055;}
float sh(float z){return z/(uEye-z);}
vec3 tc(vec2 cell,vec2 org,vec2 q){vec2 l=q-org;
 float in_=float(all(greaterThan(l,vec2(.5)))&&all(lessThan(l,uCrop-.5)));
 return vec3((cell+l*uScale)/uAtlas,in_);}
float hAt(vec2 cell,vec2 org,vec2 q){vec3 t=tc(cell,org,q);return t.z*texture(uAux,t.xy).r*uZs;}
vec4 colAt(vec2 cell,vec2 org,vec2 q){vec3 t=tc(cell,org,q);return t.z*texture(uCol,t.xy);}
// the render (cell, crop origin org, moved by D) seen at d: march the line
// of sight from the top, first surface, then bisect
vec4 warp(vec2 cell,vec2 org,vec2 D,vec2 d){
 const int N=20;float above=uZmax,z=0.;bool hit=false;
 for(int i=0;i<=N;i++){float zi=uZmax*(1.-float(i)/float(N));
  if(hAt(cell,org,d-D*sh(zi))>=zi){z=zi;hit=true;break;}above=zi;}
 if(hit&&z>0.){float a=above,b=z;
  for(int k=0;k<6;k++){float m=.5*(a+b);if(hAt(cell,org,d-D*sh(m))>=m)b=m;else a=m;}z=b;}
 return colAt(cell,org,d-D*sh(z));}
// cheaper (fixed point), only to borrow light inside the outline
vec4 warpFast(vec2 cell,vec2 org,vec2 D,vec2 d){float z=0.;
 for(int i=0;i<4;i++)z=hAt(cell,org,d-D*sh(z));return colAt(cell,org,d-D*sh(z));}
void main(){
 vec2 d=uBoxO+vec2(gl_FragCoord.x,uBoxS.y*uDpr-gl_FragCoord.y)/uDpr;
 vec4 c=warp(uCA,uOA,uDA,d);
 if(uW>0.){vec4 b=warpFast(uCB,uOB,uDB,d);
  float inside=smoothstep(.96,1.,b.a)*smoothstep(.96,1.,c.a);
  vec3 own=c.a>.001?c.rgb/c.a:vec3(0.),other=b.a>.001?b.rgb/b.a:vec3(0.);
  c=vec4(mix(own,other,uW*inside)*c.a,c.a);}
 vec2 q=d-uRollD*sh(uRollZ)-uRollO;
 if(all(greaterThanEqual(q,vec2(0.)))&&all(lessThan(q,uRollS))){
  vec4 r=texture(uRoll,(vec2(uRollF,0.)+q*uScale)/uRollSheet);c=r+c*(1.-r.a);}
 // the shadow is a share of the light (linear); as black over the page
 // it takes the alpha that darkens the desk by that share
 vec3 sa=tc(uCA,uOA,d),sb=tc(uCB,uOB,d);
 float s=mix(sa.z*texture(uAux,sa.xy).g,sb.z*texture(uAux,sb.xy).g,uW);
 float a=1.-srgb(lin(vec3(uGround)).r*(1.-s))/uGround;
 o=vec4(c.rgb,c.a+(1.-c.a)*a);}`;

const bitmap = async (src: string, premultiply: boolean) => {
  const r = await fetch(src);
  if (!r.ok) throw new Error(src);
  return createImageBitmap(await r.blob(), {
    premultiplyAlpha: premultiply ? 'premultiply' : 'none',
    colorSpaceConversion: 'none',
  });
};

export function startLens(
  head: HTMLElement,
  cv: HTMLCanvasElement,
): () => void {
  const gl = cv.getContext('webgl2', {
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
  });
  if (!gl) return () => {};
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram() as WebGLProgram;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
  gl.useProgram(prog);
  gl.bindVertexArray(gl.createVertexArray());
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const tex = (unit: number, name: string, img: ImageBitmap) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    for (const [p, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, p, v);
    gl.uniform1i(u(name), unit);
    img.close();
  };

  let set: Set | null = null;
  let man: Manifest | null = null;
  let box = [0, 0, 0, 0];
  let roll = 0;
  let last = '';
  let frame = 0;
  let gen = 0;
  const draw = (force: boolean) => {
    frame = 0;
    if (!set || !man) return;
    const r = head.getBoundingClientRect();
    // the head unit's place against the eye, at desk level
    const ex = r.left - window.innerWidth / 2;
    const ey = r.top + man.anchor_y - (window.innerHeight + man.eye_front);
    const cs = set.cells;
    let i = 0;
    while (i < cs.length - 2 && ey > cs[i + 1].e[1]) i++;
    const t = Math.min(
      1,
      Math.max(0, (ey - cs[i].e[1]) / (cs[i + 1].e[1] - cs[i].e[1])),
    );
    const a = t < 0.5 ? cs[i] : cs[i + 1];
    const b = t < 0.5 ? cs[i + 1] : cs[i];
    const w = Math.min(t, 1 - t);
    const da = [ex - a.e[0], ey - a.e[1]];
    const db = [ex - b.e[0], ey - b.e[1]];
    const n = set.roll.n;
    const f = ((Math.round((roll / R_TYRE / (2 * Math.PI)) * n) % n) + n) % n;
    const key = `${a.name} ${da[0].toFixed(2)} ${da[1].toFixed(2)} ${w.toFixed(3)} ${f}`;
    if (!force && key === last) return;
    last = key;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u('uCA'), a.cell[0], a.cell[1]);
    gl.uniform2f(u('uOA'), a.o[0], a.o[1]);
    gl.uniform2f(u('uDA'), da[0], da[1]);
    gl.uniform2f(u('uCB'), b.cell[0], b.cell[1]);
    gl.uniform2f(u('uOB'), b.o[0], b.o[1]);
    gl.uniform2f(u('uDB'), db[0], db[1]);
    gl.uniform1f(u('uW'), w);
    const rd = [ex - set.roll.e[0], ey - set.roll.e[1]];
    gl.uniform2f(u('uRollD'), rd[0], rd[1]);
    gl.uniform1f(u('uRollF'), f * set.roll.size[0] * man.scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const kick = () => {
    if (!frame) frame = requestAnimationFrame(() => draw(false));
  };
  const travel = (e: Event) => {
    roll = (e as CustomEvent<number>).detail ?? roll;
    kick();
  };
  const setup = async () => {
    const g = ++gen;
    const theme =
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    // the renders' folder: a re-render ships under a new version (the
    // /hardware files are cached for good; docs/rendering.md)
    const f = '/hardware/feed/v1/';
    try {
      man = man ?? ((await (await fetch(`${f}head.json`)).json()) as Manifest);
      const s = man.themes[theme];
      if (Math.max(...s.atlas) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return;
      const imgs = await Promise.all([
        bitmap(`${f}head-${theme}-c.webp`, true),
        bitmap(`${f}head-${theme}-a.webp`, false),
        bitmap(`${f}roll-${theme}.png`, true),
      ]);
      if (g !== gen || gl.isContextLost()) {
        for (const i of imgs) i.close();
        return;
      }
      tex(0, 'uCol', imgs[0]);
      tex(1, 'uAux', imgs[1]);
      tex(2, 'uRoll', imgs[2]);
      set = s;
    } catch {
      return;
    }
    const s = set;
    // the canvas covers every render's crop, in head-unit px
    const xs = s.cells.map((c) => c.o[0]);
    const ys = s.cells.map((c) => c.o[1]);
    box = [
      Math.floor(Math.min(...xs)) - MARGIN,
      Math.floor(Math.min(...ys)) - MARGIN,
      Math.ceil(Math.max(...xs) - Math.min(...xs)) + s.crop[0] + 2 * MARGIN,
      Math.ceil(Math.max(...ys) - Math.min(...ys)) + s.crop[1] + 2 * MARGIN,
    ];
    const dpr = window.devicePixelRatio || 1;
    cv.style.left = `${box[0]}px`;
    cv.style.top = `${box[1]}px`;
    cv.style.width = `${box[2]}px`;
    cv.style.height = `${box[3]}px`;
    cv.width = Math.round(box[2] * dpr);
    cv.height = Math.round(box[3] * dpr);
    gl.uniform2f(u('uAtlas'), s.atlas[0], s.atlas[1]);
    gl.uniform2f(u('uCrop'), s.crop[0], s.crop[1]);
    gl.uniform2f(u('uBoxO'), box[0], box[1]);
    gl.uniform2f(u('uBoxS'), box[2], box[3]);
    gl.uniform1f(u('uDpr'), cv.width / box[2]);
    gl.uniform1f(u('uScale'), man.scale);
    gl.uniform1f(u('uEye'), s.eye_h);
    gl.uniform1f(u('uZs'), s.zs);
    gl.uniform1f(u('uZmax'), s.zmax);
    gl.uniform1f(u('uGround'), (s.ground[0] + s.ground[1] + s.ground[2]) / 3);
    gl.uniform2f(u('uRollO'), s.roll.o[0], s.roll.o[1]);
    gl.uniform2f(u('uRollS'), s.roll.size[0], s.roll.size[1]);
    gl.uniform1f(u('uRollZ'), s.roll.z);
    gl.uniform2f(
      u('uRollSheet'),
      s.roll.n * s.roll.size[0] * man.scale,
      s.roll.size[1] * man.scale,
    );
    head.classList.add('sl-gl');
    draw(true);
  };
  const reset = () => {
    set = null;
    head.classList.remove('sl-gl');
    setup();
  };
  const themes = new MutationObserver(reset);
  themes.observe(document.documentElement, { attributeFilter: ['data-theme'] });
  let dpr = window.devicePixelRatio;
  const resize = () => {
    if (window.devicePixelRatio !== dpr) {
      dpr = window.devicePixelRatio;
      reset();
    } else draw(true);
  };
  cv.addEventListener('webglcontextlost', reset);
  window.addEventListener('scroll', kick, { passive: true });
  window.addEventListener('sl-move', travel);
  window.addEventListener('resize', resize);
  setup();
  return () => {
    gen++;
    themes.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', kick);
    window.removeEventListener('sl-move', travel);
    window.removeEventListener('resize', resize);
    cv.removeEventListener('webglcontextlost', reset);
    head.classList.remove('sl-gl');
  };
}
