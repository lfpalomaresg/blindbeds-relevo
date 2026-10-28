import { execFileSync } from "node:child_process";
import path from "node:path";
import { resetMailpit } from "./local-guard";

// playwright.config.ts has already refused anything but local Supabase
// (e2e/local-guard.ts). Here: same starting point on every run.
export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");

  const health = await fetch("http://127.0.0.1:54321/auth/v1/health").catch(() => null);
  if (!health?.ok) throw new Error("e2e: Supabase local no responde. Arráncalo con `supabase start`.");

  if (process.env.E2E_SKIP_RESET !== "1") {
    // Migrations + supabase/seed.sql.
    execFileSync("supabase", ["db", "reset", "--local"], { cwd: root, stdio: "inherit" });
  }
  await resetMailpit();
}
