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
- Caddy para servir la web, aplicar cabeceras de seguridad y enrutar al backend.

## Requisitos

- Git.
- Java 21 y Maven 3.9+ para desarrollar el backend fuera de Docker.
- Node.js 22.12+ y npm para la web.
- MongoDB accesible para el backend.
- Docker Compose para ejecutar el stack empaquetado. MongoDB es externo al `compose.yaml` actual.

## Empezar en local

1. Clona el repositorio y crea tu configuración local a partir de la plantilla:

   ```bash
   git clone <URL-DEL-REPOSITORIO>
   cd KarmancosID
   cp .env.example .env
   ```

   En PowerShell, usa `Copy-Item .env.example .env`. Completa `MONGODB_URI` con una base **de desarrollo**, además del correo y la contraseña de bootstrap del administrador. La contraseña inicial debe tener al menos 16 caracteres. No uses una base de producción para probar.

2. Inicia el stack:

   ```bash
   docker compose up --build
   ```

3. Abre [http://localhost](http://localhost), crea una cuenta en `/registro` y entra en `/admin` con el administrador de bootstrap.

El servidor requiere una instancia MongoDB que no forma parte de Docker Compose. Si los contenedores arrancan antes de completar las variables del administrador, recrea solo el servicio de identidad después de corregir la configuración:

```bash
docker compose up -d --force-recreate identity
```

Consulta [Despliegue](docs/DEPLOYMENT.md) para desarrollo separado, variables, salud y configuración de producción.

## Integrar una aplicación

### 1. Registrar el cliente

Una integración puede solicitar acceso en `/desarrolladores`. Un administrador revisa las solicitudes en `/admin#applications`; la aprobación no crea credenciales automáticamente. Después registra el cliente desde `/admin#clients` y valida cada URI de retorno.

- **Público:** SPA o aplicación móvil. No puede proteger un secreto; usa PKCE y no obtiene refresh tokens.
- **Confidencial:** aplicación con servidor. El secreto se muestra una sola vez; guárdalo en un gestor de secretos.

Usa HTTPS fuera de localhost. Los callbacks se comparan exactamente; no registres comodines.

### 2. Usar OIDC

El documento de descubrimiento está disponible en:

```text
http://localhost/.well-known/openid-configuration
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

La web reenvía las rutas `/api`, `/oauth2`, `/.well-known`, `/userinfo` y `/connect` al backend configurado mediante `IDENTITY_API_TARGET` (por defecto `http://localhost:8080`). Con MongoDB accesible y el backend iniciado, ejecuta:

```bash
# Terminal 1
cd backend
mvn spring-boot:run

# Terminal 2
cd web
npm ci
npm run dev
```

Astro suele mostrar la URL local, normalmente `http://localhost:4321`. El frontend puede mostrar sus páginas aunque el backend esté apagado, pero no funcionarán el login, registro, administración ni los endpoints OIDC.

## Verificación

```bash
cd backend && mvn test
cd ../web && npm run build
node --check ../sdk/index.js
```

En PowerShell ejecuta cada comando desde su carpeta correspondiente si `&&` no está disponible en tu versión.

## Seguridad y preparación para producción

El proyecto incorpora PKCE, CSRF para operaciones web, cookies HTTP-only, límites de intentos persistidos en MongoDB, BCrypt, revocación de sesiones y autorizaciones, tokens de correo de un solo uso, CORS por origen aprobado, cabeceras del navegador y claves RSA persistentes. El perfil `prod` exige claves RSA externas, correo SMTP, URL pública HTTPS, cookies seguras y un secreto HMAC estable para los subjects pairwise.

Antes de publicar el servicio:

1. Usa una base MongoDB dedicada, con mínimo privilegio, copias de seguridad y restauraciones probadas.
2. Configura `SPRING_PROFILES_ACTIVE=prod`, `KARMANCOS_ISSUER`, `KARMANCOS_PUBLIC_BASE_URL` y `CADDY_SITE` con HTTPS real.
3. Carga las claves privada y pública RSA desde almacenamiento protegido. No las subas al repositorio ni las envíes en logs.
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
| Identidad y API | Java 21, Spring Boot, Spring Security Authorization Server |
| Persistencia | MongoDB y Spring Data MongoDB |
| Interfaz | Astro, Vue y componentes Balsa UI |
| Proxy y TLS | Caddy |
| Integración | OpenID Connect, OAuth 2.0 Authorization Code y PKCE |

## Licencia

No se ha definido una licencia en este repositorio todavía. Hasta que se añada una, no presupongas que el código puede redistribuirse o reutilizarse libremente.
