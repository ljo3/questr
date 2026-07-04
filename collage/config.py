"""Central configuration for the Questr collage pipeline.

Everything that differs between environments is read from the environment so
the same code runs locally (heuristic fallback) and in GitHub Actions (with
Claude + real S3 credentials).
"""
import datetime as dt
import os
import re

# ── S3 ────────────────────────────────────────────────────────────────────
AWS_ACCOUNT = "333886071196"
# `... or default` (not get(k, default)): CI passes unset workflow vars as an
# empty string, which get() would happily return — the `or` falls through to
# the default when the env var is present but blank.
AWS_REGION = os.environ.get("AWS_REGION") or "eu-west-3"
BUCKET = os.environ.get("PHOTO_BUCKET") or "photo-bucket-333886071196-eu-west-3-an"

# Photos live at <date>/<uuid>.jpg. Finished collages are all prefixed with
# COLLAGE_PREFIX so they never collide with an uploaded source photo, and so
# list_photo_keys can exclude them by prefix.
COLLAGE_PREFIX = "collage"

# The stable local file we commit to the repo (git keeps the history).
COLLAGE_NAME = f"{COLLAGE_PREFIX}.jpg"


def slugify(text: str, max_len: int = 40) -> str:
    """Filesystem/URL-safe slug of a title, e.g. 'A Day Out!' -> 'a-day-out'."""
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:max_len].strip("-") or COLLAGE_PREFIX


def collage_object_name(title: str | None = None, when: dt.datetime | None = None) -> str:
    """A unique, human-readable S3 key suffix for one build so successive
    builds never overwrite each other: `<title-slug>-<HHMMSS>/collage.jpg`.
    The basename stays `collage.jpg` because the bucket policy grants public
    read on `*/collage.jpg` — a different basename would upload fine but 403
    on view. The title+time live in the folder segment instead."""
    when = when or dt.datetime.now(dt.timezone.utc)
    stamp = when.strftime("%H%M%S")
    slug = slugify(title) if title else ""
    folder = f"{slug}-{stamp}" if slug and slug != COLLAGE_PREFIX else stamp
    return f"{folder}/{COLLAGE_NAME}"


# Public URL a browser uses to display a finished collage (bucket must allow
# public read on the collage objects — see README).
def collage_url(date: str, name: str = COLLAGE_NAME) -> str:
    return f"https://{BUCKET}.s3.{AWS_REGION}.amazonaws.com/{date}/{name}"


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
