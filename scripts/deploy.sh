#!/usr/bin/env bash
set -euo pipefail

SCRIPT_VERSION="2026-08-22-regional-stack-v2"
ENVIRONMENT="${1:-dev}"
BUDGET_USD="${MONTHLY_BUDGET_USD:-10}"
EXPIRY="${API_KEY_EXPIRES_EPOCH:-$(date -d '+364 days' +%s)}"
STACK_NAME="askboard-${ENVIRONMENT}"
CERTIFICATE_STACK_NAME="${STACK_NAME}-certificate"
DEPLOY_REGION="${AWS_REGION:-ap-southeast-1}"
CERTIFICATE_REGION="us-east-1"
DOMAIN_NAME="${DOMAIN_NAME:-ama.anyhowonly.com}"
HOSTED_ZONE_NAME="${HOSTED_ZONE_NAME:-anyhowonly.com}"

command -v sam >/dev/null || { echo "AWS SAM CLI is required: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html" >&2; exit 1; }
command -v aws >/dev/null || { echo "AWS CLI is required and must be authenticated." >&2; exit 1; }

echo "Askboard deploy script ${SCRIPT_VERSION}"
echo "Main stack region: ${DEPLOY_REGION}; CloudFront certificate region: ${CERTIFICATE_REGION}"

HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-$(aws route53 list-hosted-zones-by-name \
  --dns-name "${HOSTED_ZONE_NAME}" \
  --query "HostedZones[?Name=='${HOSTED_ZONE_NAME}.']|[0].Id" \
  --output text | sed 's|/hostedzone/||')}"
if [[ -z "${HOSTED_ZONE_ID}" || "${HOSTED_ZONE_ID}" == "None" ]]; then
  echo "No Route 53 hosted zone found for ${HOSTED_ZONE_NAME}. Set HOSTED_ZONE_ID explicitly." >&2
  exit 1
fi

echo "Building frontend..."
if [[ -f package-lock.json ]]; then
  npm ci
else
  echo "package-lock.json is not present; running npm install to create it."
  npm install
fi
npm run build

echo "Deploying CloudFront certificate in ${CERTIFICATE_REGION}..."
aws cloudformation deploy \
  --template-file infrastructure/certificate-template.yaml \
  --stack-name "${CERTIFICATE_STACK_NAME}" \
  --region "${CERTIFICATE_REGION}" \
  --parameter-overrides "Environment=${ENVIRONMENT}" "DomainName=${DOMAIN_NAME}" "HostedZoneId=${HOSTED_ZONE_ID}" \
  --no-fail-on-empty-changeset

CERTIFICATE_ARN="$(aws cloudformation describe-stacks \
  --region "${CERTIFICATE_REGION}" \
  --stack-name "${CERTIFICATE_STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue" \
  --output text)"
if [[ -z "${CERTIFICATE_ARN}" || "${CERTIFICATE_ARN}" == "None" ]]; then
  echo "Certificate stack did not return a certificate ARN." >&2
  exit 1
fi

echo "Deploying ${STACK_NAME}..."
SAM_BUILD_ARGS=(--template-file infrastructure/template.yaml --build-dir .aws-sam/build)
if [[ "${SAM_BUILD_USE_CONTAINER:-false}" == "true" ]]; then
  SAM_BUILD_ARGS+=(--use-container)
fi
sam build "${SAM_BUILD_ARGS[@]}"
sam deploy \
  --stack-name "${STACK_NAME}" \
  --region "${DEPLOY_REGION}" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "Environment=${ENVIRONMENT}" "DomainName=${DOMAIN_NAME}" "HostedZoneId=${HOSTED_ZONE_ID}" "CertificateArn=${CERTIFICATE_ARN}" "ApiKeyExpiresEpoch=${EXPIRY}" "MonthlyBudgetUsd=${BUDGET_USD}" \
  --no-fail-on-empty-changeset

BUCKET="$(aws cloudformation describe-stacks --region "${DEPLOY_REGION}" --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" --output text)"
DISTRIBUTION="$(aws cloudformation describe-stacks --region "${DEPLOY_REGION}" --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"

echo "Publishing frontend to s3://${BUCKET}..."
aws s3 sync dist/ "s3://${BUCKET}" --delete
aws cloudfront create-invalidation --region "${DEPLOY_REGION}" --distribution-id "${DISTRIBUTION}" --paths '/*' >/dev/null

aws cloudformation describe-stacks --region "${DEPLOY_REGION}" --stack-name "${STACK_NAME}" --query 'Stacks[0].Outputs' --output table
