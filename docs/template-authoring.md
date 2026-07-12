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

## Liquid, briefly

Variables `{{ title }}`, conditionals `{% if over %}...{% endif %}`,
loops `{% for row in rows %}...{% endfor %}`. Filters like
`{{ name | upcase }}` work. Whatever the template references must exist
in `data` or render as empty.

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
| everything in one column, no side-by-side | missing `flex-direction:row` or grid/float that got ignored |
| wrong font, ignored bold | font family other than Sans/Mono, or a numeric weight other than 400/700 |
| bottom of receipt missing | content taller than 1600px |
| gray text looks moth-eaten | small type over gray; make text black and bigger |
