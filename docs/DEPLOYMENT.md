# Despliegue en Vercel

## Arquitectura y configuración

`web/` es la única aplicación desplegable. Astro y sus funciones Node.js alojan las páginas y las rutas de identidad. MongoDB es un servicio gestionado externo; no se ejecutan servidores, contenedores ni procesos auxiliares del proyecto.

1. Importa el repositorio en Vercel y configura **Root Directory** como `web`.
2. Usa el preset Astro, Node.js 22.12 o posterior, `npm ci` para instalar y `npm run build` para construir.
3. Define las variables obligatorias para Preview y Production, manteniendo bases y secretos separados.
4. Alinea la región de las funciones con la región de MongoDB y mide la latencia desde las funciones desplegadas.
5. Inicializa los índices de la base y verifica `/api/health`, `/.well-known/openid-configuration` y `/oauth2/jwks` en un despliegue Preview.

La guía de [regiones de funciones de Vercel](https://vercel.com/docs/functions/configuring-functions/region) explica cómo configurar la proximidad regional. Ajusta los pools siguiendo las [opciones de conexión del driver de MongoDB](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/).

## Variables de entorno

### Obligatorias

| Variable | Uso |
| --- | --- |
| `MONGODB_URI` | URI privada de MongoDB con privilegios mínimos sobre las colecciones de Karmancos ID. |
| `KARMANCOS_SUBJECT_HMAC_SECRET` | Secreto aleatorio estable de al menos 32 caracteres. Cambiarlo modifica los `sub` pairwise. |
| `KARMANCOS_PRIVATE_KEY_PEM_B64` | Clave privada RSA PKCS#8 codificada en Base64 para firmar tokens. |
| `KARMANCOS_PUBLIC_KEY_PEM_B64` | Clave pública RSA X.509 correspondiente, codificada en Base64. |
| `PUBLIC_IDENTITY_ISSUER` | Origen HTTPS público; Astro lo usa al generar el documento OIDC. |
| `KARMANCOS_MFA_ENCRYPTION_KEY_B64` | Clave aleatoria de 32 bytes codificada en Base64 para cifrar secretos TOTP de administradores. |

### Opcionales

| Variable | Uso |
| --- | --- |
| `KARMANCOS_ISSUER` | Emisor OIDC de ejecución; usa el mismo origen que `PUBLIC_IDENTITY_ISSUER`. |
| `MONGODB_DATABASE` | Nombre de base. Si falta, se obtiene de la URI o se usa `karmancosid`. |
| `KARMANCOS_SECURE_COOKIES` | Mantén `true` en Vercel. Solo se desactiva para desarrollo local HTTP. |
| `KARMANCOS_SESSION_COOKIE_NAME` | Nombre de cookie de sesión; por defecto `KARMANCOSID`. |
| `KARMANCOS_BOOTSTRAP_ADMIN_EMAIL` | Correo de la cuenta inicial administradora, solo para el bootstrap. |
| `KARMANCOS_BOOTSTRAP_ADMIN_PASSWORD` | Contraseña temporal de al menos 16 caracteres. Elimina ambas variables al crear la cuenta. |

No existe configuración de SMTP, envío de correo ni verificación por email. No añadas `.env`, claves PEM, contraseñas ni URI privadas al repositorio.

## Generar secretos

En PowerShell, genera una clave RSA y convierte cada PEM a Base64 en tu equipo. Mantén la salida en un gestor seguro y cópiala directamente a Vercel; no la incluyas en incidencias ni logs.

```powershell
$rsa = [System.Security.Cryptography.RSA]::Create(3072)
$privatePem = $rsa.ExportPkcs8PrivateKeyPem()
$publicPem = $rsa.ExportSubjectPublicKeyInfoPem()
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($privatePem))
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($publicPem))
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Los tres resultados corresponden a las dos variables de clave RSA y a `KARMANCOS_MFA_ENCRYPTION_KEY_B64`. Genera `KARMANCOS_SUBJECT_HMAC_SECRET` con un generador aleatorio de al menos 32 caracteres. Conserva las claves y HMAC establemente; programa y documenta su rotación.

## Índices de MongoDB

Los índices se crean fuera de las solicitudes para que las funciones serverless no tengan que inicializarlos en cada arranque.

```powershell
Set-Location web
npm ci
$env:MONGODB_URI = "<URI de la base de destino>"
$env:MONGODB_DATABASE = "<base de destino>"
npm run db:indexes
```

Ejecuta el comando con un usuario de base que pueda gestionar índices y asegúrate de que la base corresponde al entorno correcto. El script es idempotente. Antes de aplicarlo a una base existente, revisa que no haya duplicados que impidan los índices únicos.

## Datos y transición desde Java

Antes del primer despliegue, crea una copia de seguridad y ensaya la restauración. En una base clonada, compara el esquema y los registros de usuarios y clientes con la API Node, verifica los `issuer`, claves y `sub`, y prueba Authorization Code con PKCE S256. Mantén estables el emisor, las claves de firma y el secreto HMAC para no romper la identidad de usuarios en clientes existentes. Las sesiones y tokens emitidos por la implementación anterior pueden requerir que se inicie sesión de nuevo.

No publiques hasta comprobar en staging que usuarios, clientes, callbacks, consentimiento y autorizaciones son compatibles con los datos que realmente existen.

## Comprobaciones previas a publicación

- Verifica estado de base, descubrimiento OIDC y JWKS en Preview.
- Completa registro, inicio/cierre de sesión, administración con TOTP y códigos de recuperación, recuperación asistida, consentimiento y revocación de sesiones.
- Usa un cliente público de prueba para completar Authorization Code con PKCE S256 y compara callbacks exactamente.
- Ejecuta las pruebas Basic y Configuration de la [suite de conformidad OpenID](https://openid.net/certification/about-conformance-suite/) y revisa los controles de [RFC 9700](https://www.rfc-editor.org/info/rfc9700/) y [OWASP ASVS 5](https://asvs.owasp.org/).
- En staging, reproduce la carga estimada de los primeros 90 días con margen 2×; revisa errores, latencia, duración y conexiones MongoDB.
- Confirma restauración de copias, alertas operativas, rotación de claves y reversión a la versión previa.

Estas comprobaciones requieren infraestructura y cuentas de staging. Los workflows de CI no las simulan ni certifican el despliegue.
