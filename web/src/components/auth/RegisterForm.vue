<script setup lang="ts">
import { ref } from "vue";
import { ArrowRight } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";
import { identityApi } from "@/lib/identity-api";

const username = ref("");
const firstName = ref("");
const lastName = ref("");
const secondLastName = ref("");
const email = ref("");
const password = ref("");
const confirmation = ref("");
const loading = ref(false);
const message = ref("");
async function submit() {
  message.value = "";

  const emailInput = document.getElementById("register-email") as HTMLInputElement | null;
  if (emailInput && !emailInput.checkValidity()) {
    emailInput.reportValidity();
    return;
  }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username.value.trim())) {
    message.value = "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.";
    return;
  }
  if (!firstName.value.trim() || !lastName.value.trim()) {
    message.value = "Escribe tu nombre y tu primer apellido.";
    return;
  }
  if (password.value.length < 12) {
    message.value = "Usa una contraseña de 12 caracteres o más.";
    return;
  }
  if (password.value !== confirmation.value) {
    message.value = "Las contraseñas no coinciden.";
    return;
  }

  loading.value = true;
  try {
    await identityApi("/api/auth/register", {
      method: "POST",
      body: {
        username: username.value.trim().toLowerCase(),
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        secondLastName: secondLastName.value.trim(),
        email: email.value.trim().toLowerCase(),
        password: password.value
      }
    });
    window.location.assign("/login?created=1");
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : "No se pudo crear la cuenta con esos datos.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="auth-form register-form" novalidate @submit.prevent="submit">
    <div class="form-heading">
      <h2>Empieza aquí</h2>
      <p>Crea una cuenta para usarla en todos tus sitios conectados.</p>
    </div>
    <div class="register-fields">
      <div class="register-field">
        <Input
          id="register-username"
          v-model="username"
          label="Usuario"
          type="text"
          autocomplete="username"
          placeholder="tuusuario"
          minlength="3"
          maxlength="32"
          autocapitalize="none"
          spellcheck="false"
          required
        />
      </div>
      <div class="register-field">
        <Input
          id="register-first-name"
          v-model="firstName"
          label="Nombre"
          autocomplete="given-name"
          placeholder="Tu nombre"
          maxlength="80"
          required
        />
      </div>
      <div class="register-field">
        <Input
          id="register-last-name"
          v-model="lastName"
          label="Apellido 1"
          autocomplete="family-name"
          placeholder="Primer apellido"
          maxlength="80"
          required
        />
      </div>
      <div class="register-field">
        <Input
          id="register-second-last-name"
          v-model="secondLastName"
          label="Apellido 2 · opcional"
          autocomplete="additional-name"
          placeholder="Segundo apellido"
          maxlength="80"
        />
      </div>
      <div class="register-field register-field-wide">
        <Input
          id="register-email"
          v-model="email"
          label="Correo electrónico"
          type="email"
          autocomplete="email"
          placeholder="tu@correo.com"
          maxlength="320"
          required
        />
        <p class="field-note">El correo se guarda como dato de cuenta. No se verifica ni se usa para recuperar acceso.</p>
      </div>
      <div class="register-field">
        <Input
          id="register-password"
          v-model="password"
          label="Contraseña"
          type="password"
          autocomplete="new-password"
          placeholder="12 caracteres o más"
          minlength="12"
          maxlength="128"
          required
        />
      </div>
      <div class="register-field">
        <Input
          id="register-password-confirm"
          v-model="confirmation"
          label="Repite la contraseña"
          type="password"
          autocomplete="new-password"
          placeholder="Vuelve a escribirla"
          maxlength="128"
          required
        />
      </div>
      <p v-if="message" class="form-message register-field-wide" role="alert">{{ message }}</p>
      <Button class="form-action register-field-wide" variant="solid" size="lg" type="submit" :loading="loading">
        <span class="auth-button-copy"><span>{{ loading ? "Creando tu cuenta" : "Crear cuenta" }}</span><ArrowRight class="auth-button-arrow" :size="20" :stroke-width="1.8" aria-hidden="true" /></span>
      </Button>
    </div>
  </form>
</template>
