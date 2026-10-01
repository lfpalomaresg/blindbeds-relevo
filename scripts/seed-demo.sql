-- Seed demo para desarrollo local
-- uso: psql $LOCAL_DB_URL < scripts/seed-demo.sql

insert into public.organizations (id, name, status, created_at)
values ('00000000-0000-0000-0000-000000000001','Hotel Demo Relevo','active',now())
on conflict (id) do nothing;

insert into public.ticket_assets (id, org_id, name, location, qr_code, created_at)
values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Habitación 101','Planta 1','ASSET-101',now()),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Habitación 102','Planta 1','ASSET-102',now()),
  ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Ascensor Principal','Vestíbulo','ASSET-LIFT-1',now()),
  ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Piscina','Exterior','ASSET-POOL',now()),
  ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Restaurante','Planta Baja','ASSET-REST',now())
on conflict (id) do nothing;
