// Recognized by every project's Lambda handler (portfolio, pantry, imposter,
// zero-trust-lab) as a scheduled keep-warm ping, not a real request -
// each handler checks this first and returns immediately, before running
// any real resolver/KMS/DynamoDB/Cognito work. See infra/lib/shared/
// warmup-schedule.ts for what sends this payload.
export interface WarmupPing {
  warmup: true;
}

export function isWarmupPing(event: unknown): event is WarmupPing {
  return typeof event === "object" && event !== null && (event as { warmup?: unknown }).warmup === true;
}
