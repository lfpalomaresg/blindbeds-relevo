// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

// MUST de minimización: el admin borra un bloque con un dato sensible (000016).
describe("HandoverDetail — borrado de un bloque por el admin", () => {
  const ME = "user-1"; // usuario por defecto del FakeSupabase
  const asRole = (role: string) => ({
    tables: {
      shift_handovers: [HANDOVER],
      handover_items: ITEMS,
      memberships: [{ org_id: ORG, user_id: ME, role }],
    },
  });

  it("staff y supervisor no ven el botón de borrar", async () => {
    for (const role of ["staff", "supervisor"]) {
      setup(asRole(role));
      await screen.findByRole("heading", { name: /pisos · tarde/i });
      expect(screen.queryByRole("button", { name: /borrar/i })).toBeNull();
      cleanup();
    }
  });

  it("el admin borra un bloque tras confirmar: llama a delete_handover_item y desaparece", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fake = setup({ ...asRole("admin"), rpcResults: { delete_handover_item: { data: true, error: null } } });
    const pendientes = within(await screen.findByRole("region", { name: /pendientes/i }));
    fireEvent.click(pendientes.getByRole("button", { name: /borrar/i }));
    await waitFor(() => expect(screen.queryByText("Revisar minibar 101")).toBeNull());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fake.rpcCalls).toContainEqual({ fn: "delete_handover_item", args: { p_item_id: "i1" } });
    expect(screen.getByText("Grupo a las 16h")).toBeTruthy();
    const [m] = fake.callsTo("memberships", "select");
    expect(m.filters).toEqual(expect.arrayContaining([["org_id", ORG], ["user_id", ME]]));
  });

  it("si el admin cancela la confirmación no se borra nada", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fake = setup(asRole("admin"));
    const pendientes = within(await screen.findByRole("region", { name: /pendientes/i }));
    fireEvent.click(pendientes.getByRole("button", { name: /borrar/i }));
    expect(fake.rpcCalls.some((c) => c.fn === "delete_handover_item")).toBe(false);
    expect(screen.getByText("Revisar minibar 101")).toBeTruthy();
  });

  it("si el servidor no lo borra (false o error) se avisa y el bloque sigue", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup({ ...asRole("admin"), rpcResults: { delete_handover_item: { data: false, error: null } } });
    const pendientes = within(await screen.findByRole("region", { name: /pendientes/i }));
    fireEvent.click(pendientes.getByRole("button", { name: /borrar/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no se pudo borrar/i);
    expect(screen.getByText("Revisar minibar 101")).toBeTruthy();
  });

  // Un doble toque mandaba dos RPC: la segunda devuelve false (el bloque ya no
  // existe) y salía «No se pudo borrar» aunque el bloque sí se había borrado.
  it("un doble toque en «Borrar» envía una sola RPC y no da un aviso falso", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fake = setup({ ...asRole("admin"), rpcResults: { delete_handover_item: { data: true, error: null } } });
    const pendientes = within(await screen.findByRole("region", { name: /pendientes/i }));
    const button = pendientes.getByRole("button", { name: /borrar/i });
    // Los dos clics en el mismo act: sin re-render entre ellos el botón aún no
    // está desactivado, así que la que frena el segundo es la guarda del componente.
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(screen.queryByText("Revisar minibar 101")).toBeNull());
    expect(fake.rpcCalls.filter((c) => c.fn === "delete_handover_item")).toHaveLength(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mientras se borra, el botón de ese bloque está desactivado y el de otro no", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fake = setup(asRole("admin"));
    const pendientes = within(await screen.findByRole("region", { name: /pendientes/i }));
    const avisos = within(screen.getByRole("region", { name: /avisos/i }));
    let finish: (value: { data: unknown; error: null }) => void = () => {};
    vi.spyOn(fake, "rpc").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(pendientes.getByRole("button", { name: /borrar/i }));
    await waitFor(() => expect(pendientes.getByRole("button", { name: /borrar/i }).hasAttribute("disabled")).toBe(true));
    expect(avisos.getByRole("button", { name: /borrar/i }).hasAttribute("disabled")).toBe(false);
    await act(async () => finish({ data: true, error: null }));
    await waitFor(() => expect(screen.queryByText("Revisar minibar 101")).toBeNull());
  });

  it("si la llamada falla por red, avisa y el botón vuelve a funcionar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fake = setup(asRole("admin"));
    const pendientes = within(await screen.findByRole("region", { name: /pendientes/i }));
    const rpc = vi.spyOn(fake, "rpc").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(pendientes.getByRole("button", { name: /borrar/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no se pudo borrar/i);
    expect(alert.textContent).not.toMatch(/failed|fetch/i);
    expect(screen.getByText("Revisar minibar 101")).toBeTruthy();
    const button = pendientes.getByRole("button", { name: /borrar/i });
    expect(button.hasAttribute("disabled")).toBe(false);
    // Reintento real: la guarda se liberó y el segundo intento sí borra.
    rpc.mockResolvedValueOnce({ data: true, error: null });
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText("Revisar minibar 101")).toBeNull());
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
