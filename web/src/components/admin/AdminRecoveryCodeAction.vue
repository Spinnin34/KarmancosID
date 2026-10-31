<script setup lang="ts">
import { ref, watch } from "vue";
import Button from "@/components/ui/Button.vue";
import Modal from "@/components/ui/Modal.vue";
import { identityApi } from "@/lib/identity-api";

const props = defineProps<{ userId: string; email: string; disabled?: boolean }>();
const code = ref("");
const expiresAt = ref("");
const error = ref("");
const loading = ref(false);
const copied = ref(false);
const dialogOpen = ref(false);

watch(dialogOpen, (isOpen) => {
  if (!isOpen) {
    code.value = "";
    expiresAt.value = "";
    copied.value = false;
    error.value = "";
  }
});

async function issueCode() {
  error.value = "";
  if (!window.confirm(`Confirma la identidad de ${props.email} fuera de Karmancos ID antes de emitir y entregar el código.`)) return;
  loading.value = true;
  try {
    const result = await identityApi<{ recoveryCode: string; expiresAt: string }>(
      `/api/admin/users/${encodeURIComponent(props.userId)}/recovery-code`,
      { method: "POST" },
    );
    code.value = result.recoveryCode;
    expiresAt.value = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.expiresAt));
    dialogOpen.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "No se pudo emitir el código.";
  } finally {
    loading.value = false;
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(code.value);
    copied.value = true;
  } catch {
    error.value = "No se pudo copiar. Selecciona el código y guárdalo temporalmente.";
  }
}
</script>

<template>
  <div class="admin-recovery-action">
    <Button variant="outline" color="secondary" size="sm" type="button" :disabled="disabled" :loading="loading" @click="issueCode">Emitir recuperación</Button>
    <p v-if="error" class="form-message" role="alert">{{ error }}</p>
    <Modal
      v-model="dialogOpen"
      id="admin-recovery-code"
      title="Código temporal de recuperación"
      :description="`Código para ${email}. Caduca el ${expiresAt}.`"
      close-label="Cerrar código de recuperación"
      presentation="dialog"
      variant="surface"
      size="md"
    >
      <div class="recovery-code-dialog">
        <p>Entrega este código por un canal seguro después de comprobar la identidad fuera de la aplicación. Solo se muestra ahora y caduca en 30 minutos.</p>
        <code>{{ code }}</code>
        <Button variant="outline" type="button" @click="copyCode">{{ copied ? "Copiado" : "Copiar código" }}</Button>
      </div>
    </Modal>
  </div>
</template>
