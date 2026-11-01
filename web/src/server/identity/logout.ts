import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { getStore } from "./storage";
import { logAudit } from "./operations";
import { normalizeEmail, signBackchannelLogoutToken } from "./security";
import type { SessionContext } from "./session";
import type { IdentityUser, OAuthClient } from "./types";

const BACKCHANNEL_TIMEOUT_MS = 3_000;
type ResolvedAddress = { address: string; family: number };

export async function logoutIdentitySession(context: SessionContext | null): Promise<void> {
  if (!context) return;

  const { collections } = await getStore();
  const user = context.user;
  const clients = user ? await connectedClients(collections, user) : [];
  if (user) await collections.authorizations.deleteMany({ $or: [{ userId: user._id }, { principalName: normalizeEmail(user.email) }] });
  await collections.sessions.deleteOne({ _id: context.session._id });
  if (!user) return;

  try {
    await logAudit(user.email, "account.signed_out", user.email);
  } catch {
    console.error("Could not record identity logout audit event.");
  }

  await Promise.all(clients.map((client) => notifyClientOfLogout(user, client)));
}

export async function revokeIdentityAccess(user: IdentityUser): Promise<void> {
  const { collections } = await getStore();
  const principalName = normalizeEmail(user.email);
  let clients: OAuthClient[] = [];
  let clientLookupError: unknown;
  try { clients = await connectedClients(collections, user); } catch (error) { clientLookupError = error; }
  const revocations = await Promise.allSettled([
    collections.sessions.deleteMany({ $or: [{ userId: user._id }, { email: principalName }] }),
    collections.authorizations.deleteMany({ $or: [{ userId: user._id }, { principalName }] }),
    collections.consents.deleteMany({ principalName }),
  ]);
  await Promise.all(clients.map((client) => notifyClientOfLogout(user, client)));
  if (clientLookupError) throw clientLookupError;
  const failedRevocation = revocations.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failedRevocation) throw failedRevocation.reason;
}

export async function notifyClientOfUserLogout(user: IdentityUser, registeredClientId: string): Promise<void> {
  const { collections } = await getStore();
  const client = await collections.clients.findOne({
    $or: [{ _id: registeredClientId }, { clientId: registeredClientId }],
    backchannelLogoutUri: { $type: "string", $ne: "" },
  });
  if (client) await notifyClientOfLogout(user, client);
}

async function connectedClientIds(collections: Awaited<ReturnType<typeof getStore>>["collections"], user: IdentityUser) {
  const principalName = normalizeEmail(user.email);
  const [consents, authorizations] = await Promise.all([
    collections.consents.find({ principalName }).toArray(),
    collections.authorizations.find({ $or: [{ userId: user._id }, { principalName }] }).toArray(),
  ]);
  return new Set([
    ...consents.map((consent) => consent.registeredClientId).filter((id): id is string => typeof id === "string"),
    ...authorizations.map((authorization) => authorization.registeredClientId ?? authorization.clientId).filter((id): id is string => typeof id === "string"),
  ]);
}

async function connectedClients(
  collections: Awaited<ReturnType<typeof getStore>>["collections"],
  user: IdentityUser,
): Promise<OAuthClient[]> {
  const registeredClientIds = await connectedClientIds(collections, user);
  if (registeredClientIds.size === 0) return [];
  return collections.clients.find({
    $or: [{ _id: { $in: [...registeredClientIds] } }, { clientId: { $in: [...registeredClientIds] } }],
    backchannelLogoutUri: { $type: "string", $ne: "" },
  }).toArray();
}

async function notifyClientOfLogout(user: IdentityUser, client: OAuthClient): Promise<void> {
  if (!client.backchannelLogoutUri) return;
  try {
    const logoutToken = await signBackchannelLogoutToken(user, client);
    const url = new URL(client.backchannelLogoutUri);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Invalid back-channel endpoint.");
    const deadline = Date.now() + BACKCHANNEL_TIMEOUT_MS;
    const addresses = await lookupWithTimeout(url.hostname, Math.max(1, deadline - Date.now()));
    const address = addresses.find((candidate) => isPublicAddress(candidate.address));
    if (!address) throw new Error("Back-channel endpoint did not resolve to a public address.");
    const body = Buffer.from(new URLSearchParams({ logout_token: logoutToken }).toString());
    const status = await postLogoutToken(url, body, address, Math.max(1, deadline - Date.now()));
    if (status < 200 || status >= 300) console.warn("OIDC back-channel logout was rejected by a client.", client.clientId, status);
  } catch {
    console.warn("OIDC back-channel logout delivery failed.", client.clientId);
  }
}

function lookupWithTimeout(hostname: string, timeoutMs: number): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Back-channel DNS lookup timed out.")), timeoutMs);
    void lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
      clearTimeout(timeout);
      resolve(addresses);
    }, (error: unknown) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function postLogoutToken(url: URL, body: Buffer, address: ResolvedAddress, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const requestRef: { current: ReturnType<typeof httpsRequest> | null } = { current: null };
    const timeout = setTimeout(() => requestRef.current?.destroy(new Error("Back-channel logout timed out.")), timeoutMs);
    const request = httpsRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": String(body.byteLength),
      },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      clearTimeout(timeout);
      const status = response.statusCode ?? 0;
      response.destroy();
      resolve(status);
    });
    requestRef.current = request;
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Back-channel logout timed out.")));
    request.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    request.end(body);
  });
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [first, second, third] = address.split(".").map(Number);
    if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
    if (first === 100 && second >= 64 && second <= 127) return false;
    if (first === 169 && second === 254) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
    if (first === 192 && (second === 0 || second === 168 || (second === 88 && third === 99))) return false;
    if (first === 192 && second === 0 && third === 2) return false;
    if (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) return false;
    if (first === 203 && second === 0 && third === 113) return false;
    return true;
  }
  if (isIP(address) !== 6) return false;

  const groups = ipv6Groups(address);
  if (!groups) return false;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const mappedIpv4 = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
    return isPublicAddress(mappedIpv4);
  }
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  if (groups[0] === 0x2001 && (groups[1] === 0x0db8 || groups[1] === 0 || groups[1] === 0x0020)) return false;
  if (groups[0] === 0x2002) return false;
  return true;
}

function ipv6Groups(address: string): number[] | null {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const octets = normalized.slice(lastColon + 1).split(".").map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }

  const parts = normalized.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const zeros = 8 - left.length - right.length;
  if ((parts.length === 1 && zeros !== 0) || (parts.length === 2 && zeros < 1)) return null;
  const groups = [...left, ...Array(zeros).fill("0"), ...right].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}
