#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { CertStack } from "../lib/cert-stack";
import { SiteStack } from "../lib/site-stack";
import { GamesStack } from "../lib/games-stack";
import { PantryStack } from "../lib/pantry-stack";
import { ZeroTrustLabStack } from "../lib/zero-trust-lab-stack";
import { WarmupStack } from "../lib/warmup-stack";

const app = new App();

const domainName = "www.petertran.au";
const alternateDomainNames = ["petertran.au"];
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
  // Route 53 zone was created manually (see the Route 53 migration), not by
  // this stack -- referenced by ID/name so SES can add DKIM records to it.
  hostedZoneId: "Z0088163WL3F617J73T",
  hostedZoneName: "petertran.au",
  env: { account, region: "ap-southeast-2" },
  crossRegionReferences: true,
});

// Games and other misc side-projects - deployed independently of the resume
// site/API above, with their own Lambda(s) and table.
const gamesStack = new GamesStack(app, "PetertranGamesStack", {
  domainName,
  alternateDomainNames,
  env: { account, region: "ap-southeast-2" },
});
// Separate service from the resume site above - own table, own Lambda, own
// Function URL, own schema. See infra/lib/pantry-stack.ts for why.
const pantryStack = new PantryStack(app, "PetertranPantryStack", {
  domainName,
  alternateDomainNames,
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

// Keeps every project's Lambda warm on a schedule - deliberately its own
// stack, deployed last since it references the Lambdas the stacks above
// already exposed. See infra/lib/warmup-stack.ts.
new WarmupStack(app, "PetertranWarmupStack", {
  domainName,
  alternateDomainNames,
  portfolioFn: siteStack.apiFn,
  pantryFn: pantryStack.apiFn,
  imposterFn: gamesStack.imposterFn,
  zeroTrustLabFns: {
    idpBridge: zeroTrustLabStack.idpBridgeFn,
    internalSts: zeroTrustLabStack.internalStsFn,
    edgeAuthorizer: zeroTrustLabStack.edgeAuthorizerFn,
    edgeProxy: zeroTrustLabStack.edgeProxyFn,
    domainA: zeroTrustLabStack.domainAFn,
  },
  env: { account, region: "ap-southeast-2" },
});
