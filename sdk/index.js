const DEFAULT_SCOPES = ["openid", "profile", "email"];
const CALLBACK_MESSAGE = "karmancos-id:authorization-response";

function randomValue(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSegment(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeSegment(value)));
}

async function challenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyIdToken(token, { issuer, clientId, nonce, jwksUri }) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("El proveedor devolvió un ID token inválido.");
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Algoritmo de firma no admitido.");
  const response = await fetch(jwksUri, { credentials: "omit" });
  if (!response.ok) throw new Error("No se pudieron validar las claves del proveedor.");
  const jwks = await response.json();
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
  if (!jwk) throw new Error("La clave de firma del proveedor no está publicada.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeSegment(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Date.now() / 1000;
  if (!verified || claims.iss !== issuer || !audience.includes(clientId) || typeof claims.sub !== "string" || !claims.sub
      || claims.nonce !== nonce || (claims.azp && claims.azp !== clientId)
      || (audience.length > 1 && claims.azp !== clientId)
      || !Number.isFinite(claims.iat) || claims.iat > now + 60
      || !Number.isFinite(claims.exp) || claims.exp <= now
      || (Number.isFinite(claims.nbf) && claims.nbf > now)) {
    throw new Error("La respuesta de inicio de sesión no es válida.");
  }
  return claims;
}

export function completePopup() {
  const params = new URL(window.location.href).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const error = params.get("error");
  if (!window.opener || !state || (!code && !error)) return false;
  window.opener.postMessage({ type: CALLBACK_MESSAGE, state, code, error }, window.location.origin);
  window.close();
  return true;
}

export function createKarmancosID({ issuer, clientId, redirectUri, scopes = DEFAULT_SCOPES }) {
  const normalizedIssuer = issuer.replace(/\/+$/, "");
  const callback = new URL(redirectUri);
  if (callback.origin !== window.location.origin) throw new Error("El callback debe pertenecer al origen de esta aplicación.");

  async function metadata() {
    const response = await fetch(`${normalizedIssuer}/.well-known/openid-configuration`, { credentials: "omit" });
    if (!response.ok) throw new Error("No se pudo descubrir la configuración OIDC.");
    const data = await response.json();
    if (data.issuer !== normalizedIssuer || !data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri) {
      throw new Error("Los metadatos OIDC no coinciden con el proveedor configurado.");
    }
    return data;
  }

  async function finish(code, verifier, nonce, config) {
    const response = await fetch(config.token_endpoint, {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code,
        redirect_uri: redirectUri, code_verifier: verifier })
    });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok || !tokens.id_token || !tokens.access_token) throw new Error("No se pudo completar el intercambio OIDC.");
    const user = await verifyIdToken(tokens.id_token, { issuer: normalizedIssuer, clientId, nonce, jwksUri: config.jwks_uri });
    return Object.freeze({ user, accessToken: tokens.access_token, idToken: tokens.id_token,
      tokenType: tokens.token_type, expiresIn: tokens.expires_in });
  }

  async function signIn({ mode = "popup", timeoutMs = 180000 } = {}) {
    if (!crypto?.subtle) throw new Error("El inicio seguro requiere HTTPS y WebCrypto.");
    const popup = mode === "popup" ? window.open("about:blank", "karmancos-id", "popup,width=480,height=680,resizable=yes,scrollbars=yes") : null;
    const config = await metadata();
    const state = randomValue();
    const nonce = randomValue();
    const verifier = randomValue(48);
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri,
      scope: [...new Set(scopes)].join(" "), state, nonce, code_challenge: await challenge(verifier), code_challenge_method: "S256" });
    if (mode !== "popup" || !popup) {
      sessionStorage.setItem(`karmancos-id:${state}`, JSON.stringify({ verifier, nonce }));
      window.location.assign(`${config.authorization_endpoint}?${params}`);
      return new Promise(() => {});
    }

    popup.location.replace(`${config.authorization_endpoint}?${params}`);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => cleanup(() => reject(new Error("El inicio de sesión agotó el tiempo de espera."))), timeoutMs);
      const poll = window.setInterval(() => {
        if (popup.closed) cleanup(() => reject(new Error("Se cerró la ventana de inicio de sesión.")));
      }, 400);
      function cleanup(done) {
        clearTimeout(timer); clearInterval(poll); window.removeEventListener("message", receive); done();
      }
      function receive(event) {
        if (event.origin !== callback.origin || event.source !== popup || event.data?.type !== CALLBACK_MESSAGE || event.data.state !== state) return;
        if (event.data.error || !event.data.code) return cleanup(() => reject(new Error("No se pudo autorizar la aplicación.")));
        cleanup(async () => {
          try { resolve(await finish(event.data.code, verifier, nonce, config)); }
          catch (error) { reject(error); }
        });
      }
      window.addEventListener("message", receive);
    });
  }

  async function completeRedirect() {
    const params = new URL(window.location.href).searchParams;
    const state = params.get("state");
    const code = params.get("code");
    if (!state || !code) throw new Error("No se encontró una respuesta de autorización.");
    const key = `karmancos-id:${state}`;
    const transaction = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!transaction) throw new Error("La sesión de autorización ha caducado o no coincide.");
    const cleanUrl = new URL(window.location.href);
    ["code", "state", "session_state"].forEach((name) => cleanUrl.searchParams.delete(name));
    window.history.replaceState(null, "", cleanUrl);
    const config = await metadata();
    return finish(code, JSON.parse(transaction).verifier, JSON.parse(transaction).nonce, config);
  }

  return Object.freeze({ signIn, completeRedirect });
}
