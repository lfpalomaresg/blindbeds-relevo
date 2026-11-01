#!/usr/bin/env node
// Retención de fotos de partes de avería (RGPD art. 5.1.e: minimización).
//
// Borra la FOTO de los partes cerrados hace más de N días (90 por defecto) y
// deja el parte y su historial. No toca partes abiertos ni en curso.
//
// Por qué un script y no solo SQL: borrar la fila de storage.objects por SQL no
// elimina el objeto del almacenamiento. Aquí se llama a la Storage API con
// service_role, que sí lo borra de verdad.
//
// Uso (desde la raíz del repo, con .env.local cargado):
//   node --env-file=.env.local scripts/purge-ticket-photos.mjs            # simulación
//   node --env-file=.env.local scripts/purge-ticket-photos.mjs --apply    # borra
//   node --env-file=.env.local scripts/purge-ticket-photos.mjs --apply --days=30
//
// Salida: cuántas fotos se habrían borrado (simulación) o se han borrado.

const BUCKET = "ticket-photos";
const DEFAULT_DAYS = 90;
const PAGE_SIZE = 500;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * La foto tiene que estar exactamente en `{org_id del parte}/{uuid}.(jpg|png|webp)`
 * (lo que genera buildPhotoPath y exige el CHECK de 000012). Si no, no se toca:
 * el purgador usa service_role y no debe borrar nada fuera de la carpeta de la org.
 */
function photoBelongsToOrg(photoPath, orgId) {
  if (typeof orgId !== "string" || !new RegExp(`^${UUID}$`).test(orgId)) return false;
  return new RegExp(`^${orgId}/${UUID}\\.(jpg|png|webp)$`).test(photoPath);
}

/**
 * Filtra las filas que toca purgar. Puro para poder probarlo sin red.
 * @template {{org_id?: string, photo_path?: string|null, status?: string, closed_at?: string|null}} T
 * @param {T[]} rows
 * @param {Date} [now]
 * @param {number} [days]
 * @returns {T[]}
 */
export function selectExpiredPhotos(rows, now = new Date(), days = DEFAULT_DAYS) {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return rows.filter((row) => {
    if (!row.photo_path) return false;
    if (!photoBelongsToOrg(row.photo_path, row.org_id)) return false;
    if (row.status !== "cerrado" || !row.closed_at) return false;
    const closed = new Date(row.closed_at);
    if (Number.isNaN(closed.getTime())) return false;
    return closed < cutoff;
  });
}

/**
 * Lee TODOS los partes cerrados antes de `cutoffIso` con foto, por páginas
 * ordenadas por id (PostgREST corta en ~1000 filas si no se pagina).
 * @param {string} url
 * @param {Record<string,string>} headers
 * @param {string} cutoffIso
 * @param {typeof fetch} [fetchImpl]
 * @param {number} [pageSize]
 */
export async function fetchClosedWithPhoto(url, headers, cutoffIso, fetchImpl = fetch, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({
      select: "id,org_id,photo_path,status,closed_at",
      status: "eq.cerrado",
      photo_path: "not.is.null",
      closed_at: `lt.${cutoffIso}`,
      order: "id.asc",
      limit: String(pageSize),
      offset: String(offset),
    });
    const res = await fetchImpl(`${url}/rest/v1/maintenance_tickets?${q}`, { headers });
    if (!res.ok) throw new Error(`Error leyendo partes: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const BATCH_SIZE = 50;
const ORPHAN_MIN_AGE_HOURS = 24;

/**
 * Borra las fotos vencidas por lotes COMPLETOS: en cada lote, Storage borra los
 * objetos y solo se vacía `photo_path` de los que Storage confirma borrados.
 * Si un lote falla, se para ahí: lo ya hecho queda coherente.
 * @param {string} url
 * @param {Record<string,string>} headers
 * @param {{id: string, photo_path: string}[]} expired
 * @param {typeof fetch} [fetchImpl]
 * @param {number} [batchSize]
 */
export async function purgeExpired(url, headers, expired, fetchImpl = fetch, batchSize = BATCH_SIZE) {
  let deleted = 0;
  let cleared = 0;
  const notDeleted = [];
  for (let i = 0; i < expired.length; i += batchSize) {
    const batch = expired.slice(i, i + batchSize);
    const del = await fetchImpl(`${url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: batch.map((r) => r.photo_path) }),
    });
    if (!del.ok) throw new Error(`Error borrando objetos: ${del.status} ${await del.text()}`);
    const gone = new Set((await del.json()).map((o) => o.name));
    const done = batch.filter((r) => gone.has(r.photo_path));
    for (const r of batch) if (!gone.has(r.photo_path)) notDeleted.push(r.photo_path);
    deleted += done.length;
    if (done.length === 0) continue;
    const patch = await fetchImpl(
      `${url}/rest/v1/maintenance_tickets?id=in.(${done.map((r) => r.id).join(",")})`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ photo_path: null }),
      },
    );
    if (!patch.ok) {
      throw new Error(
        `Lote ${i / batchSize + 1}: ${done.length} objetos borrados pero fallo al vaciar photo_path: ${patch.status} ${await patch.text()}`,
      );
    }
    cleared += done.length;
  }
  return { deleted, cleared, notDeleted };
}

/**
 * Objetos de `{orgId}/` sin parte que los referencie (p. ej. subida OK + insert
 * fallido de un usuario que no puede borrar). Solo los de más de `minAgeHours`
 * para no pisar una subida cuyo parte se está creando.
 * @param {string} orgId
 * @param {{name: string, id: string|null, created_at?: string}[]} objects nombres relativos a `{orgId}/`
 * @param {Set<string>} referenced rutas completas referenciadas
 */
export function findOrphans(orgId, objects, referenced, now = new Date(), minAgeHours = ORPHAN_MIN_AGE_HOURS) {
  const cutoff = now.getTime() - minAgeHours * 3600 * 1000;
  return objects
    .filter((o) => o.id) // las «carpetas» vienen con id null
    .map((o) => ({ full: `${orgId}/${o.name}`, created: new Date(o.created_at ?? "").getTime() }))
    .filter((o) => photoBelongsToOrg(o.full, orgId))
    .filter((o) => Number.isFinite(o.created) && o.created < cutoff)
    .filter((o) => !referenced.has(o.full))
    .map((o) => o.full);
}

/** Lee todas las filas por cursor estable (`id > último`), no por offset. */
async function getAllRest(url, headers, path, params, fetchImpl, pageSize = PAGE_SIZE) {
  const rows = [];
  let last = null;
  for (;;) {
    const q = new URLSearchParams({ ...params, order: "id.asc", limit: String(pageSize) });
    if (last) q.set("id", `gt.${last}`);
    const res = await fetchImpl(`${url}/rest/v1/${path}?${q}`, { headers });
    if (!res.ok) throw new Error(`Error leyendo ${path}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
    last = page[page.length - 1].id;
  }
}

/** Rutas de `paths` que algún parte referencia AHORA (re-comprobación previa al borrado). */
async function referencedNow(url, headers, paths, fetchImpl) {
  const q = new URLSearchParams({
    select: "photo_path",
    photo_path: `in.(${paths.map((p) => `"${p}"`).join(",")})`,
  });
  const res = await fetchImpl(`${url}/rest/v1/maintenance_tickets?${q}`, { headers });
  if (!res.ok) throw new Error(`Error re-comprobando referencias: ${res.status} ${await res.text()}`);
  return new Set((await res.json()).map((r) => r.photo_path));
}

async function listFolder(url, headers, prefix, fetchImpl, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetchImpl(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: pageSize, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`Error listando ${prefix}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

/**
 * Barrido de fotos huérfanas en todas las organizaciones.
 * @param {string} url
 * @param {Record<string,string>} headers
 * @param {{apply: boolean}} opts
 * @param {typeof fetch} [fetchImpl]
 */
export async function sweepOrphans(url, headers, { apply }, fetchImpl = fetch) {
  const orgs = await getAllRest(url, headers, "organizations", { select: "id" }, fetchImpl);
  const orphans = [];
  for (const { id: orgId } of orgs) {
    const refs = await getAllRest(
      url,
      headers,
      "maintenance_tickets",
      { select: "id,photo_path", org_id: `eq.${orgId}`, photo_path: "not.is.null" },
      fetchImpl,
    );
    const referenced = new Set(refs.map((r) => r.photo_path));
    const objects = await listFolder(url, headers, `${orgId}/`, fetchImpl);
    orphans.push(...findOrphans(orgId, objects, referenced));
  }
  let deleted = 0;
  if (apply) {
    for (let i = 0; i < orphans.length; i += BATCH_SIZE) {
      // Un parte pudo empezar a referenciar la foto después del snapshot.
      const candidates = orphans.slice(i, i + BATCH_SIZE);
      const nowRef = await referencedNow(url, headers, candidates, fetchImpl);
      const batch = candidates.filter((p) => !nowRef.has(p));
      if (batch.length === 0) continue;
      const res = await fetchImpl(`${url}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: batch }),
      });
      if (!res.ok) throw new Error(`Error borrando huérfanos: ${res.status} ${await res.text()}`);
      deleted += (await res.json()).length;
    }
  }
  return { orphans, deleted };
}

function env(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta ${name} en el entorno (.env.local).`);
    process.exit(1);
  }
  return value;
}

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
}

async function main() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const apply = process.argv.includes("--apply");
  const days = argValue("days", DEFAULT_DAYS);

  if (!Number.isFinite(days) || days <= 0) {
    console.error(`--days debe ser un número mayor que 0 (recibido: ${days}).`);
    process.exit(1);
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await fetchClosedWithPhoto(url, headers, cutoff);
  const expired = selectExpiredPhotos(rows, new Date(), days);

  console.log(
    `Partes cerrados hace más de ${days} días con foto: ${rows.length}. A borrar: ${expired.length}.`,
  );
  const skipped = rows.length - expired.length;
  if (skipped > 0) {
    console.log(`Aviso: ${skipped} parte(s) con ruta de foto fuera de su org o mal formada: no se tocan.`);
  }

  for (const row of expired) {
    console.log(` - ${row.id} · ${row.photo_path} · cerrado ${row.closed_at}`);
  }

  if (apply && expired.length > 0) {
    const out = await purgeExpired(url, headers, expired);
    console.log(`Hecho: ${out.deleted} fotos borradas y photo_path vaciado en ${out.cleared} partes.`);
    if (out.notDeleted.length > 0) {
      console.log(
        `Aviso: Storage no confirmó ${out.notDeleted.length} foto(s); su photo_path se conserva: ${out.notDeleted.join(", ")}`,
      );
    }
  }

  const sweep = await sweepOrphans(url, headers, { apply });
  console.log(`Huérfanas (sin parte, > ${ORPHAN_MIN_AGE_HOURS} h): ${sweep.orphans.length}. Borradas: ${sweep.deleted}.`);
  for (const p of sweep.orphans) console.log(` - huérfana ${p}`);
  if (!apply) console.log("Simulación. Repite con --apply para borrar.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
