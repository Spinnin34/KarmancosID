<script setup lang="ts">
import { ref } from "vue";
import { ArrowRight } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";
import { identityApi } from "@/lib/identity-api";

const recoveryCode = ref("");
const password = ref("");
const confirmation = ref("");
const error = ref("");
const success = ref("");
const loading = ref(false);

async function submit() {
  error.value = "";
  success.value = "";
  if (password.value.length < 12) {
    error.value = "La contraseña debe tener al menos 12 caracteres.";
    return;
  }
  if (password.value !== confirmation.value) {
    error.value = "Las contraseñas nuevas no coinciden.";
    return;
  }

  loading.value = true;
  try {
    const data = await identityApi<{ message?: string }>("/api/auth/recovery/complete", {
      method: "POST",
      body: { recoveryCode: recoveryCode.value.trim(), newPassword: password.value },
    });
    recoveryCode.value = "";
    password.value = "";
    confirmation.value = "";
    success.value = data.message || "Contraseña actualizada.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo completar la recuperación.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="auth-form account-recovery-form" novalidate @submit.prevent="submit">
    <div class="form-heading">
      <h2>Recupera el acceso</h2>
      <p>Usa el código temporal que te entregó una persona administradora.</p>
    </div>
    <Input id="recovery-code" v-model="recoveryCode" label="Código de recuperación" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="Código entregado por administración" required />
    <Input id="recovery-new-password" v-model="password" label="Nueva contraseña" type="password" autocomplete="new-password" minlength="12" maxlength="128" required />
    <Input id="recovery-confirm-password" v-model="confirmation" label="Repite la contraseña" type="password" autocomplete="new-password" maxlength="128" required />
    <p class="mfa-recovery-help">El código es temporal, de un solo uso y no se envía por correo.</p>
    <p v-if="error" class="form-message" role="alert">{{ error }}</p>
    <p v-if="success" class="inline-notice" role="status">{{ success }} <a href="/login">Iniciar sesión</a></p>
    <Button class="form-action" variant="solid" size="lg" type="submit" :loading="loading">
      <span class="auth-button-copy"><span>Cambiar contraseña</span><ArrowRight :size="20" aria-hidden="true" /></span>
    </Button>
  </form>
</template>
