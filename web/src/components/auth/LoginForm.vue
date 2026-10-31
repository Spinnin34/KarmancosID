<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ArrowRight, ArrowUpRight, CircleCheck } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";
import InputOTP from "@/components/ui/InputOTP.vue";
import { identityApi } from "@/lib/identity-api";

const identifier = ref("");
const password = ref("");
const loading = ref(false);
const message = ref("");
const notice = ref("");
const stage = ref<"credentials" | "mfa">("credentials");
const useRecoveryCode = ref(false);
const factorCode = ref("");
const requestedSite = ref<{ name: string; domain: string } | null>(null);
onMounted(() => {
  const query = new URLSearchParams(window.location.search);
  if (query.get("updated") === "1") {
    notice.value = "Cambios guardados. Inicia sesión para continuar.";
  } else if (query.get("created") === "1") {
    notice.value = "Cuenta creada. Ya puedes iniciar sesión.";
  }
  if (window.location.pathname === "/login") {
    identityApi<{ requested?: boolean; name?: string; domain?: string }>("/api/auth/continue")
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
    const data = await identityApi<{ next?: string; requiresMfa?: boolean; requiresMfaSetup?: boolean }>("/api/auth/login", {
      method: "POST",
      body: { identifier: identifier.value.trim(), password: password.value },
    });
    if (data.requiresMfa) {
      stage.value = "mfa";
      password.value = "";
      message.value = "";
      return;
    }
    if (data.requiresMfaSetup) {
      window.location.assign("/configurar-2fa");
      return;
    }
    const next = typeof data.next === "string" && data.next.startsWith("/") && !data.next.startsWith("//")
      ? data.next
      : "/cuenta";
    window.location.assign(next);
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : "No se pudo iniciar sesión.";
  } finally {
    loading.value = false;
  }
}

async function verifyMfa() {
  message.value = "";
  loading.value = true;
  try {
    const data = await identityApi<{ next?: string }>("/api/auth/mfa/verify", {
      method: "POST",
      body: { code: factorCode.value.trim() },
    });
    const next = typeof data.next === "string" && data.next.startsWith("/") && !data.next.startsWith("//") ? data.next : "/admin";
    window.location.assign(next);
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : "No se pudo verificar el código.";
    factorCode.value = "";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="auth-form login-form" novalidate @submit.prevent="stage === 'credentials' ? submit() : verifyMfa()">
    <div v-if="stage === 'credentials'" class="form-heading">
      <h2>Vuelve a entrar</h2>
      <p>Usa tu cuenta Karmancos ID para continuar.</p>
    </div>
    <div v-if="requestedSite" class="login-request-context" role="status">
      <span class="login-request-context-mark" aria-hidden="true"><ArrowUpRight :size="23" :stroke-width="1.8" /></span>
      <span class="login-request-context-copy">
        <span>Después de iniciar sesión, volverás a</span>
        <strong>{{ requestedSite.name }}</strong>
        <small>{{ requestedSite.domain || "Sitio conectado con Karmancos ID" }}</small>
      </span>
      <span class="login-request-context-check" aria-hidden="true"><CircleCheck :size="21" :stroke-width="1.8" /></span>
    </div>
    <div v-if="stage === 'credentials'" class="login-fields">
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
      <p class="login-recovery-link login-fields-wide"><a href="/recuperar-cuenta">¿Tienes un código de recuperación?</a></p>
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
    <div v-else class="login-fields mfa-challenge-fields">
      <div class="form-heading">
        <h3>Confirma tu identidad</h3>
        <p>Escribe el código de tu aplicación autenticadora o usa uno de tus códigos de recuperación.</p>
      </div>
      <InputOTP
        v-if="!useRecoveryCode"
        id="login-mfa-code"
        v-model="factorCode"
        label="Código de seis cifras"
        :length="6"
        grouped
        variant="outline"
        required
        @complete="verifyMfa"
      />
      <Input
        v-else
        id="login-mfa-recovery-code"
        v-model="factorCode"
        label="Código de recuperación"
        autocomplete="one-time-code"
        autocapitalize="characters"
        spellcheck="false"
        required
      />
      <p v-if="message" class="form-message login-fields-wide" role="alert">{{ message }}</p>
      <button class="auth-text-action" type="button" @click="useRecoveryCode = !useRecoveryCode; factorCode = ''; message = ''">
        {{ useRecoveryCode ? "Usar la aplicación autenticadora" : "Usar un código de recuperación" }}
      </button>
      <Button class="form-action login-fields-wide" variant="solid" size="lg" type="submit" :loading="loading" :disabled="factorCode.length < 6">
        <span class="auth-button-copy"><span>{{ loading ? "Verificando" : "Continuar" }}</span><ArrowRight class="auth-button-arrow" :size="20" :stroke-width="1.8" aria-hidden="true" /></span>
      </Button>
      <button class="auth-text-action" type="button" @click="stage = 'credentials'; factorCode = ''; message = ''">Volver al inicio de sesión</button>
    </div>
  </form>
</template>
