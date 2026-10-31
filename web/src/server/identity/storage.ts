import { MongoClient, type Collection, type Db } from "mongodb";
import type { IdentitySession, IdentityUser, OAuthClient } from "./types";

type IdentityDocument = {
  _id: string;
  [key: string]: unknown;
  action?: string;
  authorities?: string[];
  clientId?: string;
  clientType?: string;
  codeChallenge?: string;
  contactEmail?: string;
  createdAt?: Date;
  description?: string;
  email?: string;
  expiresAt?: Date;
  issuedBy?: string;
  kind?: string;
  lastAccessedAt?: Date;
  name?: string;
  nonce?: string;
  occurredAt?: Date;
  ownerId?: string;
  principalName?: string;
  redirectUri?: string;
  redirectUris?: string[];
  registeredClientId?: string;
  requestCount?: number;
  reviewedAt?: Date | null;
  scopes?: string[];
  status?: string;
  submittedAt?: Date;
  subject?: string;
  userId?: string;
  windowStartedAt?: Date;
};

type Collections = {
  users: Collection<IdentityUser>;
  uniqueKeys: Collection<IdentityDocument>;
  sessions: Collection<IdentitySession>;
  clients: Collection<OAuthClient>;
  consents: Collection<IdentityDocument>;
  authorizations: Collection<IdentityDocument>;
  revocations: Collection<IdentityDocument>;
  rateLimits: Collection<IdentityDocument>;
  accountRecoveryTokens: Collection<IdentityDocument>;
  audit: Collection<IdentityDocument>;
  applications: Collection<IdentityDocument>;
};

type IdentityStore = { client: MongoClient; db: Db; collections: Collections };

declare global {
  // Keep one Mongo connection pool per warm Vercel instance.
  var __karmancosIdentityMongo: Promise<IdentityStore> | undefined;
}

export async function getStore(): Promise<IdentityStore> {
  if (!globalThis.__karmancosIdentityMongo) {
    globalThis.__karmancosIdentityMongo = connectStore().catch((error) => {
      globalThis.__karmancosIdentityMongo = undefined;
      throw error;
    });
  }
  return globalThis.__karmancosIdentityMongo;
}

export async function closeStore(): Promise<void> {
  const storePromise = globalThis.__karmancosIdentityMongo;
  if (!storePromise) return;
  globalThis.__karmancosIdentityMongo = undefined;
  const store = await storePromise;
  await store.client.close();
}

async function connectStore(): Promise<IdentityStore> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Identity database is not configured.");

  const client = new MongoClient(uri, {
    appName: "karmancos-id-web",
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  try {
    await client.connect();

    const database = process.env.MONGODB_DATABASE || databaseFromUri(uri) || "karmancosid";
    const db = client.db(database);
    const collections: Collections = {
      users: db.collection<IdentityUser>("identity_users"),
      uniqueKeys: db.collection<IdentityDocument>("identity_unique_keys"),
      sessions: db.collection<IdentitySession>("identity_sessions"),
      clients: db.collection<OAuthClient>("oauth_clients"),
      consents: db.collection<IdentityDocument>("oauth_consents"),
      authorizations: db.collection<IdentityDocument>("oauth_authorizations"),
      revocations: db.collection<IdentityDocument>("oauth_revocations"),
      rateLimits: db.collection<IdentityDocument>("auth_rate_limits"),
      accountRecoveryTokens: db.collection<IdentityDocument>("account_recovery_tokens"),
      audit: db.collection<IdentityDocument>("audit_events"),
      applications: db.collection<IdentityDocument>("client_application_requests"),
    };

    return { client, db, collections };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

function databaseFromUri(uri: string): string | undefined {
  try {
    const path = new URL(uri).pathname.replace(/^\//, "");
    return path ? decodeURIComponent(path) : undefined;
  } catch {
    return undefined;
  }
}
