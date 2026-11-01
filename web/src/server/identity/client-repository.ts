import bcrypt from "bcryptjs";
import { getStore } from "./storage";
import { normalizeEmail, sha256 } from "./security";
import type { OAuthClient } from "./types";

export async function removeGrantsForClient(clientId: string) {
  const { collections } = await getStore();
  await Promise.all([
    collections.authorizations.deleteMany({ $or: [{ clientId }, { registeredClientId: clientId }] }),
    collections.consents.deleteMany({ $or: [{ registeredClientId: clientId }, { _id: clientId }] }),
  ]);
}

export async function invalidateClientAuthorizations(clientId: string) {
  const { collections } = await getStore();
  await collections.authorizations.deleteMany({ $or: [{ clientId }, { registeredClientId: clientId }] });
}

export async function removeGrantForClientAndPrincipal(clientId: string, email: string) {
  const { collections } = await getStore();
  const normalized = normalizeEmail(email);
  await Promise.all([
    collections.authorizations.deleteMany({
      $or: [
        { clientId, principalName: normalized },
        { registeredClientId: clientId, principalName: normalized },
      ],
    }),
    collections.consents.deleteMany({ registeredClientId: clientId, principalName: normalized }),
  ]);
}

export function consentId(clientId: string, principalName: string) {
  return sha256(`${clientId}\0${normalizeEmail(principalName)}`);
}

export async function getClientByClientId(clientId: string) {
  const { collections } = await getStore();
  return collections.clients.findOne({ clientId });
}

export async function getClientById(id: string) {
  const { collections } = await getStore();
  return collections.clients.findOne({ _id: id });
}

export async function compareClientSecret(client: OAuthClient, supplied: string) {
  return Boolean(client.clientSecret && await bcrypt.compare(supplied, client.clientSecret));
}
