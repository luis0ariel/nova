/* Nova — sesiones y tipos de usuario
 *
 * Usuarios (contraseña predeterminada 0000):
 *   scout  Scout general: graba sus rutas, SOS y avisos al jefe.
 *   jefe   Jefe: además ve la pestaña Jefe para estar al pendiente del grupo.
 *   exp    Experto: además revisa las rutas y las aprueba o rechaza.
 *   dev    Administrador: todo lo anterior, pruebas y cambio de contraseñas.
 *
 * IMPORTANTE: la app no tiene servidor. Las contraseñas se guardan cifradas
 * (SHA-256) en este teléfono y sirven para separar las vistas, no para
 * proteger datos de alguien que tenga el teléfono y sepa programar.
 */
'use strict';

const ROLES = {
  scout: { nombre: 'Scout', icono: '🧒', inicio: 'grabar', color: '#a6e3a1', desc: 'Graba tus rutas y pide ayuda' },
  jefe: { nombre: 'Jefe', icono: '🧭', inicio: 'jefe', color: '#89dceb', desc: 'Está al pendiente del grupo' },
  exp: { nombre: 'Experto', icono: '🎖', inicio: 'revisar', color: '#cba6f7', desc: 'Revisa y certifica rutas' },
  dev: { nombre: 'Dev', icono: '🛠', inicio: 'grabar', color: '#fab387', desc: 'Pruebas y administración' },
};
const CLAVE_PREDETERMINADA = '0000';

/* Huella de la contraseña. Usa SHA-256 cuando el navegador lo permite
 * (localhost o HTTPS) y una función sencilla si se abrió como archivo. */
async function huellaClave(rol, clave) {
  const texto = `ruta-segura:${rol}:${clave}`; // se mantiene para no invalidar contraseñas ya guardadas
  if (window.crypto && crypto.subtle) {
    const datos = new TextEncoder().encode(texto);
    const hash = await crypto.subtle.digest('SHA-256', datos);
    return 'sha256:' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'fnv:' + (h >>> 0).toString(16);
}

const Sesion = {
  rol: null,

  async claves() {
    return (await DB.leerAjuste('claves')) || {};
  },

  /* Si el rol no tiene contraseña guardada, vale la predeterminada.
   * Se guarda en texto la que corresponde al método disponible. */
  async comprobar(usuario, clave) {
    const rol = String(usuario || '').trim().toLowerCase();
    if (!ROLES[rol]) return null;
    const guardada = (await Sesion.claves())[rol];
    if (!guardada) return clave === CLAVE_PREDETERMINADA ? rol : null;
    const tipo = guardada.split(':')[0];
    const actual = await huellaClave(rol, clave);
    if (actual.split(':')[0] !== tipo) {
      aviso('Esta contraseña se creó con otro método; ábrela con el servidor local', 4000);
      return null;
    }
    return actual === guardada ? rol : null;
  },

  async cambiarClave(rol, nueva) {
    const claves = await Sesion.claves();
    claves[rol] = await huellaClave(rol, nueva);
    await DB.guardarAjuste('claves', claves);
  },

  async restablecer() {
    await DB.guardarAjuste('claves', {});
  },

  async usaPredeterminada(rol) {
    return !(await Sesion.claves())[rol];
  },

  async guardar(rol) {
    Sesion.rol = rol;
    await DB.guardarAjuste('sesion', { rol, t: Date.now() });
  },

  async recuperar() {
    const s = await DB.leerAjuste('sesion');
    Sesion.rol = s && ROLES[s.rol] ? s.rol : null;
    return Sesion.rol;
  },

  async cerrar() {
    Sesion.rol = null;
    await DB.guardarAjuste('sesion', null);
  },

  puede(roles) {
    return !roles || roles.split(/\s+/).includes(Sesion.rol);
  },
};

/* Muestra u oculta lo que tiene data-roles según el usuario */
function aplicarPermisos() {
  const rol = Sesion.rol;
  document.body.classList.toggle('sin-sesion', !rol);
  Object.keys(ROLES).forEach((r) => document.body.classList.toggle(`rol-${r}`, r === rol));
  document.querySelectorAll('[data-roles]').forEach((el) => {
    el.classList.toggle('sin-permiso', !Sesion.puede(el.dataset.roles));
  });
  const visibles = document.querySelectorAll('.tabbar button:not(.sin-permiso)').length;
  document.querySelector('.tabbar').style.setProperty('--pestanas', visibles);
  const info = ROLES[rol];
  document.querySelector('#btn-cuenta').textContent = info ? `${info.icono} ${info.nombre.toUpperCase()}` : '—';
}
