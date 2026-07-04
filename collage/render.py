"""Rasterise a layout spec into a finished collage image with Pillow.

Design goals beyond "place the photos": editorial typography (bundled serif
title + sans caption, so it looks identical on any machine), soft drop shadows
for depth, and a gradient background derived from the theme — so even the plain
grid reads as designed rather than utilitarian.
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from . import config

# Bundle fonts in the repo so rendering is deterministic regardless of what the
# host has installed (a bare server has no TrueType fonts → Pillow's tiny
# bitmap default, which is what made early collages look broken).
_ASSETS = os.path.join(os.path.dirname(__file__), "assets")
_SERIF_BOLD = os.path.join(_ASSETS, "LiberationSerif-Bold.ttf")
_SANS = os.path.join(_ASSETS, "LiberationSans-Regular.ttf")
_SANS_BOLD = os.path.join(_ASSETS, "LiberationSans-Bold.ttf")

_MEASURE = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def _font(size: int, path: str = _SANS):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def _fit_font(text: str, path: str, max_w: int, size: int):
    """Largest font ≤ size whose text fits in max_w (so long titles don't run
    off the edge)."""
    while size > 26:
        f = _font(size, path)
        if _MEASURE.textlength(text, font=f) <= max_w:
            return f
        size -= 4
    return _font(size, path)


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _scale(rgb, f):
    return tuple(max(0, min(255, int(v * f))) for v in rgb)


def _cover(img: Image.Image, w: int, h: int) -> Image.Image:
    """Resize + centre-crop so `img` fills a w×h box (CSS object-fit: cover)."""
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    src_ratio = img.width / img.height
    dst_ratio = w / h
    if src_ratio > dst_ratio:                      # source too wide → crop sides
        nh = h
        nw = int(round(h * src_ratio))
    else:                                          # source too tall → crop top/bottom
        nw = w
        nh = int(round(w / src_ratio))
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = (nh - h) // 2
    return resized.crop((left, top, left + w, top + h))


def _rounded(tile: Image.Image, radius: int) -> Image.Image:
    if radius <= 0:
        return tile.convert("RGBA")
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, tile.width - 1, tile.height - 1], radius=radius, fill=255)
    out = tile.convert("RGBA")
    out.putalpha(mask)
    return out


def _drop_shadow(canvas: Image.Image, w: int, h: int, radius: int,
                 rotate: float, cx: int, cy: int):
    """Soft shadow, centred on (cx, cy), nudged down-right for depth."""
    pad = 40
    sh = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [pad, pad, pad + w, pad + h], radius=max(radius, 2), fill=(0, 0, 0, 115))
    sh = sh.filter(ImageFilter.GaussianBlur(16))
    if rotate:
        sh = sh.rotate(rotate, expand=True, resample=Image.BICUBIC)
    px = cx - sh.width // 2 + 10
    py = cy - sh.height // 2 + 14
    canvas.paste(sh, (px, py), sh)


def _place(canvas: Image.Image, cell: dict, photos, radius: int):
    x, y, w, h = (int(round(v)) for v in cell["box"])
    border = cell.get("border", 0)
    rotate = cell.get("rotate", 0)
    cx, cy = x + w // 2, y + h // 2

    _drop_shadow(canvas, w, h, radius, rotate, cx, cy)

    tile = _cover(photos[cell["photo"]], w - 2 * border, h - 2 * border)
    if border:                                     # white polaroid frame
        framed = Image.new("RGB", (w, h), "#ffffff")
        framed.paste(tile, (border, border))
        tile = framed
    tile = _rounded(tile, radius)

    if rotate:
        tile = tile.rotate(rotate, expand=True, resample=Image.BICUBIC)
    canvas.paste(tile, (cx - tile.width // 2, cy - tile.height // 2), tile)


def _gradient(w: int, h: int, top, bottom) -> Image.Image:
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for yy in range(h):
        t = yy / max(1, h - 1)
        px[0, yy] = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
    return strip.resize((w, h))


def _draw_footer(canvas: Image.Image, spec: dict):
    from .layouts import FOOTER_H, MARGIN

    draw = ImageDraw.Draw(canvas)
    color = _hex(spec["text_color"])
    accent = _hex(spec.get("accent", spec["text_color"]))
    max_w = config.CANVAS_W - 2 * MARGIN
    x = MARGIN
    y = config.CANVAS_H - FOOTER_H + 34

    title = (spec.get("title") or "").strip()
    caption = (spec.get("caption") or "").strip()

    if title:
        draw.rounded_rectangle([x, y, x + 84, y + 9], radius=4, fill=accent)
        y += 30
        draw.text((x, y), title, font=_fit_font(title, _SERIF_BOLD, max_w, 104),
                  fill=color)
        y += 116
    if caption:
        on_dark = sum(color) < 384
        muted = _scale(color, 0.72) if not on_dark else tuple(
            int(c * 0.55 + 0.45 * 255) for c in color)
        draw.text((x, y), caption, font=_fit_font(caption, _SANS, max_w, 44),
                  fill=muted)


def render(spec: dict, photos) -> Image.Image:
    bg = _hex(spec["bg"])
    canvas = _gradient(config.CANVAS_W, config.CANVAS_H, _scale(bg, 1.12), _scale(bg, 0.78))
    for cell in spec["cells"]:
        _place(canvas, cell, photos, spec.get("radius", 0))
    _draw_footer(canvas, spec)
    return canvas


def thumbnail(img: Image.Image, max_edge: int = config.THUMB_MAX) -> Image.Image:
    t = img.copy()
    t.thumbnail((max_edge, max_edge))
    return t
