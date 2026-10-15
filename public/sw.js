// Service worker de Relevo.
// Seguridad: el dispositivo de recepción es compartido. NUNCA se guardan en caché
// páginas HTML, respuestas de la API ni nada que dependa de la sesión; solo
// recursos estáticos públicos (inmutables o sin datos de usuario). Cambiar el
// nombre de la caché hace que `activate` borre las de versiones anteriores
// (relevo-v1 guardaba /dashboard y otras páginas autenticadas).
const CACHE_NAME = "relevo-static-v2";

/** Rutas same-origin que es seguro guardar: no llevan datos de sesión. */
function isCacheableStatic(url) {
  if (url.search) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname === "/manifest.json") return true;
  return /^\/icon-\d+(x\d+)?\.png$/.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Todo lo demás (navegaciones, /api, /auth, RSC...) va directo a la red
  // sin pasar por la caché.
  if (!isCacheableStatic(url)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type !== "opaqueredirect" && !response.redirected) {
            const clone = response.clone();
            event.waitUntil(cache.put(request, clone));
          }
          return response;
        });
      })
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
