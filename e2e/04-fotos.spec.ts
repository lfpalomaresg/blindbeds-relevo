import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localSupabaseEnv } from "./local-guard";
import { USERS } from "./support";

// MVP §6: a ticket photo is readable by signed URL inside its hotel and denied to
// any other hotel. Runs against the real local Storage API (the DB harness can
// only check the policies on Postgres, not what Storage does with them).
const dotenvPath = path.join(__dirname, "..", ".env.local");
const env = localSupabaseEnv(process.env, existsSync(dotenvPath) ? readFileSync(dotenvPath, "utf8") : "");
const BUCKET = "ticket-photos";
// Organizations from supabase/seed.sql (fictional).
const MIRADOR_ORG = "b0000000-0000-4000-8000-000000000001";

/** 1×1 JPEG. */
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A client signed in as a seeded user, without going through the mailbox. */
async function signedInAs(email: string): Promise<SupabaseClient> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: otpError } = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (otpError) throw otpError;
  return client;
}

test.describe("fotos de partes en Storage", () => {
  const objectPath = `${MIRADOR_ORG}/e2e-${Date.now()}.jpg`;

  test.beforeAll(async () => {
    const mantenimiento = await signedInAs(USERS.mantenimiento);
    const { error } = await mantenimiento.storage.from(BUCKET).upload(objectPath, JPEG_1PX, { contentType: "image/jpeg" });
    expect(error).toBeNull();
  });

  test("un miembro del hotel abre la foto por URL firmada", async () => {
    const recepcion = await signedInAs(USERS.recepcion);
    const { data, error } = await recepcion.storage.from(BUCKET).createSignedUrl(objectPath, 60);
    expect(error).toBeNull();
    const res = await fetch(data!.signedUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");
  });

  test("otro hotel no obtiene URL firmada ni descarga la foto", async () => {
    const costa = await signedInAs(USERS.costa);
    const signed = await costa.storage.from(BUCKET).createSignedUrl(objectPath, 60);
    expect(signed.data).toBeNull();
    expect(signed.error).not.toBeNull();
    const download = await costa.storage.from(BUCKET).download(objectPath);
    expect(download.data).toBeNull();
    expect(download.error).not.toBeNull();
  });

  test("otro hotel no puede subir a la carpeta de un hotel ajeno", async () => {
    const costa = await signedInAs(USERS.costa);
    const { error } = await costa.storage
      .from(BUCKET)
      .upload(`${MIRADOR_ORG}/intruso-${Date.now()}.jpg`, JPEG_1PX, { contentType: "image/jpeg" });
    expect(error).not.toBeNull();
  });

  test("una foto de más de 10 MB se rechaza en el propio Storage", async () => {
    const mantenimiento = await signedInAs(USERS.mantenimiento);
    const big = Buffer.concat([JPEG_1PX, Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const { error } = await mantenimiento.storage
      .from(BUCKET)
      .upload(`${MIRADOR_ORG}/grande-${Date.now()}.jpg`, big, { contentType: "image/jpeg" });
    expect(error).not.toBeNull();
  });
});
