// tests/render-svg-files.test.ts — no SVG reference reads a server file.
// resvg reads an href that is not a data: URL or a #fragment as a file
// path: feImage at any depth (inside an inline svg, a data: SVG image or
// a fetched SVG), image in the top-level SVG. resvg also loads a data:
// URL as an SVG when its type is svg, text/plain or missing, in any
// letter case, and unzips gzip. So:
//   - inside an inline <svg>, an href keeps only a #fragment or a checked
//     data: URL, and a url() that is not # or data: is dropped
//     (render/render-core.js sealSvg);
//   - a data: image, typed or fetched, is refused when its bytes could
//     load anything outside the image (render/image-guard.js).
// Each case puts a black file where a file read would draw it, and checks
// that nothing dark is drawn. Controls render the same SVG with resvg
// alone and show the file is drawn there, so a read would be seen.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  BLANK_IMAGE,
  decodeDataUrl,
  guardImages,
  imageDeps,
  safeDataUrl,
} from '@/render/image-guard.js';
import { toElement, toPixels } from '@/render/render-core.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/render-svg-files`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

const fetched: string[] = [];
beforeAll(() => {
  vi.stubGlobal('fetch', (input: unknown) => {
    fetched.push(String(input));
    throw new Error('network access is disabled in tests');
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---- the files a read would draw ----

const DIR = process.env.DATA_DIR as string;
const PNG_FILE = path.join(DIR, 'black.png');
const SVG_FILE = path.join(DIR, 'black.svg');

function blackPng(size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PNG_FILE, blackPng(64));
  fs.writeFileSync(
    SVG_FILE,
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs>' +
      '<rect id="r" width="64" height="64" fill="#000"/>' +
      '<pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="#000"/></pattern>' +
      '<filter id="f" x="0" y="0" width="1" height="1"><feFlood flood-color="#000"/></filter>' +
      '</defs><rect width="64" height="64" fill="#000"/></svg>',
  );
});

// Dark, opaque pixels.
const dark = (rgba: Uint8Array | Buffer) => {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 128 && rgba[i] < 128) n++;
  }
  return n;
};

// ---- the references ----
//
// Each body draws only white or nothing unless a file is read; the
// references that resvg reads draw the black file. The pattern cases use
// a stroke, which resvg leaves off when its paint does not resolve (a
// fill would fall back to black).

const feImage = (attr: string, file: string) =>
  `<filter id="f" x="0" y="0" width="64" height="64" filterUnits="userSpaceOnUse"><feImage ${attr}="${file}" x="0" y="0" width="64" height="64"/></filter><rect width="64" height="64" fill="#fff" filter="url(#f)"/>`;

const REFS: Record<string, () => string> = {
  'feImage href (png)': () => feImage('href', PNG_FILE),
  'feImage xlink:href (png)': () => feImage('xlink:href', PNG_FILE),
  'feImage href (svg)': () => feImage('href', SVG_FILE),
  'image href': () => `<image href="${PNG_FILE}" width="64" height="64"/>`,
  'use href': () => `<use href="${SVG_FILE}#r"/>`,
  'pattern href': () =>
    `<pattern id="q" href="${SVG_FILE}#p"/><rect width="64" height="64" fill="#fff" stroke="url(#q)" stroke-width="128"/>`,
  'pattern url()': () =>
    `<rect width="64" height="64" fill="#fff" stroke="url(${SVG_FILE}#p)" stroke-width="128"/>`,
  'filter url()': () =>
    `<rect width="64" height="64" fill="#fff" filter="url(${SVG_FILE}#f)"/>`,
  'filter href': () =>
    `<filter id="h" href="${SVG_FILE}#f"/><rect width="64" height="64" fill="#fff" filter="url(#h)"/>`,
};

const svgDoc = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64" viewBox="0 0 64 64">${body}</svg>`;
const base64Svg = (doc: string) =>
  `data:image/svg+xml;base64,${Buffer.from(doc).toString('base64')}`;

const page = (inner: string) =>
  `<div style="display:flex;width:576px;height:100px;background:#fff">${inner}</div>`;

async function inkOf(markup: string) {
  return dark((await toPixels(markup, 100)).rgba);
}

type Node = { type?: string; props: Record<string, unknown> };
// Every element of a type in a satori-html tree, in document order.
function nodesOf(tree: unknown, type: string): Node[] {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Node;
    if (node.type === type) out.push(node);
    walk(node.props?.children);
  };
  walk(tree);
  return out;
}

// ---- controls ----

describe('controls: resvg alone reads the files', () => {
  it('through feImage, at the top level and inside an SVG image', () => {
    const top = svgDoc(REFS['feImage href (png)']());
    expect(dark(new Resvg(top).render().pixels)).toBe(64 * 64);
    const nested = svgDoc(
      `<image href="${base64Svg(top)}" width="64" height="64"/>`,
    );
    expect(dark(new Resvg(nested).render().pixels)).toBe(64 * 64);
    const svgFile = svgDoc(REFS['feImage href (svg)']());
    expect(dark(new Resvg(svgFile).render().pixels)).toBe(64 * 64);
  });

  it('through image at the top level', () => {
    const top = svgDoc(REFS['image href']());
    expect(dark(new Resvg(top).render().pixels)).toBe(64 * 64);
  });

  it('through a data: URL typed text/plain, with no type, upper case or gzip', () => {
    const doc = svgDoc(REFS['feImage href (png)']());
    for (const url of [
      `data:,${encodeURIComponent(doc)}`,
      `data:text/plain;base64,${Buffer.from(doc).toString('base64')}`,
      `DATA:IMAGE/SVG+XML;BASE64,${Buffer.from(doc).toString('base64')}`,
      `data:image/svg+xml;base64,${zlib.gzipSync(doc).toString('base64')}`,
    ]) {
      const host = svgDoc(`<image href="${url}" width="64" height="64"/>`);
      expect(dark(new Resvg(host).render().pixels), url.slice(0, 30)).toBe(
        64 * 64,
      );
    }
  });
});

// ---- the renderer ----

describe('an inline svg', () => {
  for (const [name, body] of Object.entries(REFS)) {
    it(`draws no file through ${name}`, async () => {
      expect(await inkOf(page(svgDoc(body())))).toBe(0);
    });
  }

  it('drops an href or url() that leaves the svg, on every element', () => {
    const svg = toElement(
      page(
        svgDoc(
          '<feImage href="/etc/x.png"/>' +
            '<feImage xlink:href="file:///etc/x.png"/>' +
            '<a xmlns:z="http://www.w3.org/1999/xlink" z:href="/etc/x.png"/>' +
            '<use href="#ok"/>' +
            '<use href="#../../etc/x"/>' +
            '<rect fill="url(/etc/x.svg#p)" stroke="url(#g)" style="fill:url(\'/etc/x.svg#p\');stroke:url(#g)"/>' +
            '<feImage href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3CfeImage href=%22/etc/x.png%22/%3E%3C/svg%3E"/>' +
            '<image href="/etc/x.png"/>',
        ),
      ),
    );
    const [fe1, fe2, fe3] = nodesOf(svg, 'feImage');
    const [a] = nodesOf(svg, 'a');
    const [use1, use2] = nodesOf(svg, 'use');
    const [rect] = nodesOf(svg, 'rect');
    const [image] = nodesOf(svg, 'image');
    expect(fe1.props.href).toBeUndefined();
    expect(fe2.props['xlink:href']).toBeUndefined();
    expect(a.props['z:href']).toBeUndefined();
    expect(use1.props.href).toBe('#ok');
    expect(use2.props.href).toBeUndefined();
    expect(rect.props.fill).toBeUndefined();
    expect(rect.props.stroke).toBe('url(#g)');
    expect(rect.props.style).toEqual({ stroke: 'url(#g)' });
    expect(fe3.props.href).toBeUndefined();
    expect(image.props.href).toBe(BLANK_IMAGE);
  });

  it('still draws a data: image through feImage, re-encoded as base64', async () => {
    const png = `data:image/png;base64,${blackPng(64).toString('base64')}`;
    expect(await inkOf(page(svgDoc(feImage('href', png))))).toBe(64 * 64);
    const clean = svgDoc('<rect width="64" height="64" fill="#000"/>');
    const typed = `data:image/svg+xml,${encodeURIComponent(clean)}`;
    expect(await inkOf(page(svgDoc(feImage('href', typed))))).toBe(64 * 64);
    const [fe] = nodesOf(
      toElement(page(svgDoc(feImage('href', typed)))),
      'feImage',
    );
    expect(fe.props.href).toBe(base64Svg(clean));
  });
});

describe('a data: SVG image', () => {
  const contexts: Record<string, (url: string) => string> = {
    'in <img src>': (url) => page(`<img src="${url}" width="64" height="64"/>`),
    'in a background url()': (url) =>
      page(
        `<div style="display:flex;width:64px;height:64px;background-image:url(${url})"></div>`,
      ),
    'in an inline svg <image>': (url) =>
      page(svgDoc(`<image href="${url}" width="64" height="64"/>`)),
  };
  const encodings: Record<string, (doc: string) => string> = {
    base64: base64Svg,
    'percent-encoded': (doc) => `data:image/svg+xml,${encodeURIComponent(doc)}`,
    'text/plain': (doc) =>
      `data:text/plain;base64,${Buffer.from(doc).toString('base64')}`,
    'no type': (doc) => `data:,${encodeURIComponent(doc)}`,
    'upper case': (doc) =>
      `DATA:IMAGE/SVG+XML;BASE64,${Buffer.from(doc).toString('base64')}`,
  };

  for (const [where, wrap] of Object.entries(contexts)) {
    for (const [name, body] of Object.entries(REFS)) {
      it(`${where} draws no file through ${name}`, async () => {
        expect(await inkOf(wrap(base64Svg(svgDoc(body()))))).toBe(0);
      });
    }
  }

  it('is refused whatever its type or encoding', async () => {
    const doc = svgDoc(REFS['feImage href (png)']());
    for (const [name, encode] of Object.entries(encodings)) {
      expect(safeDataUrl(encode(doc)), name).toBeNull();
      expect(await inkOf(contexts['in <img src>'](encode(doc))), name).toBe(0);
    }
  });

  it('draws no file from an SVG nested inside it', async () => {
    const inner = svgDoc(REFS['feImage href (png)']());
    const outer = svgDoc(feImage('href', base64Svg(inner)));
    expect(dark(new Resvg(outer).render().pixels)).toBe(64 * 64); // control
    expect(safeDataUrl(base64Svg(outer))).toBeNull();
    expect(await inkOf(contexts['in <img src>'](base64Svg(outer)))).toBe(0);
  });

  // resvg draws no <image> inside an svg that is itself an image, so the
  // inline svg context draws nothing either way.
  it('still draws when it refers only to itself and to data: images', async () => {
    const png = `data:image/png;base64,${blackPng(64).toString('base64')}`;
    for (const body of [
      '<defs><rect id="r" width="64" height="64" fill="#000"/></defs><use href="#r"/>',
      feImage('href', png),
    ]) {
      for (const where of ['in <img src>', 'in a background url()']) {
        const url = base64Svg(svgDoc(body));
        expect(await inkOf(contexts[where](url)), where).toBe(64 * 64);
      }
    }
  });

  it('keeps a raster data: URL as typed', async () => {
    const png = `data:image/png;base64,${blackPng(8).toString('base64')}`;
    expect(safeDataUrl(png)).toBe(png);
    const tree = {
      type: 'img',
      props: { src: png, width: '8', height: '8' },
    };
    await guardImages(tree);
    expect(tree.props.src).toBe(png);
  });
});

describe('the data: image check', () => {
  const refused = (doc: string) => safeDataUrl(base64Svg(doc));

  it('refuses gzip, entity declarations and @import', () => {
    const doc = svgDoc('<rect width="1" height="1"/>');
    expect(safeDataUrl(base64Svg(doc))).not.toBeNull();
    expect(
      safeDataUrl(
        `data:image/svg+xml;base64,${zlib.gzipSync(doc).toString('base64')}`,
      ),
    ).toBeNull();
    expect(
      refused(
        `<!DOCTYPE svg [<!ENTITY f "${PNG_FILE}">]>${svgDoc('<feImage href="&f;"/>')}`,
      ),
    ).toBeNull();
    expect(refused(svgDoc(`<style>@import "${SVG_FILE}";</style>`))).toBeNull();
  });

  it('refuses an href hidden in another value, encoded, or under any prefix', () => {
    for (const body of [
      // a value that seems to swallow the real href
      `<desc>href='#</desc><feImage href="${PNG_FILE}"/><desc>'</desc>`,
      `<feImage href="&#47;etc/passwd"/>`,
      `<feImage href=" #x"/>`,
      `<feImage href="#/../../etc/passwd"/>`,
      `<feImage xmlns:z="http://www.w3.org/1999/xlink" z:href="${PNG_FILE}"/>`,
      `<feImage HREF = '${PNG_FILE}'/>`,
      `<rect fill="u&#114;l(${SVG_FILE}#p)"/>`,
      `<rect style="fill:URL( '${SVG_FILE}#p')"/>`,
      `<?xml-stylesheet href="${SVG_FILE}"?>`,
    ]) {
      expect(refused(svgDoc(body)), body).toBeNull();
    }
  });

  it('checks a data: href the way resvg decodes it', () => {
    const inner = encodeURIComponent(svgDoc(feImage('href', PNG_FILE)));
    for (const href of [
      // resvg drops tabs and newlines anywhere in a data: URL
      `data:image/svg+xml,${inner.replace('feImage%20href', 'feImage%20h&#10;ref')}`,
      `data:image/svg+xml,${inner.replace('feImage%20href', 'feImage%20h&#9;ref')}`,
      // and percent-decodes before base64
      `data:image/svg+xml;base64,${Buffer.from(
        svgDoc(feImage('href', PNG_FILE)),
      )
        .toString('base64')
        .replace(/A/g, '%41')}`,
    ]) {
      const outer = svgDoc(feImage('href', href));
      expect(dark(new Resvg(outer).render().pixels), href.slice(0, 40)).toBe(
        64 * 64,
      ); // control
      expect(refused(outer), href.slice(0, 40)).toBeNull();
    }
    // A data: href that does not decode is refused too.
    expect(
      refused(svgDoc('<feImage href="data:image/png;base64,A"/>')),
    ).toBeNull();
  });

  it('allows SVGs nested 4 deep and refuses deeper', () => {
    let doc = svgDoc('<rect width="64" height="64"/>');
    for (let depth = 1; depth <= 5; depth++) {
      doc = svgDoc(feImage('href', base64Svg(doc)));
      expect(refused(doc) === null, `depth ${depth}`).toBe(depth > 4);
    }
  });

  it('decodes data: URLs as WHATWG does', () => {
    expect(decodeDataUrl('  data:,a%20b#c ')).toEqual({
      mime: 'text/plain',
      bytes: Buffer.from('a b'),
    });
    expect(decodeDataUrl('data:,a#c', { keepFragment: true })?.bytes).toEqual(
      Buffer.from('a#c'),
    );
    expect(decodeDataUrl('data:Image/PNG;base64,YW\nJj')).toEqual({
      mime: 'image/png',
      bytes: Buffer.from('abc'),
    });
    expect(decodeDataUrl('data:;base64,YWJjZ')).toBeNull(); // length 4n+1
    expect(decodeDataUrl('data:;base64,YW*j')).toBeNull();
    expect(decodeDataUrl('data:image/png;base64')).toBeNull(); // no comma
    expect(decodeDataUrl('https://example.test/x.png')).toBeNull();
  });
});

describe('a fetched SVG', () => {
  const reply = { body: Buffer.alloc(0) };
  beforeEach(() => {
    vi.spyOn(imageDeps, 'lookup').mockImplementation(async () => [
      { address: '93.184.216.34', family: 4 },
    ]);
    vi.spyOn(imageDeps, 'request').mockImplementation(async () => ({
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
      body: reply.body,
    }));
  });
  const img = page(
    '<img src="https://public.test/logo.svg" width="64" height="64"/>',
  );

  for (const [name, body] of Object.entries(REFS)) {
    it(`draws no file through ${name}`, async () => {
      reply.body = Buffer.from(svgDoc(body()));
      expect(await inkOf(img)).toBe(0);
    });
  }

  it('is a blank when it refers outside itself, and still draws when it does not', async () => {
    reply.body = Buffer.from(svgDoc(REFS['feImage href (png)']()));
    const tree = {
      type: 'img',
      props: { src: 'https://public.test/a.svg', width: '8', height: '8' },
    };
    await guardImages(tree);
    expect(tree.props.src).toBe(BLANK_IMAGE);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('the SVG holds an href outside the image'),
    );

    reply.body = Buffer.from(
      svgDoc('<rect width="64" height="64" fill="#000"/>'),
    );
    expect(await inkOf(img.replace('logo', 'clean'))).toBe(64 * 64);
    expect(fetched).toEqual([]);
  });
});
