#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { CertStack } from "../lib/cert-stack";
import { SiteStack } from "../lib/site-stack";
import { GamesStack } from "../lib/games-stack";

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
new SiteStack(app, "PetertranSiteStack", {
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
new GamesStack(app, "PetertranGamesStack", {
  domainName,
  alternateDomainNames,
  env: { account, region: "ap-southeast-2" },
});
