# Contribuir

Gracias por ayudar a mejorar Karmancos ID. Los cambios de autenticación y autorización requieren especial cuidado porque afectan la seguridad de todas las aplicaciones conectadas.

## Antes de empezar

- Abre una incidencia para cambios grandes o incompatibles y explica el problema, el impacto y la solución propuesta.
- No publiques detalles explotables de vulnerabilidades; sigue el proceso privado de [`SECURITY.md`](SECURITY.md).
- Comprueba si la modificación afecta el protocolo OIDC, tokens existentes, configuración, privacidad o SDK.

## Preparar el entorno

- Java 21 y Maven para `backend/`.
- Node.js 22.12+ y npm para `web/`.
- Una instancia MongoDB de desarrollo. Nunca uses credenciales o datos reales.

## Flujo de trabajo

1. Crea una rama desde la versión base actual.
2. Mantén el cambio acotado y añade documentación para las opciones de configuración y los flujos nuevos.
3. Añade o actualiza pruebas cuando cambie lógica de negocio o seguridad.
4. Ejecuta las comprobaciones relevantes:

   ```bash
   # En backend/
   mvn test

   # En web/
   npm ci
   npm run build

   # En la raíz
   node --check sdk/index.js
   ```

5. Resume el comportamiento, los cambios de configuración y las comprobaciones en tu pull request.

## Reglas de seguridad

- No confirmes `.env`, credenciales, claves privadas, tokens reales, sesiones ni datos personales.
- No uses correo como identificador OIDC `sub` ni relajes la comparación exacta de callbacks.
- Mantén PKCE S256 y prueba estados inválidos, expiración, repetición de tokens y orígenes no autorizados.
- Evita escribir credenciales, códigos OAuth, tokens, cookies o secretos en logs, errores y capturas.
- Los clientes web y móviles son públicos: no añadas un secreto embebido en código distribuido al usuario.

## Estilo

Respeta la estructura y componentes existentes. La interfaz usa componentes Balsa UI y convenciones de Astro/Vue. Conserva accesibilidad, estados de error claros y traducciones consistentes. Los comentarios y nombres de código siguen el estilo ya presente en el módulo correspondiente.
