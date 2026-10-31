import assert from "node:assert/strict";
import test from "node:test";
import { requireAuthenticated, requireCsrf } from "../src/server/identity/session";
import { HttpError, type IdentitySession, type IdentityUser } from "../src/server/identity/types";

function context(role: "USER" | "ADMIN" = "USER") {
  const now = new Date();
  const user: IdentityUser = {
    _id: "account-1", username: "test-user", email: "test@example.com", firstName: "Test", lastName: "User",
    secondLastName: "", displayName: "Test User", passwordHash: "not-a-password", role, active: true,
    emailVerified: false, createdAt: now,
  };
  const session: IdentitySession = {
    _id: "session-1", userId: user._id, email: user.email, csrfToken: "csrf-secret",
    createdAt: now, lastAccessedAt: now, expiresAt: new Date(now.getTime() + 60_000),
  };
  return { user, session, isNew: false };
}

test("administrator requests require an MFA-authenticated session", () => {
  const administrator = context("ADMIN");
  assert.throws(() => requireAuthenticated(administrator), (error: unknown) => error instanceof HttpError && error.status === 403);
  administrator.session.mfaVerifiedAt = new Date();
  assert.doesNotThrow(() => requireAuthenticated(administrator));
});

test("a regular account does not require the administrator second factor", () => {
  assert.doesNotThrow(() => requireAuthenticated(context("USER")));
});

test("CSRF requires the session token, cookie and same origin", () => {
  const state = context();
  const request = new Request("https://id.example.test/api/account/password", {
    method: "POST",
    headers: {
      origin: "https://id.example.test",
      cookie: "KARMANCOSID=session-1; XSRF-TOKEN=csrf-secret",
      "x-xsrf-token": "csrf-secret",
    },
  });
  assert.doesNotThrow(() => requireCsrf(request, state));
  assert.throws(() => requireCsrf(new Request(request, { headers: { origin: "https://attacker.example" } }), state),
    (error: unknown) => error instanceof HttpError && error.status === 403);
  assert.throws(() => requireCsrf(new Request("https://id.example.test/api/account/password", {
    method: "POST", headers: { origin: "https://id.example.test", cookie: "XSRF-TOKEN=wrong", "x-xsrf-token": "wrong" },
  }), state), (error: unknown) => error instanceof HttpError && error.status === 403);
});
