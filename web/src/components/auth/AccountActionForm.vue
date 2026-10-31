<script setup lang="ts">
import { onMounted, ref } from "vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";

const props = defineProps<{ mode: "request" | "reset" | "verify" | "resend" }>();
const email = ref("");
const token = ref("");
const password = ref("");
const confirmation = ref("");
const loading = ref(false);
const message = ref("");
const success = ref("");
const csrf = ref("");

async function csrfToken() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok || typeof data.token !== "string") throw new Error("No se pudo preparar la conexión segura.");
  csrf.value = data.token;
}

onMounted(async () => {
  token.value = new URLSearchParams(window.location.search).get("token") || "";
  if (props.mode === "verify") await submit();
});

async function submit() {
  loading.value = true;
  message.value = "";
  success.value = "";
  try {
    if (!csrf.value) await csrfToken();
    let path: string;
    let body: Record<string, string>;
    if (props.mode === "verify") {
      path = "/api/auth/email/verify"; body = { token: token.value };
    } else if (props.mode === "resend") {
      path = "/api/auth/email/resend"; body = { email: email.value.trim() };
    } else if (props.mode === "request") {
      path = "/api/auth/password/reset-request"; body = { email: email.value.trim() };
    } else {
      if (password.value.length < 12) throw new Error("La contraseña debe tener al menos 12 caracteres.");
      if (password.value !== confirmation.value) throw new Error("Las contraseñas no coinciden.");
      path = "/api/auth/password/reset"; body = { token: token.value, newPassword: password.value };
    }
    const response = await fetch(path, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf.value },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "No se pudo completar la solicitud.");
    success.value = data.message || (props.mode === "verify" ? "Correo verificado." : "Solicitud recibida.");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "No se pudo conectar con Karmancos ID.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form v-if="mode !== 'verify'" class="auth-form account-action-form" @submit.prevent="submit">
    <template v-if="mode === 'request' || mode === 'resend'">
      <Input id="action-email" v-model="email" label="Correo electrónico" type="email" autocomplete="email" required />
    </template>
    <template v-else>
      <Input id="reset-password" v-model="password" label="Nueva contraseña" type="password" autocomplete="new-password" minlength="12" maxlength="128" required />
      <Input id="reset-confirmation" v-model="confirmation" label="Repite la contraseña" type="password" autocomplete="new-password" maxlength="128" required />
    </template>
    <p v-if="message" class="form-message" role="alert">{{ message }}</p>
    <p v-if="success" class="inline-notice" role="status">{{ success }}</p>
    <Button class="form-action" variant="solid" size="lg" type="submit" :loading="loading">
      {{ loading ? "Procesando…" : mode === "request" ? "Enviar instrucciones" : mode === "resend" ? "Enviar enlace de verificación" : "Actualizar contraseña" }}
    </Button>
  </form>
  <div v-else class="auth-form account-action-form" aria-live="polite">
    <p v-if="loading" class="inline-notice" role="status">Verificando el enlace…</p>
    <p v-if="message" class="form-message" role="alert">{{ message }}</p>
    <p v-if="success" class="inline-notice" role="status">{{ success }}</p>
  </div>
</template>
