"""Rasterise a layout spec into a finished collage image with Pillow."""
import os

from PIL import Image, ImageDraw, ImageFont

from . import config

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def _font(size: int, bold: bool = False):
    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            if bold and "Bold" not in path and not path.endswith(".ttc"):
                continue
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


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
        return tile
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, tile.width - 1, tile.height - 1], radius=radius, fill=255)
    out = tile.convert("RGBA")
    out.putalpha(mask)
    return out


def _place(canvas: Image.Image, cell: dict, photos, radius: int):
    x, y, w, h = (int(round(v)) for v in cell["box"])
    border = cell.get("border", 0)
    rotate = cell.get("rotate", 0)
    tile = _cover(photos[cell["photo"]], w - 2 * border, h - 2 * border)

    if border:                                     # white polaroid frame
        framed = Image.new("RGB", (w, h), "#ffffff")
        framed.paste(tile, (border, border))
        tile = framed
    tile = _rounded(tile, radius)

    if rotate:
        tile = tile.convert("RGBA").rotate(
            rotate, expand=True, resample=Image.BICUBIC)
        # keep the rotated tile centred on the original cell centre
        cx, cy = x + w // 2, y + h // 2
        canvas.paste(tile, (cx - tile.width // 2, cy - tile.height // 2),
                     tile if tile.mode == "RGBA" else None)
    else:
        canvas.paste(tile, (x, y), tile if tile.mode == "RGBA" else None)


def _draw_footer(canvas: Image.Image, spec: dict):
    from .layouts import FOOTER_H, MARGIN

    draw = ImageDraw.Draw(canvas)
    color = _hex(spec["text_color"])
    fy = config.CANVAS_H - FOOTER_H + 24
    title = (spec.get("title") or "").strip()
    caption = (spec.get("caption") or "").strip()
    if title:
        draw.text((MARGIN, fy), title, font=_font(76, bold=True), fill=color)
        fy += 96
    if caption:
        muted = tuple(int(c * 0.7 + 0.3 * (255 if sum(color) < 384 else 0))
                      for c in color)
        draw.text((MARGIN, fy), caption, font=_font(38), fill=muted)


def render(spec: dict, photos) -> Image.Image:
    canvas = Image.new("RGB", (config.CANVAS_W, config.CANVAS_H), _hex(spec["bg"]))
    for cell in spec["cells"]:
        _place(canvas, cell, photos, spec.get("radius", 0))
    _draw_footer(canvas, spec)
    return canvas


def thumbnail(img: Image.Image, max_edge: int = config.THUMB_MAX) -> Image.Image:
    t = img.copy()
    t.thumbnail((max_edge, max_edge))
    return t
