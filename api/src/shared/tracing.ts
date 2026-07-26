import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("api-shared");

// Named OTel spans around a specific piece of work (a rate-limit check, a
// single DynamoDB call) so a trace shows what actually happened instead of
// the generic "dynamodb.<region>.amazonaws.com:443" span the Application
// Signals layer's aws-sdk auto-instrumentation produces on its own - that
// auto-instrumentation captures HTTP-level detail (method, status) but not
// the DynamoDB operation or table, so two different calls through the same
// client are indistinguishable in a trace without this.
//
// Safe to call anywhere, not just in Lambda: with no SDK/exporter registered
// (e.g. local dev, unit tests) @opentelemetry/api's default no-op tracer
// still runs fn(), it just doesn't record anything - no environment guard
// needed here, unlike xray.ts's traced().
export async function traceSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
