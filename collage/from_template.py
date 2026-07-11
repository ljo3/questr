"""Agentic, GitHub-driven collage build.

A markdown request file (see `collage-template.md`) carries a **template** image
URL plus optional **photos**. Editing that file and pushing triggers a GitHub
Action which runs this module:

    python -m collage.from_template --md collage-template.md

It downloads the template + photos, asks the vision model to emulate the
template's layout/mood/palette, runs the optimize/evaluate loop (the judge now
scores candidates by resemblance to the template), writes the finished image to
`collage/output/collage.jpg`, uploads it to S3 when credentials are present, and
rewrites the request file's Result section with a preview + build details.

Everything degrades gracefully: no vision key → heuristic fallback; no photos in
the file → the bundled `collage/sample`; no AWS creds → the committed image is
still the deliverable.
"""
import argparse
import datetime as dt
import os
import re
import sys

from . import config

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
_SAMPLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample")
_RESULT_START = "<!-- RESULT:START -->"
_RESULT_END = "<!-- RESULT:END -->"


# ── Minimal front-matter parser (no PyYAML dependency) ─────────────────────
def parse_front_matter(text: str) -> dict:
    """Parse a leading `--- ... ---` block. Supports `key: value` scalars and
    block lists (`key:` followed by `  - item` lines). Good enough for our
    fixed, simple schema."""
    m = re.match(r"^\s*---\s*\n(.*?)\n---\s*\n?", text, re.DOTALL)
    if not m:
        return {}
    data, current = {}, None
    for raw in m.group(1).splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and current is not None:
            data[current].append(_unquote(item.group(1)))
            continue
        kv = re.match(r"^(\w[\w-]*):\s*(.*)$", line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if val == "":
                data[key] = []                      # opens a block list
                current = key
            elif val.startswith("[") and val.endswith("]"):
                inner = val[1:-1].strip()            # inline flow list: [] or [a, b]
                data[key] = [_unquote(x) for x in inner.split(",") if x.strip()]
                # An empty `key: []` still accepts `- item` lines below it —
                # people naturally append URLs under the placeholder without
                # deleting the brackets, and those photos must not be dropped.
                current = key if not data[key] else None
            else:
                data[key] = _unquote(val)
                current = None
    return data


def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


# ── Result section rewriting ────────────────────────────────────────────────
def _render_result_block(rel_image: str, s3_url: str | None, theme: dict,
                         log: dict, n_photos: int) -> str:
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    winner = log.get("winner", {})
    link = s3_url or rel_image
    lines = [
        _RESULT_START,
        "## Result",
        "",
        f"![collage]({link})",
        "",
        f"- **Title:** {theme.get('title', '—')}",
        f"- **Mood:** {theme.get('mood', '—')}",
        f"- **Layout:** {winner.get('name', '—')} "
        f"(score {winner.get('score', '—')}, judge: {winner.get('judge', '—')})",
        f"- **Theme source:** {theme.get('source', '—')}",
        f"- **Photos:** {n_photos}",
        f"- **Committed image:** [`{rel_image}`]({rel_image})",
    ]
    if s3_url:
        lines.append(f"- **S3:** {s3_url}")
    lines += [f"- **Built:** {ts}", "", _RESULT_END]
    return "\n".join(lines)


def _write_result(md_path: str, text: str, block: str) -> str:
    if _RESULT_START in text and _RESULT_END in text:
        new = re.sub(
            re.escape(_RESULT_START) + r".*?" + re.escape(_RESULT_END),
            lambda _: block, text, count=1, flags=re.DOTALL)
    else:
        new = text.rstrip() + "\n\n" + block + "\n"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(new)
    return new


def _emit_summary(theme: dict, log: dict, link: str):
    """GitHub Step Summary (falls back to stdout locally)."""
    winner = log.get("winner", {})
    md = (
        f"### 🖼️ Collage built\n\n"
        f"**{theme.get('title', '')}** · mood `{theme.get('mood', '')}` · "
        f"layout `{winner.get('name', '')}` (score {winner.get('score', '')})\n\n"
        f"{link}\n"
    )
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(md)
    print(md)


# ── Main ────────────────────────────────────────────────────────────────────
def run(md_path: str) -> int:
    from . import s3io
    from .optimize import optimize
    from .remote import fetch_image, fetch_images
    from .theme import detect_theme

    with open(md_path, "r", encoding="utf-8") as f:
        text = f.read()
    meta = parse_front_matter(text)

    template_url = meta.get("template")
    if not template_url:
        print(f"No `template:` URL in {md_path} front matter — nothing to do.")
        return 1

    print(f"Template: {template_url}")
    template_img = fetch_image(template_url)

    # Photos: explicit URLs, else the bundled sample set.
    photo_srcs = meta.get("photos") or []
    if isinstance(photo_srcs, str):
        photo_srcs = [photo_srcs]
    if photo_srcs:
        photos = fetch_images(photo_srcs)
        print(f"Fetched {len(photos)} photo(s) from the request file")
    else:
        paths = sorted(
            os.path.join(_SAMPLE_DIR, f)
            for f in os.listdir(_SAMPLE_DIR)
            if f.lower().endswith(s3io.IMAGE_EXT) and not f.startswith(config.COLLAGE_PREFIX)
        )
        photos = s3io.load_images(paths[:6])
        print(f"No photos in request — using {len(photos)} bundled sample(s)")

    if len(photos) < 3:
        print(f"Only {len(photos)} usable photo(s) — need at least 3. Aborting.")
        return 1
    photos = photos[:6]

    print(f"Vision (OpenRouter · {config.MODEL}): "
          f"{'ON' if config.HAS_CLAUDE else 'OFF (heuristic fallback)'}")
    theme = detect_theme(photos, template=template_img)
    print(f"Theme: {theme['title']!r} · mood={theme['mood']} · "
          f"layout_hint={theme.get('layout_hint')} · via {theme['source']}")

    best_spec, best_render, log = optimize(photos, theme, template=template_img)
    print(f"Winner: {log['winner']['name']} (score {log['winner']['score']})")

    os.makedirs(_OUT_DIR, exist_ok=True)
    out_path = os.path.join(_OUT_DIR, config.COLLAGE_NAME)
    best_render.save(out_path, format="JPEG", quality=92)
    rel_image = os.path.relpath(out_path, _ROOT).replace(os.sep, "/")
    print(f"Wrote {rel_image}")

    # Best-effort S3 upload. Each build gets a unique, title-derived object
    # name (collage-<title-slug>-<HHMMSS>.jpg) so successive builds are all
    # preserved instead of overwriting one another. Always attempt so the log
    # is explicit about why it did/didn't happen — boto3 raises cleanly when
    # no credentials are configured.
    s3_url = None
    date = meta.get("date") or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    object_name = config.collage_object_name(theme.get("title"))
    have_creds = bool(os.environ.get("AWS_ACCESS_KEY_ID")
                      or os.environ.get("AWS_PROFILE"))
    print(f"[s3] AWS credentials in env: {have_creds}")
    try:
        s3_url = s3io.upload_collage(date, out_path, name=object_name)
        print(f"Uploaded: {s3_url}")
    except Exception as e:
        print(f"[s3] upload skipped: {type(e).__name__}: {e}")

    block = _render_result_block(rel_image, s3_url, theme, log, len(photos))
    _write_result(md_path, text, block)
    _emit_summary(theme, log, s3_url or rel_image)
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="Build a collage from a template request file.")
    p.add_argument("--md", default="collage-template.md",
                   help="Path to the markdown request file")
    args = p.parse_args(argv)
    return run(args.md)


if __name__ == "__main__":
    sys.exit(main())
