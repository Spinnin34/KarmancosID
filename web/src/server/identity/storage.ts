import { MongoClient, type Collection, type Db } from "mongodb";
import type { IdentitySession, IdentityUser, OAuthClient } from "./types";

type StringIdDocument = Record<string, any> & { _id: string };

type Collections = {
  users: Collection<IdentityUser>;
  uniqueKeys: Collection<StringIdDocument>;
  sessions: Collection<IdentitySession>;
  clients: Collection<OAuthClient>;
  consents: Collection<StringIdDocument>;
  authorizations: Collection<StringIdDocument>;
  revocations: Collection<StringIdDocument>;
  rateLimits: Collection<StringIdDocument>;
  actionTokens: Collection<StringIdDocument>;
  audit: Collection<StringIdDocument>;
  applications: Collection<StringIdDocument>;
};

declare global {
  // Keep one Mongo connection pool per warm Vercel instance.
  var __karmancosIdentityMongo: Promise<{ db: Db; collections: Collections }> | undefined;
}

export async function getStore(): Promise<{ db: Db; collections: Collections }> {
  if (!globalThis.__karmancosIdentityMongo) {
    globalThis.__karmancosIdentityMongo = connectStore().catch((error) => {
      globalThis.__karmancosIdentityMongo = undefined;
      throw error;
    });
  }
  return globalThis.__karmancosIdentityMongo;
}

async function connectStore(): Promise<{ db: Db; collections: Collections }> {
  const uri = process.env.MONGODB_URI ?? process.env.SPRING_DATA_MONGODB_URI;
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
      uniqueKeys: db.collection<StringIdDocument>("identity_unique_keys"),
      sessions: db.collection<IdentitySession>("identity_sessions"),
      clients: db.collection<OAuthClient>("oauth_clients"),
      consents: db.collection<StringIdDocument>("oauth_consents"),
      authorizations: db.collection<StringIdDocument>("oauth_authorizations"),
      revocations: db.collection<StringIdDocument>("oauth_revocations"),
      rateLimits: db.collection<StringIdDocument>("auth_rate_limits"),
      actionTokens: db.collection<StringIdDocument>("account_action_tokens"),
      audit: db.collection<StringIdDocument>("audit_events"),
      applications: db.collection<StringIdDocument>("client_application_requests"),
    };

    if (process.env.MONGODB_CREATE_INDEXES === "true") {
      await Promise.all([
        collections.users.createIndex({ email: 1 }, { unique: true, name: "uk_identity_email" }),
        collections.users.createIndex({ username: 1 }, { unique: true, name: "uk_identity_username" }),
        collections.clients.createIndex({ clientId: 1 }, { unique: true, name: "uk_oauth_client_id" }),
        collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_identity_sessions" }),
        collections.sessions.createIndex({ email: 1, lastAccessedAt: -1 }, { name: "idx_identity_sessions_email_recent" }),
        collections.authorizations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_oauth_authorizations" }),
        collections.rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_auth_rate_limits" }),
        // Keep the names used by the previous Spring Data backend. MongoDB
        // rejects an equivalent index if the same key already exists under
        // a different name.
        collections.actionTokens.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0, name: "purgeAt" }),
        // Mongo can traverse a single-key ascending index in reverse for
        // descending sorts, so retain the legacy direction as well.
        collections.audit.createIndex({ occurredAt: 1 }, { name: "occurredAt" }),
        collections.applications.createIndex({ submittedAt: -1 }, { name: "idx_applications_submitted_at" }),
        collections.revocations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_oauth_revocations" }),
      ]);
    }

    return { db, collections };
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
