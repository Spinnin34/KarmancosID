# Contribuir

Los cambios de autenticación, autorización y persistencia afectan a todas las aplicaciones conectadas; incluye pruebas y documentación al modificar esos contratos.

## Preparar el entorno

- Node.js 22.12 o posterior y npm para la aplicación Astro/Vercel en `web/`.
- MongoDB aislado para el desarrollo local. Nunca uses datos reales.
- Claves de desarrollo para firma OIDC, HMAC y cifrado TOTP.

No hay infraestructura Java ni un sistema de correo. El SDK mantiene compatibilidad en sus exportaciones y flujos OIDC.

## Flujo de trabajo

1. Para cambios grandes o incompatibles, explica el problema y el impacto esperado.
2. Divide las responsabilidades entre rutas, persistencia, validación y contratos.
3. Añade o actualiza pruebas para lógica de negocio, seguridad y comportamiento de navegador.
4. Ejecuta desde `web/`:

   ```bash
   npm ci
   npm run check
   npm run lint
   npm test
   npm run build
   ```

   Para cambios en el SDK ejecuta también `node --test sdk/test/*.test.js` desde la raíz.
5. Resume cambios, configuración y resultados en el pull request.

## Seguridad

- No confirmes `.env`, credenciales, claves privadas, tokens reales, sesiones ni datos personales.
- Mantén PKCE S256, validación de `state` y comparación exacta de callbacks.
- No marques correos como verificados sin comprobarlos.
- No añadas envío ni recuperación de contraseña por email. La recuperación asistida requiere MFA, caducidad, consumo único y auditoría.
- No permitas que administración consulte o establezca contraseñas.
- Evita escribir contraseñas, códigos OAuth, códigos de recuperación, cookies y secretos en logs.
- Trata las aplicaciones web y móviles como clientes públicos: nunca embebas en ellas un secreto confidencial.
