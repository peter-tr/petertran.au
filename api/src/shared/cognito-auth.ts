import { CognitoJwtVerifier } from "aws-jwt-verify";

export interface CognitoAuthConfig {
  userPoolId: string;
  clientId: string;
}

export interface AuthenticatedUser {
  sub: string;
  email: string;
}

// Factory, not a hardcoded singleton, so each project supplies its own pool/
// client - see CLAUDE.md's shared-code convention. CognitoJwtVerifier fetches
// and caches the pool's JWKS itself; no secret or network call is needed
// beyond that first fetch.
export function createCognitoAuthVerifier(config: CognitoAuthConfig) {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    tokenUse: "id",
    clientId: config.clientId,
  });

  // Never throws - a missing/expired/malformed token just means "treat this
  // request as unauthenticated" to the caller, not a hard failure.
  return async function verifyIdToken(authHeader: string | undefined): Promise<AuthenticatedUser | null> {
    // A prefix match + slice, not `/^Bearer\s+(.+)$/i` - `\s` and `.` both
    // match whitespace, so that pattern's adjacent quantifiers gave
    // SonarQube's static analyzer a super-linear-backtracking flag (S8786).
    // Same result for every real "Bearer <token>" header, and linear since
    // there's no ambiguity for the engine to backtrack over.
    const prefixMatch = authHeader?.match(/^Bearer\s+/i);
    const token = prefixMatch ? authHeader!.slice(prefixMatch[0].length) : undefined;
    if (!token) return null;

    try {
      const payload = await verifier.verify(token);

      return { sub: payload.sub, email: String(payload.email ?? "") };
    } catch {
      return null;
    }
  };
}
