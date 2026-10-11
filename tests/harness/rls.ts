/**
 * Utilidades para ejecutar SQL "como si fuera" un usuario de Supabase.
 *
 * Supabase ejecuta las consultas de PostgREST con `set role authenticated`
 * (o `anon`) y los claims del JWT en `request.jwt.claims`. Aquí hacemos lo
 * mismo dentro de una transacción que SIEMPRE se revierte, así cada test parte
 * del mismo estado y las escrituras permitidas por RLS no contaminan al resto.
 */
import type { Client, QueryResult, QueryResultRow } from "pg";

export type DbRole = "anon" | "authenticated" | "service_role";

export interface Actor {
  role: DbRole;
  /** UUID del usuario (auth.users.id). Vacío para anon. */
  userId?: string;
}

export const ANON: Actor = { role: "anon" };

export function asUser(userId: string): Actor {
  return { role: "authenticated", userId };
}

/** Código SQLSTATE que Postgres devuelve al violar una policy RLS. */
export const RLS_VIOLATION = "42501";

export async function runAs<T>(
  client: Client,
  actor: Actor,
  fn: (q: <R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<R>>) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    const claims = actor.userId
      ? JSON.stringify({ sub: actor.userId, role: actor.role })
      : JSON.stringify({ role: actor.role });
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor.userId ?? ""]);
    await client.query(`set local role ${actor.role}`);
    return await fn((text, values) => client.query(text, values));
  } finally {
    await client.query("rollback");
  }
}

/** Devuelve el número de filas visibles para el actor en una tabla. */
export async function countAs(client: Client, actor: Actor, table: string, where = "true"): Promise<number> {
  return runAs(client, actor, async (q) => {
    const r = await q<{ n: string }>(`select count(*)::text as n from public.${table} where ${where}`);
    return parseInt(r.rows[0].n, 10);
  });
}

/** Ejecuta un statement como actor y devuelve el SQLSTATE si falla, o null si tuvo éxito. */
export async function errorCodeAs(
  client: Client,
  actor: Actor,
  text: string,
  values: unknown[] = [],
): Promise<string | null> {
  return runAs(client, actor, async (q) => {
    try {
      await q(text, values);
      return null;
    } catch (err) {
      return (err as { code?: string }).code ?? "unknown";
    }
  });
}

/** Ejecuta un statement como actor y devuelve cuántas filas afectó (0 = RLS lo filtró). */
export async function rowCountAs(
  client: Client,
  actor: Actor,
  text: string,
  values: unknown[] = [],
): Promise<number> {
  return runAs(client, actor, async (q) => {
    const r = await q(text, values);
    return r.rowCount ?? 0;
  });
}
