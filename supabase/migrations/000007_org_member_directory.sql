-- Directorio de autores de una organización (user_id → email).
--
-- La lista y el detalle de relevos muestran QUIÉN hizo cada relevo. El autor
-- es shift_handovers.created_by (uuid de auth.users) y el cliente no puede leer
-- auth.users. Esta función devuelve solo user_id + email de los miembros de
-- una organización, y solo si quien llama pertenece a ella (y la org está
-- activa: get_user_org_ids() ya descarta suspendidas/archivadas).
--
-- security definer porque necesita leer auth.users; el filtro por
-- get_user_org_ids() (que usa auth.uid()) es lo que la acota. anon no puede
-- ejecutarla. Un autor dado de baja (sin membership) no aparece: la UI muestra
-- «Autor no disponible».

create or replace function public.org_member_directory(p_org_id uuid)
returns table (user_id uuid, email text)
language sql
security definer
stable
set search_path = public
as $$
  select m.user_id, u.email::text
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org_id
     and p_org_id in (select public.get_user_org_ids());
$$;

revoke execute on function public.org_member_directory(uuid) from public, anon;
grant execute on function public.org_member_directory(uuid) to authenticated;
