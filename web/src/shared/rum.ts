import { AwsRum, type AwsRumConfig } from "aws-rum-web";

const REGION = "ap-southeast-2";
const APPLICATION_VERSION = "1.0.0";

/**
 * No-ops outside production builds (no APP_MONITOR_ID/IDENTITY_POOL_ID
 * locally) and swallows init errors per AWS's own guidance - a RUM outage
 * or ad-blocker should never be able to break the site itself.
 */
export function initRum(): void {
  const applicationId = import.meta.env.VITE_RUM_APP_MONITOR_ID;
  const identityPoolId = import.meta.env.VITE_RUM_IDENTITY_POOL_ID;
  if (!applicationId || !identityPoolId) return;

  try {
    const config: AwsRumConfig = {
      identityPoolId,
      allowCookies: true,
      sessionSampleRate: 1,
      telemetries: ["errors", "performance", "http"],
    };
    new AwsRum(applicationId, APPLICATION_VERSION, REGION, config);
  } catch {
    // Ignore errors thrown during CloudWatch RUM web client initialization
  }
}
