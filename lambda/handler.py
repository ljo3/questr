"""Questr signing endpoint — a single AWS Lambda behind a Function URL.

It keeps every secret server-side so the static Cloudflare-hosted page never
holds AWS keys or a GitHub token. Two routes (dispatched on the JSON `action`
field of a POST body):

    {"action": "sign",  "contentType": "image/jpeg"}
        → returns a presigned S3 PUT URL the browser uploads the photo to,
          plus the object key (grouped by today's UTC date) and the eventual
          public collage URL.

    {"action": "build", "date": "2026-07-04"}   # date optional, default today
        → fires a GitHub repository_dispatch (type "build-collage") so the
          Actions workflow rebuilds that day's collage on demand.

Presigning uses the function's own IAM execution role (no static S3 keys).
The GitHub token is the only secret, injected via the GH_TOKEN env var.

Environment:
    PHOTO_BUCKET     S3 bucket for photos + collages
    AWS_REGION       provided by Lambda automatically
    GH_TOKEN         GitHub PAT (fine-grained, "contents: read" is not enough —
                     needs repo access to dispatch; use a token with the
                     `repo` scope or fine-grained "Dispatch" permission)
    GH_REPO          "owner/repo", e.g. "ljo3/questr"
    ALLOW_ORIGIN     CORS origin to echo back (default "*")
"""
import datetime as dt
import json
import os
import urllib.request
import uuid

import boto3

BUCKET = os.environ["PHOTO_BUCKET"]
REGION = os.environ.get("AWS_REGION", "eu-west-3")
GH_TOKEN = os.environ.get("GH_TOKEN", "")
GH_REPO = os.environ.get("GH_REPO", "")
ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")

EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_BYTES = 12 * 1024 * 1024                 # 12 MB per photo

_s3 = boto3.client("s3", region_name=REGION)


def _today() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": ALLOW_ORIGIN,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(body),
    }


def _sign(body: dict) -> dict:
    content_type = body.get("contentType", "image/jpeg")
    if content_type not in EXT:
        return _resp(400, {"error": f"unsupported contentType {content_type!r}"})

    date = _today()
    key = f"{date}/{uuid.uuid4().hex}.{EXT[content_type]}"
    url = _s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": BUCKET,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=300,                       # 5 minutes to complete the upload
    )
    collage_url = f"https://{BUCKET}.s3.{REGION}.amazonaws.com/{date}/collage.jpg"
    return _resp(200, {
        "uploadUrl": url,
        "key": key,
        "date": date,
        "maxBytes": MAX_BYTES,
        "collageUrl": collage_url,
    })


def _build(body: dict) -> dict:
    if not (GH_TOKEN and GH_REPO):
        return _resp(500, {"error": "build endpoint not configured (GH_TOKEN/GH_REPO)"})

    date = body.get("date") or _today()
    payload = json.dumps({
        "event_type": "build-collage",
        "client_payload": {"date": date},
    }).encode()

    req = urllib.request.Request(
        f"https://api.github.com/repos/{GH_REPO}/dispatches",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {GH_TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "questr-lambda",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:      # 204 No Content on success
            r.read()
    except urllib.error.HTTPError as e:
        return _resp(e.code, {"error": f"github dispatch failed: {e.read().decode()}"})
    return _resp(202, {"status": "queued", "date": date})


def handler(event, _context):
    method = (event.get("requestContext", {})
              .get("http", {}).get("method", "POST")).upper()
    if method == "OPTIONS":                          # CORS preflight
        return _resp(204, {})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _resp(400, {"error": "invalid JSON body"})

    action = body.get("action")
    if action == "sign":
        return _sign(body)
    if action == "build":
        return _build(body)
    return _resp(400, {"error": "unknown action; expected 'sign' or 'build'"})
