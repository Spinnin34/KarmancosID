# Seguridad

Karmancos ID gestiona contraseñas, sesiones y tokens de identidad. No publiques vulnerabilidades, credenciales, tokens, datos personales ni instrucciones de explotación en una incidencia pública.

## Reportar vulnerabilidades

Usa **Private vulnerability reporting** de GitHub si está habilitado. Si no, contacta en privado a las personas mantenedoras con los datos mínimos para investigar. El proyecto no publica un SLA ni un programa de recompensas.

## Controles y límites

La implementación incluye PKCE S256, callback exacto, `state` y `nonce`, protección CSRF, cookies HTTP-only, límites de intentos persistidos, BCrypt con prehash SHA-256 versionado para contraseñas nuevas y migración de hashes antiguos al iniciar sesión, sesiones autenticadas y refresh tokens revocables sin caducidad por inactividad, TOTP obligatorio para administradores, códigos de recuperación de un solo uso, registro de auditoría, CORS acotado y cabeceras de seguridad.

El producto no tiene sistema de correo: no verifica automáticamente direcciones y no puede recuperar cuentas por email. La recuperación requiere verificación de identidad fuera de la aplicación y actuación de administración con MFA. El código no constituye una auditoría ni una certificación de seguridad.

Antes de producción, despliega con TLS, privilegios mínimos de MongoDB, secretos gestionados, clave MFA respaldada de forma segura, copias con restauración probada, alertas, rotación documentada y staging aislado. Valida el protocolo con la [suite de conformidad OpenID](https://openid.net/certification/about-conformance-suite/), revisa [RFC 9700](https://www.rfc-editor.org/info/rfc9700/) y usa [OWASP ASVS 5](https://asvs.owasp.org/) como guía.

Prueba solo sistemas y cuentas para los que tengas autorización. Utiliza datos sintéticos y nunca compartas secretos en logs, capturas, issues o pull requests.
