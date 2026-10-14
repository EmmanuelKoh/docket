// tests/render-image-guard.test.ts — Satori never fetches an image. Every
// image source in a template (img src, image href, CSS url()) is a data:
// URL by the time Satori runs (render/image-guard.js): data: is checked
// and passed on as base64 (kept as typed when it already is), an https
// image is fetched under the guard's rules and inlined, and anything
// else, or anything refused, becomes a transparent pixel. The SVG checks
// on data: images are in tests/render-svg-files.test.ts.
// A color never feeds a url() through currentcolor, and an svg href that
// is not a #fragment never reaches resvg, which would read it as a file.
// DNS and the https transport are swapped out through imageDeps; the
// global fetch records any call, and none may happen.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
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
  guardImages,
  imageDeps,
  isPublicAddress,
  LIMITS,
  pinnedLookup,
  readCapped,
} from '@/render/image-guard.js';
import { renderToEscpos, toPixels } from '@/render/render-core.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/render-image-guard`;
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

// A solid black PNG.
function blackPng(size = 8): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
const PNG_BYTES = blackPng();

type Address = { address: string; family: number };
type Reply = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

// Hostname -> addresses; anything else does not resolve.
const DNS: Record<string, Address[]> = {
  'public.test': [{ address: '93.184.216.34', family: 4 }],
  'internal.test': [{ address: '10.0.0.5', family: 4 }],
  'mixed.test': [
    { address: '93.184.216.34', family: 4 },
    { address: '192.168.1.10', family: 4 },
  ],
  'six.test': [{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }],
  'mapped.test': [{ address: '::ffff:127.0.0.1', family: 6 }],
};
const ipLiteral = (host: string): Address[] | null => {
  const family = net.isIP(host);
  return family ? [{ address: host, family }] : null;
};

// url -> reply; unknown URLs answer a PNG.
let replies: Record<string, Reply> = {};
const requests: { url: string; addresses: Address[] }[] = [];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  replies = {};
  requests.length = 0;
  fetched.length = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(imageDeps, 'lookup').mockImplementation(async (host: string) => {
    const found = DNS[host] ?? ipLiteral(host);
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  });
  vi.spyOn(imageDeps, 'request').mockImplementation(
    async (url: URL, { addresses }: { addresses: Address[] }) => {
      requests.push({ url: url.href, addresses });
      return (
        replies[url.href] ?? {
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: PNG_BYTES,
        }
      );
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  warn.mockRestore();
});

// The src one <img> ends up with.
async function srcAfter(src: string) {
  const tree = {
    type: 'div',
    props: {
      children: [{ type: 'img', props: { src, width: '8', height: '8' } }],
    },
  };
  await guardImages(tree);
  return tree.props.children[0].props.src;
}

describe('sources that are never fetched', () => {
  it('becomes a blank, with no DNS lookup and no request', async () => {
    for (const src of [
      'http://example.test/x.png',
      'file:///etc/hosts',
      'logo.png',
      '//example.test/x.png',
      'ftp://example.test/x.png',
      'javascript:alert(1)',
      'https://public.test:8443/x.png',
      'https://user:pw@public.test/x.png',
    ]) {
      expect(await srcAfter(src), src).toBe(BLANK_IMAGE);
    }
    expect(imageDeps.lookup).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('keeps a data: URL exactly as typed', async () => {
    const data = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    expect(await srcAfter(data)).toBe(data);
    expect(await srcAfter(`"${data}"`)).toBe(`"${data}"`);
    expect(requests).toEqual([]);
  });
});

describe('https sources the guard refuses', () => {
  it('a host that is or resolves to a non-public address', async () => {
    for (const src of [
      'https://127.0.0.1/x.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x.png',
      'https://[::ffff:127.0.0.1]/x.png',
      'https://[::ffff:0:7f00:1]/x.png', // IPv4-translated loopback
      'https://[fd00::1]/x.png',
      'https://0.0.0.0/x.png',
      'https://internal.test/x.png', // DNS answers 10.0.0.5
      'https://mixed.test/x.png', // one public, one private address
      'https://mapped.test/x.png', // DNS answers ::ffff:127.0.0.1
      'https://nowhere.test/x.png', // does not resolve
    ]) {
      expect(await srcAfter(src), src).toBe(BLANK_IMAGE);
    }
    expect(requests).toEqual([]);
  });

  it('a redirect to a private host', async () => {
    replies['https://public.test/r.png'] = {
      status: 302,
      headers: { location: 'https://internal.test/x.png' },
      body: Buffer.alloc(0),
    };
    expect(await srcAfter('https://public.test/r.png')).toBe(BLANK_IMAGE);
    expect(requests.map((r) => r.url)).toEqual(['https://public.test/r.png']);
  });

  it('a redirect to http, and more than 3 redirects', async () => {
    replies['https://public.test/to-http.png'] = {
      status: 301,
      headers: { location: 'http://public.test/x.png' },
      body: Buffer.alloc(0),
    };
    expect(await srcAfter('https://public.test/to-http.png')).toBe(BLANK_IMAGE);
    for (let i = 0; i < 5; i++) {
      replies[`https://public.test/loop${i}.png`] = {
        status: 302,
        headers: { location: `/loop${i + 1}.png` },
        body: Buffer.alloc(0),
      };
    }
    requests.length = 0;
    expect(await srcAfter('https://public.test/loop0.png')).toBe(BLANK_IMAGE);
    expect(requests).toHaveLength(LIMITS.maxRedirects + 1);
  });

  it('a body over 5 MB, a non-image body, a non-200 answer', async () => {
    replies['https://public.test/big.png'] = {
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: Buffer.concat([PNG_BYTES, Buffer.alloc(LIMITS.maxBytes)]),
    };
    replies['https://public.test/page.png'] = {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from('<html></html>'),
    };
    replies['https://public.test/lies.png'] = {
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('<html></html>'),
    };
    replies['https://public.test/gone.png'] = {
      status: 404,
      headers: {},
      body: Buffer.alloc(0),
    };
    for (const name of ['big', 'page', 'lies', 'gone']) {
      expect(await srcAfter(`https://public.test/${name}.png`), name).toBe(
        BLANK_IMAGE,
      );
    }
  });

  it('a fetch that takes too long', async () => {
    const saved = LIMITS.timeoutMs;
    LIMITS.timeoutMs = 50;
    try {
      vi.mocked(imageDeps.request).mockImplementation(
        () => new Promise(() => {}),
      );
      expect(await srcAfter('https://public.test/slow.png')).toBe(BLANK_IMAGE);
    } finally {
      LIMITS.timeoutMs = saved;
    }
  });
});

describe('https sources the guard allows', () => {
  it('inlines a public image as a data: URL, connecting only to the checked addresses', async () => {
    const src = await srcAfter('https://public.test/logo.png');
    expect(src).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
    expect(requests).toEqual([
      { url: 'https://public.test/logo.png', addresses: DNS['public.test'] },
    ]);
    expect(await srcAfter('https://six.test/logo.png')).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it('follows a redirect to another public host, checking it again', async () => {
    replies['https://public.test/moved.png'] = {
      status: 301,
      headers: { location: 'https://six.test/new.png' },
      body: Buffer.alloc(0),
    };
    expect(await srcAfter('https://public.test/moved.png')).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(imageDeps.lookup).toHaveBeenCalledWith('six.test');
  });

  it('prints the image, and Satori never calls fetch', async () => {
    const template =
      '<div style="display:flex;width:576px;background:#fff"><img src="https://public.test/logo.png" width="64" height="64"/></div>';
    const { height } = await renderToEscpos(template, {});
    expect(height).toBeGreaterThan(64);
    const { rgba } = await toPixels(template, 100);
    let dark = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] > 0 && rgba[i] < 128) dark++;
    }
    expect(dark).toBeGreaterThan(60 * 60); // the 64x64 black square
    expect(dark).toBeLessThanOrEqual(64 * 64);
    expect(fetched).toEqual([]);
  });

  it('fetches at most 20 different images per render', async () => {
    const tree = {
      type: 'div',
      props: {
        children: Array.from({ length: 25 }, (_, i) => ({
          type: 'img',
          props: {
            src: `https://public.test/${i}.png`,
            width: '1',
            height: '1',
          },
        })),
      },
    };
    await guardImages(tree);
    expect(requests).toHaveLength(LIMITS.maxImages);
    expect(tree.props.children.at(-1)?.props.src).toBe(BLANK_IMAGE);
  });
});

describe('every place Satori would fetch from', () => {
  it('rewrites img, image href and style url(), and drops a tw url()', async () => {
    const tree = {
      type: 'div',
      props: {
        style: {
          backgroundImage: 'url(http://example.test/bg.png)',
          maskImage: 'url("https://public.test/m.png"), url(\'file:///x\')',
          WebkitMaskImage: 'url(https://internal.test/m.png)',
        },
        tw: 'bg-[url(http://example.test/tw.png)]',
        children: [
          { type: 'img', props: { src: 'http://example.test/a.png' } },
          {
            type: 'svg',
            props: {
              children: [
                {
                  type: 'image',
                  props: {
                    href: 'http://example.test/b.png',
                    'xlink:href': 'https://169.254.169.254/x',
                  },
                },
              ],
            },
          },
        ],
      },
    };
    await guardImages(tree);
    const png = `url(data:image/png;base64,${PNG_BYTES.toString('base64')})`;
    expect(tree.props.style).toEqual({
      backgroundImage: `url(${BLANK_IMAGE})`,
      maskImage: `${png}, url(${BLANK_IMAGE})`,
      WebkitMaskImage: `url(${BLANK_IMAGE})`,
    });
    expect(tree.props.tw).toBeUndefined();
    // An img with no size of its own takes no room once blank.
    expect(tree.props.children[0].props).toMatchObject({
      src: BLANK_IMAGE,
      width: 0,
      height: 0,
    });
    expect(tree.props.children[1].props.children[0].props).toMatchObject({
      href: BLANK_IMAGE,
      'xlink:href': BLANK_IMAGE,
    });
    expect(requests.map((r) => r.url)).toEqual(['https://public.test/m.png']);
  });

  it('drops a style value with a url( it cannot read', async () => {
    const tree = {
      type: 'div',
      props: { style: { backgroundImage: 'url(http://a b)', color: '#000' } },
    };
    await guardImages(tree);
    expect(tree.props.style).toEqual({ color: '#000' });
  });

  // The url() pattern honors quotes; Satori splits layers at commas
  // outside parentheses and ignores quotes. A quoted data: URL can then
  // hold a layer of its own that Satori loads.
  it('drops a value whose quoted data: URL hides a layer Satori would load', async () => {
    const T = 'http://127.0.0.1:9/metadata';
    const hidden = [
      `linear-gradient(red, url('data:x) ), url(${T}), url(data:y')`,
      `linear-gradient(red, url(&quot;data:x) ), url(${T}), url(data:y&quot;)`,
      `radial-gradient(red, url('data:x) ), url('${T}'), url(data:y')`,
      `url(data:image/png;base64,AAAA) url('data:x), url(${T}), url(data:y')`,
    ];
    for (const value of hidden) {
      for (const prop of ['background-image', 'background', 'mask-image']) {
        const style = `display:flex;width:20px;height:20px;background-color:#000;${prop}:${value}`;
        const markup = `<div style="display:flex;width:100px;background:#fff"><div style="${style.replace(/"/g, '&quot;')}"></div></div>`;
        await toPixels(markup, 40).catch(() => {});
        expect(fetched, `${prop}: ${value}`).toEqual([]);

        // The value is dropped, or what is left loads no http URL.
        const tree = {
          type: 'div',
          props: {
            style: {
              [prop]: value.replace(/&quot;/g, '"'),
              color: '#000',
            } as Record<string, string>,
          },
        };
        await guardImages(tree);
        expect(tree.props.style.color).toBe('#000');
        expect(tree.props.style[prop] ?? '', `${prop}: ${value}`).not.toContain(
          T,
        );
      }
    }
    expect(requests).toEqual([]);
  });

  it('drops the reviewed hidden-layer value outright', async () => {
    const value = `linear-gradient(red, url('data:x) ), url(http://127.0.0.1:9/x), url(data:y')`;
    for (const key of [
      'backgroundImage',
      'background',
      'maskImage',
      'WebkitMaskImage',
    ]) {
      const tree = {
        type: 'div',
        props: { style: { [key]: value, color: '#000' } },
      };
      await guardImages(tree);
      expect(tree.props.style, key).toEqual({ color: '#000' });
    }
  });

  it('keeps layered values whose every loaded layer is a data: URL, re-encoding one that is not base64', async () => {
    const markup = `<svg xmlns='http://www.w3.org/2000/svg'><rect fill='url(#g)'/></svg>`;
    const style = {
      backgroundImage: `linear-gradient(red, blue), url('data:image/png;base64,AAAA')`,
      background: `repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px), url(data:image/png;base64,AAAA)`,
      maskImage: `url("data:image/svg+xml;utf8,${markup.replace('#', '%23')}")`,
    };
    const tree = { type: 'div', props: { style: { ...style } } };
    await guardImages(tree);
    expect(tree.props.style).toEqual({
      ...style,
      maskImage: `url(data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')})`,
    });
  });

  it('renders templates with each kind of refused source, never calling fetch', async () => {
    for (const template of [
      '<div style="display:flex"><img src="http://127.0.0.1/x.png" width="10" height="10"/></div>',
      '<div style="display:flex;width:100px;height:100px;background-image:url(http://169.254.169.254/x)"></div>',
      '<style>.a{background-image:url(https://internal.test/x.png)}</style><div class="a" style="display:flex;width:50px;height:50px"></div>',
      '<div style="display:flex"><svg width="10" height="10" viewBox="0 0 10 10"><image href="http://example.test/x.png" width="10" height="10"/></svg></div>',
    ]) {
      const { bytes } = await renderToEscpos(template, {});
      expect(bytes.length, template).toBeGreaterThan(0);
    }
    expect(fetched).toEqual([]);
    expect(requests).toEqual([]);
  });
});

// Satori pastes the element's color into every style value that names
// currentcolor, after the guard and before it reads url() layers.
describe('currentcolor', () => {
  const T = 'http://127.0.0.1:9/x';
  const box = (style: string) =>
    `<div style="display:flex;width:40px;height:40px;background-color:#000;${style}"></div>`;

  it('never builds a url() Satori would fetch (reviewed repros)', async () => {
    const templates = [
      // color inherited from a parent
      ...[
        'background-image',
        'background',
        'mask-image',
        '-webkit-mask-image',
      ].map(
        (prop) =>
          `<div style="display:flex;width:576px;height:100px;color:url">${box(`${prop}:currentcolor(${T})`)}</div>`,
      ),
      // color on the same element
      `<div style="display:flex;width:576px;height:100px">${box(`color:url;background-image:currentColor(${T})`)}</div>`,
      // a root svg's style
      `<div style="display:flex;width:576px;height:100px;color:url"><svg width="40" height="40" viewBox="0 0 40 40" style="background-image:currentcolor(${T})"><rect width="10" height="10"/></svg></div>`,
      // a color that is itself a url()
      `<div style="display:flex;width:576px;height:100px;color:url(${T})">${box('background-image:currentcolor')}</div>`,
    ];
    for (const template of templates) {
      await toPixels(template, 120).catch(() => {});
      expect(fetched, template).toEqual([]);
    }
    expect(requests).toEqual([]);
  });

  it('keeps plain colors and drops any other color', async () => {
    const plain = [
      '#000',
      '#ffffff',
      'rgb(0, 0, 0)',
      'rgba(0,0,0,0.5)',
      'hsl(0, 0%, 20%)',
      'Black',
      ' white ',
      'transparent',
      'currentColor',
    ];
    const odd = [
      'url',
      'ur',
      'rl(',
      'rgb(url(x))',
      "black$'",
      'xcurrentcolor',
      'var(--c)',
      '',
    ];
    for (const color of [...plain, ...odd]) {
      const tree = { type: 'div', props: { style: { color } } };
      await guardImages(tree);
      expect(tree.props.style.color, JSON.stringify(color)).toBe(
        plain.includes(color) ? color : undefined,
      );
    }
  });

  it('drops a background or mask value that names currentcolor, and tw with arbitrary values', async () => {
    const tree = {
      type: 'div',
      props: {
        style: {
          color: '#000',
          backgroundImage: 'currentcolor(https://public.test/a.png)',
          background: 'linear-gradient(currentColor, #fff)',
          'mask-image': 'currentcolor',
          WebkitMaskImage: 'CURRENTCOLOR',
          borderColor: 'currentcolor',
          backgroundColor: 'currentcolor',
        },
        tw: 'flex bg-[currentcolor]',
        children: [
          { type: 'div', props: { tw: 'flex text-red-500 p-4' } },
          { type: 'div', props: { tw: 'flex text-current' } },
          { type: 'div', props: { tw: 'flex w-[10px]' } },
        ],
      },
    };
    await guardImages(tree);
    expect(tree.props.style).toEqual({
      color: '#000',
      borderColor: 'currentcolor',
      backgroundColor: 'currentcolor',
    });
    expect(tree.props.tw).toBeUndefined();
    expect(tree.props.children.map((c) => c.props.tw)).toEqual([
      'flex text-red-500 p-4',
      undefined,
      undefined,
    ]);
    expect(requests).toEqual([]);
  });
});

// resvg reads an svg href that is not a #fragment as a server file path.
describe('svg hrefs', () => {
  const dark = ({ rgba }: { rgba: Uint8Array | Buffer }) => {
    let n = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] < 128 && rgba[i + 3] > 128) n++;
    }
    return n;
  };

  it('never reads a file through feImage or use, and keeps #fragment links', async () => {
    const dir = process.env.DATA_DIR as string;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'black.png');
    fs.writeFileSync(file, blackPng(64));
    const svg = (body: string) =>
      `<div style="display:flex;width:576px;background:#fff"><svg width="64" height="64" viewBox="0 0 64 64">${body}</svg></div>`;
    const viaFeImage = (attr: string) =>
      svg(
        `<filter id="f" x="0" y="0" width="64" height="64" filterUnits="userSpaceOnUse"><feImage ${attr}="${file}" x="0" y="0" width="64" height="64"/></filter><rect width="64" height="64" fill="#fff" filter="url(#f)"/>`,
      );
    for (const attr of ['href', 'xlink:href']) {
      expect(dark(await toPixels(viaFeImage(attr), 100)), attr).toBe(0);
    }
    expect(
      dark(
        await toPixels(
          svg(`<use href="${file}" width="64" height="64"/>`),
          100,
        ),
      ),
    ).toBe(0);

    // A #fragment still links inside the svg.
    const linked = await toPixels(
      svg(
        '<defs><rect id="r" width="64" height="64" fill="#000"/></defs><use href="#r"/>',
      ),
      100,
    );
    expect(dark(linked)).toBeGreaterThan(1000);
    expect(fetched).toEqual([]);
  });
});

describe('addresses', () => {
  it('only public unicast addresses pass', () => {
    const refused = [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '239.255.255.250',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fe80::1%en0',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
      '::127.0.0.1',
      // IPv4-translated (::ffff:0:a.b.c.d), blocked whole
      '::ffff:0:7f00:1',
      '::ffff:0:127.0.0.1',
      '::ffff:0:a00:1',
      '0:0:0:0:ffff:0:5db8:d822',
      '::ffff:0:0:0',
      '64:ff9b::10.0.0.1',
      '64:ff9b::a9fe:a9fe',
      '2002:a00:1::1',
      '2001:db8::1',
      'not an address',
    ];
    for (const ip of refused) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of [
      '8.8.8.8',
      '93.184.216.34',
      '172.32.0.1',
      '2606:2800:220:1:248:1893:25c8:1946',
      '64:ff9b::5db8:d822',
      '::ffff:93.184.216.34',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe('the https transport', () => {
  it('connects to the pinned address, not to what the hostname resolves to', async () => {
    const restore = vi.mocked(imageDeps.request);
    restore.mockRestore(); // the real transport
    const seen: string[] = [];
    const server = net.createServer((socket) => {
      seen.push(String(socket.remoteAddress));
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(
        imageDeps.request(
          new URL(`https://no-such-host.invalid:${port}/x.png`),
          {
            addresses: [{ address: '127.0.0.1', family: 4 }],
            signal: AbortSignal.timeout(5000),
            maxBytes: 1024,
          },
        ),
      ).rejects.toThrow();
      expect(seen).toHaveLength(1); // reached 127.0.0.1 without DNS
    } finally {
      server.close();
    }
  });

  it('pinnedLookup answers with the checked addresses only', () => {
    const lookup = pinnedLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const one = vi.fn();
    lookup('evil.test', {}, one);
    expect(one).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const all = vi.fn();
    lookup('evil.test', { all: true }, all);
    expect(all.mock.calls[0][1]).toHaveLength(2);
  });

  it('readCapped stops a body that grows past the limit', async () => {
    const { Readable } = await import('node:stream');
    await expect(
      readCapped(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000),
    ).rejects.toThrow(/size limit/);
    await expect(
      readCapped(Readable.from([Buffer.alloc(400), Buffer.alloc(400)]), 1000),
    ).resolves.toHaveLength(800);
  });
});
