import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import bcrypt from "bcryptjs";
import { getStore } from "./storage";
import { emailRegex, normalizeEmail, normalizeIdentifier, sha256 } from "./security";
import { HttpError, type IdentityUser, type OAuthClient } from "./types";
import { clientIp } from "./http";

export function displayName(user: Pick<IdentityUser, "firstName" | "lastName" | "secondLastName">) {
  return [user.firstName, user.lastName, user.secondLastName].map((part) => part?.trim()).filter(Boolean).join(" ");
}

export function pictureUrl(user: IdentityUser): string | null {
  if (!user.profilePicture || !user.profilePictureContentType || !user.profilePictureUpdatedAt) return null;
  const version = new Date(user.profilePictureUpdatedAt).getTime();
  return `/api/public/users/${encodeURIComponent(user._id)}/picture?v=${version}`;
}

export function userResponse(user: IdentityUser) {
  return {
    id: user._id,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    displayName: user.displayName || displayName(user),
    role: user.role,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    secondLastName: user.secondLastName || "",
    picture: pictureUrl(user),
  };
}

export function adminUserResponse(user: IdentityUser) {
  return {
    id: user._id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    secondLastName: user.secondLastName || "",
    displayName: user.displayName || displayName(user),
    role: user.role,
    active: Boolean(user.active),
    createdAt: user.createdAt,
    picture: pictureUrl(user),
  };
}

export async function logAudit(actorEmail: string, action: string, subject: string) {
  const { collections } = await getStore();
  await collections.audit.insertOne({
    _id: randomUUID(), actorEmail: normalizeEmail(actorEmail), action, subject, occurredAt: new Date(),
  });
}

export async function consumeRateLimit(request: Request, kind: string, subject: string, limit: number, windowMs: number) {
  const { collections } = await getStore();
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  const key = sha256(`${kind}\0${clientIp(request)}\0${subject}`);
  const resetWindow = { $lte: [{ $ifNull: ["$windowStartedAt", new Date(0)] }, cutoff] };
  let bucket: Record<string, any> | null;
  try {
    bucket = await collections.rateLimits.findOneAndUpdate(
      { _id: key },
      [{ $set: {
        windowStartedAt: { $cond: [resetWindow, now, "$windowStartedAt"] },
        requestCount: { $cond: [resetWindow, 1, { $add: [{ $ifNull: ["$requestCount", 0] }, 1] }] },
        expiresAt: new Date(now.getTime() + windowMs * 2),
      } }],
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
    bucket = await collections.rateLimits.findOneAndUpdate(
      { _id: key },
      [{ $set: {
        windowStartedAt: { $cond: [resetWindow, now, "$windowStartedAt"] },
        requestCount: { $cond: [resetWindow, 1, { $add: [{ $ifNull: ["$requestCount", 0] }, 1] }] },
        expiresAt: new Date(now.getTime() + windowMs * 2),
      } }],
      { returnDocument: "after" },
    );
  }
  const started = bucket?.windowStartedAt ? new Date(bucket.windowStartedAt) : now;
  const count = Number(bucket?.requestCount ?? 1);
  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((started.getTime() + windowMs - now.getTime()) / 1000)),
  };
}

export async function findUserByIdentifier(identifier: string) {
  const { collections } = await getStore();
  const normalized = normalizeIdentifier(identifier);
  return collections.users.findOne({ $or: [{ email: normalized }, { username: normalized }] });
}

export async function findUserByEmail(email: string) {
  const { collections } = await getStore();
  return collections.users.findOne({ email: normalizeEmail(email) });
}

export async function createUser(input: {
  email: string; username: string; firstName: string; lastName: string;
  secondLastName?: string; passwordHash: string; role?: "USER" | "ADMIN";
}) {
  const { collections } = await getStore();
  const email = normalizeEmail(input.email);
  const username = normalizeIdentifier(input.username);
  if (!emailRegex(email) || !/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "Revisa los datos enviados.");
  const id = randomUUID();
  const emailKey = sha256(`email\0${email}`);
  const usernameKey = sha256(`username\0${username}`);
  let lockedEmail = false;
  let lockedUsername = false;
  let persisted = false;
  try {
    await collections.uniqueKeys.insertOne({ _id: emailKey, ownerId: id });
    lockedEmail = true;
    await collections.uniqueKeys.insertOne({ _id: usernameKey, ownerId: id });
    lockedUsername = true;
    const user: IdentityUser = {
      _id: id, email, username,
      firstName: input.firstName.trim(), lastName: input.lastName.trim(), secondLastName: input.secondLastName?.trim() ?? "",
      displayName: [input.firstName, input.lastName, input.secondLastName].map((part) => part?.trim()).filter(Boolean).join(" "),
      passwordHash: input.passwordHash, role: input.role ?? "USER", active: true, emailVerified: false, createdAt: new Date(),
    };
    await collections.users.insertOne(user);
    persisted = true;
    return user;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) throw new HttpError(409, "No se pudo crear la cuenta con esos datos.");
    throw error;
  } finally {
    if (!persisted) {
      if (lockedUsername) await collections.uniqueKeys.deleteOne({ _id: usernameKey, ownerId: id }).catch(() => undefined);
      if (lockedEmail) await collections.uniqueKeys.deleteOne({ _id: emailKey, ownerId: id }).catch(() => undefined);
    }
  }
}

export async function updateUserIdentity(user: IdentityUser, input: {
  email: string; username: string; firstName: string; lastName: string; secondLastName?: string;
}) {
  const { collections } = await getStore();
  const email = normalizeEmail(input.email);
  const username = normalizeIdentifier(input.username);
  if (!emailRegex(email)) throw new HttpError(400, "Escribe un correo electrónico válido.");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "El usuario debe tener entre 3 y 32 caracteres válidos.");
  const next: Record<string, unknown> = {
    email, username, firstName: input.firstName.trim(), lastName: input.lastName.trim(),
    secondLastName: input.secondLastName?.trim() ?? "",
    displayName: [input.firstName, input.lastName, input.secondLastName].map((part) => part?.trim()).filter(Boolean).join(" "),
  };
  if (email !== user.email) next.emailVerified = false;
  const oldEmailKey = sha256(`email\0${user.email}`);
  const oldUsernameKey = sha256(`username\0${user.username}`);
  const newEmailKey = sha256(`email\0${email}`);
  const newUsernameKey = sha256(`username\0${username}`);
  const acquired: string[] = [];
  let persisted = false;
  try {
    if (oldEmailKey !== newEmailKey) {
      await collections.uniqueKeys.insertOne({ _id: newEmailKey, ownerId: user._id });
      acquired.push(newEmailKey);
    }
    if (oldUsernameKey !== newUsernameKey) {
      await collections.uniqueKeys.insertOne({ _id: newUsernameKey, ownerId: user._id });
      acquired.push(newUsernameKey);
    }
    const duplicate = await collections.users.findOne({ _id: { $ne: user._id }, $or: [{ email }, { username }] });
    if (duplicate) throw new HttpError(409, "No se pudo guardar el cambio. Revisa que no exista ya.");
    await collections.users.updateOne({ _id: user._id }, { $set: next });
    persisted = true;
    if (oldEmailKey !== newEmailKey) await collections.uniqueKeys.deleteOne({ _id: oldEmailKey, ownerId: user._id });
    if (oldUsernameKey !== newUsernameKey) await collections.uniqueKeys.deleteOne({ _id: oldUsernameKey, ownerId: user._id });
    return await collections.users.findOne({ _id: user._id });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) throw new HttpError(409, "No se pudo guardar el cambio. Revisa que no exista ya.");
    throw error;
  } finally {
    if (!persisted) await Promise.all(acquired.map((key) => collections.uniqueKeys.deleteOne({ _id: key, ownerId: user._id }).catch(() => undefined)));
  }
}

export async function removeGrantsForPrincipal(email: string) {
  const { collections } = await getStore();
  await Promise.all([
    collections.authorizations.deleteMany({ principalName: normalizeEmail(email) }),
    collections.consents.deleteMany({ principalName: normalizeEmail(email) }),
  ]);
}

export async function removeGrantsForClient(clientId: string) {
  const { collections } = await getStore();
  await Promise.all([
    collections.authorizations.deleteMany({ $or: [{ clientId }, { registeredClientId: clientId }] }),
    collections.consents.deleteMany({ $or: [{ registeredClientId: clientId }, { _id: clientId }] }),
  ]);
}

export async function removeGrantForClientAndPrincipal(clientId: string, email: string) {
  const { collections } = await getStore();
  const normalized = normalizeEmail(email);
  await Promise.all([
    collections.authorizations.deleteMany({ clientId, principalName: normalized }),
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

export function rawPicture(user: IdentityUser): Buffer | null {
  if (!user.profilePicture) return null;
  if (Buffer.isBuffer(user.profilePicture)) return user.profilePicture;
  const value = user.profilePicture as unknown as { buffer?: Uint8Array; value?: Uint8Array | (() => Uint8Array) };
  if (value.buffer) return Buffer.from(value.buffer);
  if (typeof value.value === "function") return Buffer.from(value.value());
  if (value.value) return Buffer.from(value.value);
  return Buffer.from(user.profilePicture as Uint8Array);
}
