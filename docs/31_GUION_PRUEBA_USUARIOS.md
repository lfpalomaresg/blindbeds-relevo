# Guion de prueba con usuarios (30-45 min)

Sesión moderada con dos personas de hotel: **un jefe/a de recepción (R)** y
**un técnico/a de mantenimiento (M)**. Objetivo: saber si el relevo y los
partes de avería encajan en su turno real, no enseñar la app.

Qué hace y qué no hace hoy el producto está en
[30_RUNBOOK_OPERACION.md](30_RUNBOOK_OPERACION.md); úsalo para no prometer nada
que no exista (ver «Límites conocidos» al final).

---

## Preparación (el día antes, 20 min)

- **Entorno de prueba desechable, nunca el de un hotel real.** Un proyecto
  Supabase creado solo para esta sesión y borrado entero al terminar (ver
  «Después de la sesión»). No compartirlo con ningún hotel: limpiarlo tabla a
  tabla no está documentado ni probado. Organización
  `Hotel Demo Relevo` y activos `ASSET-101`, `ASSET-102`, `ASSET-LIFT-1`,
  `ASSET-POOL`, `ASSET-REST` de [`scripts/seed-demo.sql`](../scripts/seed-demo.sql).
- **Datos ficticios únicamente.** Nada de nombres de clientes, números de
  reserva ni habitaciones reales. Usa las fichas de abajo. Si el participante
  empieza a dictar un caso real, pídele que lo cuente «con nombres inventados».
- Dos cuentas de email de prueba (no las personales de los participantes),
  ambas dadas de alta como `staff` en el hotel demo (§1 del runbook). Entrar
  una vez con cada una antes de la sesión para que el enlace mágico no consuma
  tiempo. Ese primer acceso sirve también de prueba del inicio de sesión, que
  aún no se ha validado (aviso en §1 del runbook): si no deja entrar, la sesión
  no puede celebrarse.
- Dos móviles (uno por participante) con la app abierta en `/dashboard`. No
  cambiar de cuenta en un mismo móvil y, al terminar, borrar los datos del
  sitio en ambos: el service worker puede servir respuestas de otra sesión
  (§5 de [30_RUNBOOK_OPERACION.md](30_RUNBOOK_OPERACION.md)).
- QR impresos en papel con el texto `ASSET-101` y `ASSET-LIFT-1` (cualquier
  generador de QR sirve: **la app no los genera todavía**). Un QR más con un
  texto inventado (`ASSET-999`) para la tarea M3.
- Una foto de prueba en cada móvil (un grifo, una bombilla… cualquier objeto
  que no identifique al hotel ni a personas).
- Comprobar antes que la subida de fotos funciona en este entorno. Si no
  (Pendiente conocido nº 1 de
  [20_ACTIVACION_SUPABASE.md](20_ACTIVACION_SUPABASE.md)), hacer la tarea M1
  igualmente y registrar el error como hallazgo, no como fallo del usuario.
- Consentimiento: explicar que se toman notas, sin grabar pantalla ni voz salvo
  permiso explícito, y que se prueba la app, no a ellos.

## Roles del equipo

- **Moderador/a:** lee las tareas, no ayuda salvo bloqueo de más de 2 minutos.
- **Observador/a:** toma notas en la hoja de observación (al final).

---

## Guion

### 0. Bienvenida (3 min)

> «Vamos a probar una herramienta para pasar el turno y avisar de averías.
> Queremos ver dónde se atasca. Si algo no se entiende, es culpa de la app.
> Piensa en voz alta mientras lo usas.»

Preguntas de contexto (1 min cada uno):

- R: «¿Cómo pasáis hoy el turno en recepción? ¿Libro, WhatsApp, de palabra?»
- M: «¿Cómo te llegan hoy las averías? ¿Cómo sabes cuáles son urgentes?»

### 1. Recepción cierra su turno (R, 8 min)

**Tarea R1 — Relevo.** «Terminas el turno de tarde. Deja el relevo para el de
noche con esto:»

> Ficha ficticia: en Pendientes, «Cliente de la 101 espera factura corregida
> antes de las 9:00». En VIPs, «Llega Sra. Prueba, aniversario, detalle en
> habitación». En Avisos, «Ascensor principal hace ruido, avisado a
> mantenimiento».

Observar:
- ¿Encuentra «Relevo de turno» sin ayuda?
- ¿Cambia departamento y turno? (Por defecto viene Recepción / **Mañana**: ¿se
  da cuenta de que debe poner Tarde?)
- ¿Entiende la diferencia entre los cuatro bloques o duda dónde va cada cosa?
- ¿Le sobra o le falta algún bloque?
- Tiempo hasta «Relevo registrado» (la portada promete «2 minutos»).

**Tarea R2 — Validación.** «Intenta registrar un relevo sin escribir nada.»
Observar si entiende el mensaje de error y si le parece razonable.

Preguntas:
- «¿Esto sustituiría lo que usáis hoy o sería una cosa más?»
- «¿Qué pasa en tu hotel si un relevo se pierde?»

### 2. Mantenimiento recibe y abre partes (M, 12 min)

**Tarea M1 — Parte con QR y foto.** «Estás en la habitación 101 y el grifo
gotea. Da parte escaneando el QR de la habitación y con foto.»

Observar:
- ¿Encuentra «Escanear QR del activo»? ¿Funciona la cámara a la primera?
- ¿Aparece «Activo: Habitación 101»?
- ¿Qué prioridad elige y por qué?
- La foto: ¿abre la cámara o la galería? ¿Qué espera que pase si no pone foto?
  (La pantalla dice que es obligatoria; el código deja enviarlo sin foto.)
- Si la subida falla: ¿entiende el mensaje? ¿Qué haría en la vida real?

**Tarea M2 — Parte sin QR.** «La piscina tiene una baldosa suelta y no
encuentras el QR. Da parte igualmente.» Observar si descubre que se puede crear
sin activo.

**Tarea M3 — QR que no existe.** «Escanea este QR» (el de `ASSET-999`).
Observar la reacción al mensaje «Activo no reconocido…».

**Tarea M4 — Trabajar la lista.** «Vuelve al panel. Ponte con la avería del
grifo y, cuando acabes, ciérrala.»

Observar:
- ¿Encuentra «En curso» y «Cerrar»?
- Tras cerrar, el parte desaparece de «Abierto»: ¿le preocupa? ¿Sabe
  encontrarlo en «Cerrado»?
- ¿Echa de menos ver la foto, el activo, a quién está asignado o dejar un
  comentario? (Ninguno existe hoy; no lo anticipes, deja que lo pida.)

Preguntas:
- «¿Cómo sabrías que hay un parte nuevo si no tienes la app abierta?»
  (No hay notificaciones: la respuesta indica cuánto importa.)
- «¿Quién debería poder cerrar un parte? ¿Y cambiar la prioridad?»

### 3. Recepción entra al turno siguiente (R, 6 min)

**Tarea R3 — Leer el relevo.** «Ahora eres el turno de noche. Entras. ¿Qué
tienes pendiente?»

Observar:
- ¿Mira «Pendientes sin resolver» en el panel?
- ¿Le molesta que VIPs y Avisos aparezcan como «pendientes»?
- ¿Echa en falta ver quién escribió el relevo y de qué turno era? (La lista no
  lo muestra.)

**Tarea R4 — Resolver.** «La factura ya está corregida. Márcalo.» Luego:
«Te has equivocado, no estaba resuelto. Deshazlo.» (No hay forma: observar qué
intenta y cuánto le preocupa.)

**Tarea R5 — Ver la avería.** «¿Sabes si el grifo de la 101 está arreglado?»
Observar si cruza a la lista de partes y usa el filtro.

### 4. Cierre conjunto (6 min)

Con los dos juntos:
- «Del 1 al 5, ¿lo usaríais mañana en un turno real? ¿Qué falta para un 5?»
- «¿Qué es lo primero que quitaríais?»
- «¿Quién en el hotel debería dar de alta a los compañeros?» (Hoy lo hace el
  operador por SQL.)
- «Si tenéis mala cobertura en sótanos o cuartos de máquinas, ¿cómo lo hacéis
  ahora?»

Agradecer y recordar que los datos de la sesión son ficticios y se borran.

---

## Hoja de observación (una por participante)

| Tarea | ¿Completa sin ayuda? (sí / con ayuda / no) | Tiempo | Errores o dudas | Cita literal |
|---|---|---|---|---|
| R1 relevo | | | | |
| R2 validación | | | | |
| R3 leer relevo | | | | |
| R4 resolver/deshacer | | | | |
| R5 ver avería | | | | |
| M1 QR + foto | | | | |
| M2 sin QR | | | | |
| M3 QR inválido | | | | |
| M4 en curso / cerrar | | | | |

Al terminar, el observador resume en tres líneas: **lo que bloquea**, **lo que
molesta**, **lo que pidieron sin que se lo sugiriéramos**.

## Límites conocidos (no prometer)

Según [30_RUNBOOK_OPERACION.md](30_RUNBOOK_OPERACION.md): no hay notificaciones,
no se ve la foto de un parte, no hay asignación ni comentarios, no se puede
reabrir un parte ni deshacer un «Resolver», no hay histórico de relevos ni
«leído por», no hay alta de usuarios ni de activos desde la app, y `supervisor`
no tiene hoy más permisos que `staff`. Si preguntan, responder «lo anotamos» y
registrarlo como petición.

## Después de la sesión

- **Desechar el entorno entero**: el operador borra el proyecto Supabase de
  prueba desde su dashboard (eso elimina base de datos, usuarios de `auth` y
  bucket de fotos a la vez) y quita las variables de ese proyecto del despliegue
  de prueba. Si hay que repetir la sesión, se crea otro con
  [20_ACTIVACION_SUPABASE.md](20_ACTIVACION_SUPABASE.md).
- **No intentar limpiar borrando relevos, partes o fotos sueltos.** No hay
  borrado en la app ni política `delete` en esas tablas
  (`supabase/migrations/000001_baseline.sql:159-206`); las fotos del bucket
  privado no desaparecen al borrar el parte y pueden quedar huérfanas
  (§4 de [30_RUNBOOK_OPERACION.md](30_RUNBOOK_OPERACION.md)). Una limpieza
  parcial no está documentada ni probada.
- Pasar los hallazgos a `docs/10_SESSION_NOTES.md` sin nombres de los
  participantes (usar «R» y «M» y el tipo de hotel).
