# Propuesta: categoría de oficio automática en las incidencias del relevo

> **Estado:** propuesta en borrador, sin código de producto. La decisión es del operador.

## El hueco
Las incidencias del relevo de turno son uno de los cuatro bloques (`pendientes`, `vips`, `incidencias`, `avisos`;
ver `supabase/migrations/000001_baseline.sql` y `src/types/index.ts`). Hoy no llevan **categoría de oficio**, así
que mantenimiento no puede filtrar «lo mío» ni medir qué falla más.

## Qué proponemos
Un campo opcional `categoria` en los ítems del bloque `incidencias`, con 6 valores:
`fontaneria`, `electricidad`, `climatizacion`, `carpinteria_mobiliario`, `electrodomesticos`, `limpieza_plagas`.
El sistema **sugiere** la categoría al escribir la incidencia y la persona la confirma o la cambia.

## Evidencia del laboratorio
Se probó un clasificador sobre partes escritos como los escribe el personal (abreviaturas, faltas, jerga):

| Prueba | Acierto |
|---|---|
| Piloto, evaluado con un banco oculto de 60 partes escrito por otro modelo (Codex) | 91,7 % |
| Segunda versión, con las lecciones del piloto, mismo banco oculto | **98,3 %** (1 error de 60) |

El clasificador combina reglas de palabras clave y alias (`wc`, `a/a`, `micro`, `calef.`…) con un modelo de
lenguaje **local** (Qwen3.5-9B en el Mac) y ejemplos. Ningún parte salió del equipo durante las pruebas.

## La decisión de diseño importante: la frontera de datos
Relevo corre en la nube (Vercel + Supabase). Una incidencia puede contener datos de huéspedes o del hotel, así que
**no se debe enviar a un modelo en la nube**. Opciones, de menos a más:
1. **Solo reglas en TypeScript** (portar las palabras clave y alias del laboratorio). Sin modelo, sin frontera, sugerencia
   instantánea. Cubriría la mayoría de los casos claros; los ambiguos quedan a elección de la persona. **Recomendada para empezar.**
2. **Modelo local** en una instalación propia (cuando un cliente lo pida on-premise).
3. Modelo en la nube **solo** si se garantiza que el texto no lleva datos personales. No recomendada.

## Antes de construir
- Validar con partes **reales anonimizados** de un hotel piloto: el laboratorio solo ha usado datos sintéticos.
- Ajustar las 6 categorías con el equipo de mantenimiento.
- Medir la opción 1 con el mismo banco oculto (está en el laboratorio, `.verificacion-oculta/clasificador-averias/`).

## Origen
Pieza adoptada del laboratorio `proyectos-lab` el 2026-10-20.

- Experimento: `20261019-2340-clasificador-averias` (rama `exp/20261019-2340-clasificador-averias`, commit `8ab9d5c`)
- Re-verificación en el momento de adoptar (tests propios + ocultos de otro autor):
  - evaluar.py → {"n": 40, "accuracy": 1.0, "confusion": {"fontaneria": {"fontaneria": 6, "electricidad": 0, "climatizacion": 0, "carpinteria_mobiliario": 0, "electrodomesticos": 0, "limpieza_plagas": 0}, "electricidad": {"fontaneria": 0, "electricidad": 7, "climatizacion": 0, "carpinteria_mobiliario": 0, "electrodomesticos": 0, "limpieza_plagas": 0}, "climatizacion": {"fontaneria": 0, "electricidad": 0, "climatizacion": 7, "carpinteria_mobiliario": 0, "electrodomesticos": 0, "limpieza_plagas": 0}, "carpinteria_mobiliario": {"fontaneria": 0, "electricidad": 0, "climatizacion": 0, "carpinteria_mobiliario": 7, "electrodomesticos": 0, "limpieza_plagas": 0}, "electrodomesticos": {"fontaneria": 0, "electricidad": 0, "climatizacion": 0, "carpinteria_mobiliario": 0, "electrodomesticos": 6, "limpieza_plagas": 0}, "limpieza_plagas": {"fontaneria": 0, "electricidad": 0, "climatizacion": 0, "carpinteria_mobiliario": 0, "electrodomesticos": 0, "limpieza_plagas": 7}}}
  - accuracy OK 1.0
  - solo local: OK
  - OCULTO (Codex, 60): accuracy 0.983 · errores {'fontaneria->limpieza_plagas': 1}
- Datos: solo sintéticos. Cualquier uso con datos reales de Soho o clientes: solo en local.

