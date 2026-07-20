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
 * no live cross-stack refs" reasoning as WarmupStack/ProvisionedConcurrencyStack.
 *
 * Test-env only for now (see infra/bin/app.ts) - functionName/apiBaseUrl are
 * required rather than optional-with-a-prod-fallback since there's only one
 * caller today.
 */
export class SupergraphStack extends Stack {
  public readonly gatewayFn: lambda.Function;

  constructor(scope: Construct, id: string, props: SupergraphStackProps) {
    super(scope, id, props);

    const gatewayFn = new lambda.Function(this, "SupergraphGatewayFunction", {
      functionName: props.functionName,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/supergraph/dist")),
      memorySize: 256,
      // Generous - cold start means IntrospectAndCompose fetching all 3
      // subgraphs' SDL in parallel over HTTPS, each of which may itself be
      // a cold Lambda, before the gateway can serve its first request.
      timeout: Duration.seconds(30),
      environment: {
        API_BASE_URL: props.apiBaseUrl,
      },
      tracing: lambda.Tracing.ACTIVE,
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
