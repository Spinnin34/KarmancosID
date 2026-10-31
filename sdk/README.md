# @karmancosid/web

SDK browser para clientes OIDC públicos. Requiere HTTPS salvo localhost, registrar la URI de retorno exacta y aprobar el origen web en la consola de Karmancos ID.

```js
import { completePopup, createKarmancosID } from "@karmancosid/web";

// En la ruta de retorno registrada:
completePopup();

const identity = createKarmancosID({
  issuer: "https://id.karmancos.com",
  clientId: "kmc_...",
  redirectUri: "https://mi-sitio.com/auth/karmancos/callback",
  scopes: ["openid", "profile", "email"]
});
const session = await identity.signIn(); // Authorization Code + PKCE; el token vive en memoria.
```

La aplicación debe llamar a `completePopup()` desde el callback registrado. Si se elige `signIn({ mode: "redirect" })`, la ruta de retorno llama a `completeRedirect()` y conserva la transacción en `sessionStorage`. No se guardan tokens en almacenamiento persistente y el SDK no usa secretos de cliente.

El scope `email` devuelve el correo como dato de perfil. Karmancos ID no envía correo ni lo verifica automáticamente; trata `email_verified` como `false` salvo que el proveedor lo marque explícitamente como verificado.
