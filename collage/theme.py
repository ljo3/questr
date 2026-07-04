"""Read the *theme* of a set of photos: a title, mood, colour palette and a
caption. Claude vision when available; a colour-quantisation heuristic when
not. The theme drives both layout selection and styling (background colour,
text)."""
from PIL import Image

from . import vision

THEME_PROMPT = (
    "These are photos a traveller took in one day. Look at them together and "
    "respond with ONLY a JSON object describing the collage we should make:\n"
    '{\n'
    '  "title": "<2-4 word evocative title for the day>",\n'
    '  "mood": "<one of: vibrant, serene, nostalgic, adventurous, cozy, elegant>",\n'
    '  "palette": ["#rrggbb", "#rrggbb", "#rrggbb"],  // background + accents that suit the photos\n'
    '  "layout_hint": "<one of: grid, mosaic, hero, polaroid, filmstrip>",\n'
    '  "caption": "<a short, warm one-line caption for the collage>"\n'
    '}\n'
    "Pick a palette that harmonises with the photos (a dark, moody set wants "
    "deep backgrounds; a bright beach set wants light ones)."
)

MOOD_BG = {
    "vibrant": "#1a1220", "serene": "#eef2f4", "nostalgic": "#f4ede2",
    "adventurous": "#14212b", "cozy": "#2a1e18", "elegant": "#111114",
}


def _dominant_palette(images: list[Image.Image], n: int = 4) -> list[str]:
    """Most common colours across all photos via quantisation."""
    swatch = Image.new("RGB", (len(images) * 64, 64))
    for i, img in enumerate(images):
        swatch.paste(img.resize((64, 64)), (i * 64, 0))
    q = swatch.quantize(colors=n, method=Image.Quantize.FASTOCTREE)
    pal = q.getpalette()[: n * 3]
    counts = sorted(q.getcolors(), reverse=True)  # (count, index)
    hexes = []
    for _, idx in counts:
        r, g, b = pal[idx * 3: idx * 3 + 3]
        hexes.append(f"#{r:02x}{g:02x}{b:02x}")
    return hexes


def _luma(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def detect_theme(images: list[Image.Image]) -> dict:
    result = vision.ask(images, THEME_PROMPT)
    if result and isinstance(result, dict) and result.get("palette"):
        result.setdefault("title", "A Day Out")
        result.setdefault("mood", "vibrant")
        result.setdefault("layout_hint", "mosaic")
        result.setdefault("caption", "")
        result["source"] = "claude"
        return result

    # ── Heuristic fallback ──
    palette = _dominant_palette(images)
    avg = sum(_luma(c) for c in palette) / len(palette)
    mood = "serene" if avg > 140 else "elegant"
    return {
        "title": "A Day Out",
        "mood": mood,
        "palette": palette,
        "layout_hint": "mosaic",
        "caption": "",
        "source": "heuristic",
    }
