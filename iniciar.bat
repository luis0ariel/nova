@echo off
rem Abre Nova con el servidor local (Windows).
cd /d "%~dp0"
set PUERTO=8000
echo Nova: http://localhost:%PUERTO%
echo Deja esta ventana abierta mientras usas la app. Para cerrar: Ctrl + C
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PUERTO%"
where py >nul 2>nul && (py -m http.server %PUERTO% --bind 127.0.0.1 & goto :fin)
where python >nul 2>nul && (python -m http.server %PUERTO% --bind 127.0.0.1 & goto :fin)
echo.
echo No se encontro Python. Instalalo desde https://www.python.org (marca "Add python to PATH").
pause
:fin
