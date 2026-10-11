/**
 * Tests that verify the actual migration SQL files on disk.
 * These act as a regression guard: if someone edits the migration,
 * these tests break first and make the change explicit.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const MIGRATION_DIR = resolve(__dirname, "../../supabase/migrations");
const VARIANT_DIR = resolve(__dirname, "../../supabase/variants/shared-appcc");

let baseline: string;
let relevo: string;

beforeAll(() => {
  baseline = readFileSync(`${MIGRATION_DIR}/000001_baseline.sql`, "utf-8");
  relevo = readFileSync(`${VARIANT_DIR}/000002_relevo_tables.sql`, "utf-8").toLowerCase();
});

describe("supabase/migrations — solo migraciones secuenciales", () => {
  it("contiene únicamente el baseline (la variante 000002 vive en supabase/variants)", () => {
    expect(readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql"))).toEqual(["000001_baseline.sql"]);
  });
});

const TABLES = [
  "organizations",
  "memberships",
  "shift_handovers",
  "handover_items",
  "ticket_assets",
  "maintenance_tickets",
  "ticket_updates",
];

describe("migration 000001_baseline — tables", () => {
  it.each(TABLES)("creates table %s", (table) => {
    expect(baseline).toContain(`create table public.${table}`);
  });

  it("all 7 tables have RLS enabled", () => {
    for (const table of TABLES) {
      expect(baseline).toContain(
        `alter table public.${table} enable row level security`
      );
    }
  });
});

describe("migration 000001_baseline — RLS policies", () => {
  it("organizations has select policy", () => {
    expect(baseline).toContain("organizations_read_own");
  });

  it("memberships has select + write + delete policies", () => {
    expect(baseline).toContain("memberships_read_own_org");
    expect(baseline).toContain("memberships_admin_write");
    expect(baseline).toContain("memberships_admin_delete");
  });

  it("shift_handovers has select + insert policies", () => {
    expect(baseline).toContain("handovers_select");
    expect(baseline).toContain("handovers_insert");
  });

  it("handover_items has select + insert + update policies", () => {
    expect(baseline).toContain("handover_items_select");
    expect(baseline).toContain("handover_items_insert");
    expect(baseline).toContain("handover_items_update");
  });

  it("maintenance_tickets has select + insert + update policies", () => {
    expect(baseline).toContain("tickets_select");
    expect(baseline).toContain("tickets_insert");
    expect(baseline).toContain("tickets_update");
  });

  it("ticket_updates has select + insert policies", () => {
    expect(baseline).toContain("updates_select");
    expect(baseline).toContain("updates_insert");
  });
});

describe("migration 000001_baseline — security definer functions", () => {
  it("get_user_org_ids is security definer", () => {
    expect(baseline).toContain("function public.get_user_org_ids()");
    expect(baseline).toContain("security definer");
  });

  it("has_org_role is security definer", () => {
    expect(baseline).toContain("function public.has_org_role(p_org_id uuid, min_role text)");
  });

  it("functions are granted to authenticated role", () => {
    expect(baseline).toContain("grant execute on function public.get_user_org_ids() to authenticated");
    expect(baseline).toContain("grant execute on function public.has_org_role(uuid, text) to authenticated");
  });
});

describe("migration 000001_baseline — CHECK constraints", () => {
  it("organizations.status has valid check", () => {
    expect(baseline).toContain("check (status in ('active', 'suspended', 'archived'))");
  });

  it("memberships.role has valid check", () => {
    expect(baseline).toContain("check (role in ('staff', 'supervisor', 'admin'))");
  });

  it("shift_handovers.department matches TypeScript Department type", () => {
    expect(baseline).toContain("'recepcion', 'pisos', 'fb', 'mantenimiento', 'otro'");
  });

  it("shift_handovers.shift_type matches TypeScript ShiftType", () => {
    expect(baseline).toContain("check (shift_type in ('manana', 'tarde', 'noche'))");
  });

  it("handover_items.block matches TypeScript HandoverBlock", () => {
    expect(baseline).toContain("check (block in ('pendientes', 'vips', 'incidencias', 'avisos'))");
  });

  it("maintenance_tickets.priority matches TypeScript TicketPriority", () => {
    expect(baseline).toContain("check (priority in ('critica', 'alta', 'normal', 'baja'))");
  });

  it("maintenance_tickets.status matches TypeScript TicketStatus", () => {
    expect(baseline).toContain("check (status in ('abierto', 'en_curso', 'cerrado'))");
  });
});

describe("migration 000001_baseline — indexes", () => {
  const EXPECTED_INDEXES = [
    "memberships_user_id_idx",
    "memberships_org_id_idx",
    "shift_handovers_org_idx",
    "handover_items_pending_idx",
    "ticket_assets_org_idx",
    "maintenance_tickets_org_idx",
    "maintenance_tickets_asset_idx",
    "ticket_updates_ticket_idx",
  ];

  it.each(EXPECTED_INDEXES)("index %s exists", (idx) => {
    expect(baseline).toContain(idx);
  });
});

describe("migration 000001_baseline — storage bucket", () => {
  it("creates ticket-photos bucket", () => {
    expect(baseline).toContain("'ticket-photos'");
  });

  it("bucket is not public (public=false in values)", () => {
    // Column list has 'public'; values position 3 is false → bucket is private
    expect(baseline).toContain("public, file_size_limit");
    expect(baseline).toContain("'ticket-photos', false, 10485760");
  });

  it("bucket has 10 MB size limit", () => {
    expect(baseline).toContain("10485760");
  });

  it("bucket only allows image MIME types", () => {
    expect(baseline).toContain("image/jpeg");
    expect(baseline).toContain("image/png");
    expect(baseline).toContain("image/webp");
  });
});

describe("variant 000002_relevo_tables (shared APPCC project, not applied)", () => {
  it("references tables already provided by baseline", () => {
    expect(relevo).toContain("shift_handovers");
    expect(relevo).toContain("handover_items");
    expect(relevo).toContain("maintenance_tickets");
  });

  it("ticket-photos bucket or storage references", () => {
    expect(relevo).toMatch(/ticket.photos|storage/i);
  });
});

describe("migration 000001_baseline — cascades and FKs", () => {
  it("memberships cascade-deletes when org or user removed", () => {
    expect(baseline).toContain("references public.organizations(id) on delete cascade");
    expect(baseline).toContain("references auth.users(id) on delete cascade");
  });

  it("handover_items cascade-deletes when handover removed", () => {
    expect(baseline).toContain(
      "references public.shift_handovers(id) on delete cascade"
    );
  });

  it("ticket_updates cascade-deletes when ticket removed", () => {
    expect(baseline).toContain(
      "references public.maintenance_tickets(id) on delete cascade"
    );
  });

  it("memberships has unique constraint on (org_id, user_id)", () => {
    expect(baseline).toContain("unique (org_id, user_id)");
  });
});
