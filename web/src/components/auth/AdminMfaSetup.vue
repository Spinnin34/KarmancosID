<script setup lang="ts">
import { onMounted, ref } from "vue";
import Button from "@/components/ui/Button.vue";
import Collapsible from "@/components/ui/Collapsible.vue";
import InputOTP from "@/components/ui/InputOTP.vue";
import { identityApi } from "@/lib/identity-api";

const secret = ref("");
const uri = ref("");
const qrCode = ref("");
const qrError = ref("");
const code = ref("");
const recoveryCodes = ref<string[]>([]);
const loading = ref(false);
const error = ref("");
const copied = ref(false);

onMounted(async () => {
  try {
    const data = await identityApi<{ secret: string; uri: string }>("/api/auth/mfa/setup", { cache: "no-store" });
    secret.value = data.secret;
    uri.value = data.uri;
    try {
      const { default: QRCode } = await import("qrcode");
      qrCode.value = await QRCode.toDataURL(data.uri, {
        errorCorrectionLevel: "M",
        margin: 3,
        width: 240,
        color: { dark: "#111827", light: "#ffffff" },
      });
    } catch {
      qrError.value = "No se pudo generar el QR. Puedes añadir la clave de configuración manualmente.";
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo preparar la configuración.";
  }
});

async function verify() {
  error.value = "";
  loading.value = true;
  try {
    const data = await identityApi<{ recoveryCodes: string[]; next?: string }>("/api/auth/mfa/setup/verify", {
      method: "POST",
      body: { code: code.value },
    });
    recoveryCodes.value = data.recoveryCodes;
    window.sessionStorage.setItem("karmancos-admin-mfa-next", data.next || "/admin");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo verificar el código.";
  } finally {
    loading.value = false;
  }
}

async function copyCodes() {
  try {
    await navigator.clipboard.writeText(recoveryCodes.value.join("\n"));
    copied.value = true;
  } catch {
    error.value = "No se pudieron copiar los códigos. Selecciónalos y guárdalos en un lugar seguro.";
  }
}

function continueToAdmin() {
  const next = window.sessionStorage.getItem("karmancos-admin-mfa-next") || "/admin";
  window.sessionStorage.removeItem("karmancos-admin-mfa-next");
  window.location.assign(next.startsWith("/") && !next.startsWith("//") ? next : "/admin");
}
</script>

<template>
  <section class="mfa-setup" aria-labelledby="mfa-setup-title">
    <template v-if="recoveryCodes.length === 0">
      <div class="form-heading">
        <h2 id="mfa-setup-title">Protege tu acceso</h2>
        <p>La verificación en dos pasos es obligatoria para las cuentas administradoras. Añade Karmancos ID a tu aplicación autenticadora.</p>
      </div>

      <div v-if="secret" class="mfa-setup-methods">
        <section class="mfa-qr-option" aria-labelledby="mfa-qr-title">
          <div class="mfa-option-heading">
            <span class="mfa-option-number" aria-hidden="true">1</span>
            <div>
              <h3 id="mfa-qr-title">Escanea el código QR</h3>
              <p>Abre tu aplicación autenticadora, pulsa añadir cuenta y escanea este código.</p>
            </div>
          </div>
          <div class="mfa-qr-frame" aria-live="polite">
            <img
              v-if="qrCode"
              class="mfa-qr-image"
              :src="qrCode"
              alt="Código QR para añadir Karmancos ID a la aplicación autenticadora"
              width="240"
              height="240"
            />
            <p v-else-if="qrError" class="mfa-qr-error" role="status">{{ qrError }}</p>
            <p v-else class="mfa-qr-loading" role="status">Preparando el código QR…</p>
          </div>
          <p class="mfa-qr-private">El código se genera en esta pantalla; no se envía a Google ni a otro servicio.</p>
        </section>

        <Collapsible
          id="mfa-manual-setup"
          class="mfa-manual-option"
          title="Introducir la clave manualmente"
          variant="surface"
          size="md"
        >
          <template #trigger>
            <span class="mfa-option-number" aria-hidden="true">2</span>
            <span class="mfa-manual-heading">
              <strong>Introducir la clave manualmente</strong>
              <small>Úsala si no puedes escanear el QR o estás configurando el móvil donde ves esta página.</small>
            </span>
          </template>
          <div class="mfa-secret-block">
            <span class="mfa-secret-label">Clave de configuración</span>
            <code>{{ secret }}</code>
            <p class="mfa-manual-instruction">En la aplicación, elige «Introducir una clave de configuración» y selecciona «Basada en tiempo».</p>
            <a class="mfa-uri-link" :href="uri">Abrir en una aplicación compatible</a>
          </div>
        </Collapsible>
      </div>

      <form class="auth-form" @submit.prevent="verify">
        <InputOTP
          id="mfa-setup-code"
          v-model="code"
          label="Código de seis cifras"
          :length="6"
          :disabled="!secret || loading"
          grouped
          variant="outline"
          hint="Introduce el código actual de tu aplicación autenticadora."
          required
        />
        <p v-if="error" class="form-message" role="alert">{{ error }}</p>
        <Button class="form-action" variant="solid" size="lg" type="submit" :loading="loading" :disabled="!secret || code.length !== 6">Activar verificación en dos pasos</Button>
      </form>
    </template>

    <template v-else>
      <div class="form-heading">
        <h2 id="mfa-setup-title">Guarda estos códigos</h2>
        <p>Cada código sirve una sola vez si no tienes tu aplicación autenticadora. Guárdalos fuera de este dispositivo.</p>
      </div>
      <ul class="mfa-recovery-codes" aria-label="Códigos de recuperación de un solo uso">
        <li v-for="recoveryCode in recoveryCodes" :key="recoveryCode"><code>{{ recoveryCode }}</code></li>
      </ul>
      <div class="mfa-setup-actions">
        <Button variant="outline" type="button" @click="copyCodes">{{ copied ? "Códigos copiados" : "Copiar códigos" }}</Button>
        <Button variant="solid" type="button" @click="continueToAdmin">Continuar</Button>
      </div>
      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
    </template>
  </section>
</template>
