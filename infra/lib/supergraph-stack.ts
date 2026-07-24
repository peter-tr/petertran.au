import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { LIVE_ALIAS_NAME } from "./shared/function-names";

export interface SupergraphStackProps extends StackProps {
  functionName: string;
  apiBaseUrl: string;
}

/**
 * Apollo Federation gateway composing portfolio/pantry/imposter's deployed
 * GraphQL subgraphs into one endpoint. Stateless - no table, no schedule -
 * so unlike PantryStack/GamesStack this has no isTestEnv-guarded branches,
 * just a single Lambda + its `live` alias. No IAM grants: the gateway talks
 * to the other subgraphs over their existing public HTTPS routes (see
 * apiBaseUrl), not direct Lambda invoke, so it has zero live CloudFormation
 * coupling to the stacks it depends on functionally - same "plain strings,
 * no live cross-stack refs" reasoning as ProvisionedConcurrencyStack.
 *
 * Instantiated twice (see infra/bin/app.ts) - once for prod
 * (api.petertran.au/graphql) and once for the on-demand test env
 * (api.test.petertran.au/graphql) - functionName/apiBaseUrl are required
 * rather than defaulted since both callers always pass their own.
 */
export class SupergraphStack extends Stack {
  public readonly gatewayFn: lambda.Function;

  constructor(scope: Construct, id: string, props: SupergraphStackProps) {
    super(scope, id, props);

    const gatewayFn = new lambda.Function(this, "SupergraphGatewayFunction", {
      functionName: props.functionName,
      // Apollo Router (Rust), not the Node @apollo/gateway this replaced -
      // deployed as a provided.al2023 custom runtime via AWS's own Lambda
      // Web Adapter, following their official rust-axum-zip example exactly
      // (Handler: bootstrap, this same layer ARN). Verified directly against
      // a real Lambda before this change: GLIBC 2.29 required vs. AL2023's
      // 2.34, and real cold-start Init Duration of ~380-436ms vs. the Node
      // gateway's ~1160-1245ms. See scripts/build-router-package.ts for how
      // dist/ (bootstrap + router binary + router.yaml + composed SDL) gets
      // assembled.
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: "bootstrap",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/supergraph/dist")),
      memorySize: 256,
      // Generous - even with the supergraph SDL composed at build time (see
      // scripts/compose-supergraph.ts), every request still fans out to all
      // 3 subgraphs over HTTPS, any of which may itself be a cold Lambda.
      timeout: Duration.seconds(30),
      environment: {
        // router.yaml's override_subgraph_url entries read this via
        // Router's `${env.API_BASE_URL}` config templating.
        API_BASE_URL: props.apiBaseUrl,
        AWS_LWA_PORT: "8080",
      },
      tracing: lambda.Tracing.ACTIVE,
      layers: [
        // AWS's own published Lambda Web Adapter layer - proxies the
        // Lambda Runtime API to an HTTP request against Router listening on
        // AWS_LWA_PORT, translating the response back into the standard
        // Lambda-proxy shape ApiGatewayStack's LambdaIntegration expects.
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "LambdaAdapterLayer",
          `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:28`
        ),
      ],
    });
    this.gatewayFn = gatewayFn;

    // Qualifier ApiGatewayStack routes real traffic to - see
    // LIVE_ALIAS_NAME's doc comment.
    new lambda.Alias(this, "LiveAlias", {
      aliasName: LIVE_ALIAS_NAME,
      version: gatewayFn.currentVersion,
    });
  }
}
