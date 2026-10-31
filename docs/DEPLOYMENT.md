# Despliegue y configuración

## Entornos

Mantén entornos separados. No apuntes pruebas locales o CI a la base de producción ni reutilices claves de desarrollo en producción.

| Entorno | Perfil | Recomendación |
| --- | --- | --- |
| Local | `local` | MongoDB aislado; claves de firma locales persistidas en el volumen `identity_data`. |
| Staging | `prod` | Dominio HTTPS de pruebas, base y claves dedicadas, SMTP de prueba y cuentas sintéticas. |
| Producción | `prod` | Base, claves, SMTP, alertas y copias de seguridad administradas. |

## Docker Compose

1. Copia `.env.example` a `.env` si no existe y usa una base MongoDB de desarrollo.
2. Define un administrador inicial con una contraseña de al menos 16 caracteres.
3. Ejecuta `docker compose up --build`.
4. Revisa `docker compose ps` y consulta `/api/health`.

Compose construye el backend y la web, pero MongoDB debe estar disponible externamente. El usuario de base de datos necesita permisos mínimos de lectura, inserción, actualización y borrado en las colecciones de Karmancos ID. Si se usa `MONGODB_CREATE_INDEXES=true`, también debe poder crear los índices.

Para parar los contenedores: `docker compose down`. No añadas `-v` salvo que quieras eliminar los volúmenes persistentes del servicio.

## Variables de entorno

| Variable | Uso | Obligatoria |
| --- | --- | --- |
| `MONGODB_URI` | URI privada de la base MongoDB | Sí |
| `MONGODB_DATABASE` | Base asignada a Karmancos ID | Sí, puede usar `karmancosid` |
| `MONGODB_CREATE_INDEXES` | Creación de índices de Spring Data | Recomendado en instalación inicial |
| `KARMANCOS_BOOTSTRAP_ADMIN_EMAIL` | Correo del administrador inicial | Junto con contraseña, solo para bootstrap |
| `KARMANCOS_BOOTSTRAP_ADMIN_PASSWORD` | Contraseña inicial de al menos 16 caracteres | Junto con correo, solo para bootstrap |
| `KARMANCOS_ISSUER` | Emisor OIDC público; debe coincidir exactamente con discovery | Sí en producción |
| `KARMANCOS_PUBLIC_BASE_URL` | Origen HTTPS usado en enlaces de correo | Sí en producción |
| `CADDY_SITE` | Dominio del sitio y TLS de Caddy | Sí en producción |
| `KARMANCOS_SECURE_COOKIES` | Cookies `Secure`; activa `true` tras HTTPS | Sí en producción |
| `KARMANCOS_PRIVATE_KEY_PATH` | Ruta dentro del contenedor a la clave RSA privada PKCS#8 | Sí en perfil `prod` |
| `KARMANCOS_PUBLIC_KEY_PATH` | Ruta dentro del contenedor a la clave RSA pública X.509 | Sí en perfil `prod` |
| `KARMANCOS_SUBJECT_HMAC_SECRET` | Clave estable para subjects pairwise; mínimo 32 caracteres | Sí en producción |
| `SPRING_MAIL_HOST` | Host SMTP para correo de verificación y recuperación | Sí en producción |
| `SPRING_MAIL_PORT` | Puerto SMTP, normalmente 587 con STARTTLS | Sí con SMTP |
| `SPRING_MAIL_USERNAME` / `SPRING_MAIL_PASSWORD` | Credenciales SMTP | Según el proveedor SMTP |
| `KARMANCOS_MAIL_FROM` | Remitente permitido por el proveedor SMTP | Sí con SMTP |
| `KARMANCOS_SESSION_COOKIE_NAME` | Nombre de la cookie de sesión | Opcional |

La plantilla `.env.example` es solo para desarrollo local. En producción, elige `SPRING_PROFILES_ACTIVE=prod`, fija valores HTTPS, `KARMANCOS_SECURE_COOKIES=true` y monta las claves privadas como secretos de solo lectura en las rutas configuradas. El archivo Compose base no define una infraestructura de gestión de secretos; usa el mecanismo de secretos de tu plataforma o un override protegido.

Genera el HMAC en un entorno confiable, por ejemplo con `openssl rand -base64 48`. Almacénalo en un gestor de secretos y conserva la misma clave en todas las réplicas. No la imprimas ni la subas a GitHub. La rotación cambia el `sub` calculado; planifica una migración para evitar que los clientes creen identidades duplicadas.

Las claves RSA de firma deben coincidir entre sí y permanecer estables mientras haya tokens o sesiones que deban validarse. Usa un proceso de rotación con solapamiento de claves JWKS; reemplazarlas directamente puede invalidar tokens emitidos previamente.

## SMTP y enlaces de cuenta

La verificación de correo y la recuperación usan enlaces con tokens de un solo uso. Configura correctamente el dominio público; la aplicación genera enlaces desde `KARMANCOS_PUBLIC_BASE_URL`, no desde la cabecera HTTP `Host`. Prueba la entrega, el enlace, expiración, segundo uso y cambio de correo en staging antes de producción.

## Comprobaciones de lanzamiento

- Discovery responde y el `issuer` publicado coincide exactamente con `KARMANCOS_ISSUER`.
- `/api/health` indica estado `ok` y permisos MongoDB suficientes.
- El JWKS expone la clave pública correspondiente a la clave privada de firma.
- Un cliente de pruebas completa Authorization Code con PKCE S256 y URI exacta.
- CORS del endpoint de token funciona desde el origen aprobado y falla desde un origen no aprobado.
- Cookies de sesión llevan `Secure`, `HttpOnly` y `SameSite=Lax` bajo HTTPS.
- SMTP entrega enlaces; los tokens caducados o usados no pueden repetirse.
- Las copias MongoDB se pueden restaurar y se conservan las claves HMAC y RSA.
- Logs y métricas no contienen contraseñas, códigos, tokens, cookies ni secretos.

## Diagnóstico local

Inicia backend y web en procesos separados, configura `MONGODB_URI` para una base de pruebas y, si la API no está en `localhost:8080`, define `IDENTITY_API_TARGET` antes de arrancar Astro. La página puede cargar sin backend; para probar autenticación, la API, MongoDB, el emisor y la web deben compartir una configuración coherente.
