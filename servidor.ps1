# Nova - servidor local de archivos estaticos (Windows, sin instalar nada).
# Funciona con Windows PowerShell 5.1 (Windows 10 y 11).
# Uso: doble clic en iniciar.bat, o bien:
#   powershell -NoProfile -ExecutionPolicy Bypass -File servidor.ps1
# Este archivo usa solo caracteres ASCII para que PowerShell 5.1 lo lea bien.

$ErrorActionPreference = 'Stop'

$raiz = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'

$tipos = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.gpx'  = 'application/gpx+xml'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
}

# Devuelve true si nadie mas usa el puerto en esta PC.
function Test-PuertoLibre([int]$puerto) {
  $tcp = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $puerto)
  try { $tcp.Start(); $tcp.Stop(); return $true } catch { return $false }
}

# Convierte la ruta de la URL en un archivo dentro de la carpeta.
# Devuelve $null si la ruta sale de la carpeta o no es valida.
function Resolve-Archivo([string]$rutaUrl) {
  try {
    $relativa = [System.Uri]::UnescapeDataString($rutaUrl).TrimStart('/')
    $partes = $relativa -split '[/\\]'
    if ($partes -contains '..') { return $null }
    if ($relativa.Contains(':')) { return $null }
    $completa = [System.IO.Path]::GetFullPath((Join-Path $raiz ($relativa -replace '/', '\')))
    if (-not ($completa + '\').StartsWith($raiz, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    if ([System.IO.Directory]::Exists($completa)) { $completa = Join-Path $completa 'index.html' }
    if ([System.IO.File]::Exists($completa)) { return $completa }
    return $null
  } catch {
    return $null
  }
}

function Send-Respuesta($respuesta, [int]$codigo, [string]$tipo, [byte[]]$cuerpo, [bool]$conCuerpo) {
  $respuesta.StatusCode = $codigo
  $respuesta.ContentType = $tipo
  $respuesta.Headers['Cache-Control'] = 'no-cache'
  $respuesta.ContentLength64 = $cuerpo.Length
  if ($conCuerpo -and $cuerpo.Length -gt 0) {
    $respuesta.OutputStream.Write($cuerpo, 0, $cuerpo.Length)
  }
}

# Buscar un puerto libre del 8000 al 8009.
$servidor = $null
$direccion = $null
foreach ($puerto in 8000..8009) {
  if (-not (Test-PuertoLibre $puerto)) { continue }
  $prueba = New-Object System.Net.HttpListener
  $prueba.Prefixes.Add("http://localhost:$puerto/")
  try {
    $prueba.Start()
    $servidor = $prueba
    $direccion = "http://localhost:$puerto/"
    break
  } catch {
    try { $prueba.Close() } catch { }
  }
}

if ($null -eq $servidor) {
  Write-Host ''
  Write-Host 'No se pudo iniciar el servidor: los puertos 8000 a 8009 estan ocupados.' -ForegroundColor Red
  exit 1
}

$Host.UI.RawUI.WindowTitle = "Nova - $direccion"
Write-Host ''
Write-Host '  * Nova - servidor local' -ForegroundColor Yellow
Write-Host ''
Write-Host "  Direccion: $direccion" -ForegroundColor Cyan
Write-Host "  Carpeta:   $raiz"
Write-Host ''
Write-Host '  NO CIERRES ESTA VENTANA mientras usas Nova.' -ForegroundColor Yellow
Write-Host '  Para apagar el servidor: Ctrl + C o cierra la ventana al terminar.'
Write-Host ''

try { Start-Process $direccion } catch {
  Write-Host "  No se pudo abrir el navegador. Abre $direccion a mano." -ForegroundColor Yellow
}

try {
  while ($servidor.IsListening) {
    # Esperar en intervalos cortos para que Ctrl + C responda.
    $espera = $servidor.BeginGetContext($null, $null)
    while (-not $espera.AsyncWaitHandle.WaitOne(500)) { }
    try {
      $contexto = $servidor.EndGetContext($espera)
    } catch {
      continue
    }

    $respuesta = $contexto.Response
    try {
      $metodo = $contexto.Request.HttpMethod
      $ruta = $contexto.Request.Url.AbsolutePath
      $conCuerpo = ($metodo -ne 'HEAD')

      if ($metodo -ne 'GET' -and $metodo -ne 'HEAD') {
        $texto = [System.Text.Encoding]::UTF8.GetBytes('405 Metodo no permitido')
        Send-Respuesta $respuesta 405 'text/plain; charset=utf-8' $texto $true
        continue
      }

      $archivo = Resolve-Archivo $ruta
      if ($null -eq $archivo) {
        $texto = [System.Text.Encoding]::UTF8.GetBytes('404 No encontrado')
        Send-Respuesta $respuesta 404 'text/plain; charset=utf-8' $texto $conCuerpo
        Write-Host "  404  $ruta" -ForegroundColor DarkGray
        continue
      }

      $extension = [System.IO.Path]::GetExtension($archivo).ToLowerInvariant()
      $tipo = $tipos[$extension]
      if ($null -eq $tipo) { $tipo = 'application/octet-stream' }

      $bytes = [System.IO.File]::ReadAllBytes($archivo)
      Send-Respuesta $respuesta 200 $tipo $bytes $conCuerpo
    } catch {
      Write-Host "  Error en $($contexto.Request.Url): $($_.Exception.Message)" -ForegroundColor Red
      try {
        $texto = [System.Text.Encoding]::UTF8.GetBytes('500 Error del servidor')
        Send-Respuesta $respuesta 500 'text/plain; charset=utf-8' $texto $true
      } catch { }
    } finally {
      try { $respuesta.Close() } catch { }
    }
  }
} finally {
  try { $servidor.Stop(); $servidor.Close() } catch { }
  Write-Host ''
  Write-Host '  Servidor apagado.'
}
exit 0
