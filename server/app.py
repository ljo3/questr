"""Questr collage API — the always-on service that runs on the Vultr box.

Replaces the Lambda signing endpoint *and* GitHub Actions: the browser POSTs
the day's photos straight here, we run the optimizer/evaluator collage engine,
and upload the finished collage to S3 (public-read). The frontend then polls
the returned S3 URL and shows it inline.

Run:  uvicorn server.app:app --host 127.0.0.1 --port 8080
Env:  OPENROUTER_API_KEY, AWS creds (s3:PutObject on the bucket),
      PHOTO_BUCKET, AWS_REGION, ALLOW_ORIGIN (comma-separated origins)
"""
import datetime as dt
import os
import tempfile
import threading
import traceback
import uuid

import boto3
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from collage import config, s3io
from collage.optimize import optimize
from collage.theme import detect_theme

MIN_PHOTOS, MAX_PHOTOS = 3, 6
MAX_BYTES = 12 * 1024 * 1024                     # 12 MB per photo
ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOW_ORIGIN", "https://questr.pages.dev,http://localhost:5173").split(",")]

# Cap concurrent builds so a small box can't be swamped (vision is I/O-bound,
# render is light — 2 in flight is comfortable on a 1 GB instance).
_slots = threading.Semaphore(2)
_s3 = boto3.client("s3", region_name=config.AWS_REGION)

app = FastAPI(title="Questr collage API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


def _build_and_upload(paths: list[str], key: str):
    """Run the engine and push the result to S3. Runs in a background thread."""
    with _slots:
        try:
            photos = s3io.load_images(paths[:MAX_PHOTOS])
            theme = detect_theme(photos)
            _, render, log = optimize(photos, theme)
            out = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4().hex}.jpg")
            render.save(out, format="JPEG", quality=92)
            _s3.upload_file(
                out, config.BUCKET, key,
                ExtraArgs={"ContentType": "image/jpeg", "CacheControl": "no-cache"},
            )
            print(f"[build] {key} · theme={theme['title']!r} · "
                  f"winner={log['winner']['name']} ({log['winner']['score']})")
            os.remove(out)
        except Exception:
            print(f"[build] FAILED for {key}:\n{traceback.format_exc()}")
        finally:
            for p in paths:
                try:
                    os.remove(p)
                except OSError:
                    pass


@app.get("/healthz")
def healthz():
    return {"ok": True, "vision": config.HAS_CLAUDE, "model": config.MODEL}


@app.post("/build")
async def build(files: list[UploadFile] = File(...)):
    imgs = [f for f in files if (f.content_type or "").startswith("image/")]
    if len(imgs) < MIN_PHOTOS:
        raise HTTPException(400, f"Need at least {MIN_PHOTOS} photos.")

    date = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    job = uuid.uuid4().hex
    workdir = tempfile.mkdtemp(prefix=f"questr-{job}-")
    paths = []
    for i, f in enumerate(imgs[:MAX_PHOTOS]):
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(413, f"'{f.filename}' is larger than 12 MB.")
        p = os.path.join(workdir, f"{i:02d}.jpg")
        with open(p, "wb") as out:
            out.write(data)
        paths.append(p)

    # Unique key per build so concurrent users never clobber each other. The
    # bucket policy grants public read on `*/collage.jpg`, which this matches.
    key = f"{date}/{job}/collage.jpg"
    collage_url = f"https://{config.BUCKET}.s3.{config.AWS_REGION}.amazonaws.com/{key}"

    threading.Thread(target=_build_and_upload, args=(paths, key), daemon=True).start()
    return JSONResponse(status_code=202, content={"date": date, "collageUrl": collage_url})
