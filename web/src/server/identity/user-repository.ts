import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getStore } from "./storage";
import { emailRegex, normalizeEmail, normalizeIdentifier, sha256 } from "./security";
import { HttpError, type IdentityUser } from "./types";

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

export function rawPicture(user: IdentityUser): Buffer | null {
  if (!user.profilePicture) return null;
  if (Buffer.isBuffer(user.profilePicture)) return user.profilePicture;
  const value = user.profilePicture as unknown as {
    buffer?: Uint8Array | ArrayBuffer;
    value?: Uint8Array | ((asRaw?: boolean) => Uint8Array | string);
  };
  if (typeof value.value === "function") {
    const raw = value.value(true);
    return typeof raw === "string" ? Buffer.from(raw, "binary") : Buffer.from(raw);
  }
  if (value.value instanceof Uint8Array) {
    return Buffer.from(value.value.buffer, value.value.byteOffset, value.value.byteLength);
  }
  if (value.buffer instanceof Uint8Array) {
    return Buffer.from(value.buffer.buffer, value.buffer.byteOffset, value.buffer.byteLength);
  }
  if (value.buffer instanceof ArrayBuffer) return Buffer.from(value.buffer);
  return Buffer.from(user.profilePicture as Uint8Array);
}
