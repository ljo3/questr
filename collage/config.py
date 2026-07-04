"""Central configuration for the Questr collage pipeline.

Everything that differs between environments is read from the environment so
the same code runs locally (heuristic fallback) and in GitHub Actions (with
Claude + real S3 credentials).
"""
import os

# ── S3 ────────────────────────────────────────────────────────────────────
AWS_ACCOUNT = "333886071196"
# `... or default` (not get(k, default)): CI passes unset workflow vars as an
# empty string, which get() would happily return — the `or` falls through to
# the default when the env var is present but blank.
AWS_REGION = os.environ.get("AWS_REGION") or "eu-west-3"
BUCKET = os.environ.get("PHOTO_BUCKET") or "photo-bucket-333886071196-eu-west-3-an"

# The single object we write per day. Photos live at <date>/<uuid>.jpg,
# the finished collage at <date>/collage.jpg — so it is trivial for the
# web app to fetch and never collides with an uploaded source photo.
COLLAGE_NAME = "collage.jpg"

# Public URL a browser uses to display a finished collage (bucket must allow
# public read on the collage.jpg objects — see README).
def collage_url(date: str) -> str:
    return f"https://{BUCKET}.s3.{AWS_REGION}.amazonaws.com/{date}/{COLLAGE_NAME}"


# ── Vision (via OpenRouter) ────────────────────────────────────────────────
# Vision reads the photos' theme and judges candidate layouts. We go through
# OpenRouter's OpenAI-compatible endpoint so the model is a swappable slug.
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

# OpenRouter model slug. Override with COLLAGE_MODEL to pin a cheaper/faster
# (or different-vendor) vision model — anything OpenRouter serves works.
MODEL = os.environ.get("COLLAGE_MODEL") or "anthropic/claude-opus-4.8"

# When no key is present we fall back to a fully deterministic heuristic
# pipeline so the whole thing still runs (and is testable) offline.
HAS_CLAUDE = bool(OPENROUTER_API_KEY)

# ── Canvas ────────────────────────────────────────────────────────────────
CANVAS_W = 1600
CANVAS_H = 2000          # portrait — reads well as a "journal page"
THUMB_MAX = 640          # long edge used when sending renders to Claude to judge

# ── Optimizer/evaluator loop ──────────────────────────────────────────────
ROUND1_TEMPLATES = ["grid", "hero", "filmstrip", "columns", "polaroid"]
ROUND2_VARIANTS = 3      # mutations of the round-1 winner
