#!/usr/bin/env bash
# Deploy the Questr signing Lambda + a public Function URL.
#
# Run with an AWS identity that can manage IAM + Lambda (NOT the
# index-management-ci user). The handler needs no bundled deps — boto3 ships
# in the Lambda runtime and everything else is stdlib.
#
# Required env:
#   GH_TOKEN   GitHub PAT with `repo` scope (fires repository_dispatch)
# Optional env (sensible defaults below):
#   REGION, BUCKET, GH_REPO, ALLOW_ORIGIN, FUNC, ROLE
set -euo pipefail

REGION="${REGION:-eu-west-3}"
BUCKET="${BUCKET:-photo-bucket-333886071196-eu-west-3-an}"
GH_REPO="${GH_REPO:-ljo3/questr}"
ALLOW_ORIGIN="${ALLOW_ORIGIN:-https://questr.pages.dev}"
FUNC="${FUNC:-questr-sign}"
ROLE="${ROLE:-questr-sign-role}"
: "${GH_TOKEN:?set GH_TOKEN to a GitHub PAT with repo scope}"

HERE="$(cd "$(dirname "$0")" && pwd)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

echo "▶ Packaging handler…"
( cd "$HERE/../lambda" && zip -q -j /tmp/questr-sign.zip handler.py )

echo "▶ Ensuring IAM role $ROLE…"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "file://$HERE/lambda-trust-policy.json" >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "  waiting for role to propagate…"; sleep 10
fi
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name questr-s3-put \
  --policy-document "file://$HERE/lambda-s3-put-policy.json"
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"

ENV="Variables={PHOTO_BUCKET=$BUCKET,GH_REPO=$GH_REPO,GH_TOKEN=$GH_TOKEN,ALLOW_ORIGIN=$ALLOW_ORIGIN}"

echo "▶ Deploying function $FUNC…"
if aws lambda get-function --function-name "$FUNC" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNC" --region "$REGION" \
    --zip-file fileb:///tmp/questr-sign.zip >/dev/null
  aws lambda wait function-updated --function-name "$FUNC" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FUNC" --region "$REGION" \
    --environment "$ENV" --timeout 15 >/dev/null
else
  aws lambda create-function --function-name "$FUNC" --region "$REGION" \
    --runtime python3.12 --handler handler.handler --role "$ROLE_ARN" \
    --zip-file fileb:///tmp/questr-sign.zip --timeout 15 --environment "$ENV" >/dev/null
fi
aws lambda wait function-updated --function-name "$FUNC" --region "$REGION"

echo "▶ Ensuring public Function URL…"
if ! aws lambda get-function-url-config --function-name "$FUNC" --region "$REGION" >/dev/null 2>&1; then
  # No URL-level CORS: the handler owns CORS (incl. OPTIONS preflight), so
  # configuring it here too would duplicate the response headers.
  aws lambda create-function-url-config --function-name "$FUNC" --region "$REGION" \
    --auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FUNC" --region "$REGION" \
    --statement-id public-url --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE >/dev/null
fi

URL="$(aws lambda get-function-url-config --function-name "$FUNC" --region "$REGION" --query FunctionUrl --output text)"
echo
echo "✅ Done. Function URL:"
echo "   $URL"
echo
echo "Set this in the frontend build env:"
echo "   VITE_QUESTR_SIGN_URL=$URL"
