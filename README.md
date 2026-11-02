# ✦ Nova — v2.0.5

App web instalable (PWA) para registrar rutas de senderismo con GPS, sin internet. Está hecha con **HTML, CSS y JavaScript** y funciona en el celular. Su tema espacial está basado en StarPaint.

## Usuarios

Al abrir Nova eliges tu tipo de usuario y escribes tu contraseña en el teclado numérico. La primera vez, cada usuario llena su **perfil de seguridad**.

| Usuario | Contraseña inicial | Pestañas |
| --- | --- | --- |
| 🧒 `scout` | `0000` | Grabar, Rutas, Perfil |
| 🧭 `jefe` | `0000` | + Jefe (está al pendiente del grupo) |
| 🎖 `exp` | `0000` | + Revisar (valida rutas con un recorrido real, o las rechaza con una nota) |
| 🛠 `dev` | `0000` | Todas + Admin (contraseñas, modo pruebas, borrar datos) |

Cada tipo de usuario tiene su propio color y su propio perfil.

**Limitación:** Nova no tiene servidor. Las contraseñas se guardan cifradas (SHA-256) en el teléfono y sirven para separar las vistas, no para proteger los datos de alguien que tenga el teléfono y sepa programar.

## Pantallas

| Pestaña | Qué hace |
| --- | --- |
| **Grabar** (inicio) | Mapa nocturno con la ruta en dorado; tiempo, distancia, ritmo y descansos; Iniciar, Pausar, Descanso y Terminar; enviar ubicación al jefe; guardar mapa. La ubicación y la batería se comparten solas con la vista del jefe mientras la sesión está abierta |
| **Rutas** | Lista e importar. Dentro de una ruta: mapa, estadísticas, paradas, **Enviar a validación de experto** (manual; nada se envía solo al terminar), revisión, renombrar, **exportar** (.gpx o .nova.json) y **borrar** |
| **Perfil** | Nombre, fecha de nacimiento, tipo de sangre, alergias, padecimientos, contacto de emergencia y jefe; cerrar sesión |
| **Jefe** | **Monitoreo activo**: lista de personas a cargo; al tocar una, su estado (en ruta, en descanso, retrasado, SOS), ubicación, batería, ruta, perfil de emergencia y la **hora límite de regreso**, que solo define el jefe. Rutas del grupo |
| **Revisar** | Rutas que los scouts enviaron (`pendiente_revision`) y revisadas. Dentro de una ruta: **recorrido de validación** (el experto la recorre y Nova compara distancia y desnivel; tolerancia 15 %). Si está dentro, se aprueba con fechas de vigencia y observaciones de seguridad y queda `validada` con la firma del experto. También se puede rechazar con nota |
| **Admin** | Contraseñas, modo pruebas y sistema |

- **Barra de estado** (arriba, discreta como un contador de FPS): GPS ±metros, internet, batería, mosaicos de mapa guardados y la hora límite que puso el jefe (avisa 15 minutos antes y al vencer). Tócala para ver el detalle.
- **Mapa bloqueado 🔒** mientras grabas: sigue tu posición y no se arrastra. Toca 🔒 para moverlo libremente, ⤢ para ver toda la ruta y ◎ para centrar.
- **Borrar ruta:** se borra **1 hora después**. Mientras tanto aparece "Se borrará a las…" con el botón **Cancelar borrado**.
- **SOS:** el SMS va al contacto de emergencia y al jefe, con tu ubicación, edad, tipo de sangre, alergias y padecimientos. También hay un botón para llamar al 911.
- **Modo pruebas** (solo `dev`, en Admin): muestra "Simular recorrido" en Grabar y "Repetir como demo" dentro de una ruta.

## Abrir Nova

- **Linux:** `sh iniciar.sh` dentro de la carpeta.
- **Windows:** doble clic en `iniciar.bat`. No necesita instalar nada: usa `servidor.ps1` (PowerShell, viene con Windows 10 y 11). Si PowerShell falla, intenta con Python.
- **Celular:** súbela a GitHub Pages; el GPS necesita HTTPS.

No abras `index.html` con doble clic: así no funcionan el GPS ni el modo sin internet.

## Presentación en la PC del evento

La presentación es en persona, sin internet, en una PC prestada con Windows y sin Python.

1. Conecta la USB y abre la carpeta de Nova.
2. Doble clic en **`iniciar.bat`**. Se abre una ventana negra y el navegador en `http://localhost:8000/`.
3. **No cierres la ventana negra** mientras presentas: es el servidor.
4. Inicia sesión e importa las rutas de `datos/` desde **Rutas → Importar**.
5. Al terminar, cierra el navegador y luego la ventana negra.

Si aparece "Windows protegió su PC", toca **Más información → Ejecutar de todas formas**.
Si el puerto 8000 está ocupado, Nova se abre en el 8001 (hasta el 8009). El navegador lo trata como otro sitio: las rutas importadas en otro puerto no aparecen y hay que importarlas otra vez.

### Revisar antes de la presentación

- [ ] La carpeta `mapas/` está en la USB, con el mapa de la zona descargado (`descargar_mapa.py` se ejecuta antes, en una PC con internet y Python).
- [ ] Las rutas `.nova.json` que vas a mostrar están en `datos/`.
- [ ] Ensayo completo desde la USB **con el Wi-Fi apagado**: abrir `iniciar.bat`, iniciar sesión, importar rutas y ver el mapa sin internet.
- [ ] Si puedes, ensaya en otra PC con Windows que no tenga Python.
- [ ] Llevas una copia de la carpeta en una segunda USB.

## Mapa sin internet

1. **En el teléfono, con internet:** en Grabar, acerca el mapa a la zona y toca **⬇ Guardar mapa**.
2. **En la carpeta `mapas/`:** en la PC, con internet, ejecuta `python3 descargar_mapa.py` (o `python3 descargar_mapa.py LAT LON RADIO_KM`). Descarga el mapa nocturno de la zona.

## Cuando cambies archivos

Sube el número de `VERSION` en `sw.js` y `VERSION_APP` en `app.js`; si no, el teléfono sigue mostrando la versión guardada.

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
| `descargar_mapa.py`, `iniciar.sh`, `iniciar.bat`, `servidor.ps1` | Herramientas para la computadora (no son parte de la app) |
| `datos/` | Rutas `.gpx` y `.nova.json` para importar |
