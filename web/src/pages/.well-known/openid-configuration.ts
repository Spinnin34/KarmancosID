export const prerender = true;

const issuer = (import.meta.env.PUBLIC_IDENTITY_ISSUER || process.env.KARMANCOS_ISSUER || "http://localhost:4321").replace(/\/+$/, "");

const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/oauth2/authorize`,
  token_endpoint: `${issuer}/oauth2/token`,
  token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
  jwks_uri: `${issuer}/oauth2/jwks`,
  userinfo_endpoint: `${issuer}/userinfo`,
  end_session_endpoint: `${issuer}/connect/logout`,
  backchannel_logout_supported: true,
  backchannel_logout_session_supported: false,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  revocation_endpoint: `${issuer}/oauth2/revoke`,
  revocation_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
  introspection_endpoint: `${issuer}/oauth2/introspect`,
  introspection_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
  code_challenge_methods_supported: ["S256"],
  subject_types_supported: ["pairwise"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "profile", "email"],
  claims_supported: [
    "sub",
    "name",
    "preferred_username",
    "given_name",
    "family_name",
    "picture",
    "role",
    "email",
    "email_verified",
  ],
};

export function GET() {
  return new Response(JSON.stringify(metadata), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
    },
  });
}
