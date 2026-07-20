import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";

export interface TestCertStackProps extends StackProps {
  hostedZoneId: string;
  hostedZoneName: string;
}

/**
 * Separate stack (us-east-1, same CloudFront requirement as CertStack) for the
 * on-demand test environment's web cert. Unlike CertStack's cert - validated
 * manually because it predates the hosted zone being importable this way -
 * this one imports the zone directly, so CDK auto-manages the validation
 * CNAME with no manual step.
 */
export class TestCertStack extends Stack {
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: TestCertStackProps) {
    super(scope, id, props);

    const hostedZone = route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, "PetertranHostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    this.certificate = new acm.Certificate(this, "TestSiteCertificate", {
      domainName: `test.${props.hostedZoneName}`,
      // Mirrors prod's www+apex coverage (CertStack's domainName/alternateDomainNames) -
      // without this, www.test.petertran.au has no cert SAN and fails TLS
      // even once DNS resolves it.
      subjectAlternativeNames: [`www.test.${props.hostedZoneName}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    new CfnOutput(this, "TestCertificateArn", { value: this.certificate.certificateArn });
  }
}
