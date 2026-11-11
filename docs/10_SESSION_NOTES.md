# Notas de sesión

Formato: **Hecho · Pendiente · Decidido**. La entrada más reciente arriba.

---

## 2026-11-11 — Ronda 8 de automejora (Claude Code, desatendido) · rama `mejora/r8-relevo`

Parte de `mejora/r7-relevo` (PR #21, sin fusionar); el PR de esta ronda va
contra esa rama.

**Hecho**
- Línea base al empezar (`mejora/r7-relevo@1dd56a0`): 738 tests (con Postgres
  efímero), tsc y lint en verde. Al cerrar: 747 tests, tsc y lint en verde.
- `17838af` — `change_ticket_status`: su 42501 ya no se explica solo como
  «sesión»; el mensaje dice «no tienes acceso a este parte o tu sesión
  caducó». En la definición vigente (`000013`) el único 42501 propio es el de
  `auth.uid()` nulo; otro 42501 posible es la falta de permiso sobre la
  función (ACL; hoy `EXECUTE` está concedido a `authenticated`). Un parte de
  otra organización no da 42501: la función devuelve `false`. Probado en
  `ticket-errors`, `TicketList` y `TicketDetail` (el caso de ACL, con un error
  fabricado).
- `0438f30` — `HandoverDetail`: guarda por bloque con `useRef` y botón
  desactivado mientras va `delete_handover_item` (un doble toque mandaba dos
  RPC y la segunda daba «No se pudo borrar» con el bloque ya borrado). Una
  excepción de red muestra el aviso propio y libera el botón. Guarda
  comprobada por mutación.
- `08eaaac` — fuera los SVG de la plantilla de Next en `public/` (`file.svg`,
  `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`); un test exige que cada
  fichero de `public/` se use en `src/`, el manifest o el service worker.

**Pendiente**
- `TicketDetail` (cambio de estado): sin guarda síncrona de doble envío (un
  doble toque da el aviso falso de «otro dispositivo»), una excepción de red
  deja «Guardando» para siempre, y una lectura fallida se muestra como «Parte
  no encontrado». Cambio con 13 tests hecho, sin commit en esta ronda: la
  última revisión señaló que, al cambiar `ticketId` sin desmontar, los botones
  del parte anterior siguen activos durante la carga del nuevo. Parche fuera
  del repo, en la carpeta de la ronda. Enfoque posible: `key={id}` en
  `src/app/tickets/[id]/page.tsx` o vista bloqueada mientras carga otro parte.
- `TicketList`: la guarda se libera en `finally`, pero una excepción de red de
  la RPC queda sin manejar (sin aviso).
- CSP completa (nonce desde el proxy): no abordada.
- Siguen abiertas: idempotencia de `create_handover`, borrado de un bloque sin
  admin disponible y `cron.schedule` de la purga del rastro (plazo de 2 años,
  nota de rondas del 10/11/2026 en AI_OS).
- Prueba en el móvil tras el despliegue: doble toque en «Borrar» de un bloque
  (como admin) y el aviso del 42501 al cambiar un parte con la sesión caducada.

**Decidido**
- El mensaje del 42501 de `change_ticket_status` sigue el mismo criterio que el
  de `PendingItems` (R7): nombra las dos causas en vez de suponer una.
- Ante un fallo de red al borrar un bloque no se recarga: el aviso indica que
  al recargar la página se ve si el bloque sigue ahí.

---

## 2026-11-10 — Ronda 7 de automejora (Claude Code, desatendido) · rama `mejora/r7-relevo`

**Hecho**
- Línea base al empezar (`main@9fa9936`): 728 tests (con Postgres efímero), tsc
  y lint en verde, `npm audit --omit=dev` sin vulnerabilidades. Al cerrar: 738
  tests, tsc y lint en verde.
- `360a8b5` — `PendingItems`: guarda por pendiente y botón desactivado mientras
  va `resolve_handover_item` (un doble toque ya no acaba en el aviso falso de
  «ya estaba resuelto por otra persona»); errores sin el texto del servidor. El
  42501 nombra las dos causas posibles (sin acceso o sesión caducada), con test
  de 42501 para un usuario válido sin permiso; sin sesión en el cliente avisa.
- `29cf812` — `TicketList`: misma guarda en «En curso»/«Cerrar» (un doble toque
  daba «cambió de estado en otro dispositivo»); sin sesión avisa.
- `6b389c9` — `TicketForm`: con foto, la lectura de los primeros bytes era
  asíncrona y ocurría antes de desactivar el botón, así que un doble toque
  subía dos fotos y creaba dos partes. Guarda fijada antes del primer await;
  `try/finally` para que una excepción de red no deje el botón bloqueado; foto
  ilegible con mensaje propio. Las guardas, comprobadas por mutación.

**Pendiente**
- `change_ticket_status`: su 42501 se traduce solo como «sesión»
  (`src/lib/ticket-errors.ts`); mismo matiz que el de `PendingItems` (también
  puede ser falta de permiso con sesión válida).
- `HandoverDetail`: el borrado de un bloque no tiene guarda de doble envío
  (lo frena en parte el `confirm`).
- CSP completa (nonce desde el proxy) y restos de la plantilla de Next en
  `public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`).
- Siguen abiertas: idempotencia de `create_handover`, borrado de un bloque sin
  admin disponible y `cron.schedule` de la purga del rastro (plazo de 2 años,
  nota de rondas del 10/11/2026 en AI_OS).
- Prueba en el móvil de los tres cambios tras el despliegue (doble toque en
  «Resolver», «Cerrar» y «Crear parte» con foto).

**Decidido**
- Para el doble envío se usa una guarda con `useRef` además de `disabled`: el
  estado de React no se ve hasta el siguiente render y, en `TicketForm`, había
  un `await` antes de desactivar el botón.

---

## 2026-11-10 — Ronda 6 de automejora (Claude Code, desatendido) · rama `mejora/r6-relevo`

**Hecho**
- Línea base al empezar (`main@7a03117`): 715 tests (con Postgres efímero), tsc
  y lint en verde, `npm audit --omit=dev` sin vulnerabilidades. Al cerrar: 728
  tests, tsc y lint en verde.
- `dd7a075` — cabeceras de seguridad en todas las respuestas
  (`next.config.ts`): `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`,
  `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y
  `Permissions-Policy` con la cámara solo para el propio origen (escáner QR).
  Estado a 10/11/2026 en producción, antes de este cambio: solo HSTS, así que
  la app se podía enmarcar desde otra web (clickjacking). Comprobado en local
  con `next build` + `next start` en `/login`, `/dashboard` (307 del proxy) y
  `/manifest.json`.
- `8c2367a` — `TicketForm`: los errores de `create_ticket` y de la subida de
  la foto salen con mensajes propios; nunca el texto del servidor. Los textos
  22023 y 42501 traducidos están atados por test a la definición vigente de
  `create_ticket` (`000013`).

**Pendiente**
- `PendingItems` (doble toque en «Resolver» que manda dos RPC y acaba en un
  aviso falso de «ya estaba resuelto por otra persona»; error del servidor
  mostrado tal cual): cambio con tests hecho, sin commit en esta ronda. La
  última revisión señaló que un 42501 con sesión válida (acceso insuficiente)
  no debe decir «vuelve a iniciar sesión». Parche fuera del repo, en la carpeta
  de la ronda.
- CSP completa (scripts y estilos): requiere nonce desde el proxy; no abordada.
- Restos de la plantilla de Next en `public/` (`file.svg`, `globe.svg`,
  `next.svg`, `vercel.svg`, `window.svg`) sin uso.
- Las cabeceras llegan a producción con el despliegue de esta rama; después,
  comprobación con `curl -sI https://relevo.blindbeds.com/login`.
- Siguen abiertas: idempotencia de `create_handover`, borrado de un bloque sin
  admin disponible y `cron.schedule` de la purga del rastro (plazo de 2 años,
  nota de rondas del 10/11/2026 en AI_OS).

**Decidido**
- La CSP de esta ronda solo fija `frame-ancestors`: Next inyecta scripts
  inline sin nonce y una CSP de scripts sin nonce rompería la app.

---

## 2026-11-10 — Round 3-bis de automejora (Claude Code, desatendido) · rama `mejora/r1-relevo`

**Hecho**
- Línea base al empezar: 690 tests. Al cerrar: 715 tests, tsc y lint en verde
  (ejecución local con Postgres).
- `d60c416` — `TicketList` y `TicketDetail`: los errores de
  `change_ticket_status` salen con mensajes propios (42501 sesión, 22023
  transición no permitida, genérico para el resto); nunca el texto del
  servidor. `src/lib/ticket-errors.ts` con test de sincronía con la
  definición vigente (`000013`); `TicketDetail` tiene ya test de componente.
- `45eadb8` — `000020_item_deletion_log.sql`: `handover_item_deletion_log(org)`
  devuelve fecha, email de quien borró, relevo (id, fecha, departamento,
  turno) y bloque; nunca el contenido. Solo da filas al admin de un hotel
  activo y de su hotel (misma comprobación que la policy de `000018`).
  `000020` entra en la secuencia de reaplicación tras `000011`.
- `40fdeb8` — `/handover`: sección «Rastro de borrados», solo para el admin,
  con enlace al relevo o aviso de relevo ya purgado. El estado va atado al
  hotel cargado (hallazgo del careo).

**Pendiente**
- Migraciones `000016` a `000020`: solo como ficheros. Estado a 10/11/2026:
  sin aplicar en `relevo`. Orden: 000016 → 000017 → 000018 → 000019 → 000020.
  Sin `000020` aplicada, la sección del rastro muestra «No se pudo cargar».
- Prueba en navegador de la sección «Rastro de borrados» con un admin y con un
  staff, tras aplicar `000020`.
- Siguen abiertas (decisiones del operador, fuera de este round): borrado de
  un bloque sin admin disponible o con el hotel no activo; idempotencia de
  `create_handover`; plazo de 2 años del rastro.

**Decidido**
- El rastro de borrados se lee por una función security definer (necesita
  `auth.users` para el email) con la comprobación de admin dentro; la UI mira
  el rol solo para no pintar la sección.

---

## 2026-11-10 — Round 3 de automejora (Claude Code, desatendido) · rama `mejora/r1-relevo`

**Hecho**
- Línea base al empezar: 675 tests, tsc y lint en verde (ejecución local con
  Postgres). Al cerrar: 690 tests, tsc y lint en verde.
- `0f63d84` — runbook § Incidente: retirada la vía de borrado por SQL (no
  dejaba asiento en `handover_item_deletions`; el SQL Editor no identifica a
  la persona). El borrado es el de la app (RPC, `deleted_by` de la sesión).
  Sin admin disponible u hotel no activo: «borrado pendiente» en el registro
  del incidente, con comprobación del job de purgado y de su última pasada.
- `61db962` — runbook: incidencias típicas del relevo al día y «Relevos sin
  bloques» (consulta de solo lectura con los asientos del rastro) en lugar de
  «Borrar un relevo huérfano» (delete por SQL sin rastro).
- `426891c` — runbook §2: registrar (`create_handover`, una transacción,
  límites de `000017`) y resolver (`resolve_handover_item`) según el código.
- `6099754` — `000019_item_deletions_retention.sql`:
  `purge_expired_item_deletions()` borra los asientos del rastro con más de 2
  años (security invoker; solo operador, `pg_cron` o `service_role`). No
  programa nada; el `cron.schedule` está en el runbook. ACL en
  `grants.test.ts` y reaplicación tras `000011` documentada.
- `b6f4b7c` — `HandoverForm`: los 22023 de `create_handover` se muestran en
  castellano; 42501 y el resto, con mensajes propios. Nunca se muestra el
  texto del servidor. Test de sincronía con la definición vigente de
  `create_handover`.
- `0162aa3` — test de la secuencia de reaplicación 000011 → 000013 → 000014 →
  000016 → 000017 → 000018 → 000019 (límites, rastro y purga activos) y
  párrafo con el orden en `20_ACTIVACION_SUPABASE.md`.

**Pendiente**
- Plazo de 2 años del rastro de borrados: provisional, pendiente de
  confirmación del operador. El `cron.schedule` de la purga depende de esa
  confirmación y de aplicar `000019`; a 10/11/2026 no está programado.
- Migraciones `000016` a `000019`: solo como ficheros. Estado a 10/11/2026:
  sin aplicar en `relevo`.
- Decisión abierta del operador: borrado de un bloque cuando no hay admin
  disponible o el hotel no está activo (dos variantes revisadas y no
  aprobadas en este round: SQL con asiento atribuido por id, y cuenta de
  incidentes con membership admin temporal; la segunda deja un `admin` que
  depende de una baja manual).
- Vista de solo lectura del rastro de borrados para el admin en `/handover`:
  no hecha en este round.
- `TicketList` y `TicketDetail` muestran `rpcError.message` tal cual (mismo
  patrón que se corrigió en `HandoverForm`).
- `create_handover` sigue sin idempotencia (decisión de arquitectura abierta).

**Decidido**
- En el runbook ningún procedimiento borra bloques ni relevos por SQL: el
  único borrado manual documentado es el de la app, con asiento.
- Mensajes de error de `create_handover`: traducción por texto exacto del
  `raise` (22023) y genéricos para lo demás; el detalle del servidor no se
  muestra al usuario.

---

## 2026-11-10 — Round 2 de automejora (Claude Code, desatendido) · rama `mejora/r1-relevo`

**Hecho**
- Línea base al empezar: suite, tsc y lint en verde (ejecución local con Postgres).
- `a0a11e4` — límites de `create_handover` en el servidor (≤ 4 ítems, uno por
  bloque, ≤ 2000 unidades UTF-16; 22023). El stash del round 1 (`000015`) pasa
  a llamarse **`000017_handover_limits.sql`**: redefine la función de `000014`
  y así queda detrás de `000016` en el orden de aplicación. No existe `000015`.
  Sin cambio de UI (la UI ya validaba lo mismo).
- `5a25378` — `000018_handover_item_deletions.sql`: tabla de rastro de los
  borrados (org, relevo, ítem, bloque, quién, cuándo; sin el contenido) que
  escribe `delete_handover_item` en la misma transacción. RLS: solo la lee el
  admin de un hotel activo; la app no la escribe. Sobrevive a la retención.
- `c481cf7` — `PendingItems`: cuando `resolve_handover_item` devuelve `false`,
  la app vuelve a leer el ítem; «ya estaba resuelto» solo si se lee resuelto;
  si no se ve (hotel suspendido, sin membresía) o sigue abierto, error y el
  ítem sigue en la lista. Sin cambio de base de datos.
- `e6d69b2` runbook §3 (partes) y `cd2f149` README (lista de migraciones).
- Los dos stashes del round 1 eliminados tras convertirse en commits/ficheros.

**Pendiente**
- Runbook §2 (relevo, incidente con asiento en `handover_item_deletions`,
  incidencias típicas, relevos sin bloques): sin commit en este round (tres
  revisiones NO APTO).
- Migraciones `000016`, `000017` y `000018`: solo como ficheros; su orden por
  nombre es el de aplicación. Estado a 10/11/2026: sin aplicar en `relevo`.
  Las dependencias de reaplicación están en `docs/20_ACTIVACION_SUPABASE.md`.
- `create_handover` sigue sin idempotencia (clave de cliente).
- El rastro no tiene pantalla: hoy se consulta por SQL.

**Decidido**
- Renumerar a `000017` en vez de mantener `000015`: aplicar por orden de
  nombre no deja una migración detrás de otra ya aplicada.
- `resolve_handover_item` conserva su firma (boolean): distinguir los casos en
  el cliente evita coordinar migración y despliegue.

---

## 2026-11-10 — Round 1 de automejora (Claude Code, desatendido) · rama `mejora/r1-relevo`

**Hecho**
- Auditoría: los cuatro MUST del encargo d1 (relevo atómico por RPC, foto por
  URL firmada, «en curso» por defecto, código de activo manual) **ya estaban en
  main y en producción** (000006/000014, `TicketPhoto` 300 s, filtro «Abiertos y
  en curso», campo «Código del activo»). No se rehicieron. Línea base: 647/647
  tests (con Postgres), tsc 0, lint 0.
- **Commit `18e5337`:** `000016_delete_handover_item.sql`
  — el admin de un hotel activo borra un bloque de un relevo de su hotel
  (security definer; true/false sin revelar si existe; cabecera conservada; sin
  DELETE directo). Botón «Borrar» con confirmación en `/handover/<id>` solo para
  admin. Runbook: procedimiento de incidente (dato sensible colado). Tests
  vistos en rojo (BD 6/7, UI 3/7) → 658/658.
- **Sin commitear tras tres revisiones (guardado en `git stash` del repo):**
  - Bucle 2 — `000015_handover_limits.sql`: `create_handover` aplica en el
    servidor ≤ 4 ítems, uno por bloque y ≤ 2000 caracteres contados como
    `String.length` (UTF-16), con cota barata antes de recorrer el texto. Las
    tres revisiones encontraron fallos reales, todos corregidos en el stash
    (emojis, coste de `regexp_split_to_table`, test de 5 ítems que no detectaba
    la mutación). 654/654 con el cambio.
    `stash` «r1-bucle2: 000015…».
  - Bucle 4 — runbook/README alineados con el código (relevo atómico, foto
    opcional, sin notificaciones, verificación de URL firmada). La revisión
    señaló imprecisiones (actualización en tiempo real, idempotencia, causas
    del `false` de `resolve_handover_item`), corregidas en el stash
    «r1-bucle4: runbook/README…».

**Pendiente**
- Decisión del operador: cuándo aplicar `000016` en `relevo` (sin la migración,
  el botón «Borrar» muestra «No se pudo borrar el bloque»; el resto no cambia).
- Decisión del operador: qué hacer con los stashes de los bucles 2 y 4.
- `PendingItems`: `resolve_handover_item` devuelve `false` también con hotel
  suspendido o membresía perdida, y la UI dice «ya estaba resuelto por otra
  persona» y oculta el ítem: mensaje engañoso (hallazgo del careo del bucle 4).
- `create_handover` no es idempotente: un error de red tras el commit + reintento
  duplica el relevo (clave de idempotencia desde el cliente).

- Abierto: el borrado del admin no deja traza en la base de datos. Propuesta:
  tabla de auditoría con quién, cuándo, `handover_id` y bloque borrado (sin el
  contenido), escrita por la propia RPC.

**Decidido**
- El borrado del admin es por bloque y conserva la cabecera del relevo (queda
  constancia de que hubo relevo).
- Lo no commiteado tras tres revisiones queda en stash, fuera de la rama.

## 2026-11-02 — Subdominio relevo.blindbeds.com y retención programada (Claude Code)

**Hecho**
- Vercel: `relevo.blindbeds.com` asignado al proyecto `blindbeds-relevo` (`vercel domains add`); TLS emitido. `/` → 307 → `/login` → 200.
- DNS (Arsys, Panel de Control → Entradas DNS): `A relevo.blindbeds.com → 76.76.21.21`, igual que appcc y audit. Arsys exige el nombre completo, no solo `relevo`.
- Supabase `relevo` → Authentication → URL Configuration: Site URL `https://relevo.blindbeds.com`; Redirect URLs + `https://relevo.blindbeds.com/**` (se conservan localhost y las dos de vercel.app). El login usa `window.location.origin`, así que el enlace mágico vuelve al host desde el que se pidió.
- pg_cron activado y tarea `relevo-purge-expired-handovers` (`15 3 * * *`, activa) programada desde el SQL Editor (runbook § Retención de relevos). Verificado con `select jobname, schedule, active from cron.job`.
- Cuenta: el proyecto `relevo` NO está en la cuenta de los MCP/CLI (la que entra por GitHub); hay que entrar con email + contraseña de la segunda cuenta del operador.
- PR #17 fusionada en main (`4760938`); 000011→000014 aplicadas en producción (verificado por SQL: trigger y CHECK validados, RPC definer, anon sin EXECUTE); Vercel desplegó producción desde main (proyecto enlazado a git, no hizo falta `vercel --prod`).
- **Smoke real en móvil superado (10:15–10:24 UTC):** enlace mágico desde `relevo.blindbeds.com` → relevo → pendiente resuelto → parte con foto (3,0 MB en `ticket-photos/<org>/…`) → cerrado. Comprobado en la base: `create_handover`, `resolve_handover_item`, `create_ticket`, `change_ticket_status` y las policies de Storage funcionan con la base migrada. Las 2 filas `abierto→cerrado` de `ticket_updates` son de dos partes distintos (uno de pruebas del 01/11), no un duplicado. MVP §6: 8/8.
- Alta pública cerrada: Authentication → Sign In / Providers → «Allow new users to sign up» OFF; verificado por `GET /auth/v1/settings` → `disable_signup: true`.

**Pendiente**
- launchd de retención de fotos (operador).
- Opcional: repetir el smoke en el otro sistema móvil (iOS o Android) y ejercitar «en curso» en producción.

**Decidido**
- Registro A (no CNAME) para homogeneidad con el resto de subdominios.

## 2026-11-01 — Relevo en la nube (opencode) + revisión y arreglos (Claude Code)

**Hecho (opencode, `cloud-agentic`, commits `45389ed`→`ff331f9` directos a main)** ·
Supabase nuevo `relevo` (`zlwpqucwudygqnghdaxb`, Frankfurt, Free, cuenta
la segunda cuenta Supabase del operador, no la de los MCP) con 000001–000010 + seed demo; Vercel
`blindbeds-relevo` → https://blindbeds-relevo.vercel.app (prod pública,
previews protegidos). 000009 habitación/zona (activo y QR opcionales), foto con
cámara/galería y vista previa, `/tickets/[id]` con historial, 000010
`ticket_author_emails`, `scripts/purge-ticket-photos.mjs`, undici/zod.

**Hecho (Claude Code, revisión)** · Hallado: el 42501 se arregló en producción
con `grant all on all tables/sequences/functions in schema public to anon,
authenticated, service_role` A MANO → repo ≠ producción y REVOKE deshechos
(anon ejecutaba `handover_author_emails`, comprobado por REST; 000010 sí quedó
bien porque se aplicó después). Arreglo: `000011_grants.sql` (grants de tablas
y secuencias + ACL de diseño de cada función + sin EXECUTE implícito para anon
en funciones futuras; idempotente). Test `tests/db/grants.test.ts` visto en
ROJO (4/5) → verde; suite 621/621, tipos y lint limpios. Retención de fotos:
`scripts/launchd/` (semanal, lunes 09:30, notificación OK/ERROR, probado en
simulación contra producción y en el camino de error). Docs: runbook §
Retención de fotos y activación § 3 (tabla de migraciones + aviso).

**Careo Codex nivel 1** (`7e324ed..HEAD` + working tree). R1 NO APTO, 7
hallazgos; los dos ALTOS venían del baseline (policy `tickets_update` sin
límite de columnas), agravados por el purgador con service_role y 000010:
(1) un miembro podía apuntar `photo_path` a una foto de OTRA org y el purgador
la borraría; (2) cambiar `created_by`/`closed_by` al UUID de un usuario de otra
org y leer su email (fuga demostrada en test, visto en rojo). Arreglos: 000012
(trigger de columnas protegidas + CHECK de ruta de foto, que cubre también el
INSERT + CHECK de `room_number`), 000011 revoca EXECUTE a anon en todas las
funciones, purgador con validación de ruta por org y paginación, TicketForm
borra la foto si falla el insert. R2 NO APTO (4 medios/bajos): purgador por
lotes completos (solo vacía lo que Storage confirma), barrido de huérfanas en
servidor (> 24 h, sin parte), trigger con coherencia de cierre (cerrado es
final; cerrar = auth.uid() + now(); fuera de cerrado, campos de cierre NULL) y
CHECK `NOT VALID` + `VALIDATE` que no aborta sobre datos antiguos. 646/646
tests. R3 NO APTO: (ALTA) el trigger solo cubría UPDATE → un INSERT directo con
`status='cerrado'` y `closed_by` ajeno reabría la fuga de emails; (MEDIA)
carrera en el barrido entre snapshot y borrado. Arreglados después de R3
(trigger `BEFORE INSERT OR UPDATE`: un parte nace abierto y sin cierre;
re-comprobación de referencias antes de cada lote y paginación por cursor),
tests vistos en rojo → 649/649. Tope de 3 rondas alcanzado sin APTO. Patrón
de fondo: cada ronda encuentra un hueco nuevo en la misma superficie
(escritura directa del cliente sobre `maintenance_tickets` con policies
amplias). **Decisión del operador (02/11): rediseño acotado** → `000013_ticket_rpc.sql`:
partes solo por `create_ticket` / `change_ticket_status` (definer, membresía
explícita); sin INSERT/UPDATE/DELETE de la app en partes e historial; 000012
queda como segunda barrera (sus tests reabren permisos a propósito).
TicketForm usa la RPC. Hallado de paso: `has_table_privilege` con varios
privilegios es «alguno», el test de grants era más débil de lo que parecía →
ahora privilegio a privilegio. 649/649 tests + **34/34 e2e** contra Supabase
local. Careo nuevo sobre el diseño por RPC — R1 NO APTO pero **sin ninguna vía
de cruce entre hoteles**; 3 medios dentro del hotel: foto reutilizable en dos
partes (el purgador borraría la de un parte activo), carrera del barrido, y
`handover_items` reescribible por cualquier miembro. Arreglo: `create_ticket`
exige que la foto exista en Storage, sea de quien llama (`owner_id`) y tenga
< 12 h + índice único de `photo_path` (cierra también la carrera: lo que el
barrido borra tiene > 24 h y ya no se puede enlazar); `000014` →
`resolve_handover_item` y sin UPDATE/DELETE directo en `handover_items`.
650/650 + 34/34 e2e (01-guion sube foto real: `owner_id` comprobado con Storage
local). R2 NO APTO (2 medios, ninguno entre hoteles): el INSERT directo en
relevos seguía abierto → `create_handover` a definer y sin escritura directa
en `shift_handovers`/`handover_items`; y TicketForm borraba la foto ante un
error que podía ser ambiguo (parte creado, respuesta perdida) → ya no borra,
lo hace el barrido a las 24 h. 647/647 + 34/34 e2e. **R3 APTO**: sin vías
entre hoteles ni escritura directa indebida (organizations solo lectura,
memberships/ticket_assets solo admin de su hotel, resto solo por RPC).
Pendiente bajo: límites de servidor en `create_handover` (≤ 4 ítems, 1 por
bloque, contenido ≤ 2000) — la UI ya los aplica.

**Pendiente (operador)** · Aplicar 000011, 000012 y 000013 en producción, en
ese orden, y desplegar justo después (la app nueva crea partes con
`create_ticket`; la vieja, con INSERT directo, deja de poder crear):

```bash
cd ~/MAIN_PROYECTOS/blindbeds-relevo
for f in 000011_grants 000012_ticket_guard 000013_ticket_rpc 000014_handover_item_rpc; do
  psql "postgresql://postgres@db.zlwpqucwudygqnghdaxb.supabase.co:5432/postgres" \
    -v ON_ERROR_STOP=1 -1 -f supabase/migrations/$f.sql || break   # pide la contraseña (Bitwarden)
done
```

Antes de dar datos reales, auditar `created_by`/`closed_by` heredados de la
ventana del `grant all` (en Supabase → SQL Editor; hoy hay 0 partes):

```sql
select t.id, t.org_id, 'created_by' as col, t.created_by as user_id from public.maintenance_tickets t
 where not exists (select 1 from public.memberships m where m.org_id = t.org_id and m.user_id = t.created_by)
union all
select t.id, t.org_id, 'closed_by', t.closed_by from public.maintenance_tickets t
 where t.closed_by is not null
   and not exists (select 1 from public.memberships m where m.org_id = t.org_id and m.user_id = t.closed_by);
```

Pendiente técnico (bajo): validación de bytes de la foto en servidor;
`ALTER DEFAULT PRIVILEGES FOR ROLE <propietario real>` (comprobar el
propietario de las funciones en producción).

Instalar el launchd (runbook) · pg_cron de `purge_expired_handovers` · decidir
4ª puerta en web-blindbeds.

**Decidido** · Grants de tablas iguales a un Supabase estándar (RLS decide las
filas). La retención de fotos va en el Mac (necesita `service_role`, nunca en
cron público). Columnas protegidas por trigger y no por GRANT de columnas,
para que aguanten otro `grant all` manual. Migraciones y despliegue van juntos
(000013 ↔ TicketForm con `create_ticket`).

---

## 2026-10-27 — Sprint 2 del MVP (R3, R4b, R4c, minimización, R5)

**Hecho** · Rama local `mvp/sprint2-2026-10-27` (sin push). R3: `/handover`
(últimos 50 relevos con departamento, turno, autor y hora; filtro por
departamento) y `/handover/[id]` (ítems por bloque, resueltos tachados); enlace
«Ver relevos» en el panel y «Relevos» en la cabecera. Autor vía
`handover_author_emails` (000007, security definer con `search_path = ''`:
solo emails de los autores visibles con relevos en la org del usuario, tras el
gate de Codex ronda 1). R4b: foto del parte con URL firmada de 300 s (`TicketPhoto`); la lista
de partes arranca en «Abiertos y en curso». R4c: «Código del activo» manual
que busca `ticket_assets.qr_code` en la org. Minimización: aviso literal en los
4 bloques del relevo (`src/lib/privacy.ts`, `aria-describedby`); el bloque VIPs
pasa a «Habitaciones con atención especial hoy». Retención:
`purge_expired_handovers()` (000008) borra relevos > 90 días con sus ítems;
solo operador/service_role/pg_cron; pg_cron documentado en el runbook, NO
aplicado. R5: iconos 192/512 (#F0AB00 + «R» #97999B) generados con
`scripts/generate-icons.py` (solo stdlib); manifest con `theme_color` de marca y
sin «Suite». Tests rojo→verde: 18 fallos → 571 verdes; tsc, lint y build
(con env públicas de relleno) en verde.
**Pendiente** · Smoke en Supabase real (URL firmada y 403 entre orgs, pg_cron);
Lighthouse «installable»; borrado manual de un ítem por el admin desde la app y
procedimiento de incidente (MUST de minimización, parte M); smoke de
`createSignedUrl` con path de otra org (anotado en el runbook §3).
**Decidido** · El autor se muestra por email (no hay perfiles); un autor dado
de baja sale como «Autor no disponible». La retención no tiene parámetro (90
días fijos) para que nadie la llame con un plazo menor por error.

---

## 2026-10-15 — Runbook de operación y guion de prueba (encargo f5-relevo-docs)

**Hecho** · Solo documentación, sin tocar código.
[`30_RUNBOOK_OPERACION.md`](30_RUNBOOK_OPERACION.md): altas/bajas/roles por
SQL, relevo, partes con foto, fallo de subida, «no veo el parte», copias y
restauración, cada comportamiento con `fichero:línea`.
[`31_GUION_PRUEBA_USUARIOS.md`](31_GUION_PRUEBA_USUARIOS.md): sesión de ~35 min
con jefe de recepción y técnico, datos ficticios del seed demo. README los
lista en el árbol de `docs/` (sin enlace). No duplica [`20_ACTIVACION_SUPABASE.md`](20_ACTIVACION_SUPABASE.md).
**Pendiente** · Hallazgos al leer el código (no arreglados, fuera de alcance):
`supervisor` no tiene permisos extra sobre `staff`; la foto se guarda pero no
se muestra en ninguna pantalla; no hay copias ni restauración definidas;
`public/sw.js` responde desde caché a todos los GET (posible lista desfasada,
no verificado en navegador); el login no muestra `?error=`; el enlace mágico
vuelve a `/` y no a `/auth/callback` (verificar el día de la activación);
`org.ts` elige una membership al azar si hay varias; `TicketList` y
`PendingItems` ignoran errores de escritura.
**Decidido** · Lo no implementado se marca «no existe todavía» en el runbook;
las decisiones (foto obligatoria, caché del SW, copias de Storage) quedan para
el operador.
**Careo Codex (NO APTO) → corregido** · El alta de usuarios pasa a estar
marcada como pendiente de validar (depende del login por enlace mágico) y se
separa el operador del proyecto (SQL Editor, sin RLS) del `admin` de la app
(sujeto a RLS, sin UI). La sección de copias dice que hoy no se puede restaurar
y deja de dar un comando `pg_dump`. El guion usa un proyecto de prueba
desechable en vez de borrar datos sueltos. Rechazado en parte: `pg_dump
--schema=public` sí exporta datos (el que solo exporta el esquema es
`--schema-only`); el comando se retira de todos modos porque sin `auth.users`
la copia no se puede restaurar. Los dos hallazgos menores (README sin enlaces
navegables, referencia al commit) se dejan sin tocar.
**Careo Codex 2 (NO APTO) → corregido** · `public/sw.js` busca en la caché por
URL sin mirar quién hizo la petición y no la vacía al cerrar sesión: en un
dispositivo compartido puede mostrar datos de la sesión anterior (deducido,
no verificado). El runbook (§5 y bajas) y el guion lo advierten: nada de
dispositivos o perfiles compartidos y borrar los datos del sitio al cambiar de
usuario hasta que se corrija el service worker. Menores sin tocar.
## 2026-10-15 — One-pager comercial en borrador (encargo f6-relevo-onepager)

**Hecho** · `docs/33_ONE_PAGER_RELEVO.md`: one-pager en BORRADOR (problema, ICP,
3 resultados, 3 pasos, diferencias por categoría de alternativa, objeciones, CTA de
demo de 20 min) y una tabla de trazabilidad afirmación → fichero. Solo documentación;
no se ha tocado código.
**Pendiente** · El operador tiene que resolver los [VERIFICAR] (rango del ICP, PWA en
iOS/Android, avisos al técnico, servidores en la UE/RGPD, permanencia, contacto) y el
`[PRECIO: decisión del operador]`. Durante la revisión del código salieron cosas que
afectan a la demo: el texto «Mantenimiento ha sido notificado» es falso (no hay
notificaciones), la foto no se ve en el listado de partes, faltan
`public/icon-192.png` y `icon-512.png`, y siguen pendientes las policies de
`storage.objects`.
**Decidido** · Fuera del one-pager todo lo que no existe hoy (notificaciones,
asignación, historial por activo, informes, uso sin conexión, PMS). La comparativa
habla de categorías y no nombra a ningún competidor.
## 2026-10-12 — Bloqueos de activación: CI, policies de storage, FK por org (Mac)

Rama `work/activation-blockers` → PR contra `main` (sin fusionar). Nada se ha
aplicado a ningún Supabase: no existe proyecto.

**Hecho** · Suite 276 → 448 (22 ficheros; `tests/db` 80 → 223 sobre PostgreSQL
17 real), lint 0/0, typecheck 0, `next build` OK con env ficticias. Cada punto
con test visto en rojo antes.
1. **CI** (`.github/workflows/ci.yml`, push y PR a `main`): `npm ci` con caché,
   lint `--max-warnings=0`, typecheck, suite completa con el PostgreSQL del
   runner y `next build`. `gatePg()` hace que `tests/db` FALLE en vez de
   omitirse con `CI=true` o `RLS_REQUIRE_PG=1` (probado lanzando vitest como
   subproceso sin binarios de Postgres: antes salía 0 con 80 omitidos).
2. **`000003_storage_policies.sql`**: leer = miembro activo de la org del
   prefijo; subir = igual, solo a `<org_id>/<fichero>`; borrar = admin; sin
   update; nada para anon ni org suspendida. Matriz rol × operación × org en
   `tests/db/storage.test.ts` contra un stub de `storage` solo para tests.
3. **`000004_org_scoped_fks.sql`**: `unique (id, org_id)` + FK compuestas en
   `handover_items`, `maintenance_tickets` y `ticket_updates` (esta gana
   `org_id`, heredado del parte por trigger). El cruce da `23503` también para
   `service_role`. Aborta con mensaje si ya hay filas cruzadas.
- `setup-supabase-pro.sh`: aplica todas las migraciones con `ON_ERROR_STOP` y
  una transacción por fichero (antes `psql -f` devolvía 0 aunque el SQL
  fallara), salta el baseline si ya está, verifica policies de tablas y storage.
- Careo nivel 1 con Codex, 2 rondas: R1 RECHAZADO (setup no re-ejecutable;
  guardas por nombre en 000004 engañables por deriva) → corregidos con rojo
  previo. R2 APROBADO CON CAMBIOS (baseline a medias no detectado → corregido;
  fotos huérfanas/cuota → documentado, es el pendiente de atomicidad).

**Pendiente** · Verificar las policies de storage en el Supabase real (runbook
§6 «Fotos»): el stub no es la API de Storage. Escrituras no atómicas y fotos
huérfanas. Referencias a usuarios de otra org (`assigned_to`, etc.).

**Decidido** · Prefijo de org comparado como texto (un nombre malicioso se
deniega, no rompe con error de cast). Sin policy de `update`: las fotos son
inmutables. No se condiciona la subida a `owner = auth.uid()` (no verificable
sin Supabase real). 000004 no reescribe filas cruzadas: se niega a correr.
Queda al operador: foto obligatoria sí/no; si `staff` debe poder borrar su foto.

---

## 2026-10-11 — Revisión del PR #1 (Mac, careo nivel 1 con Codex)

**Hecho** · Suite 272 → 276 (RLS 78 → 80, harness +2) sobre PostgreSQL 17.11
real; lint y typecheck en 0; ley del rojo verificada en 5 tests. Fixes: `/icon-`
pasa a patrón cerrado `/icon-<n>.png` (antes cualquier `/icon-*` era público);
el harness intenta `pg_ctl stop` si `pg_ctl start` falla a medias. Tests nuevos:
staff/supervisor no borran activos y admin sí; un parte no se mueve de org.
**Pendiente** · Runbook §«Pendiente conocido»: policies de `storage.objects`,
FK compuestas anti-cruce de orgs, escrituras no atómicas (heredado de `main`).
`next build` sin env de Supabase falla en `/dashboard` también en `main`.
**Decidido** · Los hallazgos heredados no se arreglan en este PR: van al runbook
con remedio propuesto para que el operador decida antes de activar Supabase.

---

## 2026-10-11 — Harness Postgres + RLS, hardening, cobertura

Rama: `claude/rls-postgres-harness-m1ly4y` → PR contra `main`.
Suite antes: 98 tests / 7 ficheros, lint 0, typecheck 0.
Suite después: 272 tests / 17 ficheros, lint 0, typecheck 0, `next build` OK.

### Hecho

- **Harness Postgres efímero sin Docker** (`tests/harness/pg.ts`): `initdb` +
  `pg_ctl` en `/tmp`, stub de `auth`/`storage`/roles de Supabase, fixture
  sintético. 78 tests en `tests/db/rls.test.ts` cubren las 7 tablas para
  staff / supervisor / admin, anon, sin membership y org suspendida.
  `npm run test:rls` exige Postgres; `npm test` lo omite con aviso si no hay.
- **Dos fallos reales en `000001_baseline.sql` vistos en rojo y corregidos**:
  1. El índice `handover_items_pending_idx` usaba `org_id` antes de que la
     columna existiera (`alter table` posterior) → la migración abortaba con
     SQLSTATE 42703. Ahora `org_id` va dentro del `create table`.
  2. `has_org_role()` devolvía `true` para supervisor con `min_role='admin'`
     (un supervisor podía gestionar activos y memberships). Ahora jerarquía
     numérica estricta; `min_role` desconocido nunca se cumple.
- **`000002_relevo_tables.sql`** movida a `supabase/variants/shared-appcc/` con
  README: es la variante «proyecto compartido con APPCC», no una migración
  secuencial; aplicada tras el baseline falla con 42P07 (test real lo prueba).
- **Hardening**:
  - `src/middleware.ts` → `src/proxy.ts` (Next 16 deprecó `middleware`).
    Rutas públicas por coincidencia exacta (+ `/sw.js`, que antes exigía
    sesión). Sin env de Supabase → `/login?error=config`; error de `getUser`
    → sin sesión.
  - `/auth/callback`: el parámetro `next` ya no permite open redirect
    (`https://`, `//host`, `/\host`, codificados). `/auth/confirm` valida `type`
    contra el catálogo de `EmailOtpType`.
  - `src/lib/validation.ts`: catálogos, recorte, límites (bloque 2000, título
    120, descripción 2000), relevo con ≥1 bloque, `asset_id` debe ser UUID,
    foto ≤ 10 MB y JPEG/PNG/WebP con extensión derivada del MIME, ruta de
    storage `<org>/<uuid>.<ext>` sin posibilidad de traversal.
  - `TicketForm`: el QR se resuelve contra `ticket_assets.qr_code` y se envía
    el `id`; antes se insertaba el texto del QR en una columna `uuid`.
  - Etiquetas asociadas a sus controles (`htmlFor`/`id`), errores con
    `role="alert"`.
- **`scripts/setup-supabase-pro.sh`**: comprueba `psql` antes de nada; test de
  shell sin red con `psql` falso (orden de operaciones, fallos cerrados, no
  imprime secretos). Añadido `.env.local.example` (des-ignorado en
  `.gitignore`).
- **Cobertura**: tests de componentes (HandoverForm, TicketForm, PendingItems,
  TicketList) con jsdom + Testing Library sobre un Supabase falso en memoria;
  tests de API de `/auth/callback`, `/auth/confirm` y `proxy`.
- Docs: `docs/20_ACTIVACION_SUPABASE.md` (runbook de una hora).
- Limpieza: `vitest.config.mts` duplicado y muerto eliminado.

### Pendiente (operador)

- Crear el proyecto Supabase Pro y ejecutar el runbook. Nada se ha aplicado a
  ningún Supabase.
- Alta del primer admin y de organizaciones: no hay UI; se hace por SQL (ver
  runbook §4).
- Si APPCC comparte `has_org_role()`, revisar allí el mismo fallo de jerarquía.
- `.vercel/project.json`: no existía en el repo (nunca fue trackeado) y
  `.vercel` ya estaba en `.gitignore`. Sin acción.
- Los 3 errores `no-use-before-define` ya estaban corregidos en `main`
  (commit `1f14ec6`); lint estaba y sigue a 0.

### Decidido (y por qué)

- Harness en `/tmp` y no en el scratchpad: el socket Unix de Postgres no admite
  rutas de más de ~107 bytes y el directorio debe ser accesible por el usuario
  sin privilegios que ejecuta `initdb`.
- `npm test` omite la matriz RLS si no hay Postgres (con aviso) para no romper
  entornos sin binarios; `npm run test:rls` la exige. CI debería usar este
  último.
- La foto sigue siendo opcional en código aunque README/UI digan «obligatoria»:
  es decisión de producto; se deja al operador (ver PR).
- No se añadió `check` a `ticket_updates.status_to` ni policies de `update` a
  `shift_handovers` (leer/marcar como leído): cambios de esquema fuera del
  encargo; documentados en el PR.

## 2026-10-14 — Parches de dependencias y CI Linux (HP)

### Hecho
- Rama fix/dependency-security-20261014: Next y eslint-config-next 16.3.8, sharp 0.35.5, DOMPurify 3.4.17 y source-map-js 1.2.2. Sin cambios de lógica de aplicación, auth ni RLS.
- Rojo: npm audit previo exit 1 (9 paquetes: 1 crítico, 7 altos, 1 bajo); GitHub lista 11 avisos sobre cuatro paquetes runtime. Verde: npm audit --omit=dev exit 0, sin vulnerabilidades de ejecución.
- npm ci, typecheck y lint pasan. Build pasa con URL/anon key ficticias de Supabase, sin proyecto real.
- Windows: 185 tests pasan; 11 fallan por montaje POSIX (sh ausente y binarios shell falsos); 80 RLS omitidos por falta de PostgreSQL. No se presentan como suite verde.
- Añadido CI Linux, idéntico al workflow del PR #2: Ubuntu, Node 22, PostgreSQL efímero obligatorio, lint, typecheck, suite completa y build sin secretos. No incorpora los cambios de esquema del PR #2.
- Revisión independiente Codex nivel 1: APTO estático para rama/PR, condicionado a CI verde; manifest/lock alineados, integridades de npm y rangos compatibles.

### Pendiente
- Ejecutar CI del PR antes de fusionar; los avisos de GitHub no se cierran hasta que el arreglo llegue a main.
- npm audit completo conserva cinco avisos altos de desarrollo en la cadena eslint-config-next → fast-glob → micromatch → braces. El origen es braces <=3.0.3, última versión publicada 3.0.3; no hay parche compatible disponible a fecha de revisión. No usar npm audit fix --force (propone bajar eslint-config-next a 14).
- El PR #2 de activación sigue independiente. No se ha desplegado ni creado base de datos.

### Decidido
- Aplicar versiones de parche mínimas para las 11 alertas runtime, sin saltar a Next 16.4 ni actualizar dependencias ajenas.
- La auditoría es el reproductor rojo/verde de dependencias; la regresión funcional se verifica en Linux y PostgreSQL real.

## 2026-10-27 — Claude Code (Mac) · /goal MVP de la cartera

- **Hecho:** definición MVP en `docs/MVP.md` (canónica en `AI_OS/PROJECTS/_mvp/`). Sprint 1 en la rama local `mvp/sprint1-2026-10-27` (2 commits, gate conclave pasado, sin push).
- **Pendiente:** revisión del operador → merge → deploy. Backlog con IDs en `docs/MVP.md` §7.
- **Decidido:** T1-T8 de la cartera (ICP hotel independiente 20-100 hab., precios, abogado ya, CRM Airtable).

## 2026-10-28 — Claude Code (Mac) · turno de noche desatendido

Rama local `noche/relevo-2026-10-28` (desde `d4accaf`), sin push.

### Hecho
- **F5** (`3be69d0`): `ServiceWorker.tsx` solo registra `/sw.js` en producción; en desarrollo y test
  desregistra el que quedara. Test nuevo visto en rojo (2 fallos) → verde.
- **Arnés** (`891ff1d`): `tests/harness/pg.ts` lanza `initdb`/`pg_ctl` con `LC_ALL=C`, como Supply.
  Test con binarios falsos que registran el `LC_ALL` recibido, visto en rojo (`es_ES.UTF-8`) → verde.
  Ojo: esta noche el fallo real («postmaster became multithreaded») **no se reprodujo** en este Mac;
  la suite ya pasaba sin `LC_ALL=C`. El arreglo es preventivo y alinea con Supply.
- **Dependabot #13** (`3e9ab4e`, vite 8.3.4) y **#14** (`8c2d1b4`, vitest/@vitest/mocker 5.0.5):
  aplicados uno tras otro; con cada uno lint 0, tipos 0, 607/607 vitest, build y 28/28 e2e contra
  Supabase local (con #14 también 259/259 RLS). #14 sola sobre la base: 607/607 y tipos 0.
- **Extra, rama aparte** `noche/next-16.4.3-2026-10-28` (`b9d6203`): `npm audit --omit=dev` daba
  1 crítico en `next` ≤ 16.4.0 (RCE en Image Optimization con SVG, RCE en `use cache`, DoS en
  Server Actions). Next y eslint-config-next 16.4.3 exactas: 0 vulnerabilidades, todo verde (28/28 e2e).

### Pendiente
- Operador: decidir push/PR de esta rama (o cerrar #13/#14 y dejar que dependabot rebasee) y de
  la rama de Next 16.4.3.
- PR #12 (clasificador de oficio): sigue fuera del MVP; ver informe de la noche.

### Decidido
- vite fijada a 8.3.4 exacta para evaluar la PR tal cual (npm habría elegido 8.3.5).
- El bump de Next va en rama aparte: es un minor del framework fuera del encargo.
