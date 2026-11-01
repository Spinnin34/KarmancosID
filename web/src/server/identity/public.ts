import { randomUUID } from "node:crypto";
import { getStore } from "./storage";
import { consumeRateLimit } from "./operations";
import { rawPicture } from "./user-repository";
import { loadSession, requireCsrf } from "./session";
import { empty, json, readJson, requireString } from "./http";
import { emailRegex, normalizeEmail, validateBackchannelLogoutUri } from "./security";
import { HttpError } from "./types";

export async function publicEndpoint(request: Request, path: string): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const clientMatch = path.match(/^\/api\/public\/clients\/([^/]+)$/);
  if (method === "GET" && clientMatch) {
    const { collections } = await getStore();
    const clientId = decodeURIComponent(clientMatch[1]);
    const client = await collections.clients.findOne({ clientId });
    if (!client) throw new HttpError(404, "No se encontró el servicio que solicita acceso.");
    let domain = "";
    try { domain = new URL(client.redirectUris?.[0] ?? "").hostname; } catch { /* invalid legacy URI */ }
    return json({ clientId: client.clientId, name: client.clientName, domain });
  }

  const pictureMatch = path.match(/^\/api\/public\/users\/([^/]+)\/picture$/);
  if (method === "GET" && pictureMatch) {
    const { collections } = await getStore();
    const user = await collections.users.findOne({ _id: decodeURIComponent(pictureMatch[1]), active: true });
    const picture = user ? rawPicture(user) : null;
    if (!user || !picture || !user.profilePictureContentType || !user.profilePictureUpdatedAt) throw new HttpError(404, "No se encontró la foto.");
    const etag = `"${new Date(user.profilePictureUpdatedAt).getTime()}"`;
    const cache = {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    };
    const incomingTag = request.headers.get("if-none-match");
    if (incomingTag === etag || incomingTag === `W/${etag}`) return empty(304, cache);
    const imageBytes = new Uint8Array(picture.length);
    imageBytes.set(picture);
    return new Response(imageBytes.buffer, { status: 200, headers: { ...cache, "Content-Type": user.profilePictureContentType } });
  }

  if (method === "POST" && path === "/api/public/applications") {
    const session = await loadSession(request);
    requireCsrf(request, session);
    const input = await readJson(request);
    const name = requireString(input.name, "name", 100).trim();
    const contactEmail = normalizeEmail(requireString(input.contactEmail, "contactEmail", 320));
    const description = requireString(input.description, "description", 1000).trim();
    if (!emailRegex(contactEmail)) throw new HttpError(400, "Escribe un correo electrónico válido.");
    const type = requireString(input.clientType, "clientType", 20).toLowerCase();
    if (type !== "public" && type !== "confidential") throw new HttpError(400, "Elige el tipo público o confidencial.");
    const redirectUris = validateApplicationUris(input.redirectUris);
    const postLogoutRedirectUris = input.postLogoutRedirectUris == null ? [] : validateApplicationUris(input.postLogoutRedirectUris);
    const backchannelLogoutUri = typeof input.backchannelLogoutUri === "string" && input.backchannelLogoutUri.trim()
      ? validateBackchannelLogoutUri(input.backchannelLogoutUri)
      : undefined;
    const ipRate = await consumeRateLimit(request, "client-application-ip", "all", 10, 24 * 60 * 60_000);
    if (!ipRate.allowed) throw new HttpError(429, "Has alcanzado el límite de solicitudes desde esta conexión. Prueba mañana.");
    const rate = await consumeRateLimit(request, "client-application", contactEmail, 3, 24 * 60 * 60_000);
    if (!rate.allowed) throw new HttpError(429, "Has alcanzado el límite de solicitudes. Prueba mañana.");
    const { collections } = await getStore();
    await collections.applications.insertOne({
      _id: randomUUID(), name, contactEmail, description, clientType: type, redirectUris, postLogoutRedirectUris,
      ...(backchannelLogoutUri ? { backchannelLogoutUri } : {}),
      status: "PENDING", submittedAt: new Date(), reviewedAt: null,
    });
    return json({ message: "Solicitud recibida. El equipo revisará el dominio y las URL de retorno antes de activar el cliente." }, 202);
  }

  if (path === "/api/health" && method === "GET") {
    try {
      const { db } = await getStore();
      await db.command({ ping: 1 });
      return json({ status: "ok", service: "karmancos-identity", database: "reachable" });
    } catch {
      return json({ status: "unavailable", service: "karmancos-identity", database: "unavailable" }, 503);
    }
  }

  return null;
}

function validateApplicationUris(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 10) throw new HttpError(400, "Añade al menos una URL exacta.");
  const safe: string[] = [];
  for (const item of value) {
    const text = String(item ?? "").trim();
    let url: URL;
    try { url = new URL(text); } catch { throw new HttpError(400, "Las URL deben ser absolutas, HTTPS y sin credenciales ni fragmentos."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:";
    if (!url.hostname || url.username || url.password || url.hash || (url.protocol !== "https:" && !local)) {
      throw new HttpError(400, "Las URL deben ser absolutas, HTTPS y sin credenciales ni fragmentos.");
    }
    safe.push(url.href);
  }
  return [...new Set(safe)];
}
