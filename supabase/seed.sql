-- Seed LOCAL de Relevo (solo `supabase start` / `supabase db reset`; nunca producción).
-- Hotel ficticio y usuarios de prueba en example.com (dominio reservado, no recibe correo).
-- Entrar: escribir uno de estos correos en /login y abrir el enlace en el buzón local
-- (http://127.0.0.1:54324).
--   direccion@example.com     admin
--   gobernanta@example.com    supervisor
--   recepcion@example.com     staff
--   mantenimiento@example.com staff
-- Segundo hotel (Hotel Demo Costa) con su propio usuario, para ver que RLS no mezcla datos:
--   costa@example.com         admin
-- Usuario sin hotel (sin membership), para el mensaje de «sin organización»:
--   sin-hotel@example.com

-- ─── Usuarios de Auth (los campos de token van a '' y no NULL: GoTrue falla con NULL) ───
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '',
       now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', '', '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'direccion@example.com'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'gobernanta@example.com'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'recepcion@example.com'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'mantenimiento@example.com'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'costa@example.com'),
  -- Dado de alta pero sin hotel: debe ver «No tienes una organización activa».
  ('a0000000-0000-4000-8000-000000000006'::uuid, 'sin-hotel@example.com')
) as u(id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email like '%@example.com';

-- ─── Hoteles y miembros ───
insert into public.organizations (id, name) values
  ('b0000000-0000-4000-8000-000000000001', 'Hotel Demo Mirador'),
  ('b0000000-0000-4000-8000-000000000002', 'Hotel Demo Costa');

insert into public.memberships (org_id, user_id, role) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'admin'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'supervisor'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'staff'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'staff'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', 'admin');

-- ─── Relevos de turno (Mirador) ───
insert into public.shift_handovers (id, org_id, department, shift_type, created_by, read_by, read_at, created_at) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'recepcion', 'noche',
   'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', now() - interval '20 hours', now() - interval '22 hours'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'recepcion', 'manana',
   'a0000000-0000-4000-8000-000000000003', null, null, now() - interval '6 hours'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'pisos', 'manana',
   'a0000000-0000-4000-8000-000000000002', null, null, now() - interval '5 hours');

insert into public.handover_items (handover_id, org_id, block, content, resolved, resolved_by, resolved_at, created_at) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'pendientes',
   'Hab. 214: el cliente pide factura a nombre de empresa (datos en el sobre de recepción)', true,
   'a0000000-0000-4000-8000-000000000003', now() - interval '8 hours', now() - interval '22 hours'),
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'incidencias',
   'Ruido en la planta 3 a las 02:10; avisado el huésped de la 309', false, null, null, now() - interval '22 hours'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'pendientes',
   'Taxi al aeropuerto para la 105 a las 17:30 (confirmar a las 16:00)', false, null, null, now() - interval '6 hours'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'vips',
   'Llegada VIP 401 a las 15:00: botella de cava y carta de bienvenida', false, null, null, now() - interval '6 hours'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'avisos',
   'Corte de agua programado en la planta 2 mañana de 10:00 a 11:00', false, null, null, now() - interval '6 hours'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'pendientes',
   'Faltan 12 juegos de toallas de baño: pedido a lavandería sin confirmar', false, null, null, now() - interval '5 hours'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'incidencias',
   'Hab. 318 con mancha en la moqueta: bloqueada hasta limpieza', false, null, null, now() - interval '5 hours');

-- ─── Equipos con QR y partes de avería (Mirador) ───
insert into public.ticket_assets (id, org_id, name, location, qr_code) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Aire acondicionado hab. 214', 'Planta 2', 'MIR-AC-214'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Ascensor principal', 'Vestíbulo', 'MIR-ASC-01'),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Cafetera del desayuno', 'Restaurante', 'MIR-CAF-01'),
  -- Los códigos que usa docs/31_GUION_PRUEBA_USUARIOS.md (y los recorridos de e2e/).
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'Habitación 101', 'Planta 1', 'ASSET-101'),
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'Piscina', 'Exterior', 'ASSET-POOL');

insert into public.maintenance_tickets (id, org_id, asset_id, title, description, priority, status, created_by, assigned_to, closed_by, closed_at, created_at) values
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'El aire no enfría', 'El huésped dice que sale aire caliente desde anoche', 'alta', 'en_curso',
   'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', null, null, now() - interval '18 hours'),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002',
   'Ascensor parado en la planta 4', 'Se ha quedado con las puertas abiertas; sin nadie dentro', 'critica', 'abierto',
   'a0000000-0000-4000-8000-000000000002', null, null, null, now() - interval '40 minutes'),
  ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003',
   'Cafetera pierde agua', null, 'normal', 'cerrado',
   'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004',
   'a0000000-0000-4000-8000-000000000004', now() - interval '2 days', now() - interval '3 days'),
  ('e0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', null,
   'Bombilla fundida en el pasillo de la planta 1', null, 'baja', 'abierto',
   'a0000000-0000-4000-8000-000000000003', null, null, null, now() - interval '3 hours');

insert into public.ticket_updates (ticket_id, status_from, status_to, comment, created_by, created_at) values
  ('e0000000-0000-4000-8000-000000000001', 'abierto', 'en_curso', 'Revisando el compresor', 'a0000000-0000-4000-8000-000000000004', now() - interval '16 hours'),
  ('e0000000-0000-4000-8000-000000000003', 'abierto', 'en_curso', null, 'a0000000-0000-4000-8000-000000000004', now() - interval '3 days'),
  ('e0000000-0000-4000-8000-000000000003', 'en_curso', 'cerrado', 'Cambiada la junta', 'a0000000-0000-4000-8000-000000000004', now() - interval '2 days');

-- ─── Hotel Demo Costa: un relevo y un parte que los usuarios del Mirador NO deben ver ───
insert into public.shift_handovers (id, org_id, department, shift_type, created_by, created_at) values
  ('c0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000002', 'recepcion', 'tarde',
   'a0000000-0000-4000-8000-000000000005', now() - interval '2 hours');

insert into public.handover_items (handover_id, org_id, block, content) values
  ('c0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000002', 'pendientes',
   'SOLO COSTA: si esto se ve desde el Mirador, la RLS está rota');

insert into public.maintenance_tickets (org_id, title, priority, status, created_by) values
  ('b0000000-0000-4000-8000-000000000002', 'SOLO COSTA: piscina sin cloro', 'alta', 'abierto', 'a0000000-0000-4000-8000-000000000005');
