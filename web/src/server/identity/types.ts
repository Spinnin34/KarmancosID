import type { Binary } from "mongodb";

export type IdentityRole = "USER" | "ADMIN";

export interface IdentityUser {
  _id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  secondLastName: string;
  displayName: string;
  profilePicture?: Buffer | Uint8Array | Binary | null;
  profilePictureContentType?: string | null;
  profilePictureUpdatedAt?: Date | string | null;
  passwordHash: string;
  role: IdentityRole;
  active: boolean;
  emailVerified: boolean;
  createdAt: Date | string;
}

export interface IdentitySession {
  _id: string;
  userId: string | null;
  email: string | null;
  csrfToken: string;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;
  userAgent?: string;
  requestedAuthorization?: AuthorizationRequest;
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  responseType: "code";
  scopes: string[];
  state: string;
  nonce?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: number;
}

export interface OAuthClient {
  _id: string;
  clientId: string;
  clientSecret?: string;
  clientName: string;
  clientAuthenticationMethods: string[];
  authorizationGrantTypes: string[];
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedOrigins: string[];
  scopes: string[];
  requireProofKey: boolean;
  requireAuthorizationConsent: boolean;
  accessTokenTimeToLive: string;
  refreshTokenTimeToLive: string;
  reuseRefreshTokens: boolean;
  accessTokenFormat: string;
  clientIdIssuedAt?: Date;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}
