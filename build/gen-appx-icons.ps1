# Genera los iconos/mosaicos del paquete APPX (Microsoft Store) desde recursos/logo.png.
# Ejecutar desde la raíz del proyecto:  powershell -File build/gen-appx-icons.ps1
Add-Type -AssemblyName System.Drawing
$raiz = Split-Path -Parent $PSScriptRoot   # carpeta del proyecto (padre de build/)
$src = Join-Path $raiz 'recursos\logo.png'
$out = Join-Path $raiz 'build\appx'
New-Item -ItemType Directory -Force $out | Out-Null
$orig = [System.Drawing.Image]::FromFile($src)

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

# El anillo se dibuja centrado, ocupando 'frac' de la dimensión menor (deja margen como pide la Store)
function Save-Tile([string]$nombre, [int]$w, [int]$h, [double]$frac) {
  $r = New-Canvas $w $h
  $bmp = $r[0]; $g = $r[1]
  $lado = [Math]::Round([Math]::Min($w, $h) * $frac)
  $x = [int](($w - $lado) / 2); $y = [int](($h - $lado) / 2)
  $g.DrawImage($orig, $x, $y, $lado, $lado)
  $g.Dispose()
  $bmp.Save((Join-Path $out $nombre), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "$nombre  ${w}x${h}"
}

# Mosaicos cuadrados: el anillo casi llena el mosaico (margen pequeño)
Save-Tile 'Square44x44Logo.png'   44  44  0.92
Save-Tile 'Square71x71Logo.png'   71  71  0.90
Save-Tile 'Square150x150Logo.png' 150 150 0.82
Save-Tile 'Square310x310Logo.png' 310 310 0.80
Save-Tile 'StoreLogo.png'         50  50  0.92
# Mosaico ancho y pantalla de bienvenida: anillo centrado con más aire
Save-Tile 'Wide310x150Logo.png'   310 150 0.85
Save-Tile 'SplashScreen.png'      620 300 0.62
# BadgeLogo (monocromo) opcional: lo omitimos
$orig.Dispose()
"OK"
