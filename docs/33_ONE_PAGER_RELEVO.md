# Blindbeds Relevo — One-pager comercial

> **BORRADOR · no distribuir.** Redactado el 2026-10-15 a partir del código de este
> repositorio y de la investigación de competencia del 15/10. Todo lo marcado
> **[VERIFICAR]** lo tiene que confirmar el operador antes de enseñarlo a un cliente.
> La tabla del final ("Trazabilidad") dice de dónde sale cada afirmación.

---

## El relevo de turno y los partes de avería de tu hotel, en el móvil y en español

**El problema, en una frase:** lo que el turno de noche tiene que contarle al de mañana
se queda en una libreta o se pierde en el WhatsApp, y la avería de la 304 vuelve a
salir cuando el siguiente huésped ya se ha quejado.

### Para quién

Hoteles independientes de **20 a 80 habitaciones** en España [VERIFICAR rango], con
recepción en tres turnos (mañana, tarde, noche), uno o dos técnicos de mantenimiento
(o uno externo) y que hoy se organizan con **libreta de relevos + grupo de WhatsApp**.
Quien decide: dirección o propiedad. Quien lo usa cada día: recepción, pisos y
mantenimiento.

### Qué obtienes

1. **Ningún pendiente se queda por el camino.** Cada turno deja su relevo en cuatro
   apartados —pendientes, VIPs, incidencias y avisos— y lo que no se ha resuelto sigue
   a la vista del turno siguiente hasta que alguien lo marca como resuelto. Queda
   registrado quién lo cerró y cuándo.
2. **Averías claras desde el primer aviso.** Un parte con título, descripción,
   prioridad (crítica, alta, normal, baja) y foto hecha con el móvil. Si el equipo o la
   habitación tienen un QR, se escanea y el parte queda asociado a ese activo.
3. **Una sola pantalla para saber cómo está el hotel.** El panel muestra los pendientes
   sin resolver y los partes de avería abiertos o en curso; mantenimiento los pasa a
   «en curso» y a «cerrado» desde el propio móvil.

### Cómo funciona, en 3 pasos

1. **Entras con tu email.** Te llega un enlace y entras sin contraseña. Se añade a la
   pantalla de inicio del móvil como una app, sin pasar por la tienda de aplicaciones
   [VERIFICAR en iPhone y Android].
2. **Al acabar el turno, rellenas el relevo** (departamento, turno y los cuatro
   apartados; basta con uno). Si ves una avería, abres un parte, haces la foto y eliges
   la prioridad.
3. **El siguiente turno lo ve al entrar**: pendientes abiertos y partes activos en el
   panel. Lo resuelto se cierra y deja rastro.

### En qué se diferencia

| Si hoy usas… | Lo que suele pasar | Lo que cambia con Relevo |
|---|---|---|
| Libreta y WhatsApp | Cero formación, pero los pendientes se pierden entre mensajes y no hay rastro de quién cerró qué | Igual de sencillo, pero cada pendiente y cada avería tiene estado, fecha y responsable del cierre |
| Suites de operaciones hoteleras | Muy completas (housekeeping, inventario, mensajería con huésped…), normalmente con demo obligatoria y precio a medida | Solo relevo y averías: se aprende en una mañana [VERIFICAR con piloto] |
| Programas de mantenimiento genéricos (CMMS) | Pensados para técnicos y órdenes de trabajo; el relevo de turno es un extra; a menudo se cobra por usuario | El relevo de turno es el centro y de ahí salen las averías |
| Plataformas de experiencia del huésped con cuaderno de consignas | El cuaderno viene dentro de un paquete más grande | Se contrata solo lo que necesitas |

Hecho pensando en hoteles españoles: pantallas, departamentos (Recepción, Pisos,
F&B / Cocina, Mantenimiento) y turnos en español desde el primer día.

### Objeciones frecuentes

- **«Mi equipo ya se apaña con WhatsApp.»** — Relevo no quita el WhatsApp para hablar;
  quita que los pendientes y las averías vivan ahí. La diferencia se ve el día que
  alguien pregunta «¿quién arregló esto y cuándo?».
- **«Mi personal no es muy tecnológico.»** — Son cuatro casillas de texto y un botón de
  foto. Para entrar no hay contraseña; eso sí, **cada persona necesita un email** para
  recibir su enlace de acceso.
- **«¿Tengo que conectarlo a mi PMS?»** — No. Funciona aparte del PMS; hoy no hay
  integración con ninguno.
- **«¿Avisa al técnico cuando se abre una avería?»** — Hoy no envía notificaciones:
  mantenimiento ve los partes en su panel. Los avisos automáticos están
  **próximamente** [VERIFICAR fecha o quitar].
- **«¿Dónde están mis datos?»** — Cada hotel solo ve lo suyo (separación por
  organización probada con tests automáticos) y las fotos se guardan en un
  almacenamiento privado. Ubicación de los servidores en la UE y contrato de encargado
  de tratamiento (RGPD): [VERIFICAR].
- **«¿Cuánto cuesta? ¿Hay permanencia?»** — [PRECIO: decisión del operador].
  Permanencia, usuarios incluidos y prueba gratuita: [VERIFICAR].
- **«¿Cuánto se tarda en empezar?»** — Damos de alta tu hotel y a tu equipo nosotros;
  tú solo pegas los QR en los equipos que quieras controlar [VERIFICAR plazo y quién
  genera e imprime los QR].

### Precio

[PRECIO: decisión del operador]

### Pruébalo: demo de 20 minutos

Te enseñamos un relevo y un parte de avería de principio a fin con los turnos de tu
hotel. **Reserva tu demo:** [VERIFICAR contacto: email / teléfono / enlace de agenda].

---

## Para el operador (no forma parte del one-pager)

### Trazabilidad: qué existe hoy en el código

| Afirmación del one-pager | Estado | Dónde |
|---|---|---|
| Relevo con 4 apartados, por departamento y turno | ✅ Existe | `src/components/handover/HandoverForm.tsx`, `src/types/index.ts` |
| Basta con un apartado relleno | ✅ Existe | `src/lib/validation.ts` (`validateHandoverInput`) |
| Pendientes sin resolver persisten y se marcan como resueltos (quién y cuándo) | ✅ Existe | `src/components/handover/PendingItems.tsx` |
| Parte con título, descripción, 4 prioridades | ✅ Existe | `src/components/tickets/TicketForm.tsx` |
| Foto desde el móvil (JPEG/PNG/WebP ≤ 10 MB) | ⚠️ Existe la subida, pero **la foto es opcional** en código y **no se muestra en el listado** de partes. Además, faltan las policies de `storage.objects` (runbook §«Pendiente conocido» 1): en un Supabase real la subida fallaría hasta aplicarlas | `TicketForm.tsx`, `TicketList.tsx`, `docs/20_ACTIVACION_SUPABASE.md` |
| QR del activo asocia el parte | ✅ Existe el escaneo. ⚠️ No hay pantalla para dar de alta activos ni generar QR: se hace por SQL | `QRScanner.tsx`, `TicketForm.tsx` |
| Estados abierto → en curso → cerrado, con registro | ✅ Existe (se guarda en `ticket_updates`; no hay pantalla para ver ese historial) | `TicketList.tsx` |
| Entrada con enlace por email, sin contraseña | ✅ Existe | `src/components/auth/LoginForm.tsx` |
| Se instala como app (PWA) | ⚠️ Manifest y service worker existen, pero **faltan los iconos** `icon-192.png` / `icon-512.png` en `public/` | `public/manifest.json`, `public/sw.js` |
| Separación por hotel y fotos privadas | ✅ RLS probado (`tests/db/rls.test.ts`); bucket privado por `org_id` | README §Seguridad |
| Alta de hotel y usuarios «la hacemos nosotros» | ✅ Coherente: no hay UI de alta, se hace por SQL (runbook §4) | `docs/20_ACTIVACION_SUPABASE.md` |

### Deliberadamente fuera del one-pager (no existe hoy)

Notificaciones al técnico (push, email o WhatsApp) · ver la foto dentro del parte ·
asignar un parte a una persona (la columna `assigned_to` existe, la UI no) · historial
por habitación o equipo · informes o PDF mensuales · estado «habitación bloqueada» ·
uso sin conexión (el service worker cachea páginas, pero crear relevos y partes
necesita red) · integración con PMS · varios idiomas · marcar un relevo como leído.

### Avisos antes de enseñarlo

- **El producto no está desplegado**: no hay Supabase activado ni URL pública. La demo
  necesita un entorno de pruebas con datos ficticios [VERIFICAR].
- La pantalla de confirmación del parte dice «Mantenimiento ha sido notificado», y
  **no se notifica a nadie**. En una demo eso es una promesa falsa: conviene cambiar el
  texto (encargo de código aparte).
- El README dice que la foto es «obligatoria»; el código la deja opcional. Este
  one-pager no dice ni una cosa ni la otra.
- Comparativa: hecha por categorías, sin nombres de proveedores. Datos de origen en la
  investigación de competencia del 15/10 (fuentes públicas, sin contactar con nadie).
