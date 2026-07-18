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
      // aws-rum-web's own default config pre-populates `endpoint` to the
      // us-west-2 dataplane URL, and that populated value wins over the
      // `region` constructor arg during its internal config merge unless
      // overridden explicitly here - passing `region` alone silently sends
      // every event to the wrong region (403s, since the guest role/app
      // monitor only exist in ap-southeast-2).
      endpoint: `https://dataplane.rum.${REGION}.amazonaws.com`,
    };
    new AwsRum(applicationId, APPLICATION_VERSION, REGION, config);
  } catch {
    // Ignore errors thrown during CloudWatch RUM web client initialization
  }
}
