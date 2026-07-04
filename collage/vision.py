"""Thin wrapper around the vision model (served via OpenRouter's OpenAI-
compatible API) used by theme detection and the layout judge. Encodes PIL
images, sends them with a prompt, and returns parsed JSON. Never raises to
the caller — on any failure it returns None so callers fall back to the
deterministic heuristic path."""
import base64
import io
import json
import re

from PIL import Image

from . import config

_client = None


def _openrouter():
    global _client
    if _client is None:
        from openai import OpenAI                  # OpenRouter speaks the OpenAI API

        _client = OpenAI(
            api_key=config.OPENROUTER_API_KEY,
            base_url=config.OPENROUTER_BASE_URL,
        )
    return _client


def _encode(img: Image.Image, max_edge: int = 768) -> dict:
    """PIL image → OpenAI-style image content block (base64 JPEG data URI)."""
    im = img.copy()
    im.thumbnail((max_edge, max_edge))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, format="JPEG", quality=82)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
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
    """Send images + prompt to the vision model, return parsed JSON or None.

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
        resp = _openrouter().chat.completions.create(
            model=config.MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": content}],
            extra_headers={                        # OpenRouter attribution (optional)
                "HTTP-Referer": "https://questr.pages.dev",
                "X-Title": "Questr",
            },
        )
        return _parse_json(resp.choices[0].message.content)
    except Exception as e:                       # network, quota, parse, ...
        print(f"[vision] model call failed, using heuristic fallback: {e}")
        return None
