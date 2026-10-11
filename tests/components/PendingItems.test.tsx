// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { PendingItems } from "@/components/handover/PendingItems";

const ORG = "00000000-0000-0000-0000-00000000000a";
const ITEMS = [
  { id: "i1", org_id: ORG, resolved: false, block: "pendientes", content: "Revisar minibar 101", created_at: "2026-01-01T10:00:00Z" },
  { id: "i2", org_id: ORG, resolved: false, block: "incidencias", content: "Fuga en 204", created_at: "2026-01-01T11:00:00Z" },
];

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}) {
  state.fake = new FakeSupabase({ tables: { handover_items: ITEMS }, ...options });
  render(<PendingItems orgId={ORG} />);
  return state.fake;
}

afterEach(cleanup);

describe("PendingItems", () => {
  it("muestra estado de carga y luego los pendientes con su bloque", async () => {
    setup();
    expect(screen.getByText(/cargando/i)).toBeTruthy();
    await screen.findByText(/Revisar minibar 101/);
    expect(screen.getByText(/Fuga en 204/)).toBeTruthy();
    expect(screen.getByText(/^Pendientes$/)).toBeTruthy();
    expect(screen.getByText(/^Incidencias$/)).toBeTruthy();
  });

  it("muestra el estado vacío cuando no hay pendientes", async () => {
    setup({ tables: { handover_items: [] } });
    await screen.findByText(/no hay pendientes/i);
  });

  it("consulta solo los no resueltos de la organización", async () => {
    const fake = setup();
    await screen.findByText(/Revisar minibar 101/);
    const [query] = fake.callsTo("handover_items", "select");
    expect(query.filters).toEqual(expect.arrayContaining([["org_id", ORG], ["resolved", false]]));
  });

  it("«Resolver» marca el item con el usuario y lo quita de la lista", async () => {
    const fake = setup({ user: { id: "user-sup" } });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await waitFor(() => expect(screen.queryByText(/Revisar minibar 101/)).toBeNull());
    const [update] = fake.callsTo("handover_items", "update");
    expect(update.payload).toMatchObject({ resolved: true, resolved_by: "user-sup", resolved_at: expect.any(String) });
    expect(update.filters).toEqual([["id", "i1"]]);
    expect(screen.getByText(/Fuga en 204/)).toBeTruthy();
  });

  it("sin sesión no intenta resolver nada", async () => {
    const fake = setup({ user: null });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await waitFor(() => expect(fake.auth.getUser).toHaveBeenCalled());
    expect(fake.callsTo("handover_items", "update")).toHaveLength(0);
    expect(screen.getByText(/Revisar minibar 101/)).toBeTruthy();
  });
});
