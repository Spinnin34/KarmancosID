# Seguridad

Karmancos ID gestiona credenciales y tokens de identidad. No uses el issue tracker público para describir vulnerabilidades sin corregir ni adjuntar datos sensibles.

## Reportar una vulnerabilidad

Usa la función **Private vulnerability reporting** de GitHub para este repositorio si está habilitada. Si no está disponible, contacta en privado a los mantenedores y comparte únicamente la información necesaria para reproducir el problema. No publiques secretos, tokens, datos de usuarios o instrucciones de explotación en una incidencia pública.

Incluye cuando sea posible:

- Una descripción breve y el impacto probable.
- Versiones, configuración y componentes afectados.
- Pasos de reproducción en un entorno de prueba sin datos reales.
- Una mitigación provisional, si existe.

Los mantenedores deben confirmar recepción por un canal privado, investigar y coordinar la publicación de la corrección. No se especifican tiempos de respuesta ni programa de recompensas hasta que el proyecto los defina formalmente.

## Alcance de las medidas actuales

El código incluye controles de OIDC/PKCE, CSRF web, límites de intentos, hash de contraseñas, revocación de sesiones, tokens de correo de un solo uso, CORS acotado y cabeceras de navegador. Estos controles reducen riesgos conocidos, pero no constituyen una auditoría ni una certificación de seguridad.

MFA con passkeys o TOTP aún no está implementada. El despliegue necesita TLS, claves externas protegidas, secretos administrados, MongoDB con privilegios mínimos, copias de seguridad, monitorización y pruebas de recuperación.

## Uso responsable

Prueba solo sistemas y cuentas para los que tengas autorización. Usa datos sintéticos y un entorno de staging aislado. No añadas información personal o secretos a logs, capturas, incidencias ni pull requests.
