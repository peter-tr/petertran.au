import Clarity from "@microsoft/clarity";

const CLARITY_PROJECT_ID = "xod37pzsds";

/**
 * No-ops outside production builds, same as initRum, so local dev sessions
 * never pollute Clarity's recordings/heatmaps.
 */
export function initClarity(): void {
  if (!import.meta.env.PROD) return;
  Clarity.init(CLARITY_PROJECT_ID);
}
