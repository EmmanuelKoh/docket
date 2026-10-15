// render/escape-html.js — make outside text safe to place in a template,
// and turn it back into characters where it prints.
//
// Templates put data into HTML, so a value that came from outside the
// account (a forwarded text, a calendar event, a sports feed) is escaped
// before the template sees it: "<img src=...>" then prints as those
// characters instead of becoming an element. Plugins escape in code, not
// in the template, so the templates every account already stores stay
// safe. render-core.js decodes the same entities in text after parsing,
// so "Milk & eggs" prints as typed.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

// The same object with every string value escaped (one level deep).
export const escapeStrings = data =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? escapeHtml(v) : v]),
  );

// The escaped forms of & < > " ' (named, decimal and hex, as escapeHtml
// and Liquid's escape filter write them) back to the characters. Other
// entities stay as typed.
const ESCAPED = /&(amp|lt|gt|quot|apos|#3[489]|#6[02]|#x2[267]|#x3[ce]);/gi;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescapeHtml = s =>
  s.replace(ESCAPED, (_, e) => {
    const k = e.toLowerCase();
    if (NAMED[k]) return NAMED[k];
    return String.fromCharCode(k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
  });
