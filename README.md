# Karmancos ID

Karmancos ID es el proveedor de identidad de Karmancos. Las aplicaciones delegan el inicio de sesión mediante OAuth 2.0 y OpenID Connect; cada usuario conserva sus credenciales en Karmancos ID.

La aplicación y las funciones se ejecutan en Vercel. MongoDB es el único servicio externo de ejecución. El producto no envía correo: el correo se guarda como dato de cuenta y los tokens OIDC solo lo marcan como verificado si la cuenta tiene una verificación registrada.

## Funciones

- Registro e inicio de sesión con credenciales locales.
- OAuth 2.0 / OpenID Connect Authorization Code con PKCE S256.
- MFA TOTP obligatoria para administradores, con códigos de recuperación de un solo uso.
- Recuperación de cuenta asistida: un administrador con MFA verifica la identidad fuera de la aplicación y entrega un código temporal de un solo uso.
- Gestión de perfil, sesiones, consentimientos y clientes conectados.
- SDK de navegador en [`sdk/`](sdk/README.md).

Sin correo, las cuentas no tienen verificación automática ni recuperación por email. Una persona administradora nunca puede consultar ni establecer la contraseña de otra cuenta.

## Requisitos

- Node.js 22.12 o posterior y npm.
- MongoDB accesible desde el entorno local o Vercel.
- Claves RSA para tokens OIDC y claves aleatorias para HMAC y cifrado MFA.

## Desarrollo local

```powershell
Copy-Item web/.env.example web/.env
Set-Location web
npm ci
npm run dev
```

Completa `web/.env` con credenciales de una base aislada y claves de desarrollo. No uses secretos ni datos de producción. Consulta [despliegue](docs/DEPLOYMENT.md) para generar claves y preparar índices.

## Vista previa de diseño

Con el servidor local en marcha, abre `/preview` para recorrer las pantallas con datos ficticios. El catálogo incluye los flujos de acceso y MFA, la cuenta y todas las secciones de administración.

El modo se activa con `?preview=1` y se conserva en la pestaña. Los cambios se simulan en memoria y se descartan al recargar; la barra superior permite volver al catálogo o salir. `/preview` devuelve 404 en producción.

## Calidad

Desde `web/`:

```powershell
npm ci
npm run check
npm run lint
npm test
npm run build
```

GitHub Actions ejecuta estas comprobaciones para cada push y pull request. Los cambios de protocolo también deben comprobar el SDK (`node --test sdk/test/*.test.js`) y validar el proveedor en staging antes de publicar.

## Publicación

Configura Vercel con `web/` como directorio raíz y las variables descritas en [despliegue](docs/DEPLOYMENT.md). MongoDB permanece fuera de Vercel. La primera publicación requiere validación de migración, MFA, copias restaurables, alertas, límites de carga, rotación de claves y reversión. La automatización de CI no equivale a una certificación ni a una prueba de carga en producción.

Lee [arquitectura](docs/ARCHITECTURE.md), [seguridad](SECURITY.md) y [contribución](CONTRIBUTING.md) antes de realizar cambios en autenticación, autorización o tokens.
