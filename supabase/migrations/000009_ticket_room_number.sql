-- Nº de habitación o zona donde está la avería.
--
-- Hasta ahora el parte solo se anclaba a un activo del catálogo
-- (ticket_assets, que exige un QR). En la práctica muchas averías no tienen
-- etiqueta y la referencia útil es la habitación. Nullable para no romper los
-- partes ya creados y porque el activo sigue siendo opcional.
--
-- El tope de 20 caracteres replica LIMITS.roomNumber en src/lib/validation.ts:
-- la app valida antes, la BD no depende de que la app lo haga.

alter table public.maintenance_tickets
  add column if not exists room_number text
  constraint maintenance_tickets_room_number_len
  check (room_number is null or char_length(room_number) <= 20);

comment on column public.maintenance_tickets.room_number is
  'Habitación o zona de la avería (texto libre). Sin nombres de huéspedes ni datos de salud.';
