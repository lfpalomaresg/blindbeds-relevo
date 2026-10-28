import { expect, test } from "@playwright/test";
import { USERS, loginAs, watch } from "./support";

// Two synthetic hotels: nothing from one may show up in the other.
const MIRADOR_HANDOVER = "/handover/c0000000-0000-4000-8000-000000000001";
// Hotel names from supabase/seed.sql (fictional).
const COSTA = "Hotel Demo Costa";
const MIRADOR = "Hotel Demo Mirador";

test("Costa solo ve lo suyo en el panel y en la lista de relevos", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.costa);
  await expect(page.getByRole("heading", { name: COSTA })).toBeVisible();
  await expect(page.getByText("SOLO COSTA: piscina sin cloro")).toBeVisible();
  await expect(page.getByText("Ascensor parado en la planta 4")).toHaveCount(0);
  await expect(page.getByText(/Ruido en la planta 3/)).toHaveCount(0);
  await page.goto("/handover");
  await expect(page.getByRole("article")).toHaveCount(1);
  await w.check();
});

test("Costa no abre un relevo del Mirador por URL directa", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.costa);
  await page.goto(MIRADOR_HANDOVER);
  await expect(page.getByRole("link", { name: /Volver a los relevos/ })).toBeVisible();
  await expect(page.getByText(/Ruido en la planta 3/)).toHaveCount(0);
  await w.check();
});

test("El Mirador no ve nada de Costa", async ({ page }, testInfo) => {
  const w = watch(page, testInfo);
  await loginAs(page, USERS.direccion);
  await expect(page.getByRole("heading", { name: MIRADOR })).toBeVisible();
  await expect(page.getByText(/SOLO COSTA/)).toHaveCount(0);
  await page.getByRole("group", { name: "Filtrar por estado" }).getByRole("button", { name: "Todas" }).click();
  await expect(page.getByText(/SOLO COSTA/)).toHaveCount(0);
  await w.check();
});
