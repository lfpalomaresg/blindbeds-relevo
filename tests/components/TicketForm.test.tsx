// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";
import { LIMITS } from "@/lib/validation";

const state = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabase,
  nextScan: "TEST-ALFA-101",
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

// El escáner real necesita cámara; aquí es un botón que "escanea" el código configurado.
vi.mock("@/components/tickets/QRScanner", () => ({
  QRScanner: ({ onScan }: { onScan: (code: string) => void }) => (
    <button type="button" onClick={() => onScan(state.nextScan)}>simular escaneo</button>
  ),
}));

import { TicketForm } from "@/components/tickets/TicketForm";

const ORG = "00000000-0000-0000-0000-00000000000a";
const ASSET_ID = "30000000-0000-0000-0000-00000000000a";

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}, props: Partial<{ onCreated: () => void }> = {}) {
  state.fake = new FakeSupabase({
    tables: { ticket_assets: [{ id: ASSET_ID, org_id: ORG, qr_code: "TEST-ALFA-101", name: "Habitación 101" }] },
    ...options,
  });
  render(<TicketForm orgId={ORG} {...props} />);
  return state.fake;
}

const submit = () => fireEvent.submit(screen.getByRole("button", { name: /crear parte/i }).closest("form")!);
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pickPhoto = (file: File) => fireEvent.change(screen.getByLabelText(/foto/i), { target: { files: [file] } });
const makeFile = (size: number, type: string, name = "foto.jpg") => {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.nextScan = "TEST-ALFA-101";
});
afterEach(cleanup);

describe("TicketForm", () => {
  it("limita título y descripción a los máximos permitidos", () => {
    setup();
    expect((screen.getByLabelText(/título/i) as HTMLInputElement).maxLength).toBe(LIMITS.ticketTitle);
    expect((screen.getByLabelText(/descripción/i) as HTMLTextAreaElement).maxLength).toBe(LIMITS.ticketDescription);
  });

  it("rechaza un título vacío sin llamar a la base de datos", async () => {
    const fake = setup();
    type(/título/i, "   ");
    submit();
    await screen.findByText(/título es obligatorio/i);
    expect(fake.callsTo("maintenance_tickets", "insert")).toHaveLength(0);
  });

  it("falla cerrado sin sesión", async () => {
    const fake = setup({ user: null });
    type(/título/i, "Grifo gotea");
    submit();
    await screen.findByText(/no hay sesión activa/i);
    expect(fake.callsTo("maintenance_tickets", "insert")).toHaveLength(0);
    expect(fake.uploads).toHaveLength(0);
  });

  it("crea un parte mínimo con los campos normalizados", async () => {
    const onCreated = vi.fn();
    const fake = setup({ user: { id: "user-staff" } }, { onCreated });
    type(/título/i, "  Grifo gotea  ");
    type(/prioridad/i, "alta");
    submit();
    await screen.findByText(/parte de avería creado/i);
    const [insert] = fake.callsTo("maintenance_tickets", "insert");
    expect(insert.payload).toEqual({
      org_id: ORG,
      asset_id: null,
      title: "Grifo gotea",
      description: null,
      priority: "alta",
      status: "abierto",
      photo_path: null,
      created_by: "user-staff",
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("rechaza una foto de más de 10 MB antes de subir nada", async () => {
    const fake = setup();
    type(/título/i, "Grifo gotea");
    pickPhoto(makeFile(LIMITS.photoBytes + 1, "image/jpeg"));
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/10 MB/);
    expect(fake.uploads).toHaveLength(0);
    expect(fake.callsTo("maintenance_tickets", "insert")).toHaveLength(0);
  });

  it("rechaza formatos que el bucket no admite", async () => {
    const fake = setup();
    type(/título/i, "Grifo gotea");
    pickPhoto(makeFile(1024, "image/gif", "anim.gif"));
    submit();
    await screen.findByText(/formato no admitido/i);
    expect(fake.uploads).toHaveLength(0);
  });

  it("sube la foto a <org>/<uuid>.<ext> con la extensión del MIME, no del nombre", async () => {
    const fake = setup();
    type(/título/i, "Grifo gotea");
    pickPhoto(makeFile(2048, "image/png", "captura.exe"));
    submit();
    await screen.findByText(/parte de avería creado/i);

    expect(fake.uploads).toHaveLength(1);
    const { bucket, path, options } = fake.uploads[0];
    expect(bucket).toBe("ticket-photos");
    expect(path).toMatch(new RegExp(`^${ORG}/[0-9a-f-]{36}\\.png$`));
    expect(options).toMatchObject({ contentType: "image/png" });

    const [insert] = fake.callsTo("maintenance_tickets", "insert");
    expect((insert.payload as { photo_path: string }).photo_path).toBe(path);
  });

  it("si la subida falla, muestra el error y no crea el parte", async () => {
    const fake = setup({ uploadError: { message: "Bucket not found" } });
    type(/título/i, "Grifo gotea");
    pickPhoto(makeFile(2048, "image/jpeg"));
    submit();
    await screen.findByText(/Bucket not found/);
    expect(fake.callsTo("maintenance_tickets", "insert")).toHaveLength(0);
  });

  it("al escanear un QR resuelve el activo por qr_code y envía su id, no el texto del QR", async () => {
    const fake = setup();
    fireEvent.click(screen.getByRole("button", { name: /escanear qr/i }));
    fireEvent.click(screen.getByRole("button", { name: /simular escaneo/i }));
    await screen.findByText(/Habitación 101/);

    type(/título/i, "Grifo gotea");
    submit();
    await screen.findByText(/parte de avería creado/i);
    const [insert] = fake.callsTo("maintenance_tickets", "insert");
    expect((insert.payload as { asset_id: string }).asset_id).toBe(ASSET_ID);

    const lookup = fake.callsTo("ticket_assets", "select")[0];
    expect(lookup.filters).toEqual(expect.arrayContaining([["org_id", ORG], ["qr_code", "TEST-ALFA-101"]]));
  });

  it("un QR que no corresponde a ningún activo de la organización se rechaza", async () => {
    state.nextScan = "QR-DESCONOCIDO";
    const fake = setup();
    fireEvent.click(screen.getByRole("button", { name: /escanear qr/i }));
    fireEvent.click(screen.getByRole("button", { name: /simular escaneo/i }));
    await screen.findByText(/activo no reconocido/i);
    type(/título/i, "Grifo gotea");
    submit();
    await screen.findByText(/parte de avería creado/i);
    const [insert] = fake.callsTo("maintenance_tickets", "insert");
    expect((insert.payload as { asset_id: unknown }).asset_id).toBeNull();
  });

  it("muestra el error de la base de datos si el insert falla", async () => {
    setup({ insertErrors: { maintenance_tickets: { message: "new row violates row-level security policy" } } });
    type(/título/i, "Grifo gotea");
    submit();
    await screen.findByText(/row-level security/i);
  });
});
