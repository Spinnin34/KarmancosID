import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getStore } from "./storage";
import { normalizeEmail, sha256 } from "./security";
import { clientIp } from "./http";

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
  let bucket: Record<string, unknown> | null;
  const update = [{ $set: {
    windowStartedAt: { $cond: [resetWindow, now, "$windowStartedAt"] },
    requestCount: { $cond: [resetWindow, 1, { $add: [{ $ifNull: ["$requestCount", 0] }, 1] }] },
    expiresAt: new Date(now.getTime() + windowMs * 2),
  } }];
  try {
    bucket = await collections.rateLimits.findOneAndUpdate(
      { _id: key },
      update,
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
    bucket = await collections.rateLimits.findOneAndUpdate(
      { _id: key },
      update,
      { returnDocument: "after" },
    );
  }
  const started = bucket?.windowStartedAt ? new Date(bucket.windowStartedAt as Date) : now;
  const count = Number(bucket?.requestCount ?? 1);
  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((started.getTime() + windowMs - now.getTime()) / 1000)),
  };
}
