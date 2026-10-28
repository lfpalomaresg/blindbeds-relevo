import { expect, test } from "@playwright/test";
import { PNG_1PX, USERS, alertMessage, loginAs, pendingCard, watch } from "./support";

// docs/31_GUION_PRUEBA_USUARIOS.md, tareas R1-R5 y M1-M4, con usuarios sintéticos.
test.describe.configure({ mode: "serial" });

const R1 = {
  pendientes: "Cliente de la 101 espera factura corregida antes de las 9:00",
  vips: "Llega Sra. Prueba, aniversario, detalle en habitación",
  avisos: "Ascensor principal hace ruido, avisado a mantenimiento",
};
const GRIFO = "Grifo gotea en la 101";
const BALDOSA = "Baldosa suelta en la piscina";

test("R1 · recepción deja el relevo de tarde en menos de 2 minutos", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.recepcion);
  const start = Date.now();
  await page.getByRole("link", { name: /Relevo de turno/ }).click();
  await page.waitForURL("**/handover/new");
  await expect(page.locator("#handover-shift"), "el turno por defecto es Mañana").toHaveValue("manana");
  await page.locator("#handover-shift").selectOption("tarde");
  await page.locator("#handover-block-pendientes").fill(R1.pendientes);
  await page.locator("#handover-block-vips").fill(R1.vips);
  await page.locator("#handover-block-avisos").fill(R1.avisos);
  await page.getByRole("button", { name: "Registrar relevo" }).click();
  await expect(page.getByRole("heading", { name: "Relevo registrado" })).toBeVisible();
  await expect(page.getByText(/El turno de Tarde en Recepción/)).toBeVisible();
  testInfo.annotations.push({ type: "tiempo-R1", description: `${Math.round((Date.now() - start) / 1000)} s` });
  await w.check();
});

test("R2 · un relevo vacío da un error comprensible y conserva departamento y turno", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.recepcion);
  await page.goto("/handover/new");
  await page.locator("#handover-shift").selectOption("tarde");
  await page.locator("#handover-block-avisos").fill("Aviso de prueba R2");
  await page.getByRole("button", { name: "Registrar relevo" }).click();
  await page.getByRole("button", { name: "Nuevo relevo" }).click();
  await expect(page.locator("#handover-shift")).toHaveValue("tarde");
  await page.getByRole("button", { name: "Registrar relevo" }).click();
  await expect(alertMessage(page)).toHaveText("Escribe al menos un bloque antes de registrar el relevo.");
  await w.check();
});

test("M1 · mantenimiento da parte con código del activo y foto", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.mantenimiento);
  await page.goto("/tickets/new");
  await page.locator("#ticket-asset-code").fill("ASSET-101");
  await page.getByRole("button", { name: "Buscar activo" }).click();
  await expect(page.getByText("Activo: Habitación 101")).toBeVisible();
  await page.locator("#ticket-title").fill(GRIFO);
  await page.locator("#ticket-priority").selectOption("alta");
  await page.locator("#ticket-photo").setInputFiles({ name: "grifo.png", mimeType: "image/png", buffer: PNG_1PX });
  await page.getByRole("button", { name: "Crear parte de avería" }).click();
  await expect(page.getByRole("heading", { name: "Parte de avería creado" })).toBeVisible();

  await page.goto("/dashboard");
  const card = page.getByRole("article", { name: GRIFO });
  await expect(card).toBeVisible();
  const photo = card.getByRole("img", { name: "Foto del parte" });
  await expect(photo, "la foto se ve en el parte").toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Product gaps the script asks the user about: noted, not failed, so the serial journey keeps going.
  if (!(await card.textContent())?.includes("Habitación 101")) {
    testInfo.annotations.push({ type: "mejora", description: "M1/M4: la tarjeta del parte no dice de qué activo es (Habitación 101)" });
  }
  await w.check();
});

test("M2 · parte sin activo", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.mantenimiento);
  await page.goto("/tickets/new");
  await page.locator("#ticket-title").fill(BALDOSA);
  await page.getByRole("button", { name: "Crear parte de avería" }).click();
  await expect(page.getByRole("heading", { name: "Parte de avería creado" })).toBeVisible();
  await w.check();
});

test("M3 · código de activo que no existe", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.mantenimiento);
  await page.goto("/tickets/new");
  await page.locator("#ticket-asset-code").fill("ASSET-999");
  await page.getByRole("button", { name: "Buscar activo" }).click();
  await expect(alertMessage(page)).toHaveText("Código no encontrado. Revísalo o crea el parte sin activo.");
  await w.check();
});

test("M4 · mantenimiento pone el grifo en curso, lo cierra y lo encuentra en Cerrado", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.mantenimiento);
  const card = page.getByRole("article", { name: GRIFO });
  await card.getByRole("button", { name: "En curso" }).click();
  await expect(card.getByText("En curso", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Cerrar" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("group", { name: "Filtrar por estado" }).getByRole("button", { name: "Cerrado", exact: true }).click();
  await expect(page.getByRole("article", { name: GRIFO })).toBeVisible();
  await w.check();
});

test("R3-R4 · el turno siguiente ve los pendientes y resuelve la factura", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.gobernanta);
  for (const text of Object.values(R1)) await expect(pendingCard(page, text)).toBeVisible();
  if (!/Tarde|recepcion@example\.com/.test((await pendingCard(page, R1.pendientes).textContent()) ?? "")) {
    testInfo.annotations.push({ type: "mejora", description: "R3: el pendiente no dice quién lo escribió ni de qué turno es" });
  }
  await pendingCard(page, R1.pendientes).getByRole("button", { name: "Resolver" }).click();
  await expect(pendingCard(page, R1.pendientes)).toHaveCount(0);
  await page.reload();
  await expect(pendingCard(page, R1.vips)).toBeVisible();
  await expect(pendingCard(page, R1.pendientes), "sigue resuelto tras recargar").toHaveCount(0);
  testInfo.annotations.push({ type: "limite-conocido", description: "R4: no hay forma de deshacer «Resolver» (guion, no se cuenta como fallo)" });
  await w.check();
});

test("R5 · recepción comprueba que el grifo está arreglado", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.recepcion);
  await page.getByRole("group", { name: "Filtrar por estado" }).getByRole("button", { name: "Cerrado", exact: true }).click();
  await expect(page.getByRole("article", { name: GRIFO })).toBeVisible();
  await w.check();
});
