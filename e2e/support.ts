import { expect, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";

export const MAILPIT = "http://127.0.0.1:54324";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Seeded users (supabase/seed.sql). */
export const USERS = {
  direccion: "direccion@example.com",
  gobernanta: "gobernanta@example.com",
  recepcion: "recepcion@example.com",
  mantenimiento: "mantenimiento@example.com",
  costa: "costa@example.com",
} as const;

/** 1×1 PNG, enough for a real image upload. */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type MailSummary = { ID: string };

async function messageIds(email: string): Promise<Set<string>> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`);
  const body = (await res.json()) as { messages?: MailSummary[] };
  return new Set((body.messages ?? []).map((m) => m.ID));
}

async function newMagicLink(email: string, before: Set<string>): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=10`);
    const body = (await res.json()) as { messages?: MailSummary[] };
    const fresh = (body.messages ?? []).find((m) => !before.has(m.ID));
    if (fresh) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string };
      const href = /href="([^"]+\/auth\/v1\/verify[^"]+)"/.exec(full.HTML)?.[1];
      if (href) return href.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No llegó el enlace mágico a ${email}`);
}

/** Requests a magic link from /login and opens it from the local mailbox. Returns the link used. */
export async function requestMagicLink(page: Page, email: string): Promise<string> {
  const before = await messageIds(email);
  const sent = page.getByRole("heading", { name: "Revisa tu email" });
  // GoTrue allows one link per address per `max_frequency` (1 s locally). Back-to-back
  // journeys with the same user hit it, so wait it out instead of failing the journey.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Acceder" }).click();
    const throttled = page.getByText(/Ya te hemos enviado un enlace\. Espera/);
    await expect(sent.or(throttled)).toBeVisible();
    if (await sent.isVisible()) return newMagicLink(email, before);
    await page.waitForTimeout(1500);
  }
  throw new Error(`GoTrue sigue limitando los enlaces a ${email}`);
}

/** Visible error message (Next.js also renders an empty role=alert route announcer). */
export function alertMessage(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

export async function loginAs(page: Page, email: string): Promise<string> {
  const link = await requestMagicLink(page, email);
  await page.goto(link);
  await page.waitForURL("**/dashboard");
  return link;
}

/**
 * Records console errors, uncaught exceptions and HTTP ≥ 400 while the test runs.
 * `check()` fails softly on console errors / 5xx and attaches everything to the report.
 */
export function watch(page: Page, testInfo: TestInfo) {
  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on("console", (msg) => {
    // 429s come from requestMagicLink waiting out GoTrue's per-address throttle, not from the app.
    if (msg.type() === "error" && !msg.text().includes("status of 429")) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.request().method()} ${res.url().split("?")[0]}`);
  });
  return {
    httpErrors,
    async check() {
      if (consoleErrors.length || httpErrors.length) {
        await testInfo.attach("errores-de-pagina", {
          body: JSON.stringify({ consoleErrors, httpErrors }, null, 2),
          contentType: "application/json",
        });
      }
      expect.soft(consoleErrors, "errores de consola").toEqual([]);
      expect.soft(httpErrors.filter((e) => e.startsWith("5")), "respuestas 5xx").toEqual([]);
    },
  };
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Pending-item card on the dashboard. */
export function pendingCard(page: Page, text: string) {
  return page.locator("div.bg-amber-50", { hasText: text });
}
