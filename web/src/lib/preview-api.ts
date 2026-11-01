interface PreviewRequestInit {
  method?: string;
  body?: BodyInit | Record<string, unknown> | null;
}

export class PreviewApiError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "PreviewApiError";
  }
}

type PreviewClient = {
  id: string;
  clientId: string;
  name: string;
  clientType: "public" | "confidential";
  redirectUris: string[];
  allowedOrigins: string[];
  postLogoutRedirectUris: string[];
  backchannelLogoutUri: string;
  secretAvailable: boolean;
  scopes: string[];
  createdAt: string;
};

type PreviewApplication = {
  id: string;
  name: string;
  contactEmail: string;
  description: string;
  clientType: "public" | "confidential";
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt: string | null;
};

const now = new Date("2026-10-31T16:40:00.000Z").toISOString();
const yesterday = new Date("2026-10-30T10:15:00.000Z").toISOString();

const demoUser = {
  id: "preview-admin",
  email: "lucia@karmancos.test",
  emailVerified: false,
  username: "lucia.martin",
  displayName: "Lucía Martín",
  role: "ADMIN",
  firstName: "Lucía",
  lastName: "Martín",
  secondLastName: "Soler",
  picture: null,
};

let clients: PreviewClient[] = [
  {
    id: "site-atlas",
    clientId: "kmc_atlas_web_preview",
    name: "Atlas Workspace",
    clientType: "public",
    redirectUris: ["https://atlas.example.test/auth/callback"],
    allowedOrigins: ["https://atlas.example.test"],
    postLogoutRedirectUris: ["https://atlas.example.test/"],
    backchannelLogoutUri: "",
    secretAvailable: false,
    scopes: ["openid", "profile", "email"],
    createdAt: yesterday,
  },
  {
    id: "site-console",
    clientId: "kmc_console_preview",
    name: "Karmancos Console",
    clientType: "confidential",
    redirectUris: ["https://console.example.test/oidc/callback"],
    allowedOrigins: [],
    postLogoutRedirectUris: [],
    backchannelLogoutUri: "",
    secretAvailable: true,
    scopes: ["openid", "profile"],
    createdAt: now,
  },
];

let applications: PreviewApplication[] = [
  {
    id: "application-northstar",
    name: "Northstar Studio",
    contactEmail: "dev@northstar.example.test",
    description: "Herramienta colaborativa para organizar proyectos creativos.",
    clientType: "public",
    redirectUris: ["https://northstar.example.test/auth/callback"],
    postLogoutRedirectUris: ["https://northstar.example.test/"],
    status: "PENDING",
    submittedAt: now,
    reviewedAt: null,
  },
  {
    id: "application-atelier",
    name: "Atelier Archive",
    contactEmail: "engineering@atelier.example.test",
    description: "Archivo privado de referencias y documentos de equipo.",
    clientType: "confidential",
    redirectUris: ["https://atelier.example.test/identity/return"],
    postLogoutRedirectUris: [],
    status: "APPROVED",
    submittedAt: yesterday,
    reviewedAt: now,
  },
];

let users = [
  {
    id: "preview-admin",
    displayName: "Lucía Martín Soler",
    firstName: "Lucía", lastName: "Martín", secondLastName: "Soler",
    username: "lucia.martin",
    email: "lucia@karmancos.test",
    emailVerified: false,
    role: "ADMIN",
    active: true,
    picture: null,
    createdAt: yesterday,
  },
  {
    id: "preview-user",
    displayName: "Daniel Costa Ruiz",
    firstName: "Daniel", lastName: "Costa", secondLastName: "Ruiz",
    username: "daniel.costa",
    email: "daniel@karmancos.test",
    emailVerified: true,
    role: "USER",
    active: true,
    picture: null,
    createdAt: now,
  },
  {
    id: "preview-blocked",
    displayName: "Inés Vidal Serra",
    firstName: "Inés", lastName: "Vidal", secondLastName: "Serra",
    username: "ines.vidal",
    email: "ines@karmancos.test",
    emailVerified: false,
    role: "USER",
    active: false,
    picture: null,
    createdAt: yesterday,
  },
];

let accountSessions = [
  { reference: "preview-session-current", current: true, createdAt: now, lastAccessedAt: now },
  { reference: "preview-session-laptop", current: false, createdAt: yesterday, lastAccessedAt: now },
];

let adminSessions = [
  { reference: "preview-session-current", email: "lucia@karmancos.test", createdAt: now, lastAccessedAt: now },
  { reference: "preview-session-daniel", email: "daniel@karmancos.test", createdAt: yesterday, lastAccessedAt: now },
];

let connectedApps = [
  { id: "connected-atlas", name: "Atlas Workspace", scopes: ["profile", "email"] },
  { id: "connected-atelier", name: "Atelier Archive", scopes: ["profile"] },
];

const activity = [
  { id: "activity-one", actor: "Lucía Martín", action: "client.created", subject: "Atlas Workspace", occurredAt: now },
  { id: "activity-two", actor: "Daniel Costa", action: "account.signed_in", subject: "Karmancos ID", occurredAt: yesterday },
  { id: "activity-three", actor: "Lucía Martín", action: "account.profile_changed", subject: "", occurredAt: yesterday },
];

function currentPreviewState(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("preview_state") || "";
}

function isEmptyScenario(): boolean {
  return currentPreviewState() === "empty";
}

function bodyRecord(body: PreviewRequestInit["body"]): Record<string, unknown> {
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams) && !(body instanceof ArrayBuffer)) {
    return body as Record<string, unknown>;
  }
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function previewClients(): PreviewClient[] {
  return isEmptyScenario() ? [] : clients;
}

function previewApplications(): PreviewApplication[] {
  return isEmptyScenario() ? [] : applications;
}

function previewUsers() {
  return isEmptyScenario() ? [] : users;
}

function previewSessions() {
  return isEmptyScenario() ? [] : adminSessions;
}

function previewActivity() {
  return isEmptyScenario() ? [] : activity;
}

export async function handlePreviewRequest(path: string, init: PreviewRequestInit = {}): Promise<unknown> {
  const requestUrl = new URL(path, window.location.origin);
  const pathname = requestUrl.pathname;
  const method = (init.method || "GET").toUpperCase();
  const body = bodyRecord(init.body);
  const state = currentPreviewState();

  if (state === "error" && method === "GET") {
    throw new PreviewApiError("Error simulado en la vista previa. Vuelve al catálogo para abrir otro estado.", 503);
  }

  if (pathname === "/api/auth/continue" && method === "GET") {
    return { requested: true, name: "Atlas Workspace", domain: "atlas.example.test" };
  }
  if (pathname === "/api/auth/me" && method === "GET") return { ...demoUser };
  if (pathname === "/api/auth/login" && method === "POST") {
    if (state === "error") throw new PreviewApiError("No se pudo iniciar sesión en esta simulación.", 401);
    return { next: "/cuenta#profile" };
  }
  if (pathname === "/api/auth/mfa/verify" && method === "POST") return { next: "/admin#overview" };
  if (pathname === "/api/auth/register" && method === "POST") return { message: "Cuenta de ejemplo creada." };
  if (pathname === "/api/auth/recovery/complete" && method === "POST") {
    return { message: "Vista previa: la contraseña de ejemplo se ha actualizado." };
  }
  if (pathname === "/api/auth/mfa/setup" && method === "GET") {
    const secret = "JBSWY3DPEHPK3PXP";
    return {
      secret,
      uri: `otpauth://totp/Karmancos%20ID:demo%40karmancos.test?secret=${secret}&issuer=Karmancos%20ID`,
    };
  }
  if (pathname === "/api/auth/mfa/setup/verify" && method === "POST") {
    return {
      next: "/admin#overview",
      recoveryCodes: ["K4RM-8P2D", "N7QX-3L5M", "R2VW-9C6A", "T5HJ-4B8F", "Y3KD-7M2P", "C8LA-5R9W"],
    };
  }
  if (pathname === "/api/auth/logout" && method === "POST") return undefined;

  if (pathname === "/api/public/clients/demo-client" && method === "GET") {
    if (state === "long") return { name: "Karmancos Workspace para equipos de investigación y proyectos", domain: "workspace.investigacion.equipos.example.test" };
    return { name: "Atlas Workspace", domain: "atlas.example.test" };
  }
  if (pathname === "/api/public/applications" && method === "POST") {
    return { message: "Vista previa: la solicitud se ha simulado correctamente." };
  }

  if (pathname === "/api/account/sessions" && method === "GET") {
    return isEmptyScenario() ? [] : accountSessions;
  }
  if (pathname === "/api/account/sessions/revoke-others" && method === "POST") {
    accountSessions = accountSessions.filter((session) => session.current);
    return { message: "Vista previa: las otras sesiones se han cerrado." };
  }
  const accountSessionMatch = pathname.match(/^\/api\/account\/sessions\/([^/]+)$/);
  if (accountSessionMatch && method === "DELETE") {
    accountSessions = accountSessions.filter((session) => session.reference !== decodeURIComponent(accountSessionMatch[1]));
    return undefined;
  }
  if (pathname === "/api/account/apps" && method === "GET") {
    return isEmptyScenario() ? [] : connectedApps;
  }
  const connectedAppMatch = pathname.match(/^\/api\/account\/apps\/([^/]+)$/);
  if (connectedAppMatch && method === "DELETE") {
    connectedApps = connectedApps.filter((app) => app.id !== decodeURIComponent(connectedAppMatch[1]));
    return undefined;
  }
  if (pathname === "/api/account/profile" && method === "PATCH") {
    return { message: "Vista previa: el perfil se ha actualizado en memoria." };
  }
  if (pathname === "/api/account/password" && method === "POST") {
    return { message: "Vista previa: la contraseña se ha actualizado en memoria." };
  }
  if (pathname === "/api/account/picture" && method === "POST") {
    return { message: "Vista previa: imagen aplicada solo en esta sesión.", picture: "/images/karmancos-id-mark.png" };
  }
  if (pathname === "/api/account/picture" && method === "DELETE") {
    return { message: "Vista previa: imagen retirada.", picture: null };
  }

  if (pathname === "/api/admin/overview" && method === "GET") {
    return isEmptyScenario()
      ? { accounts: 0, clients: 0, activeSessions: 0 }
      : { accounts: users.length, clients: clients.length, activeSessions: adminSessions.length };
  }
  if (pathname === "/api/admin/clients" && method === "GET") return previewClients();
  if (pathname === "/api/admin/clients" && method === "POST") {
    const name = String(body.name || "Servicio de ejemplo");
    const redirectUris = Array.isArray(body.redirectUris) ? body.redirectUris.map(String) : [];
    const clientType = body.clientType === "public" ? "public" : "confidential";
    const created: PreviewClient = {
      id: `preview-client-${Date.now()}`,
      clientId: "kmc_preview_only",
      name,
      clientType,
      redirectUris,
      allowedOrigins: Array.isArray(body.allowedOrigins) ? body.allowedOrigins.map(String) : [],
      postLogoutRedirectUris: Array.isArray(body.postLogoutRedirectUris) ? body.postLogoutRedirectUris.map(String) : [],
      backchannelLogoutUri: String(body.backchannelLogoutUri || ""),
      secretAvailable: clientType === "confidential",
      scopes: ["openid", "profile"],
      createdAt: new Date().toISOString(),
    };
    clients = [...clients, created];
    return { id: created.id, clientId: created.clientId, clientSecret: created.secretAvailable ? "preview-only-not-a-valid-secret" : null, note: "Solo dato de ejemplo; no tiene validez." };
  }
  const adminClientSecretMatch = pathname.match(/^\/api\/admin\/clients\/([^/]+)\/secret$/);
  if (adminClientSecretMatch && method === "POST") {
    const client = clients.find((entry) => entry.id === decodeURIComponent(adminClientSecretMatch[1]));
    if (!client) throw new PreviewApiError("No se encontró ese sitio.", 404);
    if (client.clientType === "public") throw new PreviewApiError("Los clientes públicos no usan secreto.", 409);
    return { secret: "preview-only-not-a-valid-secret" };
  }
  const adminClientMatch = pathname.match(/^\/api\/admin\/clients\/([^/]+)$/);
  if (adminClientMatch && method === "PATCH") {
    const id = decodeURIComponent(adminClientMatch[1]);
    const existing = clients.find((client) => client.id === id);
    if (!existing) throw new PreviewApiError("No se encontró ese sitio.", 404);
    const clientType = body.clientType === "public" || body.clientType === "confidential"
      ? body.clientType
      : existing.clientType;
    clients = clients.map((client) => client.id === id ? {
      ...client,
      name: String(body.name || client.name),
      clientType,
      redirectUris: Array.isArray(body.redirectUris) ? body.redirectUris.map(String) : client.redirectUris,
      allowedOrigins: Array.isArray(body.allowedOrigins) ? body.allowedOrigins.map(String) : client.allowedOrigins,
      postLogoutRedirectUris: Array.isArray(body.postLogoutRedirectUris) ? body.postLogoutRedirectUris.map(String) : client.postLogoutRedirectUris,
      backchannelLogoutUri: String(body.backchannelLogoutUri || ""),
      secretAvailable: clientType === "confidential",
    } : client);
    return { message: "Vista previa: datos y tipo actualizados en memoria.", clientType, secretAvailable: clientType === "confidential" };
  }
  if (adminClientMatch && method === "DELETE") {
    clients = clients.filter((client) => client.id !== decodeURIComponent(adminClientMatch[1]));
    return undefined;
  }
  if (pathname === "/api/admin/applications" && method === "GET") return previewApplications();
  const applicationMatch = pathname.match(/^\/api\/admin\/applications\/([^/]+)$/);
  if (applicationMatch && method === "PATCH") {
    const id = decodeURIComponent(applicationMatch[1]);
    applications = applications.map((application) => application.id === id
      ? { ...application, status: body.status === "REJECTED" ? "REJECTED" : "APPROVED", reviewedAt: new Date().toISOString() }
      : application);
    return applications.find((application) => application.id === id);
  }
  if (pathname === "/api/admin/users" && method === "GET") return previewUsers();
  const userAccessMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/access$/);
  if (userAccessMatch && method === "PATCH") {
    const id = decodeURIComponent(userAccessMatch[1]);
    users = users.map((user) => user.id === id ? { ...user, ...body } : user);
    return { message: "Vista previa: acceso actualizado en memoria." };
  }
  const userProfileMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/profile$/);
  if (userProfileMatch && method === "PATCH") {
    const id = decodeURIComponent(userProfileMatch[1]);
    users = users.map((user) => user.id === id ? { ...user, ...body } : user);
    return { message: "Vista previa: perfil actualizado en memoria." };
  }
  if (pathname === "/api/admin/sessions" && method === "GET") return previewSessions();
  const adminSessionMatch = pathname.match(/^\/api\/admin\/sessions\/([^/]+)$/);
  if (adminSessionMatch && method === "DELETE") {
    adminSessions = adminSessions.filter((session) => session.reference !== decodeURIComponent(adminSessionMatch[1]));
    return undefined;
  }
  if (pathname === "/api/admin/activity" && method === "GET") return previewActivity();
  const recoveryCodeMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/recovery-code$/);
  if (recoveryCodeMatch && method === "POST") {
    return { recoveryCode: "PRVW-6K2M-9T4A", expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  }

  throw new PreviewApiError(`La vista previa no tiene una respuesta simulada para ${method} ${pathname}.`, 404);
}
