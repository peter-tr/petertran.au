interface IpApiResponse {
  status: "success" | "fail";
  city?: string;
  regionName?: string;
  country?: string;
}

const PRIVATE_IP_PATTERN = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc00:|fe80:)/;

// Best-effort, no-API-key IP geolocation for the contact-form email - never
// blocks or fails the mutation itself (see the try/catch around its call
// site), so a slow or unreachable geolocation service just means the email
// arrives without a location line. ip-api.com's free tier doesn't offer
// HTTPS (only paid plans do) - acceptable here since this is a server-to-
// server lookup of a public IP address, not a browser request or anything
// carrying real secrets.
export async function getLocationForIp(ip: string | undefined): Promise<string | null> {
  if (!ip || PRIVATE_IP_PATTERN.test(ip)) return null;

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;

    const data = (await res.json()) as IpApiResponse;
    if (data.status !== "success") return null;

    return [data.city, data.regionName, data.country].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}
