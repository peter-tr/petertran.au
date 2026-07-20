import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { createSiteCertificate } from "./shared/site-certificate";

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

    this.certificate = createSiteCertificate(this, {
      certificateId: "SiteCertificate",
      outputId: "CertificateArn",
      domainName: props.domainName,
      alternateDomainNames: props.alternateDomainNames,
      validation: acm.CertificateValidation.fromDns(),
    });
  }
}
