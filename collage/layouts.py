"""Candidate collage layouts. Every generator returns a *spec* — a resolution
independent description of where each photo goes — which render.py rasterises.
All templates are algorithmic so they place any photo count (3-6) without
fragile per-count tables.

Spec shape:
    {
      "name": str,
      "bg": "#rrggbb",
      "text_color": "#rrggbb",
      "gap": int, "radius": int,
      "cells": [{"box": (x, y, w, h), "photo": idx,
                 "rotate": deg?, "border": px?}],
      "title": str, "caption": str,
    }
"""
import math

from . import config
from .theme import MOOD_BG, _luma

MARGIN = 44
FOOTER_H = 250          # title + caption band at the bottom
GAP = 18
RADIUS = 14


def _content_rect():
    x = MARGIN
    y = MARGIN
    w = config.CANVAS_W - 2 * MARGIN
    h = config.CANVAS_H - MARGIN - FOOTER_H
    return x, y, w, h


def _bg_text(theme: dict) -> tuple[str, str]:
    bg = MOOD_BG.get(theme.get("mood"), theme["palette"][0])
    text = "#f5f3ef" if _luma(bg) < 130 else "#1a1a1a"
    return bg, text


def _aspect(img) -> float:
    return img.width / img.height


def _base(theme: dict, name: str, cells: list) -> dict:
    bg, text = _bg_text(theme)
    return {
        "name": name,
        "bg": bg,
        "text_color": text,
        "gap": GAP,
        "radius": RADIUS,
        "cells": cells,
        "title": theme.get("title", ""),
        "caption": theme.get("caption", ""),
    }


# ── Templates ──────────────────────────────────────────────────────────────

def grid(photos, theme, order=None):
    order = order or list(range(len(photos)))
    n = len(order)
    x0, y0, W, H = _content_rect()
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    cw = (W - GAP * (cols - 1)) / cols
    ch = (H - GAP * (rows - 1)) / rows
    cells = []
    for i, idx in enumerate(order):
        r, c = divmod(i, cols)
        in_row = min(cols, n - r * cols)          # items in this (possibly last) row
        row_w = in_row * cw + (in_row - 1) * GAP
        offx = x0 + (W - row_w) / 2               # centre a short last row
        x = offx + c * (cw + GAP)
        y = y0 + r * (ch + GAP)
        cells.append({"box": (x, y, cw, ch), "photo": idx})
    return _base(theme, "grid", cells)


def hero(photos, theme, order=None):
    order = order or sorted(range(len(photos)), key=lambda i: -_aspect(photos[i]))
    n = len(order)
    x0, y0, W, H = _content_rect()
    hero_h = H * 0.56
    cells = [{"box": (x0, y0, W, hero_h), "photo": order[0]}]
    rest = order[1:]
    m = len(rest)
    if m:
        cw = (W - GAP * (m - 1)) / m
        ry = y0 + hero_h + GAP
        rh = H - hero_h - GAP
        for c, idx in enumerate(rest):
            cells.append({"box": (x0 + c * (cw + GAP), ry, cw, rh), "photo": idx})
    return _base(theme, "hero", cells)


def filmstrip(photos, theme, order=None):
    order = order or list(range(len(photos)))
    n = len(order)
    x0, y0, W, H = _content_rect()
    ch = (H - GAP * (n - 1)) / n
    cells = [{"box": (x0, y0 + i * (ch + GAP), W, ch), "photo": idx}
             for i, idx in enumerate(order)]
    return _base(theme, "filmstrip", cells)


def columns(photos, theme, order=None):
    order = order or list(range(len(photos)))
    n = len(order)
    x0, y0, W, H = _content_rect()
    cw = (W - GAP * (n - 1)) / n
    cells = [{"box": (x0 + i * (cw + GAP), y0, cw, H), "photo": idx}
             for i, idx in enumerate(order)]
    return _base(theme, "columns", cells)


def polaroid(photos, theme, order=None, seed=0):
    """Loose grid of white-bordered, slightly rotated photos."""
    import random

    rnd = random.Random(seed)
    order = order or list(range(len(photos)))
    n = len(order)
    x0, y0, W, H = _content_rect()
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    cw = W / cols
    # Square photo box that fits both a column and a row; capped so a single
    # row can't blow up. Rows are then packed to the photo height (not H/rows)
    # and the whole block is centred vertically — no tall empty slots.
    size = min(cw, H / rows) * 0.82
    slot_h = size * 1.16                            # photo + a little breathing room
    block_h = rows * slot_h
    top = y0 + max(0, (H - block_h) / 2)            # centre the block in the content area
    jitter = size * 0.05
    cells = []
    for i, idx in enumerate(order):
        r, c = divmod(i, cols)
        in_row = min(cols, n - r * cols)           # centre a short last row too
        row_w = in_row * cw
        offx = x0 + (W - row_w) / 2
        cx = offx + c * cw + cw / 2 + rnd.uniform(-jitter, jitter)
        cy = top + r * slot_h + slot_h / 2 + rnd.uniform(-jitter, jitter)
        cells.append({
            "box": (cx - size / 2, cy - size / 2, size, size),
            "photo": idx,
            "rotate": rnd.uniform(-7, 7),
            "border": 16,
        })
    spec = _base(theme, "polaroid", cells)
    spec["radius"] = 4
    return spec


TEMPLATES = {
    "grid": grid, "hero": hero, "filmstrip": filmstrip,
    "columns": columns, "polaroid": polaroid,
}


def generate_candidates(photos, theme) -> list[dict]:
    """Round-1 pool: one spec per template, with the theme's hinted layout first."""
    names = list(config.ROUND1_TEMPLATES)
    hint = theme.get("layout_hint")
    if hint in TEMPLATES and hint in names:
        names.remove(hint)
        names.insert(0, hint)
    return [TEMPLATES[name](photos, theme) for name in names if name in TEMPLATES]
