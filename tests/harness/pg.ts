/**
 * Harness de Postgres efímero sin Docker.
 *
 * Arranca un cluster con `initdb` + `pg_ctl` en un directorio temporal corto
 * (los sockets Unix están limitados a ~107 bytes de ruta), escuchando solo por
 * socket Unix, y lo destruye al terminar. Si el proceso corre como root, los
 * binarios de Postgres se ejecutan como un usuario sin privilegios mediante
 * `setpriv` (initdb/postgres se niegan a correr como root).
 *
 * Localización de binarios, en orden:
 *   1. `PG_BIN_DIR` (directorio con initdb/pg_ctl)
 *   2. `initdb` en PATH
 *   3. /usr/lib/postgresql/<version>/bin (Debian/Ubuntu), /usr/pgsql-<v>/bin,
 *      /opt/homebrew/opt/postgresql@<v>/bin
 */
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { Client, type ClientConfig } from "pg";

export interface EphemeralPostgres {
  /** Directorio del socket Unix (úsalo como `host`). */
  socketDir: string;
  /** Crea y conecta un cliente superusuario a la base `postgres`. */
  connect(overrides?: Partial<ClientConfig>): Promise<Client>;
  /** Ejecuta un fichero SQL completo como superusuario. */
  applySqlFile(path: string): Promise<void>;
  /** Para el servidor y borra el directorio temporal. */
  stop(): Promise<void>;
}

const CANDIDATE_DIRS = ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"];

export function findPgBinDir(): string | null {
  if (process.env.PG_BIN_DIR) {
    return existsSync(join(process.env.PG_BIN_DIR, "initdb")) ? process.env.PG_BIN_DIR : null;
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl"))) return dir;
  }
  for (const root of CANDIDATE_DIRS) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root)
      .filter((v) => /^(postgresql@)?\d+/.test(v))
      .sort((a, b) => parseInt(b.replace(/\D/g, ""), 10) - parseInt(a.replace(/\D/g, ""), 10));
    for (const v of versions) {
      const bin = join(root, v, "bin");
      if (existsSync(join(bin, "initdb"))) return bin;
    }
  }
  return null;
}

export function pgAvailable(): boolean {
  return findPgBinDir() !== null;
}

type Env = Record<string, string | undefined>;

function flag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
}

/**
 * ¿Es obligatorio tener Postgres? Sí en CI (`CI=true`, lo fijan GitHub Actions
 * y casi todos los runners) y siempre que se pida con `RLS_REQUIRE_PG=1`.
 */
export function pgRequired(env: Env = process.env): boolean {
  return flag(env.RLS_REQUIRE_PG) || flag(env.CI);
}

/**
 * Puerta de entrada de los tests de `tests/db`. Devuelve `true` si hay
 * Postgres. Si no lo hay: en local avisa y devuelve `false` (el fichero se
 * omite); en CI o con `RLS_REQUIRE_PG=1` LANZA, de modo que el fichero falla
 * en vez de omitirse. Un verde con la matriz RLS saltada no prueba nada.
 */
export function gatePg(
  label: string,
  opts: { available?: boolean; env?: Env; warn?: (msg: string) => void } = {},
): boolean {
  const available = opts.available ?? pgAvailable();
  if (available) return true;
  const env = opts.env ?? process.env;
  const msg = `[${label}] PostgreSQL no disponible (${describeEnvironment()}); tests omitidos.`;
  if (pgRequired(env)) {
    throw new Error(
      `[${label}] PostgreSQL no disponible (${describeEnvironment()}) y es obligatorio ` +
        "(CI o RLS_REQUIRE_PG): instala postgresql o define PG_BIN_DIR. Los tests de base de datos no se omiten en CI.",
    );
  }
  (opts.warn ?? console.warn)(msg);
  return false;
}

interface Runner {
  run(cmd: string, args: string[], opts?: ExecFileSyncOptions): void;
  /** Usuario del SO bajo el que corre el servidor. */
  osUser: string | null;
}

function pickUnprivilegedUser(): string {
  for (const candidate of ["postgres", "nobody"]) {
    try {
      execFileSync("id", ["-u", candidate], { stdio: "ignore" });
      return candidate;
    } catch {
      /* siguiente */
    }
  }
  throw new Error("Running as root and no unprivileged user (postgres/nobody) found for initdb");
}

function makeRunner(): Runner {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!isRoot) {
    return { osUser: null, run: (cmd, args, opts) => void execFileSync(cmd, args, opts) };
  }
  const osUser = pickUnprivilegedUser();
  return {
    osUser,
    run: (cmd, args, opts) =>
      void execFileSync(
        "setpriv",
        [`--reuid=${osUser}`, `--regid=${osUser}`, "--clear-groups", cmd, ...args],
        opts,
      ),
  };
}

export async function startEphemeralPostgres(): Promise<EphemeralPostgres> {
  const binDir = findPgBinDir();
  if (!binDir) {
    throw new Error(
      "PostgreSQL binaries (initdb, pg_ctl) not found. Install postgresql or set PG_BIN_DIR.",
    );
  }

  const runner = makeRunner();
  // Ruta corta a propósito: el socket Unix no admite rutas largas.
  const socketDir = mkdtempSync(join(tmpdir(), "relevo-pg-"));
  const dataDir = join(socketDir, "data");
  const logFile = join(socketDir, "postgres.log");

  if (runner.osUser) {
    const uid = parseInt(execFileSync("id", ["-u", runner.osUser]).toString().trim(), 10);
    const gid = parseInt(execFileSync("id", ["-g", runner.osUser]).toString().trim(), 10);
    chownSync(socketDir, uid, gid);
  }

  const quiet: ExecFileSyncOptions = { stdio: ["ignore", "ignore", "pipe"] };

  try {
    runner.run(
      join(binDir, "initdb"),
      ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-sync", "-E", "UTF8", "--locale=C"],
      quiet,
    );
    runner.run(
      join(binDir, "pg_ctl"),
      [
        "-D", dataDir,
        "-w",
        "-l", logFile,
        "-o", `-k ${socketDir} -c listen_addresses='' -F -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
        "start",
      ],
      quiet,
    );
  } catch (err) {
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    // `pg_ctl -w start` puede fallar (timeout) con el postmaster ya arrancado:
    // pararlo antes de borrar su directorio para no dejar un proceso huérfano.
    try {
      runner.run(join(binDir, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], quiet);
    } catch {
      /* no llegó a arrancar */
    }
    rmSync(socketDir, { recursive: true, force: true });
    throw new Error(`Could not start ephemeral Postgres: ${(err as Error).message}\n${log}`);
  }

  const baseConfig: ClientConfig = { host: socketDir, user: "postgres", database: "postgres" };

  const connect = async (overrides: Partial<ClientConfig> = {}) => {
    const client = new Client({ ...baseConfig, ...overrides });
    await client.connect();
    return client;
  };

  const applySqlFile = async (path: string) => {
    const sql = readFileSync(path, "utf8");
    const client = await connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      runner.run(join(binDir, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], quiet);
    } finally {
      rmSync(socketDir, { recursive: true, force: true });
    }
  };

  return { socketDir, connect, applySqlFile, stop };
}

/** Quién soy a efectos de diagnóstico en los mensajes de skip. */
export function describeEnvironment(): string {
  const bin = findPgBinDir();
  return `pg bin: ${bin ?? "not found"}; os user: ${userInfo().username}`;
}
