import { authEndpoint, bootstrapAdmin } from "./auth";
import { accountEndpoint } from "./account";
import { publicEndpoint } from "./public";
import { oauthEndpoint } from "./oauth";
import { json, safeJsonError } from "./http";
import { HttpError } from "./types";

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
      () => accountEndpoint(request, path),
      () => oauthEndpoint(request, path),
    ];
    for (const endpoint of endpoints) {
      const response = await endpoint();
      if (response) return response;
    }
    return json({ message: "No se encontró esta ruta." }, 404);
  } catch (error) {
    if ((path.startsWith("/oauth2/") || path === "/userinfo") && error instanceof HttpError) {
      const message = error.message;
      const oauthError = message === "invalid_client" ? "invalid_client"
        : error.status === 401 ? "invalid_client"
          : "invalid_request";
      return json({ error: oauthError, error_description: error.status >= 500 ? "No se pudo completar la solicitud." : message }, error.status);
    }
    return safeJsonError(error);
  }
}
