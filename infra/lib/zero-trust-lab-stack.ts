import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import {
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
  HttpJwtAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as path from "path";
import { FUNCTION_NAMES } from "./shared/function-names";

export interface ZeroTrustLabStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
}

/**
 * Personal learning exercise: edge gateway -> internal STS -> domain
 * gateway, with an opaque token at the edge exchanged for a short-lived,
 * audience-scoped JWT. Deliberately isolated - own table, own Lambdas, own
 * HttpApis - so it can be poked at and torn down without touching the real
 * site/pantry/games stacks. See infra/../../plans/buzzing-herding-willow.md
 * (or the PR description) for the full design writeup.
 *
 * Keep-warm scheduling for this stack's Lambdas lives in PetertranWarmupStack,
 * not here - warming is an operational/cost concern that applies equally to
 * portfolio/pantry/imposter's Lambdas, not something specific to the
 * zero-trust/token-exchange pattern this stack exists to teach.
 */
export class ZeroTrustLabStack extends Stack {
  // Exposed so PetertranWarmupStack can schedule a keep-warm ping against
  // each of them without this stack needing to know anything about warmup.
  public readonly idpBridgeFn: lambda.Function;
  public readonly internalStsFn: lambda.Function;
  public readonly edgeAuthorizerFn: lambda.Function;
  public readonly edgeProxyFn: lambda.Function;
  public readonly domainAFn: lambda.Function;

  constructor(scope: Construct, id: string, props: ZeroTrustLabStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "ZeroTrustSessionsTable", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name.
      tableName: "ztl-sessions",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // RSA, not EC - see lib/jwt.ts for why (KMS's RSA signature bytes are
    // usable as a JWS signature directly, no DER->raw conversion needed).
    const signingKey = new kms.Key(this, "JwtSigningKey", {
      description: "Zero-trust-lab: signs/verifies the internal JWTs InternalSts issues",
      keySpec: kms.KeySpec.RSA_2048,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Alias is a separate resource, not a property of the key itself - adding
    // one doesn't touch the key, so it's a purely additive way to make it
    // read clearly in the KMS console instead of by its bare key ID.
    signingKey.addAlias("ztl-jwt-signing");

    // --- IdpBridge: real external identity (Cognito) -> this lab's opaque token ---
    const idpBridgeFn = new lambda.Function(this, "IdpBridgeFunction", {
      // Fixed - see site-stack.ts's identical comment on GraphQLFunction for
      // why (avoids a CloudFormation cross-stack export lock with WarmupStack).
      functionName: FUNCTION_NAMES.ztlIdpBridge,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "zero-trust-lab/idp-bridge/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName },
      // Traces every invocation to X-Ray, same as portfolio/pantry/imposter -
      // lets the edge -> IdpBridge -> Cognito hop show up in the trace map.
      tracing: lambda.Tracing.ACTIVE,
    });
    table.grantReadWriteData(idpBridgeFn);
    this.idpBridgeFn = idpBridgeFn;

    const idpBridgeFnUrl = idpBridgeFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // Cognito User Pool + Hosted UI is the actual external IdP - real
    // password storage and a ready-made login page, so nothing here hand-
    // rolls credential handling. Plain username (not email) sign-in and a
    // relaxed password policy - this is a single-user personal lab, not
    // something that needs Cognito's default complexity requirements.
    // signInAliases (via UsernameAttributes) is immutable - CloudFormation
    // rejects an in-place update outright ("Updates are not allowed for
    // property - UsernameAttributes"), it's not just a replacement CDK can
    // orchestrate automatically. Forced by renaming this construct's id
    // (ZeroTrustUserPool -> ZeroTrustUserPoolV2), which changes the logical
    // ID and makes CloudFormation create a new Pool/Domain/Client and delete
    // the old ones, rather than trying to update in place. domainPrefix
    // below is a fresh string so the new Domain doesn't collide with the
    // old one still existing mid-replacement.
    const userPool = new cognito.UserPool(this, "ZeroTrustUserPoolV2", {
      // Explicit, so it reads clearly in the Cognito console instead of
      // CloudFormation's auto-generated name. Safe to add without a
      // replacement - unlike UsernameAttributes, UserPoolName updates in place.
      userPoolName: "ztl-users",
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      passwordPolicy: {
        // 6 is Cognito's hard floor for minLength - can't go lower even with
        // every complexity requirement disabled.
        minLength: 6,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPoolDomain = userPool.addDomain("ZeroTrustUserPoolDomain", {
      cognitoDomain: { domainPrefix: `petertran-ztl2-${this.account}` },
    });

    const userPoolClient = userPool.addClient("ZeroTrustUserPoolClient", {
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID],
        callbackUrls: [`${idpBridgeFnUrl.url}callback`],
      },
    });

    // COGNITO_DOMAIN is safe to wire directly - UserPoolDomain only depends
    // on userPool, never on idpBridgeFn, so this is a one-way reference.
    idpBridgeFn.addEnvironment(
      "COGNITO_DOMAIN",
      `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`
    );

    // Deliberately NOT wiring COGNITO_CLIENT_ID/SECRET or CALLBACK_URL as env
    // vars here - that would create a real CloudFormation circular
    // dependency: UserPoolClient.callbackUrls already depends on
    // idpBridgeFnUrl (below), so if idpBridgeFn's own properties then
    // depended on userPoolClient, CloudFormation would need both resources
    // to exist before either could be created. Same problem for CALLBACK_URL
    // referencing the function's own Function URL (FunctionUrl depends on
    // the Function; the Function's env can't depend back on FunctionUrl).
    // Fix: idpBridgeFn only takes USER_POOL_ID (one-way, safe) and looks up
    // its own app client's id/secret via the Cognito API at runtime, and
    // derives its own callback URL from the incoming request's domainName -
    // see idp-bridge/handler.ts.
    idpBridgeFn.addEnvironment("USER_POOL_ID", userPool.userPoolId);
    idpBridgeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:ListUserPoolClients", "cognito-idp:DescribeUserPoolClient"],
        resources: [userPool.userPoolArn],
      })
    );

    // --- InternalSts: the actual token-exchange / signing service ---
    const internalStsFn = new lambda.Function(this, "InternalStsFunction", {
      functionName: FUNCTION_NAMES.ztlInternalSts,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "zero-trust-lab/internal-sts/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { KMS_KEY_ID: signingKey.keyId },
      tracing: lambda.Tracing.ACTIVE,
    });
    signingKey.grantSign(internalStsFn);
    signingKey.grant(internalStsFn, "kms:GetPublicKey");
    this.internalStsFn = internalStsFn;

    const internalStsFnUrl = internalStsFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    // No ISSUER_URL env var here, deliberately - same self-reference problem
    // as CALLBACK_URL above (a Function can't depend on its own FunctionUrl).
    // For JWKS/discovery requests (which go through the Function URL),
    // internal-sts/handler.ts derives the issuer from the incoming request's
    // own event.requestContext.domainName. For the direct-invoke exchange
    // path (no requestContext), the caller (EdgeAuthorizerFunction) passes
    // the issuer explicitly - it already has a safe, one-way reference to
    // internalStsFnUrl.url below.

    // --- Edge gateway ---
    const edgeAuthorizerFn = new lambda.Function(this, "EdgeAuthorizerFunction", {
      functionName: FUNCTION_NAMES.ztlEdgeAuthorizer,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "zero-trust-lab/edge/authorizer.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        IDP_BRIDGE_URL: idpBridgeFnUrl.url,
        INTERNAL_STS_FUNCTION_NAME: internalStsFn.functionName,
        // One-way reference (EdgeAuthorizerFunction -> InternalStsFunction's
        // FunctionUrl) - safe, since InternalStsFunction's own properties
        // never reference EdgeAuthorizerFunction back. Passed through to
        // InternalSts's direct-invoke exchange payload as `issuer`.
        INTERNAL_STS_ISSUER_URL: internalStsFnUrl.url,
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    // Direct Lambda Invoke, IAM-gated - the exchange call never goes over
    // the network. See the plan doc for why this is tighter than exposing
    // InternalSts's exchange operation as another public endpoint.
    internalStsFn.grantInvoke(edgeAuthorizerFn);
    this.edgeAuthorizerFn = edgeAuthorizerFn;

    const edgeProxyFn = new lambda.Function(this, "EdgeProxyFunction", {
      functionName: FUNCTION_NAMES.ztlEdgeProxy,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "zero-trust-lab/edge/proxy.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
    });
    this.edgeProxyFn = edgeProxyFn;

    const edgeAuthorizer = new HttpLambdaAuthorizer("EdgeLambdaAuthorizer", edgeAuthorizerFn, {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      identitySource: ["$request.header.Authorization"],
      resultsCacheTtl: Duration.seconds(0), // always re-verify, no caching in this lab
    });

    const edgeApi = new apigwv2.HttpApi(this, "EdgeHttpApi");
    edgeApi.addRoutes({
      path: "/domain-a/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration("EdgeProxyIntegration", edgeProxyFn),
      authorizer: edgeAuthorizer,
    });
    // Phase 2 (stretch): add a matching "/domain-b/{proxy+}" route once
    // Domain-B's HttpApi exists, to prove the audience-restriction rejection.

    // --- Domain-A gateway ---
    const domainAFn = new lambda.Function(this, "DomainAFunction", {
      functionName: FUNCTION_NAMES.ztlDomainA,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "zero-trust-lab/domain-a/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 128,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
    });
    this.domainAFn = domainAFn;

    const domainAApi = new apigwv2.HttpApi(this, "DomainAHttpApi");
    domainAApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration("DomainAIntegration", domainAFn),
      // No Lambda here - HTTP API validates signature/iss/aud/exp natively
      // against InternalSts's JWKS. This is the "domain gateway never talks
      // to the external IdP, only to the internal signer" property in
      // action.
      authorizer: new HttpJwtAuthorizer("DomainAJwtAuthorizer", internalStsFnUrl.url, {
        jwtAudience: ["domain-a"],
      }),
    });

    edgeProxyFn.addEnvironment("DOMAIN_A_URL", domainAApi.apiEndpoint);

    new CfnOutput(this, "HostedUiLoginUrl", {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/login?client_id=${userPoolClient.userPoolClientId}&response_type=code&scope=openid&redirect_uri=${idpBridgeFnUrl.url}callback`,
    });
    new CfnOutput(this, "IdpBridgeUrl", { value: idpBridgeFnUrl.url });
    new CfnOutput(this, "InternalStsUrl", { value: internalStsFnUrl.url });
    new CfnOutput(this, "EdgeApiUrl", { value: edgeApi.apiEndpoint });
    new CfnOutput(this, "DomainAApiUrl", { value: domainAApi.apiEndpoint });
  }
}
