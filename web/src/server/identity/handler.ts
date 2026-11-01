import { authEndpoint, bootstrapAdmin } from "./auth";
import { accountEndpoint } from "./account";
import { accountRecoveryEndpoint } from "./account-recovery";
import { mfaEndpoint } from "./mfa";
import { publicEndpoint } from "./public";
import { oauthEndpoint } from "./oauth";
import { json, safeJsonError } from "./http";
import { HttpError } from "./types";
import { addSessionCookies, sessionForRequest } from "./session";

let bootstrapPromise: Promise<void> | undefined;

export async function handleIdentityRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (process.env.KARMANCOS_BOOTSTRAP_ADMIN_EMAIL || process.env.KARMANCOS_BOOTSTRAP_ADMIN_PASSWORD) {
      bootstrapPromise ??= bootstrapAdmin();
      await bootstrapPromise;
    }

    const endpoints = [
      () => publicEndpoint(request, path),
      () => authEndpoint(request, path),
      () => mfaEndpoint(request, path),
      () => accountRecoveryEndpoint(request, path),
      () => accountEndpoint(request, path),
      () => oauthEndpoint(request, path),
    ];
    for (const endpoint of endpoints) {
      const response = await endpoint();
      if (response) return refreshSessionCookies(request, response);
    }
    return json({ message: "No se encontró esta ruta." }, 404);
  } catch (error) {
    if ((path.startsWith("/oauth2/") || path === "/userinfo") && error instanceof HttpError) {
      const message = error.message;
      const oauthError = message === "invalid_client" ? "invalid_client"
        : error.status === 401 ? "invalid_client"
          : "invalid_request";
      return refreshSessionCookies(request, json({ error: oauthError, error_description: error.status >= 500 ? "No se pudo completar la solicitud." : message }, error.status));
    }
    return refreshSessionCookies(request, safeJsonError(error));
  }
}

function refreshSessionCookies(request: Request, response: Response): Response {
  if (response.headers.has("set-cookie")) return response;
  const context = sessionForRequest(request);
  if (!context?.user) return response;

  const headers = new Headers(response.headers);
  addSessionCookies(headers, context);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
