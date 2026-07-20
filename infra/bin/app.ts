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
new SiteStack(app, "PetertranSiteStack", {
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
new GamesStack(app, "PetertranGamesStack", {
  env: { account, region: "ap-southeast-2" },
});
// Separate service from the resume site above - own table, own Lambda, own
// schema. See infra/lib/pantry-stack.ts for why.
new PantryStack(app, "PetertranPantryStack", {
  env: { account, region: "ap-southeast-2" },
});

// Personal learning exercise: edge gateway + internal STS + domain
// gateway(s), fully isolated from the stacks above - own table, own
// Lambdas, own HttpApis. See infra/lib/zero-trust-lab-stack.ts.
new ZeroTrustLabStack(app, "PetertranZeroTrustLabStack", {
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
// matters. Still deployed after them in practice since the actual Lambdas
// need to exist under these names first.
new WarmupStack(app, "PetertranWarmupStack", {
  portfolioFnName: FUNCTION_NAMES.portfolio,
  pantryFnName: FUNCTION_NAMES.pantry,
  imposterFnName: FUNCTION_NAMES.imposter,
  zeroTrustLabFnNames,
  env: { account, region: "ap-southeast-2" },
});

// Scheduled Provisioned Concurrency for portfolio/pantry/imposter's and
// zero-trust-lab's `live` aliases, 8am-7pm Sydney - deliberately its own
// stack, same reasoning as WarmupStack above. See infra/lib/pc-config-stack.ts.
new ProvisionedConcurrencyStack(app, "PetertranProvisionedConcurrencyStack", {
  portfolioFnName: FUNCTION_NAMES.portfolio,
  pantryFnName: FUNCTION_NAMES.pantry,
  imposterFnName: FUNCTION_NAMES.imposter,
  zeroTrustLabFnNames,
  env: { account, region: "ap-southeast-2" },
});

// Shared HttpApi in front of portfolio/pantry/imposter/warmup-config/
// pc-config, giving them one stable domain (api.petertran.au) instead of
// each its own CloudFormation-generated Function URL. Same "plain function
// names, no live cross-stack reference" reasoning as WarmupStack above -
// deliberately does NOT cover zero-trust-lab's own edge/domain gateways,
// which stay isolated per that stack's own design intent. See
// infra/lib/api-gateway-stack.ts.
new ApiGatewayStack(app, "PetertranApiGatewayStack", {
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

  new SiteStack(app, "PetertranTestSiteStack", {
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

  new PantryStack(app, "PetertranTestPantryStack", {
    tableName: "pantry-test",
    functionName: TEST_FUNCTION_NAMES.pantry,
    isTestEnv: true,
    env: { account, region: "ap-southeast-2" },
  });

  new GamesStack(app, "PetertranTestGamesStack", {
    tableName: "games-test",
    functionName: TEST_FUNCTION_NAMES.imposter,
    isTestEnv: true,
    env: { account, region: "ap-southeast-2" },
  });

  new ApiGatewayStack(app, "PetertranTestApiGatewayStack", {
    domainName: testDomainName,
    alternateDomainNames: testAlternateDomainNames,
    hostedZoneId,
    hostedZoneName,
    apiSubdomain: "api.test",
    portfolioFnName: TEST_FUNCTION_NAMES.portfolio,
    pantryFnName: TEST_FUNCTION_NAMES.pantry,
    imposterFnName: TEST_FUNCTION_NAMES.imposter,
    env: { account, region: "ap-southeast-2" },
  });
}
