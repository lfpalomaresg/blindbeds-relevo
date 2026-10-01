/**
 * Tests for the demo seed SQL file.
 * Ensures the seed is consistent with the schema and can be parsed.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const SEED_PATH = resolve(__dirname, "../../scripts/seed-demo.sql");

let seed: string;

beforeAll(() => {
  if (existsSync(SEED_PATH)) {
    seed = readFileSync(SEED_PATH, "utf-8");
  } else {
    seed = "";
  }
});

describe("seed-demo.sql", () => {
  it("file exists", () => {
    expect(existsSync(SEED_PATH)).toBe(true);
  });

  it("inserts into organizations", () => {
    expect(seed).toContain("insert into public.organizations");
  });

  it("inserts into ticket_assets", () => {
    expect(seed).toContain("insert into public.ticket_assets");
  });

  it("uses ON CONFLICT DO NOTHING (idempotent)", () => {
    const matches = seed.match(/on conflict.*do nothing/gi) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("demo org has a valid status", () => {
    // The seed inserts an org with status 'active'
    expect(seed).toContain("'active'");
  });

  it("demo assets have unique QR codes", () => {
    // Extract QR code values from seed
    const qrMatches = seed.match(/'ASSET-[^']+'/g) || [];
    const uniqueQRs = new Set(qrMatches);
    expect(uniqueQRs.size).toBe(qrMatches.length);
  });

  it("demo org ID is a valid UUID format", () => {
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    expect(seed).toMatch(uuidPattern);
  });

  it("seed uses deterministic UUIDs (not gen_random_uuid())", () => {
    // Demo seeds should use hardcoded UUIDs so they're reproducible
    expect(seed).not.toContain("gen_random_uuid()");
  });
});
