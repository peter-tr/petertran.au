import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "node:path";
import { LIVE_ALIAS_NAME } from "./shared/function-names";

// Same graph across prod and the on-demand test env - GraphOS has no notion
// of "environment" beyond variants, and this graph only has one ("current").
// Test-env Router traffic reports into the same Studio metrics as prod as a
// result; not split into a second variant since the test env is ephemeral and
// low-traffic, and doesn't warrant its own Studio variant yet.
const APOLLO_GRAPH_REF = "petertran-au@current";

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

    const apolloKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ApolloKey",
      "petertran-au/apollo-key"
    );

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
      // 1024, up from 256 (2026-07-24) - a cold trace outside the
      // ProvisionedConcurrencyStack warm window showed this Lambda's own
      // ~767ms Apollo Router "Init" span (apollo-router's embedded Rust
      // telemetry, not Lambda's own cold-start phase) plus the surrounding
      // module-load cost, both of which scale with memory the same as
      // everything else.
      memorySize: 1024,
      // Generous - even with the supergraph SDL composed at build time (see
      // scripts/compose-supergraph.ts), every request still fans out to all
      // 3 subgraphs over HTTPS, any of which may itself be a cold Lambda.
      timeout: Duration.seconds(30),
      environment: {
        // router.yaml's override_subgraph_url entries read this via
        // Router's `${env.API_BASE_URL}` config templating.
        API_BASE_URL: props.apiBaseUrl,
        AWS_LWA_PORT: "8080",
        // Router auto-detects these two and starts reporting operation
        // metrics/errors/traces to GraphOS Studio - this is independent of
        // where the supergraph schema itself comes from, so it doesn't
        // reintroduce the live-composition-on-cold-start cost that the
        // build-time offline composition above was written to eliminate:
        // --supergraph in bootstrap (see build-router-package.ts) still
        // wins for schema source, this only turns on usage reporting.
        // Resolved into a plain env var at deploy time via CloudFormation's
        // dynamic reference, same as ANTHROPIC_API_KEY elsewhere (see
        // site-stack.ts) - no Secrets Manager call at Lambda runtime.
        APOLLO_KEY: apolloKeySecret.secretValue.unsafeUnwrap(),
        APOLLO_GRAPH_REF,
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
        // No ADOT collector layer (removed 2026-07-27, see git history for
        // the PR that added it) - provided.al2023 gets zero automatic X-Ray
        // instrumentation, so that layer existed purely to receive Router's
        // own OTLP-exported spans and forward them to X-Ray. Real cold-start
        // measurement found it cost ~170-400ms of Init Duration (isolated on
        // a scratch Lambda ladder: Router+LWA alone vs +ADOT, both with the
        // real composed schema) for a span that, in a real production trace,
        // covered ~11ms of query planning - the span it exists to show costs
        // less time than loading the extension that reports it. Confirmed
        // directly via a real X-Ray trace that dropping this layer does NOT
        // break trace connectivity to subgraphs (portfolio-graphql-test/
        // imposter-graphql-test still appear under the same trace ID) -
        // router.yaml's telemetry.exporters.tracing.propagation.aws_xray
        // handles header propagation on its own, independent of whether
        // anything is actually receiving/exporting Router's own spans. What's
        // lost is only Router's own internal span (query_planning/
        // compute_job timing) - not worth the fixed per-cold-start cost on
        // this project's traffic volume.
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
