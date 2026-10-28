<!-- COPIA de AI_OS/PROJECTS/_mvp/blindbeds-relevo.MVP.md (27/10/2026). La fuente canónica es la del AI_OS: editar allí y recopiar. -->

# Blindbeds Relevo — definición MVP (v1.0 · 27/10/2026)

> Estado: **DEFINIDO · 🧊 CONGELADO** hasta que haya un hotel externo interesado (T3). El backlog queda listo para ejecutarse en unos 2 sprints al descongelar. Cartera: [00_CARTERA_MVP](00_CARTERA_MVP.md)
> Repo `~/MAIN_PROYECTOS/blindbeds-relevo` (`main@b1db8a6`, **repo público**) · **sin producción** · Next 16, Supabase (enlace mágico, RLS), Vitest con Postgres real en CI.

## 1. En una frase
**Relevo de turno y partes de avería** en el móvil: el turno saliente deja lo pendiente, el entrante lo ve y lo resuelve; las averías se abren con foto y QR del activo y se siguen hasta cerrarlas.

## 2. Usuario y comprador
- **Usuarios:** recepción, pisos y mantenimiento.
- **Comprador:** director o propietario de hotel independiente, 20-100 habitaciones (T1).
- **Nombre:** «Relevo de turno y partes de avería» (deja de llamarse «Suite»).

## 3. Promesa
- **SÍ:** «lo que pasa en tu turno no se pierde en una libreta ni en WhatsApp; cada avería tiene dueño, estado y foto».
- **NO (hasta construirlo):** notificación «al instante», «3 campos en 60 s», clasificación automática de averías, integración con el PMS.
- **Copy de Audit y de la web a corregir** (A3).

## 4. Flujo MVP
El operador da de alta la organización y los usuarios (SQL o runbook) → login por enlace mágico **que funcione** → panel con pendientes y partes (abiertos + en curso) → nuevo relevo de 4 bloques (**RPC atómica**) → **lista de relevos con turno, departamento, autor y hora** → resolver pendientes → nuevo parte con prioridad, foto opcional y QR **o código manual** → abierto → en curso → cerrado, con la foto visible.

## 5. Alcance

| | Elemento | Estado 27/10 |
|---|---|---|
| MUST | Login por enlace mágico (R1: `emailRedirectTo` → `/auth/callback`) + errores visibles (R4) | ❌ S (verificar con Supabase real) |
| MUST | Supabase propio (desechable para la demo; Pro con el piloto) + Vercel + URLs de auth | ❌ S (operador: OK de recurso) |
| MUST | Iconos de la PWA 192 y 512 | ❌ S (activo de marca) |
| MUST | Pantalla de relevos (lista + detalle) | ❌ M |
| MUST | Relevo atómico (RPC) | ❌ S |
| MUST | Foto visible en el parte (URL firmada) · «en curso» visible por defecto | ❌ S |
| MUST | Código de activo manual (D7 b) | ❌ S |
| MUST | Privacidad + retención + información a la plantilla (datos de empleados) | ❌ M (abogado) |
| MUST | **Minimización del texto libre:** aviso junto a cada campo («sin nombres de huéspedes ni datos de salud; usa nº de habitación»), retención de relevos 90 días con borrado automático, borrado manual de un ítem por el admin y procedimiento de incidente si se cuela un dato sensible | ❌ S-M |
| ✅ | RLS en 7 tablas, FK por organización, storage por organización, proxy que falla cerrado, estados atómicos, QR con escáner, validación | ✅ |
| SHOULD | Invitación de usuarios desde la app · restringir columnas editables · email de partes críticos · asignar técnico · analítica · `created_by` con `on delete` para poder suprimir usuarios | — |
| OUT | Clasificador de oficio con LLM (**PR #12 abierto, fuera del MVP**) · PMS · offline · informes PDF · multiidioma · selector de varios hoteles · push | — |

## 6. Criterios de aceptación (DoD)
- [ ] Plantilla de email de Supabase y `emailRedirectTo` documentados en el runbook (enlace → `/auth/callback?code=…`); smoke con correo real: email nuevo → enlace → `/dashboard` con sesión, en iOS Safari y Android Chrome. Hasta ese smoke, R1 es «no verificado», no «roto».
  - ✅ 28/10 documentado: `20_ACTIVACION_SUPABASE.md` §1 paso 5 (plantilla `token_hash` → `/auth/confirm`, válida en cualquier navegador) y §6 (smoke). Probado en local: `e2e/05-enlace-token-hash.spec.ts` y el login completo vía Mailpit (`e2e/01-guion.spec.ts`).
  - ⏳ Falta el smoke con correo real en iOS y Android: exige un Supabase y un despliegue en la nube, que no existen (producto congelado).
- [x] Relevo de 4 bloques atómico: si falla un ítem, quedan 0 filas (test con Postgres efímero).
- [x] El turno entrante ve el último relevo de su departamento con turno, autor y hora.
- [x] Parte con foto JPEG ≤ 10 MB visible por URL firmada; otra organización → 403.
- [x] Abierto → en curso → cerrado deja 2 filas en `ticket_updates`; un parte cerrado no se reabre.
- [x] Lighthouse «installable» en verde. *(Lighthouse 12 ya no tiene categoría PWA y Chromium headless no informa de la instalabilidad; se comprueban los requisitos de Chrome sobre el manifest en `tests/public/icons.test.ts`.)*
- [x] CI: lint + typecheck + test:rls + build en verde.
- [x] Aviso de minimización visible en los campos de texto libre y job de retención (90 días) con test.

**Evidencia (28/10/2026, rama `noche/relevo-2026-10-28`):** atómico → `tests/db/create-handover.test.ts` («0 filas»); turno entrante → `e2e/01-guion.spec.ts` R3-R4 y `tests/components/HandoverList.test.tsx`; foto → `e2e/04-fotos.spec.ts` contra el Storage local real (URL firmada 200 en el hotel, denegada a otro hotel, subida ajena y > 10 MB rechazadas); historial → `tests/db/rls.test.ts` («2 filas… no se reabre»); CI → `.github/workflows/ci.yml` en verde en el PR #15; minimización y retención → `HandoverForm.test.tsx` y `tests/db/retention-directory.test.ts`. Todos los tests nuevos se vieron en rojo antes que en verde.

**Validación comercial (después del DoD técnico, no forma parte de él):** piloto de 2 semanas en un hotel **externo** con ≥ 1 relevo por turno al día. El interés de un hotel externo **descongela** el producto; el piloto **valida** después.

## 7. Backlog hasta MVP (al descongelar)
| # | Tarea | Tamaño | Dueño |
|---|---|---|---|
| R1 | Login: callback + errores (se puede hacer ya, en rama) | S | Claude |
| R2 | RPC de relevo atómico + test | S | Claude |
| R3 | Pantalla de relevos | M | Claude |
| R4 | Foto en el parte + «en curso» por defecto + código manual | S | Claude |
| R5 | Iconos de la PWA | S | Operador (o Claude con el logo BBS1) |
| R6 | Infra: Supabase desechable + Vercel | S | Operador da el OK |
| R7 | Privacidad, retención e información a la plantilla | M | Abogado |
| R8 | Documentación: README:87, `docs/33` (policies ya existen), `node_modules` locales (`npm ci`) | S | Claude |

## 8. Negocio y métrica
- **Precio (T4):** 39 €/hotel/mes. Sin alta en el MVP. Posible paquete con APPCC más adelante.
- **Norte:** hoteles con ≥ 5 días/semana con relevo en ≥ 2 turnos durante 4 semanas.
- **Piloto:** ≥ 80 % de turnos con relevo · mediana de cierre de partes críticos < 24 h · 1 hotel externo pasa a pago o firma una carta de intención.
- **Descongelar cuando:** un lead del embudo (Audit FR-005/FR-006) pida demo de relevo o averías.

## 9. Riesgos
- **Monitorización laboral (RGPD):** autoría y hora de cada acción → informar a la plantilla, base jurídica, rol de encargado frente al hotel.
- **Datos de huéspedes en texto libre** (VIPs, incidencias).
- **Repo público:** no subir nunca datos ni `.env`.
- **Dispositivo compartido en recepción:** rompe la trazabilidad. Recomendar una cuenta por persona.
- **PR #12:** la categoría la pone en el ítem del relevo y debería ir en `maintenance_tickets`. Se queda abierto como visión.

## 10. Decisiones
- **Cerradas:** T3 congelado · T4 39 € · T1.
- **Por defecto:** infra desechable → Pro con piloto · código manual · sin notificaciones · foto opcional · nombre «Relevo de turno y partes de avería» · PR #12 abierto.
- **Abiertas:** primer hotel piloto (externo; Soho solo con datos ficticios en local).
