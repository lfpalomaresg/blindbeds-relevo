import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

/**
 * Resolución de la organización activa: de aquí sale el org_id con el que la
 * app filtra todas las consultas y firma todos los inserts. Si se equivoca,
 * el usuario opera (o cree operar) en otra organización.
 *
 * Esto prueba SOLO la lógica de cliente (qué consulta y qué devuelve) contra un
 * fake sin RLS. El aislamiento real entre organizaciones (lectura y escritura,
 * por rol) lo prueba tests/db/rls.test.ts sobre Postgres con las policies.
 */
const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.client,
}));

import { getActiveOrgId, getOrganization } from "@/lib/org";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";

const MEMBERSHIPS = [
  { id: "m-other", org_id: ORG_B, user_id: "user-other", role: "admin" },
  { id: "m-me", org_id: ORG_A, user_id: "user-me", role: "staff" },
];
const ORGS = [
  { id: ORG_A, name: "Hotel A", status: "active", created_at: "2026-01-01T00:00:00Z" },
  { id: ORG_B, name: "Hotel B", status: "active", created_at: "2026-01-01T00:00:00Z" },
];

function useFake(options: ConstructorParameters<typeof FakeSupabase>[0]) {
  const fake = new FakeSupabase(options);
  state.client = fake;
  return fake;
}

describe("getActiveOrgId", () => {
  it("sin usuario autenticado devuelve null y no consulta memberships", async () => {
    const fake = useFake({ user: null, tables: { memberships: MEMBERSHIPS } });
    expect(await getActiveOrgId()).toBeNull();
    expect(fake.callsTo("memberships")).toHaveLength(0);
  });

  it("devuelve la organización de la membresía del propio usuario, no la de otro", async () => {
    const fake = useFake({ user: { id: "user-me" }, tables: { memberships: MEMBERSHIPS } });
    expect(await getActiveOrgId()).toBe(ORG_A);
    const [query] = fake.callsTo("memberships", "select");
    expect(query.filters).toEqual([["user_id", "user-me"]]);
  });

  it("sin membresía visible (p. ej. organización suspendida, oculta por RLS) devuelve null", async () => {
    useFake({ user: { id: "user-me" }, tables: { memberships: [] } });
    expect(await getActiveOrgId()).toBeNull();
  });

  it("si la consulta de memberships falla, devuelve null en vez de un org_id parcial", async () => {
    state.client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-me" } }, error: null }) },
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          limit: () => q,
          maybeSingle: async () => ({ data: { org_id: ORG_A }, error: { message: "boom" } }),
        };
        return q;
      },
    };
    expect(await getActiveOrgId()).toBeNull();
  });
});

describe("getOrganization", () => {
  it("carga la organización por el org_id de la membresía", async () => {
    const fake = useFake({ user: { id: "user-me" }, tables: { memberships: MEMBERSHIPS, organizations: ORGS } });
    const org = await getOrganization();
    expect(org).toMatchObject({ id: ORG_A, name: "Hotel A" });
    const [query] = fake.callsTo("organizations", "select");
    expect(query.filters).toEqual([["id", ORG_A]]);
  });

  it("sin organización activa no consulta organizations y devuelve null", async () => {
    const fake = useFake({ user: { id: "user-me" }, tables: { memberships: [], organizations: ORGS } });
    expect(await getOrganization()).toBeNull();
    expect(fake.callsTo("organizations")).toHaveLength(0);
  });

  it("si RLS no deja leer la organización, devuelve null", async () => {
    useFake({ user: { id: "user-me" }, tables: { memberships: MEMBERSHIPS, organizations: [] } });
    expect(await getOrganization()).toBeNull();
  });
});
