import { createBrowserClient } from "@/lib/supabase/client";
import type { Organization } from "@/types";

export async function getActiveOrgId(): Promise<string | null> {
  const supabase = createBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.org_id as string;
}

export async function getOrganization(): Promise<Organization | null> {
  const orgId = await getActiveOrgId();
  if (!orgId) return null;

  const supabase = createBrowserClient();
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  return data as Organization | null;
}