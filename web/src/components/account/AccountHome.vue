<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Avatar from "@/components/ui/Avatar.vue";
import Badge from "@/components/ui/Badge.vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";
import Link from "@/components/ui/Link.vue";
import Tabs from "@/components/ui/Tabs.vue";
import { AppWindow, Clock3, Monitor, ShieldCheck } from "@lucide/vue";

type CurrentUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string;
  displayName: string;
  role: string;
  firstName: string;
  lastName: string;
  secondLastName: string;
  picture: string | null;
};
type AccountSession = { reference: string; current: boolean; createdAt: string; lastAccessedAt: string };
type ConnectedApp = { id: string; name: string; scopes: string[] };
type AccountTab = "profile" | "security" | "sessions" | "apps";

const user = ref<CurrentUser | null>(null);
const error = ref("");
const loading = ref(true);
const csrfToken = ref("");
const activeTab = ref<AccountTab>("profile");
const accountNavigationReady = ref(false);
const sessions = ref<AccountSession[]>([]);
const connectedApps = ref<ConnectedApp[]>([]);
const sessionsLoading = ref(false);
const appsLoading = ref(false);
const appsError = ref("");
const appsMessage = ref("");
const profileSaving = ref(false);
const passwordSaving = ref(false);
const profileError = ref("");
const profileMessage = ref("");
const passwordError = ref("");
const passwordMessage = ref("");
const sessionError = ref("");
const sessionMessage = ref("");
const pictureInput = ref<HTMLInputElement | null>(null);
const pictureFile = ref<File | null>(null);
const picturePreview = ref("");
const pictureSaving = ref(false);
const pictureError = ref("");
const pictureMessage = ref("");

const username = ref("");
const firstName = ref("");
const lastName = ref("");
const secondLastName = ref("");
const email = ref("");
const currentProfilePassword = ref("");
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");

const tabs = [
  { id: "profile", label: "Perfil" },
  { id: "security", label: "Seguridad" },
  { id: "sessions", label: "Sesiones" },
  { id: "apps", label: "Aplicaciones" },
] as const;
const initials = computed(() => (user.value?.displayName ?? "K ID")
  .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""));

watch(activeTab, async (tab) => {
  if (tab === "sessions") void loadSessions();
  if (tab === "apps") void loadConnectedApps();
  if (accountNavigationReady.value) {
    if (window.location.hash !== `#${tab}`) window.history.pushState(null, "", `#${tab}`);
    await nextTick();
    document.getElementById(`account-settings-${tab}-panel`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
  }
});

function syncTabFromLocation() {
  const requestedTab = window.location.hash.slice(1);
  if (tabs.some((tab) => tab.id === requestedTab)) activeTab.value = requestedTab as AccountTab;
}

async function refreshCsrf() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new Error("No se pudo preparar una sesión segura.");
  const data = await response.json();
  csrfToken.value = data.token;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  if (method !== "GET" && method !== "HEAD") {
    if (!csrfToken.value) await refreshCsrf();
    headers.set("X-XSRF-TOKEN", csrfToken.value);
  }
  const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Inicia sesión para continuar.");
  }
  if (!response.ok) throw new Error(data?.message || "No se pudo completar la solicitud.");
  return data as T;
}

async function loadSessions() {
  sessionsLoading.value = true;
  sessionError.value = "";
  try {
    sessions.value = await api<AccountSession[]>("/api/account/sessions");
  } catch (cause) {
    sessionError.value = cause instanceof Error ? cause.message : "No se pudieron cargar las sesiones.";
  } finally {
    sessionsLoading.value = false;
  }
}

async function loadConnectedApps() {
  appsLoading.value = true;
  appsError.value = "";
  try { connectedApps.value = await api<ConnectedApp[]>("/api/account/apps"); }
  catch (cause) { appsError.value = cause instanceof Error ? cause.message : "No se pudieron cargar las aplicaciones."; }
  finally { appsLoading.value = false; }
}

async function revokeConnectedApp(app: ConnectedApp) {
  appsError.value = "";
  appsMessage.value = "";
  try {
    await api<void>(`/api/account/apps/${encodeURIComponent(app.id)}`, { method: "DELETE" });
    appsMessage.value = `Se revocó el acceso de ${app.name}.`;
    await loadConnectedApps();
  } catch (cause) { appsError.value = cause instanceof Error ? cause.message : "No se pudo revocar el acceso."; }
}

onMounted(async () => {
  syncTabFromLocation();
  accountNavigationReady.value = true;
  window.addEventListener("popstate", syncTabFromLocation);
  try {
    const [csrfResponse, userResponse] = await Promise.all([
      fetch("/api/auth/csrf", { credentials: "same-origin" }),
      fetch("/api/auth/me", { credentials: "same-origin" })
    ]);
    if (userResponse.status === 401) {
      window.location.assign("/login");
      return;
    }
    if (!csrfResponse.ok || !userResponse.ok) throw new Error("No se pudo cargar tu cuenta.");
    const csrf = await csrfResponse.json();
    csrfToken.value = csrf.token;
    user.value = await userResponse.json();
    username.value = user.value?.username ?? "";
    firstName.value = user.value?.firstName ?? "";
    lastName.value = user.value?.lastName ?? "";
    secondLastName.value = user.value?.secondLastName ?? "";
    email.value = user.value?.email ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo cargar tu cuenta.";
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => window.removeEventListener("popstate", syncTabFromLocation));

onBeforeUnmount(() => {
  if (picturePreview.value) URL.revokeObjectURL(picturePreview.value);
});

function openPicturePicker() {
  pictureInput.value?.click();
}

function clearPictureSelection() {
  if (picturePreview.value) URL.revokeObjectURL(picturePreview.value);
  picturePreview.value = "";
  pictureFile.value = null;
  if (pictureInput.value) pictureInput.value.value = "";
}

function selectPicture(event: Event) {
  pictureError.value = "";
  pictureMessage.value = "";
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const isSupportedImage = ["image/jpeg", "image/png"].includes(file.type)
    || /\.(jpe?g|png)$/i.test(file.name);
  if (!isSupportedImage) {
    pictureError.value = "Elige una imagen JPG o PNG.";
    clearPictureSelection();
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    pictureError.value = "La imagen no puede superar los 2 MB.";
    clearPictureSelection();
    return;
  }
  clearPictureSelection();
  pictureFile.value = file;
  picturePreview.value = URL.createObjectURL(file);
}

async function savePicture() {
  if (!pictureFile.value) return;
  pictureError.value = "";
  pictureMessage.value = "";
  pictureSaving.value = true;
  try {
    const formData = new FormData();
    formData.append("file", pictureFile.value);
    const result = await api<{ message: string; picture: string }>("/api/account/picture", {
      method: "POST",
      body: formData
    });
    if (user.value) user.value.picture = result.picture;
    clearPictureSelection();
    pictureMessage.value = result.message;
  } catch (cause) {
    pictureError.value = cause instanceof Error ? cause.message : "No se pudo actualizar la foto.";
  } finally {
    pictureSaving.value = false;
  }
}

async function deletePicture() {
  pictureError.value = "";
  pictureMessage.value = "";
  pictureSaving.value = true;
  try {
    const result = await api<{ message: string; picture: string | null }>("/api/account/picture", { method: "DELETE" });
    if (user.value) user.value.picture = null;
    pictureMessage.value = result.message;
  } catch (cause) {
    pictureError.value = cause instanceof Error ? cause.message : "No se pudo eliminar la foto.";
  } finally {
    pictureSaving.value = false;
  }
}

async function saveProfile() {
  profileError.value = "";
  profileMessage.value = "";
  if (!currentProfilePassword.value) {
    profileError.value = "Confirma los cambios con tu contraseña actual.";
    return;
  }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username.value.trim())) {
    profileError.value = "El usuario debe tener entre 3 y 32 caracteres válidos.";
    return;
  }
  profileSaving.value = true;
  try {
    const result = await api<{ message: string }>("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.value.trim(),
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        secondLastName: secondLastName.value.trim(),
        email: email.value.trim(),
        currentPassword: currentProfilePassword.value
      })
    });
    currentProfilePassword.value = "";
    profileMessage.value = result.message;
    window.setTimeout(() => window.location.assign("/login?updated=1"), 1400);
  } catch (cause) {
    profileError.value = cause instanceof Error ? cause.message : "No se pudo guardar el perfil.";
  } finally {
    profileSaving.value = false;
  }
}

async function changePassword() {
  passwordError.value = "";
  passwordMessage.value = "";
  if (newPassword.value.length < 12) {
    passwordError.value = "La contraseña debe tener al menos 12 caracteres.";
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = "Las contraseñas nuevas no coinciden.";
    return;
  }
  passwordSaving.value = true;
  try {
    const result = await api<{ message: string }>("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    });
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    passwordMessage.value = result.message;
    window.setTimeout(() => window.location.assign("/login?updated=1"), 1400);
  } catch (cause) {
    passwordError.value = cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña.";
  } finally {
    passwordSaving.value = false;
  }
}

async function revokeSession(session: AccountSession) {
  if (session.current) return;
  sessionError.value = "";
  sessionMessage.value = "";
  try {
    await api<void>(`/api/account/sessions/${encodeURIComponent(session.reference)}`, { method: "DELETE" });
    sessionMessage.value = "Sesión cerrada.";
    await loadSessions();
  } catch (cause) {
    sessionError.value = cause instanceof Error ? cause.message : "No se pudo cerrar la sesión.";
  }
}

async function revokeOtherSessions() {
  sessionError.value = "";
  sessionMessage.value = "";
  try {
    const result = await api<{ message: string }>("/api/account/sessions/revoke-others", { method: "POST" });
    sessionMessage.value = result.message;
    await loadSessions();
  } catch (cause) {
    sessionError.value = cause instanceof Error ? cause.message : "No se pudieron cerrar las otras sesiones.";
  }
}

async function logout() {
  try {
    await api<void>("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.assign("/login");
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
</script>

<template>
  <div class="account-shell">
    <header class="account-topbar">
      <a class="brand-lockup" href="/cuenta#profile" aria-label="Karmancos ID, cuenta personal">
        <span class="brand-mark" aria-hidden="true"><img src="/images/karmancos-id-mark.png" alt="" /></span>
        <span class="brand-name">KARMANCOS<span>ID</span></span>
      </a>
      <div v-if="user" class="account-topbar-actions">
        <nav class="account-primary-nav" aria-label="Navegación principal">
          <Link href="/cuenta#profile" variant="text" color="secondary" size="sm" aria-current="page">Mi cuenta</Link>
          <Link v-if="user.role === 'ADMIN'" href="/admin#overview" variant="text" color="secondary" size="sm">Administración</Link>
        </nav>
        <span class="account-topbar-user">{{ user.displayName }}</span>
        <Button variant="outline" color="secondary" size="sm" type="button" @click="logout">Cerrar sesión</Button>
      </div>
    </header>

    <main class="account-main account-settings-main">
      <section class="account-intro">
        <p class="admin-section-kicker">CENTRO PERSONAL · KARMANCOS ID</p>
        <h1>Tu identidad, bajo tu control.</h1>
        <p>Actualiza tus datos, protege el acceso y revisa desde dónde se ha iniciado sesión.</p>
      </section>

      <p v-if="loading" class="loading-state" role="status">Cargando tu cuenta…</p>
      <p v-else-if="error" class="error-state" role="alert">{{ error }}</p>

      <template v-else-if="user">
        <section class="account-identity-card" aria-label="Resumen de la cuenta">
          <Avatar :src="user.picture || undefined" :label="`Foto de perfil de ${user.displayName}`" :fallback="initials" size="lg" shape="rounded" loading="eager" class="account-avatar" />
          <div class="account-identity-copy">
            <span class="account-identity-label">CUENTA KARMANCOS ID</span>
            <div class="account-identity-heading">
              <h2>{{ user.displayName }}</h2>
              <Badge variant="soft" color="success">Cuenta activa</Badge>
            </div>
            <p>@{{ user.username }} <span aria-hidden="true">·</span> {{ user.email }} <Badge v-if="user.emailVerified" variant="soft" color="success">Correo verificado</Badge><Badge v-else variant="soft" color="warning">Correo pendiente</Badge></p>
          </div>
        </section>

        <Tabs
          id="account-settings"
          v-model="activeTab"
          :items="tabs"
          label="Configuración de la cuenta"
          type="underline"
          variant="surface"
          shadow="none"
          class="account-tabs"
        >
          <template #profile>
            <section class="account-panel" aria-labelledby="profile-heading">
              <header class="account-panel-heading">
                <div><p class="account-panel-kicker">INFORMACIÓN PERSONAL</p><h2 id="profile-heading">Datos de tu cuenta</h2></div>
              </header>
              <p class="account-panel-intro">Estos datos se usan para identificarte en Karmancos y en los servicios que autorizas.</p>
              <section class="account-profile-picture" aria-labelledby="profile-picture-heading">
                <Avatar :src="picturePreview || user.picture || undefined" :label="`Vista previa de la foto de ${user.displayName}`" :fallback="initials" size="xl" shape="rounded" loading="eager" class="account-profile-picture-avatar" />
                <div class="account-profile-picture-content">
                  <p class="account-panel-kicker">FOTO DE PERFIL</p>
                  <h3 id="profile-picture-heading">Tu foto en Karmancos ID</h3>
                  <p>Al guardarla, tendrá un enlace público y los sitios conectados podrán mostrarla cuando autorices tu perfil.</p>
                  <div class="account-profile-picture-actions">
                    <Button v-if="pictureFile" variant="solid" type="button" :loading="pictureSaving" @click="savePicture">Guardar foto</Button>
                    <Button variant="outline" color="secondary" type="button" :disabled="pictureSaving" @click="openPicturePicker">{{ pictureFile ? 'Elegir otra' : user.picture ? 'Cambiar foto' : 'Subir foto' }}</Button>
                    <Button v-if="pictureFile" variant="text" color="secondary" type="button" :disabled="pictureSaving" @click="clearPictureSelection">Cancelar</Button>
                    <Button v-else-if="user.picture" variant="text" color="destructive" type="button" :loading="pictureSaving" @click="deletePicture">Eliminar foto</Button>
                  </div>
                  <input ref="pictureInput" class="sr-only" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-label="Seleccionar foto de perfil" @change="selectPicture" />
                  <p v-if="pictureError" class="form-message" role="alert">{{ pictureError }}</p>
                  <p v-if="pictureMessage" class="account-success-message" role="status">{{ pictureMessage }}</p>
                  <p class="account-profile-picture-hint">JPG o PNG · Máximo 2 MB · Se optimiza de forma segura al guardar</p>
                </div>
              </section>
              <form class="account-form-grid" @submit.prevent="saveProfile">
                <Input id="account-first-name" v-model="firstName" label="Nombre" autocomplete="given-name" maxlength="80" required />
                <Input id="account-last-name" v-model="lastName" label="Primer apellido" autocomplete="family-name" maxlength="80" required />
                <Input id="account-second-last-name" v-model="secondLastName" label="Segundo apellido" autocomplete="additional-name" maxlength="80" />
                <Input id="account-username" v-model="username" label="Nombre de usuario" autocomplete="username" minlength="3" maxlength="32" autocapitalize="none" spellcheck="false" required />
                <div class="account-email-field">
                  <Input id="account-email" v-model="email" label="Correo electrónico" type="email" autocomplete="email" maxlength="320" required />
                  <p class="account-email-hint">El correo nuevo se usará para iniciar sesión. Los sitios conectados sabrán que la dirección aún no está verificada.</p>
                </div>
                <div class="account-reauth-field">
                  <Input id="account-profile-password" v-model="currentProfilePassword" label="Confirma con tu contraseña actual" type="password" autocomplete="current-password" required />
                  <p>Para proteger tu cuenta, volverás a iniciar sesión después de guardar.</p>
                </div>
                <p v-if="profileError" class="form-message account-form-message" role="alert">{{ profileError }}</p>
                <p v-if="profileMessage" class="account-success-message" role="status">{{ profileMessage }}</p>
                <div class="account-form-actions">
                  <Button variant="solid" type="submit" :loading="profileSaving">Guardar datos</Button>
                </div>
              </form>
            </section>
          </template>

          <template #security>
            <section class="account-panel" aria-labelledby="security-heading">
              <header class="account-panel-heading">
                <div><p class="account-panel-kicker">PROTECCIÓN DE ACCESO</p><h2 id="security-heading">Cambiar contraseña</h2></div>
              </header>
              <div class="security-guidance">
                <span class="security-guidance-icon" aria-hidden="true"><ShieldCheck :size="21" :stroke-width="1.8" /></span>
                <div><strong>Una contraseña única protege mejor</strong><p>Usa 12 caracteres o más. Una frase larga es fácil de recordar y difícil de adivinar.</p></div>
              </div>
              <form class="account-security-form" @submit.prevent="changePassword">
                <Input id="account-current-password" v-model="currentPassword" label="Contraseña actual" type="password" autocomplete="current-password" required />
                <Input id="account-new-password" v-model="newPassword" label="Contraseña nueva" type="password" autocomplete="new-password" minlength="12" maxlength="128" hint="Mínimo 12 caracteres." required />
                <Input id="account-confirm-password" v-model="confirmPassword" label="Repite la contraseña nueva" type="password" autocomplete="new-password" maxlength="128" required />
                <p v-if="passwordError" class="form-message" role="alert">{{ passwordError }}</p>
                <p v-if="passwordMessage" class="account-success-message" role="status">{{ passwordMessage }}</p>
                <div class="account-form-actions">
                  <Button variant="solid" type="submit" :loading="passwordSaving">Actualizar contraseña</Button>
                </div>
              </form>
            </section>
          </template>

          <template #sessions>
            <section class="account-panel" aria-labelledby="sessions-heading">
              <header class="account-panel-heading account-sessions-heading">
                <div><p class="account-panel-kicker">DISPOSITIVOS CON ACCESO</p><h2 id="sessions-heading">Tus sesiones</h2></div>
                <Button v-if="sessions.some((session) => !session.current)" variant="outline" color="destructive" size="sm" type="button" @click="revokeOtherSessions">Cerrar otras sesiones</Button>
              </header>
              <p class="account-panel-intro">La sesión actual aparece marcada. Si no reconoces una sesión, ciérrala aquí.</p>
              <div v-if="sessionsLoading" class="loading-state" role="status">Cargando sesiones…</div>
              <p v-else-if="sessionError" class="error-state" role="alert">{{ sessionError }}</p>
              <div v-else-if="sessions.length" class="account-session-list">
                <article v-for="session in sessions" :key="session.reference" class="account-session-row">
                  <span class="session-device-icon" aria-hidden="true">
                    <Monitor v-if="session.current" :size="22" :stroke-width="1.8" />
                    <Clock3 v-else :size="22" :stroke-width="1.8" />
                  </span>
                  <div class="account-session-info">
                    <strong>{{ session.current ? "Este dispositivo" : "Otra sesión" }}</strong>
                    <span>Iniciada {{ formatDate(session.createdAt) }}</span>
                    <small>Última actividad {{ formatDate(session.lastAccessedAt) }}</small>
                  </div>
                  <Badge v-if="session.current" variant="soft" color="success">Actual</Badge>
                  <Button v-else variant="outline" color="destructive" size="sm" type="button" @click="revokeSession(session)">Cerrar sesión</Button>
                </article>
              </div>
              <div v-else class="empty-state">No hay sesiones activas para mostrar.</div>
              <p v-if="sessionMessage" class="account-success-message" role="status">{{ sessionMessage }}</p>
            </section>
          </template>
          <template #apps>
            <section class="account-panel" aria-labelledby="apps-heading">
              <header class="account-panel-heading"><div><p class="account-panel-kicker">PERMISOS DE TERCEROS</p><h2 id="apps-heading">Aplicaciones conectadas</h2></div></header>
              <p class="account-panel-intro">Revisa qué aplicaciones autorizaste y desconecta las que ya no uses. Revocar un permiso impide nuevas autorizaciones; las sesiones propias de la aplicación podrían tardar hasta que caduquen.</p>
              <div v-if="appsLoading" class="loading-state" role="status">Cargando aplicaciones…</div>
              <p v-else-if="appsError" class="error-state" role="alert">{{ appsError }}</p>
              <div v-else-if="connectedApps.length" class="account-session-list">
                <article v-for="app in connectedApps" :key="app.id" class="account-session-row">
                  <span class="session-device-icon connected-app-icon" aria-hidden="true"><AppWindow :size="21" :stroke-width="1.8" /></span>
                  <div class="account-session-info"><strong>{{ app.name }}</strong><small>{{ app.scopes.join(" · ") }}</small></div>
                  <Button variant="outline" color="destructive" size="sm" type="button" @click="revokeConnectedApp(app)">Revocar acceso</Button>
                </article>
              </div>
              <div v-else class="empty-state">No has autorizado aplicaciones externas.</div>
              <p v-if="appsMessage" class="account-success-message" role="status">{{ appsMessage }}</p>
            </section>
          </template>
        </Tabs>
      </template>
    </main>
  </div>
</template>
