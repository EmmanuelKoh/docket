// tests/render-svg-seal.test.ts — escaped text inside an inline <svg>
// never becomes live SVG. Satori writes an svg subtree out as raw markup
// inside an XML attribute (a data: URL), and resvg entity-decodes that
// attribute before it parses the inner SVG, so "&lt;rect/&gt;" in an svg
// would draw a rect even with no decoding of ours. render-core drops text
// inside an svg and escapes svg attribute and style values once for each
// parse (render/render-core.js prepareTree).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { escapeHtml } from '@/render/escape-html.js';
import { fill, toElement, toPixels } from '@/render/render-core.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/render-svg-seal`;
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

// Dark pixels in the rendered RGBA.
async function ink(markup: string) {
  const { rgba } = await toPixels(markup, 300);
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0 && rgba[i] < 128) n++;
  }
  return n;
}

const page = (svgInner: string) =>
  `<div style="display:flex;width:576px;height:300px;background:#fff"><svg width="200" height="200" viewBox="0 0 200 200">${svgInner}</svg></div>`;

const RECT = '<rect width="200" height="200" fill="#000"/>';
const IMAGE = '<image href="http://example.test/x" width="200" height="200"/>';

type Node = { type?: string; props?: Record<string, unknown> };
function svgOf(tree: unknown): Node {
  const stack = [tree];
  while (stack.length) {
    const n = stack.pop() as Node | Node[] | undefined;
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) stack.push(...n);
    else if (n.type === 'svg') return n;
    else stack.push(n.props?.children);
  }
  throw new Error('no svg');
}

describe('an inline svg', () => {
  it('still draws its own elements', async () => {
    expect(await ink(page(RECT))).toBe(200 * 200);
  });

  it('escaped <rect/> text inside it draws nothing', async () => {
    const markup = await fill(page('{{ v }}'), { v: escapeHtml(RECT) });
    expect(await ink(markup)).toBe(0);
    // No text is left inside the svg to be written out as markup.
    expect(svgOf(toElement(markup)).props?.children).toEqual([]);
  });

  it('escaped <image href> text inside it fetches nothing and draws nothing', async () => {
    fetched.length = 0;
    const markup = await fill(page('{{ v }}'), { v: escapeHtml(IMAGE) });
    expect(await ink(markup)).toBe(0);
    expect(fetched).toEqual([]);
  });

  it('an escaped value that closes an attribute stays a value', async () => {
    // Well-formed once Satori closes the tag, so without the escaping the
    // inner SVG would parse and draw the rect.
    const breakout = `"/>${RECT}<circle r="0`;
    for (const template of [
      page('<circle r="1" fill="{{ v }}"/>'),
      page('<circle r="1" style="fill:{{ v }}"/>'),
    ]) {
      const markup = await fill(template, { v: escapeHtml(breakout) });
      // Only the 1-pixel circle (or nothing), never the 200x200 rect.
      expect(await ink(markup), template).toBeLessThan(10);
    }
  });

  it('a raw quote in a single-quoted attribute cannot add attributes', async () => {
    const markup = page(`<circle r="1" fill='a" transform="scale(500)'/>`);
    expect(await ink(markup)).toBeLessThan(10);
  });

  it('text outside an svg still decodes and prints as text', async () => {
    const markup = await fill('<div style="display:flex">{{ v }}</div>', {
      v: escapeHtml(RECT),
    });
    const root = toElement(markup) as Node;
    const div = (root.props?.children as Node[]).find(Boolean);
    expect(div?.props?.children).toBe(RECT);
  });
});
