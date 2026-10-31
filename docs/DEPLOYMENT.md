# Despliegue y configuración

## Arquitectura en Vercel

La web Astro y la API de identidad viven en `web/`. El adaptador oficial de Astro convierte las rutas de autenticación y OpenID Connect en funciones Node.js de Vercel. Las páginas públicas se prerenderizan como archivos estáticos; las rutas `/api/*`, `/oauth2/*`, `/userinfo` y `/connect/logout` se ejecutan bajo demanda en Vercel.

Vercel ejecuta la aplicación y su lógica de backend, pero MongoDB y el servidor SMTP siguen siendo servicios externos. La carpeta `backend/` contiene el backend Java anterior y no se incluye en este despliegue.

## Configurar el proyecto

1. Importa `Spinnin34/KarmancosID` desde GitHub en Vercel.
2. En **Settings → Build and Deployment**, selecciona **Root Directory: `web`**. Este paso elimina la detección ambigua de Astro y Container que aparecía cuando se intentaba construir el repositorio completo.
3. Usa el preset **Astro**, Node.js **22.x** o superior, el comando de instalación `npm install` y el comando de build `npm run build`. Vercel suele detectarlos automáticamente desde `web/package.json`.
4. Añade las variables de entorno de las secciones siguientes para Production y Preview según corresponda.
5. Despliega la rama `main` y revisa `/api/health` y `/.well-known/openid-configuration`.

No configures un servicio Container, Dockerfile ni `PORT` para la web de Vercel. `vercel.json` ya no define servicios separados.

## Variables de entorno

### Necesarias

| Variable | Valor |
| --- | --- |
| `MONGODB_URI` | URI de conexión privada a la base de datos MongoDB. El usuario necesita acceso de lectura y escritura a las colecciones de Karmancos ID. |
| `KARMANCOS_SUBJECT_HMAC_SECRET` | Secreto aleatorio y estable de al menos 32 caracteres para crear los `sub` pairwise. No lo cambies sin planear una migración. |
| `KARMANCOS_PRIVATE_KEY_PEM_B64` | PEM RSA privado PKCS#8 codificado en Base64, en una sola línea. |
| `KARMANCOS_PUBLIC_KEY_PEM_B64` | PEM RSA público X.509 codificado en Base64, en una sola línea. Debe corresponder a la clave privada. |
| `PUBLIC_IDENTITY_ISSUER` | Origen público HTTPS, por ejemplo `https://karmancosid.vercel.app`. Se usa para generar el documento OIDC durante el build. |

### Recomendadas u opcionales

| Variable | Uso |
| --- | --- |
| `KARMANCOS_ISSUER` | Emisor OIDC en ejecución. Puede omitirse si `PUBLIC_IDENTITY_ISSUER` está configurada con el mismo origen. |
| `KARMANCOS_PUBLIC_BASE_URL` | Origen de los enlaces de verificación y recuperación. Puede omitirse si coincide con el emisor. |
| `MONGODB_DATABASE` | Nombre de la base de datos; si se omite, se toma de `MONGODB_URI` o se usa `karmancosid`. |
| `KARMANCOS_SECURE_COOKIES` | Déjala en `true` en Vercel; es el valor predeterminado bajo HTTPS. |
| `KARMANCOS_SESSION_COOKIE_NAME` | Nombre de la cookie de sesión. El predeterminado es `KARMANCOSID`. |
| `MONGODB_CREATE_INDEXES` | Ponla en `true` para crear los índices de la nueva API en MongoDB. Tras el primer despliegue correcto, puedes dejarla en `false`; los índices ya creados se conservan. |
| `KARMANCOS_BOOTSTRAP_ADMIN_EMAIL` | Cuenta para crear el primer administrador solo si aún no existe. Después de crearlo, elimina las dos variables de bootstrap. |
| `KARMANCOS_BOOTSTRAP_ADMIN_PASSWORD` | Contraseña temporal de bootstrap, con al menos 16 caracteres. Guárdala como secreto de Vercel y elimínala tras crear el administrador. |

La API reutiliza los nombres `SPRING_MAIL_*` para mantener compatibilidad con la configuración anterior:

| Variable | Uso |
| --- | --- |
| `SPRING_MAIL_HOST` | Host SMTP. Necesario para entregar los correos de verificación y recuperación. |
| `SPRING_MAIL_PORT` | Puerto SMTP; normalmente `587` con STARTTLS o `465` con TLS. |
| `SPRING_MAIL_USERNAME` | Usuario SMTP, si el proveedor requiere autenticación. |
| `SPRING_MAIL_PASSWORD` | Contraseña SMTP, si el proveedor requiere autenticación. |
| `KARMANCOS_MAIL_FROM` | Dirección remitente autorizada por el proveedor SMTP. |

No añadas comillas alrededor de los valores en el panel de Vercel. No subas `.env`, contraseñas, URI privadas ni PEM al repositorio.

## Claves RSA en PowerShell

Genera las claves con el método del proyecto y guarda cada PEM en un lugar seguro. Para convertir las claves existentes a las variables de Vercel sin imprimirlas en el chat:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('backend/data/keys/oidc-private.pem'))
[Convert]::ToBase64String([IO.File]::ReadAllBytes('backend/data/keys/oidc-public.pem'))
```

Copia cada resultado directamente en la variable correspondiente de Vercel. La clave privada debe permanecer secreta.

## Base de datos y sesiones

La API conserva las colecciones de usuarios, clientes, consentimientos, acciones de cuenta, auditoría y solicitudes de aplicaciones. Los usuarios y los clientes registrados pueden seguir utilizándose con sus credenciales existentes. La API nueva almacena las sesiones en `identity_sessions`; tras el cambio, todos tendrán que iniciar sesión una vez más. Las autorizaciones nuevas se guardan en MongoDB y los tokens antiguos del backend Java no se renuevan con la API nueva.

Si `MONGODB_CREATE_INDEXES=true`, la API crea índices únicos para correo, nombre de usuario y clientes, además de índices TTL para sesiones, autorizaciones, límites de intentos y tokens de cuenta. En una base existente, habilítala durante el despliegue inicial y comprueba los logs de Vercel. Si MongoDB no permite crear índices, pide al administrador de la base que los cree y deja la variable en `false`.

Usa una base separada para Preview. No apuntes los despliegues de prueba a los datos reales.

## Comprobaciones después del despliegue

- `/api/health` debe devolver `status: ok` y `database: reachable`.
- `/.well-known/openid-configuration` debe publicar exactamente el mismo emisor que `KARMANCOS_ISSUER` o `PUBLIC_IDENTITY_ISSUER`.
- `/oauth2/jwks` debe exponer una clave pública válida que corresponda a la privada.
- Registro, inicio de sesión, cierre de sesión, consentimiento y acceso a cuenta deben responder usando el mismo origen de Vercel.
- Un cliente de pruebas debe completar Authorization Code con PKCE S256 y una URI de retorno registrada exactamente.
- SMTP debe entregar los enlaces de verificación y recuperación.

Si `/api/auth/csrf` devuelve `500`, abre los logs del último deployment en Vercel. Confirma que el Root Directory sea `web`, que `MONGODB_URI` y `MONGODB_DATABASE` apunten a la base correcta y que MongoDB permita conectarse, buscar usuarios y crear sesiones en `identity_sessions`. La falta de claves RSA afecta a JWKS y tokens, pero no a la ruta CSRF.

## Desarrollo local de la versión Vercel

Desde PowerShell:

```powershell
Copy-Item web/.env.example web/.env
cd web
npm ci
npm run dev
```

La API se ejecuta en el propio servidor de Astro. Usa MongoDB y claves separadas de producción, `PUBLIC_IDENTITY_ISSUER=http://localhost:4321`, `KARMANCOS_ISSUER=http://localhost:4321` y `KARMANCOS_SECURE_COOKIES=false`. Solo si quieres reenviar las peticiones a un backend distinto, define `IDENTITY_API_TARGET`.

## Recursos de producción

MongoDB y SMTP no se ejecutan dentro de Vercel. Elige un proveedor con disponibilidad, copias de seguridad, rotación de credenciales y capacidad adecuados para el uso esperado. Configura la región de las funciones de Vercel cerca de MongoDB para reducir latencia y vigila los límites de concurrencia y duración de las funciones.
