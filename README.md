# ✦ Nova — v2.0.0

App web instalable (PWA) para registrar rutas de senderismo con GPS, sin internet. Está hecha con **HTML, CSS y JavaScript** y funciona en el celular. Su tema espacial está basado en StarPaint.

## Usuarios

Al abrir Nova eliges tu tipo de usuario y escribes tu contraseña en el teclado numérico. La primera vez, cada usuario llena su **perfil de seguridad**.

| Usuario | Contraseña inicial | Pestañas |
| --- | --- | --- |
| 🧒 `scout` | `0000` | Grabar, Rutas, Perfil |
| 🧭 `jefe` | `0000` | + Jefe (está al pendiente del grupo) |
| 🎖 `exp` | `0000` | + Revisar (aprueba o rechaza rutas con una nota) |
| 🛠 `dev` | `0000` | Todas + Admin (contraseñas, modo pruebas, borrar datos) |

Cada tipo de usuario tiene su propio color y su propio perfil.

**Limitación:** Nova no tiene servidor. Las contraseñas se guardan cifradas (SHA-256) en el teléfono y sirven para separar las vistas, no para proteger los datos de alguien que tenga el teléfono y sepa programar.

## Pantallas

| Pestaña | Qué hace |
| --- | --- |
| **Grabar** (inicio) | Mapa nocturno con la ruta en dorado; tiempo, distancia, ritmo y descansos; Iniciar, Pausar, Descanso y Terminar; enviar ubicación al jefe; hora límite; guardar mapa |
| **Rutas** | Lista e importar. Dentro de una ruta: mapa, estadísticas, paradas, revisión, renombrar, **exportar** (.gpx o .nova.json) y **borrar** |
| **Perfil** | Nombre, fecha de nacimiento, tipo de sangre, alergias, padecimientos, contacto de emergencia y jefe; cerrar sesión |
| **Jefe** | Estado (en ruta, en descanso, retrasado, SOS), última ubicación, hora límite y rutas del grupo |
| **Revisar** | Rutas pendientes y revisadas; aprobar o rechazar con nota |
| **Admin** | Contraseñas, modo pruebas y sistema |

- **Barra de estado** (arriba, discreta como un contador de FPS): GPS ±metros, internet, batería, mosaicos de mapa guardados y hora límite. Tócala para ver el detalle.
- **Mapa bloqueado 🔒** mientras grabas: sigue tu posición y no se arrastra. Toca 🔒 para moverlo libremente, ⤢ para ver toda la ruta y ◎ para centrar.
- **Borrar ruta:** se borra **1 hora después**. Mientras tanto aparece "Se borrará a las…" con el botón **Cancelar borrado**.
- **SOS:** el SMS va al contacto de emergencia y al jefe, con tu ubicación, edad, tipo de sangre, alergias y padecimientos. También hay un botón para llamar al 911.
- **Modo pruebas** (solo `dev`, en Admin): muestra "Simular recorrido" en Grabar y "Repetir como demo" dentro de una ruta.

## Abrir Nova

- **Linux:** `sh iniciar.sh` dentro de la carpeta.
- **Windows:** doble clic en `iniciar.bat` (necesita Python).
- **Celular:** súbela a GitHub Pages; el GPS necesita HTTPS.

No abras `index.html` con doble clic: así no funcionan el GPS ni el modo sin internet.

## Mapa sin internet

1. **En el teléfono, con internet:** en Grabar, acerca el mapa a la zona y toca **⬇ Guardar mapa**.
2. **En la carpeta `mapas/`:** en la PC, con internet, ejecuta `python3 descargar_mapa.py` (o `python3 descargar_mapa.py LAT LON RADIO_KM`). Descarga el mapa nocturno de la zona.

## Cuando cambies archivos

Sube el número de `VERSION` en `sw.js`; si no, el teléfono sigue mostrando la versión guardada.

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | Pantallas, inicio de sesión y formulario de perfil |
| `styles.css` | Tema espacial de Nova |
| `sesion.js` | Usuarios, contraseñas y permisos |
| `app.js` | GPS, mapa, registro, perfil, SOS, jefe, revisión, admin |
| `sw.js` | Service Worker (modo sin internet) |
| `manifest.json` | Instalación como app |
| `icons/` | Ícono de Nova |
| `vendor/leaflet/` | Leaflet 1.9.4 (mapa) |
| `descargar_mapa.py`, `iniciar.sh`, `iniciar.bat` | Herramientas para la computadora (no son parte de la app) |
| `datos/` | Rutas `.gpx` y `.nova.json` para importar |
