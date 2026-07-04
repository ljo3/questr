"""Thin wrapper around Claude vision used by theme detection and the layout
judge. Encodes PIL images, sends them with a prompt, and returns parsed JSON.
Never raises to the caller — on any failure it returns None so callers fall
back to the deterministic heuristic path."""
import base64
import io
import json
import re

from PIL import Image

from . import config

_client = None


def _anthropic():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def _encode(img: Image.Image, max_edge: int = 768) -> dict:
    """PIL image → Claude image content block (base64 JPEG, downscaled)."""
    im = img.copy()
    im.thumbnail((max_edge, max_edge))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, format="JPEG", quality=82)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
    }


def _parse_json(text: str):
    """Extract the first JSON object/array from a model response."""
    m = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def ask(images: list[Image.Image], prompt: str, max_tokens: int = 700,
        max_edge: int = 768, labels: list[str] | None = None):
    """Send images + prompt to Claude, return parsed JSON or None.

    `labels` (optional) tags each image with a caption block so the model can
    refer to them (e.g. "Photo 1", "Candidate A")."""
    if not config.HAS_CLAUDE:
        return None
    content = []
    for i, img in enumerate(images):
        if labels:
            content.append({"type": "text", "text": labels[i]})
        content.append(_encode(img, max_edge))
    content.append({"type": "text", "text": prompt})
    try:
        msg = _anthropic().messages.create(
            model=config.MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": content}],
        )
        return _parse_json(msg.content[0].text)
    except Exception as e:                       # network, quota, parse, ...
        print(f"[vision] Claude call failed, using heuristic fallback: {e}")
        return None
