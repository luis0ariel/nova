# Nova — instrucciones para Claude

Nova es una PWA de rutas de senderismo para un concurso escolar (CECyT No. 3, IPN). Autor: Ariel.
Se usa en el **celular**: todo el código de la app es HTML, CSS y JavaScript sin servidor ni compilación.

## Reglas
- La app es solo `index.html`, `styles.css`, `sesion.js`, `nube.js`, `app.js`, `sw.js` y `manifest.json`. No agregues frameworks, npm ni pasos de compilación.
- Python solo se usa en herramientas de la computadora (`descargar_mapa.py` y como respaldo del servidor local). Nunca en la app.
- La demostración debe funcionar abriendo iniciar.bat desde la USB, sin instalar nada. El servidor de Windows es `servidor.ps1` (PowerShell 5.1, solo ASCII).
- Cada vez que cambies un archivo de la app, sube `VERSION` en `sw.js` y `VERSION_APP` en `app.js`; si agregas un archivo, añádelo a `ARCHIVOS_APP` en `sw.js`.
- Nadie es monitoreado sin su consentimiento. La solicitud puede venir del jefe o de quien será monitoreado, y el otro lado siempre puede rechazarla. El SOS es la única excepción.
- Todo funciona sin internet: no cargues scripts ni fuentes de CDN. Leaflet está en `vendor/leaflet/`.
- Textos de la interfaz en español de México, claros y sin modismos.
- En las instrucciones `switch` no uses `default`.
- Prueba en un navegador con tamaño de celular (390×844) antes de terminar.

## Tema (basado en StarPaint)
Espacial y galáctico, inspirado en consolas Nintendo. Fondos `#0d0d1a`, `#13131f`, paneles `#1a1a2e`, bordes `#252537`, texto `#cdd6f4`, dorado `#FFD700` con la estrella ✦ en títulos. Letra Consolas (monoespaciada). Colores por usuario: scout verde `#a6e3a1`, jefe cian `#89dceb`, exp morado `#cba6f7`, dev naranja `#fab387`. Mapa nocturno: OpenStreetMap oscurecido con filtro CSS (clase `claro`), con la ruta en dorado. CARTO pide clave y no se usa. Sin splash.

## Usuarios (`sesion.js`)
`scout`, `jefe`, `exp`, `dev`; contraseña predeterminada `0000`. Se entra con una pantalla simple: campos "Usuario" y "Contraseña" y botón "Entrar" (el usuario decide la sesión; sin importar mayúsculas; Enter entra; error "Usuario o contraseña incorrectos" con sacudida). Las contraseñas se guardan con SHA-256 en IndexedDB. Lo que solo ven algunos usuarios lleva `data-roles="..."`.
- scout: Grabar, Rutas, Perfil
- jefe: + Jefe
- exp: + Revisar. Aprobar exige un recorrido de validación (`validacionDe`) con variación de distancia y desnivel ≤ 15 %, y luego vigencia y observaciones; la ruta queda `validada` con firma. El recorrido del experto queda con estado `validacion`. Rechazar sigue siendo con nota.
- dev: su vista propia tiene solo Admin (inicio), Rutas (todas las rutas de todos, con filtros Todas, Reales, Prueba y Por revisar) y Perfil, sin SOS. Entra a Grabar, Jefe y Revisar con "Ver como" (ver Permisos de dev).

## Comportamiento acordado
- Grabar es la pantalla de inicio (de dev, Admin). El estado va en una barra discreta arriba (`#hud`), como un contador de FPS, y solo se ve en Grabar (clase `tab-grabar` en body). Con monitoreo activo, "📡 MONITOREO" va en la barra superior, junto al botón de usuario, en todas las pestañas.
- Toda pantalla tiene forma de salir: "✕ Salir sin guardar" en Grabar (y "Descartar" al guardar), "✕ Cancelar validación", "← Cambiar de usuario" en el registro, ✕/Esc/tocar fuera en las ventanas (salvo "Guardando mapa…") y el botón atrás del celular (ventana → detalle → pestaña de inicio; grabando, pregunta).
- Simulación ("Simular recorrido" y "Repetir como demo"): duración y velocidad (1x a 50x) con reloj virtual `ahora()`; todo lo que mide la ruta usa `ahora()`, nunca `Date.now()` directo. Al guardar o descartar, `ahora()` vuelve a ser `Date.now()`.
- Nube (`nube.js` + sección 15b de `app.js`; ajuste `nube`: `{ url, codigo, activa }`, solo dev lo cambia en Admin → Nube): Firebase Realtime Database por su API REST (fetch para escribir, EventSource para escuchar), sin SDK ni CDN. Todo vive en `grupos/<codigo>/` con `monitoreo`, `ubicacion`, `rastro` y `sos`; las reglas solo permiten leer y escribir dentro de una carpeta cuyo nombre tenga 16 o más caracteres. Reglas de consentimiento que no se rompen: la ubicación y el rastro solo los sube quien aceptó el monitoreo y solo si en la nube el monitoreo está activo; el SOS es la única excepción; el perfil de salud no se sube; los monitoreos de prueba (`prueba: true`) y las sesiones de dev no suben ni reciben nada. Firebase no guarda `null`, `""` ni objetos vacíos y ordena las claves: compara siempre con `nubeIgual()`. En modo offline la nube se pausa y lo pendiente se sube al volver. La demostración sin internet no cambia: con la nube apagada Nova se comporta igual que antes.
- Modo de conexión (ajuste `modoRed`: `online` u `offline`): solo dev lo cambia con un botón en Admin → Conexión. En `offline` el Service Worker (`sw.js`, mensaje `modo-red`) no pide mosaicos a internet; la página lo avisa al arrancar. `localhost` no cuenta como internet. Barra de estado: MODO OFFLINE; "Guardar mapa" se bloquea.
- Inicio del recorrido inventado: `estado.simInicio` se elige tocando el mapa desde la ventana de "Simular recorrido" (`pedirInicioSim`); sin elegir, el punto de siempre.
- La primera vez que entra cada usuario se pide su perfil de seguridad; después se edita en Perfil. Se guarda en `perfil:<rol>`.
- Exportar rutas solo dentro del detalle de una ruta (.gpx o .nova.json).
- Estados de ruta: `en curso` → `terminada` (sin enviar) → `pendiente_revision` → `validada` o `rechazada`. El envío al experto es manual, con "Enviar a validación de experto" en el detalle; nunca al terminar de grabar. `verificada` es de versiones viejas.
- Monitoreo con consentimiento en dos direcciones (ajuste `monitoreo`: pendiente → activo/rechazado → terminado; `origen` 'jefe' o 'monitoreado'; `monitoreado` {rol, nombre}; motivo; historial en `monitoreoHistorial`). Se puede monitorear a scout y exp. El jefe lo pide desde Jefe, o el monitoreado con "📡 Pedir monitoreo" en Grabar (motivo y hora límite opcionales; si el motivo dice que está perdido se recuerda el SOS). El otro lado acepta o rechaza en una ventana al entrar o volver a la app. Activo: 📡 MONITOREO en `#hud`; el scout no lo apaga ni cerrando sesión; solo jefe o dev lo terminan. Solo entonces se guarda `ultimaUbicacion` (cada 15 s, al pasar a segundo plano y al cerrar la app).
- El GPS no se enciende al iniciar sesión: solo al aceptar el monitoreo, iniciar una ruta, o usar SOS o "Enviar mi ubicación". "Guardar mapa" solo lo ve dev.
- La hora límite de regreso solo la define el jefe (o dev), al iniciar el monitoreo o en el detalle con el monitoreo activo; el scout no tiene ese botón. Se guarda en `horaLimite` y las alertas (15 min antes y al vencer) le saltan al scout. No hay servidor: el monitoreo solo ve lo que hay en el mismo teléfono.
- Borrar una ruta tarda 1 hora (`borrarEn`) y se puede cancelar.
- Mientras se graba, el mapa está bloqueado (sigue la posición y no se arrastra); 🔒 lo libera.
- La base de datos se sigue llamando `ruta-segura` para no perder datos de versiones anteriores.

## Permisos de dev
- Borrar rutas: dev borra al instante (sin la hora de espera) con un aviso de 5 s y "Deshacer"; también la ruta en curso (se deshace como "en curso" en pausa) y descarta sin confirmar. Si la ruta ya tiene `borrarEn`, dev ve "Borrar ahora". Los demás siguen con 1 hora.
- Monitoreo: lo que inicia dev es de prueba (`prueba: true`). Dev termina cualquier monitoreo al instante, sin confirmación. El otro lado siempre decide si acepta.
- "Ver como" (Admin): Scout, Jefe o Experto sin cerrar sesión ni pedir contraseña. `Sesion.vista` es el rol que se muestra y `Sesion.rol` sigue siendo 'dev'; `Sesion.puede()` y las pestañas usan la vista, los permisos de dev se revisan con `Sesion.esDev()`. Perfil de prueba en `perfil:prueba-<rol>`. Barra naranja "🛠 DEV viendo como … · Volver a dev".
- Todo lo creado por dev en una vista lleva `prueba: true` y la etiqueta PRUEBA. "Borrar datos de prueba" (Admin) quita rutas, perfiles y monitoreos de prueba al instante, sin tocar los reales. Las solicitudes de monitoreo de prueba solo se cruzan con sesiones de dev.
- "🛠 Generar recorrido" (dev, en vista Experto o dev, ruta `pendiente_revision`): por variación (zigzag o atajos por bisección, desnivel escalado) o por puntos en el mapa. Se guarda con `prueba: true`, `generada: true` y `validacionDe`, y sigue el flujo normal con `terminarValidacion`.

## Fechas
Salida de prueba al cerro: 7 u 8 de noviembre de 2026. Pruebas finales y ensayo de la presentación desde la USB: 9 al 14 de noviembre. No hay video; la presentación es en persona, sin internet, en una PC prestada con Windows sin Python.
