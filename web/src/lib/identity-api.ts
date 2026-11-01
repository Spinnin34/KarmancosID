import { isPreviewMode } from "./preview-mode";

type IdentityRequestBody = BodyInit | Record<string, unknown> | null;

export interface IdentityRequestInit extends Omit<RequestInit, "body"> {
  body?: IdentityRequestBody;
}

export class IdentityApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "IdentityApiError";
  }
}

let csrfToken: string | undefined;
let csrfRequest: Promise<string> | undefined;
const PREVIEW_CSRF_TOKEN = "karmancos-local-preview-csrf";

export async function getIdentityCsrfToken(force = false): Promise<string> {
  if (import.meta.env.DEV && isPreviewMode()) return PREVIEW_CSRF_TOKEN;
  if (force) csrfToken = undefined;
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.token !== "string" || !data.token) {
          throw new IdentityApiError(data.message || "No se pudo preparar una solicitud segura.", response.status);
        }
        csrfToken = data.token;
        return data.token as string;
      })
      .finally(() => { csrfRequest = undefined; });
  }
  return csrfRequest;
}

export async function identityApi<T>(path: string, init: IdentityRequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  if (import.meta.env.DEV && isPreviewMode()) {
    const { PreviewApiError, handlePreviewRequest } = await import("./preview-api");
    try {
      return await handlePreviewRequest(path, { ...init, method }) as T;
    } catch (cause) {
      if (cause instanceof PreviewApiError) {
        throw new IdentityApiError(cause.message, cause.status);
      }
      throw cause;
    }
  }

  const headers = new Headers(init.headers);
  let body: BodyInit | null | undefined;
  const sourceBody = init.body;
  if (sourceBody && typeof sourceBody === "object" && !(sourceBody instanceof Blob) && !(sourceBody instanceof FormData) && !(sourceBody instanceof URLSearchParams) && !(sourceBody instanceof ArrayBuffer)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(sourceBody);
  } else {
    body = sourceBody as BodyInit | null | undefined;
  }

  if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method) && !headers.has("X-XSRF-TOKEN")) {
    headers.set("X-XSRF-TOKEN", await getIdentityCsrfToken());
  }

  const response = await fetch(path, { ...init, method, headers, body, credentials: "same-origin" });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  const data: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
      ? data.message
      : "No se pudo completar la solicitud.";
    if (response.status === 403) csrfToken = undefined;
    throw new IdentityApiError(message, response.status);
  }
  if (path === "/api/auth/login") {
    // Login rotates the session and CSRF cookie; discard the anonymous-session token.
    csrfToken = undefined;
    csrfRequest = undefined;
  }
  return data as T;
}
