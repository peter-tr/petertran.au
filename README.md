# petertran.au

My personal site - a resume that's also a live, publicly-queryable GraphQL API.
The site itself is served by the exact system its architecture diagram describes:
a Lambda-backed Apollo Server, deployed with AWS CDK, backed by a single
DynamoDB table, with real CloudWatch/X-Ray metrics surfaced on the page itself.

Try the query explorer at [petertran.au](https://petertran.au), or point any
GraphQL client at the API directly and query it yourself.

## Stack

- **`web/`** - React + Vite frontend, including an embedded GraphiQL explorer
  and an "Ask Claude" natural-language-to-GraphQL feature
- **`api/`** - Apollo Server GraphQL API, running on Lambda behind a Function URL
- **`infra/`** - AWS CDK (TypeScript), provisioning everything: Lambda, DynamoDB,
  S3 + CloudFront, Route 53, ACM, SES, Secrets Manager
- **`.github/`** - GitHub Actions CI/CD, authenticating to AWS via OIDC (no
  long-lived access keys)

## Running it locally

Requires Node 20+.

```bash
npm install

# API: a local dev server with an in-memory mock of the resolvers
npm run dev --workspace=api

# Frontend: Vite dev server
npm run dev --workspace=web
```

The frontend expects the API at a URL configured in `web/.env` (see
`web/src/lib/graphql.ts` for the default). Local dev doesn't need real AWS
credentials - `api`'s dev server runs against mock data, not DynamoDB.

## Other commands

```bash
npm run lint          # eslint across the whole monorepo
npm run format        # prettier --write
npm run format:check  # prettier --check
```

## Deploying

Deploys run automatically via GitHub Actions on push to `main`. To deploy
manually (requires AWS credentials for the target account):

```bash
npm run deploy
```

This builds `api` and `web`, then runs `cdk deploy` from `infra`.
