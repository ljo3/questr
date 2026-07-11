"""S3 access for the collage pipeline: list a day's photos, download them,
upload the finished collage. Uses boto3's default credential chain (GitHub
Actions provides creds via secrets / OIDC role)."""
import os

from PIL import Image

from . import config

_s3 = None


def _client():
    global _s3
    if _s3 is None:
        import boto3                               # lazy: local dry-runs need no boto3

        _s3 = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3


IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")


def list_photo_keys(date: str) -> list[str]:
    """All source-photo keys under <date>/, excluding the collage we write."""
    keys = []
    paginator = _client().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=config.BUCKET, Prefix=f"{date}/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue
            if os.path.basename(key).startswith(config.COLLAGE_PREFIX):
                continue
            if key.lower().endswith(IMAGE_EXT):
                keys.append(key)
    return sorted(keys)


def download_photos(date: str, dest_dir: str) -> list[str]:
    os.makedirs(dest_dir, exist_ok=True)
    paths = []
    for key in list_photo_keys(date):
        local = os.path.join(dest_dir, os.path.basename(key))
        _client().download_file(config.BUCKET, key, local)
        paths.append(local)
    return paths


def upload_collage(date: str, image_path: str, name: str | None = None) -> str:
    """Upload the finished collage as <date>/<name> and return its URL. `name`
    defaults to the stable collage.jpg; pass a unique per-build name (see
    config.collage_object_name) so successive builds don't overwrite."""
    name = name or config.COLLAGE_NAME
    key = f"{date}/{name}"
    _client().upload_file(
        image_path,
        config.BUCKET,
        key,
        ExtraArgs={"ContentType": "image/jpeg", "CacheControl": "no-cache"},
    )
    return config.collage_url(date, name)


def load_images(paths: list[str]) -> list[Image.Image]:
    """Load, EXIF-orient and RGB-normalise photos for rendering."""
    from PIL import ImageOps

    imgs = []
    for p in paths:
        img = Image.open(p)
        img = ImageOps.exif_transpose(img)      # respect phone orientation
        imgs.append(img.convert("RGB"))
    return imgs
