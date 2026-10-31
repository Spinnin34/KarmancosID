import assert from "node:assert/strict";
import test from "node:test";
import { completePopup, createKarmancosID } from "../index.js";

const originalWindow = globalThis.window;
const originalSessionStorage = globalThis.sessionStorage;

test.afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalSessionStorage;
});

test("SDK only creates callbacks on the current application origin", () => {
  globalThis.window = { location: { origin: "https://app.example.test" } };
  assert.throws(() => createKarmancosID({
    issuer: "https://id.example.test",
    clientId: "client-1",
    redirectUri: "https://attacker.example/callback",
  }), /pertenecer al origen/);
});

test("redirect callback rejects a state without a stored PKCE transaction", async () => {
  const storage = { getItem: () => null, removeItem() {} };
  globalThis.sessionStorage = storage;
  globalThis.window = {
    location: { origin: "https://app.example.test", href: "https://app.example.test/callback?state=missing&code=authorization-code" },
    sessionStorage: storage,
    history: { replaceState() {} },
  };
  const identity = createKarmancosID({
    issuer: "https://id.example.test",
    clientId: "client-1",
    redirectUri: "https://app.example.test/callback",
  });
  await assert.rejects(identity.completeRedirect(), /caducado o no coincide/);
});

test("popup callback does nothing outside a popup window", () => {
  globalThis.window = { location: { href: "https://app.example.test/callback?code=x&state=y" }, opener: null };
  assert.equal(completePopup(), false);
});
