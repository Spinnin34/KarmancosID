<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ArrowRight, Check, CheckCheck, LockKeyhole, ShieldAlert, ShieldCheck } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Link from "@/components/ui/Link.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { getIdentityCsrfToken, identityApi } from "@/lib/identity-api";
import { isPreviewMode } from "@/lib/preview-mode";

const props = defineProps<{ clientId?: string; state?: string; requestedScopes?: string[] }>();
const clientId = ref(props.clientId || "");
const state = ref(props.state || "");
const requestedScopes = ref<string[]>(props.requestedScopes || []);
const selectedOptionalScopes = ref<string[]>([]);
const approvedScopes = ref<string[]>([]);
const clientName = ref("");
const clientDomain = ref("");
const csrfToken = ref("");
const loading = ref(true);
const error = ref("");
const authorizing = ref(false);
const phase = ref<"review" | "complete">("review");
const reviewTitle = ref<HTMLElement | null>(null);
const completeTitle = ref<HTMLElement | null>(null);
const card = ref<HTMLElement | null>(null);
const preview = ref(false);

const scopes: Record<string, { title: string; description: string; summary: string }> = {
  openid: { title: "Tu identidad", description: "Confirmar que eres tú en este servicio.", summary: "Confirmar tu identidad" },
  profile: { title: "Nombre y foto de perfil", description: "Mostrar tu perfil dentro de la aplicación.", summary: "Nombre y foto de perfil" },
  email: { title: "Correo electrónico", description: "Compartir la dirección de tu cuenta.", summary: "Correo electrónico" },
};
const visibleScopes = computed(() => requestedScopes.value.filter((scope) => scope in scopes));
const hasRequest = computed(() => Boolean(clientId.value && state.value));

async function loadRequest() {
  loading.value = true;
  error.value = "";
  if (!hasRequest.value) {
    error.value = "La solicitud de acceso no está completa. Vuelve al servicio e inténtalo otra vez.";
    loading.value = false;
    return;
  }
  try {
    const [clientResponse, csrfResponse] = await Promise.all([
      identityApi<{ name: string; domain: string }>(`/api/public/clients/${encodeURIComponent(clientId.value)}`),
      getIdentityCsrfToken(),
    ]);
    clientName.value = clientResponse.name;
    clientDomain.value = clientResponse.domain;
    csrfToken.value = csrfResponse;
    if (preview.value && new URLSearchParams(window.location.search).get("preview_state") === "authorized") {
      approvedScopes.value = [...visibleScopes.value];
      phase.value = "complete";
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo verificar el servicio.";
  } finally {
    loading.value = false;
  }
}

function resetSubmitting() {
  authorizing.value = false;
}

onMounted(() => {
  preview.value = isPreviewMode();
  const parameters = new URLSearchParams(window.location.search);
  clientId.value ||= parameters.get("client_id") || "";
  state.value ||= parameters.get("state") || "";
  if (requestedScopes.value.length === 0) {
    requestedScopes.value = [...new Set(parameters.getAll("scope").flatMap((scope) => scope.split(/\s+/)).filter(Boolean))];
  }
  if (!requestedScopes.value.includes("openid")) requestedScopes.value.unshift("openid");
  selectedOptionalScopes.value = visibleScopes.value.filter((scope) => scope !== "openid");
  window.addEventListener("pageshow", resetSubmitting);
  void loadRequest();
});

onBeforeUnmount(() => window.removeEventListener("pageshow", resetSubmitting));

function authorize(event: SubmitEvent) {
  if (authorizing.value || visibleScopes.value.length === 0) {
    event.preventDefault();
    return;
  }
  authorizing.value = true;
  // The native POST keeps the OIDC redirect and submits only the checked permissions.
  // Inputs remain enabled while submitting so browser form serialization is preserved.
  if (!isPreviewMode()) return;
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  approvedScopes.value = new FormData(form).getAll("scope").map(String).filter((scope) => scope in scopes);
  phase.value = "complete";
}

function focusStage() {
  const heading = phase.value === "complete" ? completeTitle.value : reviewTitle.value;
  heading?.focus({ preventScroll: true });
  if (card.value && card.value.getBoundingClientRect().top < 60) {
    card.value.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

function reviewPermissions() {
  authorizing.value = false;
  phase.value = "review";
}

function cancelWhileSubmitting(event: MouseEvent) {
  if (authorizing.value) event.preventDefault();
}
</script>

<template>
  <section ref="card" class="consent-card" :class="{ 'consent-card--complete': phase === 'complete' }" :aria-labelledby="loading ? undefined : 'consent-title'" :aria-label="loading ? 'Preparando el permiso de acceso' : undefined">
    <a class="brand-lockup" href="/cuenta#profile" aria-label="Karmancos ID, cuenta personal">
      <span class="brand-mark" aria-hidden="true"><img src="/images/karmancos-id-mark.png" alt="" /></span>
      <span class="brand-name">KARMANCOS<span>ID</span></span>
    </a>

    <div v-if="loading" class="consent-loading">
      <Spinner label="Verificando el servicio…" label-position="bottom" color="secondary" size="md" />
      <p>Preparando los permisos de acceso.</p>
    </div>
    <div v-else-if="error" class="consent-error">
      <span class="consent-error-icon" aria-hidden="true"><ShieldAlert :size="32" :stroke-width="1.3" /></span>
      <h1 id="consent-title">No hemos podido preparar el acceso</h1>
      <p role="alert">{{ error }}</p>
      <div class="consent-error-actions">
        <Button v-if="hasRequest" variant="solid" type="button" @click="loadRequest">Volver a intentar</Button>
        <Link href="/cuenta#apps" variant="text" color="secondary">Ir a mi cuenta</Link>
      </div>
    </div>
    <Transition v-else name="consent-stage" mode="out-in" @after-enter="focusStage">
      <div v-if="phase === 'complete'" key="complete" class="consent-complete">
        <div class="completion-emblem" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="completion-ring" cx="40" cy="40" r="37" /><path class="completion-check" d="m25 40 10 10 21-22" /></svg></div>
        <p class="completion-kicker">CONEXIÓN COMPLETADA</p>
        <h1 id="consent-title" ref="completeTitle" tabindex="-1">Tu cuenta está conectada.</h1>
        <p class="completion-intro">Ya has autorizado a <strong>{{ clientName }}</strong> a utilizar los datos que has elegido.</p>
        <div class="authorized-service">
          <span class="consent-app-monogram" aria-hidden="true">{{ clientName.charAt(0) }}</span>
          <div><strong>{{ clientName }}</strong><small>{{ clientDomain || 'Servicio conectado' }}</small></div>
          <span class="authorized-status" aria-label="Acceso autorizado"><ShieldCheck :size="20" :stroke-width="1.5" /></span>
        </div>
        <div class="approved-permissions">
          <h2>Permisos concedidos</h2>
          <ul><li v-for="scope in approvedScopes" :key="scope"><Check :size="15" :stroke-width="1.8" aria-hidden="true" />{{ scopes[scope]?.summary }}</li></ul>
        </div>
        <p class="completion-guidance">Puedes revisar o revocar este acceso cuando quieras desde tu cuenta.</p>
        <div class="completion-actions">
          <Link href="/cuenta#apps" variant="solid" color="primary" size="lg" :suffix-icon="ArrowRight">Ver aplicaciones conectadas</Link>
          <Button variant="outline" color="secondary" type="button" @click="reviewPermissions">Revisar permisos</Button>
        </div>
        <p v-if="preview" class="completion-preview-note">Conexión de demostración · Modo preview</p>
      </div>
      <div v-else key="review" class="consent-review" :aria-busy="authorizing || undefined">
        <div class="consent-connection" aria-hidden="true"><span><img src="/images/karmancos-id-mark.png" alt="" /></span><i></i><ArrowRight :size="20" :stroke-width="1.5" /><i></i><span class="consent-app-monogram">{{ clientName.charAt(0) }}</span></div>
        <div class="form-heading consent-heading">
          <p class="eyebrow">Permiso de acceso</p>
          <h1 id="consent-title" ref="reviewTitle" tabindex="-1">¿Conectar tu cuenta?</h1>
          <p class="consent-intro">Elige qué datos recibirá este servicio. Tú tienes el control.</p>
        </div>
        <div class="consent-app"><span class="consent-app-icon" aria-hidden="true"><ShieldCheck :size="20" :stroke-width="1.5" /></span><div><strong>{{ clientName }}</strong><span>{{ clientDomain || 'Servicio registrado en Karmancos ID' }}</span></div></div>
        <form method="post" action="/oauth2/authorize" @submit="authorize">
          <input type="hidden" name="_csrf" :value="csrfToken" />
          <input type="hidden" name="client_id" :value="clientId" />
          <input type="hidden" name="state" :value="state" />
          <fieldset class="consent-scopes" :class="{ 'consent-scopes--busy': authorizing }">
            <legend>Permisos solicitados</legend>
            <label v-for="scope in visibleScopes" :key="scope" class="consent-scope" :class="{ 'consent-scope--required': scope === 'openid' }">
              <template v-if="scope === 'openid'"><input type="hidden" name="scope" :value="scope" /><span class="consent-required-icon" aria-hidden="true"><LockKeyhole :size="16" :stroke-width="1.5" /></span></template>
              <input v-else v-model="selectedOptionalScopes" type="checkbox" name="scope" :value="scope" />
              <span class="consent-scope-copy"><strong>{{ scopes[scope]?.title }}</strong><small>{{ scopes[scope]?.description }}</small></span>
              <span v-if="scope === 'openid'" class="consent-required-label">Necesario</span>
            </label>
          </fieldset>
          <p v-if="visibleScopes.length === 0" class="form-message">La solicitud no contiene permisos reconocidos.</p>
          <div class="consent-actions">
            <Button class="form-action" variant="solid" size="lg" type="submit" :loading="authorizing" :disabled="visibleScopes.length === 0" :suffix-icon="authorizing ? undefined : ArrowRight">{{ authorizing ? 'Autorizando…' : 'Autorizar y continuar' }}</Button>
            <a class="consent-cancel" href="/cuenta" :aria-disabled="authorizing || undefined" @click="cancelWhileSubmitting">Ahora no</a>
          </div>
          <p v-if="authorizing && !preview" class="consent-progress" role="status">Abriendo {{ clientName }} con los permisos seleccionados…</p>
        </form>
        <p class="consent-security-note"><CheckCheck :size="16" :stroke-width="1.5" aria-hidden="true" /><span>Tu contraseña no se comparte. Puedes revocar estos permisos desde tu cuenta.</span></p>
      </div>
    </Transition>
  </section>
</template>
