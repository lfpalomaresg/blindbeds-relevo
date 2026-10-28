/**
 * Fallos a medias del harness de Postgres (sin arrancar ningún Postgres real):
 * con un `initdb`/`pg_ctl` falsos vía PG_BIN_DIR se comprueba que, si
 * `pg_ctl start` falla, se intenta `pg_ctl stop` antes de borrar el directorio
 * (pg_ctl -w puede fallar por timeout con el postmaster ya arrancado).
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPgBinDir, startEphemeralPostgres } from "../harness/pg";

let work: string;
let log: string;

function fakeBinary(bin: string, name: string, body: string) {
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "${log}"\n${body}\n`);
  chmodSync(file, 0o755);
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "relevo-fakepg-"));
  log = join(work, "calls.log");
  const bin = join(work, "bin");
  mkdirSync(bin);
  fakeBinary(bin, "initdb", "exit 0");
  fakeBinary(bin, "pg_ctl", 'case "$*" in *start) exit 1 ;; *) exit 0 ;; esac');
  vi.stubEnv("PG_BIN_DIR", bin);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(work, { recursive: true, force: true });
});

describe("harness pg.ts ante un pg_ctl start fallido", () => {
  it("PG_BIN_DIR manda sobre el PATH y los directorios candidatos", () => {
    expect(findPgBinDir()).toBe(join(work, "bin"));
  });

  it("propaga el error e intenta pg_ctl stop antes de borrar el directorio", async () => {
    await expect(startEphemeralPostgres()).rejects.toThrow(/Could not start ephemeral Postgres/);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls[0]).toMatch(/^initdb /);
    expect(calls[1]).toMatch(/^pg_ctl .*start$/);
    expect(calls.slice(2).some((c) => /^pg_ctl .*stop$/.test(c)), calls.join(" | ")).toBe(true);
  });
});

describe("harness pg.ts y el locale", () => {
  // En macOS, con LANG/LC_* distinto de C, el postmaster puede morir al
  // arrancar con "postmaster became multithreaded during startup". Supply
  // lanza sus binarios con LC_ALL=C; aquí, igual.
  it("lanza initdb y pg_ctl con LC_ALL=C aunque la terminal tenga otro locale", async () => {
    vi.stubEnv("LC_ALL", "es_ES.UTF-8");
    vi.stubEnv("LANG", "es_ES.UTF-8");
    const bin = join(work, "bin");
    const envLog = join(work, "env.log");
    const record = `printf '%s LC_ALL=%s\\n' "$(basename "$0")" "\${LC_ALL-unset}" >> "${envLog}"`;
    fakeBinary(bin, "initdb", `${record}\nexit 0`);
    fakeBinary(bin, "pg_ctl", `${record}\nexit 0`);

    const pg = await startEphemeralPostgres();
    await pg.stop();

    const lines = readFileSync(envLog, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(line).toMatch(/ LC_ALL=C$/);
  });
});
