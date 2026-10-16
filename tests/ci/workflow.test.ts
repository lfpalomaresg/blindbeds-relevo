/**
 * Guardas sobre .github/workflows/ci.yml.
 *
 * No sustituye a un run real en GitHub, pero evita que el workflow pierda en
 * silencio lo que lo hace útil: que corra en push y PR a main, que exija
 * lint sin warnings, typecheck y la suite completa con la matriz RLS
 * obligatoria, y que las acciones estén fijadas por versión mayor.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = resolve(__dirname, "../../.github/workflows/ci.yml");
const read = () => readFileSync(WORKFLOW, "utf8");

describe(".github/workflows/ci.yml", () => {
  it("existe", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
  });

  it("se dispara en push y pull_request contra main", () => {
    const yml = read();
    expect(yml).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {4}branches: \[main\]/m);
  });

  it("solo pide permiso de lectura sobre el contenido", () => {
    expect(read()).toMatch(/^permissions:\n {2}contents: read\n/m);
  });

  it("instala según lockfile con caché de npm", () => {
    const yml = read();
    expect(yml).toMatch(/cache: npm/);
    expect(yml).toMatch(/run: npm ci\b/);
    expect(yml).not.toMatch(/npm install/);
  });

  it("lint sin warnings, typecheck y suite completa", () => {
    const yml = read();
    expect(yml).toMatch(/run: npm run lint -- --max-warnings=0/);
    expect(yml).toMatch(/run: npm run typecheck/);
    expect(yml).toMatch(/run: npm test\n/);
  });

  it("la matriz RLS es obligatoria: RLS_REQUIRE_PG=1 y binarios de Postgres localizados antes de los tests", () => {
    const yml = read();
    expect(yml).toMatch(/RLS_REQUIRE_PG: "1"/);
    expect(yml).toMatch(/\/usr\/lib\/postgresql\/\*\/bin/);
    expect(yml).toMatch(/GITHUB_PATH/);
    expect(yml.indexOf("GITHUB_PATH")).toBeLessThan(yml.indexOf("run: npm test"));
  });

  it("ningún paso tolera fallos", () => {
    const yml = read();
    expect(yml).not.toMatch(/continue-on-error/);
    expect(yml).not.toMatch(/\|\| true/);
  });

  it("todas las acciones están fijadas por versión mayor (nada de @main/@master/@latest)", () => {
    const uses = [...read().matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^actions\/[a-z-]+@v\d+$/);
  });

  it("no contiene secretos ni los referencia", () => {
    const yml = read();
    expect(yml).not.toMatch(/secrets\./);
    expect(yml).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });
});
