<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ArrowUpRight, Eye } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Link from "@/components/ui/Link.vue";
import { isPreviewMode, leavePreviewMode } from "@/lib/preview-mode";

const visible = ref(false);

onMounted(() => {
  visible.value = isPreviewMode();
});
</script>

<template>
  <aside v-if="visible" class="preview-toolbar" aria-label="Modo de vista previa">
    <span class="preview-toolbar-status"><Eye :size="16" aria-hidden="true" /><strong>Vista previa local</strong><span>Datos ficticios · cambios temporales</span></span>
    <nav aria-label="Acciones de vista previa">
      <Link href="/preview" variant="text" color="secondary" size="sm" :suffix-icon="ArrowUpRight">Catálogo</Link>
      <Button variant="outline" color="secondary" size="sm" type="button" @click="leavePreviewMode">Salir</Button>
    </nav>
  </aside>
</template>
