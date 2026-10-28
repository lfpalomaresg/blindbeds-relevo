import { expect, test } from "@playwright/test";
import { MAILPIT, PNG_1PX, USERS, alertMessage, loginAs, pendingCard, requestMagicLink, sql, watch } from "./support";
import type { Page } from "@playwright/test";

async function loginAsWithoutDashboard(page: Page, email: string) {
  await page.goto(await requestMagicLink(page, email));
}

async function handoverCount(): Promise<number> {
  const [row] = await sql<{ n: string }>("select count(*) as n from public.shift_handovers");
  return Number(row.n);
}

test("sin sesión, /dashboard manda al login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("un enlace mágico usado dos veces da un error visible", async ({ page, browser }) => {
  const link = await loginAs(page, USERS.recepcion);
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto(link);
  await expect(page2).toHaveURL(/\/login/);
  await expect(alertMessage(page2), "el usuario ve por qué no ha entrado").toBeVisible();
  await other.close();
});

test("un correo que no está dado de alta no crea cuenta ni recibe enlace, y ve lo mismo que uno dado de alta", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  const email = "desconocido@example.com";
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Acceder" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu email" })).toBeVisible();
  await page.waitForTimeout(1500);
  const [users] = await sql<{ n: string }>("select count(*) as n from auth.users where email = $1", [email]);
  expect(Number(users.n), "cuentas creadas por pedir un enlace").toBe(0);
  const mail = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as {
    messages_count: number;
  };
  expect(mail.messages_count, "enlaces enviados a un correo no dado de alta").toBe(0);
  // The only error is GoTrue refusing the sign-up (422), which the page turns into the neutral screen.
  expect(w.httpErrors).toEqual(["422 POST http://127.0.0.1:54321/auth/v1/otp"]);
});

test("un usuario dado de alta pero sin hotel ve un mensaje claro (y no un panel roto)", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAsWithoutDashboard(page, "sin-hotel@example.com");
  await expect(page.getByText("No tienes una organización activa. Contacta con el operador.")).toBeVisible();
  await w.check();
});

test("doble clic en «Registrar relevo» crea un solo relevo", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.recepcion);
  await page.goto("/handover/new");
  await page.locator("#handover-block-avisos").fill("Doble clic: debe quedar uno");
  const before = await handoverCount();
  await page.getByRole("button", { name: "Registrar relevo" }).dblclick();
  await expect(page.getByRole("heading", { name: "Relevo registrado" })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await handoverCount()).toBe(before + 1);
  await w.check();
});

test("atrás tras registrar no duplica el relevo", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.recepcion);
  await page.goto("/handover/new");
  await page.locator("#handover-block-avisos").fill("Atrás: debe quedar uno");
  const before = await handoverCount();
  await page.getByRole("button", { name: "Registrar relevo" }).click();
  await expect(page.getByRole("heading", { name: "Relevo registrado" })).toBeVisible();
  await page.goBack();
  await page.goForward();
  await page.waitForTimeout(500);
  expect(await handoverCount()).toBe(before + 1);
  await w.check();
});

test("texto al límite con eñes y emojis se guarda y se lee entero", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.recepcion);
  await page.goto("/handover/new");
  const head = "Ñandú 🙂 en la 2ª planta — «comillas» & <b>no html</b> ";
  const text = (head + "texto normal de relevo ".repeat(100)).slice(0, 2000);
  await page.locator("#handover-block-incidencias").fill(text);
  await page.getByRole("button", { name: "Registrar relevo" }).click();
  await expect(page.getByRole("heading", { name: "Relevo registrado" })).toBeVisible();
  const [row] = await sql<{ content: string }>(
    "select content from public.handover_items where content like $1 order by created_at desc limit 1",
    ["Ñandú%"],
  );
  // Stored trimmed; 1 emoji = 2 UTF-16 units in the browser, 1 character in Postgres.
  expect(row.content).toBe(text.trim());
  await page.goto("/dashboard");
  await expect(pendingCard(page, "Ñandú 🙂")).toContainText("<b>no html</b>");
  await w.check();
});

test("una foto que no es imagen se rechaza con un mensaje", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.mantenimiento);
  await page.goto("/tickets/new");
  await page.locator("#ticket-title").fill("Foto falsa");
  await page.locator("#ticket-photo").setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await page.getByRole("button", { name: "Crear parte de avería" }).click();
  await expect(alertMessage(page)).toHaveText("Formato no admitido. Usa una foto JPEG, PNG o WebP.");
  await w.check();
});

test("un fichero de texto disfrazado de .jpg no acaba como foto rota", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.mantenimiento);
  await page.goto("/tickets/new");
  await page.locator("#ticket-title").fill("Foto disfrazada");
  await page.locator("#ticket-photo").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from("esto no es un jpeg") });
  await page.getByRole("button", { name: "Crear parte de avería" }).click();
  await expect(alertMessage(page)).toHaveText("Ese fichero no es una foto válida. Usa una foto JPEG, PNG o WebP.");
  await expect(page.getByRole("heading", { name: "Parte de avería creado" })).toHaveCount(0);
  await w.check();
});

test("doble clic en «Resolver» no muestra error", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.gobernanta);
  const card = pendingCard(page, "Faltan 12 juegos de toallas");
  await card.getByRole("button", { name: "Resolver" }).dblclick();
  await expect(card).toHaveCount(0);
  await expect(alertMessage(page)).toHaveCount(0);
  await w.check();
});

test("las etiquetas de estado y prioridad de los partes tienen color", async ({ page }) => {
  await loginAs(page, USERS.direccion);
  const card = page.getByRole("article", { name: "Ascensor parado en la planta 4" });
  const badge = card.getByText("Abierto", { exact: true });
  const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect.soft(bg, "fondo de la etiqueta «Abierto»").not.toBe("rgba(0, 0, 0, 0)");
  const prio = card.getByText("Crítica", { exact: true });
  const color = await prio.evaluate((el) => getComputedStyle(el).color);
  const grey = await card.getByText("·").evaluate((el) => getComputedStyle(el).color);
  expect.soft(color, "«Crítica» tiene su propio color").not.toBe(grey);
});

for (const width of [360, 412]) {
  test(`sin desbordamiento horizontal a ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const w = watch(page, testInfo);
    await page.goto("/login");
    const pages = ["/login"];
    await loginAs(page, USERS.direccion);
    pages.push("/dashboard", "/handover", "/handover/new", "/tickets/new", "/handover/c0000000-0000-4000-8000-000000000002");
    const overflow: string[] = [];
    for (const p of pages) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o > 0) overflow.push(`${p}: +${o}px`);
    }
    expect.soft(overflow, "páginas que se salen de ancho").toEqual([]);
    await w.check();
  });
}

test("la foto se puede subir también como mantenimiento recién entrado (sesión fresca)", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.mantenimiento);
  await page.goto("/tickets/new");
  await page.locator("#ticket-title").fill("Foto PNG sesión fresca");
  await page.locator("#ticket-photo").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG_1PX });
  await page.getByRole("button", { name: "Crear parte de avería" }).click();
  await expect(page.getByRole("heading", { name: "Parte de avería creado" })).toBeVisible();
  await w.check();
});

test("pedir el enlace dos veces seguidas da un mensaje en español", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.direccion);
  await page.getByRole("button", { name: "Acceder" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu email" })).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.direccion);
  await page.getByRole("button", { name: "Acceder" }).click();
  const sent = page.getByRole("heading", { name: "Revisa tu email" });
  const spanish = alertMessage(page).filter({ hasText: /^Ya te hemos enviado un enlace\. Espera/ });
  await expect(sent.or(spanish)).toBeVisible();
  await expect(page.getByText(/you can only request this after/i), "el aviso de espera sale en inglés, tal cual lo devuelve Supabase").toHaveCount(0);
});

// Last on purpose: it leaves a very long pending item on the dashboard.
test("una palabra larguísima (p. ej. una URL pegada) no rompe el ancho", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.recepcion);
  await page.goto("/handover/new");
  const url = "https://reservas.example.com/huesped?ref=" + "A1b2C3d4".repeat(40);
  await page.locator("#handover-block-avisos").fill(url);
  await page.getByRole("button", { name: "Registrar relevo" }).click();
  await expect(page.getByRole("heading", { name: "Relevo registrado" })).toBeVisible();
  await page.goto("/tickets/new");
  await page.locator("#ticket-title").fill("URL" + "x".repeat(110));
  await page.locator("#ticket-description").fill(url);
  await page.getByRole("button", { name: "Crear parte de avería" }).click();
  await expect(page.getByRole("heading", { name: "Parte de avería creado" })).toBeVisible();
  const [latest] = await sql<{ id: string }>("select id from public.shift_handovers order by created_at desc limit 1");
  const overflow: string[] = [];
  for (const p of ["/dashboard", "/handover/new", "/handover", `/handover/${latest.id}`]) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) overflow.push(`${p}: +${o}px`);
  }
  expect.soft(overflow, "páginas que se salen de ancho con una URL larga").toEqual([]);
  await w.check();
});

test("en modo oscuro del móvil los títulos se leen (contraste ≥ 4,5:1)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await loginAs(page, USERS.direccion);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const contrast = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const rgb = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const lum = ([r, g, b]: number[]) =>
      [r, g, b].map((c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
    const bg = lum(rgb(getComputedStyle(document.body).backgroundColor));
    const fg = lum(rgb(getComputedStyle(document.querySelector("h1")!).color));
    return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
  });
  expect.soft(contrast, "contraste del nombre del hotel sobre el fondo").toBeGreaterThanOrEqual(4.5);
});
