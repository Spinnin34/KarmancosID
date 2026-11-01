<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";
import Link from "@/components/ui/Link.vue";

type PreviewPage = { title: string; description: string; href: string; note?: string };
type PreviewGroup = { title: string; description: string; pages: PreviewPage[] };

const groups: PreviewGroup[] = [
  {
    title: "Identidad y acceso",
    description: "Recorre el inicio de sesión, el alta de cuenta y la protección MFA.",
    pages: [
      { title: "Acceso", description: "Formulario y solicitud de servicio conectado.", href: "/?preview=1" },
      { title: "Verificación MFA", description: "Segundo paso con código de seis cifras.", href: "/login?preview=1&preview_state=mfa" },
      { title: "Crear cuenta", description: "Datos personales y credenciales.", href: "/registro?preview=1" },
      { title: "Recuperar acceso", description: "Restablecimiento con código temporal.", href: "/recuperar-cuenta?preview=1" },
      { title: "Configurar 2FA", description: "QR de ejemplo, clave manual y verificación.", href: "/configurar-2fa?preview=1" },
    ],
  },
  {
    title: "Cuenta e integraciones",
    description: "Las pantallas cargan con una identidad y servicios ficticios.",
    pages: [
      { title: "Consentimiento OAuth", description: "Aplicación de ejemplo y permisos solicitados.", href: "/consent?preview=1&client_id=demo-client&state=preview&scope=openid%20profile%20email" },
      { title: "Consentimiento · Confirmación", description: "Cuenta conectada y resumen de permisos.", href: "/consent?preview=1&preview_state=authorized&client_id=demo-client&state=preview&scope=openid%20profile%20email", note: "ÉXITO" },
      { title: "Consentimiento · Contenido largo", description: "Servicio y dominio extensos en pantalla pequeña.", href: "/consent?preview=1&preview_state=long&client_id=demo-client&state=preview&scope=openid%20profile%20email" },
      { title: "Consentimiento · Solicitud incompleta", description: "Mensaje de error y acción para volver a la cuenta.", href: "/consent?preview=1", note: "ERROR" },
      { title: "Desarrolladores", description: "Información de integración y formulario de solicitud.", href: "/desarrolladores?preview=1" },
      { title: "Integración · Solicitud recibida", description: "Resumen del envío y próximos pasos.", href: "/desarrolladores?preview=1&preview_state=submitted", note: "ÉXITO" },
      { title: "Cuenta · Perfil", description: "Identidad, datos y foto de perfil.", href: "/cuenta?preview=1#profile" },
      { title: "Cuenta · Seguridad", description: "Cambio de contraseña y recomendaciones.", href: "/cuenta?preview=1#security" },
      { title: "Cuenta · Sesiones", description: "Dispositivos activos y revocación simulada.", href: "/cuenta?preview=1#sessions" },
      { title: "Cuenta · Aplicaciones", description: "Permisos de servicios conectados.", href: "/cuenta?preview=1#apps" },
      { title: "Cuenta · Estado vacío", description: "Sin sesiones ni aplicaciones conectadas.", href: "/cuenta?preview=1&preview_state=empty#apps", note: "VACÍO" },
    ],
  },
  {
    title: "Administración",
    description: "Navegación, tablas y acciones con datos solo de demostración.",
    pages: [
      { title: "Resumen", description: "Cuentas, clientes y sesiones activas.", href: "/admin?preview=1#overview" },
      { title: "Solicitudes", description: "Revisión de integraciones entrantes.", href: "/admin?preview=1#applications" },
      { title: "Sitios conectados", description: "Registro y gestión de clientes OIDC.", href: "/admin?preview=1#clients" },
      { title: "Cuentas", description: "Búsqueda, filtros, perfiles y acceso.", href: "/admin?preview=1#users" },
      { title: "Sesiones", description: "Sesiones abiertas en el centro de identidad.", href: "/admin?preview=1#sessions" },
      { title: "Actividad", description: "Historial de acciones de ejemplo.", href: "/admin?preview=1#activity" },
      { title: "Administración · Estado vacío", description: "Tablas y métricas sin registros.", href: "/admin?preview=1&preview_state=empty#overview", note: "VACÍO" },
      { title: "Administración · Error", description: "Respuesta de error recuperable.", href: "/admin?preview=1&preview_state=error#overview", note: "ERROR" },
    ],
  },
];
const pageCount = groups.reduce((count, group) => count + group.pages.length, 0);
</script>

<template>
  <main class="preview-catalog">
    <header class="preview-catalog-header">
      <a class="brand-lockup" href="/" aria-label="Karmancos ID, inicio">
        <span class="brand-mark" aria-hidden="true"><img src="/images/karmancos-id-mark.png" alt="" /></span>
        <span class="brand-name">KARMANCOS<span>ID</span></span>
      </a>
      <p class="preview-environment"><span aria-hidden="true"></span>Entorno local · datos de muestra</p>
    </header>

    <section class="preview-catalog-intro" aria-labelledby="preview-heading">
      <p class="preview-kicker">REVISIÓN DE INTERFAZ</p>
      <h1 id="preview-heading">Karmancos ID, en todas sus pantallas.</h1>
      <p>Abre cada recorrido en su propia página. Los formularios responden con datos de ejemplo y los cambios se descartan al recargar.</p>
      <div class="preview-catalog-tools" aria-label="Cobertura de la vista previa">
        <span>{{ pageCount }} destinos</span><span>4 tamaños de revisión</span><span>Sin conexión a servicios reales</span>
      </div>
    </section>

    <div class="preview-groups">
      <section v-for="group in groups" :key="group.title" class="preview-group" :aria-label="group.title">
        <header class="preview-group-heading">
          <h2>{{ group.title }}</h2>
          <p>{{ group.description }}</p>
        </header>
        <div class="preview-page-list">
          <Link
            v-for="page in group.pages"
            :key="page.href"
            :href="page.href"
            variant="text"
            color="secondary"
            size="md"
            class="preview-page-link"
          >
            <span class="preview-page-copy"><strong>{{ page.title }}</strong><small>{{ page.description }}</small></span>
            <span v-if="page.note" class="preview-page-note">{{ page.note }}</span>
            <ArrowUpRight :size="17" :stroke-width="1.8" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>

    <footer class="preview-catalog-footer">
      <span>Vista previa disponible solo durante el desarrollo.</span>
      <span>La paleta y los controles son los de la aplicación.</span>
    </footer>
  </main>
</template>
