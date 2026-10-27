// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { HandoverDetail } from "@/components/handover/HandoverDetail";

const ORG = "00000000-0000-0000-0000-00000000000a";
const U1 = "aaaaaaaa-0000-0000-0000-00000000001a";

const HANDOVER = { id: "h1", org_id: ORG, department: "pisos", shift_type: "tarde", created_by: U1, created_at: "2026-01-02T22:00:00Z" };
const ITEMS = [
  { id: "i1", handover_id: "h1", org_id: ORG, block: "pendientes", content: "Revisar minibar 101", resolved: false, created_at: "2026-01-02T22:00:00Z" },
  { id: "i2", handover_id: "h1", org_id: ORG, block: "avisos", content: "Grupo a las 16h", resolved: true, created_at: "2026-01-02T22:00:00Z" },
  { id: "i3", handover_id: "otro", org_id: ORG, block: "avisos", content: "De otro relevo", resolved: false, created_at: "2026-01-02T22:00:00Z" },
];

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}) {
  state.fake = new FakeSupabase({
    tables: { shift_handovers: [HANDOVER], handover_items: ITEMS },
    rpcResults: { handover_author_emails: { data: [{ user_id: U1, email: "staff.alfa@example.test" }], error: null } },
    ...options,
  });
  render(<HandoverDetail orgId={ORG} handoverId="h1" />);
  return state.fake;
}

afterEach(cleanup);

describe("HandoverDetail", () => {
  it("muestra cabecera (departamento, turno, autor) y los ítems del relevo por bloque", async () => {
    const fake = setup();
    await screen.findByRole("heading", { name: /pisos · tarde/i });
    expect(screen.getByText("staff.alfa@example.test")).toBeTruthy();

    const pendientes = within(screen.getByRole("region", { name: /pendientes/i }));
    expect(pendientes.getByText("Revisar minibar 101")).toBeTruthy();
    const avisos = within(screen.getByRole("region", { name: /avisos/i }));
    expect(avisos.getByText("Grupo a las 16h")).toBeTruthy();
    expect(avisos.getByText(/resuelto/i)).toBeTruthy();
    expect(screen.queryByText("De otro relevo")).toBeNull();

    expect(fake.rpcCalls).toEqual([{ fn: "handover_author_emails", args: { p_org_id: ORG, p_user_ids: [U1] } }]);
    const [h] = fake.callsTo("shift_handovers", "select");
    expect(h.filters).toEqual(expect.arrayContaining([["id", "h1"], ["org_id", ORG]]));
    const [i] = fake.callsTo("handover_items", "select");
    expect(i.filters).toEqual(expect.arrayContaining([["handover_id", "h1"], ["org_id", ORG]]));
  });

  it("los bloques sin ítems no se muestran", async () => {
    setup();
    await screen.findByRole("heading", { name: /pisos · tarde/i });
    expect(screen.queryByRole("region", { name: /vips/i })).toBeNull();
  });

  it("un relevo inexistente o de otra organización (RLS lo oculta) muestra «no encontrado»", async () => {
    setup({ tables: { shift_handovers: [], handover_items: [] } });
    await screen.findByText(/relevo no encontrado/i);
    expect(screen.getByRole("link", { name: /volver/i }).getAttribute("href")).toBe("/handover");
  });
});
