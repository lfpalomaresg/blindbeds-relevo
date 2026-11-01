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

/**
 * Filtra las filas que toca purgar. Puro para poder probarlo sin red.
 * @template {{photo_path?: string|null, status?: string, closed_at?: string|null}} T
 * @param {T[]} rows
 * @param {Date} [now]
 * @param {number} [days]
 * @returns {T[]}
 */
export function selectExpiredPhotos(rows, now = new Date(), days = DEFAULT_DAYS) {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return rows.filter((row) => {
    if (!row.photo_path) return false;
    if (row.status !== "cerrado" || !row.closed_at) return false;
    const closed = new Date(row.closed_at);
    if (Number.isNaN(closed.getTime())) return false;
    return closed < cutoff;
  });
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

  const res = await fetch(
    `${url}/rest/v1/maintenance_tickets?select=id,photo_path,status,closed_at&status=eq.cerrado&photo_path=not.is.null`,
    { headers },
  );
  if (!res.ok) {
    console.error(`Error leyendo partes: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const rows = await res.json();
  const expired = selectExpiredPhotos(rows, new Date(), days);

  console.log(
    `Partes cerrados con foto: ${rows.length}. Con más de ${days} días: ${expired.length}.`,
  );

  if (expired.length === 0) return;

  for (const row of expired) {
    console.log(` - ${row.id} · ${row.photo_path} · cerrado ${row.closed_at}`);
  }

  if (!apply) {
    console.log("Simulación. Repite con --apply para borrar las fotos.");
    return;
  }

  const paths = expired.map((row) => row.photo_path);
  const del = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!del.ok) {
    console.error(`Error borrando objetos: ${del.status} ${await del.text()}`);
    process.exit(1);
  }

  const ids = expired.map((row) => row.id).join(",");
  const patch = await fetch(`${url}/rest/v1/maintenance_tickets?id=in.(${ids})`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ photo_path: null }),
  });
  if (!patch.ok) {
    console.error(
      `Objetos borrados pero fallo al vaciar photo_path: ${patch.status} ${await patch.text()}`,
    );
    process.exit(1);
  }

  console.log(`Hecho: ${paths.length} fotos borradas y photo_path vaciado en ${expired.length} partes.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
