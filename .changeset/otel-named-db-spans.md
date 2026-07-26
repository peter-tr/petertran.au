---
"api-shared": patch
"pantry": patch
---

add named OTel spans around the rate-limit check and pantry's DynamoDB calls

Application Signals' automatic `aws-sdk` instrumentation only produces a generic `dynamodb.<region>.amazonaws.com:443` span for every DynamoDB call, with no operation or table info surfacing in the trace - real X-Ray traces confirmed a guarded pantry mutation shows several indistinguishable DynamoDB spans, so telling the rate-limit check's `UpdateItem` apart from the resolver's own reads/writes required inferring from call order and timing rather than just reading the trace. `api-shared/tracing`'s new `traceSpan()` wraps a piece of work in a real span via `@opentelemetry/api`'s `trace.getTracer().startActiveSpan()` (safe with no exporter registered, e.g. local dev - unlike the classic X-Ray SDK's `traced()`, no environment guard is needed). The shared rate limiter (`rate-limit-check`, used by pantry/portfolio/imposter) and pantry's `DynamoRepository`/`settings`/`price-sync-status` now use it, so future traces name each call directly (e.g. `ITEM.put`, `SHOPLIST.get`, `settings.get`).
