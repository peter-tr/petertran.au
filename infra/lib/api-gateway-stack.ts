import { Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { LIVE_ALIAS_NAME, liveAliasArn } from "./shared/function-names";

export interface ApiGatewayStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
  hostedZoneId: string;
  hostedZoneName: string;
  // Plain function *names* (not live lambda.IFunction references) - same
  // reasoning as WarmupStack (see its doc comment): a live reference passed
  // cross-stack becomes a CloudFormation export that blocks the producing
  // stack from ever replacing that Lambda for as long as this stack has it
  // imported.
  portfolioFnName: string;
  pantryFnName: string;
  imposterFnName: string;
  warmupConfigFnName: string;
  pcConfigFnName: string;
}

/**
 * Single shared HttpApi in front of portfolio/pantry/imposter/warmup-config/
 * pc-config, replacing their individual Lambda Function URLs with one
 * stable, human-readable domain (api.petertran.au) - so web/.env.production
 * never needs to track a CloudFormation-generated URL again. Deliberately
 * does NOT cover zero-trust-lab's own edge/domain gateways - those stay
 * isolated per that stack's own design intent (see zero-trust-lab-stack.ts).
 */
export class ApiGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    const hostedZone = route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, "PetertranHostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    const apiDomain = `api.${props.hostedZoneName}`;

    // Unlike CertStack's cert (validated manually - no zone passed to
    // fromDns), this one imports the zone directly, so CDK auto-manages the
    // validation CNAME with no manual step.
    const apiCertificate = new acm.Certificate(this, "ApiCertificate", {
      domainName: apiDomain,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const apiDomainName = new apigwv2.DomainName(this, "ApiDomainName", {
      domainName: apiDomain,
      certificate: apiCertificate,
    });

    const httpApi = new apigwv2.HttpApi(this, "ApiGateway", {
      defaultDomainMapping: { domainName: apiDomainName },
      corsPreflight: {
        allowOrigins: [
          `https://${props.domainName}`,
          ...(props.alternateDomainNames ?? []).map((d) => `https://${d}`),
          "http://localhost:5173",
          "http://localhost:3000",
        ],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ["content-type", "apollo-require-preflight"],
        maxAge: Duration.hours(1),
      },
    });

    // Exact-path routes, not `{proxy+}` - portfolio/pantry/imposter/warmup/
    // pc-config are each single-endpoint Apollo/JSON services, never called
    // with a sub-path (see web/src/shared/graphqlClient.ts and
    // useWarmupSchedule.ts).
    //
    // portfolio/pantry/imposter carry `aliasName: LIVE_ALIAS_NAME` so real
    // traffic actually lands on the qualifier ProvisionedConcurrencyStack
    // applies Provisioned Concurrency to - see pc-config-stack.ts's doc
    // comment. warmup/pc-config have no alias, bare $LATEST, unaffected.
    const routes: { id: string; path: string; functionName: string; aliasName?: string }[] = [
      {
        id: "Portfolio",
        path: "/portfolio",
        functionName: props.portfolioFnName,
        aliasName: LIVE_ALIAS_NAME,
      },
      { id: "Pantry", path: "/pantry", functionName: props.pantryFnName, aliasName: LIVE_ALIAS_NAME },
      { id: "Imposter", path: "/imposter", functionName: props.imposterFnName, aliasName: LIVE_ALIAS_NAME },
      { id: "Warmup", path: "/warmup", functionName: props.warmupConfigFnName },
      { id: "PcConfig", path: "/pc-config", functionName: props.pcConfigFnName },
    ];

    for (const route of routes) {
      const targetFn = route.aliasName
        ? lambda.Function.fromFunctionAttributes(this, `${route.id}Alias`, {
            functionArn: liveAliasArn(this.region, this.account, route.functionName),
            sameEnvironment: true,
          })
        : lambda.Function.fromFunctionName(this, `${route.id}Fn`, route.functionName);
      httpApi.addRoutes({
        path: route.path,
        // GET/POST, not ANY - ANY also matches OPTIONS, which would route
        // the browser's CORS preflight request to the Lambda instead of
        // letting the HttpApi's own corsPreflight config auto-answer it.
        // Apollo's CSRF-prevention plugin then rejects that bare OPTIONS
        // request with a 400, which browsers treat as a failed preflight -
        // blocking every real request with a CORS error.
        methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
        integration: new HttpLambdaIntegration(`${route.id}Integration`, targetFn),
      });
    }

    const aliasTarget = route53.RecordTarget.fromAlias(
      new route53Targets.ApiGatewayv2DomainProperties(
        apiDomainName.regionalDomainName,
        apiDomainName.regionalHostedZoneId
      )
    );
    new route53.ARecord(this, "ApiAliasRecordV4", {
      zone: hostedZone,
      recordName: "api",
      target: aliasTarget,
    });
    new route53.AaaaRecord(this, "ApiAliasRecordV6", {
      zone: hostedZone,
      recordName: "api",
      target: aliasTarget,
    });

    new CfnOutput(this, "ApiBaseUrl", { value: `https://${apiDomain}` });
  }
}
