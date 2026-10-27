// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";
import { LIMITS } from "@/lib/validation";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { HandoverForm } from "@/components/handover/HandoverForm";

const ORG = "00000000-0000-0000-0000-00000000000a";

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}) {
  state.fake = new FakeSupabase(options);
  render(<HandoverForm orgId={ORG} />);
  return state.fake;
}

const submit = () => fireEvent.submit(screen.getByRole("button", { name: /registrar relevo/i }).closest("form")!);
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("HandoverForm", () => {
  it("muestra los 4 bloques, departamento y turno", () => {
    setup();
    for (const label of [/^pendientes/i, /^vips/i, /^incidencias/i, /^avisos/i]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText(/departamento/i)).toBeTruthy();
    expect(screen.getByLabelText("Turno")).toBeTruthy();
  });

  it("limita cada bloque al máximo de caracteres permitido", () => {
    setup();
    const textarea = screen.getByLabelText(/^pendientes/i) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(LIMITS.handoverContent);
  });

  it("lista los pendientes sin resolver de la organización al cargar", async () => {
    setup({
      tables: {
        handover_items: [
          { id: "i1", org_id: ORG, resolved: false, block: "pendientes", content: "Revisar minibar 101", created_at: "2026-01-01T10:00:00Z" },
          { id: "i2", org_id: "otra", resolved: false, block: "avisos", content: "No debe verse", created_at: "2026-01-01T10:00:00Z" },
        ],
      },
    });
    await screen.findByText(/Revisar minibar 101/);
    expect(screen.queryByText(/No debe verse/)).toBeNull();
    expect(screen.getByText(/Pendientes sin resolver \(1\)/)).toBeTruthy();
  });

  it("no envía nada si todos los bloques están vacíos o solo tienen espacios", async () => {
    const fake = setup();
    type(/^avisos/i, "   \n ");
    submit();
    await screen.findByText(/al menos un bloque/i);
    expect(fake.callsTo("shift_handovers", "insert")).toHaveLength(0);
    expect(fake.callsTo("handover_items", "insert")).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("falla cerrado sin sesión: error visible y ningún insert", async () => {
    const fake = setup({ user: null });
    type(/^pendientes/i, "Algo pendiente");
    submit();
    await screen.findByText(/no hay sesión activa/i);
    expect(fake.callsTo("shift_handovers", "insert")).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("registra el relevo en UNA llamada atómica (create_handover) con solo los bloques con contenido, recortados", async () => {
    const fake = setup({ user: { id: "user-staff" } });
    type(/departamento/i, "pisos");
    type("Turno", "noche");
    type(/^pendientes/i, "  Revisar minibar 101  ");
    type(/^avisos/i, "Grupo a las 16h");
    submit();

    await screen.findByText(/relevo registrado/i);

    expect(fake.rpcCalls).toEqual([
      {
        fn: "create_handover",
        args: {
          p_org_id: ORG,
          p_department: "pisos",
          p_shift_type: "noche",
          p_items: [
            { block: "pendientes", content: "Revisar minibar 101" },
            { block: "avisos", content: "Grupo a las 16h" },
          ],
        },
      },
    ]);
    // Nada de inserts sueltos: si el segundo fallara quedaría una cabecera huérfana.
    expect(fake.callsTo("shift_handovers", "insert")).toHaveLength(0);
    expect(fake.callsTo("handover_items", "insert")).toHaveLength(0);
    expect(screen.getByText(/noche/i)).toBeTruthy();
  });

  it("muestra el error de la base de datos si create_handover falla y no da el relevo por registrado", async () => {
    const fake = setup({ rpcResults: { create_handover: { data: null, error: { message: "new row violates row-level security policy" } } } });
    type(/^incidencias/i, "Fuga en 204");
    submit();
    await screen.findByText(/row-level security/i);
    expect(screen.queryByText(/relevo registrado/i)).toBeNull();
    expect(fake.callsTo("shift_handovers", "insert")).toHaveLength(0);
    expect(fake.callsTo("handover_items", "insert")).toHaveLength(0);
  });

  it("al registrar no garantiza que el siguiente turno lo verá: explica que quedan pendientes hasta resolverse", async () => {
    setup();
    type(/^avisos/i, "Cambio de proveedor de toallas");
    submit();
    await screen.findByText(/relevo registrado/i);
    expect(screen.queryByText(/lo verá/i)).toBeNull();
    expect(screen.getByText(/pendientes en el panel de inicio hasta que alguien los resuelva/i)).toBeTruthy();
  });

  it("tras registrar, «Nuevo relevo» vuelve al formulario limpio", async () => {
    setup();
    type(/^vips/i, "Familia Ejemplo");
    submit();
    await screen.findByText(/relevo registrado/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo relevo/i }));
    await waitFor(() => expect((screen.getByLabelText(/^vips/i) as HTMLTextAreaElement).value).toBe(""));
  });

  it("cada campo de texto libre lleva el aviso de minimización asociado (aria-describedby)", () => {
    setup();
    const notice = /Sin nombres de huéspedes ni datos de salud: usa el nº de habitación\./;
    expect(screen.getAllByText(notice)).toHaveLength(4);
    for (const label of [/^pendientes/i, /^vips/i, /^incidencias/i, /^avisos/i]) {
      const field = screen.getByLabelText(label);
      const ids = (field.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toMatch(notice);
    }
  });
});
