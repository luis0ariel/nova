#!/bin/sh
# Abre Nova con el servidor local (Linux / Mac).
# Uso: sh iniciar.sh   (desde la USB también funciona así)
cd "$(dirname "$0")" || exit 1
PUERTO=8000
echo "Nova: http://localhost:$PUERTO"
echo "Deja esta ventana abierta mientras usas la app. Para cerrar: Ctrl + C"
( sleep 1; xdg-open "http://localhost:$PUERTO" >/dev/null 2>&1 || open "http://localhost:$PUERTO" >/dev/null 2>&1 ) &
python3 -m http.server "$PUERTO" --bind 127.0.0.1
