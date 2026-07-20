import { CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export interface SiteCertificateProps {
  certificateId: string;
  outputId: string;
  domainName: string;
  alternateDomainNames?: string[];
  validation: acm.CertificateValidation;
}

// Shared shape behind CertStack and TestCertStack - an ACM certificate plus
// its ARN as a stack output. What differs between them (domain name, DNS
// validation strategy, construct ids) stays a parameter here rather than
// forking this into two near-identical stacks.
export function createSiteCertificate(scope: Construct, props: SiteCertificateProps): acm.Certificate {
  const certificate = new acm.Certificate(scope, props.certificateId, {
    domainName: props.domainName,
    subjectAlternativeNames: props.alternateDomainNames,
    validation: props.validation,
  });

  new CfnOutput(scope, props.outputId, { value: certificate.certificateArn });

  return certificate;
}
