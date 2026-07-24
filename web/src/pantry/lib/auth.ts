// Cognito username(email)+password sign-in for pantry, called directly
// against Cognito's IdP API - no Hosted UI redirect. Hosted UI's
// authorization-code flow turned out to be a dead end for a pure
// client-side SPA: Cognito's /oauth2/token endpoint doesn't send CORS
// headers back to a browser fetch, so the in-app code-for-tokens exchange
// after the Hosted UI redirect always failed in prod. InitiateAuth/SignUp
// (this file) are the unauthenticated actions Cognito's IdP API does allow
// CORS for from a public client, so an inline form works instead. No email
// verification and no MFA by design - see infra/lib/pantry-stack.ts's
// PantryAutoConfirmFunction. Tokens live in localStorage (this app has no
// other session infra). Deliberately doesn't import from ./api.ts (which
// imports getAuthHeader from here) - ensureAccount below uses a raw fetch
// instead of api.ts's runPantryQuery to avoid a circular import.

const CLIENT_ID = import.meta.env?.VITE_PANTRY_COGNITO_CLIENT_ID as string | undefined;
const GRAPHQL_ENDPOINT = import.meta.env?.VITE_PANTRY_GRAPHQL_ENDPOINT as string | undefined;

// Every pantry stack is deployed in this one region (see infra/bin/app.ts) -
// Cognito's IdP API endpoint is region-scoped in its hostname, not
// something the client ID alone reveals.
const COGNITO_IDP_ENDPOINT = "https://cognito-idp.ap-southeast-2.amazonaws.com/";

const ID_TOKEN_KEY = "pantry_id_token";
const REFRESH_TOKEN_KEY = "pantry_refresh_token";
const EXPIRES_AT_KEY = "pantry_token_expires_at";

export class PantryAuthError extends Error {}

interface AuthenticationResult {
  IdToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
}

function storeTokens(result: AuthenticationResult): void {
  localStorage.setItem(ID_TOKEN_KEY, result.IdToken);
  if (result.RefreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, result.RefreshToken);
  // A minute of slack, so getAuthHeader refreshes ahead of actual expiry
  // rather than sending a token that's already dead by the time the
  // request lands.
  localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + (result.ExpiresIn - 60) * 1000));
}

function clearTokens(): void {
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
}

function friendlyMessage(errorType: string | undefined, message: string | undefined): string {
  switch (errorType) {
    case "UsernameExistsException":
      return "An account with that email already exists - try signing in instead.";
    case "NotAuthorizedException":
      return "Incorrect email or password.";
    case "UserNotFoundException":
      return "No account with that email - try creating one.";
    case "InvalidPasswordException":
      return "Password must be at least 6 characters.";
    case "InvalidParameterException":
      return "Enter a valid email and password.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts - wait a moment and try again.";
    default:
      return message || "Something went wrong. Try again.";
  }
}

// Cognito's IdentityProvider API is a single POST-everything JSON RPC
// surface - the action lives in the X-Amz-Target header, not the URL path.
// SignUp/InitiateAuth are unauthenticated actions for a public (no-secret)
// app client, so this needs no AWS credentials/signing.
async function cognitoRequest<T>(action: string, body: Record<string, unknown>): Promise<T> {
  if (!CLIENT_ID) throw new PantryAuthError("Sign-in isn't configured.");

  const res = await fetch(COGNITO_IDP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new PantryAuthError(
      friendlyMessage(json.__type as string | undefined, json.message as string | undefined)
    );
  }

  return json as T;
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

export async function signUp(email: string, password: string): Promise<void> {
  await cognitoRequest("SignUp", {
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }],
  });
  // No confirmation code step - PantryAutoConfirmFunction already marked
  // the account confirmed/verified, so it can sign in immediately.
  await signIn(email, password);
}

export async function signIn(email: string, password: string): Promise<void> {
  const result = await cognitoRequest<{ AuthenticationResult: AuthenticationResult }>("InitiateAuth", {
    ClientId: CLIENT_ID,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  storeTokens(result.AuthenticationResult);
  await ensureAccount();
}

export function signOut(): void {
  clearTokens();
}

async function refreshIdToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken || !CLIENT_ID) return null;

  try {
    const result = await cognitoRequest<{ AuthenticationResult: AuthenticationResult }>("InitiateAuth", {
      ClientId: CLIENT_ID,
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    // A refresh response doesn't always include a new refresh_token - keep
    // the existing one when it doesn't.
    storeTokens({
      ...result.AuthenticationResult,
      RefreshToken: result.AuthenticationResult.RefreshToken ?? refreshToken,
    });

    return result.AuthenticationResult.IdToken;
  } catch {
    // Refresh token expired/revoked - drop everything rather than retrying
    // a request that will keep failing the same way.
    clearTokens();

    return null;
  }
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
