import { describe, expect, it } from "vitest";
import { localSupabaseEnv, resetMailpit } from "../../e2e/local-guard";

const LOCAL_FILE = [
  "# comentario",
  "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
  'NEXT_PUBLIC_SUPABASE_ANON_KEY="anon-local"',
  "SUPABASE_SERVICE_ROLE_KEY=service-local",
].join("\n");

describe("localSupabaseEnv", () => {
  it("devuelve las variables de .env.local cuando apuntan a Supabase local", () => {
    expect(localSupabaseEnv({}, LOCAL_FILE)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-local",
      SUPABASE_SERVICE_ROLE_KEY: "service-local",
    });
  });

  it("acepta localhost y la barra final", () => {
    const file = LOCAL_FILE.replace("http://127.0.0.1:54321", "http://localhost:54321/");
    expect(localSupabaseEnv({}, file).NEXT_PUBLIC_SUPABASE_URL).toBe("http://localhost:54321/");
  });

  it("se niega si .env.local apunta a un proyecto en la nube", () => {
    const file = LOCAL_FILE.replace("http://127.0.0.1:54321", "https://abc.supabase.co");
    expect(() => localSupabaseEnv({}, file)).toThrow(/no a Supabase local/);
  });

  it("se niega si la terminal sobrescribe la URL con una remota, aunque .env.local sea local", () => {
    // Next da prioridad a process.env sobre .env.local: eso es lo que usaría la app.
    expect(() => localSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, LOCAL_FILE)).toThrow(
      /abc\.supabase\.co/,
    );
  });

  it("se niega si la URL de la terminal está vacía", () => {
    expect(() => localSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "" }, LOCAL_FILE)).toThrow(/vacío/);
  });

  it("se niega si no hay .env.local ni variable", () => {
    expect(() => localSupabaseEnv({}, "")).toThrow(/vacío/);
  });

  it("no se deja engañar por un host que solo empieza como el local", () => {
    for (const url of ["http://127.0.0.1:54321.evil.co", "http://127.0.0.1:54321@abc.supabase.co", "https://127.0.0.1:54321"]) {
      expect(() => localSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: url }, LOCAL_FILE)).toThrow();
    }
  });

  it("toma las claves de la terminal si las hay, pero sigue exigiendo la URL local", () => {
    const env = localSupabaseEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-terminal" }, LOCAL_FILE);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-terminal");
  });
});

describe("resetMailpit", () => {
  const fakeFetch = (deleteStatus: number, total: number, listStatus = 200) =>
    (async (_url: string, init?: { method?: string }) =>
      init?.method === "DELETE"
        ? new Response(null, { status: deleteStatus })
        : new Response(JSON.stringify({ total }), { status: listStatus })) as unknown as typeof fetch;

  it("acaba bien si el borrado responde OK y el buzón queda vacío", async () => {
    await expect(resetMailpit(fakeFetch(200, 0))).resolves.toBeUndefined();
  });

  it("falla si el borrado no responde OK", async () => {
    await expect(resetMailpit(fakeFetch(500, 0))).rejects.toThrow(/500/);
  });

  it("falla si después del borrado quedan mensajes", async () => {
    await expect(resetMailpit(fakeFetch(200, 3))).rejects.toThrow(/3/);
  });

  it("falla si no se puede comprobar el buzón después del borrado", async () => {
    // Aunque el cuerpo diga 0: sin un 2xx no hay comprobación.
    await expect(resetMailpit(fakeFetch(200, 0, 500))).rejects.toThrow(/500/);
  });
});
