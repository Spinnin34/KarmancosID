<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ArrowRight, ArrowUpRight, CircleCheck } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";

const identifier = ref("");
const password = ref("");
const loading = ref(false);
const message = ref("");
const notice = ref("");
const requestedSite = ref<{ name: string; domain: string } | null>(null);
const csrfToken = ref("");
let csrfRequest: Promise<void> | null = null;

async function refreshCsrf() {
  if (csrfRequest) return csrfRequest;
  csrfRequest = (async () => {
    const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    if (!response.ok) throw new Error("No se pudo preparar la conexión segura.");
    const data = await response.json();
    if (typeof data.token !== "string" || !data.token) throw new Error("No se recibió el token de seguridad.");
    csrfToken.value = data.token;
  })();
  try {
    await csrfRequest;
  } finally {
    csrfRequest = null;
  }
}

onMounted(() => {
  const query = new URLSearchParams(window.location.search);
  if (query.get("updated") === "1") {
    notice.value = "Cambios guardados. Inicia sesión para continuar.";
  } else if (query.get("created") === "1") {
    notice.value = "Cuenta creada. Revisa tu correo para verificar la dirección.";
  }
  refreshCsrf().catch(() => {
    message.value = "No se pudo preparar la conexión segura. Recarga la página e inténtalo otra vez.";
  });
  if (window.location.pathname === "/login") {
    fetch("/api/auth/continue", { credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((context) => {
        if (context?.requested && typeof context.name === "string") {
          requestedSite.value = { name: context.name, domain: typeof context.domain === "string" ? context.domain : "" };
        }
      })
      .catch(() => undefined);
  }
});

async function submit() {
  message.value = "";
  if (!identifier.value.trim() || !password.value) {
    message.value = "Escribe tu usuario o correo y contraseña para continuar.";
    return;
  }

  loading.value = true;
  try {
    if (!csrfToken.value) await refreshCsrf();
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrfToken.value },
      body: JSON.stringify({ identifier: identifier.value.trim(), password: password.value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      message.value = data.message || "No se pudo iniciar sesión. Revisa tus datos.";
      return;
    }
    const next = typeof data.next === "string" && data.next.startsWith("/") && !data.next.startsWith("//")
      ? data.next
      : "/cuenta";
    window.location.assign(next);
  } catch {
    message.value = "No se pudo conectar con Karmancos ID. Comprueba que el servicio esté disponible.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="auth-form login-form" novalidate @submit.prevent="submit">
    <div v-if="requestedSite" class="login-request-context" role="status">
      <span class="login-request-context-mark" aria-hidden="true"><ArrowUpRight :size="23" :stroke-width="1.8" /></span>
      <span class="login-request-context-copy">
        <span>Después de iniciar sesión, volverás a</span>
        <strong>{{ requestedSite.name }}</strong>
        <small>{{ requestedSite.domain || "Sitio conectado con Karmancos ID" }}</small>
      </span>
      <span class="login-request-context-check" aria-hidden="true"><CircleCheck :size="21" :stroke-width="1.8" /></span>
    </div>
    <div class="login-fields">
      <div class="login-field">
        <Input
          id="login-identifier"
          v-model="identifier"
          label="Usuario o correo electrónico"
          type="text"
          autocomplete="username"
          placeholder="Tu usuario o tu@correo.com"
          required
        />
      </div>
      <p class="login-recovery-link login-fields-wide"><a href="/recuperar-contrasena">¿Olvidaste tu contraseña?</a></p>
      <div class="login-field">
        <Input
          id="login-password"
          v-model="password"
          label="Contraseña"
          type="password"
          autocomplete="current-password"
          placeholder="Tu contraseña"
          required
        />
      </div>
      <p v-if="notice" class="inline-notice login-fields-wide" role="status">{{ notice }}</p>
      <p v-if="message" class="form-message login-fields-wide" role="alert">{{ message }}</p>
      <Button class="form-action login-fields-wide" variant="solid" size="lg" type="submit" :loading="loading">
        <span class="auth-button-copy"><span>{{ loading ? "Entrando" : "Iniciar sesión" }}</span><ArrowRight class="auth-button-arrow" :size="20" :stroke-width="1.8" aria-hidden="true" /></span>
      </Button>
    </div>
  </form>
</template>
