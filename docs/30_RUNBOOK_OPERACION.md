# Runbook de operación diaria en un hotel

Para el operador que da soporte a un hotel que ya usa Relevo. La puesta en
marcha (crear el proyecto Supabase, aplicar esquema, Vercel, primer admin) está
en [20_ACTIVACION_SUPABASE.md](20_ACTIVACION_SUPABASE.md) y no se repite aquí.

Cada comportamiento se apoya en el código tal y como está en `main`
(commit `32474bc`). Cuando algo **no existe todavía**, se dice. Las citas son
`fichero:línea`.

> **Estado a 2026-10-15:** nada se ha desplegado ni aplicado a ningún Supabase.
> Este runbook describe lo que hará el código cuando se active. Los tres
> «Pendiente conocido» de [20_ACTIVACION_SUPABASE.md](20_ACTIVACION_SUPABASE.md)
> (políticas de storage, FK entre organizaciones, escrituras no atómicas)
> siguen abiertos y afectan a varias secciones de abajo.

---

## 0. Mapa rápido

| Pantalla | Ruta | Quién | Código |
|---|---|---|---|
| Acceso por enlace mágico | `/login` | cualquiera | `src/components/auth/LoginForm.tsx:18-21` |
| Panel: pendientes + partes | `/dashboard` | miembro de una org activa | `src/app/dashboard/page.tsx:44-56` |
| Nuevo relevo | `/handover/new` | miembro | `src/components/handover/HandoverForm.tsx` |
| Nuevo parte de avería | `/tickets/new` | miembro | `src/components/tickets/TicketForm.tsx` |

Todas las rutas salvo login, callbacks de auth, `manifest.json`, `sw.js` e
iconos exigen sesión (`src/lib/auth-paths.ts:7-16`, `src/proxy.ts:11-50`).

**No existe todavía** ninguna pantalla de administración: ni usuarios, ni
roles, ni activos, ni histórico de relevos, ni detalle de un parte.

---

## 1. Altas, bajas y roles de usuario

### Modelo

- Un usuario pertenece a una organización (hotel) mediante una fila en
  `memberships` con `role` = `staff`, `supervisor` o `admin`
  (`supabase/migrations/000001_baseline.sql:12-19`).
- Jerarquía `staff < supervisor < admin` (`000001_baseline.sql:45-53`).
- **Lo que el rol cambia hoy:** solo `admin` puede dar de alta/baja miembros
  (`000001_baseline.sql:153-157`) y gestionar activos con QR
  (`000001_baseline.sql:181-183`). **`supervisor` no tiene ningún permiso
  adicional sobre `staff`**: ninguna política pide `'supervisor'`.
- Cualquier miembro puede crear relevos y partes, marcar pendientes como
  resueltos y cambiar el estado de cualquier parte de su hotel
  (`000001_baseline.sql:159-194`). Un técnico y un recepcionista tienen, en la
  práctica, los mismos permisos.
- Si la organización está `suspended` o `archived`, sus miembros dejan de ver
  todo (`000001_baseline.sql:35`) y el panel muestra «No tienes una
  organización activa. Contacta con el operador.» (`src/app/dashboard/page.tsx:11`).

### Alta de un usuario (sin UI: por SQL)

**No existen todavía** invitaciones ni pantalla de alta.

> **Procedimiento pendiente de validar. No usarlo en un hotel hasta que pase
> la comprobación final (paso 6) de
> [20_ACTIVACION_SUPABASE.md](20_ACTIVACION_SUPABASE.md).** El paso 1 depende
> del inicio de sesión por enlace mágico, que nunca se ha ejecutado contra un
> Supabase real. Hay un riesgo concreto: el enlace vuelve a la raíz del sitio
> (`emailRedirectTo: window.location.origin`, `LoginForm.tsx:20`) y no a
> `/auth/callback`, que es la ruta que canjea el código por la sesión
> (`src/app/auth/callback/route.ts:35`). La raíz no es pública
> (`src/lib/auth-paths.ts:7-13`), así que el proxy podría devolver al empleado
> a `/login` antes de crear la sesión (`src/proxy.ts:48-50`). Ver §5,
> «Problemas de acceso».

**Quién puede hacer cada cosa.** Hay dos autoridades distintas y no deben
confundirse:

- **Operador del proyecto Supabase** (el equipo que mantiene Relevo): tiene
  acceso al dashboard y al SQL Editor, o a `psql` con la contraseña de la base
  de datos. Desde ahí **RLS no se aplica**: puede leer y modificar cualquier
  hotel. **Nunca se da este acceso a personal del hotel.**
- **`admin` de la aplicación** (fila de `memberships` con `role = 'admin'`): es
  un permiso dentro de Relevo, sujeto a RLS, que solo le deja insertar o borrar
  memberships de su propio hotel (`000001_baseline.sql:153-157`). No le da
  acceso al dashboard ni al SQL Editor. Hoy **no hay pantalla** donde un admin
  pueda usar ese permiso; además no puede buscar el `user_id` de un email
  porque no tiene acceso a `auth.users`. En la práctica, toda alta la hace el
  operador.

Procedimiento (lo ejecuta el operador):

1. El empleado abre `/login`, escribe su email y pulsa «Acceder». Supabase le
   envía el enlace mágico (`LoginForm.tsx:18-21`). Cuando el inicio de sesión
   funcione, el usuario quedará registrado en `auth.users` (ver el aviso de
   arriba). Antes del paso 3, el operador comprueba que esa fila existe:
   `select id, email from auth.users where email = '<email-del-empleado>';`
   Si no devuelve nada, parar: el inicio de sesión no ha funcionado y la
   inserción de abajo no añadiría ninguna fila.
2. Ya con sesión, verá «No tienes una organización activa» porque aún no tiene
   membership (`src/lib/org.ts:9-17`, `src/app/dashboard/page.tsx:11`). Es lo esperado.
3. El operador inserta la membership desde el SQL Editor del proyecto:

   ```sql
   insert into public.memberships (org_id, user_id, role)
   select '<org_id-del-hotel>', id, 'staff'
   from auth.users where email = '<email-del-empleado>';
   ```

4. El empleado recarga `/dashboard` y ya ve el nombre del hotel
   (`src/app/dashboard/page.tsx:16`).

`unique (org_id, user_id)` impide duplicar la alta (`000001_baseline.sql:18`).

### Cambiar el rol

No hay política `update` sobre `memberships` (solo `insert` y `delete`,
`000001_baseline.sql:153-157`). Desde el cliente no se puede cambiar un rol; con
`service_role` o en el SQL Editor (que salta RLS):

```sql
update public.memberships set role = 'supervisor'
where org_id = '<org_id>' and user_id = (select id from auth.users where email = '<email>');
```

### Baja de un usuario

```sql
delete from public.memberships
where org_id = '<org_id>' and user_id = (select id from auth.users where email = '<email>');
```

- Un admin no puede borrarse a sí mismo por RLS (`000001_baseline.sql:157`).
- La baja corta el acceso a los datos en la siguiente consulta; la sesión del
  navegador sigue abierta hasta que caduque, pero RLS ya no le devuelve filas.
  Lo que ya esté en la caché del service worker de su dispositivo sigue ahí:
  si el dispositivo es de la empresa, borrar los datos del sitio (§5, riesgo de
  exposición entre usuarios).
- **No borrar el usuario de `auth.users`** si tiene relevos o partes:
  `created_by` referencia `auth.users` sin `on delete`
  (`000001_baseline.sql:66`, `:113`, `:129`) y el borrado fallará. Basta con
  quitar la membership.

### Usuario en dos hoteles

`getActiveOrgId()` coge **una** membership cualquiera (`limit(1)` sin orden,
`src/lib/org.ts:9-14`). **No existe todavía** selector de hotel. Un usuario con
dos memberships puede ver uno u otro de forma no determinista. Hasta que exista
selector: una cuenta (email) por hotel.

---

## 2. Relevo de turno

### Qué hace el empleado

1. Panel → «Relevo de turno» (`src/app/dashboard/page.tsx:21-30`).
2. Elige departamento (Recepción, Pisos, F&B / Cocina, Mantenimiento, Otro) y
   turno (Mañana, Tarde, Noche) (`src/types/index.ts:81-93`). Por defecto:
   Recepción / Mañana (`HandoverForm.tsx:22-23`); **no se recuerda** la última
   elección.
3. Arriba ve hasta **10** pendientes sin resolver del hotel
   (`HandoverForm.tsx:30-43`, `.limit(10)` en la línea 39), de **todos** los
   departamentos: no se filtra por departamento.
4. Rellena uno o más de los cuatro bloques: Pendientes, VIPs, Incidencias,
   Avisos (`src/types/index.ts:95-100`). Máximo 2000 caracteres por bloque; si todos
   están vacíos: «Escribe al menos un bloque antes de registrar el relevo.»
   (`src/lib/validation.ts:62-84`).
5. «Registrar relevo» → se crea el relevo y una fila por bloque escrito
   (`HandoverForm.tsx:69-98`). Pantalla «Relevo registrado» (`:104-127`).

### Qué ve el turno entrante

- En el panel, sección «Pendientes sin resolver»: **todos** los bloques no
  resueltos del hotel, de cualquier tipo (también VIPs y Avisos), más recientes
  primero (`src/components/handover/PendingItems.tsx:17-31`).
- Botón «Resolver» en cada uno: lo marca resuelto con autor y hora
  (`PendingItems.tsx:33-43`). Desaparece para todos.

### Lo que no existe todavía

- Histórico de relevos ni lectura de un relevo completo: solo se ven los
  bloques **no resueltos**. Lo resuelto no se puede consultar desde la app
  (sí por SQL en `handover_items` con `resolved = true`).
- «Leído por»: las columnas `read_by`/`read_at` existen
  (`000001_baseline.sql:67-68`) pero ningún código las escribe y no hay
  política `update` sobre `shift_handovers`.
- Deshacer un «Resolver»: no hay botón. Por SQL:
  `update handover_items set resolved = false, resolved_by = null, resolved_at = null where id = '<id>';`
- Editar o borrar un relevo enviado: no hay UI ni política `delete`.
- Notificaciones (email/push) al siguiente turno: no existen; el texto «El
  siguiente turno lo verá al entrar» (`HandoverForm.tsx:114`) significa que lo
  verá cuando abra el panel.

### Incidencias típicas

| Síntoma | Causa en el código | Qué hacer |
|---|---|---|
| Error tras pulsar «Registrar relevo» y el relevo «a medias» | El relevo se inserta primero y los bloques después (`HandoverForm.tsx:69-98`); si falla el segundo paso queda un relevo sin bloques | Pedir que lo repita. Limpiar huérfanos: `delete from shift_handovers h where not exists (select 1 from handover_items i where i.handover_id = h.id);` |
| Pulsé «Resolver» pero vuelve a salir | El error del `update` se ignora y la fila se quita solo en pantalla (`PendingItems.tsx:37-42`) | Recargar. Si reaparece, revisar sesión/membership (§5) |

---

## 3. Partes de avería con foto

### Qué hace el empleado

1. Panel → «Parte de avería» (`src/app/dashboard/page.tsx:32-41`).
2. Opcional: «Escanear QR del activo». Se busca el texto del QR en
   `ticket_assets.qr_code` del hotel (`TicketForm.tsx:35-51`). Si no existe:
   «Activo no reconocido. Vuelve a escanear el QR o crea el parte sin activo.»
3. Título (obligatorio, ≤120), descripción (≤2000), prioridad Crítica / Alta /
   Normal / Baja, por defecto Normal (`validation.ts:109-137`,
   `TicketForm.tsx:26`).
4. Foto: JPEG, PNG o WebP, ≤10 MB; en móvil abre la cámara trasera
   (`TicketForm.tsx:213-222`, `validation.ts:148-160`).
5. «Crear parte de avería» → sube la foto a `ticket-photos/<org_id>/<uuid>.<ext>`
   y luego inserta el parte en estado `abierto` (`TicketForm.tsx:78-103`).

**Foto obligatoria u opcional:** la pantalla dice «La foto es obligatoria»
(`src/app/tickets/new/page.tsx:16`) pero el código la trata como **opcional**
(`TicketForm.tsx:63`, `:80`): un parte sin foto se crea. Decisión de producto
pendiente (ver notas de sesión 2026-10-11).

**«Mantenimiento ha sido notificado»** (`TicketForm.tsx:123`): **no se envía
ninguna notificación**. Mantenimiento lo ve cuando abre el panel.

### Seguimiento de partes (técnico)

- Panel → «Partes de avería activos»: filtro por estado, por defecto
  «Abierto» (`src/components/tickets/TicketList.tsx:15`, `:70-84`).
- Botones «En curso» (solo si está abierto) y «Cerrar»
  (`TicketList.tsx:116-135`). Cerrar guarda quién y cuándo y deja traza en
  `ticket_updates` (`TicketList.tsx:36-56`).
- La tarjeta muestra título, descripción, estado, prioridad y fecha
  (`TicketList.tsx:92-114`).

### Lo que no existe todavía

- **Ver la foto** de un parte: `photo_path` se guarda (`TicketForm.tsx:101`)
  pero ningún componente la muestra. Tampoco se muestra el activo.
- Asignar un parte a un técnico: la columna `assigned_to` existe
  (`000001_baseline.sql:114`) y nadie la usa.
- Comentarios: `ticket_updates.comment` existe (`000001_baseline.sql:128`) sin
  UI; `status_from` no se rellena (`TicketList.tsx:48-52`).
- Reabrir un parte cerrado: no hay botón (`TicketList.tsx:116`).
- Alta de activos y generación/impresión de QR: no hay UI. Los activos los da
  de alta un admin por SQL (`000001_baseline.sql:181-183`); el QR debe
  contener exactamente el texto de `qr_code` (ej. `ASSET-101` en
  `scripts/seed-demo.sql:10`).
- Histórico por activo: hay índice (`000001_baseline.sql:121`) pero no pantalla.

### Alta de un activo (SQL)

```sql
insert into public.ticket_assets (org_id, name, location, qr_code)
values ('<org_id>', 'Habitación 204', 'Planta 2', 'ASSET-204');
```

`qr_code` es único **global**, no por hotel (`000001_baseline.sql:98`): usar un
prefijo por hotel para no chocar entre clientes.

---

## 4. Si falla la subida de fotos

El mensaje en pantalla es «Error al subir la foto: <mensaje de Supabase>» y el
parte **no** se crea (`TicketForm.tsx:86-90`).

Diagnóstico por orden:

1. **Mensajes de validación (antes de subir nada)** — no es un fallo del
   servidor:
   - «Formato no admitido. Usa una foto JPEG, PNG o WebP.» → típico de iPhone
     con HEIC. Ajustes → Cámara → Formatos → «Más compatible», o adjuntar una
     captura de pantalla (`validation.ts:149-152`).
   - «La foto supera el máximo de 10 MB.» (`validation.ts:156-158`).
   - «La foto está vacía.» (`validation.ts:153-155`).
2. **Falla para todos los usuarios del hotel** → casi seguro faltan las
   políticas de `storage.objects`. El baseline solo crea el bucket privado
   (`000001_baseline.sql:209-211`) y **no existe todavía** ninguna policy de
   storage: la subida fallará en un Supabase real hasta que se añada
   (Pendiente conocido nº 1 de
   [20_ACTIVACION_SUPABASE.md](20_ACTIVACION_SUPABASE.md)).
3. **Falla para un usuario concreto** → sesión caducada o sin membership; ver §5.
4. **Mala cobertura** → no hay cola ni reintento sin conexión: el service
   worker solo cachea peticiones (`public/sw.js:17-32`), no guarda envíos.
   Reintentar con red.

**Salida provisional para el empleado:** crear el parte sin foto (el código lo
permite, `TicketForm.tsx:80`) y describir la avería en el texto.

**Foto huérfana:** si la foto sube pero el insert del parte falla
(`TicketForm.tsx:94-109`), queda un fichero en el bucket sin parte. No hay
limpieza automática. Para localizarlas (SQL Editor):

```sql
select o.name from storage.objects o
where o.bucket_id = 'ticket-photos'
  and not exists (select 1 from public.maintenance_tickets t where t.photo_path = o.name);
```

---

## 5. Si un usuario no ve un parte (o un pendiente)

Comprobar en este orden:

1. **Filtro de estado.** La lista arranca en «Abierto» (`TicketList.tsx:15`).
   Un parte en curso o cerrado solo aparece con su filtro o «Todas».
2. **Hotel distinto.** Cada consulta filtra por la org activa
   (`TicketList.tsx:25`) y RLS solo devuelve filas de orgs del usuario
   (`000001_baseline.sql:186-187`). Comprobar:

   ```sql
   select o.name, o.status, m.role from memberships m join organizations o on o.id = m.org_id
   join auth.users u on u.id = m.user_id where u.email = '<email>';
   ```

   - Ninguna fila → no tiene membership (§1).
   - `status` ≠ `active` → la org está suspendida/archivada
     (`000001_baseline.sql:35`).
   - Dos filas → puede estar viendo el otro hotel (`src/lib/org.ts:9-14`, §1).
3. **Datos antiguos en el móvil (service worker).** `public/sw.js:17-32`
   intercepta **todas** las peticiones GET y responde primero con la copia en
   caché si existe; la red solo actualiza la caché para la próxima vez. Esto
   puede incluir las consultas a Supabase, de modo que la lista vaya una
   recarga por detrás. Comportamiento deducido del código, **no verificado en
   un navegador real**. Remedio para el usuario: recargar dos veces; si sigue,
   borrar datos del sitio en el navegador. Remedio de fondo: decisión del
   operador (ver resumen del encargo).

   > **Riesgo de exposición entre usuarios del mismo navegador.** La caché
   > busca por URL y método (`caches.match(event.request)`, `public/sw.js:19`)
   > y guarda cualquier respuesta correcta (`public/sw.js:21-25`) sin mirar
   > quién la pidió: no distingue la cabecera `Authorization` salvo que la
   > respuesta declare `Vary`, y nada del código la vacía al cerrar sesión.
   > Por tanto, en un móvil o PC **compartido** (mismo navegador y perfil),
   > el siguiente usuario podría ver respuestas guardadas de la sesión
   > anterior: listas de partes y pendientes, datos de su usuario, incluso de
   > otro hotel. Deducido del código, **no verificado en un navegador real**.
   > Hasta que el service worker se corrija y se verifique:
   >
   > - **No usar dispositivos ni perfiles de navegador compartidos.** Cada
   >   empleado entra desde su propio dispositivo o perfil.
   > - Si un dispositivo cambia de usuario (relevo en un PC de recepción,
   >   terminal reasignado, baja de un empleado), **borrar los datos del
   >   sitio** antes de que entre el siguiente (en el navegador: ajustes del
   >   sitio → borrar datos, lo que elimina la caché y el service worker).
   >   Cerrar sesión no basta.
   > - Recargar no basta: solo cambia qué copia se ve, no elimina las
   >   guardadas.
4. **Sesión caducada.** Sin sesión, el proxy manda a `/login`
   (`src/proxy.ts:48-50`) y `useAuth` también (`src/hooks/useAuth.ts:16-26`).
5. **El cambio de estado no se guardó.** `updateStatus` no comprueba errores
   (`TicketList.tsx:46-52`): si el `update` falla, la lista se recarga y el
   parte sigue como estaba, sin mensaje.
6. **Pendientes:** en el formulario de relevo solo se muestran 10
   (`HandoverForm.tsx:39`); el panel los muestra todos (`PendingItems.tsx:20-25`).

### Problemas de acceso (antes de ver nada)

- Errores de configuración o de enlace caducado redirigen a
  `/login?error=config` o `/login?error=auth`
  (`src/app/auth/callback/route.ts:11-38`, `src/proxy.ts:15-17`), pero la
  pantalla de login **no muestra** ese error (`src/app/login/page.tsx`,
  `LoginForm.tsx`): el usuario solo ve el formulario otra vez. Mirar la URL.
- El enlace mágico vuelve a la raíz del sitio (`emailRedirectTo:
  window.location.origin`, `LoginForm.tsx:20`), no a `/auth/callback`. Verificar
  el flujo completo el día de la activación (paso 6 de
  [20_ACTIVACION_SUPABASE.md](20_ACTIVACION_SUPABASE.md)); si el enlace deja al
  usuario de nuevo en `/login`, esta línea es la primera sospechosa.

---

## 6. Copias de seguridad y restauración

> **Hoy no se puede restaurar Relevo.** No hay copias definidas, ni
> procedimiento de restauración, ni ensayo. Esta sección **no es un
> procedimiento ejecutable**: recoge lo que hay que decidir y probar antes de
> dar servicio al primer hotel. Mientras no exista y no se haya ensayado una
> restauración completa (base de datos + usuarios de `auth` + fotos), hay que
> considerar que se pueden perder los datos.

**No existe todavía** en el repo ningún script, tarea programada ni
procedimiento probado de copia o restauración. Lo que hay:

- Todos los datos viven en el Postgres del proyecto Supabase (7 tablas,
  `000001_baseline.sql`) y las fotos en el bucket `ticket-photos`.
- El repo no guarda datos: solo esquema (`supabase/migrations/`) y seed demo
  (`scripts/seed-demo.sql`).

Lo que el operador debe resolver antes de dar servicio (decisión, no
implementado):

1. **Copias de la base de datos.** El plan Pro de Supabase incluye copias
   gestionadas; comprobar en el dashboard (Database → Backups) qué retención y
   modalidad tiene el proyecto y si se activa la recuperación a un punto en el
   tiempo. Esto no se ha verificado: no existe proyecto.
2. **Copias de las fotos.** Las copias de base de datos de Supabase no
   incluyen, en general, los ficheros de Storage. Hace falta un procedimiento
   propio (descarga periódica del bucket). No existe todavía.
3. **Copia lógica propia** (independiente de Supabase). No existe script ni
   se ha ensayado, y por eso aquí no se da ningún comando. Requisito que impone
   el esquema: copiar solo el esquema `public` **no basta**, porque sus filas
   referencian `auth.users` (ver «Restaurar» abajo). La copia tiene que
   incluir también los usuarios de `auth`, y hay que demostrarlo restaurándola
   en un proyecto vacío.

### Restaurar (cuando exista copia)

No hay procedimiento probado. Puntos que el código impone:

- `memberships.user_id` y los `created_by` referencian `auth.users`
  (`000001_baseline.sql:15`, `:66`, `:113`, `:129`). Restaurar solo `public`
  en un proyecto nuevo **falla** si no se restauran también los usuarios de
  `auth`.
- `photo_path` guarda la ruta relativa `<org_id>/<uuid>.<ext>`
  (`validation.ts:167-172`): las fotos deben volver al mismo bucket y la misma
  ruta.
- Antes de restaurar en el proyecto real, ensayar: la migración se puede
  probar en local con `npm run test:rls` (Postgres efímero), pero ese harness
  no modela `storage.objects` ni datos reales.

### Borrado de un hotel

`memberships` se borra en cascada con la organización, pero relevos, partes y
activos **no** (`000001_baseline.sql:63`, `:95`, `:106` sin `on delete
cascade`). Preferir `update organizations set status = 'archived'`, que corta
el acceso sin borrar (`000001_baseline.sql:8`, `:35`).
