import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyChecksum, buildRouterYaml } from "./build-router-package";

describe("verifyChecksum", () => {
  it("returns the hash when it matches the sha256sums.txt entry", () => {
    const artifactBuf = Buffer.from("fake router binary contents");
    const artifactName = "router-v1.61.1-x86_64-unknown-linux-gnu.tar.gz";
    const hash = createHash("sha256").update(artifactBuf).digest("hex");
    const sumsText = `${hash}  ${artifactName}\nsomeotherhash  some-other-file.tar.gz\n`;

    expect(verifyChecksum(artifactBuf, sumsText, artifactName)).toBe(hash);
  });

  it("throws on a hash mismatch instead of silently continuing", () => {
    const artifactBuf = Buffer.from("fake router binary contents");
    const artifactName = "router-v1.61.1-x86_64-unknown-linux-gnu.tar.gz";
    const sumsText = `0000000000000000000000000000000000000000000000000000000000000000  ${artifactName}\n`;

    expect(() => verifyChecksum(artifactBuf, sumsText, artifactName)).toThrow("sha256 mismatch");
  });

  it("throws when sha256sums.txt has no entry for the artifact", () => {
    const artifactBuf = Buffer.from("fake router binary contents");
    const artifactName = "router-v1.61.1-x86_64-unknown-linux-gnu.tar.gz";
    const sumsText = "somehash  some-unrelated-file.tar.gz\n";

    expect(() => verifyChecksum(artifactBuf, sumsText, artifactName)).toThrow(
      "no sha256sums.txt entry found"
    );
  });
});

describe("buildRouterYaml", () => {
  const yaml = buildRouterYaml(["portfolio", "pantry", "imposter", "design-studio"]);

  it("routes each subgraph name to API_BASE_URL via env templating", () => {
    expect(yaml).toContain("portfolio: ${env.API_BASE_URL}/portfolio");
    expect(yaml).toContain("pantry: ${env.API_BASE_URL}/pantry");
    expect(yaml).toContain("imposter: ${env.API_BASE_URL}/imposter");
    expect(yaml).toContain("design-studio: ${env.API_BASE_URL}/design-studio");
  });

  it("propagates the authorization header to subgraphs", () => {
    expect(yaml).toContain('named: "authorization"');
  });

  it("allows CORS from prod, test-env, and local dev origins on the actual response", () => {
    // Regression test: API Gateway's mock integration only answers the
    // OPTIONS preflight - it does not add CORS headers to the actual
    // GET/POST response, so without this config every browser (not curl)
    // silently discards every real response.
    expect(yaml).toContain("cors:");
    expect(yaml).toContain("https://www.petertran.au");
    expect(yaml).toContain("https://petertran.au");
    expect(yaml).toContain("https://test.petertran.au");
    expect(yaml).toContain("https://www.test.petertran.au");
    expect(yaml).toContain("http://localhost:5173");
    expect(yaml).toContain("http://localhost:3000");
  });

  it("serves GraphQL at /graphql to match ApiGatewayStack's routing", () => {
    expect(yaml).toContain("path: /graphql");
  });

  it("exports traces via OTLP to the local ADOT collector with X-Ray propagation", () => {
    // provided.al2023 gets no automatic X-Ray instrumentation - this is
    // what actually gets traces to X-Ray at all (verified against a real
    // Lambda: zero traces without this, connected traces with it).
    expect(yaml).toContain("otlp:");
    expect(yaml).toContain("endpoint: http://localhost:4317");
    expect(yaml).toContain("aws_xray: true");
    expect(yaml).toContain("sampler: 1.0");
  });

  it("flushes trace spans almost immediately, not on the 5s default", () => {
    // Regression test: confirmed directly against a real Lambda that the
    // 5s default batch flush interval is longer than a fast invocation
    // survives before the execution environment freezes - spans never
    // left Router's buffer at all, so no trace ever reached X-Ray.
    expect(yaml).toContain("scheduled_delay: 1ms");
  });

  it("names the trace service instead of leaving it as OTel's unknown_service fallback", () => {
    // Without a service name, OTel defaults to "unknown_service:<binary
    // name>" - confirmed literally appearing as "unknown_service:router" in
    // ADOT collector logs before this. Sets both service_name and
    // resource["service.name"] since a real-Lambda spike couldn't
    // conclusively confirm which one the awsxrayexporter reads - X-Ray's
    // batch-get-traces never returned Router's own OTel-originated segment
    // to check directly. Cosmetic and confirmed low-risk either way.
    expect(yaml).toContain('service_name: "supergraph"');
    expect(yaml).toContain('service.name: "supergraph"');
  });

  it("enables introspection for the dashboard's GraphiQL/schema tooling", () => {
    expect(yaml).toContain("introspection: true");
  });
});
