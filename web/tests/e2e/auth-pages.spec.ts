import { expect, test } from "@playwright/test";

test("login offers account creation and assisted recovery", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Vuelve a entrar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute("href", "/registro");
  await expect(page.getByRole("link", { name: "¿Tienes un código de recuperación?" })).toHaveAttribute("href", "/recuperar-cuenta");
});

test("registration explains the email is account data and is not verified", async ({ page }) => {
  await page.goto("/registro");
  await expect(page.getByRole("heading", { name: "Empieza aquí" })).toBeVisible();
  await expect(page.getByText("El correo se guarda como dato de cuenta. No se verifica ni se usa para recuperar acceso.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear cuenta" })).toBeVisible();
});

test("assisted recovery requests a temporary administrator code", async ({ page }) => {
  await page.goto("/recuperar-cuenta");
  await expect(page.getByRole("heading", { name: "Recupera el acceso" })).toBeVisible();
  await expect(page.getByLabel("Código de recuperación")).toBeVisible();
  await expect(page.getByText("El código es temporal, de un solo uso y no se envía por correo.")).toBeVisible();
});

test("administrator MFA setup presents one-time recovery codes after TOTP confirmation", async ({ page }) => {
  await page.route("**/api/auth/csrf", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Set-Cookie": "XSRF-TOKEN=e2e-token; Path=/; SameSite=Lax" },
    body: JSON.stringify({ token: "e2e-token" }),
  }));
  await page.route("**/api/auth/mfa/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Karmancos%20ID:admin" }),
  }));
  await page.route("**/api/auth/mfa/setup/verify", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ recoveryCodes: ["A1B2-C3D4-E5F6-7890"], next: "/admin" }),
  }));

  await page.goto("/configurar-2fa");
  await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  const otpInput = page.getByLabel("Código de seis cifras");
  await otpInput.fill("123456");
  await page.getByRole("button", { name: "Activar verificación en dos pasos" }).click();
  await expect(page.getByRole("heading", { name: "Guarda estos códigos" })).toBeVisible();
  await expect(page.getByText("A1B2-C3D4-E5F6-7890")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();
});

test("developer information continues to expose the OAuth/OIDC integration flow", async ({ page }) => {
  await page.goto("/desarrolladores");
  await expect(page.getByRole("heading", { name: "Una identidad segura para tu producto." })).toBeVisible();
  await expect(page.getByText("Authorization Code con PKCE `S256`")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Solicitar acceso" })).toBeVisible();
});

test("OIDC discovery stays available on the app origin and advertises S256", async ({ request }) => {
  const response = await request.get("/.well-known/openid-configuration");
  expect(response.ok()).toBeTruthy();
  const discovery = await response.json();
  expect(discovery.issuer).toMatch(/^https?:\/\/localhost:\d+$/);
  expect(discovery.authorization_endpoint).toBe(`${discovery.issuer}/oauth2/authorize`);
  expect(discovery.code_challenge_methods_supported).toContain("S256");
});
