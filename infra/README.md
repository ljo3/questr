# Questr collage — AWS infrastructure

The AWS pieces for the photo-collage pipeline: an S3 bucket for the finished
collages, and a least-privilege IAM user the self-hosted API uses to write
them. Run these with an **admin** identity (the `index-management-ci` CI user
can't manage S3/IAM).

> The compute lives on a box you control — see [`../server/`](../server). This
> directory is just the AWS storage + credentials it needs.

Files:
| File | What it is |
|---|---|
| `s3-cors.json` | Bucket CORS — lets browsers read collages (and, if you keep presigned uploads, PUT) |
| `s3-bucket-policy.json` | Public read for `*/collage.jpg` only |
| `s3-put-policy.json` | The `s3:PutObject` grant attached to the `questr-signer` user |

## 1. S3 bucket (`photo-bucket-333886071196-eu-west-3-an`)

```bash
B=photo-bucket-333886071196-eu-west-3-an

aws s3api put-bucket-cors --bucket $B \
  --cors-configuration file://infra/s3-cors.json

# Default account settings block public bucket policies — relax that first:
aws s3api put-public-access-block --bucket $B \
  --public-access-block-configuration \
  BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

aws s3api put-bucket-policy --bucket $B \
  --policy file://infra/s3-bucket-policy.json
```

The bucket policy grants public read on any `*/collage.jpg`, so the unique
per-build keys the API writes (`<date>/<id>/collage.jpg`) are viewable while
nothing else in the bucket is.

## 2. Scoped IAM user for the box

The box needs to write collages and nothing more:

```bash
aws iam create-user --user-name questr-signer
aws iam put-user-policy --user-name questr-signer \
  --policy-name s3-put-collages \
  --policy-document file://infra/s3-put-policy.json
aws iam create-access-key --user-name questr-signer   # → put in the box's env
```

Then continue with [`../server/README.md`](../server/README.md).

> **Note:** the S3 CORS file is in `s3api` shape (`{"CORSRules": [...]}`). The
> S3 web console's CORS editor wants the bare array inside `CORSRules` instead.
