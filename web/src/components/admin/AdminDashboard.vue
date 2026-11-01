<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { LayoutDashboard, FileText, AppWindow, Users, Monitor, History, ChevronRight, ArrowUpRight, ShieldCheck, Plus } from "@lucide/vue";
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
  redirectUris: string[]; allowedOrigins: string[]; postLogoutRedirectUris: string[]; scopes: string[]; createdAt: string;
};
type User = AdminUser;
type Session = { reference: string; email: string | null; createdAt: string; lastAccessedAt: string };
type Activity = { id: string; actor: string; action: string; subject: string; occurredAt: string };
type Application = {
  id: string; name: string; contactEmail: string; description: string; clientType: "public" | "confidential";
  redirectUris: string[]; postLogoutRedirectUris: string[]; status: "PENDING" | "APPROVED" | "REJECTED";
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
const redirectUrisText = ref("");
const postLogoutUrisText = ref("");
const allowedOriginsText = ref("");
const clientError = ref("");
const newSecret = ref("");
const copiedSecret = ref(false);
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
  newSecret.value = "";
  const redirectUris = redirectList(redirectUrisText.value);
  if (!clientName.value.trim() || redirectUris.length === 0) {
    clientError.value = "Escribe un nombre y al menos una URL de retorno.";
    return;
  }
  creatingClient.value = true;
  try {
    const created = await api<{ clientId: string; clientSecret: string | null; note: string }>("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: clientName.value,
        clientType: clientType.value,
        redirectUris,
        allowedOrigins: redirectList(allowedOriginsText.value),
        postLogoutRedirectUris: redirectList(postLogoutUrisText.value)
      })
    });
    newSecret.value = created.clientSecret ?? "";
    clientName.value = "";
    redirectUrisText.value = "";
    postLogoutUrisText.value = "";
    allowedOriginsText.value = "";
    await loadDashboard();
  } catch (cause) {
    clientError.value = cause instanceof Error ? cause.message : "No se pudo registrar el cliente.";
  } finally {
    creatingClient.value = false;
  }
}

async function deleteClient(client: Client) {
  if (!window.confirm(`Eliminar “${client.name}” y revocar sus autorizaciones?`)) return;
  try {
    await api<void>(`/api/admin/clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
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

async function copySecret() {
  try {
    await navigator.clipboard.writeText(newSecret.value);
    copiedSecret.value = true;
  } catch {
    clientError.value = "El navegador no permitió copiarlo. Selecciona el secreto y guárdalo ahora.";
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

          <section v-else-if="activeSection === 'clients'" class="admin-columns">
            <div class="admin-section">
              <div class="admin-section-heading"><div><h2>Clientes registrados</h2><p>La URL de retorno debe coincidir exactamente con la de tu aplicación.</p></div></div>
              <div v-if="clients.length" class="table-wrap">
                <Table caption="Clientes registrados en Karmancos ID" variant="surface" density="compact" :column-count="4" hover>
                  <template #header><thead><tr><th scope="col">Servicio</th><th scope="col">Identificador</th><th scope="col">Tipo</th><th scope="col">Acción</th></tr></thead></template>
                  <tbody>
                    <tr v-for="client in clients" :key="client.id">
                      <th scope="row"><div class="table-cell-main"><strong>{{ client.name }}</strong><small>{{ client.redirectUris[0] }}</small></div></th>
                      <td data-label="Identificador"><code>{{ client.clientId }}</code></td>
                      <td data-label="Tipo"><Badge variant="soft" :color="client.clientType === 'public' ? 'info' : 'accent'">{{ client.clientType === 'public' ? 'Público' : 'Confidencial' }}</Badge></td>
                      <td data-label="Acción"><Button variant="outline" color="destructive" size="sm" type="button" @click="deleteClient(client)">Eliminar</Button></td>
                    </tr>
                  </tbody>
                </Table>
              </div>
              <div v-else class="empty-state">Sin clientes. Añade tu primera web o aplicación conectada.</div>
            </div>

            <form id="new-client-form" class="admin-form-panel" @submit.prevent="createClient">
              <div><h3>Registrar un sitio</h3><p>Crea un cliente OpenID Connect para un dominio concreto.</p></div>
              <Input id="client-name" v-model="clientName" label="Nombre del servicio" placeholder="Mi sitio Karmancos" required />
              <Select id="client-type" v-model="clientType" label="Tipo de aplicación" :options="clientTypeOptions" hint="Las apps públicas siempre requieren PKCE." />
              <Textarea id="redirect-uris" v-model="redirectUrisText" label="URL de retorno" :rows="3" :max-height="180" resizable="vertical" placeholder="https://mi-sitio.com/auth/callback" hint="Una URL exacta por línea. HTTPS es obligatorio fuera de localhost." required />
              <Textarea id="allowed-origins" v-model="allowedOriginsText" label="Orígenes web autorizados · para SDK de navegador" :rows="2" :max-height="140" resizable="vertical" placeholder="https://mi-sitio.com" hint="Origen exacto por línea; HTTPS obligatorio fuera de localhost." />
              <Textarea id="post-logout-uris" v-model="postLogoutUrisText" label="URL tras cerrar sesión · opcional" :rows="2" :max-height="140" resizable="vertical" placeholder="https://mi-sitio.com/" hint="Una URL exacta por línea." />
              <p v-if="clientError" class="form-message" role="alert">{{ clientError }}</p>
              <Button class="form-action" variant="solid" type="submit" :loading="creatingClient">Crear cliente</Button>
              <div v-if="newSecret" class="secret-reveal" role="status">
                <p>Guarda el secreto ahora. Karmancos ID no lo volverá a mostrar.</p>
                <code>{{ newSecret }}</code>
                <Button variant="outline" size="sm" type="button" @click="copySecret">{{ copiedSecret ? 'Copiado' : 'Copiar secreto' }}</Button>
              </div>
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
    </div>
  </div>
</template>
