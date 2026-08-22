#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-dev}"
STACK_NAME="askboard-${ENVIRONMENT}"
BUCKET="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" --output text)"

# Retained data and web buckets must be emptied before CloudFormation can remove them.
aws s3 rm "s3://${BUCKET}" --recursive
aws cloudformation delete-stack --stack-name "${STACK_NAME}"
aws cloudformation wait stack-delete-complete --stack-name "${STACK_NAME}"
echo "Deleted ${STACK_NAME}. The DynamoDB table is retained intentionally."
