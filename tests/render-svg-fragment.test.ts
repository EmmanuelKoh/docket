// tests/render-svg-fragment.test.ts — a gradient, pattern or filter inside
// an inline <svg> can be referenced from a style value as url(#id). The
// image guard (render/image-guard.js) leaves those fragment references
// alone inside an svg, since nothing is fetched or read for them; any
// other url() in the same style value is still checked.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { toPixels } from '@/render/render-core.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/render-svg-fragment`;
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

// Counts of near-white and near-black pixels inside the 200x200 svg box.
async function tones(markup: string) {
  const { rgba, width } = await toPixels(markup, 300);
  let light = 0;
  let dark = 0;
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 200; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] === 0) continue;
      if (rgba[i] > 200) light++;
      else if (rgba[i] < 56) dark++;
    }
  }
  return { light, dark };
}

// A left-to-right white-to-black gradient filling the whole box.
const gradientSvg = (fill: string) =>
  `<div style="display:flex;width:576px;height:300px;background:#fff">` +
  `<svg width="200" height="200" viewBox="0 0 200 200">` +
  `<defs><linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>` +
  `</linearGradient></defs>` +
  `<rect width="200" height="200" ${fill}/></svg></div>`;

describe('url(#id) inside an inline svg', () => {
  it('draws the gradient from the attribute form', async () => {
    const t = await tones(gradientSvg('fill="url(#grad)"'));
    expect(t.light).toBeGreaterThan(2000);
    expect(t.dark).toBeGreaterThan(2000);
  });

  it('draws the same gradient from the style form', async () => {
    const attr = await tones(gradientSvg('fill="url(#grad)"'));
    const style = await tones(gradientSvg('style="fill:url(#grad)"'));
    expect(style.light).toBeGreaterThan(2000);
    expect(Math.abs(style.light - attr.light)).toBeLessThan(400);
    expect(Math.abs(style.dark - attr.dark)).toBeLessThan(400);
  });

  it('still blanks a style value that mixes a fragment with an outside url', async () => {
    const t = await tones(
      gradientSvg('style="fill:url(#grad), url(http://127.0.0.1/x.png)"'),
    );
    // The whole value is dropped, so the rect falls back to its default
    // fill instead of the gradient: no white half.
    expect(t.light).toBeLessThan(400);
    expect(fetched).toEqual([]);
  });
});
