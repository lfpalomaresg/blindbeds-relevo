// Guard for the e2e journeys: they create and delete data, so they only ever run
// against the local Supabase started with `supabase start`, never a cloud project.
// Pure functions so tests/e2e/local-guard.test.ts can prove the guard itself.

const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/;
export const MAILPIT = "http://127.0.0.1:54324";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
export type LocalSupabaseEnv = Record<(typeof KEYS)[number], string>;

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/**
 * The env the app will actually see: Next gives the shell's variables priority
 * over .env.local, so a shell value wins here too. Throws unless the URL is local.
 */
export function localSupabaseEnv(processEnv: Record<string, string | undefined>, dotenv: string): LocalSupabaseEnv {
  const file = parseDotenv(dotenv);
  const env = Object.fromEntries(KEYS.map((k) => [k, processEnv[k] ?? file[k] ?? ""])) as LocalSupabaseEnv;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!LOCAL_URL.test(url)) {
    throw new Error(`e2e: la app apuntaría a «${url || "(vacío)"}», no a Supabase local. No ejecuto nada.`);
  }
  return env;
}

/** Empties the local inbox and checks it is really empty. */
export async function resetMailpit(fetchImpl: typeof fetch = fetch): Promise<void> {
  const del = await fetchImpl(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  if (!del.ok) throw new Error(`e2e: Mailpit no ha vaciado el buzón (HTTP ${del.status}).`);
  const list = await fetchImpl(`${MAILPIT}/api/v1/messages`);
  const total = list.ok ? ((await list.json()) as { total?: number }).total : undefined;
  if (total !== 0) throw new Error(`e2e: el buzón de Mailpit no ha quedado vacío (${total ?? `HTTP ${list.status}`}).`);
}
