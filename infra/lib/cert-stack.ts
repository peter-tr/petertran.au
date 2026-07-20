import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";

export interface CertStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
  // If given, the cert validates itself automatically via a DNS CNAME added
  // straight to this hosted zone - used by the on-demand test environment,
  // whose domain doesn't have a validated cert yet at deploy time and can't
  // wait on a manual step. Prod's cert predates the hosted zone being
  // importable this way (see below) and stays on manual validation when
  // these are omitted - switching it now would mean re-validating (and
  // risking replacement of) an already-issued certificate CloudFront is
  // actively using.
  hostedZoneId?: string;
  hostedZoneName?: string;
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

    const validation =
      props.hostedZoneId && props.hostedZoneName
        ? acm.CertificateValidation.fromDns(
            route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, "PetertranHostedZone", {
              hostedZoneId: props.hostedZoneId,
              zoneName: props.hostedZoneName,
            })
          )
        : acm.CertificateValidation.fromDns();

    this.certificate = new acm.Certificate(this, "SiteCertificate", {
      domainName: props.domainName,
      subjectAlternativeNames: props.alternateDomainNames,
      validation,
    });

    new CfnOutput(this, "CertificateArn", { value: this.certificate.certificateArn });
  }
}
