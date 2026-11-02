#!/usr/bin/env python3
"""Descarga los mosaicos del mapa de una zona a la carpeta mapas/.

Así Nova muestra el mapa sin internet en cualquier computadora
(por ejemplo, en la demostración desde la USB).

Uso (con internet, dentro de la carpeta ruta-segura):

    python3 descargar_mapa.py                      # Sierra de Guadalupe, 3 km
    python3 descargar_mapa.py 19.5800 -99.0700 2   # latitud longitud radio_km
    python3 descargar_mapa.py --contar             # solo cuenta los mosaicos

Para sacar la latitud y longitud del cerro: en la app, toca un punto en
OpenStreetMap o usa la última ubicación que muestra la pestaña Jefe.

Respeta la política de uso de OpenStreetMap: zoom máximo 16, una zona
pequeña, una descarga a la vez y una pausa entre cada mosaico.
"""
import json
import math
import os
import sys
import time
import urllib.request

CENTRO = (19.5800, -99.0700)   # Sierra de Guadalupe (Ecatepec)
RADIO_KM = 3.0
ZOOM_MIN = 12
ZOOM_MAX = 16                  # OpenStreetMap no permite descargar zoom 17 o más
LIMITE = 2500                  # máximo de mosaicos por descarga
PAUSA = 0.3                    # segundos entre mosaicos
AGENTE = "Nova/2.0 (proyecto escolar CECyT 3 IPN; descarga para uso sin internet)"

# Mapa oscuro (tema espacial de Nova); OpenStreetMap como respaldo
FUENTES = [
    "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
]

CARPETA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mapas")


def mosaico_x(lng, z):
    return int((lng + 180.0) / 360.0 * 2 ** z)


def mosaico_y(lat, z):
    r = math.radians(lat)
    return int((1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * 2 ** z)


def rangos_de_zona(lat, lng, radio_km):
    """Para cada zoom: [x_min, x_max, y_min, y_max] del cuadro que cubre el radio."""
    dlat = radio_km / 111.32
    dlng = radio_km / (111.32 * math.cos(math.radians(lat)))
    norte, sur = lat + dlat, lat - dlat
    oeste, este = lng - dlng, lng + dlng
    rangos = {}
    for z in range(ZOOM_MIN, ZOOM_MAX + 1):
        rangos[z] = [mosaico_x(oeste, z), mosaico_x(este, z), mosaico_y(norte, z), mosaico_y(sur, z)]
    return rangos


def contar(rangos):
    return sum((r[1] - r[0] + 1) * (r[3] - r[2] + 1) for r in rangos.values())


def descargar(z, x, y):
    ruta = os.path.join(CARPETA, str(z), str(x), f"{y}.png")
    if os.path.exists(ruta) and os.path.getsize(ruta) > 0:
        return "ya estaba"
    for fuente in FUENTES:
        url = fuente.format(z=z, x=x, y=y)
        try:
            peticion = urllib.request.Request(url, headers={"User-Agent": AGENTE})
            with urllib.request.urlopen(peticion, timeout=20) as resp:
                datos = resp.read()
            os.makedirs(os.path.dirname(ruta), exist_ok=True)
            with open(ruta, "wb") as archivo:
                archivo.write(datos)
            time.sleep(PAUSA)
            return "ok"
        except Exception:  # se prueba la siguiente fuente
            continue
    return "falló"


def escribir_indice(lat, lng, rangos, total):
    indice = {
        "centro": [lat, lng],
        "zMin": ZOOM_MIN,
        "zMax": ZOOM_MAX,
        "rangos": {str(z): r for z, r in rangos.items()},
        "total": total,
        "estilo": "oscuro",
        "creado": time.strftime("%Y-%m-%d %H:%M"),
    }
    with open(os.path.join(CARPETA, "indice.js"), "w", encoding="utf-8") as archivo:
        archivo.write("// Creado por descargar_mapa.py. Lo lee la app para usar los mapas de esta carpeta.\n")
        archivo.write("window.MAPA_LOCAL = " + json.dumps(indice) + ";\n")


def main():
    argumentos = [a for a in sys.argv[1:] if not a.startswith("--")]
    solo_contar = "--contar" in sys.argv
    if len(argumentos) not in (0, 3):
        print(__doc__)
        sys.exit(1)
    lat, lng, radio = (CENTRO[0], CENTRO[1], RADIO_KM) if not argumentos else map(float, argumentos)

    rangos = rangos_de_zona(lat, lng, radio)
    total = contar(rangos)
    print(f"Zona: {lat:.5f}, {lng:.5f} · radio {radio} km · zoom {ZOOM_MIN} a {ZOOM_MAX}")
    print(f"Mosaicos: {total} (unos {total * 20 // 1024} MB)")
    if total > LIMITE:
        print(f"Son demasiados (máximo {LIMITE}). Usa un radio más pequeño.")
        sys.exit(1)
    if solo_contar:
        return

    os.makedirs(CARPETA, exist_ok=True)
    hechos = fallidos = 0
    for z, (x0, x1, y0, y1) in rangos.items():
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                if descargar(z, x, y) == "falló":
                    fallidos += 1
                hechos += 1
                print(f"\r{hechos}/{total} mosaicos · {fallidos} fallidos", end="", flush=True)
    print()
    escribir_indice(lat, lng, rangos, total - fallidos)
    if fallidos:
        print(f"Terminado con {fallidos} fallidos. Vuelve a ejecutarlo para reintentar solo esos.")
    else:
        print("Listo. La carpeta mapas/ ya tiene el mapa de la zona.")


if __name__ == "__main__":
    main()
