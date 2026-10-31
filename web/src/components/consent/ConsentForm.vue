<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Badge from "@/components/ui/Badge.vue";
import Button from "@/components/ui/Button.vue";
import { getIdentityCsrfToken, identityApi } from "@/lib/identity-api";

const props = defineProps<{ clientId?: string; state?: string; requestedScopes?: string[] }>();
const clientId = ref(props.clientId || "");
const state = ref(props.state || "");
const requestedScopes = ref<string[]>(props.requestedScopes || []);
const clientName = ref("");
const clientDomain = ref("");
const csrfToken = ref("");
const loading = ref(true);
const error = ref("");

const scopeLabels: Record<string, string> = {
  openid: "Confirmar tu identidad en este servicio",
  profile: "Compartir tu nombre y foto de perfil",
  email: "Compartir tu correo electrónico"
};
const visibleScopes = computed(() => requestedScopes.value.filter((scope) => scope in scopeLabels));

onMounted(async () => {
  const parameters = new URLSearchParams(window.location.search);
  clientId.value ||= parameters.get("client_id") || "";
  state.value ||= parameters.get("state") || "";
  if (requestedScopes.value.length === 0) {
    requestedScopes.value = [...new Set(parameters.getAll("scope").flatMap((scope) => scope.split(/\s+/)).filter(Boolean))];
  }
  if (!requestedScopes.value.includes("openid")) requestedScopes.value.unshift("openid");

  if (!clientId.value || !state.value) {
    error.value = "La solicitud de acceso no está completa. Vuelve al sitio e inténtalo otra vez.";
    loading.value = false;
    return;
  }
  try {
    const [clientResponse, csrfResponse] = await Promise.all([
      identityApi<{ name: string; domain: string }>(`/api/public/clients/${encodeURIComponent(clientId.value)}`),
      getIdentityCsrfToken()
    ]);
    clientName.value = clientResponse.name;
    clientDomain.value = clientResponse.domain;
    csrfToken.value = csrfResponse;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo verificar el servicio.";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="consent-card" aria-labelledby="consent-title">
    <a class="brand-lockup" href="/cuenta#profile" aria-label="Karmancos ID, cuenta personal">
      <span class="brand-mark" aria-hidden="true"><img src="/images/karmancos-id-mark.png" alt="" /></span>
      <span class="brand-name">KARMANCOS<span>ID</span></span>
    </a>
    <div class="form-heading consent-heading">
      <p class="eyebrow">Permiso de acceso</p>
      <h1 id="consent-title">¿Conectar tu cuenta?</h1>
      <p class="consent-intro">Revisa qué datos recibirá este servicio. Puedes cambiar esta decisión cuando quieras.</p>
    </div>

    <div v-if="loading" class="loading-state" role="status">Verificando el servicio…</div>
    <p v-else-if="error" class="error-state" role="alert">{{ error }}</p>
    <template v-else>
      <div class="consent-app">
        <strong>{{ clientName }}</strong>
        <span>{{ clientDomain || 'Servicio registrado en Karmancos ID' }}</span>
      </div>
      <form method="post" action="/oauth2/authorize">
        <input type="hidden" name="_csrf" :value="csrfToken" />
        <input type="hidden" name="client_id" :value="clientId" />
        <input type="hidden" name="state" :value="state" />
        <fieldset class="consent-scopes">
          <legend>Este servicio solicita permiso para:</legend>
          <label v-for="scope in visibleScopes" :key="scope" class="consent-scope">
            <input v-if="scope === 'openid'" type="hidden" name="scope" :value="scope" />
            <input v-else type="checkbox" name="scope" :value="scope" checked />
            <span>{{ scopeLabels[scope] }}</span>
          </label>
        </fieldset>
        <p v-if="visibleScopes.length === 0" class="form-message">La solicitud no contiene permisos reconocidos.</p>
        <div class="consent-actions">
          <Button class="form-action" variant="solid" size="lg" type="submit" :disabled="visibleScopes.length === 0">Autorizar y continuar</Button>
          <a class="consent-cancel" href="/cuenta">Ahora no</a>
        </div>
      </form>
      <p class="auth-security-note"><Badge variant="outline" color="secondary">OpenID Connect</Badge> Tu contraseña no se comparte con este servicio.</p>
    </template>
  </section>
</template>
