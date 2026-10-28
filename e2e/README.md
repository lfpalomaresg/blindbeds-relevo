# Recorridos sintéticos (Playwright)

Recorren la app como un usuario, en vista de móvil (Chromium, Pixel 7), contra **Supabase local**.
Los datos son ficticios (`supabase/seed.sql`). El login por enlace mágico es desatendido: el
enlace se lee del buzón local (Mailpit, `127.0.0.1:54324`).

```bash
supabase start              # una vez; Docker en marcha
npm run test:e2e            # resetea la BD (migraciones + seed) y ejecuta todo
npx playwright show-report e2e-results/html
E2E_SKIP_RESET=1 npm run test:e2e   # sin resetear la BD (más rápido al iterar)
```

**Se niega a ejecutar** si la app no fuera a usar `http://127.0.0.1:54321` (`e2e/local-guard.ts`,
probado en `tests/e2e/local-guard.test.ts`): estos recorridos crean y borran datos y nunca deben
tocar un proyecto en la nube. Lo comprueba `playwright.config.ts` al cargarse, antes de arrancar
nada, y mira la URL que vería Next: la de la terminal si la hay, si no la de `.env.local`.

La suite arranca **su propio** `next dev` en el puerto 3300 y nunca reutiliza uno que ya esté en
marcha (podría llevar otras variables). Como Next no deja dos `next dev` en la misma carpeta,
**para el `npm run dev` que tengas abierto** antes de lanzarla; si no, falla con
«Another next dev server is already running». El buzón de Mailpit se vacía y se comprueba vacío.

| Fichero | Qué cubre |
|---|---|
| `01-guion.spec.ts` | Tareas R1-R5 y M1-M4 de `docs/31_GUION_PRUEBA_USUARIOS.md`, en orden |
| `02-aislamiento.spec.ts` | Dos hoteles: ninguno ve datos del otro, ni por URL directa |
| `03-robustez.spec.ts` | Sin sesión, enlace reutilizado, correo sin hotel, doble clic, atrás, textos raros, fotos falsas, colores, ancho en 360/412 px |
| `04-fotos.spec.ts` | Storage real: URL firmada dentro del hotel, denegada a otro hotel, subida a carpeta ajena y > 10 MB rechazadas |
| `05-enlace-token-hash.spec.ts` | El enlace de la plantilla recomendada (`/auth/confirm?token_hash=…`) abre sesión en un navegador que no lo pidió; reutilizado, vuelve al login |

Las carencias de producto que el guion pregunta al usuario (no hay activo en la tarjeta, no se ve el
autor del pendiente…) salen como anotaciones `mejora` en el informe, no como fallos.
No cubre: escaneo de QR con cámara (solo código manual), Safari iOS, correo real, PWA sin conexión.
