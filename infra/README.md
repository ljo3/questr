# Questr collage — infrastructure

Everything needed to wire the photo-collage pipeline. Run the AWS steps with an
**admin** identity (the `index-management-ci` CI user can't manage S3/IAM/Lambda).

Files:
| File | What it is |
|---|---|
| `s3-cors.json` | Bucket CORS — lets the browser PUT via the presigned URL |
| `s3-bucket-policy.json` | Public read for `*/collage.jpg` only |
| `lambda-trust-policy.json` | Lets Lambda assume the exec role |
| `lambda-s3-put-policy.json` | Exec-role permission to presign S3 PUTs |
| `deploy-lambda.sh` | One-shot: package + role + function + public Function URL |

## 1. S3 bucket (`photo-bucket-333886071196-eu-west-3-an`)

```bash
B=photo-bucket-333886071196-eu-west-3-an

# CORS
aws s3api put-bucket-cors --bucket $B \
  --cors-configuration file://infra/s3-cors.json

# Allow public *reads* of the collages (default account-level block usually
# blocks bucket policies granting public access — relax that first):
aws s3api put-public-access-block --bucket $B \
  --public-access-block-configuration \
  BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

aws s3api put-bucket-policy --bucket $B \
  --policy file://infra/s3-bucket-policy.json
```

## 2. Lambda signing endpoint

```bash
export GH_TOKEN=ghp_xxx          # GitHub PAT with `repo` scope
./infra/deploy-lambda.sh
# → prints the Function URL. Copy it into VITE_QUESTR_SIGN_URL (step 4).
```

## 3. GitHub Actions secrets (repo `ljo3/questr`)

```bash
gh secret set AWS_ACCESS_KEY_ID     --repo ljo3/questr
gh secret set AWS_SECRET_ACCESS_KEY --repo ljo3/questr
gh secret set OPENROUTER_API_KEY    --repo ljo3/questr
# optional overrides:
gh secret set PHOTO_BUCKET --repo ljo3/questr --body photo-bucket-333886071196-eu-west-3-an
gh variable set COLLAGE_MODEL --repo ljo3/questr --body anthropic/claude-opus-4.8
```

The AWS creds here need `s3:ListBucket` + `s3:GetObject` (read photos) and
`s3:PutObject` (write the collage) on the bucket.

## 4. Frontend env

```bash
# .env (local) and Cloudflare Pages → Settings → Environment variables
VITE_QUESTR_SIGN_URL=https://<id>.lambda-url.eu-west-3.on.aws/
```

## 5. Smoke test

- Local engine: `python -m collage.build --local ./collage/sample --no-upload --out /tmp/out.jpg`
- End to end: `npm run dev`, open the Journal, upload 3+ photos, tap **Create collage now**.
