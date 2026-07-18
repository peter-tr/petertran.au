const CLARITY_PROJECT_ID = "xod37pzsds";

declare global {
  interface Window {
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
  }
}

/**
 * No-ops outside production builds, same as initRum, so local dev sessions
 * never pollute Clarity's recordings/heatmaps.
 */
export function initClarity(): void {
  if (!import.meta.env.PROD) return;

  try {
    if (!window.clarity) {
      const clarity: Window["clarity"] = (...args: unknown[]) => {
        (clarity!.q = clarity!.q || []).push(args);
      };
      window.clarity = clarity;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
    document.head.appendChild(script);
  } catch {
    // Ignore errors thrown during Microsoft Clarity initialization
  }
}
