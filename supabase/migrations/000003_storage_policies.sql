-- Blindbeds Relevo — storage.objects policies for the `ticket-photos` bucket
--
-- The baseline creates the private bucket but no policies. storage.objects has
-- RLS enabled by Supabase, so without these every upload from the app fails.
--
-- Object layout (see buildPhotoPath in src/lib/validation.ts):
--     <org_id>/<file>          exactly one folder level, org_id in lowercase
--
-- Rules, mirroring the table policies of 000001_baseline.sql:
--   read    active member of the org in the path prefix
--   upload  whoever may open a ticket in that org (any active member)
--   delete  admin of that org only
--   update  nobody (no policy): photos are immutable, no move/overwrite/upsert
--   anon, users without membership, suspended orgs: nothing
--
-- "Active member" comes from public.get_user_org_ids(), which already drops
-- suspended/archived organizations and returns nothing when auth.uid() is null.
--
-- The org prefix is compared as TEXT on purpose: casting an attacker-chosen
-- folder name to uuid would raise 22P02 instead of denying with 42501.
--
-- Idempotent (drop policy if exists + create). It does NOT alter, grant on or
-- enable RLS on storage.objects: in Supabase that table belongs to
-- supabase_storage_admin and already has RLS enabled.
--
-- Bucket size and MIME limits are enforced by the Storage API, not by SQL.

drop policy if exists ticket_photos_select_member on storage.objects;
create policy ticket_photos_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-photos'
    and (storage.foldername(name))[1] in (select o::text from public.get_user_org_ids() as o)
  );

drop policy if exists ticket_photos_insert_member on storage.objects;
create policy ticket_photos_insert_member on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-photos'
    -- exactly `<folder>/<file>`: no root-level objects, no nested folders, no empty file name
    and name ~ '^[^/]+/[^/]+$'
    and (storage.foldername(name))[1] in (select o::text from public.get_user_org_ids() as o)
  );

drop policy if exists ticket_photos_delete_admin on storage.objects;
create policy ticket_photos_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-photos'
    and exists (
      select 1
      from public.get_user_org_ids() as o
      where o::text = (storage.foldername(name))[1]
        and public.has_org_role(o, 'admin')
    )
  );
