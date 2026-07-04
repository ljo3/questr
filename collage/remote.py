"""Fetch images from a URL (or local path) into PIL images.

Used by the template-driven build: the template reference and, optionally, the
source photos are given as URLs in a markdown file. Stdlib only — no new deps.
"""
import io
import os
import urllib.request

from PIL import Image, ImageOps

_UA = "Mozilla/5.0 (compatible; QuestrCollageBot/1.0; +https://questr.pages.dev)"


def fetch_image(url_or_path: str, timeout: int = 20) -> Image.Image:
    """Return an EXIF-oriented RGB image from an http(s) URL or a local path."""
    src = (url_or_path or "").strip()
    if not src:
        raise ValueError("empty image source")

    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            data = resp.read()
        img = Image.open(io.BytesIO(data))
    else:
        if not os.path.exists(src):
            raise FileNotFoundError(src)
        img = Image.open(src)

    img = ImageOps.exif_transpose(img)             # respect phone orientation
    return img.convert("RGB")


def fetch_images(sources: list[str]) -> list[Image.Image]:
    """Fetch many sources, skipping any that fail (with a printed note)."""
    out = []
    for s in sources:
        try:
            out.append(fetch_image(s))
        except Exception as e:                      # network, decode, 404, ...
            print(f"[remote] skipping {s!r}: {e}")
    return out
