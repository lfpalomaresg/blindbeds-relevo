/**
 * Todo lo que hay en public/ se despliega con la app: cada fichero debe usarse
 * en ella (código de src/, el manifest o el service worker). Los restos de la
 * plantilla de create-next-app no aportan nada y amplían lo que se publica.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const SOURCES = [
  ...filesUnder(path.join(ROOT, "src")).filter((f) => /\.(tsx?|css)$/.test(f)),
  path.join(PUBLIC, "manifest.json"),
  path.join(PUBLIC, "sw.js"),
  path.join(ROOT, "next.config.ts"),
].map((f) => readFileSync(f, "utf8"));

describe("public/ sin ficheros sin uso", () => {
  const assets = filesUnder(PUBLIC).map((f) => path.relative(PUBLIC, f).split(path.sep).join("/"));

  it("hay ficheros que comprobar (el manifest y el service worker, al menos)", () => {
    expect(assets).toEqual(expect.arrayContaining(["manifest.json", "sw.js"]));
  });

  it.each(assets)("%s se usa en la app", (asset) => {
    expect(SOURCES.some((src) => src.includes(`/${asset}`))).toBe(true);
  });
});
