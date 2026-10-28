import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseEnv } from "./local-guard";
import { USERS } from "./support";

// The recommended Magic Link template (docs/20_ACTIVACION_SUPABASE.md §1, step 5)
// links to /auth/confirm?token_hash=…&type=email. Unlike the default PKCE link it
// must work in a browser that never asked for it (another browser, another phone).
// Hotel name from supabase/seed.sql (fictional).
const MIRADOR = "Hotel Demo Mirador";
const dotenvPath = path.join(__dirname, "..", ".env.local");
const env = localSupabaseEnv(process.env, existsSync(dotenvPath) ? readFileSync(dotenvPath, "utf8") : "");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function tokenHash(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  return data.properties.hashed_token;
}

test("el enlace de la plantilla (token_hash) abre sesión en un navegador que no lo pidió", async ({ browser }) => {
  const hash = await tokenHash(USERS.recepcion);
  const context = await browser.newContext(); // no cookies, no PKCE verifier
  const page = await context.newPage();
  await page.goto(`/auth/confirm?token_hash=${hash}&type=email`);
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: MIRADOR })).toBeVisible();
  await context.close();
});

test("el mismo enlace usado dos veces devuelve al login con error", async ({ browser }) => {
  const hash = await tokenHash(USERS.recepcion);
  const first = await browser.newContext();
  await (await first.newPage()).goto(`/auth/confirm?token_hash=${hash}&type=email`);
  await first.close();
  const second = await browser.newContext();
  const page = await second.newPage();
  await page.goto(`/auth/confirm?token_hash=${hash}&type=email`);
  await page.waitForURL("**/login?error=auth");
  await second.close();
});
