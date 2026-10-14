# Writing docket templates

A constraint sheet for anyone (human or LLM) asked to design a receipt
template. Hand this file plus one starter template to a model and it
should produce working output on the first try. The renderer is not a
browser, and templates written for a browser fail in specific ways
listed here.

## What a template is

A template is three fields, stored per owner and edited in the Studio:

- `name`: unique per owner
- `template`: Liquid + HTML source (everything below is about this)
- `data`: sample JSON. The Studio preview renders with it, and it doubles
  as documentation of what shape the template expects. At print time the
  caller supplies real data of the same shape.

The pipeline: Liquid fills `data` into the HTML, Satori lays it out at
576 pixels wide, resvg rasterizes it, the result is dithered to 1-bit
and sent to the printer as ESC/POS bytes. The Studio preview runs the
same pipeline, so what you see is what prints.

## Hard rules (Satori's CSS dialect)

Satori is a layout engine, not a browser. It supports a subset of CSS
and it throws on some things browsers tolerate.

1. Every `<div>` needs an explicit `display:flex` in its style. A div
   with more than one child and no display property is a render error
   (verified: "Expected <div> to have explicit display: flex"), and the
   starters set it on single-child divs too, so just set it everywhere.
2. Flexbox only. No CSS grid, no floats, no tables. Build columns with
   `flex-direction:column` and rows with `flex-direction:row`.
3. Inline styles only (`style="..."`). No `<style>` blocks, no classes.
4. Root element: `display:flex;flex-direction:column;width:576px;
   background:#fff;color:#000` plus padding (24px is the house margin).
5. Fonts: `font-family:Sans` or `font-family:Mono` and nothing else
   (DejaVu, bundled). Weights 400 and 700 only; bold is
   `font-weight:700`. Asking for any other family silently falls back.
6. Height: content taller than 1600px is cut off. That is roughly 20cm
   of paper; receipts should not get near it.

## It prints on thermal paper

- One color. `#000` on `#fff` prints crisp. Anything between (grays,
  photos, gradients) is dithered into dot patterns like newsprint. This
  looks good for images and bad for small gray text: keep text pure
  black, use size and weight for hierarchy, not gray.
- Inverted blocks (white text on `background:#000`) work and read well
  as badges and headers. See the OVER badge in the Budget starter.
- Images work as `<img>` with a `data:` URI (base64). Keep them modest;
  a full-width photo is the Photo tool's job, not a template's.
- An `https://` image also works if its host is public, it answers within
  5 seconds, and it is a PNG, JPEG, GIF or SVG of at most 5 MB. Any other
  source (`http://`, a relative path, a private address) prints as a
  blank. Give the `<img>` a width and height so a blank keeps its space.
- An SVG image, `data:` or `https://`, prints as a blank if it points
  outside itself: an `href` that is not `#name` or a `data:` URL, a
  `url()` that does not start with `#` or `data:`, an `@import`, or an
  entity declaration. A gzip-compressed SVG is refused too. An SVG that
  uses only its own `#name` links and embedded `data:` images prints.
- `color` takes a plain color: `#000`, `rgb()`, `rgba()`, `hsl()`,
  `hsla()`, a CSS color name, `transparent` or `currentColor`. Any other
  value is dropped and the element keeps its parent's color.
- A `background` or `mask` value that names `currentColor` is dropped.
  Use the color itself.
- A `tw` value with an arbitrary value in brackets, `current` or `url(`
  is dropped whole.
- Inside an `<svg>`, an `href` must point inside the svg (`#name`) or be
  a `data:` URL that passes the SVG image rule above. Any other `href`
  is dropped (an `<image>` gets a blank). An attribute or style value
  with a `url()` that does not start with `#` or `data:` is dropped.

## Liquid, briefly

Variables `{{ title }}`, conditionals `{% if over %}...{% endif %}`,
loops `{% for row in rows %}...{% endfor %}`. Filters like
`{{ name | upcase }}` work. Whatever the template references must exist
in `data` or render as empty.

A template is one self-contained source, because templates cannot load
other files. `{% render %}`, `{% include %}` and `{% layout %}` fail
whenever they name a file. `{% layout none %}` names no file, so it
still works.

Each template gets bounded work. Its source can be at most 100,000
characters. Filling it in stops after about 1 second. It can also build
at most 10,000,000 items. That count includes loop ranges, captures,
and the strings and arrays that filters make. A filter that reads a
property on each item (`map`, `sort`, `where`, `sum`, `group_by`,
`find` and the `_exp` filters) also counts the length of that property
once per item. The filled-in HTML can be at most 5,000,000 characters.

In text, these entities print as the character they stand for:

- `&amp;` `&lt;` `&gt;` `&quot;` `&apos;`, with the name in any letter
  case.
- `&#34;` `&#38;` `&#39;` `&#60;` `&#62;`.
- `&#x22;` `&#x26;` `&#x27;` `&#x3c;` `&#x3e;`, with the `x` and the hex
  digits in any letter case.

They stand for `"`, `&`, `'`, `<` and `>`. Every other entity prints as
typed. The Task template's data arrives escaped this way, so a text
message can never add markup.

Do not apply `url_decode` or `base64_decode` to plugin data. Escaping
leaves `%3C` and base64 text alone, so these filters turn escaped
outside text back into markup.

Attribute values are left as typed, with two exceptions:

- An image source (`<img src>`, `<image href>` in an svg, or a CSS
  `url()`), `https://` or `data:`, has these entities decoded before the
  image is fetched or checked.
- Inside an `<svg>`, they are decoded in attribute values and in the
  style values of the elements it holds. The `<svg>` element's own style
  is left as typed.

## A working example (from the Budget starter)

    <div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;font-size:34px;font-weight:700">{{ title }}</div>
        {% if over %}<div style="display:flex;background:#000;color:#fff;font-size:16px;font-weight:700;padding:3px 10px;border-radius:12px">OVER</div>{% endif %}
      </div>
      {% for row in rows %}
      <div style="display:flex;align-items:center;margin-top:6px">
        <div style="display:flex;width:120px;font-size:18px">{{ row.label }}</div>
        <div style="display:flex;flex:1;height:22px;background:#ddd">
          <div style="display:flex;width:{{ row.pct }}%;background:#000;height:22px"></div>
        </div>
      </div>
      {% endfor %}
    </div>

Note every single div carries `display:flex`, the bar chart is nested
flex divs with a percent width, and the gray `#ddd` track dithers into
a visible texture on paper, which is intentional there.

## Sizing that reads well on paper

The paper is 80mm wide (576 dots). Rough type scale from the starters:
34px bold for the title, 18 to 20px for body, 14 to 16px for captions.
Below about 14px, dithered edges start eating the letterforms.

## Testing

Open the Studio, paste the template, edit `data`, and watch the live
preview; it is the real renderer. "Print test" on a slip's page sends it
through the actual printer, which is the only honest judge of grays and
small type. The maintainer iterates by eye on paper; expect one or two
rounds of size adjustments after the first physical print.

## Failure signatures

| Symptom | Cause |
|---|---|
| render error mentioning display | a div is missing `display:flex` |
| `Failed to lookup` or `illegal file path` error | `render`, `include` or `layout` names a file (an empty, unset or missing name gives `illegal file path`) |
| `template is longer than 100,000 characters` | the source is too long; move a big inline image into `data` |
| `template took longer than 1,000 ms to fill` | a loop runs too many times |
| `template built more than 10,000,000 items` | a loop range, a capture or a filter's result is too big, or a filter reads a long property on many items |
| `template filled in to more than 5,000,000 characters` | the output is too long, often a loop that prints a big block many times |
| everything in one column, no side-by-side | missing `flex-direction:row` or grid/float that got ignored |
| wrong font, ignored bold | font family other than Sans/Mono, or a numeric weight other than 400/700 |
| bottom of receipt missing | content taller than 1600px |
| an SVG image prints blank | it points outside itself (an `href`, `url()`, `@import` or entity that is not `#name` or `data:`), or it is gzip |
| gray text looks moth-eaten | small type over gray; make text black and bigger |
