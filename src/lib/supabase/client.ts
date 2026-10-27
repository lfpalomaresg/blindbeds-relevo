import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";

/**
 * Cliente de navegador. Debe ser el de @supabase/ssr: usa PKCE (el enlace
 * mágico vuelve con `?code=`, que canjea /auth/callback en servidor) y guarda
 * la sesión en cookies, que es lo que lee el proxy. El cliente plano de
 * supabase-js usa flujo implícito y localStorage, invisibles para el servidor.
 */
export function createBrowserClient() {
  return createSsrBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
