/* Service Worker de Nova
 * - Guarda los archivos de la app para que abra sin internet.
 * - Guarda los mosaicos del mapa que ya viste (y las zonas que guardes), para verlos sin internet.
 * Cambia VERSION cada vez que modifiques archivos de la app.
 */
const VERSION = 'v2.0.5';
const CACHE_APP = `ruta-segura-app-${VERSION}`;
const CACHE_MAPA = 'nova-mapa';
const CACHE_MAPA_VIEJA = 'ruta-segura-mapa'; // tiene mosaicos de CARTO con la marca "API KEY REQUIRED"
const CACHE_LOCAL = 'ruta-segura-local'; // archivos de la carpeta mapas/ y otros del mismo sitio
const MAX_MOSAICOS = 6000;

const ARCHIVOS_APP = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'sesion.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
];

const HOSTS_MAPA = ['tile.openstreetmap.org'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(ARCHIVOS_APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres
        .filter((n) => (n.startsWith('ruta-segura-app-') && n !== CACHE_APP) || n === CACHE_MAPA_VIEJA)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

let limpiando = false;
async function limitarMosaicos() {
  if (limpiando) return;
  limpiando = true;
  try {
    const cache = await caches.open(CACHE_MAPA);
    const claves = await cache.keys();
    for (let i = 0; i < claves.length - MAX_MOSAICOS; i++) await cache.delete(claves[i]);
  } finally {
    limpiando = false;
  }
}

async function mosaicoDelMapa(request) {
  const cache = await caches.open(CACHE_MAPA);
  const guardado = await cache.match(request, { ignoreVary: true });
  if (guardado) return guardado;
  try {
    const resp = await fetch(request);
    if (resp.ok || resp.type === 'opaque') {
      cache.put(request, resp.clone()).then(limitarMosaicos);
    }
    return resp;
  } catch {
    return new Response('', { status: 504, statusText: 'Sin internet' });
  }
}

async function archivoLocal(request) {
  const url = new URL(request.url);
  const deLaApp = await caches.match(request, { ignoreSearch: true, cacheName: CACHE_APP });
  if (deLaApp) return deLaApp;

  // Página principal: si no hay red, se entrega index.html guardado
  if (request.mode === 'navigate') {
    try { return await fetch(request); }
    catch { return (await caches.match('index.html', { cacheName: CACHE_APP })) || Response.error(); }
  }

  const cache = await caches.open(CACHE_LOCAL);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    const guardado = await cache.match(request, { ignoreSearch: true });
    if (guardado) return guardado;
    // Los mosaicos de mapas/ que falten se marcan como ausentes para que el mapa pruebe otra fuente
    if (url.pathname.includes('/mapas/') || url.pathname.endsWith('.png')) {
      return new Response('', { status: 404 });
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (HOSTS_MAPA.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(mosaicoDelMapa(e.request));
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(archivoLocal(e.request));
  }
});
