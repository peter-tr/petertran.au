import { describe, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
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
  });
});
