/**
 * Regla «la matriz RLS no se puede saltar en CI».
 *
 * Sin binarios de Postgres, `npm test` en local omite `tests/db` con un aviso.
 * En CI (`CI=true`) o con `RLS_REQUIRE_PG=1` esa ausencia tiene que ser un
 * FALLO: un verde con la matriz omitida no prueba nada.
 *
 * Dos niveles: la función pura (`pgRequired` / `gatePg`) y el comportamiento
 * real de vitest lanzado como subproceso sobre `tests/db` con `PG_BIN_DIR`
 * apuntando a un directorio sin `initdb` (así el harness no encuentra Postgres
 * aunque la máquina lo tenga instalado).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gatePg, pgRequired } from "../harness/pg";

const ROOT = resolve(__dirname, "../..");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");

describe("pgRequired", () => {
  it("no es obligatorio en local sin variables", () => {
    expect(pgRequired({})).toBe(false);
  });

  it.each([
    ["CI=true", { CI: "true" }],
    ["CI=1", { CI: "1" }],
    ["RLS_REQUIRE_PG=1", { RLS_REQUIRE_PG: "1" }],
  ])("es obligatorio con %s", (_label, env) => {
    expect(pgRequired(env)).toBe(true);
  });

  it.each([
    ["CI vacío", { CI: "" }],
    ["CI=false", { CI: "false" }],
    ["CI=0", { CI: "0" }],
    ["RLS_REQUIRE_PG=0", { RLS_REQUIRE_PG: "0" }],
  ])("no es obligatorio con %s", (_label, env) => {
    expect(pgRequired(env)).toBe(false);
  });

  it("RLS_REQUIRE_PG=1 manda aunque CI=false", () => {
    expect(pgRequired({ CI: "false", RLS_REQUIRE_PG: "1" })).toBe(true);
  });
});

describe("gatePg", () => {
  it("con Postgres disponible devuelve true y no avisa", () => {
    const warn = vi.fn();
    expect(gatePg("x.test", { available: true, env: { CI: "true" }, warn })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("sin Postgres y sin CI devuelve false y avisa (omisión visible)", () => {
    const warn = vi.fn();
    expect(gatePg("x.test", { available: false, env: {}, warn })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/x\.test.*omitidos/));
  });

  it("sin Postgres y con CI=true lanza: nunca se omite en CI", () => {
    expect(() => gatePg("x.test", { available: false, env: { CI: "true" }, warn: vi.fn() })).toThrow(
      /PostgreSQL no disponible/,
    );
  });

  it("sin Postgres y con RLS_REQUIRE_PG=1 lanza", () => {
    expect(() => gatePg("x.test", { available: false, env: { RLS_REQUIRE_PG: "1" }, warn: vi.fn() })).toThrow(
      /PostgreSQL no disponible/,
    );
  });
});

describe("vitest sobre tests/db sin binarios de Postgres (subproceso)", () => {
  let emptyBin: string;

  beforeAll(() => {
    emptyBin = mkdtempSync(join(tmpdir(), "relevo-nopg-"));
  });

  afterAll(() => {
    rmSync(emptyBin, { recursive: true, force: true });
  });

  function runDbSuite(extraEnv: Record<string, string>) {
    // Entorno mínimo y explícito: no se hereda CI ni RLS_REQUIRE_PG del proceso padre.
    const env = {
      NODE_ENV: "test" as const,
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PG_BIN_DIR: emptyBin,
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
      ...extraEnv,
    };
    const r = spawnSync(process.execPath, [VITEST, "run", "tests/db"], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  }

  it("con CI=true FALLA (exit != 0) y lo explica; no hay tests omitidos en verde", () => {
    const r = runDbSuite({ CI: "true" });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/PostgreSQL no disponible/);
  }, 130_000);

  it("en local (sin CI) se omite con aviso y sale 0", () => {
    const r = runDbSuite({});
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/omitidos/);
    expect(r.out).toMatch(/skipped/);
  }, 130_000);
});
