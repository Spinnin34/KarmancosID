import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("Set MONGODB_URI before running the database index migration.");
}

const client = new MongoClient(uri, {
  appName: "karmancos-id-index-migration",
  maxPoolSize: 2,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
});

function databaseFromUri(value) {
  try {
    const path = new URL(value).pathname.replace(/^\//, "");
    return path ? decodeURIComponent(path) : undefined;
  } catch {
    return undefined;
  }
}

try {
  await client.connect();
  const databaseName = process.env.MONGODB_DATABASE || databaseFromUri(uri) || "karmancosid";
  const database = client.db(databaseName);

  const refreshTokens = await database.collection("oauth_authorizations").updateMany(
    { kind: "refresh_token", expiresAt: { $gt: new Date() } },
    { $unset: { expiresAt: "" } },
  );

  await Promise.all([
    database.collection("identity_users").createIndexes([
      { key: { email: 1 }, unique: true, name: "uk_identity_email" },
      { key: { username: 1 }, unique: true, name: "uk_identity_username" },
    ]),
    database.collection("oauth_clients").createIndexes([
      { key: { clientId: 1 }, unique: true, name: "uk_oauth_client_id" },
    ]),
    database.collection("identity_sessions").createIndexes([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_identity_sessions" },
      { key: { email: 1, lastAccessedAt: -1 }, name: "idx_identity_sessions_email_recent" },
    ]),
    database.collection("oauth_authorizations").createIndexes([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_oauth_authorizations" },
    ]),
    database.collection("auth_rate_limits").createIndexes([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_auth_rate_limits" },
    ]),
    database.collection("audit_events").createIndexes([
      { key: { occurredAt: 1 }, name: "occurredAt" },
    ]),
    database.collection("client_application_requests").createIndexes([
      { key: { submittedAt: -1 }, name: "idx_applications_submitted_at" },
    ]),
    database.collection("oauth_revocations").createIndexes([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_oauth_revocations" },
    ]),
    database.collection("account_recovery_tokens").createIndexes([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_account_recovery_tokens" },
    ]),
  ]);

  process.stdout.write(`Indexes are current for database ${databaseName}; ${refreshTokens.modifiedCount} active refresh token(s) migrated to no expiry.\n`);
} finally {
  await client.close();
}
