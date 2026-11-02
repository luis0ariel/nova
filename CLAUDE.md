# Nova — instrucciones para Claude

Nova es una PWA de rutas de senderismo para un concurso escolar (CECyT No. 3, IPN). Autor: Ariel.
Se usa en el **celular**: todo el código de la app es HTML, CSS y JavaScript sin servidor ni compilación.

## Reglas
- La app es solo `index.html`, `styles.css`, `sesion.js`, `app.js`, `sw.js` y `manifest.json`. No agregues frameworks, npm ni pasos de compilación.
- Python solo se usa en herramientas de la computadora (`descargar_mapa.py` y como respaldo del servidor local). Nunca en la app.
- La demostración debe funcionar abriendo iniciar.bat desde la USB, sin instalar nada. El servidor de Windows es `servidor.ps1` (PowerShell 5.1, solo ASCII).
- Cada vez que cambies un archivo de la app, sube `VERSION` en `sw.js` y `VERSION_APP` en `app.js`; si agregas un archivo, añádelo a `ARCHIVOS_APP` en `sw.js`.
- Todo funciona sin internet: no cargues scripts ni fuentes de CDN. Leaflet está en `vendor/leaflet/`.
- Textos de la interfaz en español de México, claros y sin modismos.
- En las instrucciones `switch` no uses `default`.
- Prueba en un navegador con tamaño de celular (390×844) antes de terminar.

## Tema (basado en StarPaint)
Espacial y galáctico, inspirado en consolas Nintendo. Fondos `#0d0d1a`, `#13131f`, paneles `#1a1a2e`, bordes `#252537`, texto `#cdd6f4`, dorado `#FFD700` con la estrella ✦ en títulos. Letra Consolas (monoespaciada). Colores por usuario: scout verde `#a6e3a1`, jefe cian `#89dceb`, exp morado `#cba6f7`, dev naranja `#fab387`. Mapa nocturno: OpenStreetMap oscurecido con filtro CSS (clase `claro`), con la ruta en dorado. CARTO pide clave y no se usa. Sin splash.

## Usuarios (`sesion.js`)
`scout`, `jefe`, `exp`, `dev`; contraseña predeterminada `0000`. Las contraseñas se guardan con SHA-256 en IndexedDB. Lo que solo ven algunos usuarios lleva `data-roles="..."`.
- scout: Grabar, Rutas, Perfil
- jefe: + Jefe
- exp: + Revisar. Aprobar exige un recorrido de validación (`validacionDe`) con variación de distancia y desnivel ≤ 15 %, y luego vigencia y observaciones; la ruta queda `validada` con firma. El recorrido del experto queda con estado `validacion`. Rechazar sigue siendo con nota.
- dev: todo + Admin (contraseñas, modo pruebas, borrar datos)

## Comportamiento acordado
- Grabar es la pantalla de inicio. El estado va en una barra discreta arriba (`#hud`), como un contador de FPS.
- La primera vez que entra cada usuario se pide su perfil de seguridad; después se edita en Perfil. Se guarda en `perfil:<rol>`.
- Exportar rutas solo dentro del detalle de una ruta (.gpx o .nova.json).
- Estados de ruta: `en curso` → `terminada` (sin enviar) → `pendiente_revision` → `validada` o `rechazada`. El envío al experto es manual, con "Enviar a validación de experto" en el detalle; nunca al terminar de grabar. `verificada` es de versiones viejas.
- La ubicación se comparte sola con el jefe (cada 15 s, al pasar a segundo plano y al cerrar la app) en el mismo teléfono.
- La hora límite de regreso solo la define el jefe (o dev) en Jefe → Monitoreo activo; el scout no tiene ese botón. Se guarda en `horaLimite` y las alertas (15 min antes y al vencer) le saltan al scout. No hay servidor: el monitoreo solo ve lo que hay en el mismo teléfono.
- Borrar una ruta tarda 1 hora (`borrarEn`) y se puede cancelar.
- Mientras se graba, el mapa está bloqueado (sigue la posición y no se arrastra); 🔒 lo libera.
- La base de datos se sigue llamando `ruta-segura` para no perder datos de versiones anteriores.

## Fechas
Salida de prueba al cerro: 7 u 8 de noviembre de 2026. Pruebas finales y ensayo de la presentación desde la USB: 9 al 14 de noviembre. No hay video; la presentación es en persona, sin internet, en una PC prestada con Windows sin Python.
