#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-dev}"
BUDGET_USD="${MONTHLY_BUDGET_USD:-10}"
EXPIRY="${API_KEY_EXPIRES_EPOCH:-$(date -d '+364 days' +%s)}"
STACK_NAME="askboard-${ENVIRONMENT}"

command -v sam >/dev/null || { echo "AWS SAM CLI is required: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html" >&2; exit 1; }
command -v aws >/dev/null || { echo "AWS CLI is required and must be authenticated." >&2; exit 1; }

echo "Building frontend..."
npm ci
npm run build

echo "Deploying ${STACK_NAME}..."
sam build --template-file infrastructure/template.yaml
sam deploy \
  --stack-name "${STACK_NAME}" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "Environment=${ENVIRONMENT}" "ApiKeyExpiresEpoch=${EXPIRY}" "MonthlyBudgetUsd=${BUDGET_USD}" \
  --no-fail-on-empty-changeset

BUCKET="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" --output text)"
DISTRIBUTION="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"

echo "Publishing frontend to s3://${BUCKET}..."
aws s3 sync dist/ "s3://${BUCKET}" --delete
aws cloudfront create-invalidation --distribution-id "${DISTRIBUTION}" --paths '/*' >/dev/null

aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --query 'Stacks[0].Outputs' --output table
