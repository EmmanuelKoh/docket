"""
render.py — make printer bytes on your Mac, no printer attached.

Two ways in:
  - a PNG image  (design it in the Receipt Studio, export, drop it here)
  - plain text   (quick notes, no image needed)

Both come out as raw ESC/POS bytes: exactly what the ESP32 sends down the
serial wire. The 'Dummy' printer builds those bytes in memory and talks to
no hardware, so this works anywhere.
"""

from escpos.printer import Dummy
from PIL import Image

PRINT_WIDTH = 576  # 80mm printer. Use 384 for a 58mm one.


def from_image(png_path: str, cut: bool = True) -> bytes:
    """PNG -> ESC/POS bytes. Scales to the print width and prints as a picture."""
    img = Image.open(png_path)
    if img.width != PRINT_WIDTH:
        h = round(img.height * PRINT_WIDTH / img.width)
        img = img.resize((PRINT_WIDTH, h))
    d = Dummy()
    d.image(img)            # python-escpos handles the black/white conversion
    d.print_and_feed(2)
    if cut:
        d.cut()
    return d.output


def from_text(text: str, cut: bool = True) -> bytes:
    """Plain text -> ESC/POS bytes. Fast and tiny; good for simple notes."""
    d = Dummy()
    for line in text.splitlines():
        d.text(line + "\n")
    d.print_and_feed(2)
    if cut:
        d.cut()
    return d.output


if __name__ == "__main__":
    # quick self-check: make a sample and report the byte size
    sample = from_text("hello from render.py\n\nthis is what prints")
    print(f"text sample: {len(sample)} bytes, starts with {sample[:3]!r}")
