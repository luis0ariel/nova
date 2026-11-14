/* Nube de Nova: sincroniza el monitoreo entre teléfonos con Firebase Realtime Database.
 *
 * No usa el SDK de Firebase ni ninguna CDN: habla con la API REST de Firebase,
 * con fetch para escribir y EventSource para escuchar en tiempo real.
 *
 * Todo vive en  <url>/grupos/<codigo>/ :
 *   monitoreo  objeto del ajuste 'monitoreo' (estado, consentimiento, hora límite)
 *   ubicacion  última ubicación de quien aceptó el monitoreo, con un resumen de su ruta
 *   rastro     { <t>: [lat, lng] } puntos de su ruta abierta
 *   sos        SOS activo
 *
 * El código del grupo (16 o más letras y números) es lo que protege los datos: las
 * reglas de Firebase solo dejan leer y escribir dentro de una carpeta cuyo nombre
 * tenga 16 caracteres o más. Quien no conozca el código no puede ver nada.
 *
 * Esta pieza no sabe nada de Nova: solo guarda, envía y recibe datos. Qué se sube
 * y cuándo lo decide app.js (sección "Nube"), respetando el consentimiento.
 */
const NUBE_URL_PREDETERMINADA = 'https://nova-rutas-default-rtdb.firebaseio.com';
const NUBE_CODIGO_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

/* Firebase no guarda null, "" ni objetos vacíos y devuelve las claves ordenadas.
 * Por eso dos datos se comparan sin importar el orden ni los valores vacíos. */
function nubeVacio(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'object' && Object.keys(v).length === 0);
}

function nubeIgual(a, b) {
  if (nubeVacio(a) || nubeVacio(b)) return nubeVacio(a) && nubeVacio(b);
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of claves) if (!nubeIgual(a[k], b[k])) return false;
  return true;
}

function nubeTextoError(err) {
  const e = err && err.estado;
  if (e === 401 || e === 403) return 'Permiso denegado. Revisa que las reglas de Firebase estén publicadas y que el código tenga 16 o más caracteres.';
  if (e === 404) return 'La dirección de la base no existe. Revisa la dirección completa y la región.';
  if (e) return `Firebase respondió con el error ${e}.`;
  return 'No se pudo conectar. Revisa tu internet y la dirección de la base.';
}

const Nube = (() => {
  const cfg = { url: NUBE_URL_PREDETERMINADA, codigo: '', activa: false };
  let fuente = null;            // EventSource abierto
  let datos = {};               // copia de lo que hay en la nube para este grupo
  let sincronizada = false;     // ya llegó la primera copia completa
  let conexion = 'apagada';     // apagada | pausada | conectando | conectada | sin-red | error
  let detalle = '';
  let ultimoEvento = 0;
  let intentos = 0;
  let version = 0;
  let enviando = false;
  let intentosFlush = 0;
  let tFlush = null;
  let tReintentoFlush = null;
  let tReconexion = null;
  const pendientes = new Map(); // ruta -> { valor, version }; null borra
  const oyentesDatos = [];
  const oyentesEstado = [];
  let permitido = () => true;   // app.js lo cambia: en modo offline la nube se pausa

  const quitarBarra = (u) => String(u || '').trim().replace(/\/+$/, '');
  const base = () => `${quitarBarra(cfg.url)}/grupos/${cfg.codigo}`;
  const codigoOk = (c = cfg.codigo) => NUBE_CODIGO_VALIDO.test(c);
  const activa = () => cfg.activa && codigoOk() && permitido();

  function llamar(lista, ...args) {
    lista.forEach((f) => { try { f(...args); } catch (err) { console.warn('Nube:', err); } });
  }

  function ponerEstado(nuevo, texto = '') {
    if (conexion === nuevo && detalle === texto) return;
    conexion = nuevo;
    detalle = texto;
    llamar(oyentesEstado);
  }

  async function pedir(url, opciones = {}, ms = 15000) {
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), ms);
    try {
      const r = await fetch(url, { ...opciones, signal: control.signal });
      if (!r.ok) {
        const e = new Error(`HTTP ${r.status}`);
        e.estado = r.status;
        throw e;
      }
      return r;
    } finally {
      clearTimeout(t);
    }
  }

  /* ---------- Copia local de lo que hay en la nube ---------- */
  function ponerLocal(ruta, valor) {
    const partes = ruta.split('/').filter(Boolean);
    if (!partes.length) { datos = valor && typeof valor === 'object' ? valor : {}; return; }
    let nodo = datos;
    for (let i = 0; i < partes.length - 1; i++) {
      if (!nodo[partes[i]] || typeof nodo[partes[i]] !== 'object') nodo[partes[i]] = {};
      nodo = nodo[partes[i]];
    }
    const ultimo = partes[partes.length - 1];
    if (valor === null || valor === undefined) delete nodo[ultimo];
    else nodo[ultimo] = valor;
  }

  /* Evento de Firebase: put (reemplaza una ruta) o patch (cambia varias hijas). */
  function evento(tipo, e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg) return;
    ultimoEvento = Date.now();
    const ruta = msg.path || '/';
    const claves = new Set();
    if (tipo === 'put') {
      if (ruta === '/') Object.keys(datos).forEach((k) => claves.add(k));
      ponerLocal(ruta, msg.data);
      if (ruta === '/') Object.keys(datos).forEach((k) => claves.add(k));
      else claves.add(ruta.split('/').filter(Boolean)[0]);
    } else {
      Object.entries(msg.data || {}).forEach(([k, v]) => {
        const completa = `${ruta.replace(/\/$/, '')}/${k}`;
        ponerLocal(completa, v);
        claves.add(completa.split('/').filter(Boolean)[0]);
      });
    }
    sincronizada = true;
    llamar(oyentesDatos, claves);
  }

  /* ---------- Envío ---------- */
  /* Dos rutas pendientes no pueden solaparse (Firebase rechaza el lote): una ruta
   * nueva reemplaza a sus hijas pendientes y, si su madre está pendiente, se mete dentro. */
  function acomodar(ruta, valor) {
    for (const otra of [...pendientes.keys()]) {
      if (otra.startsWith(`${ruta}/`)) pendientes.delete(otra);
    }
    for (const [otra, p] of pendientes) {
      if (!ruta.startsWith(`${otra}/`)) continue;
      if (!p.valor || typeof p.valor !== 'object') p.valor = {};
      const partes = ruta.slice(otra.length + 1).split('/');
      let nodo = p.valor;
      for (let i = 0; i < partes.length - 1; i++) {
        if (!nodo[partes[i]] || typeof nodo[partes[i]] !== 'object') nodo[partes[i]] = {};
        nodo = nodo[partes[i]];
      }
      nodo[partes[partes.length - 1]] = valor;
      p.version = ++version;
      return true;
    }
    return false;
  }

  /* Escribe (o borra, con null) una ruta dentro del grupo. Si no hay red, queda pendiente. */
  function subir(ruta, valor) {
    if (!activa()) return;
    const copia = valor === null || valor === undefined ? null : JSON.parse(JSON.stringify(valor));
    ponerLocal(ruta, copia);
    if (!acomodar(ruta, copia)) pendientes.set(ruta, { valor: copia, version: ++version });
    programarFlush(300);
  }

  function programarFlush(ms) {
    if (tFlush) return;
    tFlush = setTimeout(() => { tFlush = null; flush(); }, ms);
  }

  async function flush() {
    if (!activa() || !pendientes.size || enviando) return;
    enviando = true;
    const lote = {};
    const versiones = [];
    pendientes.forEach((p, ruta) => { lote[ruta] = p.valor; versiones.push([ruta, p.version]); });
    try {
      await pedir(`${base()}.json`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lote),
      });
      versiones.forEach(([ruta, v]) => {
        const p = pendientes.get(ruta);
        if (p && p.version === v) pendientes.delete(ruta);
      });
      intentosFlush = 0;
    } catch (err) {
      intentosFlush++;
      clearTimeout(tReintentoFlush);
      tReintentoFlush = setTimeout(flush, Math.min(60000, 3000 * 2 ** intentosFlush));
      if (err && (err.estado === 401 || err.estado === 403)) ponerEstado('error', nubeTextoError(err));
    } finally {
      enviando = false;
    }
    if (pendientes.size && intentosFlush === 0) programarFlush(300); // llegaron cambios mientras se enviaba
  }

  /* ---------- Conexión en tiempo real ---------- */
  function cerrar() {
    clearTimeout(tReconexion);
    tReconexion = null;
    if (fuente) {
      try { fuente.close(); } catch { /* ya estaba cerrada */ }
      fuente = null;
    }
  }

  function programarReconexion() {
    clearTimeout(tReconexion);
    intentos++;
    tReconexion = setTimeout(() => { tReconexion = null; conectar(); }, Math.min(60000, 2000 * 2 ** Math.min(intentos, 5)));
  }

  /* Cuando EventSource se cierra solo, se pide la causa con una lectura normal. */
  async function diagnosticar() {
    cerrar();
    try {
      await pedir(`${base()}.json?shallow=true`, {}, 10000);
      ponerEstado('conectando');
    } catch (err) {
      if (err && err.estado) ponerEstado('error', nubeTextoError(err));
      else ponerEstado('sin-red');
    }
    programarReconexion();
  }

  function conectar() {
    cerrar();
    if (!cfg.activa) { ponerEstado('apagada'); return; }
    if (!codigoOk()) { ponerEstado('error', 'Falta un código válido (16 o más letras y números).'); return; }
    if (!permitido()) { ponerEstado('pausada'); return; }
    ponerEstado('conectando');
    sincronizada = false;
    let es;
    try { es = new EventSource(`${base()}.json`); } catch {
      ponerEstado('error', 'Este navegador no puede escuchar en tiempo real.');
      return;
    }
    fuente = es;
    ultimoEvento = Date.now();
    es.onopen = () => {
      if (fuente !== es) return;
      intentos = 0;
      ultimoEvento = Date.now();
      ponerEstado('conectada');
      flush();
    };
    ['put', 'patch'].forEach((tipo) => es.addEventListener(tipo, (e) => { if (fuente === es) evento(tipo, e); }));
    es.addEventListener('keep-alive', () => { if (fuente === es) ultimoEvento = Date.now(); });
    ['cancel', 'auth_revoked'].forEach((tipo) => es.addEventListener(tipo, () => {
      if (fuente !== es) return;
      cerrar();
      ponerEstado('error', 'Firebase cerró la lectura. Revisa las reglas y el código.');
      programarReconexion();
    }));
    es.onerror = () => {
      if (fuente !== es) return;
      if (es.readyState === 2) diagnosticar(); // cerrada por el navegador: permiso, dirección…
      else ponerEstado(navigator.onLine ? 'conectando' : 'sin-red'); // el navegador reintenta solo
    };
  }

  /* ---------- Configuración ---------- */
  function configurar(nueva) {
    const url = quitarBarra(nueva.url) || NUBE_URL_PREDETERMINADA;
    const codigo = String(nueva.codigo || '').trim();
    if (codigo !== cfg.codigo || url !== cfg.url) {
      pendientes.clear();
      datos = {};
      sincronizada = false;
    }
    cfg.url = url;
    cfg.codigo = codigo;
    cfg.activa = !!nueva.activa;
    intentos = 0;
    conectar();
  }

  /* Vuelve a evaluar si debe estar conectada (por ejemplo, al cambiar online/offline) */
  function revisar() {
    if (activa() && fuente) return;
    conectar();
  }

  function reconectar() {
    if (activa()) conectar();
  }

  /* Borra todo lo del grupo en la nube (para empezar de cero) */
  async function limpiarGrupo() {
    if (!codigoOk()) throw new Error('Sin código');
    await pedir(`${base()}.json`, { method: 'DELETE' });
    pendientes.clear();
    datos = {};
  }

  /* Diagnóstico paso a paso con la dirección y el código dados (aunque la nube esté apagada) */
  async function probar(url = cfg.url, codigo = cfg.codigo) {
    const pasos = [];
    const registrar = (nombre, ok, texto) => pasos.push({ nombre, ok, texto });
    if (!codigoOk(codigo)) {
      registrar('Código', false, 'Usa de 16 a 64 letras, números, guion o guion bajo.');
      return pasos;
    }
    const raiz = `${quitarBarra(url) || NUBE_URL_PREDETERMINADA}/grupos/${codigo}/_prueba`;
    const json = { 'Content-Type': 'application/json' };

    try {
      await pedir(`${raiz}.json`, { method: 'PUT', headers: json, body: JSON.stringify({ t: Date.now() }) });
      registrar('Escribir', true, 'Correcto');
    } catch (err) {
      registrar('Escribir', false, nubeTextoError(err));
      return pasos; // sin escritura, los demás pasos fallarían igual
    }
    try {
      await pedir(`${raiz}.json`, { method: 'PATCH', headers: json, body: JSON.stringify({ a: 1, 'b/c': 2 }) });
      registrar('Actualizar varias rutas', true, 'Correcto');
    } catch (err) {
      registrar('Actualizar varias rutas', false, nubeTextoError(err));
    }
    try {
      const datosLeidos = await (await pedir(`${raiz}.json`)).json();
      const bien = datosLeidos && datosLeidos.a === 1 && datosLeidos.b && datosLeidos.b.c === 2;
      registrar('Leer', !!bien, bien ? 'Correcto' : 'Los datos leídos no coinciden con los escritos.');
    } catch (err) {
      registrar('Leer', false, nubeTextoError(err));
    }
    const tiempoReal = await new Promise((resolver) => {
      let es;
      let t = null;
      let listo = false;
      const fin = (ok, texto) => {
        if (listo) return;
        listo = true;
        clearTimeout(t);
        try { es.close(); } catch { /* ya estaba cerrada */ }
        resolver({ ok, texto });
      };
      try { es = new EventSource(`${raiz}.json`); } catch {
        resolver({ ok: false, texto: 'Este navegador no puede escuchar en tiempo real.' });
        return;
      }
      t = setTimeout(() => fin(false, 'No llegó ningún dato en 8 segundos.'), 8000);
      es.addEventListener('put', () => fin(true, 'Correcto'));
      es.onerror = () => { if (es.readyState === 2) fin(false, 'La conexión en tiempo real fue rechazada.'); };
    });
    registrar('Tiempo real', tiempoReal.ok, tiempoReal.texto);
    try {
      await pedir(`${raiz}.json`, { method: 'DELETE' });
      registrar('Borrar la prueba', true, 'Correcto');
    } catch (err) {
      registrar('Borrar la prueba', false, nubeTextoError(err));
    }
    return pasos;
  }

  // Vigilancia: si la conexión se quedó muda, se vuelve a abrir; y se reintenta lo pendiente
  setInterval(() => {
    if (fuente && conexion === 'conectada' && !document.hidden && Date.now() - ultimoEvento > 75000) conectar();
    if (pendientes.size && activa() && !tFlush && !enviando) programarFlush(0);
  }, 20000);
  window.addEventListener('online', () => { if (activa()) { intentos = 0; conectar(); flush(); } });
  window.addEventListener('offline', () => { if (fuente) ponerEstado('sin-red'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !activa()) return;
    // Al volver a la app la conexión pudo quedar congelada: si lleva rato muda, se reabre
    if (conexion !== 'conectada' || Date.now() - ultimoEvento > 40000) conectar();
    flush();
  });

  return {
    configurar, revisar, reconectar, subir, probar, limpiarGrupo,
    apagar: () => configurar({ url: cfg.url, codigo: '', activa: false }),
    config: () => ({ ...cfg }),
    activa,
    datos: () => datos,
    sincronizada: () => sincronizada,
    estado: () => ({ conexion, detalle }),
    cuantosPendientes: () => pendientes.size,
    hayPendiente: (ruta) => [...pendientes.keys()].some((k) => k === ruta || k.startsWith(`${ruta}/`) || ruta.startsWith(`${k}/`)),
    alCambiar: (f) => oyentesDatos.push(f),
    alEstado: (f) => oyentesEstado.push(f),
    permitidoSi: (f) => { permitido = f; },
  };
})();
