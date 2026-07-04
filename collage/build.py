"""Entry point: build one day's collage.

    python -m collage.build --date 2026-07-04                 # from S3, upload result
    python -m collage.build --local ./collage/sample --no-upload   # local dry-run

In CI this is invoked with --date (defaults to today, UTC). Locally you can
point --local at a folder of images to exercise the whole engine with no AWS
and no Anthropic key (heuristic fallback kicks in automatically).
"""
import argparse
import datetime as dt
import json
import os
import sys
import tempfile

from . import config


def _today() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")


def build(date: str, local_dir: str | None, upload: bool, out_path: str | None):
    from . import s3io
    from .optimize import optimize
    from .theme import detect_theme

    # 1. Gather photos
    if local_dir:
        paths = sorted(
            os.path.join(local_dir, f)
            for f in os.listdir(local_dir)
            if f.lower().endswith(s3io.IMAGE_EXT) and f != config.COLLAGE_NAME
        )
        print(f"Loaded {len(paths)} local photo(s) from {local_dir}")
    else:
        tmp = tempfile.mkdtemp(prefix=f"collage-{date}-")
        paths = s3io.download_photos(date, tmp)
        print(f"Downloaded {len(paths)} photo(s) for {date} from s3://{config.BUCKET}")

    if len(paths) < 3:
        print(f"Only {len(paths)} photo(s) — need at least 3 for a collage. Skipping.")
        return 0

    photos = s3io.load_images(paths[:6])           # cap at 6

    # 2. Theme → 3. optimize/evaluate loop
    print(f"Vision (OpenRouter · {config.MODEL}): "
          f"{'ON' if config.HAS_CLAUDE else 'OFF (heuristic fallback)'}")
    theme = detect_theme(photos)
    print(f"Theme: {theme['title']!r} · mood={theme['mood']} · via {theme['source']}")

    best_spec, best_render, log = optimize(photos, theme)
    print("Optimizer log:\n" + json.dumps(log, indent=2, default=str))

    # 4. Save + upload
    out_path = out_path or os.path.join(tempfile.gettempdir(), f"collage-{date}.jpg")
    best_render.save(out_path, format="JPEG", quality=92)
    print(f"Winner: {log['winner']['name']} (score {log['winner']['score']}) → {out_path}")

    if upload:
        url = s3io.upload_collage(date, out_path)
        print(f"Uploaded: {url}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="Build a Questr travel-journal collage.")
    p.add_argument("--date", default=_today(), help="YYYY-MM-DD (default: today UTC)")
    p.add_argument("--local", help="Build from a local folder instead of S3")
    p.add_argument("--no-upload", action="store_true", help="Do not upload to S3")
    p.add_argument("--out", help="Where to write the collage JPEG")
    args = p.parse_args(argv)
    return build(args.date, args.local, not args.no_upload, args.out)


if __name__ == "__main__":
    sys.exit(main())
