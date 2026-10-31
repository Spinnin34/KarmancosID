export const prerender = true;

const issuer = (import.meta.env.PUBLIC_IDENTITY_ISSUER || "http://localhost:4321").replace(/\/+$/, "");

const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/oauth2/authorize`,
  device_authorization_endpoint: `${issuer}/oauth2/device_authorization`,
  token_endpoint: `${issuer}/oauth2/token`,
  token_endpoint_auth_methods_supported: [
    "client_secret_basic",
    "client_secret_post",
    "client_secret_jwt",
    "private_key_jwt",
    "tls_client_auth",
    "self_signed_tls_client_auth",
  ],
  jwks_uri: `${issuer}/oauth2/jwks`,
  userinfo_endpoint: `${issuer}/userinfo`,
  end_session_endpoint: `${issuer}/connect/logout`,
  response_types_supported: ["code"],
  grant_types_supported: [
    "authorization_code",
    "client_credentials",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code",
    "urn:ietf:params:oauth:grant-type:token-exchange",
  ],
  revocation_endpoint: `${issuer}/oauth2/revoke`,
  revocation_endpoint_auth_methods_supported: [
    "client_secret_basic",
    "client_secret_post",
    "client_secret_jwt",
    "private_key_jwt",
    "tls_client_auth",
    "self_signed_tls_client_auth",
  ],
  introspection_endpoint: `${issuer}/oauth2/introspect`,
  introspection_endpoint_auth_methods_supported: [
    "client_secret_basic",
    "client_secret_post",
    "client_secret_jwt",
    "private_key_jwt",
    "tls_client_auth",
    "self_signed_tls_client_auth",
  ],
  code_challenge_methods_supported: ["S256"],
  tls_client_certificate_bound_access_tokens: false,
  dpop_signing_alg_values_supported: ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid"],
};

export function GET() {
  return new Response(JSON.stringify(metadata), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
