import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export interface CertStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
}

/**
 * Separate stack so it can be deployed first and left to validate
 * (DNS records must be added at the registrar) before SiteStack
 * references the now-issued certificate.
 */
export class CertStack extends Stack {
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    this.certificate = new acm.Certificate(this, "SiteCertificate", {
      domainName: props.domainName,
      subjectAlternativeNames: props.alternateDomainNames,
      validation: acm.CertificateValidation.fromDns(),
    });

    new CfnOutput(this, "CertificateArn", { value: this.certificate.certificateArn });
  }
}
