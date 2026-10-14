// render/image-guard.js — the only way an image from the network reaches
// a print.
//
// Satori fetches every image source that is not a data: URL with a plain
// fetch(): <img src>, <image href>, and url() in background and mask
// styles. Templates are account input and message text can carry markup,
// so that fetch could reach anything the server can reach: a LAN printer,
// a router, a cloud metadata address. guardImages runs on the element
// tree before Satori and rewrites every such source:
//   data: URL       decoded, checked (below) and re-encoded as base64
//   https: URL      fetched here under the rules below, inlined as data:
//   anything else   a blank (a transparent pixel)
// so Satori only ever sees data: URLs and never fetches. A style value is
// dropped whole if it holds a url( this cannot read or a data: URL the
// check refuses, or if Satori would read a url() layer in it that is not
// a checked data: URL (rewriteCss). Colors are kept out of image input
// too, because Satori pastes the color into any value that names
// currentcolor (sealCurrentColor).
//
// Fetch rules: https on the default port, no user or password in the URL.
// The host must resolve only to public addresses (every address checked),
// and the connection goes to exactly the addresses checked, so a second
// DNS answer cannot swap in a private one. At most 3 redirects, each
// checked the same way. 5 seconds for the whole fetch, 5 MB for the body,
// and the body must be PNG, JPEG, GIF (checked by content type and first
// bytes) or SVG. At most 20 different remote images per render. An image
// that breaks a rule or fails to load becomes a blank. fetchPublic applies
// the same address rules to other fetches of account-set addresses (the
// morning brief's calendar feeds).
//
// SVG images and server files: resvg reads an href that is not a data:
// URL or a #fragment as a file path on the server. feImage does at any
// depth, including inside an SVG image; image does in the top-level SVG.
// resvg loads a data: URL as an SVG when its type is image/svg+xml,
// text/plain or missing (in any letter case), and unzips one that is
// gzip. So every data: image is decoded here, whatever its type, and
// refused if its bytes are gzip, or are UTF-8 text that holds an entity
// declaration, an @import, an href that is not a #fragment or a data:
// URL, or a url() that does not start with # or data:. A data: href
// inside is checked the same way, up to 4 levels down; deeper is refused.
// Bytes that are not UTF-8 (PNG, JPEG) never parse as an SVG. What passes
// is re-encoded as base64, so the bytes resvg decodes are exactly the
// bytes checked. A fetched SVG is checked the same way.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { unescapeHtml } from './escape-html.js';

export const LIMITS = { timeoutMs: 5000, maxBytes: 5 * 1024 * 1024, maxRedirects: 3, maxImages: 20 };

// 1x1 transparent PNG.
export const BLANK_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==';

// ---- addresses ----

// Loopback, private, link-local, CGNAT, multicast, unspecified, reserved
// and documentation ranges, IPv4 and IPv6. BlockList also matches
// IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 rules. The
// IPv4-translated range (::ffff:0:a.b.c.d) is blocked whole.
const BLOCKED = new net.BlockList();
for (const [a, bits] of [
  ['0.0.0.0', 8], // unspecified, "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
]) {
  BLOCKED.addSubnet(a, bits, 'ipv4');
}
for (const [a, bits] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['::ffff:0:0:0', 96], // IPv4-translated
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (ULA)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local
  ['ff00::', 8], // multicast
]) {
  BLOCKED.addSubnet(a, bits, 'ipv6');
}

// The eight 16-bit groups of an IPv6 address.
function groups(ip) {
  let s = ip;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    s = `${s.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map(x => parseInt(x, 16));
}

const v4From = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// True only for a public unicast address.
export function isPublicAddress(address) {
  const ip = String(address).split('%')[0]; // drop an IPv6 zone id
  const family = net.isIP(ip);
  if (family === 4) return !BLOCKED.check(ip, 'ipv4');
  if (family !== 6) return false;
  if (BLOCKED.check(ip, 'ipv6')) return false;
  const g = groups(ip);
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) {
    return isPublicAddress(v4From(g[6], g[7]));
  }
  if (g[0] === 0x2002) return isPublicAddress(v4From(g[1], g[2]));
  return true;
}

// ---- transport ----

// A net lookup that answers with addresses already resolved and checked,
// so the socket connects to one of them and nothing else.
export function pinnedLookup(addresses) {
  const list = addresses.map(a => ({ address: a.address, family: a.family }));
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  };
}

// Reads a response body, failing as soon as it passes maxBytes.
export function readCapped(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = err => {
      if (done) return;
      done = true;
      stream.destroy();
      reject(err);
    };
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) fail(new Error('response is over the size limit'));
      else chunks.push(chunk);
    });
    stream.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', fail);
    stream.on('close', () => fail(new Error('connection closed before the response ended')));
  });
}

const IMAGE_HEADERS = {
  accept: 'image/png,image/jpeg,image/gif,image/svg+xml',
  'user-agent': 'docket-render',
};

// GET over http or https (by the URL) to the given addresses only. Never
// follows a redirect: the caller checks the Location and asks again.
function pinnedGet(url, { addresses, signal, maxBytes, headers = IMAGE_HEADERS }) {
  const client = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: pinnedLookup(addresses),
        signal,
        headers,
      },
      res => {
        const status = res.statusCode || 0;
        if (status !== 200) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        if (Number(res.headers['content-length']) > maxBytes) {
          res.destroy();
          reject(new Error('response is over the size limit'));
          return;
        }
        readCapped(res, maxBytes).then(body => resolve({ status, headers: res.headers, body }), reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// Swappable for tests. lookup resolves every address of a host; request
// performs one GET to the given addresses and returns
// { status, headers (lower-case names), body: Buffer }. Used by every
// fetchPublic, images and calendar feeds alike.
export const imageDeps = {
  lookup: host => dns.promises.lookup(host, { all: true, verbatim: true }),
  request: pinnedGet,
};

// ---- one image ----

const settle = (promise, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      v => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      err => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });

const RASTER_TYPES = new Set(['image/png', 'image/apng', 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/gif']);

function sniff(body) {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 4 && body.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}

function toDataUrl(contentType, body) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/svg+xml') {
    if (!/<svg[\s>]/i.test(body.toString('utf8', 0, Math.min(body.length, 4096)))) {
      throw new Error('body is not an SVG image');
    }
    const outside = outsideReference(body);
    if (outside) throw new Error(`the SVG holds ${outside}`);
    return `data:image/svg+xml;base64,${body.toString('base64')}`;
  }
  const sniffed = sniff(body);
  if (!RASTER_TYPES.has(type) || !sniffed) throw new Error(`not a PNG, JPEG, GIF or SVG image (${type || 'no type'})`);
  return `data:${sniffed};base64,${body.toString('base64')}`;
}

// GETs an address someone typed (a template, an account's config) under
// the address rules above: one of `schemes` on its default port, no user
// or password, every resolved address public, the connection pinned to
// them, each redirect checked the same way. Resolves to the 200 answer
// { status, headers, body }; rejects otherwise. A non-200 answer rejects
// with an error that carries its `status`.
export async function fetchPublic(
  start,
  {
    schemes = ['https:'],
    timeoutMs = LIMITS.timeoutMs,
    maxBytes = LIMITS.maxBytes,
    maxRedirects = LIMITS.maxRedirects,
    headers = IMAGE_HEADERS,
  } = {},
) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = start;
  for (let hop = 0; ; hop++) {
    if (!schemes.includes(url.protocol) || url.port !== '' || url.username || url.password) {
      throw new Error(`only ${schemes.map(p => p.slice(0, -1)).join(' or ')} on the default port`);
    }
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const addresses = await settle(Promise.resolve(imageDeps.lookup(host)), signal);
    if (!addresses?.length) throw new Error(`${host} did not resolve`);
    const refused = addresses.find(a => !isPublicAddress(a.address));
    if (refused) throw new Error(`${host} resolves to ${refused.address}, which is not public`);
    const res = await settle(
      Promise.resolve(imageDeps.request(url, { addresses, signal, maxBytes, headers })),
      signal,
    );
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.location;
      if (!location) throw new Error(`redirect ${res.status} without a location`);
      if (hop >= maxRedirects) throw new Error('too many redirects');
      url = new URL(location, url);
      continue;
    }
    if (res.status !== 200) {
      throw Object.assign(new Error(`answered ${res.status}`), { status: res.status });
    }
    if (res.body.length > maxBytes) throw new Error('response is over the size limit');
    return res;
  }
}

// Fetches one https image under the rules above; resolves to a data: URL
// or rejects.
export async function fetchImage(start) {
  const res = await fetchPublic(start);
  return toDataUrl(res.headers?.['content-type'], res.body);
}

// ---- data: URLs and the SVG check ----

// A data: URL decoded the way resvg's data-url crate decodes one (the
// WHATWG data: URL rules): surrounding spaces and controls trimmed, tabs
// and newlines removed anywhere, the body cut at a #, percent-decoded,
// then forgiving base64 when the header ends in ;base64. Returns
// { mime, bytes }, or null when it is not a data: URL or does not decode.
// keepFragment keeps the body past a #, as Satori did when it re-encoded
// an SVG typed in a template; only for bytes this module re-encodes.
export function decodeDataUrl(text, { keepFragment = false } = {}) {
  const s = trimControls(String(text)).replace(/[\t\n\r]/g, '');
  if (!/^data:/i.test(s)) return null;
  const rest = s.slice(5);
  const comma = rest.indexOf(',');
  if (comma < 0 || rest.slice(0, comma).includes('#')) return null;
  let header = rest.slice(0, comma).trim();
  let body = rest.slice(comma + 1);
  const hash = keepFragment ? -1 : body.indexOf('#');
  if (hash >= 0) body = body.slice(0, hash);
  const base64 = /;\x20*base64$/i.test(header);
  if (base64) header = header.replace(/;\x20*base64$/i, '');
  const mime = header.split(';')[0].trim().toLowerCase() || 'text/plain';
  let bytes = percentDecode(body);
  if (base64) {
    let b64 = bytes.toString('latin1').replace(/[\t\n\f\r ]/g, '');
    if (b64.length % 4 === 0) b64 = b64.replace(/={1,2}$/, '');
    if (b64.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(b64)) return null;
    bytes = Buffer.from(b64, 'base64');
  }
  return { mime, bytes };
}

// Without a regex: /[\x00-\x20]+$/ is quadratic on a long run of spaces.
function trimControls(s) {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start++;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
  return s.slice(start, end);
}

const isHex = b => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);

// %XX is that byte; anything else is its own UTF-8 bytes.
function percentDecode(s) {
  const bytes = Buffer.from(s, 'utf8');
  if (!s.includes('%')) return bytes;
  const out = Buffer.alloc(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x25 && i + 2 < bytes.length && isHex(bytes[i + 1]) && isHex(bytes[i + 2])) {
      out[n++] = Number.parseInt(String.fromCharCode(bytes[i + 1], bytes[i + 2]), 16);
      i += 2;
    } else {
      out[n++] = bytes[i];
    }
  }
  return out.subarray(0, n);
}

// Character references and the five named entities, as an XML parser
// decodes them in attribute values and text.
const XML_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlDecode(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (m, dec, hex, name) => {
    if (name) return XML_NAMED[name.toLowerCase()];
    const code = dec ? Number(dec) : Number.parseInt(hex, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// An href that names an element in the same SVG. No slash, so even read
// as a file path it could not leave the working directory.
export const isFragmentHref = value => /^#[^/\\]*$/.test(value);

// True when every url( in text points inside the SVG (#) or at a data:
// URL. resvg reads no file through url() today; this keeps it that way.
export function urlsAreLocal(text) {
  for (const m of text.matchAll(/url\(\s*["']?/gi)) {
    const at = m.index + m[0].length;
    if (!text.startsWith('#', at) && !text.startsWith('data:', at)) return false;
  }
  return true;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const MAX_SVG_DEPTH = 4;

// Why resvg could load something outside these image bytes, or null when
// it could not. Bytes that are not UTF-8 never parse as an SVG. A quoted
// value is found after every href=, wherever it sits (comments and text
// included), so markup cannot hide one inside another's value.
function outsideReference(bytes, depth = 0) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip data';
  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    return null;
  }
  if (depth > MAX_SVG_DEPTH) return 'images nested too deep';
  if (/<!ENTITY/i.test(text)) return 'an entity declaration';
  for (const m of text.matchAll(/href\s*=\s*(["'])/gi)) {
    const start = m.index + m[0].length;
    const end = text.indexOf(m[1], start);
    const value = xmlDecode(end < 0 ? text.slice(start) : text.slice(start, end));
    if (isFragmentHref(value)) continue;
    if (!value.startsWith('data:')) return 'an href outside the image';
    const inner = decodeDataUrl(value);
    if (!inner) return 'a data: href that does not decode';
    const why = outsideReference(inner.bytes, depth + 1);
    if (why) return why;
  }
  const decoded = xmlDecode(text);
  if (/@import/i.test(decoded)) return 'an @import';
  if (!urlsAreLocal(decoded)) return 'a url() outside the image';
  return null;
}

const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;

// The data: URL to hand Satori for `text`: the same bytes as base64 under
// the same media type, or { reason } when it does not decode, its media
// type is not a plain type/subtype, or its bytes could load anything
// outside the image (outsideReference).
function checkDataUrl(text) {
  const decoded = decodeDataUrl(text, { keepFragment: true });
  if (!decoded) return { reason: 'it does not decode' };
  if (!MEDIA_TYPE.test(decoded.mime)) return { reason: `media type ${decoded.mime.slice(0, 40)}` };
  const outside = outsideReference(decoded.bytes);
  if (outside) return { reason: `it holds ${outside}` };
  return { url: `data:${decoded.mime};base64,${decoded.bytes.toString('base64')}` };
}

// The checked, base64 form of a data: URL, or null when it is refused.
export const safeDataUrl = text => checkDataUrl(text).url ?? null;

// ---- the element tree ----

const unquote = s => {
  const t = s.trim();
  return /^(["']).*\1$/s.test(t) ? t.slice(1, -1) : t;
};

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;

// True when every url( in a style value is a same-document fragment such
// as url(#grad), with nothing a fetch or a file read could use.
const FRAGMENT_URL = /url\(\s*(?:"#[\w.:-]*"|'#[\w.:-]*'|#[\w.:-]*)\s*\)/gi;
function fragmentUrlsOnly(value) {
  return !/url\(/i.test(value.replace(FRAGMENT_URL, ''));
}

// The layers Satori reads from a background, background-image or
// mask-image value: split at commas outside parentheses, counting
// parentheses but not quotes (css-background-parser's parseImages and
// Satori's splitEffects), each layer trimmed.
export function satoriLayers(value) {
  const layers = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      layers.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

// Satori fetches a layer that starts with url( from the text between
// "url(" and the last character, minus one pair of matching quotes.
// True when every such layer is a data: URL already in its checked form
// (safeDataUrl gives it back unchanged), so what Satori loads is what was
// checked, however the url() pattern above read the value.
export function layersAreData(value) {
  return satoriLayers(value).every(layer => {
    if (!/^url\(/i.test(layer)) return true;
    let src = layer.slice(4, -1);
    if ((src.startsWith('"') && src.endsWith('"')) || (src.startsWith("'") && src.endsWith("'"))) {
      src = src.slice(1, -1);
    }
    return src.startsWith('data:') && safeDataUrl(src) === src;
  });
}

// ---- currentcolor ----
//
// Satori replaces "currentcolor" in every style value with the element's
// color (its own, or inherited) after this guard has run and before it
// reads url() layers. So a color and a value that are each harmless can
// add up to a url() this guard never saw. Three rules keep the color out
// of image input:
//   - a style color that is not a plain color is dropped (the element
//     then inherits its parent's color);
//   - a background or mask value that names currentcolor is dropped;
//   - a tw value with an arbitrary value ([...]), currentcolor or url( is
//     dropped, since Tailwind's arbitrary colors are not plain colors.

const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
    'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab ' +
    'orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan ' +
    'teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor'
  ).split(' '),
);

// #hex, rgb()/rgba()/hsl()/hsla() with no nested parentheses, or a CSS
// color name. Surrounding spaces are allowed.
export function isPlainColor(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return /^#[0-9a-f]{3,8}$/.test(v) || /^(rgba?|hsla?)\([^()$]*\)$/.test(v) || NAMED_COLORS.has(v);
}

const IMAGE_STYLE = new Set(['background', 'backgroundimage', 'mask', 'maskimage', 'webkitmask', 'webkitmaskimage']);
const isImageStyle = key => IMAGE_STYLE.has(key.replace(/-/g, '').toLowerCase());

function sealCurrentColor(props) {
  const style = props.style;
  if (style && typeof style === 'object') {
    if ('color' in style && !isPlainColor(style.color)) delete style.color;
    for (const [key, value] of Object.entries(style)) {
      if (typeof value === 'string' && isImageStyle(key) && /currentcolor/i.test(value)) delete style[key];
    }
  }
  if (typeof props.tw === 'string' && /\[|current|url\(/i.test(props.tw)) delete props.tw;
}

const REFUSED = Symbol('refused data: URL');

// Rewrites every image source in a satori-html element tree in place.
// Resolves once all of them are data: URLs (or gone, for a style that
// names a url() this cannot read).
export async function guardImages(root) {
  const remote = new Map(); // url -> Promise<data: URL>
  const work = [];

  // null = keep as typed (a data: URL already in its checked form);
  // REFUSED = a data: URL the check refused (a blank in img and image, the
  // whole value dropped in a style); otherwise the replacement.
  const replacement = raw => {
    const src = unquote(raw);
    if (src.startsWith('data:')) {
      const checked = checkDataUrl(unescapeHtml(src));
      if (checked.url === src) return Promise.resolve(null);
      if (checked.url) return Promise.resolve(checked.url);
      console.warn(`[render] data: image refused: ${checked.reason}`);
      return Promise.resolve(REFUSED);
    }
    let url;
    try {
      url = new URL(unescapeHtml(src));
    } catch {
      return Promise.resolve(BLANK_IMAGE);
    }
    if (url.protocol !== 'https:') return Promise.resolve(BLANK_IMAGE);
    if (!remote.has(url.href)) {
      if (remote.size >= LIMITS.maxImages) return Promise.resolve(BLANK_IMAGE);
      remote.set(
        url.href,
        fetchImage(url).catch(err => {
          console.warn(`[render] image from ${url.host} left blank: ${err.message}`);
          return BLANK_IMAGE;
        }),
      );
    }
    return remote.get(url.href);
  };

  const rewriteCss = async value => {
    const found = [];
    value.replace(CSS_URL, (_, dq, sq, bare) => {
      found.push(replacement(dq ?? sq ?? bare));
      return '';
    });
    const swaps = await Promise.all(found);
    if (swaps.includes(REFUSED)) return null;
    let i = 0;
    const out = value.replace(CSS_URL, match => {
      const swap = swaps[i++];
      return swap === null ? match : `url(${swap})`;
    });
    // A url( this pattern could not read: drop the whole value.
    if (/url\(/i.test(out.replace(CSS_URL, ''))) return null;
    // The pattern honors quotes and Satori does not, so a quoted data: URL
    // can hold text that Satori reads as a layer of its own, such as
    // url('data:x), url(http://...), url(data:y'). Drop the whole value
    // unless every layer Satori would load is a checked data: URL.
    return layersAreData(out) ? out : null;
  };

  const visit = (node, inSvg) => {
    const props = node.props;
    if (!props || typeof props !== 'object') return;
    const type = typeof node.type === 'string' ? node.type.toLowerCase() : '';
    sealCurrentColor(props);
    if (type === 'img' && typeof props.src === 'string') {
      work.push(
        replacement(props.src).then(found => {
          if (found === null) return;
          const swap = found === REFUSED ? BLANK_IMAGE : found;
          props.src = swap;
          const sized = props.width != null || props.height != null || props.style?.width != null || props.style?.height != null;
          if (swap === BLANK_IMAGE && !sized) {
            // No size of its own: the blank takes no room.
            props.width = 0;
            props.height = 0;
          }
        }),
      );
    }
    if (type === 'image') {
      for (const key of ['href', 'xlink:href', 'xlinkHref']) {
        if (typeof props[key] !== 'string') continue;
        work.push(
          replacement(props[key]).then(swap => {
            if (swap !== null) props[key] = swap === REFUSED ? BLANK_IMAGE : swap;
          }),
        );
      }
    }
    if (props.style && typeof props.style === 'object') {
      for (const [key, value] of Object.entries(props.style)) {
        if (typeof value !== 'string' || !/url\(/i.test(value)) continue;
        // Inside an svg, url(#id) points at a gradient, pattern or filter
        // in the same svg; nothing is fetched, and render-core's svg
        // sealing already allows only # and data: there.
        if (inSvg && fragmentUrlsOnly(value)) continue;
        work.push(
          rewriteCss(value).then(out => {
            if (out === null) delete props.style[key];
            else props.style[key] = out;
          }),
        );
      }
    }
  };

  const walk = (node, inSvg = false) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, inSvg);
      return;
    }
    const svg = inSvg || (typeof node.type === 'string' && node.type.toLowerCase() === 'svg');
    visit(node, svg);
    walk(node.props?.children, svg);
  };

  walk(root);
  await Promise.all(work);
  return root;
}
