#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-dev}"
STACK_NAME="askboard-${ENVIRONMENT}"
CERTIFICATE_STACK_NAME="${STACK_NAME}-certificate"
DEPLOY_REGION="${AWS_REGION:-ap-southeast-1}"
CERTIFICATE_REGION="us-east-1"
BUCKET="$(aws cloudformation describe-stacks --region "${DEPLOY_REGION}" --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" --output text)"

# Retained data and web buckets must be emptied before CloudFormation can remove them.
aws s3 rm "s3://${BUCKET}" --recursive
aws cloudformation delete-stack --region "${DEPLOY_REGION}" --stack-name "${STACK_NAME}"
aws cloudformation wait stack-delete-complete --region "${DEPLOY_REGION}" --stack-name "${STACK_NAME}"
aws cloudformation delete-stack --region "${CERTIFICATE_REGION}" --stack-name "${CERTIFICATE_STACK_NAME}"
aws cloudformation wait stack-delete-complete --region "${CERTIFICATE_REGION}" --stack-name "${CERTIFICATE_STACK_NAME}"
echo "Deleted ${STACK_NAME}. The DynamoDB table is retained intentionally."
