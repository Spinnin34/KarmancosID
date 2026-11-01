import { getStore } from "./storage";
import { logAudit } from "./operations";
import { normalizeEmail, signBackchannelLogoutToken } from "./security";
import type { SessionContext } from "./session";
import type { IdentityUser, OAuthClient } from "./types";

const BACKCHANNEL_TIMEOUT_MS = 3_000;

export async function logoutIdentitySession(context: SessionContext | null): Promise<void> {
  if (!context) return;

  let collections: Awaited<ReturnType<typeof getStore>>["collections"];
  try {
    ({ collections } = await getStore());
  } catch {
    console.error("Could not reach the identity database during logout.");
    return;
  }

  try {
    await collections.sessions.deleteOne({ _id: context.session._id });
  } catch {
    console.error("Could not revoke the identity session during logout.");
  }
  if (!context.user) return;

  const user = context.user;
  const principalName = normalizeEmail(user.email);
  let registeredClientIds = new Set<string>();
  try {
    const [consents, authorizations] = await Promise.all([
      collections.consents.find({ principalName }).toArray(),
      collections.authorizations.find({ userId: user._id }).toArray(),
    ]);
    registeredClientIds = new Set([
      ...consents.map((consent) => consent.registeredClientId).filter((id): id is string => typeof id === "string"),
      ...authorizations.map((authorization) => authorization.registeredClientId).filter((id): id is string => typeof id === "string"),
    ]);
  } catch {
    console.error("Could not find connected clients during identity logout.");
  }

  try {
    await collections.authorizations.deleteMany({ userId: user._id });
  } catch {
    console.error("Could not revoke all tokens during identity logout.");
  }

  try {
    await logAudit(user.email, "account.signed_out", user.email);
  } catch {
    console.error("Could not record identity logout audit event.");
  }

  if (registeredClientIds.size === 0) return;

  let clients: OAuthClient[] = [];
  try {
    clients = await collections.clients.find({
      _id: { $in: [...registeredClientIds] },
      backchannelLogoutUri: { $type: "string", $ne: "" },
    }).toArray();
  } catch {
    console.error("Could not load connected clients during identity logout.");
  }
  await Promise.all(clients.map((client) => notifyClientOfLogout(user, client)));
}

async function notifyClientOfLogout(user: IdentityUser, client: OAuthClient): Promise<void> {
  if (!client.backchannelLogoutUri) return;
  try {
    const logoutToken = await signBackchannelLogoutToken(user, client);
    const response = await fetch(client.backchannelLogoutUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: logoutToken }),
      redirect: "manual",
      signal: AbortSignal.timeout(BACKCHANNEL_TIMEOUT_MS),
    });
    if (!response.ok) console.warn("OIDC back-channel logout was rejected by a client.", client.clientId, response.status);
  } catch {
    console.warn("OIDC back-channel logout delivery failed.", client.clientId);
  }
}
