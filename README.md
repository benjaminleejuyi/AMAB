# Askboard

A serverless, single-organization AMA board prototype. Participants can submit questions under a random pseudonym, vote, comment, filter the board, and display a selected question in presentation mode.

## Run locally

```bash
npm install
npm run dev
```

The current frontend is an interactive prototype backed by local React state. `amplify/schema.graphql` defines the AWS AppSync contract, while `infrastructure/template.yaml` provisions its deployable backend and hosting infrastructure.

## AWS target

- Amplify Hosting for the React application
- Cognito User Pools for organization admins, board owners, and delegated moderators
- AppSync GraphQL subscriptions for live board and presentation updates
- Lambda resolvers for authorization, pseudonym assignment, vote transactions, and moderation
- DynamoDB for boards, questions, comments, votes, members, and participant identities
- CloudWatch and AWS Budgets for observability and cost controls

Public and unlisted boards are in scope. Private boards, multi-organization tenancy, file attachments, and comment pre-moderation are intentionally excluded from the first MVP.

## Deploy to AWS

Prerequisites:

1. An AWS account and locally configured AWS credentials.
2. AWS CLI and AWS SAM CLI.
3. Node.js 20 or later.
4. The `anyhowonly.com` public hosted zone in Route 53 in the deploying AWS account.

Deploy a development stack with:

```bash
./scripts/deploy.sh dev
```

The script discovers the Route 53 zone for `anyhowonly.com`, builds the frontend, packages and deploys the SAM/CloudFormation template in `us-east-1`, uploads `dist/` to the private S3 origin, invalidates CloudFront, and prints the application, AppSync, and Cognito outputs. The application URL is `https://ama.anyhowonly.com`.

CloudFront requires its ACM certificate to be in `us-east-1`, so the deployment script intentionally deploys this stack there. Override deployment settings when needed:

```bash
MONTHLY_BUDGET_USD=20 \
HOSTED_ZONE_ID=Z123456789EXAMPLE \
DOMAIN_NAME=ama.anyhowonly.com \
./scripts/deploy.sh production
```

`HOSTED_ZONE_ID` is optional when the AWS identity can list Route 53 hosted zones. `API_KEY_EXPIRES_EPOCH` can also override the automatically generated 364-day API-key expiry.

The stack creates:

- Cognito User Pool and browser client
- AppSync API, API key, schema, Lambda data source, and resolvers
- Python Lambda resolver backend
- Encrypted, point-in-time-recoverable DynamoDB table
- Private S3 web bucket and CloudFront distribution with origin access control
- DNS-validated ACM certificate for `ama.anyhowonly.com`
- Route 53 IPv4 and IPv6 alias records pointing the hostname to CloudFront
- AppSync logging roles, least-privilege application roles, X-Ray, and a monthly AWS Budget

To delete the CloudFormation-managed resources while retaining the DynamoDB data table:

```bash
./scripts/delete.sh dev
```

> The generated AppSync API key is intended for public/unlisted board access and expires within one year. Rotate it before expiry. For production, do not expose the key beyond the web application and add AWS WAF or a bot challenge before enabling unrestricted anonymous posting.
