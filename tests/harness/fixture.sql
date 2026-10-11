-- Fixture sintético para los tests RLS. Se carga como superusuario (bypass RLS).
-- Dos organizaciones activas (alfa, beta) y una suspendida (gamma).
-- UUIDs deterministas: 0000...0a = org alfa, 0b = beta, 0c = gamma.
-- Usuarios: 1a/2a/3a = staff/supervisor/admin de alfa, 1b = staff de beta,
--           1c = admin de gamma (org suspendida), 99 = sin membership.

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000001a', 'staff.alfa@example.test'),
  ('aaaaaaaa-0000-0000-0000-00000000002a', 'supervisor.alfa@example.test'),
  ('aaaaaaaa-0000-0000-0000-00000000003a', 'admin.alfa@example.test'),
  ('bbbbbbbb-0000-0000-0000-00000000001b', 'staff.beta@example.test'),
  ('cccccccc-0000-0000-0000-00000000001c', 'admin.gamma@example.test'),
  ('99999999-0000-0000-0000-000000000099', 'outsider@example.test');

insert into public.organizations (id, name, status) values
  ('00000000-0000-0000-0000-00000000000a', 'Hotel Alfa (test)', 'active'),
  ('00000000-0000-0000-0000-00000000000b', 'Hotel Beta (test)', 'active'),
  ('00000000-0000-0000-0000-00000000000c', 'Hotel Gamma (test)', 'suspended');

insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000001a', 'staff'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000002a', 'supervisor'),
  ('00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000003a', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000001b', 'staff'),
  ('00000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-00000000001c', 'admin');

-- Handovers: uno por org activa, con un item pendiente cada uno.
insert into public.shift_handovers (id, org_id, department, shift_type, created_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'recepcion', 'manana', 'aaaaaaaa-0000-0000-0000-00000000001a'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'pisos', 'tarde', 'bbbbbbbb-0000-0000-0000-00000000001b');

insert into public.handover_items (id, handover_id, org_id, block, content) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'pendientes', 'Revisar minibar 101'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'avisos', 'Grupo llega a las 16h');

-- Activos y partes de avería.
insert into public.ticket_assets (id, org_id, name, location, qr_code) values
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Habitación 101', 'Planta 1', 'TEST-ALFA-101'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Ascensor', 'Hall', 'TEST-BETA-LIFT');

insert into public.maintenance_tickets (id, org_id, asset_id, title, priority, status, created_by) values
  ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'Grifo gotea', 'normal', 'abierto', 'aaaaaaaa-0000-0000-0000-00000000001a'),
  ('40000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'Ascensor parado', 'critica', 'abierto', 'bbbbbbbb-0000-0000-0000-00000000001b');

insert into public.ticket_updates (id, ticket_id, status_from, status_to, created_by) values
  ('50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', null, 'abierto', 'aaaaaaaa-0000-0000-0000-00000000001a'),
  ('50000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', null, 'abierto', 'bbbbbbbb-0000-0000-0000-00000000001b');
