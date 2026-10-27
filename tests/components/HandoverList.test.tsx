// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { HandoverList } from "@/components/handover/HandoverList";

const ORG = "00000000-0000-0000-0000-00000000000a";
const U1 = "aaaaaaaa-0000-0000-0000-00000000001a";
const U2 = "aaaaaaaa-0000-0000-0000-00000000002a";
const GONE = "aaaaaaaa-0000-0000-0000-0000000000ff";

const HANDOVERS = [
  { id: "h1", org_id: ORG, department: "recepcion", shift_type: "noche", created_by: U1, created_at: "2026-01-02T06:55:00Z" },
  { id: "h2", org_id: ORG, department: "pisos", shift_type: "tarde", created_by: U2, created_at: "2026-01-01T22:00:00Z" },
  { id: "h3", org_id: ORG, department: "recepcion", shift_type: "manana", created_by: GONE, created_at: "2026-01-01T14:00:00Z" },
];

const DIRECTORY = [
  { user_id: U1, email: "staff.alfa@example.test" },
  { user_id: U2, email: "supervisor.alfa@example.test" },
];

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}) {
  state.fake = new FakeSupabase({
    tables: { shift_handovers: HANDOVERS },
    rpcResults: { org_member_directory: { data: DIRECTORY, error: null } },
    ...options,
  });
  render(<HandoverList orgId={ORG} />);
  return state.fake;
}

afterEach(cleanup);

describe("HandoverList", () => {
  it("lista los relevos de la organización con departamento, turno, autor y hora", async () => {
    const fake = setup();
    const first = within(await screen.findByRole("article", { name: /relevo recepción · noche/i }));
    expect(first.getByText("staff.alfa@example.test")).toBeTruthy();
    expect(first.getByText(/\d{1,2}:\d{2}/)).toBeTruthy();

    const second = within(screen.getByRole("article", { name: /relevo pisos · tarde/i }));
    expect(second.getByText("supervisor.alfa@example.test")).toBeTruthy();

    const [query] = fake.callsTo("shift_handovers", "select");
    expect(query.filters).toEqual([["org_id", ORG]]);
    expect(fake.rpcCalls).toEqual([{ fn: "org_member_directory", args: { p_org_id: ORG } }]);
  });

  it("si el autor ya no está en la organización lo dice en vez de enseñar un uuid", async () => {
    setup();
    const card = within(await screen.findByRole("article", { name: /relevo recepción · mañana/i }));
    expect(card.getByText(/autor no disponible/i)).toBeTruthy();
    expect(card.queryByText(GONE)).toBeNull();
  });

  it("cada relevo enlaza a su detalle", async () => {
    setup();
    const card = within(await screen.findByRole("article", { name: /relevo pisos · tarde/i }));
    expect(card.getByRole("link").getAttribute("href")).toBe("/handover/h2");
  });

  it("el filtro por departamento consulta solo ese departamento", async () => {
    const fake = setup();
    await screen.findByRole("article", { name: /relevo pisos · tarde/i });
    fireEvent.change(screen.getByLabelText(/departamento/i), { target: { value: "recepcion" } });
    await waitFor(() => expect(screen.queryByRole("article", { name: /relevo pisos/i })).toBeNull());
    expect(screen.getAllByRole("article")).toHaveLength(2);
    const last = fake.callsTo("shift_handovers", "select").at(-1)!;
    expect(last.filters).toEqual(expect.arrayContaining([["org_id", ORG], ["department", "recepcion"]]));
  });

  it("sin relevos muestra un estado vacío", async () => {
    setup({ tables: { shift_handovers: [] } });
    await screen.findByText(/no hay relevos/i);
  });

  it("si falla el directorio de autores, la lista se muestra igual", async () => {
    setup({ rpcResults: { org_member_directory: { data: null, error: { message: "boom" } } } });
    const card = within(await screen.findByRole("article", { name: /relevo recepción · noche/i }));
    expect(card.getByText(/autor no disponible/i)).toBeTruthy();
  });
});
