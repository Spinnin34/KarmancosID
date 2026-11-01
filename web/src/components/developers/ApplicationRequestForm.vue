<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ArrowRight, Check, ClipboardCheck, ShieldCheck } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";
import Link from "@/components/ui/Link.vue";
import Select from "@/components/ui/Select.vue";
import Textarea from "@/components/ui/Textarea.vue";
import { identityApi } from "@/lib/identity-api";
import { isPreviewMode } from "@/lib/preview-mode";

const name = ref("");
const contactEmail = ref("");
const description = ref("");
const clientType = ref("confidential");
const redirectUris = ref("");
const postLogoutRedirectUris = ref("");
const loading = ref(false);
const error = ref("");
const submitted = ref<{ name: string; email: string; returns: number; preview: boolean } | null>(null);
const completeTitle = ref<HTMLElement | null>(null);
const types = [{ label: "Confidencial · aplicación con servidor", value: "confidential" }, { label: "Público · SPA en navegador", value: "public" }];

onMounted(() => {
  if (isPreviewMode() && new URLSearchParams(window.location.search).get("preview_state") === "submitted") {
    submitted.value = { name: "Atlas Research", email: "dev@atlas.example.test", returns: 1, preview: true };
  }
});

function lines(value: string) { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }

async function submit() {
  if (loading.value) return;
  error.value = "";
  loading.value = true;
  try {
    await identityApi<{ message?: string }>("/api/public/applications", {
      method: "POST",
      body: { name: name.value.trim(), contactEmail: contactEmail.value.trim(), description: description.value.trim(),
        clientType: clientType.value, redirectUris: lines(redirectUris.value), postLogoutRedirectUris: lines(postLogoutRedirectUris.value) },
    });
    submitted.value = { name: name.value.trim(), email: contactEmail.value.trim(), returns: lines(redirectUris.value).length, preview: isPreviewMode() };
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "No se pudo conectar con Karmancos ID."; }
  finally { loading.value = false; }
}

function startAnotherRequest() {
  submitted.value = null;
  name.value = "";
  contactEmail.value = "";
  description.value = "";
  clientType.value = "confidential";
  redirectUris.value = "";
  postLogoutRedirectUris.value = "";
  error.value = "";
}

function focusResult() {
  const target = submitted.value ? completeTitle.value : document.getElementById("request-name");
  target?.focus({ preventScroll: true });
  if (target && target.getBoundingClientRect().top < 70) {
    target.closest(".developer-request")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}
</script>

<template>
  <Transition name="consent-stage" mode="out-in" @after-enter="focusResult">
    <div v-if="submitted" key="complete" class="request-complete">
      <div class="completion-emblem completion-emblem--request" aria-hidden="true"><ClipboardCheck :size="34" :stroke-width="1.3" /></div>
      <p class="completion-kicker">INTEGRACIÓN DE APLICACIONES</p>
      <h2 id="request-heading" ref="completeTitle" tabindex="-1">Solicitud recibida.</h2>
      <p class="completion-intro">Hemos recibido la solicitud de <strong>{{ submitted.name }}</strong>. Administración revisará sus dominios y permisos.</p>
      <dl class="submission-receipt"><div><dt>Servicio</dt><dd>{{ submitted.name }}</dd></div><div><dt>Contacto técnico</dt><dd>{{ submitted.email }}</dd></div><div><dt>URL de retorno</dt><dd>{{ submitted.returns }}</dd></div></dl>
      <ol class="request-next-steps"><li class="is-complete"><span><Check :size="14" aria-hidden="true" /></span><div><strong>Solicitud enviada</strong><small>Los datos están listos para la revisión.</small></div></li><li><span>2</span><div><strong>Revisión de la integración</strong><small>Administración comprobará el servicio y sus URL.</small></div></li><li><span>3</span><div><strong>Registro del cliente</strong><small>Tras la aprobación, se podrán crear las credenciales.</small></div></li></ol>
      <p class="request-completion-note"><ShieldCheck :size="16" aria-hidden="true" /><span>La solicitud no activa acceso ni genera credenciales automáticamente.</span></p>
      <div class="completion-actions"><Button variant="outline" color="secondary" type="button" @click="startAnotherRequest">Enviar otra solicitud</Button><Link href="/cuenta#apps" variant="text" color="secondary">Ir a mi cuenta</Link></div>
      <p v-if="submitted.preview" class="completion-preview-note">Envío de demostración · Modo preview</p>
    </div>
    <div v-else key="form">
      <header class="developer-request-heading"><h2 id="request-heading">Solicitar acceso</h2><p>Cuéntanos qué hace tu servicio y qué datos necesita. La solicitud no crea credenciales automáticamente.</p></header>
      <form class="developer-request-form" :aria-busy="loading || undefined" @submit.prevent="submit">
        <Input id="request-name" v-model="name" label="Nombre del servicio" maxlength="100" required />
        <Input id="request-contact" v-model="contactEmail" label="Correo de contacto técnico" type="email" autocomplete="email" maxlength="320" required />
        <Select id="request-type" v-model="clientType" label="Tipo de aplicación" :options="types" />
        <Textarea id="request-description" v-model="description" label="Qué ofrece la aplicación y qué datos necesita" :rows="3" :max-height="180" :maxlength="1000" required />
        <Textarea id="request-callbacks" v-model="redirectUris" label="URI de retorno permitidas" :rows="3" :max-height="180" placeholder="https://app.example.com/auth/callback" hint="Una URL exacta HTTPS por línea; sin comodines." required />
        <Textarea id="request-logout" v-model="postLogoutRedirectUris" label="URI tras cerrar sesión · opcional" :rows="2" :max-height="140" placeholder="https://app.example.com/" hint="Una URL exacta por línea." />
        <p v-if="error" class="form-message" role="alert">{{ error }}</p>
        <Button variant="solid" size="lg" type="submit" :loading="loading" :suffix-icon="loading ? undefined : ArrowRight">{{ loading ? 'Enviando solicitud…' : 'Enviar para revisión' }}</Button>
      </form>
    </div>
  </Transition>
</template>
