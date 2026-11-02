/* Nova — app de rutas de senderismo
 * App web instalable (PWA) para registrar rutas de senderismo sin internet.
 * Todo vive en este teléfono: rutas y última ubicación en IndexedDB,
 * mosaicos del mapa en Cache Storage (o en la carpeta mapas/).
 */
'use strict';

const VERSION_APP = 'v2.0.5';

/* =========================================================
 * 1. Ajustes y utilidades
 * ========================================================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const AJUSTES_DESCANSO = {
  ventanaMs: 60 * 1000,   // se revisa el último minuto
  radioQuieto: 15,        // menos de 15 m en ese minuto = descanso automático
  radioSalida: 25,        // al alejarse 25 m del punto de descanso, se reanuda
};
const PRECISION_MAXIMA = 50;      // se ignoran lecturas con error mayor a 50 m
const VELOCIDAD_MAXIMA = 12;      // m/s; un salto más rápido es un error del GPS
const UMBRAL_ALTITUD = 5;         // m; cambios menores no cuentan como subida
const ZOOM_MAX_GUARDADO = 16;     // zoom máximo que se guarda para usar sin internet
const LIMITE_MOSAICOS_ZONA = 1500;
const CACHE_MAPA = 'nova-mapa';

function distanciaMetros(a, b) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distanciaRuta(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distanciaMetros(coords[i - 1], coords[i]);
  return total;
}

/* Subida acumulada y altitud máxima. Coordenadas: [lat, lng, t, altitud|null] */
function datosAltitud(coords) {
  let subida = 0;
  let maxima = null;
  let referencia = null;
  coords.forEach((c) => {
    const alt = c[3];
    if (alt === null || alt === undefined) return;
    maxima = maxima === null ? alt : Math.max(maxima, alt);
    if (referencia === null) { referencia = alt; return; }
    const cambio = alt - referencia;
    if (Math.abs(cambio) >= UMBRAL_ALTITUD) {
      if (cambio > 0) subida += cambio;
      referencia = alt;
    }
  });
  return { subida, maxima };
}

function formatoTiempo(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
}

function formatoRitmo(ms, metros) {
  if (metros < 50 || ms <= 0) return '--:-- /km';
  const segPorKm = ms / 1000 / (metros / 1000);
  let m = Math.floor(segPorKm / 60);
  let s = Math.round(segPorKm % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

function formatoVelocidad(ms, metros) {
  if (metros < 50 || ms <= 0) return '-- km/h';
  return `${(metros / 1000 / (ms / 3600000)).toFixed(1)} km/h`;
}

function formatoHace(t) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h ${min % 60} min`;
  return `hace ${Math.floor(h / 24)} días`;
}

const formatoKm = (m) => `${(m / 1000).toFixed(2)} km`;
const formatoHora = (t) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const formatoFecha = (t) => new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

function aviso(texto, duracion = 2800) {
  const t = $('#toast');
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(aviso._timer);
  aviso._timer = setTimeout(() => { t.hidden = true; }, duracion);
}

function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function descargarArchivo(nombre, contenido, tipo) {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}

const nombreArchivo = (texto) => texto.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]/g, '').trim() || 'ruta';

/* =========================================================
 * 2. Base de datos local (IndexedDB)
 * ========================================================= */
const DB = {
  db: null,
  abrir() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ruta-segura', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('rutas', { keyPath: 'id' });
        db.createObjectStore('ajustes');
      };
      req.onsuccess = () => { DB.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  _tx(store, modo, accion) {
    return new Promise((resolve, reject) => {
      const tx = DB.db.transaction(store, modo);
      const req = accion(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  guardarRuta: (ruta) => DB._tx('rutas', 'readwrite', (s) => s.put(ruta)),
  borrarRuta: (id) => DB._tx('rutas', 'readwrite', (s) => s.delete(id)),
  leerRuta: (id) => DB._tx('rutas', 'readonly', (s) => s.get(id)),
  async todasLasRutas() {
    const rutas = await DB._tx('rutas', 'readonly', (s) => s.getAll());
    return rutas.sort((a, b) => b.tiempos.inicio - a.tiempos.inicio);
  },
  guardarAjuste: (clave, valor) => DB._tx('ajustes', 'readwrite', (s) => s.put(valor, clave)),
  leerAjuste: (clave) => DB._tx('ajustes', 'readonly', (s) => s.get(clave)),
  borrarTodo: () => Promise.all([
    DB._tx('rutas', 'readwrite', (s) => s.clear()),
    DB._tx('ajustes', 'readwrite', (s) => s.clear()),
  ]),
};

/* =========================================================
 * 3. Estado de la app
 * ========================================================= */
const estado = {
  posicion: null,          // { lat, lng, precision, alt, t }
  grabacion: null,         // ruta en curso
  modo: 'detenida',        // 'detenida' | 'grabando' | 'pausada'
  inicioTramo: 0,          // momento en que empezó el tramo activo
  acumuladoMs: 0,          // tiempo activo acumulado antes del tramo actual
  descansoActual: null,    // parada abierta { inicio, tipo, punto }
  horaLimite: null,        // timestamp
  avisoLimite: { previo: false, vencido: false },
  sos: null,               // { activo, t, lat, lng, rol }
  bateria: null,           // { nivel, cargando } de este teléfono
  personaJefe: null,       // rol que el jefe tiene abierto en Monitoreo activo
  rutaAbierta: null,       // ruta mostrada en el detalle
  simulador: null,
  ultimoGuardado: 0,
  saltosIgnorados: 0,
  ocultaDesde: null,       // momento en que la app pasó a segundo plano
  perfil: { nombre: '', jefe: '', telefono: '' },
  pruebas: false,          // muestra el simulador y la demostración
};

/* =========================================================
 * 4. Mapas (Leaflet)
 * =========================================================
 * Cada mosaico se busca en este orden y usa el primero que cargue:
 *   1. carpeta mapas/ (si existe; la crea descargar_mapa.py)
 *   2. OpenStreetMap (no se usa si la app se abre como archivo, porque lo bloquea)
 *   3. el mismo lugar con menos zoom, ampliado (para ver algo sin internet)
 * El Service Worker guarda los mosaicos que ya se vieron.
 */
const ABIERTA_COMO_ARCHIVO = location.protocol === 'file:';
const MAPA_LOCAL = window.MAPA_LOCAL || null;
const CENTRO_INICIAL = (MAPA_LOCAL && MAPA_LOCAL.centro) || [19.5800, -99.0700]; // Sierra de Guadalupe

/* Mapa oscuro para el tema espacial: los mosaicos de OpenStreetMap son claros
 * y se oscurecen con un filtro CSS (clase "claro"). CARTO ya pide clave y no se usa. */
const FUENTES = {
  local: (z, x, y) => `mapas/${z}/${x}/${y}.png`,
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};
// Carpetas mapas/ viejas (estilo "oscuro") ya vienen oscuras y no llevan filtro
const LOCAL_OSCURO = !!(MAPA_LOCAL && MAPA_LOCAL.estilo === 'oscuro');

function hayMosaicoLocal(z, x, y) {
  const r = MAPA_LOCAL && MAPA_LOCAL.rangos && MAPA_LOCAL.rangos[z];
  return !!r && x >= r[0] && x <= r[1] && y >= r[2] && y <= r[3];
}

function urlsMosaico(z, x, y) {
  const urls = [];
  if (hayMosaicoLocal(z, x, y)) urls.push({ url: FUENTES.local(z, x, y), claro: !LOCAL_OSCURO });
  if (!ABIERTA_COMO_ARCHIVO) urls.push({ url: FUENTES.osm(z, x, y), claro: true });
  return urls;
}

const CapaMosaicos = L.GridLayer.extend({
  createTile(c, done) {
    const tam = this.getTileSize().x;
    const div = document.createElement('div');
    div.className = 'mosaico';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    div.appendChild(img);

    // Lista de intentos: el mosaico exacto y luego hasta 3 niveles de zoom menos
    const intentos = [];
    for (let dz = 0; dz <= 3 && c.z - dz >= 0; dz++) {
      const f = 2 ** dz;
      const x = Math.floor(c.x / f);
      const y = Math.floor(c.y / f);
      urlsMosaico(c.z - dz, x, y).forEach((u) =>
        intentos.push({ url: u.url, claro: u.claro, f, ox: c.x - x * f, oy: c.y - y * f }));
    }

    let i = 0;
    const probar = () => {
      const t = intentos[i];
      img.style.width = img.style.height = `${tam * t.f}px`;
      img.style.left = `${-t.ox * tam}px`;
      img.style.top = `${-t.oy * tam}px`;
      img.className = t.claro ? 'claro' : '';
      img.src = t.url;
    };
    img.onload = () => done(null, div);
    img.onerror = () => {
      i++;
      if (i < intentos.length) probar();
      else { img.removeAttribute('src'); done(new Error('Sin mosaico'), div); }
    };
    probar();
    return div;
  },
});

function crearMapa(id) {
  const mapa = L.map(id, { zoomControl: true, attributionControl: true }).setView(CENTRO_INICIAL, 14);
  new CapaMosaicos({ maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa);
  return mapa;
}

const mapas = {};
function mapaGrabar() {
  if (!mapas.grabar) {
    mapas.grabar = crearMapa('mapa');
    mapas.linea = L.polyline([], { color: '#ffd700', weight: 5 }).addTo(mapas.grabar);
    mapas.yo = L.circleMarker(CENTRO_INICIAL, {
      radius: 8, color: '#fff', weight: 3, fillColor: '#1f4d3a', fillOpacity: 1,
    });
    mapas.precision = L.circle(CENTRO_INICIAL, { radius: 0, color: '#1f4d3a', weight: 1, fillOpacity: 0.1 });
    mapas.seguir = true;
    aplicarBloqueo();
  }
  return mapas.grabar;
}

/* Barra de estado tipo contador de FPS */
function hud(id, texto, clase = '') {
  const el = $(`#h-${id}`);
  if (!el) return;
  el.textContent = texto;
  el.className = clase;
}

function pintarHud() {
  hud('net', navigator.onLine ? 'NET ON' : 'NET OFF', navigator.onLine ? 'info' : 'medio');
  const lim = $('#h-limite');
  if (estado.horaLimite) {
    lim.hidden = false;
    const vencida = Date.now() > estado.horaLimite;
    hud('limite', `⏰ ${formatoHora(estado.horaLimite)}`, vencida ? 'mal' : 'info');
  } else {
    lim.hidden = true;
  }
}

function detalleEstado() {
  const filas = [...$$('#hud span')].filter((e) => !e.hidden).map((e) => `<li><b>${escapar(e.textContent)}</b></li>`).join('');
  abrirModal('Estado', `
    <ul class="status">${filas}</ul>
    <p class="muted small">GPS: margen de error de tu ubicación (menos es mejor; la ruta solo graba con menos de ${PRECISION_MAXIMA} m).
    NET: internet. BAT: batería. MAP: mosaicos del mapa guardados para usar sin internet.</p>`,
  [{ texto: 'Cerrar', clase: 'secondary' }]);
}

function centrarMapa() {
  if (estado.posicion) mapaGrabar().setView([estado.posicion.lat, estado.posicion.lng], Math.max(mapaGrabar().getZoom(), 16));
  else aviso('Todavía no hay señal de GPS');
}

/* Bloqueado: el mapa no se arrastra, sigue tu posición y el zoom se hace
 * sobre el centro. Así no se pierde la ruta mientras grabas. */
function aplicarBloqueo() {
  const mapa = mapas.grabar;
  if (!mapa) return;
  const bloqueado = mapas.seguir;
  if (bloqueado) mapa.dragging.disable(); else mapa.dragging.enable();
  const modo = bloqueado ? 'center' : true;
  mapa.options.touchZoom = modo;
  mapa.options.scrollWheelZoom = modo;
  mapa.options.doubleClickZoom = modo;
  const boton = $('#btn-bloqueo');
  boton.textContent = bloqueado ? '🔒' : '🔓';
  boton.classList.toggle('activo', bloqueado);
  boton.title = bloqueado ? 'Mapa bloqueado: sigue tu posición' : 'Mapa libre';
}

function bloquearMapa(bloquear) {
  mapaGrabar();
  mapas.seguir = bloquear;
  aplicarBloqueo();
  if (bloquear) centrarMapa();
}

function alternarBloqueo() {
  bloquearMapa(!mapas.seguir);
  aviso(mapas.seguir ? 'Mapa bloqueado: sigue tu posición' : 'Mapa libre: muévelo con el dedo');
}

function verRutaCompleta() {
  const puntos = mapas.linea ? mapas.linea.getLatLngs() : [];
  if (puntos.length < 2) { centrarMapa(); return; }
  // Para ver toda la ruta hay que soltar el seguimiento
  if (mapas.seguir) bloquearMapa(false);
  mapaGrabar().fitBounds(mapas.linea.getBounds(), { padding: [30, 30], maxZoom: 17 });
}

/* ---------- Guardar una zona del mapa para usarla sin internet ---------- */
const mosaicoX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
function mosaicoY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function mosaicosDeZona(limites, zMin, zMax) {
  const lista = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = mosaicoX(limites.getWest(), z);
    const x1 = mosaicoX(limites.getEast(), z);
    const y0 = mosaicoY(limites.getNorth(), z);
    const y1 = mosaicoY(limites.getSouth(), z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) lista.push([z, x, y]);
  }
  return lista;
}

async function guardarMosaico(cache, z, x, y) {
  const url = FUENTES.osm(z, x, y);
  if (await cache.match(url, { ignoreVary: true })) return true;
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (resp.ok) { await cache.put(url, resp); return true; }
  } catch { /* sin internet o el servidor no respondió */ }
  return false;
}

function guardarZona() {
  if (!('caches' in window) || ABIERTA_COMO_ARCHIVO) {
    abrirModal('No disponible', '<p>Para guardar mapas abre la app con el servidor local o desde GitHub Pages, no como archivo.</p>',
      [{ texto: 'Entendido', clase: 'primary' }]);
    return;
  }
  if (!navigator.onLine) { aviso('Necesitas internet para guardar la zona'); return; }
  const mapa = mapaGrabar();
  const zMin = Math.max(12, Math.min(mapa.getZoom() - 1, ZOOM_MAX_GUARDADO));
  const lista = mosaicosDeZona(mapa.getBounds(), zMin, ZOOM_MAX_GUARDADO);
  if (lista.length > LIMITE_MOSAICOS_ZONA) {
    abrirModal('Zona muy grande', `<p>Esta zona necesita ${lista.length} mosaicos. Acerca el mapa a la zona de la ruta (máximo ${LIMITE_MOSAICOS_ZONA}).</p>`,
      [{ texto: 'Entendido', clase: 'primary' }]);
    return;
  }
  abrirModal('Guardar zona del mapa', `
    <p>Se guardarán <b>${lista.length}</b> mosaicos (zoom ${zMin} a ${ZOOM_MAX_GUARDADO}), unos ${Math.ceil(lista.length * 0.02)} MB.</p>
    <p class="muted small">Sin internet podrás ver esta zona hasta el zoom ${ZOOM_MAX_GUARDADO}; con más zoom se verá ampliada.</p>`,
  [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: 'Guardar', clase: 'primary', accion: () => descargarZona(lista) },
  ]);
}

async function descargarZona(lista) {
  let cancelado = false;
  let hechos = 0;
  let fallidos = 0;
  abrirModal('Guardando mapa…', `
    <progress id="f-progreso" max="${lista.length}" value="0"></progress>
    <p class="muted small" id="f-progreso-texto">0 de ${lista.length}</p>`,
  [{ texto: 'Cancelar', clase: 'secondary', accion: () => { cancelado = true; } }]);

  const cache = await caches.open(CACHE_MAPA);
  const pendientes = lista.slice();
  // Dos descargas a la vez, como pide la política de uso de OpenStreetMap
  const trabajador = async () => {
    while (pendientes.length && !cancelado) {
      const [z, x, y] = pendientes.shift();
      if (!(await guardarMosaico(cache, z, x, y))) fallidos++;
      hechos++;
      const barra = $('#f-progreso');
      if (barra) {
        barra.value = hechos;
        $('#f-progreso-texto').textContent = `${hechos} de ${lista.length}`;
      }
    }
  };
  await Promise.all([trabajador(), trabajador()]);
  if ($('#modal').open) $('#modal').close();
  refrescarEstadoMapa();
  if (cancelado) aviso(`Descarga cancelada (${hechos - fallidos} mosaicos guardados)`);
  else if (fallidos) aviso(`Zona guardada; ${fallidos} mosaicos fallaron`, 4000);
  else aviso('Zona guardada para usar sin internet');
}

async function refrescarEstadoMapa() {
  let n = 0;
  if ('caches' in window && !ABIERTA_COMO_ARCHIVO) {
    try { n = (await (await caches.open(CACHE_MAPA)).keys()).length; } catch { /* sin acceso a la caché */ }
  }
  if (MAPA_LOCAL) n += MAPA_LOCAL.total || 0;
  const texto = String(n);
  hud('mapa', `MAP ${texto}`, n ? 'info' : 'medio');
}

/* =========================================================
 * 5. GPS
 * ========================================================= */
let idWatch = null;

function iniciarGPS() {
  if (!('geolocation' in navigator)) {
    hud('gps', 'GPS N/D', 'mal');
    return;
  }
  if (idWatch !== null || estado.simulador) return;
  idWatch = navigator.geolocation.watchPosition(
    (p) => recibirPosicion(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.timestamp, p.coords.altitude),
    (err) => {
      const textos = { 1: 'sin permiso', 2: 'sin señal', 3: 'buscando…' };
      hud('gps', `GPS ${(textos[err.code] || 'error').toUpperCase()}`, 'mal');
      if (err.code === 1) {
        navigator.geolocation.clearWatch(idWatch);
        idWatch = null;
        abrirModal('Permiso de ubicación negado',
          '<p>La app necesita tu ubicación para dibujar la ruta. Actívala en los ajustes del navegador para este sitio y recarga la página.</p>' +
          '<p class="muted small">El GPS solo funciona con HTTPS (GitHub Pages) o en http://localhost.</p>',
          [{ texto: 'Entendido', clase: 'primary' }]);
      }
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 }
  );
}

async function recibirPosicion(lat, lng, precision, t, alt = null) {
  estado.posicion = { lat, lng, precision, alt, t };
  hud('gps', `GPS ±${Math.round(precision)}m`, precision <= 20 ? 'ok' : precision <= PRECISION_MAXIMA ? 'medio' : 'mal');

  const punto = [lat, lng];
  const mapa = mapaGrabar();
  mapas.yo.setLatLng(punto).addTo(mapa);
  mapas.precision.setLatLng(punto).setRadius(precision).addTo(mapa);
  if (mapas.seguir) mapa.setView(punto, Math.max(mapa.getZoom(), 16), { animate: false });

  // Última ubicación conocida, para la vista del jefe (cada 15 s como máximo)
  if (t - estado.ultimoGuardado > 15000) {
    estado.ultimoGuardado = t;
    await compartirUbicacion(estado.posicion);
    if (estado.grabacion) await DB.guardarRuta(estado.grabacion);
  }

  if (estado.modo !== 'grabando' || precision > PRECISION_MAXIMA) { actualizarPanelGrabar(); return; }

  const ruta = estado.grabacion;
  const anterior = ruta.coordenadas[ruta.coordenadas.length - 1];
  if (anterior) {
    const d = distanciaMetros(anterior, punto);
    // Evita llenar la ruta de puntos repetidos cuando no te mueves
    if (d < 3) { revisarDescansoAutomatico(t); return; }
    // Ignora saltos imposibles (error del GPS)
    const seg = Math.max(1, (t - anterior[2]) / 1000);
    if (d > 50 && d / seg > VELOCIDAD_MAXIMA) { estado.saltosIgnorados++; return; }
  }
  ruta.coordenadas.push([lat, lng, t, alt === null || alt === undefined ? null : Math.round(alt)]);
  mapas.linea.addLatLng(punto);
  revisarDescansoAutomatico(t);
  actualizarPanelGrabar();
}

/* Descanso automático: si en el último minuto te moviste menos de 15 m */
/* Guarda la ubicación, batería y nombre para Monitoreo activo (vista del jefe).
 * Se hace sola mientras la sesión está abierta y hay permiso de GPS.
 * El jefe no se monitorea a sí mismo. */
async function compartirUbicacion(p) {
  if (!p || !Sesion.rol || Sesion.rol === 'jefe') return;
  await DB.guardarAjuste('ultimaUbicacion', {
    lat: p.lat, lng: p.lng, precision: p.precision, t: p.t,
    rol: Sesion.rol, nombre: estado.perfil.nombre || '', bateria: estado.bateria,
  });
}

function revisarDescansoAutomatico(t) {
  const ruta = estado.grabacion;
  const pos = [estado.posicion.lat, estado.posicion.lng];

  if (estado.descansoActual) {
    if (estado.descansoActual.tipo === 'automática' &&
        distanciaMetros(estado.descansoActual.punto, pos) > AJUSTES_DESCANSO.radioSalida) {
      cerrarDescanso(t);
    }
    return;
  }
  if (t - estado.inicioTramo < AJUSTES_DESCANSO.ventanaMs) return;
  const recientes = ruta.coordenadas.filter((c) => t - c[2] <= AJUSTES_DESCANSO.ventanaMs);
  const referencia = recientes[0] || ruta.coordenadas[ruta.coordenadas.length - 1];
  if (!referencia) return;
  const movido = Math.max(distanciaMetros(referencia, pos),
    ...recientes.map((c) => distanciaMetros(c, pos)));
  if (movido < AJUSTES_DESCANSO.radioQuieto) {
    abrirDescanso('automática', t - AJUSTES_DESCANSO.ventanaMs);
  }
}

function abrirDescanso(tipo, inicio = Date.now()) {
  if (!estado.posicion) { aviso('Espera la señal de GPS'); return; }
  estado.descansoActual = { inicio, tipo, punto: [estado.posicion.lat, estado.posicion.lng] };
  $('#btn-descanso').textContent = 'Seguir';
  actualizarPanelGrabar();
}

function cerrarDescanso(fin = Date.now()) {
  const d = estado.descansoActual;
  if (!d) return;
  estado.grabacion.tiempos.paradas.push({
    inicio: d.inicio, fin, tipo: d.tipo, lat: d.punto[0], lng: d.punto[1],
  });
  estado.descansoActual = null;
  $('#btn-descanso').textContent = 'Descanso';
  actualizarPanelGrabar();
}

/* Paradas para rutas importadas: quieto (menos de 15 m) durante al menos 1 minuto */
function detectarParadas(coords) {
  const paradas = [];
  let i = 0;
  while (i < coords.length - 1) {
    let j = i;
    while (j + 1 < coords.length && distanciaMetros(coords[i], coords[j + 1]) < AJUSTES_DESCANSO.radioQuieto) j++;
    if (j > i && coords[j][2] - coords[i][2] >= AJUSTES_DESCANSO.ventanaMs) {
      paradas.push({ inicio: coords[i][2], fin: coords[j][2], tipo: 'automática', lat: coords[i][0], lng: coords[i][1] });
      i = j + 1;
    } else {
      i++;
    }
  }
  return paradas;
}

/* =========================================================
 * 6. Pantalla encendida y segundo plano
 * ========================================================= */
let bloqueoPantalla = null;

async function mantenerPantalla(activar) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (activar && !bloqueoPantalla) {
      bloqueoPantalla = await navigator.wakeLock.request('screen');
      bloqueoPantalla.addEventListener('release', () => { bloqueoPantalla = null; });
    } else if (!activar && bloqueoPantalla) {
      await bloqueoPantalla.release();
      bloqueoPantalla = null;
    }
  } catch { /* el navegador no lo permitió (batería baja, por ejemplo) */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    estado.ocultaDesde = Date.now();
    if (estado.grabacion) DB.guardarRuta(estado.grabacion);
    compartirUbicacion(estado.posicion); // último punto conocido para el jefe
    return;
  }
  compartirUbicacion(estado.posicion);
  if (estado.modo === 'grabando') {
    mantenerPantalla(true);
    const fuera = estado.ocultaDesde ? Date.now() - estado.ocultaDesde : 0;
    if (fuera > 60000) {
      aviso(`La app estuvo en segundo plano ${Math.round(fuera / 60000)} min; el recorrido de ese tiempo puede salir en línea recta`, 5000);
    }
  }
  estado.ocultaDesde = null;
});

// Al cerrar la app también se guarda el último punto conocido
window.addEventListener('pagehide', () => {
  if (estado.grabacion) DB.guardarRuta(estado.grabacion);
  compartirUbicacion(estado.posicion);
});

/* =========================================================
 * 7. Registro de ruta
 * ========================================================= */
function tiempoActivo() {
  if (estado.modo === 'grabando') return estado.acumuladoMs + (Date.now() - estado.inicioTramo);
  return estado.acumuladoMs;
}

function tiempoDescansos(ruta, ahora = Date.now()) {
  let total = ruta.tiempos.paradas.reduce((s, p) => s + (p.fin - p.inicio), 0);
  if (estado.descansoActual && estado.grabacion && ruta.id === estado.grabacion.id) total += ahora - estado.descansoActual.inicio;
  return total;
}

/* validar: ruta del scout que el experto recorre para validarla (opcional) */
function iniciarRuta(validar = null) {
  if (estado.modo === 'grabando') return;
  iniciarGPS(); // por si se cerró la bienvenida sin dar permiso
  if (estado.modo === 'pausada') {
    estado.modo = 'grabando';
    estado.inicioTramo = Date.now();
    mantenerPantalla(true);
    actualizarBotones();
    return;
  }
  const ahora = Date.now();
  estado.grabacion = {
    id: `ruta-${ahora}`,
    nombre: `Ruta del ${formatoFecha(ahora)}`,
    tipo: 'cerro',
    coordenadas: [],
    tiempos: { inicio: ahora, fin: null, paradas: [], activoMs: 0 },
    estado: 'en curso',
    autor: { rol: Sesion.rol, nombre: estado.perfil.nombre || '' },
  };
  if (validar) {
    estado.grabacion.validacionDe = validar.id;
    estado.grabacion.nombre = `Validación: ${validar.nombre}`;
    estado.grabacion.tipo = validar.tipo;
  }
  estado.modo = 'grabando';
  estado.inicioTramo = ahora;
  estado.acumuladoMs = 0;
  estado.descansoActual = null;
  estado.saltosIgnorados = 0;
  mapaGrabar();
  mapas.linea.setLatLngs([]);
  bloquearMapa(true);
  if (estado.posicion && Date.now() - estado.posicion.t < 30000 && estado.posicion.precision <= PRECISION_MAXIMA) {
    const p = estado.posicion;
    estado.grabacion.coordenadas.push([p.lat, p.lng, ahora, p.alt === null || p.alt === undefined ? null : Math.round(p.alt)]);
    mapas.linea.addLatLng([p.lat, p.lng]);
  }
  DB.guardarRuta(estado.grabacion);
  pintarGuia(estado.grabacion.validacionDe);
  mantenerPantalla(true);
  actualizarBotones();
  aviso(validar ? 'Grabando recorrido de validación' : 'Grabando ruta');
}

function pausarRuta() {
  if (estado.modo !== 'grabando') return;
  if (estado.descansoActual) cerrarDescanso();
  estado.acumuladoMs = tiempoActivo();
  estado.modo = 'pausada';
  estado.grabacion.tiempos.activoMs = estado.acumuladoMs;
  DB.guardarRuta(estado.grabacion);
  mantenerPantalla(false);
  actualizarBotones();
}

function alternarDescanso() {
  if (estado.modo !== 'grabando') return;
  if (estado.descansoActual) cerrarDescanso();
  else abrirDescanso('manual');
}

function terminarRuta() {
  if (!estado.grabacion) return;
  if (estado.descansoActual) cerrarDescanso();
  estado.acumuladoMs = tiempoActivo();
  estado.modo = 'pausada';
  mantenerPantalla(false);
  actualizarBotones();

  const ruta = estado.grabacion;
  const tipos = ['caminata', 'cerro', 'bosque', 'urbana', 'otra'];
  abrirModal('Guardar ruta', `
    <label>Nombre<input id="f-nombre" value="${escapar(ruta.nombre)}" maxlength="60"></label>
    <label>Tipo
      <select id="f-tipo">
        ${tipos.map((t) => `<option value="${t}"${t === ruta.tipo ? ' selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
      </select>
    </label>
    <p class="muted small">${formatoKm(distanciaRuta(ruta.coordenadas))} · ${formatoTiempo(estado.acumuladoMs)} · ${ruta.tiempos.paradas.length} descansos</p>`,
  [
    { texto: 'Seguir grabando', clase: 'secondary', accion: () => iniciarRuta() },
    { texto: 'Guardar', clase: 'primary', accion: async () => {
      ruta.nombre = $('#f-nombre').value.trim() || ruta.nombre;
      ruta.tipo = $('#f-tipo').value;
      ruta.tiempos.fin = Date.now();
      ruta.tiempos.activoMs = estado.acumuladoMs;
      ruta.estado = ruta.validacionDe ? 'validacion' : 'terminada';
      await DB.guardarRuta(ruta);
      detenerSimulador();
      estado.grabacion = null;
      estado.modo = 'detenida';
      estado.acumuladoMs = 0;
      // La hora límite era para esta salida; se quita al terminar
      estado.horaLimite = null;
      estado.avisoLimite = { previo: false, vencido: false };
      await DB.guardarAjuste('horaLimite', null);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      actualizarBotones();
      await refrescarTodo();
      if (ruta.validacionDe) { await terminarValidacion(ruta); return; }
      aviso('Ruta guardada');
      ofrecerInstalacion();
    } },
  ]);
}

function actualizarBotones() {
  const m = estado.modo;
  $('#btn-iniciar').disabled = m === 'grabando';
  $('#btn-iniciar').textContent = m === 'pausada' ? 'Reanudar' : 'Iniciar';
  $('#btn-pausar').disabled = m !== 'grabando';
  $('#btn-descanso').disabled = m !== 'grabando';
  $('#btn-descanso').textContent = estado.descansoActual ? 'Seguir' : 'Descanso';
  $('#btn-terminar').disabled = m === 'detenida';
  actualizarPanelGrabar();
}

function actualizarPanelGrabar() {
  const ruta = estado.grabacion;
  const banner = $('#g-estado');
  const gpsDebil = estado.posicion && estado.posicion.precision > PRECISION_MAXIMA;
  if (!ruta) {
    $('#g-tiempo').textContent = '00:00:00';
    $('#g-dist').textContent = '0.00 km';
    $('#g-ritmo').textContent = '--:-- /km';
    $('#g-paradas').textContent = '0';
    if (!estado.posicion) banner.textContent = 'Esperando señal de GPS…';
    else if (gpsDebil) banner.textContent = `Señal de GPS débil (±${Math.round(estado.posicion.precision)} m)`;
    else banner.textContent = 'Listo para iniciar';
    banner.className = 'banner';
    return;
  }
  const dist = distanciaRuta(ruta.coordenadas);
  const activo = tiempoActivo();
  const enMovimiento = Math.max(0, activo - tiempoDescansos(ruta));
  $('#g-tiempo').textContent = formatoTiempo(activo);
  $('#g-dist').textContent = formatoKm(dist);
  $('#g-ritmo').textContent = formatoRitmo(enMovimiento, dist);
  $('#g-paradas').textContent = ruta.tiempos.paradas.length + (estado.descansoActual ? 1 : 0);

  if (estado.horaLimite && Date.now() > estado.horaLimite) {
    banner.textContent = `⚠ Pasó la hora límite (${formatoHora(estado.horaLimite)})`;
    banner.className = 'banner alerta';
  } else if (estado.modo === 'pausada') {
    banner.textContent = 'En pausa';
    banner.className = 'banner pausa';
  } else if (estado.descansoActual) {
    banner.textContent = `Descanso ${estado.descansoActual.tipo === 'manual' ? 'manual' : 'automático'} · ${formatoTiempo(Date.now() - estado.descansoActual.inicio)}`;
    banner.className = 'banner pausa';
  } else if (gpsDebil) {
    banner.textContent = `Grabando · señal de GPS débil (±${Math.round(estado.posicion.precision)} m)`;
    banner.className = 'banner pausa';
  } else {
    banner.textContent = (ruta.validacionDe ? 'Grabando recorrido de validación' : 'Grabando ruta') +
      (estado.simulador ? ' (simulación)' : '');
    banner.className = 'banner';
  }
}

/* =========================================================
 * 8. Hora límite, alertas y SOS
 * ========================================================= */
/* Solo el jefe (y dev) la define, desde Monitoreo activo. Se guarda en este
 * teléfono (IndexedDB), así que las alertas le saltan al scout cuando entra. */
function definirHoraLimite() {
  if (!['jefe', 'dev'].includes(Sesion.rol)) return;
  const quien = $('#j-nombre').textContent || 'la persona';
  const actual = estado.horaLimite ? new Date(estado.horaLimite).toTimeString().slice(0, 5) : '';
  abrirModal('Hora límite de regreso', `
    <p class="small">Para <b>${escapar(quien)}</b>.</p>
    <p class="muted small">Su teléfono le avisa 15 minutos antes y al llegar la hora si la ruta sigue abierta. Aquí aparecerá como "Retrasado".</p>
    <input type="time" id="f-limite" value="${actual}">`,
  [
    { texto: 'Quitar', clase: 'secondary', accion: async () => {
      estado.horaLimite = null;
      estado.avisoLimite = { previo: false, vencido: false };
      await DB.guardarAjuste('horaLimite', null);
      refrescarInicio();
      refrescarJefe();
      aviso('Hora límite quitada');
    } },
    { texto: 'Guardar', clase: 'primary', accion: async () => {
      const valor = $('#f-limite').value;
      if (!valor) return;
      const [h, m] = valor.split(':').map(Number);
      const fecha = new Date();
      fecha.setHours(h, m, 0, 0);
      if (fecha.getTime() < Date.now()) fecha.setDate(fecha.getDate() + 1); // si ya pasó, es mañana
      estado.horaLimite = fecha.getTime();
      estado.avisoLimite = { previo: false, vencido: false };
      await DB.guardarAjuste('horaLimite', estado.horaLimite);
      if ('Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch { /* sin notificaciones */ }
      }
      refrescarInicio();
      refrescarJefe();
      aviso(`Hora límite: ${formatoHora(estado.horaLimite)}`);
    } },
  ]);
}

function revisarHoraLimite() {
  if (!estado.horaLimite || estado.modo === 'detenida') return;
  // Las alertas son para quien camina; al jefe se le muestra en Monitoreo activo
  if (!Sesion.rol || Sesion.rol === 'jefe') return;
  const falta = estado.horaLimite - Date.now();
  if (falta <= 15 * 60 * 1000 && falta > 0 && !estado.avisoLimite.previo) {
    estado.avisoLimite.previo = true;
    alertar('Faltan 15 minutos', `Tu hora límite de regreso es a las ${formatoHora(estado.horaLimite)}. Empieza a regresar.`);
    abrirModal('Faltan 15 minutos', `<p>Tu hora límite de regreso es a las <b>${formatoHora(estado.horaLimite)}</b>. Empieza a regresar.</p>`,
      [{ texto: 'Entendido', clase: 'primary' }]);
  }
  if (falta <= 0 && !estado.avisoLimite.vencido) {
    estado.avisoLimite.vencido = true;
    alertar('Pasó la hora límite', 'La ruta sigue abierta. Avisa a tu jefe o usa el SOS si necesitas ayuda.');
    abrirModal('⚠ Pasó la hora límite', `<p>Eran las <b>${formatoHora(estado.horaLimite)}</b> y la ruta sigue abierta. Avisa a tu jefe o usa el SOS si necesitas ayuda.</p>`,
      [{ texto: 'Abrir SOS', clase: 'danger', accion: () => abrirSOS() }, { texto: 'Cerrar', clase: 'secondary' }]);
  }
}

/* Vibración, sonido y notificación del sistema (lo que el teléfono permita) */
function alertar(titulo, texto) {
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    const ctx = new Audio();
    [0, 0.35, 0.7].forEach((inicio) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = 880;
      vol.gain.value = 0.25;
      osc.connect(vol).connect(ctx.destination);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + 0.2);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* sin sonido */ }
  if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) reg.showNotification(titulo, { body: texto, icon: 'icons/icon-192.png', tag: 'hora-limite' });
    }).catch(() => {});
  }
}

/* ---------- Mis datos (perfil) ---------- */
const limpiarTelefono = (tel) => String(tel || '').replace(/[^\d+]/g, '');

const PERFIL_VACIO = {
  nombre: '', nacimiento: '', sangre: '', alergias: '', medico: '',
  emergNombre: '', emergTel: '', jefe: '', jefeTel: '',
};
const CAMPOS_PERFIL = Object.keys(PERFIL_VACIO);

function pintarPerfil() {
  const form = $('#form-perfil');
  CAMPOS_PERFIL.forEach((c) => { form.elements[c].value = estado.perfil[c] || ''; });
  $('#p-pruebas').checked = estado.pruebas;
  // El modo pruebas solo existe para el administrador
  document.body.classList.toggle('pruebas', estado.pruebas && Sesion.rol === 'dev');
  const info = ROLES[Sesion.rol];
  if (info) {
    $('#pf-sesion').innerHTML = `
      <li><span>Usuario</span><b>${info.icono} ${Sesion.rol}</b></li>
      <li><span>Tipo</span><b>${info.nombre}</b></li>
      <li><span>Versión</span><b>Nova ${VERSION_APP}</b></li>`;
  }
}

function edad(nacimiento) {
  if (!nacimiento) return null;
  const n = new Date(`${nacimiento}T12:00:00`);
  if (Number.isNaN(n.getTime())) return null;
  const hoy = new Date();
  let e = hoy.getFullYear() - n.getFullYear();
  if (hoy < new Date(hoy.getFullYear(), n.getMonth(), n.getDate())) e--;
  return e >= 0 && e < 120 ? e : null;
}

/* Lee y valida el formulario; devuelve el perfil o null si hay errores */
function leerFormPerfil() {
  const form = $('#form-perfil');
  const datos = {};
  CAMPOS_PERFIL.forEach((c) => { datos[c] = form.elements[c].value.trim(); });
  datos.emergTel = limpiarTelefono(datos.emergTel);
  datos.jefeTel = limpiarTelefono(datos.jefeTel);
  if (!datos.nombre) { aviso('Escribe tu nombre'); form.elements.nombre.focus(); return null; }
  for (const c of ['emergTel', 'jefeTel']) {
    if (datos[c] && datos[c].replace('+', '').length < 8) {
      aviso('Revisa el teléfono: parece incompleto'); form.elements[c].focus(); return null;
    }
  }
  if (datos.nacimiento && edad(datos.nacimiento) === null) {
    aviso('Revisa la fecha de nacimiento'); form.elements.nacimiento.focus(); return null;
  }
  return datos;
}

async function guardarPerfil() {
  const datos = leerFormPerfil();
  if (!datos) return false;
  estado.perfil = datos;
  await DB.guardarAjuste(`perfil:${Sesion.rol}`, estado.perfil);
  pintarPerfil();
  refrescarJefe();
  return true;
}

$('#form-perfil').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!(await guardarPerfil())) return;
  if (document.body.classList.contains('registrando')) terminarRegistro();
  else aviso('Perfil guardado');
});

const contactoTexto = () => estado.perfil.jefe || estado.perfil.jefeTel || 'tu jefe';
const firma = () => (estado.perfil.nombre ? ` Soy ${estado.perfil.nombre}.` : '');

function lineasUbicacion() {
  const p = estado.posicion;
  if (!p) return 'No tengo señal de GPS en este momento.\n';
  const lat = p.lat.toFixed(6);
  const lng = p.lng.toFixed(6);
  return `Mi ubicación: ${lat}, ${lng} (±${Math.round(p.precision)} m)\n` +
    `Mapa: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}\n` +
    `Ubicación tomada a las ${formatoHora(p.t)}\n`;
}

function lineasSalud() {
  const p = estado.perfil;
  const datos = [];
  const e = edad(p.nacimiento);
  if (e !== null) datos.push(`Edad: ${e} años`);
  if (p.sangre) datos.push(`Sangre: ${p.sangre}`);
  if (p.alergias) datos.push(`Alergias: ${p.alergias}`);
  if (p.medico) datos.push(`Padecimientos: ${p.medico}`);
  return datos.length ? `${datos.join('\n')}\n` : '';
}

function mensajeSOS() {
  return `SOS - Nova. Necesito ayuda.${firma()}\n` + lineasUbicacion() + lineasSalud() +
    `Hora: ${new Date().toLocaleString('es-MX')}`;
}

/* El SOS va al contacto de emergencia y al jefe */
const numerosSOS = () => [estado.perfil.emergTel, estado.perfil.jefeTel].filter(Boolean)
  .filter((n, i, a) => a.indexOf(n) === i);

/* Abre la app de mensajes con el texto listo (y el número, si está guardado) */
function abrirSMS(cuerpo, numeros = []) {
  location.href = `sms:${numeros.map(limpiarTelefono).join(',')}?&body=${encodeURIComponent(cuerpo)}`;
}

function abrirSOS() {
  const activo = estado.sos && estado.sos.activo;
  const numeros = numerosSOS();
  const p = estado.perfil;
  const para = [p.emergTel && `${p.emergNombre || 'contacto de emergencia'} (${p.emergTel})`,
    p.jefeTel && p.jefeTel !== p.emergTel && `${p.jefe || 'jefe'} (${p.jefeTel})`].filter(Boolean).join(' y ');
  abrirModal('🆘 Mensaje SOS', `
    <p class="small">${numeros.length
      ? `Se enviará a <b>${escapar(para)}</b>.`
      : 'No tienes contactos guardados: al enviar, elige a quién mandarlo. Agrégalos en <b>Perfil</b>.'}
      Por SMS funciona sin datos, solo con señal de celular.</p>
    <textarea id="f-sos">${escapar(mensajeSOS())}</textarea>`,
  [
    { texto: 'Enviar por SMS', clase: 'danger', accion: async () => {
      const cuerpo = $('#f-sos').value;
      await activarSOS();
      abrirSMS(cuerpo, numeros);
    } },
    { texto: 'Llamar al 911', clase: 'danger', accion: async () => {
      await activarSOS();
      location.href = 'tel:911';
    } },
    { texto: 'Copiar', clase: 'secondary', accion: async () => {
      const cuerpo = $('#f-sos').value;
      await activarSOS();
      try { await navigator.clipboard.writeText(cuerpo); aviso('Mensaje copiado'); }
      catch { aviso('No se pudo copiar; selecciona el texto'); }
    } },
    activo
      ? { texto: 'Desactivar SOS', clase: 'secondary', accion: async () => {
          estado.sos = null; await DB.guardarAjuste('sos', null); refrescarJefe(); aviso('SOS desactivado');
        } }
      : { texto: 'Cancelar', clase: 'secondary' },
  ]);
}

/* ---------- Enviar mi ubicación al jefe ---------- */
function mensajeUbicacion() {
  let situacion = 'Sin ruta activa.';
  const ruta = estado.grabacion;
  if (ruta) {
    const dist = formatoKm(distanciaRuta(ruta.coordenadas));
    const desde = `salí a las ${formatoHora(ruta.tiempos.inicio)}`;
    if (estado.descansoActual) situacion = `En descanso. Llevo ${dist}; ${desde}`;
    else if (estado.modo === 'pausada') situacion = `Ruta en pausa. Llevo ${dist}; ${desde}`;
    else situacion = `En ruta. Llevo ${dist}; ${desde}`;
  }
  const limite = estado.horaLimite ? `Hora límite de regreso: ${formatoHora(estado.horaLimite)}\n` : '';
  return `Nova - Aviso de ubicación.${firma()}\n${situacion}\n` + lineasUbicacion() + limite;
}

function enviarUbicacion() {
  const texto = mensajeUbicacion();
  const botones = [];
  if (navigator.share) {
    botones.push({ texto: 'Compartir (WhatsApp…)', clase: 'primary', accion: async () => {
      try { await navigator.share({ title: 'Mi ubicación', text: $('#f-ubic').value }); }
      catch { /* el usuario canceló */ }
    } });
  }
  botones.push({ texto: 'Enviar por SMS', clase: navigator.share ? 'secondary' : 'primary', accion: () => abrirSMS($('#f-ubic').value, [estado.perfil.jefeTel].filter(Boolean)) });
  botones.push({ texto: 'Copiar', clase: 'secondary', accion: async () => {
    try { await navigator.clipboard.writeText($('#f-ubic').value); aviso('Mensaje copiado'); }
    catch { aviso('No se pudo copiar; selecciona el texto'); }
  } });
  botones.push({ texto: 'Cancelar', clase: 'secondary' });
  abrirModal('📤 Enviar ubicación', `
    <p class="small">Para <b>${escapar(contactoTexto())}</b>. Puedes editar el mensaje.</p>
    <textarea id="f-ubic">${escapar(texto)}</textarea>`, botones);
}

async function activarSOS() {
  const p = estado.posicion;
  estado.sos = { activo: true, t: Date.now(), lat: p ? p.lat : null, lng: p ? p.lng : null, rol: Sesion.rol };
  await DB.guardarAjuste('sos', estado.sos);
  await compartirUbicacion(p);
  refrescarJefe();
}

/* =========================================================
 * 9. Mis rutas
 * ========================================================= */
function chipEstado(ruta) {
  if (ruta.borrarEn) {
    const min = Math.max(1, Math.ceil((ruta.borrarEn - Date.now()) / 60000));
    return `<span class="chip borrando">🗑 ${min} min</span>`;
  }
  const clase = ruta.estado === 'en curso' ? 'en-curso' : ruta.estado;
  return `<span class="chip ${clase}">${escapar(textoEstado(ruta.estado))}</span>`;
}

/* Estados de una ruta:
 *   en curso → terminada (guardada, sin enviar) → pendiente_revision (enviada al experto)
 *   → validada o rechazada. 'validacion' es el recorrido del experto.
 *   'verificada' es de versiones anteriores (aprobada sin recorrido). */
const TEXTO_ESTADO = {
  'en curso': 'en curso', terminada: 'sin enviar', pendiente_revision: 'en revisión',
  validada: '✓ validada', verificada: '✓ verificada', rechazada: '✕ rechazada',
  validacion: 'recorrido de validación',
};
const textoEstado = (e) => TEXTO_ESTADO[e] || e;
const PUEDE_ENVIARSE = ['terminada', 'rechazada'];

/* Envío manual de una ruta guardada a la bandeja del experto */
function enviarAValidacion() {
  const ruta = estado.rutaAbierta;
  if (!ruta || !PUEDE_ENVIARSE.includes(ruta.estado) || ruta.borrarEn) return;
  const reenvio = ruta.estado === 'rechazada';
  abrirModal('Enviar a validación de experto', `
    <p><b>${escapar(ruta.nombre)}</b> · ${formatoKm(distanciaRuta(ruta.coordenadas))}</p>
    <p class="small">La ruta pasa a la bandeja del experto. Él la recorre, la compara con la tuya y decide si la valida.</p>
    ${reenvio ? '<p class="aviso-texto">Fue rechazada antes. Se borrarán la revisión y el recorrido de validación anteriores.</p>' : ''}`,
  [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: '📤 Enviar', clase: 'primary', accion: async () => {
      ruta.estado = 'pendiente_revision';
      ruta.envio = { t: Date.now(), por: { rol: Sesion.rol, nombre: estado.perfil.nombre || '' } };
      delete ruta.revision;
      delete ruta.validacion;
      await DB.guardarRuta(ruta);
      await refrescarTodo();
      abrirDetalle(ruta.id);
      aviso('Ruta enviada al experto');
    } },
  ]);
}

function pintarEnvio(ruta) {
  const boton = $('#d-enviar');
  const mostrar = PUEDE_ENVIARSE.includes(ruta.estado) && !ruta.borrarEn;
  boton.hidden = !mostrar;
  boton.textContent = ruta.estado === 'rechazada' ? '📤 Volver a enviar a validación de experto' : '📤 Enviar a validación de experto';
}

async function refrescarLista() {
  const rutas = await DB.todasLasRutas();
  const cont = $('#lista-rutas');
  if (!rutas.length) {
    cont.innerHTML = '<p class="muted">Aún no tienes rutas. Ve a Grabar para registrar la primera, o importa un archivo .gpx.</p>';
    return;
  }
  cont.innerHTML = rutas.map((r) => `
    <button class="ruta-item" data-ruta="${escapar(r.id)}">
      <span><b>${escapar(r.nombre)}</b>
      <small class="muted">${formatoFecha(r.tiempos.inicio)} · ${formatoKm(distanciaRuta(r.coordenadas))} · ${escapar(r.tipo)}</small></span>
      ${chipEstado(r)}
    </button>`).join('');
}

async function abrirDetalle(id) {
  const ruta = await DB.leerRuta(id);
  if (!ruta) return;
  estado.rutaAbierta = ruta;
  pintarRevision(ruta);
  pintarEnvio(ruta);
  pintarBorrado(ruta);
  $('#lista-envoltura').hidden = true;
  $('#detalle-ruta').hidden = false;
  $('#d-nombre').textContent = ruta.nombre;
  $('#d-meta').textContent = `${formatoFecha(ruta.tiempos.inicio)} · ${formatoHora(ruta.tiempos.inicio)}` +
    (ruta.tiempos.fin ? ` a ${formatoHora(ruta.tiempos.fin)}` : '') + ` · ${ruta.tipo} · ${textoEstado(ruta.estado)}` +
    (ruta.origen ? ` · importada (${ruta.origen})` : '');

  const dist = distanciaRuta(ruta.coordenadas);
  const enCurso = estado.grabacion && ruta.id === estado.grabacion.id;
  const activo = enCurso ? tiempoActivo() : (ruta.tiempos.activoMs || ((ruta.tiempos.fin || Date.now()) - ruta.tiempos.inicio));
  const descanso = tiempoDescansos(ruta);
  const mov = Math.max(0, activo - descanso);
  const alt = datosAltitud(ruta.coordenadas);
  $('#d-stats').innerHTML = `
    <div><small>Tiempo</small><b>${formatoTiempo(activo)}</b></div>
    <div><small>Distancia</small><b>${formatoKm(dist)}</b></div>
    <div><small>Ritmo</small><b>${formatoRitmo(mov, dist)}</b></div>
    <div><small>Velocidad</small><b>${formatoVelocidad(mov, dist)}</b></div>
    <div><small>En movimiento</small><b>${formatoTiempo(mov)}</b></div>
    <div><small>Descanso</small><b>${formatoTiempo(descanso)}</b></div>
    <div><small>Subida</small><b>${alt.maxima === null ? '--' : `${Math.round(alt.subida)} m`}</b></div>
    <div><small>Altitud máx.</small><b>${alt.maxima === null ? '--' : `${Math.round(alt.maxima)} m`}</b></div>`;
  $('#d-paradas').innerHTML = ruta.tiempos.paradas.length
    ? ruta.tiempos.paradas.map((p) =>
        `<li>${formatoHora(p.inicio)} – ${formatoHora(p.fin)} (${Math.max(1, Math.round((p.fin - p.inicio) / 60000))} min, ${p.tipo === 'manual' ? 'manual' : 'automático'})</li>`).join('')
    : '<li class="muted">Sin paradas</li>';

  if (!mapas.detalle) {
    mapas.detalle = crearMapa('mapa-detalle');
    mapas.capaDetalle = L.layerGroup().addTo(mapas.detalle);
  }
  setTimeout(() => {
    mapas.detalle.invalidateSize();
    mapas.capaDetalle.clearLayers();
    const puntos = ruta.coordenadas.map((c) => [c[0], c[1]]);
    if (puntos.length) {
      const linea = L.polyline(puntos, { color: '#ffd700', weight: 5 }).addTo(mapas.capaDetalle);
      ruta.tiempos.paradas.forEach((p) =>
        L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', fillColor: '#f2a53a', fillOpacity: 1 })
          .bindTooltip(`Descanso ${Math.max(1, Math.round((p.fin - p.inicio) / 60000))} min`).addTo(mapas.capaDetalle));
      L.circleMarker(puntos[0], { radius: 7, color: '#fff', fillColor: '#2f9e44', fillOpacity: 1 }).bindTooltip('Inicio').addTo(mapas.capaDetalle);
      L.circleMarker(puntos[puntos.length - 1], { radius: 7, color: '#fff', fillColor: '#c8372d', fillOpacity: 1 }).bindTooltip('Fin').addTo(mapas.capaDetalle);
      mapas.detalle.fitBounds(linea.getBounds(), { padding: [20, 20], maxZoom: 17 });
    }
  }, 50);
}

function cerrarDetalle() {
  estado.rutaAbierta = null;
  $('#detalle-ruta').hidden = true;
  $('#lista-envoltura').hidden = false;
}

/* "Volver" regresa a la pestaña desde donde se abrió la ruta */
function volverDeDetalle() {
  const destino = estado.volverA || 'rutas';
  estado.volverA = null;
  cerrarDetalle();
  if (destino !== 'rutas') irATab(destino);
}

function renombrarRuta() {
  const ruta = estado.rutaAbierta;
  abrirModal('Renombrar ruta', `<input id="f-renombrar" value="${escapar(ruta.nombre)}" maxlength="60">`, [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: 'Guardar', clase: 'primary', accion: async () => {
      ruta.nombre = $('#f-renombrar').value.trim() || ruta.nombre;
      if (estado.grabacion && estado.grabacion.id === ruta.id) estado.grabacion.nombre = ruta.nombre;
      await DB.guardarRuta(ruta);
      await refrescarTodo();
      abrirDetalle(ruta.id);
    } },
  ]);
}

const ESPERA_BORRADO = 60 * 60 * 1000; // 1 hora

function eliminarRuta() {
  const ruta = estado.rutaAbierta;
  if (estado.grabacion && estado.grabacion.id === ruta.id) {
    aviso('Termina la ruta en curso antes de borrarla');
    return;
  }
  if (ruta.borrarEn) return;
  const cuando = Date.now() + ESPERA_BORRADO;
  abrirModal('Borrar ruta', `
    <p><b>${escapar(ruta.nombre)}</b> se borrará en <b>1 hora</b> (a las ${formatoHora(cuando)}).</p>
    <p class="muted small">Hasta entonces puedes cancelar el borrado desde esta misma ruta.</p>`, [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: 'Borrar en 1 hora', clase: 'danger', accion: async () => {
      ruta.borrarEn = Date.now() + ESPERA_BORRADO;
      await DB.guardarRuta(ruta);
      await refrescarTodo();
      abrirDetalle(ruta.id);
      aviso(`Se borrará a las ${formatoHora(ruta.borrarEn)}`);
    } },
  ]);
}

async function cancelarBorrado() {
  const ruta = estado.rutaAbierta;
  if (!ruta) return;
  delete ruta.borrarEn;
  await DB.guardarRuta(ruta);
  await refrescarTodo();
  abrirDetalle(ruta.id);
  aviso('Borrado cancelado');
}

function pintarBorrado(ruta) {
  const caja = $('#d-borrado');
  $('#btn-eliminar').hidden = !!ruta.borrarEn;
  if (!ruta.borrarEn) { caja.hidden = true; return; }
  caja.hidden = false;
  const min = Math.max(1, Math.ceil((ruta.borrarEn - Date.now()) / 60000));
  caja.innerHTML = `<span>🗑 Se borrará a las <b>${formatoHora(ruta.borrarEn)}</b> (en ${min} min)</span>
    <button data-action="cancelar-borrado">Cancelar borrado</button>`;
}

/* Borra las rutas cuyo plazo de 1 hora ya terminó */
async function procesarBorrados() {
  if (!DB.db) return;
  const vencidas = (await DB.todasLasRutas()).filter((r) => r.borrarEn && r.borrarEn <= Date.now());
  if (!vencidas.length) {
    if (estado.rutaAbierta && estado.rutaAbierta.borrarEn) pintarBorrado(estado.rutaAbierta);
    return;
  }
  for (const r of vencidas) await DB.borrarRuta(r.id);
  if (estado.rutaAbierta && vencidas.some((r) => r.id === estado.rutaAbierta.id)) cerrarDetalle();
  await refrescarTodo();
  aviso(vencidas.length === 1 ? `Ruta borrada: ${vencidas[0].nombre}` : `${vencidas.length} rutas borradas`);
}

function exportarRuta() {
  const ruta = estado.rutaAbierta;
  abrirModal('Exportar ruta', `
    <p><b>${escapar(ruta.nombre)}</b></p>
    <p class="small"><b>GPX:</b> para abrirla en otras apps de mapas (Google Earth, Wikiloc…).<br>
    <b>Nova (.json):</b> copia completa con paradas, autor y revisión, para importarla en otro Nova.</p>`, [
    { texto: 'GPX', clase: 'primary', accion: exportarGPX },
    { texto: 'Nova (.json)', clase: 'secondary', accion: exportarJSON },
    { texto: 'Cancelar', clase: 'secondary' },
  ]);
}

function exportarJSON() {
  const ruta = estado.rutaAbierta;
  const datos = { app: 'nova', version: VERSION_APP, exportado: new Date().toISOString(), rutas: [ruta] };
  descargarArchivo(`${nombreArchivo(ruta.nombre)}.nova.json`, JSON.stringify(datos), 'application/json');
}

function rutaAGPX(ruta) {
  const puntos = ruta.coordenadas.map((c) =>
    `      <trkpt lat="${c[0]}" lon="${c[1]}">` +
    (c[3] !== null && c[3] !== undefined ? `<ele>${c[3]}</ele>` : '') +
    `<time>${new Date(c[2]).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Nova ${VERSION_APP}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapar(ruta.nombre)}</name><time>${new Date(ruta.tiempos.inicio).toISOString()}</time></metadata>
  <trk>
    <name>${escapar(ruta.nombre)}</name>
    <type>${escapar(ruta.tipo)}</type>
    <trkseg>
${puntos}
    </trkseg>
  </trk>
</gpx>`;
}

function exportarGPX() {
  const ruta = estado.rutaAbierta;
  descargarArchivo(`${nombreArchivo(ruta.nombre)}.gpx`, rutaAGPX(ruta), 'application/gpx+xml');
}

/* =========================================================
 * 10. Respaldo e importación
 * ========================================================= */
function leerGPX(texto, nombreArchivoOrigen) {
  const xml = new DOMParser().parseFromString(texto, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('El archivo .gpx no es válido');
  let nodos = [...xml.getElementsByTagName('trkpt')];
  if (!nodos.length) nodos = [...xml.getElementsByTagName('rtept')];
  if (nodos.length < 2) throw new Error('El archivo .gpx no tiene puntos de recorrido');

  const base = Date.now() - nodos.length * 5000;
  const coords = nodos.map((n, i) => {
    const ele = n.getElementsByTagName('ele')[0];
    const time = n.getElementsByTagName('time')[0];
    const t = time ? Date.parse(time.textContent) : NaN;
    return [
      parseFloat(n.getAttribute('lat')),
      parseFloat(n.getAttribute('lon')),
      Number.isNaN(t) ? base + i * 5000 : t,
      ele ? Math.round(parseFloat(ele.textContent)) : null,
    ];
  }).filter((c) => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));

  const nombreNodo = xml.querySelector('trk > name') || xml.querySelector('metadata > name') || xml.querySelector('name');
  const tipoNodo = xml.querySelector('trk > type');
  const inicio = coords[0][2];
  const fin = coords[coords.length - 1][2];
  return {
    id: `ruta-${inicio}-${Math.random().toString(36).slice(2, 7)}`,
    nombre: (nombreNodo && nombreNodo.textContent.trim()) || nombreArchivoOrigen.replace(/\.gpx$/i, ''),
    tipo: (tipoNodo && tipoNodo.textContent.trim()) || 'cerro',
    coordenadas: coords,
    tiempos: { inicio, fin, paradas: detectarParadas(coords), activoMs: fin - inicio },
    estado: 'terminada',
    origen: nombreArchivoOrigen,
  };
}

function rutaValida(r) {
  return r && typeof r.id === 'string' && typeof r.nombre === 'string' && Array.isArray(r.coordenadas) &&
    r.tiempos && typeof r.tiempos.inicio === 'number' && Array.isArray(r.tiempos.paradas);
}

async function importarArchivos(archivos) {
  let rutasNuevas = 0;
  const errores = [];
  for (const archivo of archivos) {
    try {
      const texto = await archivo.text();
      if (/\.json$/i.test(archivo.name)) {
        const datos = JSON.parse(texto);
        const rutas = Array.isArray(datos) ? datos : datos.rutas;
        if (!Array.isArray(rutas)) throw new Error('no es un archivo de Nova');
        for (const r of rutas) {
          if (!rutaValida(r)) continue;
          if (r.estado === 'en curso') r.estado = 'terminada'; // una ruta importada no puede seguir grabando aquí
          await DB.guardarRuta(r);
          rutasNuevas++;
        }
        if (datos.ultimaUbicacion && !(await DB.leerAjuste('ultimaUbicacion'))) {
          await DB.guardarAjuste('ultimaUbicacion', datos.ultimaUbicacion);
        }
      } else {
        await DB.guardarRuta(leerGPX(texto, archivo.name));
        rutasNuevas++;
      }
    } catch (err) {
      errores.push(`${archivo.name}: ${err.message}`);
    }
  }
  await refrescarTodo();
  if (errores.length) {
    abrirModal('Importación', `<p>Rutas importadas: <b>${rutasNuevas}</b></p><p class="small">No se pudieron leer:</p><ul class="small">${errores.map((e) => `<li>${escapar(e)}</li>`).join('')}</ul>`,
      [{ texto: 'Entendido', clase: 'primary' }]);
  } else {
    aviso(`Rutas importadas: ${rutasNuevas}`);
    irATab('rutas');
  }
}

function borrarTodo() {
  if (estado.modo !== 'detenida') { aviso('Termina la ruta en curso primero'); return; }
  abrirModal('Borrar todos los datos', '<p>Se borrarán <b>todas las rutas</b>, tus datos, la última ubicación, la hora límite y el SOS de este teléfono. Haz un respaldo antes si las quieres conservar.</p>',
  [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: 'Borrar todo', clase: 'danger', accion: async () => {
      await DB.borrarTodo();
      await DB.guardarAjuste('bienvenida', true);
      estado.horaLimite = null;
      estado.sos = null;
      estado.perfil = Object.assign({}, PERFIL_VACIO);
      estado.pruebas = false;
      pintarPerfil();
      await refrescarTodo();
      aviso('Datos borrados; las contraseñas vuelven a 0000');
      await cerrarSesion();
    } },
  ]);
}

/* =========================================================
 * 11. Vista del jefe (simulada con datos locales)
 * ========================================================= */
const HORAS_MONITOREO = 12;
const rolDe = (registro) => (registro && registro.rol) || 'scout'; // datos viejos no guardaban el rol

/* Personas a cargo: quien tiene la ruta abierta, quien compartió su ubicación
 * hace menos de 12 horas o quien activó el SOS en este teléfono. */
async function personasMonitoreo(rutas) {
  const ultima = await DB.leerAjuste('ultimaUbicacion');
  const sos = await DB.leerAjuste('sos');
  const enCurso = rutas.find((r) => r.estado === 'en curso');
  const ubic = ultima && Date.now() - ultima.t < HORAS_MONITOREO * 3600000 ? ultima : null;
  const sosActivo = sos && sos.activo ? sos : null;
  const roles = [...new Set([enCurso && rolDe(enCurso.autor), ubic && rolDe(ubic), sosActivo && rolDe(sosActivo)])]
    .filter((rol) => rol && rol !== 'jefe' && ROLES[rol]);
  return Promise.all(roles.map(async (rol) => ({
    rol,
    perfil: { ...PERFIL_VACIO, ...((await DB.leerAjuste(`perfil:${rol}`)) || {}) },
    ubic: ubic && rolDe(ubic) === rol ? ubic : null,
    ruta: enCurso && rolDe(enCurso.autor) === rol ? enCurso : null,
    sos: sosActivo && rolDe(sosActivo) === rol ? sosActivo : null,
  })));
}

function estadoPersona(p) {
  if (p.sos) return { texto: `🆘 SOS activo desde las ${formatoHora(p.sos.t)}`, corto: '🆘 SOS', clase: 'alerta' };
  if (p.ruta && estado.horaLimite && Date.now() > estado.horaLimite) return { texto: '⚠ Retrasado', corto: '⚠ retrasado', clase: 'alerta' };
  if (p.ruta && estado.descansoActual) return { texto: '⏸ En descanso', corto: 'descanso', clase: 'pausa' };
  if (p.ruta && estado.modo === 'pausada') return { texto: '⏸ Ruta en pausa', corto: 'en pausa', clase: 'pausa' };
  if (p.ruta) return { texto: '🥾 En ruta', corto: 'en ruta', clase: 'ok' };
  return { texto: 'Sin ruta activa', corto: 'sin ruta', clase: '' };
}

const nombrePersona = (p) => p.perfil.nombre || (p.ubic && p.ubic.nombre) || ROLES[p.rol].nombre;
const textoBateria = (b) => (b && typeof b.nivel === 'number' ? `${b.nivel}%${b.cargando ? ' (cargando)' : ''}` : 'sin dato');

function itemPersona(p) {
  const e = estadoPersona(p);
  const detalle = [
    `usuario: ${p.rol}`,
    p.ubic ? `ubicación ${formatoHace(p.ubic.t)}` : 'sin ubicación',
    p.ubic && p.ubic.bateria ? `BAT ${p.ubic.bateria.nivel}%` : '',
  ].filter(Boolean).join(' · ');
  return `
    <button class="ruta-item" data-persona="${p.rol}">
      <span><b>${ROLES[p.rol].icono} ${escapar(nombrePersona(p))}</b>
      <small class="muted">${escapar(detalle)}</small></span>
      <span class="chip ${e.clase}">${escapar(e.corto)}</span>
    </button>`;
}

function lineasSaludPersona(perfil) {
  const e = edad(perfil.nacimiento);
  const tel = (n) => (n ? ` · <a href="tel:${escapar(limpiarTelefono(n))}">${escapar(n)}</a>` : '');
  const filas = [
    ['Edad', e !== null ? `${e} años` : ''],
    ['Tipo de sangre', escapar(perfil.sangre)],
    ['Alergias', escapar(perfil.alergias)],
    ['Padecimientos', escapar(perfil.medico)],
    ['Contacto de emergencia', perfil.emergNombre || perfil.emergTel ? `${escapar(perfil.emergNombre)}${tel(perfil.emergTel)}` : ''],
    ['Jefe asignado', perfil.jefe || perfil.jefeTel ? `${escapar(perfil.jefe)}${tel(perfil.jefeTel)}` : ''],
  ];
  return filas.map(([k, v]) => `<li><span>${k}</span><b>${v || '<span class="muted">sin dato</span>'}</b></li>`).join('');
}

async function refrescarJefe() {
  const rutas = await DB.todasLasRutas();
  const personas = await personasMonitoreo(rutas);
  if (!personas.some((p) => p.rol === estado.personaJefe)) estado.personaJefe = personas.length ? personas[0].rol : null;
  $('#j-personas').innerHTML = personas.length ? personas.map(itemPersona).join('')
    : '<p class="muted">Nadie comparte su ubicación ahora. Aparece aquí quien entre como scout con el GPS activado.</p>';

  const p = personas.find((x) => x.rol === estado.personaJefe);
  $('#j-detalle').hidden = !p;
  if (p) {
    const e = estadoPersona(p);
    $('#j-nombre').textContent = `${ROLES[p.rol].icono} ${nombrePersona(p)}`;
    const caja = $('#j-estado');
    caja.textContent = e.texto;
    caja.className = `estado-grande ${e.clase}`;
    $('#j-ubic').textContent = p.ubic
      ? `${p.ubic.lat.toFixed(5)}, ${p.ubic.lng.toFixed(5)} (±${Math.round(p.ubic.precision)} m)` : 'desconocida';
    $('#j-hora').textContent = p.ubic ? `${formatoHora(p.ubic.t)} (${formatoHace(p.ubic.t)})` : '—';
    $('#j-bateria').textContent = p.ubic ? textoBateria(p.ubic.bateria) : '—';
    $('#j-ruta').textContent = p.ruta
      ? `${formatoKm(distanciaRuta(p.ruta.coordenadas))} · desde las ${formatoHora(p.ruta.tiempos.inicio)}`
      : 'ninguna';
    $('#j-limite').textContent = estado.horaLimite
      ? `${formatoHora(estado.horaLimite)}${Date.now() > estado.horaLimite ? ' · ya pasó' : ''}`
      : 'sin definir';
    $('#j-salud').innerHTML = lineasSaludPersona(p.perfil);
  }

  if (p && p.ubic && $('#tab-jefe').classList.contains('active')) {
    const ultima = p.ubic;
    if (!mapas.jefe) {
      mapas.jefe = crearMapa('mapa-jefe');
      mapas.lineaJefe = L.polyline([], { color: '#ffd700', weight: 4 }).addTo(mapas.jefe);
      mapas.marcaJefe = L.marker([ultima.lat, ultima.lng]).addTo(mapas.jefe);
    }
    setTimeout(() => {
      mapas.jefe.invalidateSize();
      mapas.marcaJefe.setLatLng([ultima.lat, ultima.lng]);
      mapas.lineaJefe.setLatLngs(p.ruta ? p.ruta.coordenadas.map((c) => [c[0], c[1]]) : []);
      mapas.jefe.setView([ultima.lat, ultima.lng], 15);
    }, 50);
  }

  const cont = $('#j-rutas');
  const terminadas = rutas.filter((r) => r.estado !== 'en curso' && r.estado !== 'validacion');
  cont.innerHTML = terminadas.length ? terminadas.map((r) => itemRuta(r, true)).join('')
    : '<p class="muted">No hay rutas terminadas.</p>';
}

/* =========================================================
 * 11b. Revisión de rutas (experto)
 * ========================================================= */
const textoAutor = (r) => (r.autor
  ? `${r.autor.nombre || (ROLES[r.autor.rol] ? ROLES[r.autor.rol].nombre : r.autor.rol)}`
  : 'sin autor');

function itemRuta(r, conAutor = false) {
  return `
    <button class="ruta-item" data-ruta="${escapar(r.id)}">
      <span><b>${escapar(r.nombre)}</b>
      <small class="muted">${formatoFecha(r.tiempos.inicio)} · ${formatoKm(distanciaRuta(r.coordenadas))}` +
      `${conAutor ? ` · ${escapar(textoAutor(r))}` : ` · ${escapar(r.tipo)}`}</small></span>
      ${chipEstado(r)}
    </button>`;
}

async function refrescarRevisar() {
  if (!Sesion.puede('exp dev')) return;
  const rutas = (await DB.todasLasRutas()).filter((r) => r.estado !== 'en curso');
  const pendientes = rutas.filter((r) => r.estado === 'pendiente_revision');
  const revisadas = rutas.filter((r) => ['validada', 'verificada', 'rechazada'].includes(r.estado));
  $('#r-n-pend').textContent = pendientes.length;
  $('#r-pendientes').innerHTML = pendientes.length
    ? pendientes.map((r) => itemRuta(r, true)).join('')
    : '<p class="muted">No hay rutas pendientes. ✓</p>';
  $('#r-revisadas').innerHTML = revisadas.length
    ? revisadas.map((r) => itemRuta(r, true)).join('')
    : '<p class="muted">Todavía no hay rutas revisadas.</p>';
}

function pintarRevision(ruta) {
  const caja = $('#d-revision');
  const rev = ruta.revision;
  if (ruta.estado === 'en curso') { caja.hidden = true; return; }
  caja.hidden = false;
  if (ruta.estado === 'validacion') {
    caja.innerHTML = '<h2>Recorrido de validación</h2><p class="muted">Lo grabó un experto para comparar la ruta de un scout. No se revisa.</p>';
    return;
  }
  let html = '<h2>Revisión</h2>';
  if (rev && rev.estado === 'validada') {
    const vencida = rev.vigencia && fechaISO(new Date()) > rev.vigencia.fin;
    html += `<p><b>✓ Validada</b> por ${escapar(rev.por)} el ${formatoFecha(rev.t)} a las ${formatoHora(rev.t)}</p>` +
      `<p>Vigencia: <b>${fechaCorta(rev.vigencia.inicio)}</b> al <b>${fechaCorta(rev.vigencia.fin)}</b>${vencida ? ' <span class="chip rechazada">vencida</span>' : ''}</p>` +
      `<p class="small">Observaciones y alertas de seguridad:</p><p class="nota">${escapar(rev.nota)}</p>` +
      `<p class="muted small">Variación: distancia ${formatoPorcentaje(rev.variacion.distancia)}` +
      `${rev.variacion.desnivel === null ? '' : `, desnivel ${formatoPorcentaje(rev.variacion.desnivel)}`}` +
      ` · Firma ${escapar(String(rev.firma).slice(0, 19))}…</p>`;
  } else if (rev) {
    html += `<p><b>${rev.estado === 'verificada' ? '✓ Aprobada' : '✕ Rechazada'}</b> por ${escapar(rev.por)} el ${formatoFecha(rev.t)} a las ${formatoHora(rev.t)}</p>` +
      (rev.nota ? `<p class="nota">“${escapar(rev.nota)}”</p>` : '');
  } else if (ruta.estado === 'pendiente_revision') {
    html += `<p class="muted">Enviada al experto${ruta.envio ? ` el ${formatoFecha(ruta.envio.t)} a las ${formatoHora(ruta.envio.t)}` : ''}. Pendiente de revisión.</p>`;
  } else {
    html += '<p class="muted">Sin enviar. Cuando quieras que un experto la valide, toca "Enviar a validación de experto".</p>';
  }
  if (ruta.validacion && !(rev && rev.estado === 'validada')) {
    const v = ruta.validacion;
    html += `<p class="small">Último recorrido de validación (${formatoFecha(v.t)}):</p>${tablaComparacion(v)}` +
      (v.dentro ? '<p class="aviso-bien">Dentro de la tolerancia: se puede aprobar.</p>'
        : `<p class="aviso-texto">⚠ La variación supera el ${v.tolerancia} %: no se puede aprobar.</p>`);
  }
  if (Sesion.puede('exp dev') && ruta.estado !== 'pendiente_revision') {
    html += rev ? '<button class="link" data-action="quitar-revision">Quitar revisión</button>' : '';
  } else if (Sesion.puede('exp dev')) {
    const puedeAprobar = ruta.validacion && ruta.validacion.dentro && !(rev && rev.estado === 'validada');
    html += `<div class="controls">
      <button class="${puedeAprobar ? 'secondary' : 'primary'}" data-action="validar">🥾 Realizar recorrido de validación</button>
    </div>
    <div class="controls dos">
      <button class="primary" data-action="aprobar"${puedeAprobar ? '' : ' disabled'}>✓ Aprobar</button>
      <button class="danger" data-action="rechazar">✕ Rechazar</button>
    </div>
    ${rev ? '<button class="link" data-action="quitar-revision">Quitar revisión</button>' : ''}`;
  }
  caja.innerHTML = html;
}

function revisarRuta(resultado) {
  const ruta = estado.rutaAbierta;
  if (!ruta || !Sesion.puede('exp dev')) return;
  const aprobar = resultado === 'verificada';
  abrirModal(aprobar ? 'Aprobar ruta' : 'Rechazar ruta', `
    <p><b>${escapar(ruta.nombre)}</b> · ${formatoKm(distanciaRuta(ruta.coordenadas))}</p>
    <label class="campo">Nota ${aprobar ? '(opcional)' : '(di qué hay que corregir)'}
      <textarea id="f-nota" maxlength="300" placeholder="${aprobar ? 'Ej. Recorrido completo y seguro' : 'Ej. El recorrido se corta a media subida'}"></textarea>
    </label>`,
  [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: aprobar ? 'Aprobar' : 'Rechazar', clase: aprobar ? 'primary' : 'danger', accion: async () => {
      const nota = $('#f-nota').value.trim();
      ruta.estado = resultado;
      ruta.revision = {
        estado: resultado,
        nota,
        por: estado.perfil.nombre ? `${estado.perfil.nombre} (${ROLES[Sesion.rol].nombre})` : ROLES[Sesion.rol].nombre,
        t: Date.now(),
      };
      await DB.guardarRuta(ruta);
      await refrescarTodo();
      abrirDetalle(ruta.id);
      aviso(aprobar ? 'Ruta aprobada' : 'Ruta rechazada');
    } },
  ]);
}

async function quitarRevision() {
  const ruta = estado.rutaAbierta;
  if (!ruta || !Sesion.puede('exp dev')) return;
  ruta.estado = 'pendiente_revision'; // vuelve a la bandeja del experto
  delete ruta.revision;
  await DB.guardarRuta(ruta);
  await refrescarTodo();
  abrirDetalle(ruta.id);
  aviso('Revisión quitada');
}

/* =========================================================
 * 11b-2. Validación de rutas (experto)
 * =========================================================
 * El experto recorre la ruta del scout. Al terminar, Nova compara la
 * distancia total y el desnivel (subida acumulada). Si ninguno varía más
 * de TOLERANCIA_VALIDACION %, se habilita el formulario de aprobación.
 */
const TOLERANCIA_VALIDACION = 15; // %

const tieneAltitud = (coords) => coords.some((c) => c[3] !== null && c[3] !== undefined);
const formatoPorcentaje = (n) => `${n.toFixed(1)} %`;
const quienFirma = () => (estado.perfil.nombre
  ? `${estado.perfil.nombre} (${ROLES[Sesion.rol].nombre})` : ROLES[Sesion.rol].nombre);

/* Diferencia relativa respecto al valor original, en % */
function variacionPorcentaje(original, real) {
  if (original === 0) return real === 0 ? 0 : 100;
  return (Math.abs(real - original) / original) * 100;
}

/* Compara la ruta original del scout con el recorrido real del experto.
 * Si alguna de las dos no tiene altitud, el desnivel no se puede comparar
 * y se decide solo con la distancia. */
function compararRecorridos(original, recorrido) {
  const dOriginal = distanciaRuta(original.coordenadas);
  const dReal = distanciaRuta(recorrido.coordenadas);
  const conAltitud = tieneAltitud(original.coordenadas) && tieneAltitud(recorrido.coordenadas);
  const distancia = { original: dOriginal, real: dReal, variacion: variacionPorcentaje(dOriginal, dReal) };
  let desnivel = null;
  if (conAltitud) {
    const sOriginal = datosAltitud(original.coordenadas).subida;
    const sReal = datosAltitud(recorrido.coordenadas).subida;
    desnivel = { original: sOriginal, real: sReal, variacion: variacionPorcentaje(sOriginal, sReal) };
  }
  const dentro = distancia.variacion <= TOLERANCIA_VALIDACION &&
    (!desnivel || desnivel.variacion <= TOLERANCIA_VALIDACION);
  return {
    recorridoId: recorrido.id,
    t: Date.now(),
    por: { rol: Sesion.rol, nombre: estado.perfil.nombre || '' },
    tolerancia: TOLERANCIA_VALIDACION,
    distancia,
    desnivel,
    dentro,
  };
}

/* Huella SHA-256 que sirve de firma de la aprobación */
async function huellaTexto(texto) {
  if (window.crypto && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return 'sha256:' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'fnv:' + (h >>> 0).toString(16);
}

/* Ruta original punteada en el mapa de Grabar, para seguirla */
async function pintarGuia(rutaId) {
  const original = rutaId ? await DB.leerRuta(rutaId) : null;
  const mapa = mapaGrabar();
  if (!mapas.guia) mapas.guia = L.polyline([], { color: '#89dceb', weight: 4, opacity: 0.7, dashArray: '6 8' });
  if (!original) { mapas.guia.remove(); return; }
  mapas.guia.setLatLngs(original.coordenadas.map((c) => [c[0], c[1]])).addTo(mapa);
  mapas.linea.bringToFront();
}

function iniciarValidacion() {
  const ruta = estado.rutaAbierta;
  if (!ruta || !Sesion.puede('exp dev')) return;
  if (ruta.estado !== 'pendiente_revision') { aviso('Esta ruta no se ha enviado a validación'); return; }
  if (estado.modo !== 'detenida') { aviso('Termina primero la ruta que estás grabando'); return; }
  if (ruta.coordenadas.length < 2) { aviso('La ruta no tiene puntos para comparar'); return; }
  const alt = datosAltitud(ruta.coordenadas);
  abrirModal('Recorrido de validación', `
    <p><b>${escapar(ruta.nombre)}</b> · ${formatoKm(distanciaRuta(ruta.coordenadas))}` +
    `${tieneAltitud(ruta.coordenadas) ? ` · subida ${Math.round(alt.subida)} m` : ''}</p>
    <p class="small">Recorre la ruta con Nova grabando. La ruta del scout se ve punteada en el mapa.</p>
    <p class="muted small">Al terminar se comparan la distancia total y el desnivel. Si ninguno varía más de ${TOLERANCIA_VALIDACION} %, podrás llenar el formulario de aprobación.</p>`,
  [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: '🥾 Empezar', clase: 'primary', accion: () => { irATab('grabar'); iniciarRuta(ruta); } },
  ]);
}

/* Se llama al guardar el recorrido del experto */
async function terminarValidacion(recorrido) {
  pintarGuia(null);
  const original = await DB.leerRuta(recorrido.validacionDe);
  if (!original) { aviso('No se encontró la ruta original'); return; }
  original.validacion = compararRecorridos(original, recorrido);
  await DB.guardarRuta(original);
  await refrescarTodo();
  irATab('rutas');
  estado.volverA = 'revisar';
  await abrirDetalle(original.id);
  mostrarComparacion(original);
}

function tablaComparacion(v) {
  const celda = (n) => `<td class="${n <= v.tolerancia ? 'bien' : 'mal'}">${formatoPorcentaje(n)}</td>`;
  return `
    <table class="comparacion">
      <tr><th></th><th>Scout</th><th>Experto</th><th>Variación</th></tr>
      <tr><td>Distancia</td><td>${formatoKm(v.distancia.original)}</td><td>${formatoKm(v.distancia.real)}</td>${celda(v.distancia.variacion)}</tr>
      ${v.desnivel
        ? `<tr><td>Desnivel</td><td>${Math.round(v.desnivel.original)} m</td><td>${Math.round(v.desnivel.real)} m</td>${celda(v.desnivel.variacion)}</tr>`
        : '<tr><td>Desnivel</td><td colspan="3" class="muted">Sin datos de altitud: no se compara</td></tr>'}
    </table>`;
}

function mostrarComparacion(ruta) {
  const v = ruta.validacion;
  if (!v) return;
  if (v.dentro) {
    abrirModal('✓ Recorrido dentro de la tolerancia', `
      ${tablaComparacion(v)}
      <p class="aviso-bien">La variación es de ${v.tolerancia} % o menos. Ya puedes aprobar la ruta.</p>`,
    [
      { texto: 'Después', clase: 'secondary' },
      { texto: 'Formulario de aprobación', clase: 'primary', accion: () => formularioAprobacion() },
    ]);
  } else {
    abrirModal('⚠ La variación supera el 15 %', `
      ${tablaComparacion(v)}
      <p class="aviso-texto">El recorrido real no coincide con la ruta del scout. <b>No se puede aprobar.</b> Revisa el trazo con el scout o vuelve a hacer el recorrido de validación.</p>`,
    [
      { texto: 'Cerrar', clase: 'secondary' },
      { texto: '✕ Rechazar ruta', clase: 'danger', accion: () => revisarRuta('rechazada') },
    ]);
  }
}

const fechaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fechaCorta = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

function formularioAprobacion(previo = null) {
  const ruta = estado.rutaAbierta;
  if (!ruta || !Sesion.puede('exp dev')) return;
  if (ruta.estado !== 'pendiente_revision') { aviso('Esta ruta no se ha enviado a validación'); return; }
  if (!ruta.validacion || !ruta.validacion.dentro) { aviso('Primero haz un recorrido de validación dentro de la tolerancia'); return; }
  const hoy = new Date();
  const enUnAnio = new Date(hoy.getFullYear() + 1, hoy.getMonth(), hoy.getDate());
  const p = previo || { inicio: fechaISO(hoy), fin: fechaISO(enUnAnio), obs: '' };
  abrirModal('Aprobar ruta', `
    <p><b>${escapar(ruta.nombre)}</b></p>
    ${tablaComparacion(ruta.validacion)}
    <div class="fila-dos">
      <label>Vigente desde<input type="date" id="f-vig-inicio" value="${p.inicio}" required></label>
      <label>Vigente hasta<input type="date" id="f-vig-fin" value="${p.fin}" required></label>
    </div>
    <label>Observaciones y alertas de seguridad
      <textarea id="f-obs" maxlength="600" required placeholder="Ej. Piedra suelta después del km 2. Llevar 2 litros de agua. No subir con lluvia.">${escapar(p.obs)}</textarea>
    </label>
    <p class="muted small">Se firma con tu usuario: ${escapar(quienFirma())}.</p>`,
  [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: '✓ Aprobar', clase: 'primary', accion: async () => {
      const datos = { inicio: $('#f-vig-inicio').value, fin: $('#f-vig-fin').value, obs: $('#f-obs').value.trim() };
      let error = '';
      if (!datos.inicio || !datos.fin) error = 'Escribe las dos fechas de vigencia';
      else if (datos.fin < datos.inicio) error = 'La fecha final debe ser después de la inicial';
      else if (!datos.obs) error = 'Escribe las observaciones y alertas de seguridad';
      if (error) { aviso(error); formularioAprobacion(datos); return; }
      await aprobarRuta(ruta, datos);
    } },
  ]);
}

async function aprobarRuta(ruta, datos) {
  const v = ruta.validacion;
  const revision = {
    estado: 'validada',
    nota: datos.obs,
    vigencia: { inicio: datos.inicio, fin: datos.fin },
    experto: { rol: Sesion.rol, nombre: estado.perfil.nombre || '' },
    por: quienFirma(),
    t: Date.now(),
    recorridoId: v.recorridoId,
    variacion: { distancia: v.distancia.variacion, desnivel: v.desnivel ? v.desnivel.variacion : null },
  };
  revision.firma = await huellaTexto(JSON.stringify([ruta.id, revision.estado, revision.vigencia,
    revision.nota, revision.experto, revision.t, revision.recorridoId]));
  ruta.estado = 'validada';
  ruta.revision = revision;
  await DB.guardarRuta(ruta);
  await refrescarTodo();
  abrirDetalle(ruta.id);
  aviso('Ruta validada ✓');
}

/* =========================================================
 * 11c. Administrador (dev)
 * ========================================================= */
async function refrescarAdmin() {
  if (!Sesion.puede('dev')) return;
  const filas = await Promise.all(Object.entries(ROLES).map(async ([rol, info]) => {
    const pred = await Sesion.usaPredeterminada(rol);
    return `
      <div class="clave-fila">
        <span><b>${info.icono} ${info.nombre}</b><small class="muted">usuario: ${rol}${pred ? ' · usa 0000' : ''}</small></span>
        <input type="password" inputmode="numeric" maxlength="20" placeholder="Nueva" data-clave="${rol}">
        <button class="secondary chico" data-action="cambiar-clave" data-rol="${rol}">Guardar</button>
      </div>`;
  }));
  $('#a-claves').innerHTML = filas.join('');

  const rutas = await DB.todasLasRutas();
  let uso = '—';
  if (navigator.storage && navigator.storage.estimate) {
    try { uso = `${((await navigator.storage.estimate()).usage / 1048576).toFixed(1)} MB`; } catch { /* sin dato */ }
  }
  $('#a-sistema').innerHTML = `
    <li><span>Versión</span><b>${VERSION_APP}</b></li>
    <li><span>Rutas guardadas</span><b>${rutas.length}</b></li>
    <li><span>Pendientes de revisión</span><b>${rutas.filter((r) => r.estado === 'pendiente_revision').length}</b></li>
    <li><span>Espacio usado</span><b>${uso}</b></li>
    <li><span>Abierta como</span><b>${ABIERTA_COMO_ARCHIVO ? 'archivo' : location.host}</b></li>`;
}

async function cambiarClave(rol) {
  const campo = document.querySelector(`[data-clave="${rol}"]`);
  const nueva = campo.value.trim();
  if (nueva.length < 4) { aviso('La contraseña debe tener al menos 4 caracteres'); return; }
  await Sesion.cambiarClave(rol, nueva);
  campo.value = '';
  await refrescarAdmin();
  aviso(`Contraseña de ${ROLES[rol].nombre} cambiada`);
}

function restablecerClaves() {
  abrirModal('Restablecer contraseñas', '<p>Todas las contraseñas volverán a ser <b>0000</b>.</p>', [
    { texto: 'Cancelar', clase: 'secondary' },
    { texto: 'Restablecer', clase: 'danger', accion: async () => {
      await Sesion.restablecer();
      await refrescarAdmin();
      aviso('Contraseñas restablecidas a 0000');
    } },
  ]);
}

/* =========================================================
 * 11d. Inicio y cierre de sesión
 * ========================================================= */
let resolverLogin = null;
const login = { rol: null, pin: '' };

function pasoLogin(nombre) {
  ['roles', 'pin', 'registro'].forEach((p) => { $(`#paso-${p}`).hidden = p !== nombre; });
}

function pintarRoles() {
  $('#l-roles').innerHTML = Object.entries(ROLES).map(([rol, info]) => `
    <button type="button" class="rol-tarjeta" data-login-rol="${rol}" style="--c:${info.color}">
      <span class="cara">
        <span class="icono">${info.icono}</span>
        <span class="nombre">${info.nombre.toUpperCase()}</span>
        <span class="desc">${info.desc}</span>
      </span>
      <span class="pie"><span>usuario: ${rol}</span><b>▶ ENTRAR</b></span>
    </button>`).join('');
}

function pintarPin() {
  const n = Math.max(4, login.pin.length);
  $('#l-puntos').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < login.pin.length ? 'lleno' : ''}"></i>`).join('');
}

function elegirRol(rol) {
  login.rol = rol;
  login.pin = '';
  const info = ROLES[rol];
  document.body.style.setProperty('--acento', info.color);
  $('#l-rol').innerHTML = `<span class="icono">${info.icono}</span> ${info.nombre.toUpperCase()}`;
  $('#l-error').hidden = true;
  pintarPin();
  pasoLogin('pin');
}

function teclaPin(t) {
  if (t === 'borrar') login.pin = login.pin.slice(0, -1);
  else if (t === 'ok') { probarPin(); return; }
  else if (login.pin.length < 12) login.pin += t;
  $('#l-error').hidden = true;
  pintarPin();
}

async function probarPin() {
  if (!login.pin) return;
  const rol = await Sesion.comprobar(login.rol, login.pin);
  if (!rol) {
    login.pin = '';
    pintarPin();
    $('#l-error').hidden = false;
    const caja = $('#paso-pin');
    caja.classList.remove('sacudir');
    void caja.offsetWidth;
    caja.classList.add('sacudir');
    if (navigator.vibrate) navigator.vibrate(120);
    return;
  }
  document.body.style.removeProperty('--acento');
  await Sesion.guardar(rol);
  await cargarPerfil(rol);
  if (!(await DB.leerAjuste(`perfil:${rol}`))) {
    empezarRegistro(rol);
    return;
  }
  await entrarComo(rol);
  terminarLogin(rol);
}

function terminarLogin(rol) {
  if (resolverLogin) { resolverLogin(rol); resolverLogin = null; }
}

/* Primera vez de este usuario: pide el perfil de seguridad */
function empezarRegistro(rol) {
  aplicarPermisos();
  document.body.classList.add('registrando');
  $('#l-rol-registro').textContent = ROLES[rol].nombre;
  $('#registro-destino').appendChild($('#form-perfil'));
  $('#pf-guardar').textContent = 'Guardar y entrar ▶';
  pintarPerfil();
  pasoLogin('registro');
  $('#login').scrollTop = 0;
}

async function terminarRegistro() {
  document.body.classList.remove('registrando');
  $('#perfil-destino').appendChild($('#form-perfil'));
  $('#pf-guardar').textContent = 'Guardar perfil';
  await entrarComo(Sesion.rol);
  terminarLogin(Sesion.rol);
}

function mostrarLogin() {
  aplicarPermisos();
  pintarRoles();
  pasoLogin('roles');
  $('#l-pie').textContent = `Nova ${VERSION_APP} · by Ariel`;
  return new Promise((resolve) => { resolverLogin = resolve; });
}

$('#l-teclado').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok']
  .map((t) => `<button type="button" data-tecla="${t}" class="${t === 'ok' ? 'ok' : ''}">${t === 'borrar' ? '⌫' : t === 'ok' ? '✓' : t}</button>`).join('');

$('#login').addEventListener('click', (e) => {
  const tarjeta = e.target.closest('[data-login-rol]');
  if (tarjeta) return elegirRol(tarjeta.dataset.loginRol);
  const tecla = e.target.closest('[data-tecla]');
  if (tecla) return teclaPin(tecla.dataset.tecla);
  if (e.target.closest('[data-login="volver"]')) {
    document.body.style.removeProperty('--acento');
    pasoLogin('roles');
  }
});

// Teclado físico en la computadora
document.addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('sin-sesion') || $('#paso-pin').hidden) return;
  if (/^[0-9]$/.test(e.key)) teclaPin(e.key);
  else if (e.key === 'Backspace') teclaPin('borrar');
  else if (e.key === 'Enter') teclaPin('ok');
  else if (e.key === 'Escape') pasoLogin('roles');
});

async function cargarPerfil(rol) {
  // Cada tipo de usuario tiene sus propios datos
  const guardado = (await DB.leerAjuste(`perfil:${rol}`)) || {};
  // Perfiles de versiones anteriores: "telefono" era el del jefe
  if (guardado.telefono && !guardado.jefeTel) guardado.jefeTel = guardado.telefono;
  estado.perfil = Object.assign({}, PERFIL_VACIO, guardado);
  delete estado.perfil.telefono;
}

async function entrarComo(rol, silencioso = false) {
  await cargarPerfil(rol);
  aplicarPermisos();
  pintarPerfil();
  refrescarTodo();
  irATab(ROLES[rol].inicio);
  iniciarGPS();
  if (!silencioso) aviso(`Hola, ${estado.perfil.nombre.split(' ')[0] || ROLES[rol].nombre} ✦`);
}

function menuCuenta() {
  const info = ROLES[Sesion.rol];
  const grabando = estado.modo !== 'detenida';
  abrirModal(`${info.icono} ${info.nombre}`, `
    <p class="small">Usuario: <b>${Sesion.rol}</b>${estado.perfil.nombre ? ` · ${escapar(estado.perfil.nombre)}` : ''}</p>
    ${grabando ? '<p class="small aviso-texto">Tienes una ruta abierta. Quedará en pausa y se recupera al volver a entrar.</p>' : ''}`,
  [
    { texto: 'Cerrar', clase: 'secondary' },
    { texto: 'Cerrar sesión', clase: 'danger', accion: cerrarSesion },
  ]);
}

async function cerrarSesion() {
  if (estado.modo === 'grabando') pausarRuta();
  detenerSimulador();
  await Sesion.cerrar();
  estado.pruebas = false;
  document.body.classList.remove('pruebas');
  if ($('#modal').open) $('#modal').close();
  await mostrarLogin();
}

/* =========================================================
 * 12. Inicio
 * ========================================================= */
async function refrescarInicio() {
  pintarHud();
}

async function leerBateria() {
  if (!navigator.getBattery) { hud('bat', 'BAT N/D'); return; }
  try {
    const b = await navigator.getBattery();
    const pintar = () => {
      const n = Math.round(b.level * 100);
      estado.bateria = { nivel: n, cargando: b.charging };
      hud('bat', `BAT ${n}%${b.charging ? '+' : ''}`, n <= 15 ? 'mal' : n <= 30 ? 'medio' : 'info');
    };
    pintar();
    b.addEventListener('levelchange', pintar);
    b.addEventListener('chargingchange', pintar);
  } catch { hud('bat', 'BAT N/D'); }
}

async function refrescarTodo() {
  if (!Sesion.rol) return;
  await Promise.all([refrescarInicio(), refrescarLista(), refrescarJefe(), refrescarRevisar(), refrescarAdmin()]);
}

/* =========================================================
 * 13. Simulador y modo demostración (sin GPS real)
 * ========================================================= */
function arrancarSimulador(siguientePunto, intervalo, mensaje) {
  if (idWatch !== null) { navigator.geolocation.clearWatch(idWatch); idWatch = null; }
  estado.simulador = setInterval(() => {
    const p = siguientePunto();
    if (!p) { detenerSimulador(); aviso('Fin de la demostración; pulsa Terminar para guardar', 4000); return; }
    recibirPosicion(p[0], p[1], 6, Date.now(), p[2]);
  }, intervalo);
  $('#btn-simular').textContent = '⏹ Detener simulación';
  irATab('grabar');
  bloquearMapa(true);
  if (estado.modo === 'detenida') setTimeout(iniciarRuta, 1200);
  aviso(mensaje);
}

function iniciarSimulador() {
  if (estado.simulador) { detenerSimulador(); aviso('Simulación detenida'); return; }
  if (estado.modo !== 'detenida') { aviso('Termina la ruta en curso antes de simular'); return; }
  let lat = CENTRO_INICIAL[0] - 0.004;
  let lng = CENTRO_INICIAL[1] - 0.01;
  let alt = 2350;
  let paso = 0;
  let rumbo = 0.6;
  arrancarSimulador(() => {
    paso++;
    // Del paso 70 al 140 se queda quieto: genera un descanso automático
    if (paso < 70 || paso > 140) {
      rumbo += (Math.random() - 0.5) * 0.4;
      lat += Math.cos(rumbo) * 0.000025;
      lng += Math.sin(rumbo) * 0.000025;
      alt += Math.random() * 0.9;
    }
    return [lat + (Math.random() - 0.5) * 0.000004, lng, alt];
  }, 1000, 'Simulando recorrido (≈2.8 m/s)');
}

function repetirRuta() {
  const ruta = estado.rutaAbierta;
  if (estado.modo !== 'detenida' || estado.simulador) { aviso('Termina la ruta en curso antes de la demostración'); return; }
  if (ruta.coordenadas.length < 2) { aviso('La ruta no tiene puntos'); return; }
  // Se reproduce en unos 90 segundos, sin importar lo larga que sea
  const salto = Math.max(1, Math.ceil(ruta.coordenadas.length / 180));
  let i = 0;
  arrancarSimulador(() => {
    if (i >= ruta.coordenadas.length) return null;
    const c = ruta.coordenadas[i];
    i += salto;
    return [c[0], c[1], c[3]];
  }, 500, `Demostración: ${ruta.nombre}`);
}

function detenerSimulador() {
  if (!estado.simulador) return;
  clearInterval(estado.simulador);
  estado.simulador = null;
  $('#btn-simular').textContent = '▶ Simular recorrido de prueba';
  iniciarGPS();
}

/* =========================================================
 * 14. Ventana emergente genérica
 * ========================================================= */
function abrirModal(titulo, html, botones) {
  const modal = $('#modal');
  if (modal.open) modal.close();
  $('#m-titulo').textContent = titulo;
  $('#m-cuerpo').innerHTML = html;
  const cont = $('#m-botones');
  cont.innerHTML = '';
  cont.classList.toggle('uno', botones.length === 1);
  botones.forEach((b) => {
    const btn = document.createElement('button');
    btn.textContent = b.texto;
    btn.className = b.clase;
    btn.type = 'button';
    // Se cierra primero; los campos siguen legibles para la acción.
    // Así una acción puede abrir otra ventana sin que se cierre.
    btn.addEventListener('click', async () => {
      modal.close();
      if (b.accion) await b.accion();
    });
    cont.appendChild(btn);
  });
  modal.showModal();
}

/* =========================================================
 * 15. Navegación y eventos
 * ========================================================= */
function irATab(nombre) {
  const boton = document.querySelector(`.tabbar [data-tab="${nombre}"]`);
  if (!boton || boton.classList.contains('sin-permiso')) nombre = 'grabar';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${nombre}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === nombre));
  $('main').scrollTop = 0;
  if (nombre === 'grabar') setTimeout(() => mapaGrabar().invalidateSize(), 50);
  if (nombre === 'jefe') refrescarJefe();
  if (nombre === 'rutas') { cerrarDetalle(); refrescarLista(); }
  if (nombre === 'revisar') refrescarRevisar();
  if (nombre === 'admin') refrescarAdmin();
  if (nombre === 'perfil') pintarPerfil();
}

const acciones = {
  'iniciar': iniciarRuta,
  'pausar': pausarRuta,
  'descanso': alternarDescanso,
  'terminar': terminarRuta,
  'centrar': centrarMapa,
  'guardar-zona': guardarZona,
  'jefe-limite': definirHoraLimite,
  'sos': abrirSOS,
  'simular': iniciarSimulador,
  'volver-lista': volverDeDetalle,
  'cuenta': menuCuenta,
  'aprobar': () => formularioAprobacion(),
  'validar': iniciarValidacion,
  'rechazar': () => revisarRuta('rechazada'),
  'quitar-revision': quitarRevision,
  'restablecer-claves': restablecerClaves,
  'renombrar': renombrarRuta,
  'eliminar': eliminarRuta,
  'exportar': exportarRuta,
  'cancelar-borrado': cancelarBorrado,
  'bloqueo': alternarBloqueo,
  'ver-ruta': verRutaCompleta,
  'hud': detalleEstado,
  'cerrar-sesion': () => cerrarSesion(),
  'repetir': repetirRuta,
  'importar': () => $('#f-importar').click(),
  'borrar-todo': borrarTodo,
  'instalar': () => instalarApp(),
  'enviar-ubicacion': enviarUbicacion,
  'enviar-validacion': enviarAValidacion,
};

document.addEventListener('click', (e) => {
  if (e.target.closest('dialog')) return; // los botones de la ventana tienen su propio manejo
  const tab = e.target.closest('[data-tab]');
  if (tab) return irATab(tab.dataset.tab);
  if (e.target.closest('#hud')) return detalleEstado();
  const accion = e.target.closest('[data-action]');
  if (accion && accion.dataset.action === 'cambiar-clave') return cambiarClave(accion.dataset.rol);
  if (accion && acciones[accion.dataset.action]) return acciones[accion.dataset.action]();
  const persona = e.target.closest('[data-persona]');
  if (persona) {
    estado.personaJefe = persona.dataset.persona;
    refrescarJefe().then(() => $('#j-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return;
  }
  const ruta = e.target.closest('[data-ruta]');
  if (ruta) {
    const actual = document.querySelector('.tab.active').id.replace('tab-', '');
    if (actual !== 'rutas') { irATab('rutas'); estado.volverA = actual; }
    return abrirDetalle(ruta.dataset.ruta);
  }
});

$('#p-pruebas').addEventListener('change', async (e) => {
  estado.pruebas = e.target.checked;
  await DB.guardarAjuste('pruebas', estado.pruebas);
  pintarPerfil();
  aviso(estado.pruebas ? 'Modo pruebas activado' : 'Modo pruebas desactivado');
});

$('#f-importar').addEventListener('change', (e) => {
  const archivos = [...e.target.files];
  e.target.value = '';
  if (archivos.length) importarArchivos(archivos);
});

window.addEventListener('online', pintarHud);
window.addEventListener('offline', pintarHud);

/* ---------- Instalación como app ---------- */
let promptInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalar = e;
  $('#btn-instalar').hidden = false;
});
window.addEventListener('appinstalled', () => {
  promptInstalar = null;
  $('#btn-instalar').hidden = true;
  aviso('Nova quedó instalada');
});

async function instalarApp() {
  if (!promptInstalar) return;
  promptInstalar.prompt();
  await promptInstalar.userChoice;
  promptInstalar = null;
  $('#btn-instalar').hidden = true;
}

const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const yaInstalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function ofrecerInstalacion() {
  if (yaInstalada || (await DB.leerAjuste('avisoInstalar'))) return;
  if (!promptInstalar && !esIOS) return;
  await DB.guardarAjuste('avisoInstalar', true);
  const texto = esIOS
    ? '<p>En iPhone: toca el botón <b>Compartir</b> y luego <b>Agregar a pantalla de inicio</b>.</p>'
    : '<p>Instala Nova para abrirla como app, sin barra del navegador y sin internet.</p>';
  abrirModal('📲 Instalar como app', texto, esIOS
    ? [{ texto: 'Entendido', clase: 'primary' }]
    : [{ texto: 'Ahora no', clase: 'secondary' }, { texto: 'Instalar', clase: 'primary', accion: instalarApp }]);
}

/* =========================================================
 * 16. Arranque
 * ========================================================= */
async function arrancar() {
  await DB.abrir();
  estado.horaLimite = (await DB.leerAjuste('horaLimite')) || null;
  // Una hora límite de hace más de 12 horas ya no sirve
  if (estado.horaLimite && Date.now() - estado.horaLimite > 12 * 3600000) {
    estado.horaLimite = null;
    await DB.guardarAjuste('horaLimite', null);
  }
  estado.sos = (await DB.leerAjuste('sos')) || null;
  estado.pruebas = !!(await DB.leerAjuste('pruebas'));
  pintarPerfil();

  // Si la app se cerró a media ruta, se recupera como pausada
  const rutas = await DB.todasLasRutas();
  const pendiente = rutas.find((r) => r.estado === 'en curso');
  if (pendiente) {
    estado.grabacion = pendiente;
    estado.modo = 'pausada';
    estado.acumuladoMs = pendiente.tiempos.activoMs || 0;
    mapaGrabar();
    mapas.linea.setLatLngs(pendiente.coordenadas.map((c) => [c[0], c[1]]));
    if (pendiente.validacionDe) pintarGuia(pendiente.validacionDe);
    aviso('Se recuperó una ruta sin terminar (en pausa). Pulsa Reanudar para seguir.', 5000);
  }

  actualizarBotones();
  await refrescarTodo();
  refrescarEstadoMapa();
  leerBateria();

  // Reloj: actualiza el panel cada segundo y guarda el tiempo activo
  setInterval(() => {
    if (estado.modo !== 'detenida') {
      actualizarPanelGrabar();
      if (estado.grabacion) estado.grabacion.tiempos.activoMs = tiempoActivo();
    }
    revisarHoraLimite();
  }, 1000);
  // Borrados programados (1 hora) y estado
  procesarBorrados();
  setInterval(() => { procesarBorrados(); pintarHud(); }, 30000);
  // La vista del jefe se actualiza sola cada 10 s
  setInterval(() => { if ($('#tab-jefe').classList.contains('active')) refrescarJefe(); }, 10000);

  if ('serviceWorker' in navigator && !ABIERTA_COMO_ARCHIVO) {
    const habiaControlador = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker:', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (habiaControlador) aviso('Nueva versión instalada; se usará al volver a abrir la app', 4000);
    });
  }

  if (ABIERTA_COMO_ARCHIVO) {
    const barra = document.createElement('div');
    barra.className = 'aviso-archivo';
    barra.innerHTML = '⚠ Abriste la app como archivo. El GPS y el modo offline no funcionan así. ' +
      'Usa <b>iniciar.sh</b> (Linux) o <b>iniciar.bat</b> (Windows), o en la terminal, dentro de la carpeta, ' +
      'ejecuta <code>python3 -m http.server 8000</code> y abre <b>http://localhost:8000</b>';
    document.body.insertBefore(barra, document.querySelector('main'));
  }

  // Sesión: se recupera la última o se pide usuario y contraseña
  if (await Sesion.recuperar() && await DB.leerAjuste(`perfil:${Sesion.rol}`)) await entrarComo(Sesion.rol, true);
  else { await Sesion.cerrar(); await mostrarLogin(); }

  // El permiso de ubicación se pide al entrar (entrarComo → iniciarGPS)
  pintarHud();
}

arrancar();
