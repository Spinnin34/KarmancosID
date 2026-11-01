<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { LayoutDashboard, FileText, AppWindow, Users, Monitor, History, ChevronRight, ArrowUpRight, ShieldCheck, Plus, Copy, Eye, EyeOff, Pencil, KeyRound } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import Input from "@/components/ui/Input.vue";
import Link from "@/components/ui/Link.vue";
import Modal from "@/components/ui/Modal.vue";
import Select from "@/components/ui/Select.vue";
import Table from "@/components/ui/Table.vue";
import Textarea from "@/components/ui/Textarea.vue";
import ActivityTimelineCard from "@/components/compositions/ActivityTimelineCard.vue";
import AdminUsersPanel from "./AdminUsersPanel.vue";
import type { AccountFilter, AdminUser } from "./contracts";
import { identityApi, IdentityApiError } from "@/lib/identity-api";

type SectionId = "overview" | "applications" | "clients" | "users" | "sessions" | "activity";
type Overview = { accounts: number; clients: number; activeSessions: number };
type Client = {
  id: string; clientId: string; name: string; clientType: "public" | "confidential";
  redirectUris: string[]; allowedOrigins: string[]; postLogoutRedirectUris: string[];
  backchannelLogoutUri: string; scopes: string[]; secretAvailable: boolean; createdAt: string;
};
type User = AdminUser;
type Session = { reference: string; email: string | null; createdAt: string; lastAccessedAt: string };
type Activity = { id: string; actor: string; action: string; subject: string; occurredAt: string };
type Application = {
  id: string; name: string; contactEmail: string; description: string; clientType: "public" | "confidential";
  redirectUris: string[]; postLogoutRedirectUris: string[]; backchannelLogoutUri: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string; reviewedAt: string | null;
};
type CurrentUser = { id: string; email: string; displayName: string; role: string };

const sections = [
  { id: "overview", title: "Resumen", icon: LayoutDashboard },
  { id: "applications", title: "Solicitudes", icon: FileText },
  { id: "clients", title: "Sitios conectados", icon: AppWindow },
  { id: "users", title: "Cuentas", icon: Users },
  { id: "sessions", title: "Sesiones", icon: Monitor },
  { id: "activity", title: "Actividad", icon: History }
];
const activeSection = ref<SectionId>("overview");
const loading = ref(true);
const error = ref("");
const overview = ref<Overview>({ accounts: 0, clients: 0, activeSessions: 0 });
const clients = ref<Client[]>([]);
const applications = ref<Application[]>([]);
const users = ref<User[]>([]);
const sessions = ref<Session[]>([]);
const activity = ref<Activity[]>([]);
const currentUser = ref<CurrentUser | null>(null);
const creatingClient = ref(false);
const accountQuery = ref("");
const accountFilter = ref<AccountFilter>("all");
const editingUser = ref<User | null>(null);
const userDialogOpen = ref(false);
const savingUser = ref(false);
const userProfileError = ref("");
const profileDraft = ref({ username: "", firstName: "", lastName: "", secondLastName: "", email: "" });
const clientName = ref("");
const clientType = ref("confidential");
const clientQuery = ref("");
const redirectUrisText = ref("");
const postLogoutUrisText = ref("");
const backchannelLogoutUriText = ref("");
const allowedOriginsText = ref("");
const clientError = ref("");
const clientNotice = ref("");
const clientSecretCache = ref<Record<string, string>>({});
const visibleClientSecrets = ref<Record<string, boolean>>({});
const clientSecretBusy = ref<Record<string, boolean>>({});
const clientSecretMessages = ref<Record<string, string>>({});
const copiedClientSecretId = ref("");
const editingClient = ref<Client | null>(null);
const clientDialogOpen = ref(false);
const savingClient = ref(false);
const clientEditError = ref("");
const clientEditDraft = ref({ name: "", redirectUris: "", allowedOrigins: "", postLogoutRedirectUris: "", backchannelLogoutUri: "" });
const reviewingApplicationId = ref("");

const clientTypeOptions = [
  { label: "Confidencial · servidor", value: "confidential" },
  { label: "Público · app o SPA", value: "public" }
];

const sectionTitle = computed(() => sections.find((section) => section.id === activeSection.value)?.title ?? "Resumen");
const sectionDescription = computed(() => ({
  overview: "Una visión de las cuentas, servicios y accesos de tu organización.",
  applications: "Revisa las aplicaciones que quieren conectar con Karmancos ID.",
  clients: "Gestiona los servicios que utilizan tu proveedor de identidad.",
  users: "Administra los perfiles y el acceso de cada persona.",
  sessions: "Consulta y controla los accesos activos a la plataforma.",
  activity: "Todos los cambios importantes, en un mismo lugar."
})[activeSection.value]);
const filteredClients = computed(() => {
  const query = clientQuery.value.trim().toLocaleLowerCase("es");
  if (!query) return clients.value;
  return clients.value.filter((client) => [
    client.name,
    client.clientId,
    ...client.redirectUris,
    ...client.allowedOrigins,
    ...client.postLogoutRedirectUris,
    client.backchannelLogoutUri,
  ].join(" ").toLocaleLowerCase("es").includes(query));
});
const activityActors = computed(() => new Set(activity.value.map((event) => event.actor)).size);
const timelineEvents = computed(() => activity.value.map((event) => ({
  id: event.id,
  actor: event.actor,
  initials: initials(event.actor),
  action: actionLabel(event.action),
  target: event.subject,
  time: relativeTime(event.occurredAt)
})));
function focusClientName() {
  navigateSection("clients");
  document.getElementById("client-name")?.focus();
}

function syncSectionFromLocation() {
  const requestedSection = window.location.hash.slice(1);
  const nextSection = sections.some((section) => section.id === requestedSection)
    ? requestedSection as SectionId
    : "overview";
  const changed = activeSection.value !== nextSection;
  activeSection.value = nextSection;
  if (changed) scrollAdminToTop();
}

function navigateSection(section: SectionId) {
  const changed = activeSection.value !== section;
  activeSection.value = section;
  if (window.location.hash !== `#${section}`) window.history.pushState(null, "", `#${section}`);
  if (changed) scrollAdminToTop();
}

function scrollAdminToTop() {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  });
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    return await identityApi<T>(path, options);
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 401) {
      window.location.assign("/login");
    }
    throw cause;
  }
}

async function loadDashboard() {
  loading.value = true;
  error.value = "";
  try {
    const [me, overviewData, clientData, applicationData, userData, sessionData, activityData] = await Promise.all([
      api<CurrentUser>("/api/auth/me"),
      api<Overview>("/api/admin/overview"),
      api<Client[]>("/api/admin/clients"),
      api<Application[]>("/api/admin/applications"),
      api<User[]>("/api/admin/users"),
      api<Session[]>("/api/admin/sessions"),
      api<Activity[]>("/api/admin/activity")
    ]);
    currentUser.value = me;
    overview.value = overviewData;
    clients.value = clientData;
    applications.value = applicationData;
    users.value = userData;
    sessions.value = sessionData;
    activity.value = activityData;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo cargar el panel.";
  } finally {
    loading.value = false;
  }
}

async function reviewApplication(application: Application, status: "APPROVED" | "REJECTED") {
  reviewingApplicationId.value = application.id;
  error.value = "";
  try {
    await api<Application>(`/api/admin/applications/${encodeURIComponent(application.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    await loadDashboard();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo revisar la solicitud.";
  } finally {
    reviewingApplicationId.value = "";
  }
}

function prepareClientFromApplication(application: Application) {
  clientName.value = application.name;
  clientType.value = application.clientType;
  redirectUrisText.value = application.redirectUris.join("\n");
  postLogoutUrisText.value = application.postLogoutRedirectUris.join("\n");
  backchannelLogoutUriText.value = application.backchannelLogoutUri ?? "";
  allowedOriginsText.value = [...new Set(application.redirectUris.map((uri) => new URL(uri).origin))].join("\n");
  clientError.value = "";
  navigateSection("clients");
  window.setTimeout(() => document.getElementById("client-name")?.focus(), 0);
}

function redirectList(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function createClient() {
  clientError.value = "";
  clientNotice.value = "";
  const redirectUris = redirectList(redirectUrisText.value);
  if (!clientName.value.trim() || redirectUris.length === 0) {
    clientError.value = "Escribe un nombre y al menos una URL de retorno.";
    return;
  }
  creatingClient.value = true;
  try {
    const created = await api<{ id: string; clientId: string; clientSecret: string | null; note: string }>("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: clientName.value,
        clientType: clientType.value,
        redirectUris,
        allowedOrigins: redirectList(allowedOriginsText.value),
        postLogoutRedirectUris: redirectList(postLogoutUrisText.value),
        backchannelLogoutUri: backchannelLogoutUriText.value.trim()
      })
    });
    if (created.clientSecret) clientSecretCache.value[created.id] = created.clientSecret;
    clientNotice.value = created.clientSecret
      ? "Sitio registrado. Su secreto queda oculto en la tarjeta y puedes mostrarlo o copiarlo cuando lo necesites."
      : "Sitio público registrado. No utiliza secreto de cliente.";
    clientName.value = "";
    redirectUrisText.value = "";
    postLogoutUrisText.value = "";
    backchannelLogoutUriText.value = "";
    allowedOriginsText.value = "";
    await loadDashboard();
  } catch (cause) {
    clientError.value = cause instanceof Error ? cause.message : "No se pudo registrar el cliente.";
  } finally {
    creatingClient.value = false;
  }
}

function openClientEditor(client: Client) {
  editingClient.value = client;
  clientEditDraft.value = {
    name: client.name,
    redirectUris: client.redirectUris.join("\n"),
    allowedOrigins: client.allowedOrigins.join("\n"),
    postLogoutRedirectUris: client.postLogoutRedirectUris.join("\n"),
    backchannelLogoutUri: client.backchannelLogoutUri,
  };
  clientEditError.value = "";
  clientDialogOpen.value = true;
}

async function saveClient() {
  if (!editingClient.value) return;
  clientEditError.value = "";
  const redirectUris = redirectList(clientEditDraft.value.redirectUris);
  if (!clientEditDraft.value.name.trim()) {
    clientEditError.value = "Escribe un nombre para el sitio.";
    return;
  }
  if (redirectUris.length === 0) {
    clientEditError.value = "Añade al menos una URL de retorno.";
    return;
  }
  savingClient.value = true;
  try {
    await api(`/api/admin/clients/${encodeURIComponent(editingClient.value.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: clientEditDraft.value.name,
        redirectUris,
        allowedOrigins: redirectList(clientEditDraft.value.allowedOrigins),
        postLogoutRedirectUris: redirectList(clientEditDraft.value.postLogoutRedirectUris),
        backchannelLogoutUri: clientEditDraft.value.backchannelLogoutUri.trim(),
      }),
    });
    clientNotice.value = `Cambios guardados para ${clientEditDraft.value.name.trim()}.`;
    clientDialogOpen.value = false;
    await loadDashboard();
  } catch (cause) {
    clientEditError.value = cause instanceof Error ? cause.message : "No se pudieron guardar los datos del sitio.";
  } finally {
    savingClient.value = false;
  }
}

function clientSecretText(client: Client) {
  if (!visibleClientSecrets.value[client.id]) return "••••••••••••••••••••";
  return clientSecretCache.value[client.id] ?? "";
}

async function loadClientSecret(client: Client, rotate = false) {
  const result = await api<{ secret: string }>(`/api/admin/clients/${encodeURIComponent(client.id)}/secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rotate ? { rotate: true } : {}),
  });
  clientSecretCache.value[client.id] = result.secret;
  return result.secret;
}

async function toggleClientSecret(client: Client) {
  if (visibleClientSecrets.value[client.id]) {
    visibleClientSecrets.value[client.id] = false;
    delete clientSecretCache.value[client.id];
    return;
  }
  clientSecretBusy.value[client.id] = true;
  clientSecretMessages.value[client.id] = "";
  try {
    if (!clientSecretCache.value[client.id]) await loadClientSecret(client);
    visibleClientSecrets.value[client.id] = true;
  } catch (cause) {
    clientSecretMessages.value[client.id] = cause instanceof Error ? cause.message : "No se pudo mostrar el secreto.";
  } finally {
    clientSecretBusy.value[client.id] = false;
  }
}

async function copyClientSecret(client: Client) {
  clientSecretBusy.value[client.id] = true;
  clientSecretMessages.value[client.id] = "";
  try {
    const secret = clientSecretCache.value[client.id] ?? await loadClientSecret(client);
    await navigator.clipboard.writeText(secret);
    copiedClientSecretId.value = client.id;
    clientSecretMessages.value[client.id] = "Secreto copiado al portapapeles.";
    window.setTimeout(() => {
      if (copiedClientSecretId.value === client.id) copiedClientSecretId.value = "";
    }, 1800);
    if (!visibleClientSecrets.value[client.id]) delete clientSecretCache.value[client.id];
  } catch (cause) {
    clientSecretMessages.value[client.id] = cause instanceof Error ? cause.message : "No se pudo copiar el secreto.";
  } finally {
    clientSecretBusy.value[client.id] = false;
  }
}

async function rotateClientSecret(client: Client) {
  const detail = client.secretAvailable
    ? "El secreto actual dejará de funcionar inmediatamente."
    : "El secreto anterior no se puede recuperar y dejará de funcionar.";
  if (!window.confirm(`¿Generar un secreto nuevo para ${client.name}? ${detail} Actualiza después la credencial en el servidor del sitio.`)) return;
  clientSecretBusy.value[client.id] = true;
  clientSecretMessages.value[client.id] = "";
  try {
    await loadClientSecret(client, true);
    visibleClientSecrets.value[client.id] = false;
    clientSecretMessages.value[client.id] = "Secreto renovado. Cópialo y actualiza la configuración del sitio.";
    await loadDashboard();
  } catch (cause) {
    clientSecretMessages.value[client.id] = cause instanceof Error ? cause.message : "No se pudo renovar el secreto.";
  } finally {
    clientSecretBusy.value[client.id] = false;
  }
}

async function copyClientId(client: Client) {
  try {
    await navigator.clipboard.writeText(client.clientId);
    clientNotice.value = `Identificador copiado: ${client.clientId}`;
  } catch {
    clientNotice.value = "El navegador no permitió copiar el identificador.";
  }
}

async function deleteClient(client: Client) {
  if (!window.confirm(`Eliminar “${client.name}” y revocar sus autorizaciones?`)) return;
  try {
    await api<void>(`/api/admin/clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
    delete clientSecretCache.value[client.id];
    delete visibleClientSecrets.value[client.id];
    await loadDashboard();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo eliminar el cliente.";
  }
}

async function updateUser(user: User, patch: { active?: boolean; role?: string }) {
  const verb = patch.active === false ? "bloquear" : patch.active === true ? "reactivar" : patch.role === "ADMIN" ? "dar permisos de administración a" : "retirar los permisos de administración de";
  if (!window.confirm(`¿Quieres ${verb} ${user.email}?`)) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(user.id)}/access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    await loadDashboard();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo actualizar la cuenta.";
  }
}

function openUserEditor(user: User) {
  editingUser.value = user;
  profileDraft.value = {
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    secondLastName: user.secondLastName ?? "",
    email: user.email
  };
  userProfileError.value = "";
  userDialogOpen.value = true;
}

async function saveUserProfile() {
  if (!editingUser.value) return;
  if (!window.confirm(`Guardar cambios en ${editingUser.value.email}? Se cerrarán sus sesiones y se revocarán sus autorizaciones actuales.`)) return;
  savingUser.value = true;
  userProfileError.value = "";
  try {
    await api(`/api/admin/users/${encodeURIComponent(editingUser.value.id)}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileDraft.value)
    });
    editingUser.value = null;
    await loadDashboard();
  } catch (cause) {
    userProfileError.value = cause instanceof Error ? cause.message : "No se pudo guardar la cuenta.";
  } finally {
    savingUser.value = false;
  }
}

async function revokeSession(session: Session) {
  if (!window.confirm(`¿Cerrar la sesión de ${session.email || "esta cuenta"}?`)) return;
  try {
    await api<void>(`/api/admin/sessions/${encodeURIComponent(session.reference)}`, { method: "DELETE" });
    await loadDashboard();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo cerrar la sesión.";
  }
}

async function signOut() {
  try {
    await api<void>("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.assign("/login");
  }
}

function initials(value: string) {
  return value.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "K";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    "account.created": "creó la cuenta",
    "account.signed_in": "inició sesión",
    "account.access_changed": "actualizó el acceso de",
    "account.profile_changed": "actualizó su perfil",
    "account.profile_admin_changed": "actualizó la cuenta de",
    "account.password_changed": "cambió su contraseña",
    "sessions.others_revoked": "cerró otras sesiones de",
    "client.created": "registró el servicio",
    "client.deleted": "eliminó el servicio",
    "session.revoked": "cerró una sesión"
  };
  return labels[action] || "actualizó";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "ahora";
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86400)} d`;
}

onMounted(() => {
  syncSectionFromLocation();
  window.addEventListener("popstate", syncSectionFromLocation);
  window.addEventListener("hashchange", syncSectionFromLocation);
  loadDashboard().catch(() => {
    error.value = "No se pudo conectar con el servicio de identidad.";
    loading.value = false;
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", syncSectionFromLocation);
  window.removeEventListener("hashchange", syncSectionFromLocation);
  clientSecretCache.value = {};
});
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <a class="brand-lockup" href="/admin#overview" aria-label="Karmancos ID, resumen de administración">
        <span class="brand-mark" aria-hidden="true"><img src="/images/karmancos-id-mark.png" alt="" /></span>
        <span class="brand-name">KARMANCOS<span>ID</span></span>
      </a>
      <p class="admin-navigation-label">Espacio de trabajo</p>
      <nav aria-label="Administración de identidad">
        <Link
          v-for="section in sections"
          :key="section.id"
          :href="`#${section.id}`"
          variant="outline"
          color="secondary"
          size="sm"
          class="nav-button"
          :prefix-icon="section.icon"
          :aria-current="activeSection === section.id ? 'page' : undefined"
        >
          {{ section.title }}
        </Link>
      </nav>
      <div class="admin-sidebar-bottom">
        <div class="admin-security-note"><ShieldCheck :size="19" :stroke-width="1.5" /><span>Centro de identidad<strong>Karmancos ID</strong></span></div>
        <Link href="/cuenta#profile" variant="text" color="secondary" size="sm" class="admin-sidebar-profile">
          <span class="admin-profile-avatar">{{ initials(currentUser?.displayName || 'Karmancos') }}</span>
          <span><strong>{{ currentUser?.displayName || 'Mi cuenta' }}</strong><small>Administración</small></span><ArrowUpRight :size="15" />
        </Link>
      </div>
    </aside>

    <div class="admin-workspace">
      <header class="admin-topbar">
        <div>
          <span class="admin-breadcrumb">Administración <ChevronRight :size="13" /> <strong>{{ sectionTitle }}</strong></span>
        </div>
        <div class="table-actions">
          <Link class="admin-account-link" href="/cuenta#profile" variant="text" color="secondary" size="sm">Mi cuenta</Link>
          <span v-if="currentUser" class="account-meta">{{ currentUser.email }}</span>
          <Button variant="outline" color="secondary" size="sm" type="button" @click="signOut">Cerrar sesión</Button>
        </div>
      </header>

      <main class="admin-main">
        <div v-if="loading" class="loading-state" role="status">Cargando cuentas y servicios…</div>
        <div v-else-if="error" class="error-state" role="alert">{{ error }}</div>

        <template v-else>
          <div class="admin-heading-row">
            <div>
              <h1>{{ sectionTitle }}</h1>
              <p class="admin-subtitle">{{ sectionDescription }}</p>
            </div>
            <Button v-if="activeSection === 'clients'" variant="solid" size="md" type="button" @click="focusClientName">
              <Plus :size="16" /> Registrar sitio
            </Button>
          </div>

          <div v-if="activeSection === 'overview'" class="admin-overview">
            <div class="metric-strip" aria-label="Estado actual">
              <div class="metric"><span class="metric-icon"><Users :size="20" :stroke-width="1.5" /></span><span>Cuentas</span><strong>{{ overview.accounts }}</strong><small>Identidades registradas</small></div>
              <div class="metric"><span class="metric-icon"><AppWindow :size="20" :stroke-width="1.5" /></span><span>Clientes OIDC</span><strong>{{ overview.clients }}</strong><small>Servicios conectados</small></div>
              <div class="metric"><span class="metric-icon"><Monitor :size="20" :stroke-width="1.5" /></span><span>Sesiones activas</span><strong>{{ overview.activeSessions }}</strong><small>Accesos en este momento</small></div>
            </div>
            <div class="admin-columns">
              <section class="admin-section">
                <div class="admin-section-heading"><div><h2>Servicios conectados</h2><p>Dominios autorizados para usar Karmancos ID.</p></div></div>
                <div v-if="clients.length" class="table-wrap">
                  <Table caption="Servicios conectados a Karmancos ID" variant="surface" density="compact" :column-count="4" hover>
                    <template #header><thead><tr><th scope="col">Servicio</th><th scope="col">Tipo</th><th scope="col">Retornos</th><th scope="col">Creado</th></tr></thead></template>
                    <tbody><tr v-for="client in clients.slice(0, 5)" :key="client.id"><th scope="row"><div class="table-cell-main"><strong>{{ client.name }}</strong><small>{{ client.clientId }}</small></div></th><td data-label="Tipo"><Badge variant="soft" :color="client.clientType === 'public' ? 'info' : 'accent'">{{ client.clientType === 'public' ? 'Público' : 'Confidencial' }}</Badge></td><td data-label="Retornos">{{ client.redirectUris.length }}</td><td data-label="Creado">{{ formatDate(client.createdAt) }}</td></tr></tbody>
                  </Table>
                </div>
                <div v-else class="empty-state">Aún no hay sitios conectados. Registra el primer cliente OIDC.</div>
              </section>
              <section class="admin-section activity-list">
                <ActivityTimelineCard
                  v-if="timelineEvents.length"
                  title="Actividad reciente"
                  description="Cambios registrados en el centro de identidad."
                  :events="timelineEvents.slice(0, 5)"
                  shadow="none"
                />
                <div v-else class="empty-state">La actividad de las cuentas y los servicios aparecerá aquí.</div>
              </section>
            </div>
          </div>

          <section v-else-if="activeSection === 'applications'" class="admin-section">
            <div class="admin-section-heading"><div><h2>Solicitudes de integración</h2><p>Revisa el servicio y sus URL antes de aprobar. Aprobar no activa acceso: después hay que registrar el cliente.</p></div><Badge variant="soft" color="info">{{ applications.filter((item) => item.status === 'PENDING').length }} por revisar</Badge></div>
            <div v-if="applications.length" class="application-review-list">
              <article v-for="application in applications" :key="application.id" class="application-review-card">
                <div class="admin-section-heading">
                  <div><h3>{{ application.name }}</h3><p>{{ application.contactEmail }} · {{ formatDate(application.submittedAt) }}</p></div>
                  <Badge variant="soft" :color="application.status === 'PENDING' ? 'warning' : application.status === 'APPROVED' ? 'success' : 'destructive'">{{ application.status === 'PENDING' ? 'Pendiente' : application.status === 'APPROVED' ? 'Aprobada' : 'Rechazada' }}</Badge>
                </div>
                <p>{{ application.description }}</p>
                <p><strong>Tipo:</strong> {{ application.clientType === 'public' ? 'Público · navegador o app' : 'Confidencial · servidor' }}</p>
                <div><strong>URL de retorno</strong><ul><li v-for="uri in application.redirectUris" :key="uri"><code>{{ uri }}</code></li></ul></div>
                <div v-if="application.postLogoutRedirectUris.length"><strong>URL de salida</strong><ul><li v-for="uri in application.postLogoutRedirectUris" :key="uri"><code>{{ uri }}</code></li></ul></div>
                <div v-if="application.backchannelLogoutUri"><strong>Endpoint de cierre de sesión interno</strong><p><code>{{ application.backchannelLogoutUri }}</code></p></div>
                <div class="table-actions">
                  <template v-if="application.status === 'PENDING'">
                    <Button variant="solid" size="sm" type="button" :loading="reviewingApplicationId === application.id" @click="reviewApplication(application, 'APPROVED')">Aprobar revisión</Button>
                    <Button variant="outline" color="destructive" size="sm" type="button" :disabled="reviewingApplicationId === application.id" @click="reviewApplication(application, 'REJECTED')">Rechazar</Button>
                  </template>
                  <Button v-else-if="application.status === 'APPROVED'" variant="outline" size="sm" type="button" @click="prepareClientFromApplication(application)">Preparar registro del cliente</Button>
                </div>
              </article>
            </div>
            <div v-else class="empty-state">Todavía no se han recibido solicitudes de integración.</div>
          </section>

          <section v-else-if="activeSection === 'clients'" class="admin-columns client-management">
            <div class="admin-section client-directory">
              <div class="client-directory-heading">
                <div><h2>Sitios registrados</h2><p>Credenciales y direcciones de confianza para cada integración.</p></div>
                <Input id="client-search" v-model="clientQuery" label="Buscar sitios" placeholder="Nombre, ID o dominio" />
              </div>
              <p v-if="clientNotice" class="client-notice" role="status">{{ clientNotice }}</p>
              <div v-if="filteredClients.length" class="client-card-list">
                <article v-for="client in filteredClients" :key="client.id" class="client-card">
                  <header class="client-card-header">
                    <div class="client-card-title">
                      <span class="client-card-icon" aria-hidden="true"><AppWindow :size="20" :stroke-width="1.7" /></span>
                      <div><h3>{{ client.name }}</h3><p>{{ formatDate(client.createdAt) }}</p></div>
                    </div>
                    <div class="client-card-actions">
                      <Badge variant="soft" :color="client.clientType === 'public' ? 'info' : 'accent'">{{ client.clientType === 'public' ? 'Público' : 'Confidencial' }}</Badge>
                      <Button variant="outline" size="sm" type="button" :prefix-icon="Pencil" @click="openClientEditor(client)">Editar</Button>
                      <Button variant="outline" color="destructive" size="sm" type="button" @click="deleteClient(client)">Eliminar</Button>
                    </div>
                  </header>

                  <div class="client-id-row">
                    <span>ID del cliente</span><code>{{ client.clientId }}</code>
                    <Button variant="outline" size="sm" type="button" :prefix-icon="Copy" :aria-label="`Copiar ID de ${client.name}`" @click="copyClientId(client)">Copiar ID</Button>
                  </div>

                  <dl class="client-detail-grid">
                    <div><dt>URL de retorno</dt><dd v-for="uri in client.redirectUris" :key="uri"><code>{{ uri }}</code></dd></div>
                    <div><dt>Orígenes web</dt><dd v-for="origin in client.allowedOrigins" :key="origin"><code>{{ origin }}</code></dd><dd v-if="!client.allowedOrigins.length" class="client-detail-empty">No se usan desde el navegador</dd></div>
                    <div><dt>URL tras cerrar sesión</dt><dd v-for="uri in client.postLogoutRedirectUris" :key="uri"><code>{{ uri }}</code></dd><dd v-if="!client.postLogoutRedirectUris.length" class="client-detail-empty">No configurada</dd></div>
                    <div><dt>Cierre en este sitio</dt><dd v-if="client.backchannelLogoutUri"><code>{{ client.backchannelLogoutUri }}</code></dd><dd v-else class="client-detail-empty">Endpoint no configurado</dd></div>
                  </dl>

                  <div v-if="client.clientType === 'confidential'" class="client-secret-panel">
                    <div class="client-secret-heading">
                      <div><strong>Secreto del cliente</strong><small>{{ client.secretAvailable ? 'Guardado cifrado · solo se muestra bajo demanda' : 'El secreto antiguo no se puede recuperar' }}</small></div>
                      <Badge variant="soft" :color="client.secretAvailable ? 'success' : 'warning'">{{ client.secretAvailable ? 'Disponible' : 'Requiere rotación' }}</Badge>
                    </div>
                    <div class="client-secret-controls">
                      <code class="client-secret-value">{{ clientSecretText(client) }}</code>
                      <div class="table-actions">
                        <Button v-if="client.secretAvailable" variant="outline" size="sm" type="button" :prefix-icon="visibleClientSecrets[client.id] ? EyeOff : Eye" :loading="clientSecretBusy[client.id]" :aria-label="visibleClientSecrets[client.id] ? `Ocultar secreto de ${client.name}` : `Mostrar secreto de ${client.name}`" @click="toggleClientSecret(client)">{{ visibleClientSecrets[client.id] ? 'Ocultar' : 'Mostrar' }}</Button>
                        <Button v-if="client.secretAvailable" variant="outline" size="sm" type="button" :prefix-icon="Copy" :loading="clientSecretBusy[client.id]" @click="copyClientSecret(client)">{{ copiedClientSecretId === client.id ? 'Copiado' : 'Copiar' }}</Button>
                        <Button variant="outline" size="sm" type="button" :prefix-icon="KeyRound" :loading="clientSecretBusy[client.id]" @click="rotateClientSecret(client)">{{ client.secretAvailable ? 'Renovar secreto' : 'Generar secreto' }}</Button>
                      </div>
                    </div>
                    <p v-if="!client.secretAvailable" class="client-secret-help">Al generar uno nuevo, el anterior dejará de funcionar. Actualiza la credencial en el servidor del sitio.</p>
                    <p v-if="clientSecretMessages[client.id]" class="client-secret-message" role="status">{{ clientSecretMessages[client.id] }}</p>
                  </div>
                </article>
              </div>
              <div v-else-if="clients.length" class="empty-state">No hay sitios que coincidan con esa búsqueda.</div>
              <div v-else class="empty-state">Sin sitios conectados. Registra tu primera integración.</div>
              <p class="client-directory-hint">Las URL se validan antes de guardarse. Cada sitio debe usar su propio ID y mantener su secreto únicamente en su servidor.</p>
            </div>

            <form id="new-client-form" class="admin-form-panel" @submit.prevent="createClient">
              <div><p class="admin-section-kicker">NUEVA INTEGRACIÓN</p><h3>Registrar un sitio</h3><p>Crea credenciales OpenID Connect para un dominio concreto.</p></div>
              <Input id="client-name" v-model="clientName" label="Nombre del servicio" placeholder="Mi sitio Karmancos" required />
              <Select id="client-type" v-model="clientType" label="Tipo de aplicación" :options="clientTypeOptions" hint="Las apps públicas siempre requieren PKCE." />
              <Textarea id="redirect-uris" v-model="redirectUrisText" label="URL de retorno" :rows="3" :max-height="180" resizable="vertical" placeholder="https://mi-sitio.com/auth/callback" hint="Una URL exacta por línea. HTTPS es obligatorio fuera de localhost." required />
              <Textarea id="allowed-origins" v-model="allowedOriginsText" label="Orígenes web autorizados · para SDK de navegador" :rows="2" :max-height="140" resizable="vertical" placeholder="https://mi-sitio.com" hint="Origen exacto por línea; HTTPS obligatorio fuera de localhost." />
              <Textarea id="post-logout-uris" v-model="postLogoutUrisText" label="URL tras cerrar sesión · opcional" :rows="2" :max-height="140" resizable="vertical" placeholder="https://mi-sitio.com/" hint="Una URL exacta por línea." />
              <Input id="client-backchannel-logout" v-model="backchannelLogoutUriText" label="Endpoint de cierre de sesión interno · opcional" type="url" placeholder="https://mi-sitio.com/auth/backchannel-logout" hint="Debe validar el Logout Token y eliminar las sesiones locales del usuario." />
              <p v-if="clientError" class="form-message" role="alert">{{ clientError }}</p>
              <Button class="form-action" variant="solid" type="submit" :loading="creatingClient">Crear cliente</Button>
            </form>
          </section>

          <AdminUsersPanel
            v-else-if="activeSection === 'users'"
            :users="users"
            :current-user-id="currentUser?.id ?? null"
            :current-user-email="currentUser?.email ?? null"
            v-model:query="accountQuery"
            v-model:filter="accountFilter"
            @edit="openUserEditor"
            @access="updateUser"
          />

          <section v-else-if="activeSection === 'sessions'" class="admin-section">
            <div class="admin-section-heading"><div><h2>Sesiones activas</h2><p>Cierra sesiones que ya no deban tener acceso a Karmancos ID.</p></div></div>
            <div v-if="sessions.length" class="table-wrap">
              <Table caption="Sesiones activas de Karmancos ID" variant="surface" density="compact" :column-count="4" hover>
                <template #header><thead><tr><th scope="col">Cuenta</th><th scope="col">Inicio</th><th scope="col">Última actividad</th><th scope="col">Acción</th></tr></thead></template>
                <tbody><tr v-for="session in sessions" :key="session.reference"><th scope="row">{{ session.email || 'Cuenta sin índice' }}</th><td data-label="Inicio">{{ formatDate(session.createdAt) }}</td><td data-label="Última actividad">{{ formatDate(session.lastAccessedAt) }}</td><td data-label="Acción"><Button variant="outline" color="destructive" size="sm" type="button" @click="revokeSession(session)">Cerrar sesión</Button></td></tr></tbody>
              </Table>
            </div>
            <div v-else class="empty-state">No hay sesiones activas para mostrar.</div>
          </section>

          <section v-else-if="activeSection === 'activity'" class="admin-activity-layout">
            <div class="activity-feed">
              <ActivityTimelineCard v-if="timelineEvents.length" title="Registro de actividad" description="Cambios de cuenta, clientes y sesiones." :events="timelineEvents" shadow="none" />
              <div v-else class="empty-state">Todavía no hay actividad registrada.</div>
            </div>
            <aside class="activity-context">
              <span class="activity-context-icon"><History :size="25" :stroke-width="1.3" /></span>
              <h2>La historia de tu plataforma</h2>
              <p>Consulta quién hizo cada cambio y cuándo ocurrió.</p>
              <dl><div><dt>Eventos registrados</dt><dd>{{ activity.length }}</dd></div><div><dt>Personas con actividad</dt><dd>{{ activityActors }}</dd></div></dl>
              <div class="activity-privacy"><ShieldCheck :size="17" /><p>Las contraseñas y los secretos nunca se guardan en este historial.</p></div>
            </aside>
          </section>
        </template>
      </main>

      <Modal
        v-if="editingUser"
        id="admin-user-edit"
        v-model="userDialogOpen"
        title="Editar identidad"
        :description="`Actualiza los datos de ${editingUser.displayName}. Se cerrarán sus sesiones y tendrá que volver a iniciar sesión.`"
        presentation="dialog"
        variant="surface"
        size="lg"
        close-label="Cerrar edición de cuenta"
      >
        <template #eyebrow><p class="admin-section-kicker">GESTIÓN DE CUENTAS</p></template>
        <p class="admin-dialog-intro">Los sitios conectados sabrán que un correo nuevo aún no está verificado.</p>
        <form id="admin-user-edit-form" class="admin-user-edit-form" @submit.prevent="saveUserProfile">
          <Input id="edit-user-first-name" v-model="profileDraft.firstName" label="Nombre" autocomplete="given-name" maxlength="80" required />
          <Input id="edit-user-last-name" v-model="profileDraft.lastName" label="Primer apellido" autocomplete="family-name" maxlength="80" required />
          <Input id="edit-user-second-last-name" v-model="profileDraft.secondLastName" label="Segundo apellido" autocomplete="additional-name" maxlength="80" />
          <Input id="edit-user-username" v-model="profileDraft.username" label="Nombre de usuario" autocomplete="username" minlength="3" maxlength="32" required />
          <Input id="edit-user-email" v-model="profileDraft.email" label="Correo electrónico" type="email" autocomplete="email" maxlength="320" required />
          <p v-if="userProfileError" class="form-message" role="alert">{{ userProfileError }}</p>
        </form>
        <template #footer="{ close }">
          <Button variant="outline" type="button" @click="close">Cancelar</Button>
          <Button variant="solid" type="submit" form="admin-user-edit-form" :loading="savingUser">Guardar cambios</Button>
        </template>
      </Modal>

      <Modal
        v-if="editingClient"
        id="admin-client-edit"
        v-model="clientDialogOpen"
        title="Editar sitio conectado"
        :description="`Actualiza el nombre y las direcciones de confianza de ${editingClient.name}. El ID y el tipo de cliente se mantienen.`"
        presentation="dialog"
        variant="surface"
        size="lg"
        close-label="Cerrar edición del sitio"
      >
        <template #eyebrow><p class="admin-section-kicker">CONFIGURACIÓN DEL SITIO</p></template>
        <div class="admin-dialog-intro"><p><strong>ID del cliente:</strong> <code>{{ editingClient.clientId }}</code></p><p>Usa URLs exactas y comprueba los cambios con el responsable del sitio antes de guardarlos.</p></div>
        <form id="admin-client-edit-form" class="client-edit-form" @submit.prevent="saveClient">
          <Input id="edit-client-name" v-model="clientEditDraft.name" label="Nombre del sitio" maxlength="100" required />
          <Textarea id="edit-client-redirects" v-model="clientEditDraft.redirectUris" label="URL de retorno" :rows="3" :max-height="170" placeholder="https://sitio.com/auth/callback" hint="Una URL exacta por línea. Debe coincidir con la configuración del sitio." required />
          <Textarea id="edit-client-origins" v-model="clientEditDraft.allowedOrigins" label="Orígenes web autorizados" :rows="2" :max-height="130" placeholder="https://sitio.com" hint="Solo para SDK de navegador. Una URL de origen por línea." />
          <Textarea id="edit-client-post-logout" v-model="clientEditDraft.postLogoutRedirectUris" label="URL tras cerrar sesión" :rows="2" :max-height="130" placeholder="https://sitio.com/" hint="Opcional. Una URL exacta por línea." />
          <Input id="edit-client-backchannel" v-model="clientEditDraft.backchannelLogoutUri" label="Endpoint para cerrar sesión en este sitio" type="url" placeholder="https://sitio.com/auth/backchannel-logout" hint="Opcional. El sitio debe validar el Logout Token para borrar su sesión local." />
          <p v-if="clientEditError" class="form-message" role="alert">{{ clientEditError }}</p>
        </form>
        <template #footer="{ close }">
          <Button variant="outline" type="button" @click="close">Cancelar</Button>
          <Button variant="solid" type="submit" form="admin-client-edit-form" :loading="savingClient">Guardar cambios</Button>
        </template>
      </Modal>
    </div>
  </div>
</template>
