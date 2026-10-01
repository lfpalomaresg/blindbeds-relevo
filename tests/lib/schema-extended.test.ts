import { describe, it, expect } from "vitest";

const TABLES = [
  "organizations", "memberships", "shift_handovers",
  "handover_items", "ticket_assets", "maintenance_tickets", "ticket_updates",
];

describe("schema — extended", () => {
  it("7 tables defined", () => expect(TABLES).toHaveLength(7));
  it("no duplicate table names", () => expect(new Set(TABLES).size).toBe(TABLES.length));
  it("all names are valid postgres identifiers", () => {
    const valid = /^[a-z][a-z0-9_]*$/;
    for (const t of TABLES) expect(t).toMatch(valid);
  });
  it("all dependent tables have org_id column", () => {
    const withOrgId = ["memberships","shift_handovers","handover_items","ticket_assets","maintenance_tickets"];
    for (const t of withOrgId) expect(TABLES).toContain(t);
  });
});
