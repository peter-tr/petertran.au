// Cognito Hosted UI sign-in for pantry - OAuth authorization-code + PKCE,
// no client secret (public SPA client, see infra/lib/pantry-stack.ts).
// Tokens live in localStorage (this app has no other session infra); the
// PKCE verifier only needs to survive the redirect round-trip, so it lives
// in sessionStorage instead. Deliberately doesn't import from ./api.ts
// (which imports getAuthHeader from here) - ensureAccount below uses a raw
// fetch instead of api.ts's runPantryQuery to avoid a circular import.

const COGNITO_DOMAIN = import.meta.env?.VITE_PANTRY_COGNITO_DOMAIN as string | undefined;
const CLIENT_ID = import.meta.env?.VITE_PANTRY_COGNITO_CLIENT_ID as string | undefined;
const GRAPHQL_ENDPOINT = import.meta.env?.VITE_PANTRY_GRAPHQL_ENDPOINT as string | undefined;

const ID_TOKEN_KEY = "pantry_id_token";
const REFRESH_TOKEN_KEY = "pantry_refresh_token";
const EXPIRES_AT_KEY = "pantry_token_expires_at";
const VERIFIER_KEY = "pantry_pkce_verifier";

function redirectUri(): string {
  return `${window.location.origin}/pantry`;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

interface TokenResponse {
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

function storeTokens(tokens: TokenResponse): void {
  localStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
  if (tokens.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  // A minute of slack, so getAuthHeader refreshes ahead of actual expiry
  // rather than sending a token that's already dead by the time the
  // request lands.
  localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + (tokens.expires_in - 60) * 1000));
}

function clearTokens(): void {
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
}

// Redirects away to Cognito's Hosted UI login page - there's no in-app form,
// see CLAUDE.md-adjacent design notes on preferring Cognito's real login
// page over a hand-rolled one.
export async function beginSignIn(): Promise<void> {
  if (!COGNITO_DOMAIN || !CLIENT_ID) return;

  const { verifier, challenge } = await pkcePair();
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const url = new URL(`${COGNITO_DOMAIN}/oauth2/authorize`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  window.location.href = url.toString();
}

export function signOut(): void {
  clearTokens();
  if (!COGNITO_DOMAIN || !CLIENT_ID) {
    window.location.href = "/pantry";

    return;
  }

  const url = new URL(`${COGNITO_DOMAIN}/logout`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("logout_uri", redirectUri());
  window.location.href = url.toString();
}

// Registers the account in pantry's user registry so scheduled jobs
// (digest, price check) know it exists - see
// api/src/pantry/services/users.ts's registerUser. Best-effort: a failure
// here just means those background jobs skip this account until the next
// successful sign-in, not anything the user sees.
async function ensureAccount(): Promise<void> {
  if (!GRAPHQL_ENDPOINT) return;

  const authHeader = await getAuthHeader();
  await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authHeader ? { authorization: authHeader } : {}) },
    body: JSON.stringify({ query: "mutation EnsureAccount { ensureAccount { id email } }" }),
  }).catch(() => undefined);
}

async function exchangeCodeForTokens(code: string): Promise<void> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier || !COGNITO_DOMAIN || !CLIENT_ID) return;
  sessionStorage.removeItem(VERIFIER_KEY);

  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return;

  storeTokens((await res.json()) as TokenResponse);
  await ensureAccount();
}

// Call once, near app start (Pantry.tsx) - a no-op unless the URL has an
// OAuth ?code= from just completing Hosted UI sign-in, in which case it
// exchanges it for tokens and cleans the URL back to a bare /pantry.
export async function completeSignInIfNeeded(): Promise<void> {
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code) return;

  await exchangeCodeForTokens(code);
  window.history.replaceState({}, "", redirectUri());
}

async function refreshIdToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken || !COGNITO_DOMAIN || !CLIENT_ID) return null;

  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    // Refresh token expired/revoked - drop everything rather than retrying
    // a request that will keep failing the same way.
    clearTokens();

    return null;
  }

  const tokens = (await res.json()) as TokenResponse;
  // A refresh response doesn't always include a new refresh_token - keep
  // the existing one when it doesn't.
  storeTokens({ ...tokens, refresh_token: tokens.refresh_token ?? refreshToken });

  return tokens.id_token;
}

// Passed to createGraphQLClient (see api.ts) - resolves to "Bearer <token>"
// when signed in (refreshing first if the stored token is stale), or
// undefined when signed out, so the caller falls back to the default/shared
// pantry.
export async function getAuthHeader(): Promise<string | undefined> {
  const token = localStorage.getItem(ID_TOKEN_KEY);
  const expiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY) ?? 0);
  if (token && Date.now() < expiresAt) return `Bearer ${token}`;

  const refreshed = await refreshIdToken();

  return refreshed ? `Bearer ${refreshed}` : undefined;
}
