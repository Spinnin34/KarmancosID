import type { AuthorizationRequest } from "./types";

export const AUTHORIZATION_REQUEST_LIFETIME_MS = 10 * 60_000;

export function isAuthorizationRequestCurrent(request: AuthorizationRequest | undefined, now = Date.now()): request is AuthorizationRequest {
  return Boolean(
    request
    && Number.isFinite(request.createdAt)
    && request.createdAt <= now
    && request.createdAt > now - AUTHORIZATION_REQUEST_LIFETIME_MS,
  );
}

export function authorizationPath(request: AuthorizationRequest): string {
  const params = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    scope: request.scopes.join(" "),
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallengeMethod,
  });
  if (request.nonce) params.set("nonce", request.nonce);
  return `/oauth2/authorize?${params.toString()}`;
}
