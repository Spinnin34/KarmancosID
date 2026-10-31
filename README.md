# Karmancos ID

**Identity provider centralizado de Karmancos.** Karmancos ID permite que sitios y aplicaciones se autentiquen mediante OpenID Connect sin gestionar contraseñas por separado.

> Estado: prototipo funcional en desarrollo (`0.1.0`). Revisa [Seguridad y preparación para producción](#seguridad-y-preparación-para-producción) antes de exponerlo a usuarios reales.

## Qué incluye

- Inicio de sesión, registro, consentimiento OIDC y paneles de cuenta y administración.
- OpenID Connect Authorization Code con PKCE, callback exacto y subjects opacos pairwise.
- SDK de navegador con ventana emergente, flujo por redirección y validación de ID tokens.
- Integraciones externas mediante clientes públicos y confidenciales.
- Verificación de correo y recuperación de contraseña con tokens de un solo uso.
- Gestión y revocación de sesiones, autorizaciones y aplicaciones conectadas.
- Formularios de solicitud de integración y revisión desde el panel admin.
- API Node.js integrada en Astro y desplegable como funciones de Vercel.

## Requisitos

- Git.
- Node.js 22.12+ y npm.
- MongoDB accesible desde la API.
- Un servicio SMTP para entregar los correos de verificación y recuperación.

## Empezar en local

1. Clona el repositorio, copia la plantilla local y configura una base MongoDB y claves de desarrollo:

   ```powershell
   git clone <URL-DEL-REPOSITORIO>
   cd KarmancosID
   Copy-Item web/.env.example web/.env
   cd web
   npm ci
   npm run dev
   ```

   Completa `web/.env` con valores de desarrollo. Usa una base MongoDB aislada, claves de firma propias y credenciales SMTP de prueba; nunca apuntes a producción.

2. Abre la URL que muestre Astro, normalmente [http://localhost:4321](http://localhost:4321), crea una cuenta y entra en `/admin` si ya configuraste un administrador inicial.

Consulta [Despliegue](docs/DEPLOYMENT.md) para las variables necesarias y la configuración exacta de Vercel.

## Integrar una aplicación

### 1. Registrar el cliente

Una integración puede solicitar acceso en `/desarrolladores`. Un administrador revisa las solicitudes en `/admin#applications`; la aprobación no crea credenciales automáticamente. Después registra el cliente desde `/admin#clients` y valida cada URI de retorno.

- **Público:** SPA o aplicación móvil. No puede proteger un secreto; usa PKCE y no obtiene refresh tokens.
- **Confidencial:** aplicación con servidor. El secreto se muestra una sola vez; guárdalo en un gestor de secretos.

Usa HTTPS fuera de localhost. Los callbacks se comparan exactamente; no registres comodines.

### 2. Usar OIDC

El documento de descubrimiento está disponible en:

```text
http://localhost:4321/.well-known/openid-configuration
```

En producción, reemplaza el origen por el `issuer` HTTPS configurado. Para sitios web, añade también el origen exacto en «Orígenes web autorizados» para permitir el intercambio del código desde el navegador. En aplicaciones móviles y servidores, utiliza una biblioteca OIDC mantenida para tu plataforma.

El SDK del repositorio está en [`sdk/`](sdk/README.md):

```js
import { completePopup, createKarmancosID } from "@karmancosid/web";

// Ejecutar en la URI de retorno registrada.
completePopup();

const identity = createKarmancosID({
  issuer: "https://id.example.com",
  clientId: "kmc_...",
  redirectUri: "https://app.example.com/auth/karmancos/callback",
  scopes: ["openid", "profile", "email"]
});

const session = await identity.signIn();
console.log(session.user.sub);
```

`signIn()` abre el flujo de autorización en una ventana emergente; también admite `signIn({ mode: "redirect" })`. Para redirección, el callback debe ejecutar `completeRedirect()`. El paquete es código fuente del repositorio; no asumas que está publicado en npm.

## Desarrollo por separado

La API vive en `web/src/server/identity/` y Astro la sirve localmente. No hace falta arrancar otro proceso de backend. `IDENTITY_API_TARGET` solo activa un proxy opcional a otro servidor para compatibilidad durante el desarrollo.

## Verificación

```powershell
cd web
npm run build
npx tsc --noEmit
```

## Seguridad y preparación para producción

El proyecto incorpora PKCE, CSRF para operaciones web, cookies HTTP-only, límites de intentos persistidos en MongoDB, BCrypt, revocación de sesiones y autorizaciones, tokens de correo de un solo uso, CORS por origen aprobado, cabeceras del navegador y claves RSA persistentes. En Vercel, MongoDB, SMTP, las claves y el secreto HMAC se configuran como variables de entorno; el backend Java anterior no participa en el despliegue.

Antes de publicar el servicio:

1. Usa una base MongoDB dedicada, con mínimo privilegio, copias de seguridad y restauraciones probadas.
2. Configura `PUBLIC_IDENTITY_ISSUER` con el origen HTTPS de Vercel. `KARMANCOS_ISSUER` y `KARMANCOS_PUBLIC_BASE_URL` pueden usar el mismo origen.
3. Carga las claves privada y pública RSA en Base64 como secretos de Vercel. No las subas al repositorio ni las envíes en logs.
4. Genera `KARMANCOS_SUBJECT_HMAC_SECRET` aleatoriamente y consérvalo estable: cambiarlo modifica los `sub` de los usuarios.
5. Configura y prueba SMTP, monitorización, alertas, rotación planificada y restauración ante incidentes.
6. Revisa el modelo de privacidad y las obligaciones legales que apliquen a tu despliegue.

La autenticación multifactor con passkeys o TOTP aún no está implementada. Las pruebas actuales no sustituyen una revisión de seguridad ni una prueba integral en un entorno de staging. Más detalles en [Seguridad](SECURITY.md) y [Despliegue](docs/DEPLOYMENT.md).

## Documentación del repositorio

- [Arquitectura](docs/ARCHITECTURE.md)
- [Despliegue y variables](docs/DEPLOYMENT.md)
- [SDK web](sdk/README.md)
- [Cómo contribuir](CONTRIBUTING.md)
- [Cómo reportar vulnerabilidades](SECURITY.md)

## Tecnologías

| Área | Tecnología |
| --- | --- |
| Identidad y API | Node.js, Astro Server Endpoints y Vercel Functions |
| Persistencia | MongoDB y MongoDB Node.js Driver |
| Interfaz | Astro, Vue y componentes Balsa UI |
| Integración | OpenID Connect, OAuth 2.0 Authorization Code y PKCE |

## Licencia

No se ha definido una licencia en este repositorio todavía. Hasta que se añada una, no presupongas que el código puede redistribuirse o reutilizarse libremente.
