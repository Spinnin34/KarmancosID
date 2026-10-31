import { HttpError } from "./types";

export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  result.set("Cache-Control", "no-store");
  result.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers: result });
}

export function empty(status = 204, headers: HeadersInit = {}) {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  return new Response(null, { status, headers: result });
}

export function redirect(location: string, status = 303, headers: HeadersInit = {}) {
  const result = new Headers(headers);
  result.set("Location", location);
  result.set("Cache-Control", "no-store");
  return new Response(null, { status, headers: result });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000) throw new HttpError(413, "La solicitud es demasiado grande.");
  let data: unknown;
  try { data = await request.json(); } catch { throw new HttpError(400, "Revisa los datos enviados."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "Revisa los datos enviados.");
  return data as Record<string, unknown>;
}

export async function readForm(request: Request): Promise<URLSearchParams> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64_000) throw new HttpError(413, "La solicitud es demasiado grande.");
  const text = await request.text();
  if (text.length > 64_000) throw new HttpError(413, "La solicitud es demasiado grande.");
  return new URLSearchParams(text);
}

export function appendCookie(headers: Headers, value: string) {
  headers.append("Set-Cookie", value);
}

export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    || "unknown";
}

export function requireString(value: unknown, field: string, max = 4096): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new HttpError(400, "Revisa los datos enviados.");
  }
  return value;
}

export function safeJsonError(error: unknown) {
  if (error instanceof HttpError) return json({ message: error.message }, error.status);
  if (error instanceof SyntaxError) return json({ message: "Revisa los datos enviados." }, 400);
  // Avoid sending database URIs, provider credentials, stack traces, or key material to clients.
  console.error("Identity API invocation failed", error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error");
  return json({ message: "No se pudo completar la solicitud." }, 500);
}
