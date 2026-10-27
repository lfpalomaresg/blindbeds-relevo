/**
 * Textos de la UI y del README frente a lo que hace el código.
 *
 * Cada caso fija una corrección de docs/32_TEXTOS_VS_REALIDAD.md: si alguien
 * vuelve a prometer algo que el producto no hace, el test lo señala. Las
 * comprobaciones son sobre el texto fuente, sin renderizar.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

const SRC = sourceFiles("src").map((rel) => ({ rel, text: read(rel) }));
const README = read("README.md");

function filesContaining(re: RegExp): string[] {
  return SRC.filter((f) => re.test(f.text)).map((f) => f.rel);
}

describe("textos de la UI frente al código", () => {
  it("ningún texto dice que la foto del parte es obligatoria (photo_path admite null y el input no es required)", () => {
    expect(filesContaining(/foto es obligatoria|foto obligatoria/i)).toEqual([]);
  });

  it("la página de nuevo parte dice que la foto es opcional", () => {
    expect(read("src/app/tickets/new/page.tsx")).toMatch(/foto[^.]*opcional/i);
  });

  it("ningún texto dice que se notifica a mantenimiento (no hay notificaciones)", () => {
    expect(filesContaining(/notificad|notificamos|se notifica/i)).toEqual([]);
  });

  it("el escáner no ofrece introducir el código a mano (no existe ese campo)", () => {
    expect(filesContaining(/introducir código|código manualmente/i)).toEqual([]);
  });

  it("el escáner no afirma que el acceso fue denegado cuando el fallo puede ser otro", () => {
    expect(read("src/components/tickets/QRScanner.tsx")).not.toMatch(/acceso a cámara denegado/i);
  });

  it("el relevo registrado no garantiza que el siguiente turno lo verá (puede resolverse antes; no hay marca de lectura)", () => {
    expect(filesContaining(/lo verá al entrar/i)).toEqual([]);
  });

  it("el panel no dice ser «del día» (las consultas no filtran por fecha)", () => {
    expect(read("src/app/dashboard/page.tsx")).not.toMatch(/del día/i);
  });

  it("el panel no titula «activos» una lista que puede mostrar cerrados y oculta «en curso» por defecto", () => {
    expect(read("src/app/dashboard/page.tsx")).not.toMatch(/partes de avería activos/i);
  });
});

describe("README frente al código", () => {
  it("no dice que la foto es obligatoria", () => {
    expect(README).not.toMatch(/foto obligatoria/i);
    expect(README).toMatch(/foto opcional/i);
  });

  it("no promete trazabilidad completa por activo (no hay vista ni historial por activo)", () => {
    expect(README).not.toMatch(/trazabilidad completa/i);
  });

  it("describe la traza de estados como atómica (change_ticket_status, 000005) y no como un insert que puede fallar", () => {
    expect(README).not.toMatch(/se intenta registrar[^\n]*ticket_updates/i);
    expect(README).not.toMatch(/si (esa|la) inserción falla[^\n]*sin historial/i);
    expect(README).toMatch(/change_ticket_status[^\n]*(misma|una sola) transacción/i);
  });

  it("describe el relevo como atómico (create_handover, 000006)", () => {
    expect(README).toMatch(/create_handover[^\n]*(misma|una sola) transacción/i);
  });

  it("no dice que el magic link redirige a la raíz una vez corregido", () => {
    const login = read("src/components/auth/LoginForm.tsx");
    if (/emailRedirectTo:[^\n]*\/auth\/callback/.test(login)) {
      const authLine = README.split("\n").find((line) => /^- Auth vía Supabase/.test(line)) ?? "";
      expect(authLine).not.toMatch(/redirige a la raíz/i);
      expect(authLine).toMatch(/\/auth\/callback/);
    }
  });

  it("el one-pager (docs/33) no dice que faltan las policies de storage si existe 000003", () => {
    const onePager = read("docs/33_ONE_PAGER_RELEVO.md");
    expect(onePager).not.toMatch(/faltan las policies/i);
    expect(onePager).not.toMatch(/sin policies en `storage\.objects`/i);
  });

  it("no da la PWA por lista mientras el manifest apunte a iconos que no existen", () => {
    const manifest = JSON.parse(read("public/manifest.json")) as { icons: { src: string }[] };
    const missing = manifest.icons.filter((icon) => {
      try {
        statSync(path.join(ROOT, "public", icon.src));
        return false;
      } catch {
        return true;
      }
    });
    if (missing.length > 0) {
      expect(README).not.toMatch(/service worker ready/i);
    }
  });

  it("no da por aislado por org el bucket de fotos si la migración no define policies en storage.objects", () => {
    // Cualquier migración secuencial cuenta (desde relevo#2 las policies viven en 000003).
    const migrations = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => read(path.join("supabase/migrations", f)))
      .join("\n");
    // Cuenta una DEFINICIÓN (create policy … on storage.objects), no un drop ni un comentario.
    const sinComentarios = migrations.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
    if (!/create\s+policy\s+(?:\w+|"[^"]+")\s+on\s+storage\.objects/i.test(sinComentarios)) {
      expect(README).not.toMatch(/scoped por org_id/i);
      expect(README).toMatch(/storage\.objects/);
    }
  });

  it("no da por bueno el magic link mientras el redirect apunte a la raíz y nadie canjee el code", () => {
    const login = read("src/components/auth/LoginForm.tsx");
    if (/emailRedirectTo:\s*window\.location\.origin\s*[,}]/.test(login)) {
      const authLine = README.split("\n").find((line) => /^- Auth vía Supabase/.test(line)) ?? "";
      expect(authLine).toMatch(/pendiente de verificar/i);
    }
  });

  it("el despliegue no pide subir SUPABASE_SERVICE_ROLE_KEY a Vercel (ningún código de la app la usa y el runbook lo prohíbe)", () => {
    const importsAdmin = filesContaining(/from\s+["']@\/lib\/supabase\/admin["']/);
    if (importsAdmin.length === 0) {
      const deploy = README.split("## Despliegue")[1]?.split("\n## ")[0] ?? "";
      const envLine = deploy.split("\n").find((line) => /env vars/i.test(line)) ?? "";
      expect(envLine).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
      expect(envLine).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(deploy).toMatch(/nunca[^\n]*SUPABASE_SERVICE_ROLE_KEY/i);
    }
  });

  it("enlaza el inventario de textos frente a realidad", () => {
    expect(README).toContain("32_TEXTOS_VS_REALIDAD.md");
    expect(read("docs/32_TEXTOS_VS_REALIDAD.md")).toMatch(/fichero:línea/i);
  });
});
