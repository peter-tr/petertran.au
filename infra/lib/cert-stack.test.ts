import { describe, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { CertStack } from "./cert-stack";

describe("CertStack", () => {
  it("synthesizes with a single ACM certificate covering the primary + alternate domains", () => {
    const app = new App();
    const stack = new CertStack(app, "TestCertStack", {
      domainName: "www.example.com",
      alternateDomainNames: ["example.com"],
      env: { account: "123456789012", region: "us-east-1" },
      crossRegionReferences: true,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "www.example.com",
      SubjectAlternativeNames: ["example.com"],
    });
    // No hostedZoneId/hostedZoneName given - stays on prod's manual
    // fromDns() validation, which leaves DomainValidationOptions unset
    // entirely (nothing to auto-manage without a zone to write CNAMEs to).
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainValidationOptions: Match.absent(),
    });
  });

  it("validates automatically via the hosted zone when hostedZoneId/hostedZoneName are given", () => {
    const app = new App();
    const stack = new CertStack(app, "TestCertStack", {
      domainName: "test.example.com",
      alternateDomainNames: ["www.test.example.com"],
      hostedZoneId: "Z0000000000000EXAMPLE",
      hostedZoneName: "example.com",
      env: { account: "123456789012", region: "us-east-1" },
      crossRegionReferences: true,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainValidationOptions: Match.arrayWith([
        Match.objectLike({ DomainName: "test.example.com", HostedZoneId: "Z0000000000000EXAMPLE" }),
        Match.objectLike({ DomainName: "www.test.example.com", HostedZoneId: "Z0000000000000EXAMPLE" }),
      ]),
    });
  });
});
