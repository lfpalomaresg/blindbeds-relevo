import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R1: el cliente de navegador debe ser el de @supabase/ssr. Ese cliente usa
 * PKCE (el enlace mágico vuelve con `?code=`, que canjea /auth/callback) y
 * guarda la sesión en cookies, que es lo que lee el proxy. El cliente plano de
 * supabase-js usa flujo implícito (tokens en el `#hash`, invisibles para el
 * servidor) y localStorage, así que el proxy nunca vería la sesión.
 */
const mocks = vi.hoisted(() => ({
  ssrCreateBrowserClient: vi.fn(() => ({ kind: "ssr" })),
  createClient: vi.fn(() => ({ kind: "supabase-js" })),
}));

vi.mock("@supabase/ssr", () => ({ createBrowserClient: mocks.ssrCreateBrowserClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { createBrowserClient } from "@/lib/supabase/client";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mocks.ssrCreateBrowserClient.mockClear();
  mocks.createClient.mockClear();
});

describe("createBrowserClient", () => {
  it("usa el cliente de @supabase/ssr (PKCE + sesión en cookies), no el de supabase-js", () => {
    const client = createBrowserClient() as unknown as { kind: string };
    expect(client.kind).toBe("ssr");
    expect(mocks.ssrCreateBrowserClient).toHaveBeenCalledWith("https://abc.supabase.co", "anon-key");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
