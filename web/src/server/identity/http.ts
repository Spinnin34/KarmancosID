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
  const body = await readBoundedBody(request, 1_000_000);
  let data: unknown;
  try { data = JSON.parse(body.toString("utf8")); } catch { throw new HttpError(400, "Revisa los datos enviados."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "Revisa los datos enviados.");
  return data as Record<string, unknown>;
}

export async function readForm(request: Request): Promise<URLSearchParams> {
  const body = await readBoundedBody(request, 64_000);
  return new URLSearchParams(body.toString("utf8"));
}

export async function readFormData(request: Request, maxBytes: number): Promise<FormData> {
  const body = await readBoundedBody(request, maxBytes);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  try {
    return await new Request(request.url, { method: "POST", headers, body: Uint8Array.from(body) }).formData();
  } catch {
    throw new HttpError(400, "Revisa el archivo enviado.");
  }
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) throw new HttpError(400, "Revisa los datos enviados.");
    if (parsedLength > maxBytes) throw new HttpError(413, "La solicitud es demasiado grande.");
  }

  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "La solicitud es demasiado grande.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export function appendCookie(headers: Headers, value: string) {
  headers.append("Set-Cookie", value);
}

export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    || "unknown";
}

export function requireString(value: unknown, _field: string, max = 4096): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new HttpError(400, "Revisa los datos enviados.");
  }
  return value;
}

export function safeJsonError(error: unknown) {
  if (error instanceof HttpError) return json({ message: error.message }, error.status);
  if (error instanceof SyntaxError) return json({ message: "Revisa los datos enviados." }, 400);
  // Error messages from drivers can contain database details or request data, so log only the error class.
  console.error("Identity API invocation failed", error instanceof Error ? error.name : "Unknown error");
  return json({ message: "No se pudo completar la solicitud." }, 500);
}
