// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { TicketList } from "@/components/tickets/TicketList";

const ORG = "00000000-0000-0000-0000-00000000000a";
const TICKETS = [
  { id: "t1", org_id: ORG, title: "Grifo gotea", description: "Baño 101", priority: "normal", status: "abierto", created_at: "2026-01-01T10:00:00Z" },
  { id: "t2", org_id: ORG, title: "Luz fundida", priority: "baja", status: "en_curso", created_at: "2026-01-01T11:00:00Z" },
  { id: "t3", org_id: ORG, title: "Ascensor", priority: "critica", status: "cerrado", created_at: "2026-01-01T12:00:00Z" },
];

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}) {
  state.fake = new FakeSupabase({ tables: { maintenance_tickets: TICKETS }, ...options });
  render(<TicketList orgId={ORG} />);
  return state.fake;
}

afterEach(cleanup);

describe("TicketList", () => {
  it("por defecto muestra solo los partes abiertos de la organización", async () => {
    const fake = setup();
    await screen.findByText("Grifo gotea");
    expect(screen.queryByText("Luz fundida")).toBeNull();
    expect(screen.queryByText("Ascensor")).toBeNull();
    const [query] = fake.callsTo("maintenance_tickets", "select");
    expect(query.filters).toEqual(expect.arrayContaining([["org_id", ORG], ["status", "abierto"]]));
  });

  it("el filtro «Todas» quita el filtro de estado y muestra todos", async () => {
    setup();
    await screen.findByText("Grifo gotea");
    fireEvent.click(screen.getByRole("button", { name: /^todas$/i }));
    await screen.findByText("Ascensor");
    expect(screen.getByText("Luz fundida")).toBeTruthy();
  });

  it("muestra el estado vacío con el nombre del filtro", async () => {
    setup({ tables: { maintenance_tickets: [] } });
    await screen.findByText(/no hay partes abiertos/i);
  });

  it("«En curso» actualiza el estado y deja traza en ticket_updates", async () => {
    const fake = setup({ user: { id: "user-mant" } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^en curso$/i }));
    await waitFor(() => expect(fake.callsTo("ticket_updates", "insert")).toHaveLength(1));

    const [update] = fake.callsTo("maintenance_tickets", "update");
    expect(update.payload).toEqual({ status: "en_curso" });
    expect(update.filters).toEqual([["id", "t1"]]);

    const [trace] = fake.callsTo("ticket_updates", "insert");
    expect(trace.payload).toMatchObject({ ticket_id: "t1", status_to: "en_curso", created_by: "user-mant" });
  });

  it("«Cerrar» registra quién y cuándo cierra", async () => {
    const fake = setup({ user: { id: "user-mant" } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^cerrar$/i }));
    await waitFor(() => expect(fake.callsTo("maintenance_tickets", "update")).toHaveLength(1));
    const [update] = fake.callsTo("maintenance_tickets", "update");
    expect(update.payload).toMatchObject({ status: "cerrado", closed_by: "user-mant", closed_at: expect.any(String) });
  });

  it("sin sesión no cambia estados", async () => {
    const fake = setup({ user: null });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^cerrar$/i }));
    await waitFor(() => expect(fake.auth.getUser).toHaveBeenCalled());
    expect(fake.callsTo("maintenance_tickets", "update")).toHaveLength(0);
    expect(fake.callsTo("ticket_updates", "insert")).toHaveLength(0);
  });

  it("los partes cerrados no ofrecen acciones", async () => {
    setup();
    await screen.findByText("Grifo gotea");
    fireEvent.click(within(screen.getByRole("group", { name: /filtrar por estado/i })).getByRole("button", { name: /^cerrado$/i }));
    const card = within(await screen.findByRole("article", { name: "Ascensor" }));
    expect(card.queryByRole("button")).toBeNull();
  });
});
