// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { ItemDeletionLog } from "@/components/handover/ItemDeletionLog";

const ORG = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ADMIN = "user-admin";
const STAFF = "user-staff";
const MEMBERSHIPS = [
  { org_id: ORG, user_id: ADMIN, role: "admin" },
  { org_id: ORG, user_id: STAFF, role: "staff" },
  { org_id: ORG_B, user_id: ADMIN, role: "staff" },
];
const LOG_ROWS = [
  {
    deleted_at: "2026-11-09T21:15:00Z",
    deleted_by_email: "admin.alfa@example.test",
    handover_id: "h-1",
    handover_created_at: "2026-11-09T14:00:00Z",
    department: "recepcion",
    shift_type: "tarde",
    block: "vips",
  },
  {
    deleted_at: "2026-11-01T08:00:00Z",
    deleted_by_email: null,
    handover_id: "h-0",
    handover_created_at: null,
    department: null,
    shift_type: null,
    block: "avisos",
  },
];

type LogResult = { data: unknown; error: { message: string; code?: string } | null };

function setup(userId: string | null, log: LogResult = { data: LOG_ROWS, error: null }) {
  state.fake = new FakeSupabase({
    user: userId ? { id: userId } : null,
    tables: { memberships: MEMBERSHIPS },
    rpcResults: { handover_item_deletion_log: log },
  });
  render(<ItemDeletionLog orgId={ORG} />);
  return state.fake;
}

afterEach(cleanup);

describe("ItemDeletionLog", () => {
  it("al admin le muestra quién borró, cuándo y de qué relevo", async () => {
    const fake = setup(ADMIN);
    const section = await screen.findByRole("region", { name: /rastro de borrados/i });
    const rows = await within(section).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("admin.alfa@example.test");
    expect(rows[0].textContent).toMatch(/vips/i);
    expect(rows[0].textContent).toMatch(/recepción/i);
    expect(rows[0].textContent).toMatch(/tarde/i);
    expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/handover/h-1");
    expect(fake.rpcCalls).toEqual([{ fn: "handover_item_deletion_log", args: { p_org_id: ORG } }]);
  });

  it("un asiento cuyo relevo ya se purgó o cuyo autor ya no existe sale sin enlace y con autor desconocido", async () => {
    setup(ADMIN);
    const section = await screen.findByRole("region", { name: /rastro de borrados/i });
    const rows = await within(section).findAllByRole("listitem");
    expect(within(rows[1]).queryByRole("link")).toBeNull();
    expect(rows[1].textContent).toMatch(/relevo ya eliminado/i);
    expect(rows[1].textContent).toMatch(/desconocido/i);
  });

  it("nunca pinta un campo de contenido aunque el servidor lo enviara", async () => {
    setup(ADMIN, { data: [{ ...LOG_ROWS[0], content: "Texto con dato sensible ficticio" }], error: null });
    const section = await screen.findByRole("region", { name: /rastro de borrados/i });
    await within(section).findAllByRole("listitem");
    expect(section.textContent).not.toContain("Texto con dato sensible ficticio");
  });

  it("a quien no es admin no le muestra nada ni pide el rastro", async () => {
    const fake = setup(STAFF);
    await waitFor(() => expect(fake.callsTo("memberships", "select")).toHaveLength(1));
    expect(screen.queryByRole("region", { name: /rastro de borrados/i })).toBeNull();
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("sin sesión no muestra nada ni pide el rastro", async () => {
    const fake = setup(null);
    await waitFor(() => expect(fake.auth.getUser).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: /rastro de borrados/i })).toBeNull();
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("al cambiar a un hotel donde no es admin, los datos del anterior desaparecen en el acto", async () => {
    state.fake = new FakeSupabase({
      user: { id: ADMIN },
      tables: { memberships: MEMBERSHIPS },
      rpcResults: { handover_item_deletion_log: { data: LOG_ROWS, error: null } },
    });
    const view = render(<ItemDeletionLog orgId={ORG} />);
    await screen.findAllByRole("listitem");
    view.rerender(<ItemDeletionLog orgId={ORG_B} />);
    // Sin esperar: en el mismo render ya no está nada del hotel anterior.
    expect(screen.queryByRole("region", { name: /rastro de borrados/i })).toBeNull();
    expect(screen.queryByText(/admin\.alfa@example\.test/)).toBeNull();
    // Y tras comprobar el rol en el hotel nuevo (staff) sigue sin nada ni pide su rastro.
    await waitFor(() => expect(state.fake.callsTo("memberships", "select")).toHaveLength(2));
    expect(screen.queryByRole("region", { name: /rastro de borrados/i })).toBeNull();
    expect(state.fake.rpcCalls).toEqual([{ fn: "handover_item_deletion_log", args: { p_org_id: ORG } }]);
  });

  it("sin borrados lo dice", async () => {
    setup(ADMIN, { data: [], error: null });
    const section = await screen.findByRole("region", { name: /rastro de borrados/i });
    await within(section).findByText(/no hay borrados/i);
  });

  it("si el servidor falla, avisa sin mostrar su texto", async () => {
    setup(ADMIN, { data: null, error: { code: "42883", message: "function public.handover_item_deletion_log(uuid) does not exist" } });
    const section = await screen.findByRole("region", { name: /rastro de borrados/i });
    const alert = await within(section).findByRole("alert");
    expect(alert.textContent).toMatch(/no se pudo cargar/i);
    expect(alert.textContent).not.toMatch(/function|does not exist/);
  });
});
