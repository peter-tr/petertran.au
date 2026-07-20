#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { CertStack } from "../lib/cert-stack";
import { SiteStack } from "../lib/site-stack";
import { GamesStack } from "../lib/games-stack";
import { PantryStack } from "../lib/pantry-stack";
import { ZeroTrustLabStack } from "../lib/zero-trust-lab-stack";
import { WarmupStack } from "../lib/warmup-stack";
import { ApiGatewayStack } from "../lib/api-gateway-stack";
import { ProvisionedConcurrencyStack } from "../lib/pc-config-stack";
import { SupergraphStack } from "../lib/supergraph-stack";
import { FUNCTION_NAMES, TEST_FUNCTION_NAMES } from "../lib/shared/function-names";

const app = new App();

const domainName = "www.petertran.au";
const alternateDomainNames = ["petertran.au"];
// Route 53 zone was created manually (see the Route 53 migration), not by
// any stack -- referenced by ID/name wherever a stack needs to add records
// to it (SiteStack's SES DKIM/DMARC, ApiGatewayStack's api.petertran.au).
const hostedZoneId = "Z0088163WL3F617J73T";
const hostedZoneName = "petertran.au";
const account = process.env.CDK_DEFAULT_ACCOUNT;

// CloudFront certificates must live in us-east-1 regardless of where the
// rest of the stack runs -- this is an AWS platform requirement, not a choice.
const certStack = new CertStack(app, "PetertranCertStack", {
  domainName,
  alternateDomainNames,
  env: { account, region: "us-east-1" },
  crossRegionReferences: true,
});

// Everything else runs in Sydney, close to the actual audience.
const siteStack = new SiteStack(app, "PetertranSiteStack", {
  domainName,
  alternateDomainNames,
  certificate: certStack.certificate,
  hostedZoneId,
  hostedZoneName,
  env: { account, region: "ap-southeast-2" },
  crossRegionReferences: true,
});

// Games and other misc side-projects - deployed independently of the resume
// site/API above, with their own Lambda(s) and table.
const gamesStack = new GamesStack(app, "PetertranGamesStack", {
  env: { account, region: "ap-southeast-2" },
});
// Separate service from the resume site above - own table, own Lambda, own
// schema. See infra/lib/pantry-stack.ts for why.
const pantryStack = new PantryStack(app, "PetertranPantryStack", {
  env: { account, region: "ap-southeast-2" },
});

// Personal learning exercise: edge gateway + internal STS + domain
// gateway(s), fully isolated from the stacks above - own table, own
// Lambdas, own HttpApis. See infra/lib/zero-trust-lab-stack.ts.
const zeroTrustLabStack = new ZeroTrustLabStack(app, "PetertranZeroTrustLabStack", {
  domainName,
  alternateDomainNames,
  env: { account, region: "ap-southeast-2" },
});

// Shared by WarmupStack and ProvisionedConcurrencyStack below - both target
// the same 5 zero-trust-lab Lambdas by plain name.
const zeroTrustLabFnNames = {
  idpBridge: FUNCTION_NAMES.ztlIdpBridge,
  internalSts: FUNCTION_NAMES.ztlInternalSts,
  edgeAuthorizer: FUNCTION_NAMES.ztlEdgeAuthorizer,
  edgeProxy: FUNCTION_NAMES.ztlEdgeProxy,
  domainA: FUNCTION_NAMES.ztlDomainA,
};

// Keeps every project's Lambda warm on a schedule - deliberately its own
// stack. Doesn't depend on the stacks above at the CDK/CloudFormation level
// at all (FUNCTION_NAMES are plain string literals, not read off those
// stacks' constructs) - see warmup-stack.ts's doc comment for why that
// matters. Safe to deploy in any order relative to them - EventBridge
// Scheduler targets and IAM policies are just ARN strings/JSON documents,
// neither validated against a live resource at creation time.
const warmupStack = new WarmupStack(app, "PetertranWarmupStack", {
  portfolioFnName: FUNCTION_NAMES.portfolio,
  pantryFnName: FUNCTION_NAMES.pantry,
  imposterFnName: FUNCTION_NAMES.imposter,
  zeroTrustLabFnNames,
  env: { account, region: "ap-southeast-2" },
});

// Scheduled Provisioned Concurrency for portfolio/pantry/imposter's and
// zero-trust-lab's `live` aliases, 8am-7pm Sydney - deliberately its own
// stack, same reasoning as WarmupStack above. Also safe to deploy in any
// order relative to the producing stacks, for the same reason (its own IAM
// policy referencing those aliases doesn't require them to already exist).
// See infra/lib/pc-config-stack.ts.
const provisionedConcurrencyStack = new ProvisionedConcurrencyStack(
  app,
  "PetertranProvisionedConcurrencyStack",
  {
    portfolioFnName: FUNCTION_NAMES.portfolio,
    pantryFnName: FUNCTION_NAMES.pantry,
    imposterFnName: FUNCTION_NAMES.imposter,
    zeroTrustLabFnNames,
    env: { account, region: "ap-southeast-2" },
  }
);

// Shared HttpApi in front of portfolio/pantry/imposter/warmup-config/
// pc-config, giving them one stable domain (api.petertran.au) instead of
// each its own CloudFormation-generated Function URL. Same "plain function
// names, no live cross-stack reference" reasoning as WarmupStack above -
// deliberately does NOT cover zero-trust-lab's own edge/domain gateways,
// which stay isolated per that stack's own design intent. See
// infra/lib/api-gateway-stack.ts.
const apiGatewayStack = new ApiGatewayStack(app, "PetertranApiGatewayStack", {
  domainName,
  alternateDomainNames,
  hostedZoneId,
  hostedZoneName,
  portfolioFnName: FUNCTION_NAMES.portfolio,
  pantryFnName: FUNCTION_NAMES.pantry,
  imposterFnName: FUNCTION_NAMES.imposter,
  warmupConfigFnName: FUNCTION_NAMES.warmupConfig,
  pcConfigFnName: FUNCTION_NAMES.pcConfig,
  env: { account, region: "ap-southeast-2" },
});

// Explicit deployment-order-only dependencies (no live construct reference,
// so still none of the CloudFormation-export lock-in the plain-string
// FUNCTION_NAMES convention above exists to avoid - see Stack.addDependency's
// own docs). Unlike WarmupStack/ProvisionedConcurrencyStack, ApiGatewayStack's
// AWS::Lambda::Permission resources call Lambda's AddPermission API, which
// DOES require the target alias/function to already exist - with `cdk deploy
// --all --concurrency 4` (see build-and-deploy.yml), CDK is otherwise free to
// start this stack before the ones below finish creating their aliases/
// functions, which fails deployment with "Cannot find alias/function ...".
// Hit exactly this in production the first time this stack shipped alongside
// the `live` alias additions.
apiGatewayStack.addDependency(siteStack);
apiGatewayStack.addDependency(pantryStack);
apiGatewayStack.addDependency(gamesStack);
apiGatewayStack.addDependency(zeroTrustLabStack);
apiGatewayStack.addDependency(warmupStack);
apiGatewayStack.addDependency(provisionedConcurrencyStack);

// On-demand test environment (test.petertran.au / api.test.petertran.au) for
// testing big changes (e.g. Apollo Router/Federation) without touching prod -
// gated behind an env var so it never shows up in a normal `cdk deploy --all`
// (see .github/workflows/deploy-test-env.yml, which is the only caller that
// sets this). Reuses the exact same stack classes as prod above - own
// domain, own tables, own Lambda names - instead of a hand-maintained
// parallel copy, so it can't silently drift from whatever prod actually
// deploys (see each class's isTestEnv-guarded branches for what's
// deliberately omitted: SES/RUM domain-wide singletons stay owned by prod's
// invocation, and warmup/pc-config/zero-trust-lab aren't part of what the
// test env exists to validate).
if (process.env.DEPLOY_TEST_ENV === "true") {
  const testDomainName = `test.${hostedZoneName}`;
  const testAlternateDomainNames = [`www.test.${hostedZoneName}`];

  const testCertStack = new CertStack(app, "PetertranTestCertStack", {
    domainName: testDomainName,
    alternateDomainNames: testAlternateDomainNames,
    hostedZoneId,
    hostedZoneName,
    env: { account, region: "us-east-1" },
    crossRegionReferences: true,
  });

  const testSiteStack = new SiteStack(app, "PetertranTestSiteStack", {
    domainName: testDomainName,
    alternateDomainNames: testAlternateDomainNames,
    certificate: testCertStack.certificate,
    hostedZoneId,
    hostedZoneName,
    tableName: "resume-test",
    bucketName: `petertran-au-site-test-${account}`,
    functionName: TEST_FUNCTION_NAMES.portfolio,
    isTestEnv: true,
    env: { account, region: "ap-southeast-2" },
    crossRegionReferences: true,
  });

  const testPantryStack = new PantryStack(app, "PetertranTestPantryStack", {
    tableName: "pantry-test",
    functionName: TEST_FUNCTION_NAMES.pantry,
    isTestEnv: true,
    env: { account, region: "ap-southeast-2" },
  });

  const testGamesStack = new GamesStack(app, "PetertranTestGamesStack", {
    tableName: "games-test",
    functionName: TEST_FUNCTION_NAMES.imposter,
    isTestEnv: true,
    env: { account, region: "ap-southeast-2" },
  });

  // Federation gateway composing the three test subgraphs above - test-env
  // only for now, see supergraph-stack.ts's doc comment.
  const testSupergraphStack = new SupergraphStack(app, "PetertranTestSupergraphStack", {
    apiBaseUrl: `https://api.test.${hostedZoneName}`,
    functionName: TEST_FUNCTION_NAMES.supergraph,
    env: { account, region: "ap-southeast-2" },
  });

  const testApiGatewayStack = new ApiGatewayStack(app, "PetertranTestApiGatewayStack", {
    domainName: testDomainName,
    alternateDomainNames: testAlternateDomainNames,
    hostedZoneId,
    hostedZoneName,
    apiSubdomain: "api.test",
    portfolioFnName: TEST_FUNCTION_NAMES.portfolio,
    pantryFnName: TEST_FUNCTION_NAMES.pantry,
    imposterFnName: TEST_FUNCTION_NAMES.imposter,
    supergraphFnName: TEST_FUNCTION_NAMES.supergraph,
    env: { account, region: "ap-southeast-2" },
  });
  // Same fix as prod's apiGatewayStack.addDependency calls above, and even
  // more load-bearing here: on a from-scratch deploy the test env's
  // Site/Pantry/Games Lambdas and `live` aliases don't exist at all yet, so
  // this isn't just a "wins the race sometimes" bug - without an explicit
  // dependency, ApiGatewayStack's AddPermission calls 404 against aliases
  // that haven't been created yet on every single first deploy.
  testApiGatewayStack.addDependency(testSiteStack);
  testApiGatewayStack.addDependency(testPantryStack);
  testApiGatewayStack.addDependency(testGamesStack);
  testApiGatewayStack.addDependency(testSupergraphStack);
}
