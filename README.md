# AMA Board

A serverless, single-organization AMA board prototype. Participants can submit questions under a random pseudonym, vote, comment, filter the board, and display a selected question in presentation mode.

**Production hostname:** [https://ama.anyhowonly.com](https://ama.anyhowonly.com)

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

The infrastructure is configured to serve Askboard at `ama.anyhowonly.com` through Route 53, an ACM certificate, and CloudFront. The `anyhowonly.com` public hosted zone must already exist in the AWS account; the deployment script discovers it automatically or accepts `HOSTED_ZONE_ID` explicitly.

Prerequisites:

1. An AWS account and locally configured AWS credentials.
2. AWS CLI and AWS SAM CLI.
3. Node.js 20 or later.
4. A local Python interpreter compatible with the Lambda runtime declared in `infrastructure/template.yaml`, or a container runtime when using `sam build --use-container`.
5. The `anyhowonly.com` public hosted zone in Route 53 in the deploying AWS account.

Deploy a development stack with:

```bash
./scripts/deploy.sh dev
```

The first deployment uses `npm install` when the repository does not yet contain a `package-lock.json`; subsequent deployments use the reproducible `npm ci` path once that generated lockfile has been committed. If the first deployment creates `package-lock.json`, commit it to the repository before the next deployment.

The deployment script does not hard-code or preflight a local Python executable. SAM reads the Lambda runtime from the infrastructure template. If the matching interpreter is not installed locally and a container runtime is available, run the deployment with `SAM_BUILD_USE_CONTAINER=true` to make SAM build in its runtime container.

Set `ADMIN_EMAIL` to the initial organisation administrator when deploying. Cognito creates the account, adds it to the `Admins` group, and sends a temporary-password invitation. The default is `admin@anyhowonly.com`, but an actively monitored mailbox should be supplied:

```bash
ADMIN_EMAIL=your.name@anyhowonly.com ./scripts/deploy.sh production
```

The deployment generates the browser's Cognito and AppSync configuration from CloudFormation outputs. On the first login, the form handles Cognito's temporary-password challenge and asks the administrator to choose a permanent password. Once signed in, the administrator can open board settings and invite additional moderators by email.

Authenticated administrators use `/admin` for organisation-wide users, boards, and defaults. Board-specific participation, moderator, and presentation controls remain under `/boards/<board-id>/settings`. The home page detects a valid Cognito session and replaces the login action with an Administration link; logging out clears the browser session.

The script discovers the Route 53 zone for `anyhowonly.com`, builds the frontend, deploys a small certificate stack in `us-east-1`, and deploys the main SAM/CloudFormation application stack in `ap-southeast-1`. It then uploads `dist/` to the private S3 origin, invalidates CloudFront, and prints the application, AppSync, and Cognito outputs. The application URL is `https://ama.anyhowonly.com`.

CloudFront requires its ACM certificate to be in `us-east-1`, even when the application runs elsewhere. The separate `askboard-<environment>-certificate` stack satisfies that restriction while the main stack defaults to `ap-southeast-1`. Set `AWS_REGION` only if you want the main application stack in another region; it does not change the certificate region.

```bash
MONTHLY_BUDGET_USD=20 \
AWS_REGION=ap-southeast-1 \
HOSTED_ZONE_ID=Z123456789EXAMPLE \
DOMAIN_NAME=ama.anyhowonly.com \
./scripts/deploy.sh production
```

`HOSTED_ZONE_ID` is optional when the AWS identity can list Route 53 hosted zones. `API_KEY_EXPIRES_EPOCH` can also override the automatically generated 364-day API-key expiry.

### Resolving deployment-script merge conflicts

If GitHub reports a conflict in `scripts/deploy.sh`, do not choose **Accept both changes** between the old single-region check and the new regional-stack implementation. Keep the version that defines both `DEPLOY_REGION` and `CERTIFICATE_REGION`, and remove any block that requires `DEPLOY_REGION` to equal `us-east-1`.

The current script prints `2026-08-22-regional-stack-v2` when it starts. If that version is not shown in CloudShell, update the checkout before deploying. Verify it with:

```bash
grep -n 'SCRIPT_VERSION\|DEPLOY_REGION\|CERTIFICATE_REGION' scripts/deploy.sh
grep -n 'CloudFront ACM certificates must' scripts/deploy.sh || true
```

The second command must produce no output.

The stack creates:

- Cognito User Pool and browser client
- AppSync API, API key, schema, Lambda data source, and resolvers
- Python Lambda resolver backend
- Encrypted, point-in-time-recoverable DynamoDB table
- Private S3 web bucket and CloudFront distribution with origin access control
- A separate `us-east-1` stack containing the DNS-validated ACM certificate for `ama.anyhowonly.com`
- Route 53 IPv4 and IPv6 alias records pointing the hostname to CloudFront
- AppSync logging roles, least-privilege application roles, X-Ray, and a monthly AWS Budget

To delete the CloudFormation-managed resources while retaining the DynamoDB data table:

```bash
./scripts/delete.sh dev
```

> The generated AppSync API key is intended for public/unlisted board access and expires within one year. Rotate it before expiry. For production, do not expose the key beyond the web application and add AWS WAF or a bot challenge before enabling unrestricted anonymous posting.
