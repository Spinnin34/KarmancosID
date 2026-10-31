<script setup lang="ts">
import { onMounted, ref } from "vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";
import Select from "@/components/ui/Select.vue";
import Textarea from "@/components/ui/Textarea.vue";

const name = ref("");
const contactEmail = ref("");
const description = ref("");
const clientType = ref("confidential");
const redirectUris = ref("");
const postLogoutRedirectUris = ref("");
const csrf = ref("");
const loading = ref(false);
const error = ref("");
const success = ref("");
const types = [{ label: "Confidencial · aplicación con servidor", value: "confidential" }, { label: "Público · SPA en navegador", value: "public" }];

onMounted(async () => {
  try {
    const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok || typeof data.token !== "string") throw new Error();
    csrf.value = data.token;
  } catch { error.value = "No se pudo preparar la conexión segura. Recarga la página."; }
});

function lines(value: string) { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }

async function submit() {
  error.value = ""; success.value = ""; loading.value = true;
  try {
    if (!csrf.value) throw new Error("Recarga la página para iniciar una conexión segura.");
    const response = await fetch("/api/public/applications", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf.value },
      body: JSON.stringify({ name: name.value.trim(), contactEmail: contactEmail.value.trim(), description: description.value.trim(),
        clientType: clientType.value, redirectUris: lines(redirectUris.value), postLogoutRedirectUris: lines(postLogoutRedirectUris.value) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "No se pudo enviar la solicitud.");
    success.value = data.message || "Solicitud recibida.";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "No se pudo conectar con Karmancos ID."; }
  finally { loading.value = false; }
}
</script>

<template>
  <form class="developer-request-form" @submit.prevent="submit">
    <Input id="request-name" v-model="name" label="Nombre del servicio" maxlength="100" required />
    <Input id="request-contact" v-model="contactEmail" label="Correo de contacto técnico" type="email" autocomplete="email" maxlength="320" required />
    <Select id="request-type" v-model="clientType" label="Tipo de aplicación" :options="types" />
    <Textarea id="request-description" v-model="description" label="Qué ofrece la aplicación y qué datos necesita" :rows="3" :max-height="180" maxlength="1000" required />
    <Textarea id="request-callbacks" v-model="redirectUris" label="URI de retorno permitidas" :rows="3" :max-height="180" placeholder="https://app.example.com/auth/callback" hint="Una URL exacta HTTPS por línea; sin comodines." required />
    <Textarea id="request-logout" v-model="postLogoutRedirectUris" label="URI tras cerrar sesión · opcional" :rows="2" :max-height="140" placeholder="https://app.example.com/" hint="Una URL exacta por línea." />
    <p v-if="error" class="form-message" role="alert">{{ error }}</p>
    <p v-if="success" class="inline-notice" role="status">{{ success }}</p>
    <Button variant="solid" size="lg" type="submit" :loading="loading">Enviar para revisión</Button>
  </form>
</template>
