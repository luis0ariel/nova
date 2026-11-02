@echo off
rem Abre Nova con un servidor local (Windows). No necesita instalar nada.
rem 1) PowerShell (viene con Windows 10 y 11). 2) Si falla: py o python.
cd /d "%~dp0"
title Nova - servidor local

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
if %errorlevel% equ 0 goto :eof

echo.
echo No se pudo usar PowerShell. Probando con Python...
call :buscar py
if not defined PY call :buscar python
if defined PY goto :python

echo.
echo No se pudo iniciar Nova: PowerShell fallo y no se encontro Python.
pause
goto :eof

:python
set PUERTO=8000
echo Nova: http://localhost:%PUERTO%/
echo NO CIERRES ESTA VENTANA mientras usas Nova. Para apagar: Ctrl + C
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PUERTO%/"
"%PY%" -m http.server %PUERTO% --bind 127.0.0.1
pause
goto :eof

rem Guarda en PY la ruta del programa %1, ignorando el python.exe de
rem WindowsApps (solo abre la Microsoft Store).
:buscar
set "PY="
for /f "delims=" %%P in ('where %1 2^>nul') do (
  if not defined PY (
    echo %%P| findstr /i "WindowsApps" >nul || set "PY=%%P"
  )
)
goto :eof
