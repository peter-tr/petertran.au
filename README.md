# petertran.au

My personal site - a resume that's also a live, publicly-queryable GraphQL API.
The site itself is served by the exact system its architecture diagram describes:
a Lambda-backed Apollo Server, deployed with AWS CDK, backed by a single
DynamoDB table, with real CloudWatch/X-Ray metrics surfaced on the page itself.

Try the query explorer at [petertran.au](https://petertran.au), or point any
GraphQL client at the API directly and query it yourself.

## Stack

```
petertran.au/
├── web/      React + Vite frontend - GraphiQL explorer, "Ask Claude" (NL → GraphQL), Pantry, Imposter
├── api/      Apollo Server GraphQL API, on Lambda behind a Function URL
│   └── src/
│       ├── portfolio/       this resume/API site
│       ├── pantry/          AI-assisted grocery inventory + shopping list
│       └── games/imposter/  a Werewolf/Mafia-style party game
├── infra/    AWS CDK (TypeScript) - Lambda, DynamoDB, S3 + CloudFront, Route 53, ACM, SES, Secrets Manager
└── .github/  CI/CD via GitHub Actions, authenticating to AWS via OIDC (no long-lived access keys)
```

Each of `portfolio`, `pantry`, and `games/imposter` is its own independent
backend - separate Lambda, Function URL, and DynamoDB table - deployed as its
own CDK stack so they evolve independently.

## Running it locally

Requires Node 20+.

```bash
npm install
npm run dev
```

This starts all four dev servers together in one terminal (labeled, colored
output; Ctrl+C stops all of them): the resume API, the Pantry API, the
Imposter game API, and the Vite frontend. Each API is a separate service with
its own in-memory mock resolvers - see `api/src/{portfolio,pantry,games/imposter}`.

To run just one, use its workspace script directly, e.g.
`npm run dev:portfolio --workspace=api` or `npm run dev --workspace=web`.

The frontend expects each API at a URL configured in `web/.env` (see
`web/src/portfolio/lib/graphql.ts`, `web/src/pantry/api.ts`, and
`web/src/games/imposter/lib/api.ts` for the defaults). Local dev doesn't need
real AWS credentials - every API's dev server runs against mock data, not
DynamoDB.

## Other commands

```bash
npm run typecheck     # tsc across api + web, via turbo (cached, parallel)
npm run build         # build api + web + infra, via turbo (cached, parallel)
npm run verify        # lint + format:check + typecheck + build, all via turbo
npm run lint          # eslint across the whole monorepo
npm run format        # prettier --write
npm run format:check  # prettier --check
npm run validate-schemas --workspace=api  # construct each service's ApolloServer + check the
                                           # Anthropic structured-output schema stays under its
                                           # union-type-parameter limit - catches SDL bugs at
                                           # commit time instead of a live outage
npm run test:e2e --workspace=api          # boot each service's real dev server and smoke-test it
```

`validate-schemas` and `test:e2e` also run as parallel CI jobs the `deploy`
job depends on - see `.github/workflows/deploy.yml`.

`dev`, `typecheck`, and `build` are orchestrated by
[Turborepo](https://turbo.build) (`turbo.json`) rather than plain npm-workspace
chaining: each task is content-hashed per package (including `web`'s generated
GraphQL types against the `api` schema files they're generated from), so an
unchanged package replays its cached result instead of re-running, and
independent packages build in parallel instead of sequentially. In CI, turbo's
local cache (`.turbo/cache`) is persisted across runs via `actions/cache` (see
`deploy.yml`) so this pays off there too, not just locally.

## Deploying

Deploys run automatically via GitHub Actions on push to `main`. To deploy
manually (requires AWS credentials for the target account):

```bash
npm run deploy
```

This builds `api`, `web`, and `infra` (via turbo, in parallel and cached),
then runs `cdk deploy` from `infra`.
