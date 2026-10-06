// Service worker de FitPlan: la app funciona sin conexión.
// - La interfaz y el catálogo se guardan en la instalación (caché versionada).
// - Imágenes y animaciones se guardan al verlas (caché persistente entre versiones).
const VERSION = "e38a45bbe94f";
const SHELL_CACHE = `fitplan-shell-${VERSION}`;
const MEDIA_CACHE = "fitplan-media-v1";
const SHELL = [
 "./",
 "./index.html",
 "./manifest.webmanifest",
 "./css/styles.css",
 "./data/catalog.json",
 "./data/engine.json",
 "./icons/apple-touch-icon.png",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon-maskable-512.png",
 "./js/api.js",
 "./js/app.js",
 "./js/bodymap.js",
 "./js/charts.js",
 "./js/components.js",
 "./js/engine.js",
 "./js/localapi.js",
 "./js/storage.js",
 "./js/util.js",
 "./js/views/catalog.js",
 "./js/views/dashboard.js",
 "./js/views/plan.js",
 "./js/views/progress.js",
 "./js/views/routines.js",
 "./js/views/train.js",
 "./js/views/week.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("fitplan-shell-") && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isMedia = url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith("/hasaneyldrm/exercises-dataset/");

  if (isMedia) {
    // Media del dataset oficial: primero caché; si no está, red (CORS) y se guarda.
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const hit = await cache.match(url.href);
      if (hit) return hit;
      // Las <img> piden en modo no-cors (respuesta opaca, no cacheable de forma fiable);
      // el servidor permite CORS, así que se pide en modo cors para poder guardarla.
      const res = await fetch(url.href, { mode: "cors", credentials: "omit" });
      if (res.ok) await cache.put(url.href, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Interfaz: primero caché (versión instalada); navegación -> index.html.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      // Sin conexión: cualquier navegación abre la app instalada.
      if (req.mode === "navigate") {
        const index = await cache.match("./index.html") || await cache.match("./");
        if (index) return index;
      }
      throw err;
    }
  })());
});
