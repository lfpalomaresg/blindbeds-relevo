# 32 — Textos frente a realidad (UI, README y metadatos)

Encargo f6-relevo-textos-ui, 15/10/2026. Origen: la pasada de mvp-up del 15/10
(2,9/10) señaló que la UI y el README prometen cosas que el producto no hace.

Alcance: se corrigen **solo errores de hecho** (un texto que dice que algo existe
o funciona y no es así). Posicionamiento, tono y propuesta de valor se dejan como
están y aparecen al final como decisiones para el operador.

Las referencias son `fichero:línea` del estado **después** de este encargo; en
las filas corregidas se cita también el texto anterior. Fijado por
`tests/lib/ui-copy.test.ts`, `tests/components/QRScanner.test.tsx` y un caso
nuevo en `tests/components/TicketForm.test.tsx`.

Leyenda: ✅ cierto · ❌ falso, corregido · ⚠️ dudoso o fuera de alcance (decide el operador) · 🔎 no verificable sin un Supabase real

## 1. Metadatos

| Promesa | Dónde | Realidad (código) | Veredicto |
|---|---|---|---|
| Título «Blindbeds Relevo» | `src/app/layout.tsx:6`, `public/manifest.json` | Nombre del producto | ✅ |
| «Suite de operaciones para hoteles: handover de turno y partes de avería» | `src/app/layout.tsx:7` | Hay exactamente esos dos módulos (`src/app/handover/new`, `src/app/tickets/new`). «Suite» es posicionamiento | ✅ / ⚠️ D1 |
| Manifest «Suite de operaciones para hoteles» | `public/manifest.json` | Igual que arriba | ⚠️ D1 |
| Iconos `/icon-192.png` y `/icon-512.png` | `public/manifest.json` | **No existen** en `public/`. El navegador no puede instalar la PWA con iconos rotos | ⚠️ D4 (es un activo gráfico, no un texto) |

## 2. Textos de la UI (`src/`)

| Promesa | Dónde | Realidad (código) | Veredicto |
|---|---|---|---|
| Login: «Suite de operaciones para tu hotel» | `src/app/login/page.tsx:9` | Posicionamiento | ⚠️ D1 |
| Login: «Te hemos enviado un enlace mágico… Haz clic en él para acceder» | `src/components/auth/LoginForm.tsx:36` | Se llama a `signInWithOtp` (`LoginForm.tsx:18`), así que el correo sale. Pero `emailRedirectTo` es la raíz del sitio (`LoginForm.tsx:20`), no `/auth/callback` ni `/auth/confirm`; la raíz está protegida por `src/proxy.ts:48-50`, que manda a `/login` sin sesión. Con la plantilla de correo por defecto de Supabase, el `?code=` se pierde y el clic no inicia sesión | 🔎 riesgo alto, ver R1 |
| Panel: «Resumen operativo **del día**» | `src/app/dashboard/page.tsx:17` (antes) | `PendingItems` y `TicketList` no filtran por fecha (`src/components/handover/PendingItems.tsx:20-25`, `src/components/tickets/TicketList.tsx:22-27`) | ❌ → «Resumen operativo» |
| Panel: «Registra el traspaso de tu turno en 2 minutos» | `src/app/dashboard/page.tsx:29` | Nadie lo ha medido; es una promesa comercial | ⚠️ D2 |
| Panel: «Reporta una avería con foto y prioridad» | `src/app/dashboard/page.tsx:40` | El formulario tiene foto (opcional) y prioridad (`TicketForm.tsx:198-226`). La subida depende de las policies de storage (R2) | ✅ / 🔎 R2 |
| Panel: «Pendientes sin resolver» | `src/app/dashboard/page.tsx:45` | `handover_items` con `resolved = false` y botón «Resolver» (`PendingItems.tsx:24, 33-43`) | ✅ |
| Panel: «Partes de avería **activos**» | `src/app/dashboard/page.tsx:52` (antes) | El filtro por defecto es solo `abierto`: los «en curso» quedan ocultos, y los filtros «Cerrado»/«Todas» muestran cerrados (`TicketList.tsx:15, 71`) | ❌ → «Partes de avería» |
| Relevo: «Documenta el traspaso de tu turno para que el siguiente sepa exactamente qué está pasando» | `src/app/handover/new/page.tsx:16` | Formulario de 4 bloques que se guarda en `shift_handovers` + `handover_items` | ✅ (tono, D2) |
| Relevo hecho: «El siguiente turno **lo verá** al entrar» | `src/components/handover/HandoverForm.tsx:114` (antes) | Todo item nace `resolved = false` y el panel lista los no resueltos de la organización (`PendingItems.tsx:24`). Pero cualquiera puede resolverlos antes, el relevo en sí (departamento y turno) no se muestra en ninguna parte y no hay marca de «leído» (`read_by`/`read_at` no se usan). Es una garantía que el código no puede dar | ❌ → «Sus puntos quedan como pendientes en el panel de inicio hasta que alguien los resuelva.» |
| Bloque «Pendientes — Tareas sin terminar **del turno anterior**» | `src/types/index.ts:96` | Lo rellena quien termina el turno: son tareas de **su** turno para el siguiente. Más ambiguo que falso | ⚠️ D3 |
| Bloque «VIPs — Clientes especiales hoy» | `src/types/index.ts:97` | Texto libre, sin fecha | ✅ |
| Nuevo parte: «La foto es **obligatoria**» | `src/app/tickets/new/page.tsx:16` (antes) | El input no es `required` (`TicketForm.tsx:214-221`), el envío funciona sin foto (`TicketForm.tsx:63, 80`) y `photo_path` admite null en la migración. Ya figuraba en `docs/10_SESSION_NOTES.md` | ❌ → «La foto es opcional.» (exigirla: D5) |
| Nuevo parte: «Escanea el QR del activo o crea un parte manual» | `src/app/tickets/new/page.tsx:16` | Escáner con jsQR (`QRScanner.tsx`) y parte sin activo permitido (`validation.ts:125-131`) | ✅ |
| Parte creado: «Mantenimiento **ha sido notificado**» | `src/components/tickets/TicketForm.tsx:123` (antes) | No hay notificaciones de ningún tipo (ni correo, ni push, ni realtime): solo un `insert` en `maintenance_tickets` (`TicketForm.tsx:94-103`) | ❌ → «Queda abierto y visible en el panel de inicio.» (notificar: D6) |
| Escáner: «📷 Acceso a cámara **denegado**» | `src/components/tickets/QRScanner.tsx:85` (antes 82) | Cualquier fallo de `getUserMedia` (sin cámara, contexto no HTTPS, permiso) cae en el mismo `catch` (`QRScanner.tsx:35-39`) | ❌ → «📷 Cámara no disponible» |
| Escáner: «No se pudo acceder a la cámara. **Verifica los permisos.**» | `src/components/tickets/QRScanner.tsx:38` (antes 35) | Mismo `catch` para todos los fallos: la referencia a permisos solo vale para `NotAllowedError` | ❌ → «No se pudo acceder a la cámara.» |
| Escáner: «**Permite el acceso** desde la configuración del navegador» | `src/components/tickets/QRScanner.tsx:86-90` (antes 83) | Se mostraba ante cualquier fallo. Ahora solo aparece con `NotAllowedError`; en los demás casos: «Comprueba que el dispositivo tiene cámara y que la página se abre por HTTPS» | ❌ → condicionado al tipo de error |
| Escáner: botón «**Introducir código manualmente**» | `src/components/tickets/QRScanner.tsx:95` (antes 88) | Solo llama a `onClose`; no existe ningún campo para teclear el código | ❌ → «Continuar sin escanear» (campo manual: D7) |
| Foto: «JPEG, PNG o WebP, máximo 10 MB» | `src/components/tickets/TicketForm.tsx:222` | `validatePhoto` (`src/lib/validation.ts:148-160`) y límite del bucket en la migración | ✅ |
| Lista vacía: «No hay partes en cursos.» | `src/components/tickets/TicketList.tsx:88` | Pluraliza añadiendo «s» a «en curso». Errata, no promesa | ⚠️ fuera de alcance |

## 3. README

| Promesa | Dónde | Realidad (código) | Veredicto |
|---|---|---|---|
| «Suite de operaciones para hoteles» | `README.md:1` | Posicionamiento | ⚠️ D1 |
| «PWA mobile-first» | `README.md:4` | Hay manifest y service worker, pero sin iconos (ver §1) | ⚠️ D4 |
| «PWA: Manifest + service worker **ready**» | `README.md:15` (antes) | Faltan los iconos del manifest. Además `public/sw.js` es cache-first para **todas** las peticiones GET, incluidas las de la API de Supabase y las páginas protegidas, así que puede servir datos o páginas antiguas (R3) | ❌ → «básicos; faltan los iconos…» |
| Auth con magic link | `README.md:11, 22` | Es el método elegido: se usa `signInWithOtp` | ✅ |
| «Auth vía Supabase con magic link» presentado como algo que funciona | `README.md:92` | Que se llame a `signInWithOtp` no prueba que el flujo funcione: nadie canjea el `code` (R1) | ❌ → «Flujo pendiente de verificar…» con enlace a R1 |
| Estructura de `src/`, `supabase/`, `tests/`, `docs/` | `README.md:18-49` | Coincide con el árbol (se añade este documento) | ✅ |
| `cp .env.local.example .env.local` | `README.md` (Arranque local) | El fichero existe (no se ha abierto) | ✅ |
| Despliegue en Vercel: configurar `SUPABASE_SERVICE_ROLE_KEY` | `README.md:77` (antes) | `src/lib/supabase/admin.ts` la lee, pero **ningún** fichero de la app importa ese cliente. Solo la exige `scripts/setup-supabase-pro.sh:38`, desde `.env.local`, y ese mismo script (`:111-113`) y `docs/20_ACTIVACION_SUPABASE.md:78-79` prohíben llevarla a Vercel. Entregaba una credencial con privilegios totales sin necesidad | ❌ → solo las dos variables públicas, con «Nunca `SUPABASE_SERVICE_ROLE_KEY`» |
| Handover: «Formulario estructurado de 4 bloques… Los items no resueltos persisten hasta que alguien los cierra» | `README.md:84` | `HANDOVER_BLOCKS` (4) y botón «Resolver» | ✅ |
| Averías: «foto **obligatoria**» | `README.md:87` (antes) | Ver fila de la UI | ❌ → «foto opcional» |
| Averías: «**trazabilidad completa** por activo» | `README.md:87` (antes) | Cada cambio de estado inserta en `ticket_updates`, solo con `status_to`: sin `status_from` y sin comprobar errores (`TicketList.tsx:48-52`). No hay pantalla de historial, ni vista por activo, ni consulta por `asset_id` | ❌ → se describe lo que hay |
| Averías: «QR scannable por habitación/equipo» | `README.md:87` | El escaneo funciona, pero los activos y sus QR solo se dan de alta por SQL (`docs/20_ACTIVACION_SUPABASE.md:74`) y no se generan QR imprimibles (`jspdf` está en dependencias sin usarse) | ✅ con matiz añadido |
| «RLS en las 7 tablas públicas» | `README.md:91` | 7 `enable row level security` en `supabase/migrations/000001_baseline.sql:137-143` | ✅ |
| `src/proxy.ts` protege todo salvo login, callbacks y PWA; falla cerrado | `README.md:93` | `src/proxy.ts:11-50`, `src/lib/auth-paths.ts:7-21` | ✅ |
| Validación: catálogos, longitudes, fotos ≤ 10 MB JPEG/PNG/WebP | `README.md:94` | `src/lib/validation.ts` | ✅ |
| Fotos en bucket privado «**scoped por org_id**» | `README.md:95` (antes) | El bucket es privado y el cliente construye `<org_id>/<uuid>.<ext>` (`validation.ts:167-172`). Al redactar este inventario la migración no tenía policies en `storage.objects`; desde `000003_storage_policies.sql` (relevo#2) SELECT/INSERT/DELETE exigen que la 1.ª carpeta sea una org activa del usuario, así que el servidor sí impone el aislamiento | ❌ → ✅ desde `000003_storage_policies.sql` (relevo#2, `98a2dd2`): policies limitan la 1.ª carpeta al `org_id` de la membresía |
| «Policies RLS probadas en `tests/db/rls.test.ts`» | `README.md:96` | Existe y corre sobre Postgres efímero | ✅ |

## 4. Riesgos funcionales detectados (no son textos; no se han tocado)

- **R1 — El enlace mágico probablemente no inicia sesión.** ✅ *Corregido en la rama `mvp/sprint1-2026-10-27` (27/10): `emailRedirectTo` → `/auth/callback` y cliente de navegador de `@supabase/ssr` (PKCE + cookies); pendiente de probar en un Supabase real. Nota conservada como histórico.* `emailRedirectTo` apunta
  a la raíz, que el proxy redirige a `/login` sin sesión, y nadie canjea el `code`.
  Solo funcionaría si la plantilla de correo de Supabase se cambia para usar
  `/auth/confirm?token_hash=…`, y el runbook no lo indica. Sin un Supabase real no
  se puede comprobar. Arreglo probable: `emailRedirectTo: origin + "/auth/callback"`.
- **R2 — Subida de fotos y aislamiento.** ✅ *Resuelto en main por `000003_storage_policies.sql` (relevo#2, 16/10); nota conservada como histórico.* Sin policies en `storage.objects`, Supabase
  rechaza por defecto las subidas de usuarios autenticados: el parte con foto
  fallaría con «Error al subir la foto». Si se añaden policies, tienen que limitar
  la primera carpeta al `org_id` de la membresía, porque si no cualquier usuario
  podría leer fotos de otra organización.
- **R3 — Service worker cache-first global.** `public/sw.js` responde primero con la
  caché a cualquier GET, también a los de la API de Supabase, y precachea páginas
  protegidas (que sin sesión son la página de login). Puede mostrar datos viejos
  o la página equivocada.
- **R4 — Errores de login mudos.** El proxy y los callbacks redirigen con
  `?error=config|auth`, pero `/login` no lee ese parámetro y no muestra nada.

## 5. Decisiones para el operador

- **D1 — «Suite de operaciones».** Hoy son dos módulos.
  a) Mantener «suite» como visión de producto · b) «Relevo de turno y partes de
  avería para hoteles» · c) Mantenerlo en marketing y quitarlo de la UI de login.
  *Recomendación: b*. Describe lo que hay y no cierra la puerta a crecer.
- **D2 — «en 2 minutos».** a) Mantener · b) Medirlo con 3–5 usuarios reales antes
  de afirmarlo · c) Quitar la cifra. *Recomendación: b; si no se mide, c.*
- **D3 — Descripción del bloque «Pendientes».** a) Dejarla · b) «Tareas que quedan
  sin terminar en tu turno». *Recomendación: b*, porque quien escribe es el turno
  saliente.
- **D4 — Iconos de la PWA.** a) Encargar los iconos 192/512 con la marca · b) Quitar
  la entrada `icons` del manifest y dejar de anunciar PWA · c) Generar iconos
  provisionales. *Recomendación: a* (c como puente), junto con revisar R3.
- **D5 — Foto obligatoria (FR-006).** a) Dejarla opcional (como dice ya la UI) ·
  b) Exigirla en el formulario y con `photo_path not null` en la BD.
  *Recomendación: resolver antes R2.* Mientras la subida pueda fallar, exigir la
  foto bloquearía la creación de partes. Después, b si el proceso del hotel la necesita.
- **D6 — Notificar a mantenimiento.** a) Sin notificación (el texto ya no la
  promete) · b) Correo a los supervisores/mantenimiento de la org · c) Realtime/push
  en el panel. *Recomendación: a ahora; b cuando haya usuarios reales.*
- **D7 — Código manual cuando no hay cámara.** a) Seguir sin escanear (actual) ·
  b) Añadir un campo para teclear el código QR (`ticket_assets.qr_code`).
  *Recomendación: b*, que es barato y útil en móviles sin permiso de cámara.
- ~~D8~~ — `SUPABASE_SERVICE_ROLE_KEY` en el despliegue: ya no es una decisión
  pendiente. Contradecía el runbook y el script, así que se ha corregido como
  error de hecho (ver §3). Si algún día la app la necesita, irá en una variable de
  servidor con revisión propia.
