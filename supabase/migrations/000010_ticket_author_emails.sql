-- Emails de los autores de PARTES DE AVERÍA que el usuario está viendo.
--
-- Igual que handover_author_emails (000007) pero mirando maintenance_tickets:
-- el detalle y la lista de averías muestran quién abrió cada parte, y ese
-- usuario puede no haber escrito ningún relevo, así que la función de relevos
-- devolvía «Autor no disponible».
--
-- Minimización: NO es un directorio. Solo devuelve los ids pedidos que además
-- hayan abierto algún parte en p_org_id, y solo si quien llama pertenece a esa
-- org activa (get_user_org_ids() usa auth.uid()).
--
-- security definer porque necesita leer auth.users; search_path vacío y todo
-- cualificado por esquema. EXECUTE solo para authenticated.

create or replace function public.ticket_author_emails(p_org_id uuid, p_user_ids uuid[])
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
         from public.maintenance_tickets t
        where t.org_id = p_org_id
          and (t.created_by = u.id or t.closed_by = u.id)
     );
$$;

revoke execute on function public.ticket_author_emails(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.ticket_author_emails(uuid, uuid[]) to authenticated;
