"""
html_to_png.py — turn ticket HTML into a print-width PNG using a real browser.

Why: the design studio previews your HTML, but the *printer* needs a picture.
This renders the same HTML/CSS in a real (headless) browser and screenshots it
at the printer's exact width, so what prints comes from the real CSS — not an
approximation. The PNG it produces feeds straight into render.py.

One-time setup (downloads the browser):
    pip install playwright
    playwright install chromium

Use:
    from html_to_png import html_to_png
    html_to_png("<div class='receipt'>...</div>", "ticket.png")
"""

from playwright.sync_api import sync_playwright

PRINT_WIDTH = 576  # 80mm. Use 384 for 58mm.

# Wraps your snippet so it renders on white at exactly the print width.
# Your own <style> or classes inside the snippet still apply on top of this.
PAGE = """<!doctype html><meta charset="utf-8">
<style>
  html,body{{margin:0;background:#fff}}
  body{{width:{w}px}}
  .receipt{{font-family:ui-monospace,Menlo,Consolas,monospace;
           font-size:22px;line-height:1.35;padding:26px 22px;color:#000}}
  .receipt h1{{font-size:30px;margin:.1em 0 .35em;text-transform:uppercase}}
  .receipt .rule{{border-top:2px dashed #000;margin:.6em 0}}
  .receipt .row{{display:flex;justify-content:space-between;gap:10px}}
  .receipt .big{{font-size:40px;font-weight:700;line-height:1.05}}
  .receipt .center{{text-align:center}}
  .receipt small{{font-size:17px}}
</style>
<div id="ticket">{body}</div>"""


def html_to_png(html: str, out_path: str = "ticket.png", width: int = PRINT_WIDTH):
    page_html = PAGE.format(w=width, body=html)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": 100})
        page.set_content(page_html, wait_until="networkidle")
        # screenshot just the ticket element, so height fits the content
        page.locator("#ticket").screenshot(path=out_path)
        browser.close()
    return out_path


if __name__ == "__main__":
    sample = """<div class="receipt">
      <h1>Tuesday</h1><small>June 17</small>
      <div class="rule"></div>
      <div class="row"><span>Focus</span><span>Ship the parser</span></div>
      <div>[ ] order thermal paper</div>
    </div>"""
    path = html_to_png(sample, "ticket.png")
    print("wrote", path)
