-- Emails de los AUTORES de relevos que el usuario está viendo.
--
-- La lista y el detalle de relevos muestran quién hizo cada relevo. El autor
-- es shift_handovers.created_by (uuid de auth.users) y el cliente no puede leer
-- auth.users. Minimización: esto NO es un directorio de la organización.
-- Devuelve user_id + email solo de los ids pedidos (p_user_ids: los autores de
-- la lista visible) que además hayan escrito algún relevo en p_org_id, y solo
-- si quien llama pertenece a p_org_id y la org está activa
-- (get_user_org_ids() descarta suspendidas/archivadas y usa auth.uid()).
--
-- security definer porque necesita leer auth.users. search_path vacío: todo
-- va cualificado por esquema, así nadie puede colar objetos por el path.
-- EXECUTE solo para authenticated (ni PUBLIC, ni anon, ni service_role).

create or replace function public.handover_author_emails(p_org_id uuid, p_user_ids uuid[])
returns table (user_id uuid, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select u.id, u.email::pg_catalog.text
    from auth.users u
   where u.id = any (p_user_ids)
     and p_org_id in (select o from public.get_user_org_ids() as o)
     and exists (
       select 1
         from public.shift_handovers h
        where h.org_id = p_org_id
          and h.created_by = u.id
     );
$$;

revoke execute on function public.handover_author_emails(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.handover_author_emails(uuid, uuid[]) to authenticated;
