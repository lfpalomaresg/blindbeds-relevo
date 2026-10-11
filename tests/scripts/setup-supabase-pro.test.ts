/**
 * Test de shell de scripts/setup-supabase-pro.sh SIN red.
 *
 * Se ejecuta el script en un directorio temporal con un `psql` falso en el PATH
 * que registra cada invocación y responde lo que el script espera. Así se
 * comprueba el orden de operaciones (migración → seed → verificaciones) y los
 * fallos cerrados (sin .env.local, sin variables, sin psql, tabla ausente) sin
 * tocar ningún Supabase.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/setup-supabase-pro.sh");

const SERVICE_ROLE_KEY = "service-role-secret-DO-NOT-PRINT";
const ENV_OK = [
  "NEXT_PUBLIC_SUPABASE_URL=https://abcxyz.supabase.co",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-public-key",
  `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}`,
  "SUPABASE_DB_PASSWORD=db-password-example",
  "",
].join("\n");

/**
 * psql falso: anota los argumentos en psql.log y contesta según la consulta.
 * FAKE_PSQL_MISSING_TABLE hace que una tabla concreta "no exista".
 */
const FAKE_PSQL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_PSQL_LOG"
query=""
while [ $# -gt 0 ]; do
  case "$1" in
    -c) query="$2"; shift 2 ;;
    -f) [ -f "$2" ] || { echo "psql: error: $2: No such file" >&2; exit 1; }; shift 2 ;;
    *) shift ;;
  esac
done
case "$query" in
  *information_schema.tables*)
    if [ -n "\${FAKE_PSQL_MISSING_TABLE:-}" ] && [[ "$query" == *"table_name='\${FAKE_PSQL_MISSING_TABLE}'"* ]]; then echo " 0"; else echo " 1"; fi ;;
  *rowsecurity*) echo " t" ;;
  *storage.buckets*) echo " ticket-photos" ;;
  "") ;;
  *) echo "unexpected query: $query" >&2; exit 2 ;;
esac
`;

let work: string;
let fakeBin: string;
let log: string;

function run(opts: { env?: Record<string, string>; withPsql?: boolean } = {}) {
  // Con psql: nuestro fake delante del PATH real. Sin psql: un PATH que solo
  // contiene bash y las utilidades básicas (sed, tr, printf) pero ningún psql.
  const path = (opts.withPsql ?? true) ? `${fakeBin}:${process.env.PATH}` : join(work, "nopsqlbin");
  const res = spawnSync("bash", [SCRIPT], {
    cwd: work,
    env: { NODE_ENV: "test", PATH: path, HOME: work, FAKE_PSQL_LOG: log, LANG: "C.UTF-8", ...opts.env },
    encoding: "utf8",
  });
  return { ...res, out: `${res.stdout}\n${res.stderr}` };
}

function psqlCalls(): string[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "relevo-setup-"));
  fakeBin = join(work, "fakebin");
  log = join(work, "psql.log");
  mkdirSync(fakeBin);
  writeFileSync(join(fakeBin, "psql"), FAKE_PSQL);
  chmodSync(join(fakeBin, "psql"), 0o755);
  const noPsqlBin = join(work, "nopsqlbin");
  mkdirSync(noPsqlBin);
  for (const tool of ["bash", "sed", "tr", "printf", "echo"]) {
    const real = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    if (real && real.startsWith("/")) symlinkSync(real, join(noPsqlBin, tool));
  }
  // El script lee las rutas relativas al cwd: copiamos solo lo que necesita.
  mkdirSync(join(work, "supabase/migrations"), { recursive: true });
  mkdirSync(join(work, "scripts"), { recursive: true });
  cpSync(join(ROOT, "supabase/migrations/000001_baseline.sql"), join(work, "supabase/migrations/000001_baseline.sql"));
  cpSync(join(ROOT, "scripts/seed-demo.sql"), join(work, "scripts/seed-demo.sql"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("scripts/setup-supabase-pro.sh", () => {
  it("tiene sintaxis bash válida y es ejecutable", () => {
    expect(() => execFileSync("bash", ["-n", SCRIPT])).not.toThrow();
    expect(readFileSync(SCRIPT, "utf8").startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("existe .env.local.example con las variables que el script exige y sin valores reales", () => {
    const example = readFileSync(join(ROOT, ".env.local.example"), "utf8");
    for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_PASSWORD"]) {
      expect(example).toMatch(new RegExp(`^${v}=`, "m"));
    }
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // ningún JWT real
  });

  it("sin .env.local sale con 1, lo dice y no invoca psql", () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/\.env\.local no encontrado/);
    expect(psqlCalls()).toEqual([]);
  });

  it("si falta SUPABASE_DB_PASSWORD falla antes de conectar", () => {
    writeFileSync(join(work, ".env.local"), ENV_OK.replace(/^SUPABASE_DB_PASSWORD=.*\n/m, ""));
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/SUPABASE_DB_PASSWORD/);
    expect(psqlCalls()).toEqual([]);
  });

  it("si falta SUPABASE_SERVICE_ROLE_KEY falla antes de conectar", () => {
    writeFileSync(join(work, ".env.local"), ENV_OK.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*\n/m, ""));
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(psqlCalls()).toEqual([]);
  });

  it("sin psql instalado falla con un mensaje claro antes de hacer nada", () => {
    writeFileSync(join(work, ".env.local"), ENV_OK);
    const r = run({ withPsql: false });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/psql no encontrado/i);
    // Debe cortar antes de intentar conectar (no debe llegar a "Conectando a").
    expect(r.out).not.toMatch(/Conectando a/);
  });

  it("dry-run completo: migración, seed y verificaciones en orden contra el host derivado de la URL", () => {
    writeFileSync(join(work, ".env.local"), ENV_OK);
    const r = run();
    expect(r.status, r.out).toBe(0);

    const calls = psqlCalls();
    expect(calls[0]).toMatch(/-f supabase\/migrations\/000001_baseline\.sql/);
    expect(calls[1]).toMatch(/-f scripts\/seed-demo\.sql/);
    for (const c of calls) {
      expect(c).toContain("postgresql://postgres:db-password-example@db.abcxyz.supabase.co:5432/postgres");
    }

    const tables = ["organizations", "memberships", "shift_handovers", "handover_items", "ticket_assets", "maintenance_tickets", "ticket_updates"];
    for (const t of tables) {
      expect(calls.some((c) => c.includes("information_schema.tables") && c.includes(`table_name='${t}'`)), t).toBe(true);
      expect(calls.some((c) => c.includes("rowsecurity") && c.includes(`tablename='${t}'`)), t).toBe(true);
    }
    expect(calls.some((c) => c.includes("storage.buckets") && c.includes("ticket-photos"))).toBe(true);
    // 2 ficheros + 7 tablas + 7 RLS + 1 bucket
    expect(calls).toHaveLength(17);

    expect(r.out).toMatch(/Setup completo/);
    expect(r.out).toContain("NEXT_PUBLIC_SUPABASE_URL      = https://abcxyz.supabase.co");
  });

  it("nunca imprime el valor de SUPABASE_SERVICE_ROLE_KEY ni la contraseña de la base de datos", () => {
    writeFileSync(join(work, ".env.local"), ENV_OK);
    const r = run();
    expect(r.out).not.toContain(SERVICE_ROLE_KEY);
    expect(r.out).not.toContain("db-password-example");
  });

  it("si una tabla no existe tras la migración, sale con 1 y la nombra", () => {
    writeFileSync(join(work, ".env.local"), ENV_OK);
    const r = run({ env: { FAKE_PSQL_MISSING_TABLE: "handover_items" } });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/handover_items.*NO ENCONTRADA/);
  });

  it("solo aplica ficheros de supabase/migrations, nunca la variante de supabase/variants", () => {
    writeFileSync(join(work, ".env.local"), ENV_OK);
    run();
    for (const c of psqlCalls()) expect(c).not.toMatch(/variants|000002/);
  });
});
